import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';

async function startServer() {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const app = buildApp({
    store,
    mapConfig: { key: 'test-key', securityJsCode: 'test-jscode' },
  });
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
  return { server, request };
}

const validPlace = {
  name: '武康路',
  description: '梧桐区 citywalk',
  category: '景点',
  lng: 121.4375,
  lat: 31.2054,
  address: '上海市徐汇区武康路',
  added_by: '小明',
};

async function createMap(request, name = '周末 citywalk') {
  const res = await request('POST', '/api/maps', { body: { name, createdBy: '小明' } });
  assert.equal(res.status, 201);
  return res.json();
}

describe('maps & places API', () => {
  let server;
  let request;

  beforeEach(async () => {
    ({ server, request } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('GET /api/health 返回 ok', async () => {
    const res = await request('GET', '/api/health');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  it('POST /api/maps 创建地图并返回邀请码', async () => {
    const map = await createMap(request, '毕业旅行');
    assert.match(map.code, /^[A-Z2-9]{6}$/);
    assert.equal(map.name, '毕业旅行');
    assert.equal(map.created_by, '小明');
  });

  it('GET /api/maps/:code 不存在返回 404', async () => {
    const res = await request('GET', '/api/maps/NOPE00');
    assert.equal(res.status, 404);
  });

  it('GET /api/places 缺少 map 参数返回 400', async () => {
    const res = await request('GET', '/api/places');
    assert.equal(res.status, 400);
  });

  it('GET /api/places 邀请码无效返回 404', async () => {
    const res = await request('GET', '/api/places?map=NOPE00');
    assert.equal(res.status, 404);
  });

  it('POST /api/places 带有效邀请码创建地点', async () => {
    const map = await createMap(request);
    const res = await request('POST', '/api/places', {
      body: { ...validPlace, map_code: map.code },
    });
    assert.equal(res.status, 201);
    const place = await res.json();
    assert.equal(place.name, '武康路');
    assert.equal(typeof place.id, 'number');
  });

  it('POST /api/places 邀请码无效返回 404', async () => {
    const res = await request('POST', '/api/places', {
      body: { ...validPlace, map_code: 'NOPE00' },
    });
    assert.equal(res.status, 404);
  });

  it('两张地图的地点相互隔离', async () => {
    const mapA = await createMap(request, '地图A');
    const mapB = await createMap(request, '地图B');
    await request('POST', '/api/places', { body: { ...validPlace, map_code: mapA.code } });
    await request('POST', '/api/places', {
      body: { ...validPlace, name: '外滩源', map_code: mapB.code },
    });

    const listA = await (await request('GET', `/api/places?map=${mapA.code}`)).json();
    const listB = await (await request('GET', `/api/places?map=${mapB.code}`)).json();
    assert.equal(listA.places.length, 1);
    assert.equal(listA.places[0].name, '武康路');
    assert.equal(listB.places.length, 1);
    assert.equal(listB.places[0].name, '外滩源');
  });

  it('PUT 缺少邀请码头返回 400，错误邀请码返回 404，正确邀请码更新成功', async () => {
    const map = await createMap(request);
    const created = await (
      await request('POST', '/api/places', { body: { ...validPlace, map_code: map.code } })
    ).json();

    const missing = await request('PUT', `/api/places/${created.id}`, {
      body: { visited: true },
    });
    assert.equal(missing.status, 400);

    const wrong = await request('PUT', `/api/places/${created.id}`, {
      body: { visited: true },
      mapCode: 'ZZZZZ9',
    });
    assert.equal(wrong.status, 404);

    const ok = await request('PUT', `/api/places/${created.id}`, {
      body: { visited: true, description: '去过了' },
      mapCode: map.code,
    });
    assert.equal(ok.status, 200);
    const place = await ok.json();
    assert.equal(place.visited, true);
    assert.equal(place.description, '去过了');
  });

  it('DELETE 错误邀请码 404，正确邀请码删除后再删 404', async () => {
    const map = await createMap(request);
    const created = await (
      await request('POST', '/api/places', { body: { ...validPlace, map_code: map.code } })
    ).json();

    const wrong = await request('DELETE', `/api/places/${created.id}`, { mapCode: 'ZZZZZ9' });
    assert.equal(wrong.status, 404);

    const ok = await request('DELETE', `/api/places/${created.id}`, { mapCode: map.code });
    assert.equal(ok.status, 204);

    const again = await request('DELETE', `/api/places/${created.id}`, { mapCode: map.code });
    assert.equal(again.status, 404);
  });

  it('非法输入仍返回 400（分类/名称/坐标）', async () => {
    const map = await createMap(request);
    const badCategory = await request('POST', '/api/places', {
      body: { ...validPlace, map_code: map.code, category: '不存在' },
    });
    assert.equal(badCategory.status, 400);

    const noName = await request('POST', '/api/places', {
      body: { ...validPlace, name: '', map_code: map.code },
    });
    assert.equal(noName.status, 400);

    const badCoord = await request('POST', '/api/places', {
      body: { ...validPlace, lat: 95, map_code: map.code },
    });
    assert.equal(badCoord.status, 400);
  });

  it('GET /api/map-config 返回高德配置', async () => {
    const res = await request('GET', '/api/map-config');
    assert.equal(res.status, 200);
    assert.equal((await res.json()).key, 'test-key');
  });

  it('未知 /api 路径返回 404 与 JSON 错误', async () => {
    const res = await request('GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.ok((await res.json()).error);
  });
});
