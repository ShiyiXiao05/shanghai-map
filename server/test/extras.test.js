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

const validPlace = {
  name: '武康路',
  description: '梧桐区 citywalk',
  category: '景点',
  lng: 121.4375,
  lat: 31.2054,
  added_by: '小明',
};

// 1x1 红色 PNG
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function setupMapWithPlace(request) {
  const mapRes = await request('POST', '/api/maps', { body: { name: '周末', createdBy: '小明' } });
  const map = await mapRes.json();
  const placeRes = await request('POST', '/api/places', { body: { ...validPlace, map_code: map.code } });
  const place = await placeRes.json();
  return { map, place };
}

describe('photos & comments API', () => {
  let server;
  let request;

  beforeEach(async () => {
    ({ server, request } = await startServer());
  });

  afterEach(async () => {
    server.closeAllConnections();
    await server.close();
  });

  it('上传照片 → 列表带缩略图 → 二进制获取 → 删除', async () => {
    const { map, place } = await setupMapWithPlace(request);

    const upload = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: tinyPng, thumb: tinyPng, added_by: '小明' },
    });
    assert.equal(upload.status, 201);
    const { id: photoId } = await upload.json();

    const list = await (await request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).json();
    assert.equal(list.photos.length, 1);
    assert.match(list.photos[0].thumb, /^data:image\/png;base64,/);

    const raw = await request('GET', `/api/photos/${photoId}?map=${map.code}`);
    assert.equal(raw.status, 200);
    assert.equal(raw.headers.get('content-type'), 'image/png');
    const bytes = Buffer.from(await raw.arrayBuffer());
    assert.ok(bytes.length > 0);

    const del = await request('DELETE', `/api/photos/${photoId}`, { mapCode: map.code });
    assert.equal(del.status, 204);

    const gone = await request('GET', `/api/photos/${photoId}?map=${map.code}`);
    assert.equal(gone.status, 404);
  });

  it('非图片 data URL 与超大照片返回 400', async () => {
    const { map, place } = await setupMapWithPlace(request);

    const badMime = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: 'data:text/html;base64,PGI+', thumb: tinyPng },
    });
    assert.equal(badMime.status, 400);

    // 解码后 > 1.5MB：2.2MB 的 base64 字符串解码约 1.65MB
    const huge = `data:image/png;base64,${'A'.repeat(2.2 * 1024 * 1024)}`;
    const tooBig = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: huge, thumb: tinyPng },
    });
    assert.equal(tooBig.status, 400);
  });

  it('每个地点最多 9 张照片', async () => {
    const { map, place } = await setupMapWithPlace(request);
    for (let i = 0; i < 9; i += 1) {
      const res = await request('POST', `/api/places/${place.id}/photos`, {
        body: { map_code: map.code, full: tinyPng, thumb: tinyPng },
      });
      assert.equal(res.status, 201);
    }
    const tenth = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: tinyPng, thumb: tinyPng },
    });
    assert.equal(tenth.status, 400);
  });

  it('照片接口错误邀请码返回 404', async () => {
    const { map, place } = await setupMapWithPlace(request);
    const upload = await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: tinyPng, thumb: tinyPng },
    });
    const { id: photoId } = await upload.json();

    const otherMap = await (
      await request('POST', '/api/maps', { body: { name: '另一张图' } })
    ).json();
    const list = await request('GET', `/api/places/${place.id}/photos?map=${otherMap.code}`);
    assert.equal(list.status, 404);

    const raw = await request('GET', `/api/photos/${photoId}?map=${otherMap.code}`);
    assert.equal(raw.status, 404);

    const del = await request('DELETE', `/api/photos/${photoId}`, { mapCode: 'ZZZZZ9' });
    assert.equal(del.status, 404);
  });

  it('评论增删与字数校验', async () => {
    const { map, place } = await setupMapWithPlace(request);

    const post = await request('POST', `/api/places/${place.id}/comments`, {
      body: { map_code: map.code, author: '小红', body: ' 这条路秋天去最好看 ' },
    });
    assert.equal(post.status, 201);
    const comment = await post.json();
    assert.equal(comment.body, '这条路秋天去最好看');
    assert.equal(comment.author, '小红');

    const empty = await request('POST', `/api/places/${place.id}/comments`, {
      body: { map_code: map.code, body: '   ' },
    });
    assert.equal(empty.status, 400);

    const tooLong = await request('POST', `/api/places/${place.id}/comments`, {
      body: { map_code: map.code, body: '长'.repeat(281) },
    });
    assert.equal(tooLong.status, 400);

    const list = await (await request('GET', `/api/places/${place.id}/comments?map=${map.code}`)).json();
    assert.equal(list.comments.length, 1);

    const del = await request('DELETE', `/api/comments/${comment.id}`, { mapCode: map.code });
    assert.equal(del.status, 204);

    const delWrong = await request('DELETE', `/api/comments/${comment.id}`, { mapCode: map.code });
    assert.equal(delWrong.status, 404);
  });

  it('地点列表返回照片与评论计数；删除地点级联清理照片评论', async () => {
    const { map, place } = await setupMapWithPlace(request);
    await request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: tinyPng, thumb: tinyPng },
    });
    const comment = await (
      await request('POST', `/api/places/${place.id}/comments`, {
        body: { map_code: map.code, body: '想去！' },
      })
    ).json();

    const list = await (await request('GET', `/api/places?map=${map.code}`)).json();
    assert.equal(list.places[0].photo_count, 1);
    assert.equal(list.places[0].comment_count, 1);

    await request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });

    const photoRaw = await request('GET', `/api/photos/1?map=${map.code}`);
    assert.equal(photoRaw.status, 404);
    const commentDel = await request('DELETE', `/api/comments/${comment.id}`, { mapCode: map.code });
    assert.equal(commentDel.status, 404);
  });

  it('「我也想去」投票：切换、按昵称去重、列表携带 wishes、级联清理', async () => {
    const { map, place } = await setupMapWithPlace(request);

    const on = await request('POST', `/api/places/${place.id}/wish`, {
      body: { map_code: map.code, who: '小明' },
    });
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { wished: true, wishes: ['小明'] });

    const again = await (
      await request('POST', `/api/places/${place.id}/wish`, {
        body: { map_code: map.code, who: '小红' },
      })
    ).json();
    assert.equal(again.wished, true);
    assert.deepEqual(again.wishes, ['小明', '小红']);

    const off = await (
      await request('POST', `/api/places/${place.id}/wish`, {
        body: { map_code: map.code, who: '小明' },
      })
    ).json();
    assert.equal(off.wished, false);
    assert.deepEqual(off.wishes, ['小红']);

    const list = await (await request('GET', `/api/places?map=${map.code}`)).json();
    assert.deepEqual(list.places[0].wishes, ['小红']);

    const noWho = await request('POST', `/api/places/${place.id}/wish`, {
      body: { map_code: map.code },
    });
    assert.equal(noWho.status, 400);

    const wrongCode = await request('POST', `/api/places/${place.id}/wish`, {
      body: { map_code: 'ZZZZZ9', who: '小明' },
    });
    assert.equal(wrongCode.status, 404);

    await request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });
    const afterDelete = await request('POST', `/api/places/${place.id}/wish`, {
      body: { map_code: map.code, who: '小明' },
    });
    assert.equal(afterDelete.status, 404);
  });

  it('回忆时间线：打卡带 visited_at、取消清空、按时间倒序', async () => {
    const { map } = await setupMapWithPlace(request);
    const first = await (
      await request('POST', '/api/places', {
        body: { ...validPlace, name: '先去的', map_code: map.code },
      })
    ).json();
    const second = await (
      await request('POST', '/api/places', {
        body: { ...validPlace, name: '后去的', map_code: map.code },
      })
    ).json();

    const memoriesEmpty = await (await request('GET', `/api/maps/${map.code}/memories`)).json();
    assert.equal(memoriesEmpty.memories.length, 0);

    await request('PUT', `/api/places/${first.id}`, {
      body: { visited: true },
      mapCode: map.code,
    });
    // 确保两个 visited_at 可区分
    await new Promise((resolve) => setTimeout(resolve, 30));
    await request('PUT', `/api/places/${second.id}`, {
      body: { visited: true },
      mapCode: map.code,
    });

    const withPhoto = await (
      await request('POST', `/api/places/${second.id}/photos`, {
        body: { map_code: map.code, full: tinyPng, thumb: tinyPng },
      })
    ).json();

    const memories = await (await request('GET', `/api/maps/${map.code}/memories`)).json();
    assert.equal(memories.memories.length, 2);
    assert.equal(memories.memories[0].name, '后去的');
    assert.ok(Date.parse(memories.memories[0].visited_at) >= Date.parse(memories.memories[1].visited_at));
    assert.equal(memories.memories[0].photos.length, 1);
    assert.match(memories.memories[0].photos[0], /^data:image\/png;base64,/);
    assert.equal(memories.memories[1].photos.length, 0);

    await request('PUT', `/api/places/${first.id}`, {
      body: { visited: false },
      mapCode: map.code,
    });
    const afterUnvisit = await (await request('GET', `/api/maps/${map.code}/memories`)).json();
    assert.equal(afterUnvisit.memories.length, 1);

    const wrongMap = await request('GET', '/api/maps/NOPE00/memories');
    assert.equal(wrongMap.status, 404);

    const photoCached = await request('GET', `/api/photos/${withPhoto.id}?map=${map.code}`);
    assert.equal(photoCached.status, 200); // LRU 缓存路径同样可取
  });

  it('公共广场：公开开关、聚合视图不泄露邀请码、删除后移除', async () => {
    const { map, place } = await setupMapWithPlace(request);
    const second = await (
      await request('POST', '/api/places', {
        body: { ...validPlace, name: '未公开的', map_code: map.code },
      })
    ).json();

    // 默认未公开：公共广场为空
    const empty = await (await request('GET', '/api/public/places')).json();
    assert.equal(empty.places.length, 0);

    // 缺邀请码 400、错邀请码 404
    const noCode = await request('POST', `/api/places/${place.id}/public`, { body: {} });
    assert.equal(noCode.status, 400);
    const wrongCode = await request('POST', `/api/places/${place.id}/public`, {
      body: { map_code: 'ZZZZZ9' },
    });
    assert.equal(wrongCode.status, 404);

    // 公开 → 出现在公共广场；不泄露 map_code；计数与愿望一并返回
    const on = await request('POST', `/api/places/${place.id}/public`, {
      body: { map_code: map.code },
    });
    assert.equal(on.status, 200);
    assert.deepEqual(await on.json(), { is_public: true });

    const list = await (await request('GET', '/api/public/places')).json();
    assert.equal(list.places.length, 1);
    const pub = list.places[0];
    assert.equal(pub.name, validPlace.name);
    assert.equal('map_code' in pub, false);
    assert.equal(pub.wishes.length, 0);

    // 地点自身列表带 is_public 标记
    const own = await (await request('GET', `/api/places?map=${map.code}`)).json();
    const ownFirst = own.places.find((p) => p.id === place.id);
    assert.equal(ownFirst.is_public, true);
    assert.equal(own.places.find((p) => p.id === second.id).is_public, false);

    // 取消公开 → 从公共广场消失；再公开再取消
    const off = await (
      await request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } })
    ).json();
    assert.deepEqual(off, { is_public: false });
    const emptyAgain = await (await request('GET', '/api/public/places')).json();
    assert.equal(emptyAgain.places.length, 0);

    // 删除地点后不应残留
    await request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } });
    await request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });
    const afterDelete = await (await request('GET', '/api/public/places')).json();
    assert.equal(afterDelete.places.length, 0);
  });
});
