import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';
import { createAuth } from '../auth.js';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function startServer({ configured = true } = {}) {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const auth = createAuth({
    appid: configured ? 'wx-test-appid' : '',
    secret: configured ? 'wx-test-secret' : '',
    signSecret: 'test-sign-secret',
    store,
    // 不真调微信接口：code 即测试身份（openid-<code>），bad-code 模拟 code2Session 失败
    fetchSession: async (code) => {
      if (code === 'bad-code') {
        const err = new Error('invalid code');
        err.status = 502;
        throw err;
      }
      return { openid: `openid-${code}` };
    },
  });
  const app = buildApp({ store, mapConfig: { key: 'k', securityJsCode: '' }, auth });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, path, { body, mapCode, token } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(mapCode !== undefined ? { 'x-map-code': mapCode } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return { server, request };
}

async function loginAs(request, code, nickname) {
  const { token } = await (
    await request('POST', '/api/auth/login', { body: { code } })
  ).json();
  if (nickname) {
    const res = await request('POST', '/api/auth/profile', { body: { nickname }, token });
    assert.equal(res.status, 200, '设置昵称失败');
  }
  return token;
}

describe('miniprogram auth', () => {
  let server;
  let request;

  beforeEach(async () => {
    ({ server, request } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('未配置 AppID/Secret 时登录 503', async () => {
    const { server: s, request: req } = await startServer({ configured: false });
    try {
      assert.equal((await req('POST', '/api/auth/login', { body: { code: 'u1' } })).status, 503);
    } finally {
      s.closeAllConnections();
      await s.close();
    }
  });

  it('登录签发 token；首次 needs_nickname；坏 code 502、缺 code 400', async () => {
    assert.equal((await request('POST', '/api/auth/login', { body: {} })).status, 400);
    assert.equal(
      (await request('POST', '/api/auth/login', { body: { code: 'bad-code' } })).status,
      502
    );
    const res = await request('POST', '/api/auth/login', { body: { code: 'u1' } });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.ok(data.token.length > 20);
    assert.equal(data.nickname, '');
    assert.equal(data.needs_nickname, true);

    // 设昵称后再次登录：昵称带回、不再要求补填
    await request('POST', '/api/auth/profile', { body: { nickname: '小明' }, token: data.token });
    const again = await (await request('POST', '/api/auth/login', { body: { code: 'u1' } })).json();
    assert.equal(again.nickname, '小明');
    assert.equal(again.needs_nickname, false);
  });

  it('profile：未登录 401，空昵称 400，超长 400', async () => {
    assert.equal(
      (await request('POST', '/api/auth/profile', { body: { nickname: '小明' } })).status,
      401
    );
    const token = await loginAs(request, 'u1');
    assert.equal(
      (await request('POST', '/api/auth/profile', { body: { nickname: '  ' }, token })).status,
      400
    );
    assert.equal(
      (
        await request('POST', '/api/auth/profile', {
          body: { nickname: 'a'.repeat(31) },
          token,
        })
      ).status,
      400
    );
  });

  it('登录身份盖章：建图/加地点/想去/留言/照片的署名一律用服务端昵称', async () => {
    const token = await loginAs(request, 'u1', '小明');
    const map = await (
      await request('POST', '/api/maps', { body: { name: '盖章图', createdBy: '冒名的' }, token })
    ).json();
    assert.equal(map.created_by, '小明');

    const place = await (
      await request('POST', '/api/places', {
        body: {
          map_code: map.code,
          name: '盖章点',
          category: '美食',
          lng: 121.4,
          lat: 31.2,
          added_by: '冒名的',
        },
        token,
      })
    ).json();
    assert.equal(place.added_by, '小明');

    const wish = await (
      await request('POST', `/api/places/${place.id}/wish`, {
        body: { map_code: map.code, who: '冒名的' },
        token,
      })
    ).json();
    assert.deepEqual(wish.wishes, ['小明']);

    const comment = await (
      await request('POST', `/api/places/${place.id}/comments`, {
        body: { map_code: map.code, body: '走起', author: '冒名的' },
        token,
      })
    ).json();
    assert.equal(comment.author, '小明');

    await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: png, thumb: png, added_by: '冒名的' },
      token,
    });
    const photos = await (
      await request('GET', `/api/places/${place.id}/photos?map=${map.code}`)
    ).json();
    assert.equal(photos.photos[0].added_by, '小明');
  });

  it('登录但未设昵称：需要署名的写操作 400 NEED_NICKNAME；打卡/编辑不受影响且改不了原作者', async () => {
    const tokenWithNick = await loginAs(request, 'u1', '小明');
    const map = await (
      await request('POST', '/api/maps', { body: { name: '昵称图' }, token: tokenWithNick })
    ).json();
    const place = await (
      await request('POST', '/api/places', {
        body: { map_code: map.code, name: '原始点', category: '景点', lng: 121.4, lat: 31.2 },
        token: tokenWithNick,
      })
    ).json();

    const tokenNoNick = await loginAs(request, 'u2');
    const blocked = await request('POST', '/api/places', {
      body: { map_code: map.code, name: '会被拦', category: '景点', lng: 121.4, lat: 31.2 },
      token: tokenNoNick,
    });
    assert.equal(blocked.status, 400);
    assert.equal((await blocked.json()).code, 'NEED_NICKNAME');

    // 打卡与编辑不需要署名，正常可用
    const visited = await request('PUT', `/api/places/${place.id}`, {
      body: { visited: true },
      mapCode: map.code,
      token: tokenNoNick,
    });
    assert.equal(visited.status, 200);

    // 编辑时带 added_by 也不能改原作者
    const edited = await request('PUT', `/api/places/${place.id}`, {
      body: { name: '改名点', added_by: '冒名的' },
      mapCode: map.code,
      token: tokenNoNick,
    });
    assert.equal((await edited.json()).added_by, '小明');
  });

  it('篡改 token：写操作 401，读请求视为匿名不受影响', async () => {
    const token = await loginAs(request, 'u1', '小明');
    const map = await (
      await request('POST', '/api/maps', { body: { name: '验签图' }, token })
    ).json();
    const badToken = token.slice(0, -4) + 'AAAA';

    const write = await request('POST', '/api/places', {
      body: { map_code: map.code, name: 'X', category: '景点', lng: 121.4, lat: 31.2 },
      token: badToken,
    });
    assert.equal(write.status, 401);

    const read = await request('GET', `/api/places?map=${map.code}`, { token: badToken });
    assert.equal(read.status, 200);

    // 未带 token 的网页端请求行为不变（客户端昵称照收）
    const webPlace = await request('POST', '/api/places', {
      body: { map_code: map.code, name: '网页点', category: '景点', lng: 121.4, lat: 31.2, added_by: '网页同学' },
    });
    assert.equal((await webPlace.json()).added_by, '网页同学');
  });
});
