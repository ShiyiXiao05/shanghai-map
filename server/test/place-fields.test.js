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
  const app = buildApp({ store, mapConfig: { key: 'test-key', securityJsCode: '' } });
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

const basePlace = {
  name: '椒麻鸡专门店',
  category: '美食',
  lng: 121.47,
  lat: 31.23,
};

async function setupMap(request) {
  const mapRes = await request('POST', '/api/maps', { body: { name: '字段图', createdBy: '小明' } });
  return (await mapRes.json()).code;
}

describe('place fields: price_hint / hours / tags', () => {
  let server;
  let request;

  beforeEach(async () => {
    ({ server, request } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('创建时带三个新字段，返回完整且列表可见', async () => {
    const code = await setupMap(request);
    const res = await request('POST', '/api/places', {
      body: {
        ...basePlace,
        map_code: code,
        price_hint: '人均 80',
        hours: '11:00-22:00',
        tags: '椒麻鸡,川菜',
      },
    });
    assert.equal(res.status, 201);
    const place = await res.json();
    assert.equal(place.price_hint, '人均 80');
    assert.equal(place.hours, '11:00-22:00');
    assert.equal(place.tags, '椒麻鸡,川菜');

    const list = await (await request('GET', `/api/places?map=${code}`)).json();
    assert.equal(list.places[0].price_hint, '人均 80');
    assert.equal(list.places[0].hours, '11:00-22:00');
  });

  it('不传新字段默认空字符串', async () => {
    const code = await setupMap(request);
    const place = await (
      await request('POST', '/api/places', { body: { ...basePlace, map_code: code } })
    ).json();
    assert.equal(place.price_hint, '');
    assert.equal(place.hours, '');
    assert.equal(place.tags, '');
  });

  it('部分更新只改 hours 不动其他字段', async () => {
    const code = await setupMap(request);
    const place = await (
      await request('POST', '/api/places', {
        body: { ...basePlace, map_code: code, price_hint: '人均 80', tags: '川菜' },
      })
    ).json();
    const updated = await (
      await request('PUT', `/api/places/${place.id}`, {
        mapCode: code,
        body: { hours: '周三店休' },
      })
    ).json();
    assert.equal(updated.hours, '周三店休');
    assert.equal(updated.price_hint, '人均 80');
    assert.equal(updated.tags, '川菜');
  });

  it('超长字段 400', async () => {
    const code = await setupMap(request);
    const res = await request('POST', '/api/places', {
      body: { ...basePlace, map_code: code, price_hint: 'x'.repeat(51) },
    });
    assert.equal(res.status, 400);
    const res2 = await request('POST', '/api/places', {
      body: { ...basePlace, map_code: code, hours: 'x'.repeat(101) },
    });
    assert.equal(res2.status, 400);
  });
});
