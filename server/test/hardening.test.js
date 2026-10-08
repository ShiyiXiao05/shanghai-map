// 本轮修复的回归测试：安全头、上传契约、数据一致性、推送鉴权、限流、进程健壮性。
// 全部跑在 pg-mem 隔离库上，不触碰生产。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';
import { createAuth } from '../auth.js';
import { createRateLimiter } from '../ratelimit.js';
import { createHash } from 'node:crypto';
import { createContentSecurity } from '../content-security.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const placeBody = { name: '审计地点', category: '景点', lng: 121.4375, lat: 31.2054 };

async function startServer({ uploader, auth, pusher, contentSecurity } = {}) {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const app = buildApp({
    store,
    mapConfig: { key: 'test-key', securityJsCode: 'test-code' },
    uploader,
    pusher,
    auth,
    contentSecurity,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, route, { body, mapCode, token } = {}) =>
    fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(mapCode === undefined ? {} : { 'x-map-code': mapCode }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const seed = async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: '测试地图' } })).json();
    const place = await (
      await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
    ).json();
    return { map, place };
  };
  return { server, request, store, pool, seed };
}

describe('安全响应头', () => {
  let server;
  let request;
  beforeEach(async () => {
    ({ server, request } = await startServer());
  });
  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('所有响应都带 HSTS / nosniff / frame-options / referrer-policy', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('strict-transport-security'), /max-age=\d+/);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('x-frame-options'), 'DENY');
    assert.equal(res.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
    assert.ok(res.headers.get('permissions-policy'));
  });
});

describe('上传能力协商与照片契约', () => {
  let server;
  let request;
  let seed;
  let store;
  afterEach(async () => {
    server?.closeAllConnections();
    await server?.close();
  });

  it('未配图床时 upload-config 返回 cdn=false 与上限', async () => {
    ({ server, request, seed } = await startServer());
    const cfg = await (await request('GET', '/api/upload-config')).json();
    assert.equal(cfg.cdn, false);
    assert.equal(cfg.maxFullBytes, 1.5 * 1024 * 1024);
    assert.equal(cfg.maxThumbBytes, 64 * 1024);
    assert.equal((await request('GET', '/api/upload-config')).status, 200);
  });

  it('配了图床时 upload-config 返回 cdn=true', async () => {
    ({ server, request, seed, store } = await startServer({
      uploader: { configured: true, upload: async () => ({}) },
    }));
    const cfg = await (await request('GET', '/api/upload-config')).json();
    assert.equal(cfg.cdn, true);
  });

  it('thumb 可省略：只传 full 也能入库，列表回退用原图渲染', async () => {
    ({ server, request, seed } = await startServer());
    const { map, place } = await seed();
    const up = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: png },
    });
    assert.equal(up.status, 201);
    const list = await (await request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).json();
    assert.match(list.photos[0].thumb, /^data:image\/png;base64,/);
  });

  it('缩略图超过 64KB 返回 400 且给出可读原因', async () => {
    ({ server, request, seed } = await startServer());
    const { map, place } = await seed();
    const bigThumb = `data:image/png;base64,${'A'.repeat(100 * 1024)}`;
    const res = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: png, thumb: bigThumb },
    });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /64KB/);
  });

  it('请求体超限返回 413（而不是 500）', async () => {
    ({ server, request, seed } = await startServer());
    const { map, place } = await seed();
    // 用 Buffer 转 base64：体积膨胀 4/3，full + thumb 合计约 3.6MB，确实超过 3mb 上限
    const image = `data:image/jpeg;base64,${Buffer.alloc(Math.floor(1.3 * 1024 * 1024)).toString('base64')}`;
    const res = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: image, thumb: image },
    });
    assert.equal(res.status, 413);
  });

  it(
    '并发上传不再突破 9 张上限（按 id 幂等裁剪）',
    { timeout: 20_000 },
    async () => {
      let seq = 0;
      const uploader = {
        configured: true,
        async upload() {
          const n = (seq += 1);
          return {
            publicId: `audit-${n}`,
            url: `https://cdn.example/${n}.png`,
            thumbUrl: `https://cdn.example/${n}-t.png`,
          };
        },
        async destroy() {},
      };
      ({ server, request, seed, store } = await startServer({ uploader }));
      const { map, place } = await seed();
      // 预置 8 张直接写库（避免与上传器交互），再并发发 2 个真实请求
      for (let i = 0; i < 8; i += 1) {
        await store.createPhoto({
          placeId: place.id,
          mapCode: map.code,
          mime: 'image/png',
          fullB64: 'A',
          thumbB64: 'A',
        });
      }
      const [a, b] = await Promise.all([
        request('POST', `/api/places/${place.id}/photos`, {
          body: { map_code: map.code, full: png, thumb: png },
        }),
        request('POST', `/api/places/${place.id}/photos`,
          { body: { map_code: map.code, full: png, thumb: png } }),
      ]);
      assert.deepEqual(
        [a.status, b.status].sort((x, y) => x - y),
        [201, 400],
        '并发超限时应恰好拒掉一张'
      );
      const list = await (
        await request('GET', `/api/places/${place.id}/photos?map=${map.code}`)
      ).json();
      assert.equal(list.photos.length, 9);
    }
  );
});

describe('数据一致性', () => {
  let server;
  let request;
  let store;
  let pool;
  beforeEach(async () => {
    ({ server, request, store, pool } = await startServer());
  });
  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('地点进回收站后原图立即不可读（缓存同步失效）', async () => {
    const { map, place } = await (async () => {
      const m = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const p = await (
        await request('POST', '/api/places', { body: { ...placeBody, map_code: m.code } })
      ).json();
      return { map: m, place: p };
    })();
    const photo = await (
      await request('POST', `/api/places/${place.id}/photos`, {
        body: { map_code: map.code, full: png, thumb: png },
      })
    ).json();
    const route = `/api/photos/${photo.id}?map=${map.code}`;
    assert.equal((await request('GET', route)).status, 200, '删除前应可读');
    await request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });
    assert.equal((await request('GET', route)).status, 404, '软删后应不可读');
  });

  it('换码会迁移行程与推送订阅，并让旧码照片失效', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'R' } })).json();
    const place = await (
      await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
    ).json();
    const photo = await (
      await request('POST', `/api/places/${place.id}/photos`, {
        body: { map_code: map.code, full: png, thumb: png },
      })
    ).json();
    await request('GET', `/api/photos/${photo.id}?map=${map.code}`); // 预热缓存
    await request('PUT', '/api/itinerary', { body: { map_code: map.code, place_ids: [place.id] } });
    await store.saveSubscription({
      mapCode: map.code,
      endpoint: 'https://push.example/x',
      p256dh: 'k',
      auth: 'a',
    });

    const changed = await (await request('POST', `/api/maps/${map.code}/rekey`, { body: {} })).json();

    const stops = await (await request('GET', `/api/itinerary?map=${changed.code}`)).json();
    assert.equal(stops.stops.length, 1, '行程应随码迁移');
    assert.equal((await store.listSubscriptions(changed.code)).length, 1, '订阅应随码迁移');
    assert.equal((await store.listSubscriptions(map.code)).length, 0);
    assert.equal(
      (await request('GET', `/api/photos/${photo.id}?map=${map.code}`)).status,
      404,
      '旧码不应再能读到照片'
    );
  });

  it('30 天内可恢复，超过 30 天不可恢复', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'T' } })).json();
    const place = await (
      await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
    ).json();

    await request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });
    const fresh = await request('POST', `/api/places/${place.id}/restore`, {
      body: { map_code: map.code },
    });
    assert.equal(fresh.status, 200, '刚删除的应可恢复');

    await request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });
    await pool.query('UPDATE public.places SET deleted_at = $1 WHERE id = $2', [
      new Date(Date.now() - 31 * 86400000),
      place.id,
    ]);
    const expired = await request('POST', `/api/places/${place.id}/restore`, {
      body: { map_code: map.code },
    });
    assert.equal(expired.status, 404, '超过 30 天不应可恢复');
  });

  it('坐标为 null / false 时返回 400（不再被静默转成 0）', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'C' } })).json();
    const res = await request('POST', '/api/places', {
      body: { ...placeBody, map_code: map.code, lng: null, lat: false },
    });
    assert.equal(res.status, 400);
  });

  it('公共广场单点接口：公开可读、不含 map_code；未公开 404；非法 id 400', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'P' } })).json();
    const place = await (
      await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
    ).json();
    assert.equal((await request('GET', `/api/public/places/${place.id}`)).status, 404, '未公开应 404');
    await request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } });
    const res = await request('GET', `/api/public/places/${place.id}`);
    assert.equal(res.status, 200);
    const { place: pub } = await res.json();
    assert.equal(pub.id, place.id);
    assert.equal(pub.is_public, true);
    assert.equal(Object.hasOwn(pub, 'map_code'), false, '不得泄露邀请码');
    assert.equal((await request('GET', '/api/public/places/abc')).status, 400);
  });

  it('导出包含行程单', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'E' } })).json();
    const place = await (
      await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
    ).json();
    await request('PUT', '/api/itinerary', { body: { map_code: map.code, place_ids: [place.id] } });
    const data = await (await request('GET', `/api/maps/${map.code}/export`)).json();
    assert.equal(Array.isArray(data.itinerary), true);
    assert.equal(data.itinerary.length, 1);
  });
});

describe('推送端点与退订鉴权', () => {
  let server;
  let request;
  beforeEach(async () => {
    ({ server, request } = await startServer());
  });
  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('退订必须提供有效邀请码', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'S' } })).json();
    const res = await request('DELETE', '/api/push/subscribe', {
      body: { endpoint: 'https://push.example/a' },
      mapCode: 'NOTAMAP',
    });
    assert.equal(res.status, 404);
  });

  it('拒绝内网 / 环回 / 非 https 的订阅端点', async () => {
    const map = await (await request('POST', '/api/maps', { body: { name: 'S2' } })).json();
    for (const endpoint of [
      'https://127.0.0.1:12345/internal',
      'https://10.0.0.5/hook',
      'http://push.example/insecure',
      'https://localhost/hook',
      'https://[::1]:8443/hook',
    ]) {
      const res = await request('POST', '/api/push/subscribe', {
        body: { map_code: map.code, subscription: { endpoint, keys: { p256dh: 'k', auth: 'a' } } },
      });
      assert.equal(res.status, 400, `${endpoint} 应被拒绝`);
    }
    const ok = await request('POST', '/api/push/subscribe', {
      body: {
        map_code: map.code,
        subscription: { endpoint: 'https://push.example/ok', keys: { p256dh: 'k', auth: 'a' } },
      },
    });
    assert.equal(ok.status, 201);
  });
});

describe('限流', () => {
  it('超过阈值返回 429 且带 Retry-After', async () => {
    let now = 0;
    const originalNow = Date.now;
    Date.now = () => now;
    try {
      const limiter = createRateLimiter({ max: 2, windowMs: 60_000 });
      const results = [];
      const res = {
        set() {},
        status(code) {
          results.push(code);
          return { json() {} };
        },
      };
      const req = { get: () => '1.2.3.4', socket: {} };
      limiter(req, res, () => results.push(200));
      limiter(req, res, () => results.push(200));
      limiter(req, res, () => results.push(200));
      assert.deepEqual(results, [200, 200, 429]);
      now += 60_001;
      limiter(req, res, () => results.push(200));
      assert.equal(results[3], 200, '窗口过后应恢复');
    } finally {
      Date.now = originalNow;
    }
  });

  it('建图接口真的挂了限流器', async () => {
    const { server, request } = await startServer();
    try {
      const statuses = [];
      for (let i = 0; i < 33; i += 1) {
        const res = await request('POST', '/api/maps', { body: { name: `M${i}` } });
        statuses.push(res.status);
      }
      assert.equal(statuses.filter((s) => s === 201).length, 30);
      assert.equal(statuses.filter((s) => s === 429).length, 3);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });
});

describe('进程健壮性', () => {
  it('鉴权中间件遇到数据库故障：写请求 503、读请求降级、进程不退出', () => {
    const childSource = `
      import { buildApp } from ${JSON.stringify(path.join(root, 'server/app.js'))};
      import { createAuth } from ${JSON.stringify(path.join(root, 'server/auth.js'))};
      const store = {
        async getUser() { throw new Error('Audit injected database outage'); },
        async getMapByCode() { return null; },
      };
      const auth = createAuth({ appid: 'a', secret: 'b', signSecret: 'audit-only', store });
      const server = buildApp({ store, auth }).listen(0, '127.0.0.1', async () => {
        const base = 'http://127.0.0.1:' + server.address().port;
        const token = auth.signToken('audit-user');
        const written = await fetch(base + '/api/places/1', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
          body: JSON.stringify({ name: 'x' }),
        });
        const read = await fetch(base + '/api/maps/ANY', { headers: { authorization: 'Bearer ' + token } });
        console.log(JSON.stringify({ write: written.status, read: read.status }));
        server.closeAllConnections();
        server.close();
      });
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], {
      encoding: 'utf8',
      timeout: 8000,
    });
    assert.equal(child.status, 0, `子进程应正常退出，实际 ${child.status}：${child.stderr}`);
    const payload = JSON.parse(child.stdout.trim().split('\n').pop());
    assert.equal(payload.write, 503, '写请求应回 503 而不是崩溃');
    assert.equal(payload.read, 404, '读请求应按匿名降级');
  });
});

describe('内容安全（UGC 文本检测）', () => {

  function makeSecurity({ risky = false, fail = false } = {}) {
    const calls = { token: 0, check: 0, contents: [] };
    const fetchImpl = async (url, init) => {
      if (String(url).includes('stable_token')) {
        calls.token += 1;
        return { json: async () => ({ access_token: 'tk-1', expires_in: 7200 }) };
      }
      calls.check += 1;
      const body = JSON.parse(init.body);
      calls.contents.push(body.content);
      if (fail) throw new Error('微信接口不可用');
      if (risky) return { json: async () => ({ errcode: 87014, errmsg: 'risky content' }) };
      return { json: async () => ({ errcode: 0, result: { suggest: 'pass', label: 100 } }) };
    };
    const security = createContentSecurity({
      appid: 'wx-test',
      secret: 'secret',
      fetchImpl,
      logger: { warn() {} },
    });
    return { security, calls };
  }

  it('检测通过：写地点/留言/昵称正常，token 只取一次', async () => {
    const { security, calls } = makeSecurity();
    const { server, request } = await startServer({ contentSecurity: security });
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await request('POST', '/api/places', {
        body: { ...placeBody, description: '很好吃', map_code: map.code },
      });
      const placeId = (await place.json()).id;
      const comment = await request('POST', `/api/places/${placeId}/comments`, {
        body: { map_code: map.code, body: '打卡' },
      });
      assert.equal(place.status, 201);
      assert.equal(comment.status, 201);
      assert.ok(calls.check >= 2, '名称/描述/留言都应被检测');
      assert.equal(calls.token, 1, 'access_token 必须复用缓存');
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('检测命中违规：写地点与留言返回 400 且不入库', async () => {
    const { security } = makeSecurity({ risky: true });
    const { server, request } = await startServer({ contentSecurity: security });
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await request('POST', '/api/places', {
        body: { ...placeBody, name: '违规内容', map_code: map.code },
      });
      assert.equal(place.status, 400);
      assert.match((await place.json()).error, /不适宜内容/);
      const list = await (await request('GET', `/api/places?map=${map.code}`)).json();
      assert.equal(list.places.length, 0, '违规内容不得入库');
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('检测接口故障时按放行处理（可用性优先），不阻断写入', async () => {
    const { security } = makeSecurity({ fail: true });
    const { server, request } = await startServer({ contentSecurity: security });
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } });
      assert.equal(place.status, 201);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('未配置 AppID/Secret 时完全停用（不产生任何外部请求）', async () => {
    const calls = { token: 0, check: 0 };
    const security = createContentSecurity({
      appid: '',
      secret: '',
      fetchImpl: async () => {
        calls.token += 1;
        return { json: async () => ({}) };
      },
      logger: { warn() {} },
    });
    assert.equal(security.configured, false);
    const { server, request } = await startServer({ contentSecurity: security });
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } });
      assert.equal(place.status, 201);
      assert.equal(calls.token + calls.check, 0);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });
});

describe('内容举报（UGC 处置入口）', () => {

  it('公开内容可无邀请码举报；私有内容需邀请码；错码 404', async () => {
    const { server, request } = await startServer();
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await (
        await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
      ).json();

      // 未公开 + 无邀请码 → 404（不能拿 id 探测私有内容）
      const probing = await request('POST', '/api/reports', {
        body: { target_type: 'place', target_id: place.id, reason: '不实信息' },
      });
      assert.equal(probing.status, 404);

      // 公开后可以匿名举报
      await request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } });
      const pub = await request('POST', '/api/reports', {
        body: { target_type: 'place', target_id: place.id, reason: '不实信息', reporter: '路人' },
      });
      assert.equal(pub.status, 201);

      // 带错码 → 404
      const wrong = await request('POST', '/api/reports', {
        body: { target_type: 'place', target_id: place.id, reason: '不实信息', map_code: 'WRONG1' },
      });
      assert.equal(wrong.status, 404);

      // 地图内（带正确码）可举报未公开内容
      await request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } });
      const inMap = await request('POST', '/api/reports', {
        body: { target_type: 'place', target_id: place.id, reason: '侵权', map_code: map.code },
      });
      assert.equal(inMap.status, 201);

      // 缺少原因 → 400
      const noReason = await request('POST', '/api/reports', {
        body: { target_type: 'place', target_id: place.id },
      });
      assert.equal(noReason.status, 400);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('owner 凭邀请码查看待处理举报并结单', async () => {
    const { server, request } = await startServer();
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await (
        await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
      ).json();
      const created = await (
        await request('POST', '/api/reports', {
          body: { target_type: 'place', target_id: place.id, reason: '广告', map_code: map.code },
        })
      ).json();

      const wrong = await request('GET', '/api/reports?map=WRONG1');
      assert.equal(wrong.status, 404);

      const list = await (await request('GET', `/api/reports?map=${map.code}`)).json();
      assert.equal(list.reports.length, 1);
      assert.equal(list.reports[0].reason, '广告');

      const resolved = await request('POST', `/api/reports/${created.id}/resolve`, {
        body: { map_code: map.code },
      });
      assert.equal(resolved.status, 200);
      const after = await (await request('GET', `/api/reports?map=${map.code}`)).json();
      assert.equal(after.reports.length, 0);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('举报有独立限流（10 分钟 10 次）', async () => {
    const { server, request } = await startServer();
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await (
        await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
      ).json();
      const statuses = [];
      for (let i = 0; i < 12; i += 1) {
        const res = await request('POST', '/api/reports', {
          body: { target_type: 'place', target_id: place.id, reason: '刷举报', map_code: map.code },
        });
        statuses.push(res.status);
      }
      assert.equal(statuses.filter((s) => s === 201).length, 10);
      assert.equal(statuses.filter((s) => s === 429).length, 2);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('图片异步审核：上传送审 + 回调标记违规后列表自动隐藏', async () => {
    const msgToken = 'test-msg-token';
    const fetchImpl = async (url) => {
      if (String(url).includes('stable_token')) {
        return { json: async () => ({ access_token: 'tk', expires_in: 7200 }) };
      }
      if (String(url).includes('media_check_async')) {
        return { json: async () => ({ errcode: 0, trace_id: 'trace-abc' }) };
      }
      return { json: async () => ({ errcode: 0, result: { suggest: 'pass' } }) };
    };
    const security = createContentSecurity({ appid: 'wx', secret: 's', msgToken, fetchImpl, logger: { warn() {} } });
    assert.equal(security.mediaCheckEnabled, true);

    const uploader = {
      configured: true,
      async upload() {
        return { publicId: 'p1', url: 'https://cdn.example/1.jpg', thumbUrl: 'https://cdn.example/1t.jpg' };
      },
      async destroy() {},
    };
    const { server, request } = await startServer({ uploader, contentSecurity: security });
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await (
        await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
      ).json();
      const up = await request('POST', `/api/places/${place.id}/photos`, {
        body: { map_code: map.code, full: png },
      });
      assert.equal(up.status, 201);
      let list = await (await request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).json();
      assert.equal(list.photos.length, 1, '审核中仍可见（先发后审）');

      const timestamp = '1700000000';
      const nonce = 'abc123';
      const signature = createHash('sha1')
        .update([msgToken, timestamp, nonce].sort().join(''))
        .digest('hex');
      const bad = await request(
        'POST',
        `/api/wechat/media-check-callback?signature=deadbeef&timestamp=${timestamp}&nonce=${nonce}`,
        { body: { trace_id: 'trace-abc', result: { suggest: 'risky' } } }
      );
      assert.equal(bad.status, 403, '签名不符必须拒绝');

      const ok = await request(
        'POST',
        `/api/wechat/media-check-callback?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
        { body: { trace_id: 'trace-abc', result: { suggest: 'risky', label: 20001 } } }
      );
      assert.equal(ok.status, 200);

      list = await (await request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).json();
      assert.equal(list.photos.length, 0, '判违规后应从列表隐藏');
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });

  it('未配置 WECHAT_MSG_TOKEN 时不送图片审核', async () => {
    let mediaCalls = 0;
    const fetchImpl = async (url) => {
      if (String(url).includes('media_check_async')) mediaCalls += 1;
      return { json: async () => ({ access_token: 'tk', errcode: 0, trace_id: 'x' }) };
    };
    const security = createContentSecurity({ appid: 'wx', secret: 's', fetchImpl, logger: { warn() {} } });
    assert.equal(security.mediaCheckEnabled, false);
    const uploader = {
      configured: true,
      async upload() {
        return { publicId: 'p', url: 'https://cdn.example/1.jpg', thumbUrl: 'https://cdn.example/1t.jpg' };
      },
      async destroy() {},
    };
    const { server, request } = await startServer({ uploader, contentSecurity: security });
    try {
      const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
      const place = await (
        await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
      ).json();
      await request('POST', `/api/places/${place.id}/photos`, {
        body: { map_code: map.code, full: png },
      });
      assert.equal(mediaCalls, 0);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });
});

describe('照片缓存按字节计容', () => {
  it('超过上限时淘汰最旧条目，占用不会无限增长', async () => {
    const previous = process.env.PHOTO_CACHE_MAX_BYTES;
    process.env.PHOTO_CACHE_MAX_BYTES = '1024';
    try {
      const { server, request, store } = await startServer();
      try {
        const map = await (await request('POST', '/api/maps', { body: { name: 'M' } })).json();
        const place = await (
          await request('POST', '/api/places', { body: { ...placeBody, map_code: map.code } })
        ).json();
        // 每张解码后约 900B，3 张必然超过 1KB 上限
        const big = `data:image/png;base64,${'A'.repeat(1200)}`;
        const ids = [];
        for (let i = 0; i < 3; i += 1) {
          const up = await request('POST', `/api/places/${place.id}/photos`, {
            body: { map_code: map.code, full: big, thumb: big },
          });
          assert.equal(up.status, 201);
          ids.push((await up.json()).id);
        }
        for (const id of ids) {
          const res = await request('GET', `/api/photos/${id}?map=${map.code}`);
          assert.equal(res.status, 200, '被淘汰后仍应能从数据库回源');
        }
        const stats = store.__photoCacheStats();
        assert.ok(stats.bytes <= 1024, `缓存占用应受上限约束，实际 ${stats.bytes}`);
        assert.ok(stats.size < 3, `应发生淘汰，实际保留 ${stats.size} 条`);
      } finally {
        server.closeAllConnections();
        await server.close();
      }
    } finally {
      if (previous === undefined) delete process.env.PHOTO_CACHE_MAX_BYTES;
      else process.env.PHOTO_CACHE_MAX_BYTES = previous;
    }
  });
});
