import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';
import { createPusher } from '../pusher.js';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function startServer({ withKeys = true } = {}) {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const pusher = createPusher(
    withKeys
      ? {
          // 格式合法的密钥对（私钥须为 32 字节 base64url）；notifyMap 随后被 spy 替换，不会真发
          publicKey: 'BJHtH1eKSvcsmLQnRZZ9jL0VSK10q8h_HxY5xCcJzuKWg2k3xjfHkfV9tM168TusQGi7fOspHibgOfMtTxu10gI',
          privateKey: '1c89_83gVtJtjCg4WWUXck277I8Rvx0ATa0teVpxFj8',
          subject: 'mailto:test@localhost',
          store,
        }
      : { store }
  );
  // 用 spy 替换真实发送：模拟「有订阅者才广播」的真实语义，记录发出的 payload
  const sent = [];
  pusher.notifyMap = async (mapCode, payload) => {
    const subs = await store.listSubscriptions(mapCode);
    if (subs.length > 0) sent.push({ mapCode, payload, count: subs.length });
  };
  const app = buildApp({ store, mapConfig: { key: 'k', securityJsCode: '' }, pusher });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, path, { body, mapCode } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(mapCode !== undefined ? { 'x-map-code': mapCode } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  return { server, request, sent, pool };
}

const sub = (n) => ({
  endpoint: `https://push.example/endpoint-${n}`,
  keys: { p256dh: 'key-p256dh', auth: 'key-auth' },
});

describe('web push subscriptions', () => {
  let server;
  let request;
  let sent;

  beforeEach(async () => {
    ({ server, request, sent } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('GET /api/push/key 返回公钥', async () => {
    const res = await request('GET', '/api/push/key');
    assert.equal(res.status, 200);
    assert.ok((await res.json()).publicKey.length > 80);
  });

  it('订阅入库、重复订阅 upsert 不重复', async () => {
    const code = (await (await request('POST', '/api/maps', { body: { name: '通知图', createdBy: 'x' } })).json()).code;
    const s = sub(1);
    const r1 = await request('POST', '/api/push/subscribe', {
      body: { map_code: code, subscription: s, who: '小明' },
    });
    assert.equal(r1.status, 201);
    const r2 = await request('POST', '/api/push/subscribe', {
      body: { map_code: code, subscription: s, who: '小明' },
    });
    assert.equal(r2.status, 201);

    // 新地点 → 通知已触发一次
    await request('POST', '/api/places', {
      body: { map_code: code, name: '通知测试点', category: '美食', lng: 121.4, lat: 31.2, added_by: '小红' },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].mapCode, code);
    assert.ok(sent[0].payload.body.includes('通知测试点'));
  });

  it('留言/照片也触发通知；退订后不再收到', async () => {
    const code = (await (await request('POST', '/api/maps', { body: { name: '通知图2', createdBy: 'x' } })).json()).code;
    const place = await (
      await request('POST', '/api/places', {
        body: { map_code: code, name: 'A', category: '美食', lng: 121.4, lat: 31.2, added_by: 'x' },
      })
    ).json();
    await request('POST', '/api/push/subscribe', {
      body: { map_code: code, subscription: sub(2), who: '小明' },
    });
    sent.length = 0;

    await request('POST', `/api/places/${place.id}/comments`, {
      body: { map_code: code, body: '走起', author: '小红' },
    });
    await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: code, full: png, thumb: png, added_by: '小红' },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sent.length, 2);

    // 退订
    const del = await request('DELETE', '/api/push/subscribe', {
      mapCode: code,
      body: { endpoint: sub(2).endpoint },
    });
    assert.equal(del.status, 204);
    sent.length = 0;
    await request('POST', '/api/places', {
      body: { map_code: code, name: 'B', category: '美食', lng: 121.4, lat: 31.2, added_by: 'x' },
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(sent.length, 0);
  });

  it('非法订阅 400、错码 404', async () => {
    const res = await request('POST', '/api/push/subscribe', {
      body: { map_code: 'NOPE00', subscription: sub(3) },
    });
    assert.equal(res.status, 404);
    const bad = await request('POST', '/api/push/subscribe', {
      body: { map_code: 'XXXXXX', subscription: { endpoint: 'nope' } },
    });
    assert.ok(bad.status === 400 || bad.status === 404);
  });
});

describe('web push disabled without keys', () => {
  it('GET /api/push/key 503', async () => {
    const { server, request } = await startServer({ withKeys: false });
    try {
      assert.equal((await request('GET', '/api/push/key')).status, 503);
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });
});
