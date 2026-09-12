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
  return { server, request, store };
}

function placeBody(n, i) {
  return {
    name: `地点${n}-${i}`,
    description: '',
    category: '美食',
    lng: 121.4 + i * 0.01,
    lat: 31.2 + i * 0.01,
    added_by: '小明',
  };
}

async function setup(request) {
  const mapRes = await request('POST', '/api/maps', { body: { name: '行程图', createdBy: '小明' } });
  const map = await mapRes.json();
  const ids = [];
  for (let i = 1; i <= 3; i += 1) {
    const res = await request('POST', '/api/places', {
      body: { ...placeBody(i, i), map_code: map.code },
    });
    ids.push((await res.json()).id);
  }
  return { map, ids };
}

describe('itinerary API', () => {
  let server;
  let request;

  beforeEach(async () => {
    ({ server, request } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('空行程返回空数组', async () => {
    const { map } = await setup(request);
    const res = await request('GET', `/api/itinerary?map=${map.code}`);
    assert.equal(res.status, 200);
    assert.deepEqual((await res.json()).stops, []);
  });

  it('PUT 全量设置顺序，GET 按序返回带地点详情', async () => {
    const { map, ids } = await setup(request);
    const res = await request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: [ids[2], ids[0]] },
    });
    assert.equal(res.status, 200);
    const { stops } = await res.json();
    assert.equal(stops.length, 2);
    assert.equal(stops[0].id, ids[2]);
    assert.equal(stops[0].position, 1);
    assert.equal(stops[1].id, ids[0]);
    assert.equal(stops[1].position, 2);
    assert.equal(stops[0].name, '地点3-3');
    assert.ok('lng' in stops[0] && 'lat' in stops[0] && 'category' in stops[0]);
  });

  it('PUT 重排为全量替换（重排后旧顺序消失）', async () => {
    const { map, ids } = await setup(request);
    await request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: ids },
    });
    const res = await request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: [ids[1]] },
    });
    const { stops } = await res.json();
    assert.equal(stops.length, 1);
    assert.equal(stops[0].id, ids[1]);
  });

  it('不属于本地图的 id 被静默过滤，重复 id 去重', async () => {
    const { map, ids } = await setup(request);
    const otherRes = await request('POST', '/api/maps', { body: { name: '别的图', createdBy: '' } });
    const other = await otherRes.json();
    const otherPlace = await (
      await request('POST', '/api/places', { body: { ...placeBody(9, 9), map_code: other.code } })
    ).json();

    const res = await request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: [ids[0], otherPlace.id, ids[0]] },
    });
    const { stops } = await res.json();
    assert.equal(stops.length, 1);
    assert.equal(stops[0].id, ids[0]);
  });

  it('删除地点后行程自动收缩', async () => {
    const { map, ids } = await setup(request);
    await request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: ids },
    });
    await request('DELETE', `/api/places/${ids[0]}`, { mapCode: map.code });
    const res = await request('GET', `/api/itinerary?map=${map.code}`);
    const { stops } = await res.json();
    assert.equal(stops.length, 2);
    assert.ok(!stops.some((s) => s.id === ids[0]));
  });

  it('鉴权与校验：错码 404、缺参 400、非法 place_ids 400', async () => {
    const { map, ids } = await setup(request);

    assert.equal((await request('GET', '/api/itinerary?map=NOPE99')).status, 404);
    assert.equal((await request('GET', '/api/itinerary')).status, 400);
    assert.equal(
      (await request('PUT', '/api/itinerary', { body: { map_code: 'NOPE99', place_ids: [] } })).status,
      404
    );
    assert.equal((await request('PUT', '/api/itinerary', { body: { place_ids: [] } })).status, 400);
    assert.equal(
      (
        await request('PUT', '/api/itinerary', {
          body: { map_code: map.code, place_ids: 'nope' },
        })
      ).status,
      400
    );
    assert.equal(
      (
        await request('PUT', '/api/itinerary', {
          body: { map_code: map.code, place_ids: [ids[0], -3] },
        })
      ).status,
      400
    );
  });

  it('空数组 PUT 清空行程', async () => {
    const { map, ids } = await setup(request);
    await request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: ids },
    });
    await request('PUT', '/api/itinerary', { body: { map_code: map.code, place_ids: [] } });
    const { stops } = await (await request('GET', `/api/itinerary?map=${map.code}`)).json();
    assert.equal(stops.length, 0);
  });
});
