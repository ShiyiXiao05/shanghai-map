import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { newDb } from 'pg-mem';
import { buildApp } from '../app.js';
import { createPlaceStore } from '../store.js';

// 模拟 Cloudinary：记录销毁调用，返回可预测的 CDN 链接
function createFakeUploader() {
  const destroyed = [];
  return {
    configured: true,
    destroyed,
    async upload(dataUrl, { folder }) {
      const id = `${folder}/photo-${dataUrl.length}`;
      return {
        publicId: id,
        url: `https://res.cloudinary.com/demo/image/upload/${id}.webp`,
        thumbUrl: `https://res.cloudinary.com/demo/image/upload/w_480,c_fill,q_auto,f_auto/${id}.webp`,
      };
    },
    async destroy(publicId) {
      destroyed.push(publicId);
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
      redirect: 'manual',
    });
  return { server, request, store };
}

const validPlace = {
  name: '武康路',
  description: '梧桐区 citywalk',
  category: '景点',
  lng: 121.4375,
  lat: 31.2054,
  added_by: '小明',
};

const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

describe('photos with CDN uploader', () => {
  let server;
  let request;
  let uploader;

  beforeEach(async () => {
    uploader = createFakeUploader();
    ({ server, request } = await startServer({ uploader }));
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('上传走 CDN：列表返回 CDN 缩略图链接，原图端点 302 到 CDN', async () => {
    const mapRes = await request('POST', '/api/maps', { body: { name: '周末' } });
    const map = await mapRes.json();
    await request('POST', '/api/places', { body: { ...validPlace, map_code: map.code } });
    const place = await (await request('GET', `/api/places?map=${map.code}`)).json();

    const upload = await request('POST', `/api/places/${place.places[0].id}/photos`, {
      body: { map_code: map.code, full: tinyPng, thumb: tinyPng, added_by: '小明' },
    });
    assert.equal(upload.status, 201);
    const { id } = await upload.json();

    const list = await (
      await request('GET', `/api/places/${place.places[0].id}/photos?map=${map.code}`)
    ).json();
    assert.equal(list.photos.length, 1);
    assert.ok(list.photos[0].thumb.startsWith('https://res.cloudinary.com/'));
    assert.ok(!list.photos[0].thumb.startsWith('data:'));

    const full = await request('GET', `/api/photos/${id}?map=${map.code}`);
    assert.equal(full.status, 302);
    assert.ok((full.headers.get('location') ?? '').startsWith('https://res.cloudinary.com/'));
  });

  it('删除照片时同步销毁 CDN 资源', async () => {
    const mapRes = await request('POST', '/api/maps', { body: { name: '周末' } });
    const map = await mapRes.json();
    await request('POST', '/api/places', { body: { ...validPlace, map_code: map.code } });
    const place = await (await request('GET', `/api/places?map=${map.code}`)).json();

    const upload = await request('POST', `/api/places/${place.places[0].id}/photos`, {
      body: { map_code: map.code, full: tinyPng, thumb: tinyPng },
    });
    const { id } = await upload.json();

    const del = await request('DELETE', `/api/photos/${id}`, { mapCode: map.code });
    assert.equal(del.status, 204);
    assert.equal(uploader.destroyed.length, 1);
  });
});
