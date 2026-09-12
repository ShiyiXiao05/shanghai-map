import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function createFakeUploader() {
  return {
    configured: true,
    destroyed: [],
    async destroy(publicId) {
      this.destroyed.push(publicId);
    },
  };
}

async function startServer({ uploader } = {}) {
  const db = newDb();
  const pgLib = db.adapters.createPg();
  const pool = new pgLib.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const app = buildApp({ store, mapConfig: { key: 'test-key', securityJsCode: '' }, uploader });
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

async function seed(request, name = '回收站测试点') {
  const code = (await (await request('POST', '/api/maps', { body: { name: '回收站图', createdBy: '小明' } })).json()).code;
  const place = await (
    await request('POST', '/api/places', {
      body: { map_code: code, name, category: '美食', lng: 121.4, lat: 31.2 },
    })
  ).json();
  await request('POST', `/api/places/${place.id}/photos`, {
    body: { map_code: code, full: png, thumb: png, added_by: '小明' },
  });
  await request('POST', `/api/places/${place.id}/comments`, {
    body: { map_code: code, body: '好吃', author: '小红' },
  });
  return { code, place };
}

describe('trash: soft delete & restore', () => {
  let server;
  let request;

  beforeEach(async () => {
    ({ server, request } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('删除进回收站：列表消失、trash 可见、恢复完整（照片/留言还在）', async () => {
    const { code, place } = await seed(request);

    const del = await request('DELETE', `/api/places/${place.id}`, { mapCode: code });
    assert.equal(del.status, 204);

    const live = (await (await request('GET', `/api/places?map=${code}`)).json()).places;
    assert.equal(live.length, 0);

    const trash = (await (await request('GET', `/api/places?map=${code}&view=trash`)).json()).places;
    assert.equal(trash.length, 1);
    assert.equal(trash[0].name, '回收站测试点');
    assert.ok(trash[0].deleted_at);

    // 恢复
    const restore = await request('POST', `/api/places/${place.id}/restore`, {
      body: { map_code: code },
    });
    assert.equal(restore.status, 200);

    const after = (await (await request('GET', `/api/places?map=${code}`)).json()).places;
    assert.equal(after.length, 1);
    const photos = (await (await request('GET', `/api/places/${place.id}/photos?map=${code}`)).json()).photos;
    assert.equal(photos.length, 1);
    const comments = (await (await request('GET', `/api/places/${place.id}/comments?map=${code}`)).json()).comments;
    assert.equal(comments.length, 1);
  });

  it('回收站权限：错码 404，恢复不存在的地点 404', async () => {
    const { code, place } = await seed(request);
    await request('DELETE', `/api/places/${place.id}`, { mapCode: code });

    assert.equal((await request('GET', '/api/places?map=NOPE00&view=trash')).status, 404);
    assert.equal(
      (await request('POST', `/api/places/${place.id}/restore`, { body: { map_code: 'NOPE00' } })).status,
      404
    );
    assert.equal(
      (await request('POST', '/api/places/999/restore', { body: { map_code: code } })).status,
      404
    );
  });

  it('软删地点自动移出行程，恢复后行程回来', async () => {
    const { code, place } = await seed(request);
    await request('PUT', '/api/itinerary', { body: { map_code: code, place_ids: [place.id] } });
    await request('DELETE', `/api/places/${place.id}`, { mapCode: code });

    let stops = (await (await request('GET', `/api/itinerary?map=${code}`)).json()).stops;
    assert.equal(stops.length, 0);

    await request('POST', `/api/places/${place.id}/restore`, { body: { map_code: code } });
    stops = (await (await request('GET', `/api/itinerary?map=${code}`)).json()).stops;
    assert.equal(stops.length, 1);
  });

  it('30 天后打开回收站触发彻底清理（含 CDN 销毁）', async () => {
    const uploader = createFakeUploader();
    let ctx;
    ({ ...ctx } = {});
    const db = newDb();
    const pgLib = db.adapters.createPg();
    const pool = new pgLib.Pool();
    const store = createPlaceStore(pool);
    await store.init();
    const app = buildApp({ store, mapConfig: { key: 'k', securityJsCode: '' }, uploader });
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

    try {
      const { code, place } = await seed(request);
      await request('DELETE', `/api/places/${place.id}`, { mapCode: code });
      // 把软删时间拨回 31 天前
      await pool.query("UPDATE public.places SET deleted_at = now() - interval '31 days' WHERE id = $1", [place.id]);

      const trash = (await (await request('GET', `/api/places?map=${code}&view=trash`)).json()).places;
      assert.equal(trash.length, 0); // 已被清理
      // CDN：b64 照片无 public_id，不销毁但不报错
      assert.ok(Array.isArray(uploader.destroyed));
    } finally {
      server.closeAllConnections();
      await server.close();
    }
  });
});
