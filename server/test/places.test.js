import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';

const ACCESS_CODE = 'test-secret';

async function startServer() {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const app = buildApp({
    store,
    accessCode: ACCESS_CODE,
    mapConfig: { key: 'test-key', securityJsCode: 'test-jscode' },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, path, { body, code } = {}) =>
    fetch(base + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(code !== undefined ? { 'x-access-code': code } : {}),
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

describe('places API', () => {
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

  it('GET /api/places 初始为空列表', async () => {
    const res = await request('GET', '/api/places');
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).places, []);
  });

  it('POST /api/places 缺少口令返回 401', async () => {
    const res = await request('POST', '/api/places', { body: validPlace });
    assert.equal(res.status, 401);
  });

  it('POST /api/places 错误口令返回 401', async () => {
    const res = await request('POST', '/api/places', { body: validPlace, code: 'wrong' });
    assert.equal(res.status, 401);
  });

  it('POST /api/places 正确口令创建地点，返回 201 与完整记录', async () => {
    const res = await request('POST', '/api/places', { body: validPlace, code: ACCESS_CODE });
    assert.equal(res.status, 201);
    const place = await res.json();
    assert.equal(typeof place.id, 'number');
    assert.equal(place.name, '武康路');
    assert.equal(place.category, '景点');
    assert.equal(place.visited, false);
    assert.ok(place.created_at);
  });

  it('POST /api/places 非法分类返回 400', async () => {
    const res = await request('POST', '/api/places', {
      body: { ...validPlace, category: '不存在' },
      code: ACCESS_CODE,
    });
    assert.equal(res.status, 400);
  });

  it('POST /api/places 缺少名称返回 400', async () => {
    const body = { ...validPlace };
    delete body.name;
    const res = await request('POST', '/api/places', { body, code: ACCESS_CODE });
    assert.equal(res.status, 400);
  });

  it('POST /api/places 坐标越界返回 400', async () => {
    const res = await request('POST', '/api/places', {
      body: { ...validPlace, lat: 95 },
      code: ACCESS_CODE,
    });
    assert.equal(res.status, 400);
  });

  it('POST /api/places 经度非数字返回 400', async () => {
    const res = await request('POST', '/api/places', {
      body: { ...validPlace, lng: 'abc' },
      code: ACCESS_CODE,
    });
    assert.equal(res.status, 400);
  });

  it('GET /api/places 返回已创建的地点', async () => {
    await request('POST', '/api/places', { body: validPlace, code: ACCESS_CODE });
    const res = await request('GET', '/api/places');
    const { places } = await res.json();
    assert.equal(places.length, 1);
    assert.equal(places[0].name, '武康路');
  });

  it('PUT /api/places/:id 修改描述并打卡', async () => {
    const created = await (
      await request('POST', '/api/places', { body: validPlace, code: ACCESS_CODE })
    ).json();
    const res = await request('PUT', `/api/places/${created.id}`, {
      body: { description: '去过了，很舒服', visited: true },
      code: ACCESS_CODE,
    });
    assert.equal(res.status, 200);
    const place = await res.json();
    assert.equal(place.description, '去过了，很舒服');
    assert.equal(place.visited, true);
    assert.equal(place.name, '武康路');
  });

  it('PUT /api/places/:id 不存在返回 404', async () => {
    const res = await request('PUT', '/api/places/99999', {
      body: { visited: true },
      code: ACCESS_CODE,
    });
    assert.equal(res.status, 404);
  });

  it('PUT /api/places/:id 没有可更新字段返回 400', async () => {
    const res = await request('PUT', '/api/places/1', { body: {}, code: ACCESS_CODE });
    assert.equal(res.status, 400);
  });

  it('PUT /api/places/:id 缺少口令返回 401', async () => {
    const res = await request('PUT', '/api/places/1', { body: { visited: true } });
    assert.equal(res.status, 401);
  });

  it('DELETE /api/places/:id 缺少口令返回 401', async () => {
    const res = await request('DELETE', '/api/places/1');
    assert.equal(res.status, 401);
  });

  it('DELETE /api/places/:id 正确口令删除，再删返回 404', async () => {
    const created = await (
      await request('POST', '/api/places', { body: validPlace, code: ACCESS_CODE })
    ).json();
    const res = await request('DELETE', `/api/places/${created.id}`, { code: ACCESS_CODE });
    assert.equal(res.status, 204);
    const again = await request('DELETE', `/api/places/${created.id}`, { code: ACCESS_CODE });
    assert.equal(again.status, 404);
  });

  it('GET /api/map-config 返回高德配置', async () => {
    const res = await request('GET', '/api/map-config');
    assert.equal(res.status, 200);
    const config = await res.json();
    assert.equal(config.key, 'test-key');
    assert.equal(config.securityJsCode, 'test-jscode');
  });

  it('未知 /api 路径返回 404 与 JSON 错误', async () => {
    const res = await request('GET', '/api/nope');
    assert.equal(res.status, 404);
    assert.ok((await res.json()).error);
  });
});
