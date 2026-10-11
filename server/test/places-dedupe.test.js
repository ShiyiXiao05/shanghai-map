// 加地点的去重契约：同名（忽略大小写/首尾空格）或坐标大约 60 米内视为重复 → 409。
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';

let server;
let request;
let del;

beforeEach(async () => {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const app = buildApp({ store, mapConfig: { key: 'k' } });
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  request = (method, path, body) =>
    fetch(base + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  // 删除地点：邀请码走 x-map-code 头（与 /api/places 的 requireMapCode 契约一致）
  del = (path, mapCode) => fetch(base + path, { method: 'DELETE', headers: { 'x-map-code': mapCode } });
});

afterEach(async () => {
  server.closeAllConnections();
  await server.close();
});

async function newMap(name = '去重图') {
  return (await (await request('POST', '/api/maps', { name })).json()).code;
}

function placeBody(code, overrides = {}) {
  return {
    map_code: code,
    name: '武康大楼',
    category: '景点',
    lng: 121.4375,
    lat: 31.2054,
    ...overrides,
  };
}

describe('加地点去重', () => {
  it('同名（忽略大小写与首尾空格）→ 409 且带上已有地点信息', async () => {
    const code = await newMap();
    const first = await (await request('POST', '/api/places', placeBody(code))).json();
    assert.ok(first.id, '第一条应创建成功');

    const dup = await request('POST', '/api/places', placeBody(code, { name: '  武康大楼  ', lng: 121.5, lat: 31.3 }));
    assert.equal(dup.status, 409);
    const body = await dup.json();
    assert.equal(body.code, 'DUPLICATE_PLACE');
    assert.equal(body.duplicate.id, first.id);
    assert.match(body.error, /武康大楼/);

    const list = await (await request('GET', `/api/places?map=${code}`)).json();
    assert.equal(list.places.length, 1, '重复的没有被写入');
  });

  it('名字不同、坐标很近 → 允许（真实数据里这是两个地方，例如「武康大楼」与「酷矿冰淇淋(武康大楼店)」）', async () => {
    const code = await newMap();
    await request('POST', '/api/places', placeBody(code));
    const ok = await request('POST', '/api/places', placeBody(code, { name: '酷矿冰淇淋(武康大楼店)', lat: 31.2057 }));
    assert.equal(ok.status, 201);
  });

  it('同名但坐标很远 → 仍视为重复（同一张地图里同名就是重复）', async () => {
    const code = await newMap();
    await request('POST', '/api/places', placeBody(code));
    const dup = await request('POST', '/api/places', placeBody(code, { lng: 121.9, lat: 31.6 }));
    assert.equal(dup.status, 409);
  });

  it('名字不同且坐标相距较远 → 正常创建', async () => {
    const code = await newMap();
    await request('POST', '/api/places', placeBody(code));
    const ok = await request('POST', '/api/places', placeBody(code, { name: '外滩', lng: 121.4921, lat: 31.2335 }));
    assert.equal(ok.status, 201);
    const list = await (await request('GET', `/api/places?map=${code}`)).json();
    assert.equal(list.places.length, 2);
  });

  it('去重检查自身出错时不挡添加（按不重复处理）', async () => {
    const db = newDb();
    const pgLib = db.adapters.createPg();
    const pool = new pgLib.Pool();
    const store = createPlaceStore(pool);
    await store.init();
    const app = buildApp({ store, mapConfig: { key: 'k' } });
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((resolve) => srv.once('listening', resolve));
    const base = `http://127.0.0.1:${srv.address().port}`;
    const call = (method, path, body) =>
      fetch(base + path, {
        method,
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    const warns = [];
    const original = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      const code = (await (await call('POST', '/api/maps', { name: '容错图' })).json()).code;
      store.findDuplicatePlace = async () => {
        throw new Error('模拟去重查询失败');
      };
      const res = await call('POST', '/api/places', placeBody(code));
      assert.equal(res.status, 201, '去重失败不应影响添加');
      assert.match(warns.join('\n'), /去重检查失败/);
    } finally {
      console.warn = original;
      srv.closeAllConnections();
      await srv.close();
    }
  });

  it('不同地图之间互不影响', async () => {
    const a = await newMap('图A');
    const b = await newMap('图B');
    await request('POST', '/api/places', placeBody(a));
    const res = await request('POST', '/api/places', placeBody(b));
    assert.equal(res.status, 201);
  });

  it('已删（回收站）的同名地点不算重复，但会在重复时给出提示', async () => {
    const code = await newMap();
    const first = await (await request('POST', '/api/places', placeBody(code))).json();
    // 软删除后应该可以重新添加
    const removed = await del(`/api/places/${first.id}`, code);
    assert.equal(removed.status, 204, '软删除应成功');
    const again = await request('POST', '/api/places', placeBody(code, { lng: 121.6, lat: 31.4 }));
    assert.equal(again.status, 201, '回收站里的不算重复');

    // 再建一条同名的活跃地点 → 409，并提示回收站里也有
    const dup = await request('POST', '/api/places', placeBody(code, { name: '武康大楼', lng: 121.7, lat: 31.5 }));
    assert.equal(dup.status, 409);
    const body = await dup.json();
    assert.ok(body.trashed, '应带回收站同名条目');
    assert.equal(body.trashed.id, first.id);
  });
});
