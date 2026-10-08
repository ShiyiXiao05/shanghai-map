// 修复后验证：静态校验 + 端到端业务链路 + 小程序页面行为。
// 全部在 pg-mem 隔离库上跑，不触碰生产环境。
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const requireServer = createRequire(path.join(root, 'server/package.json'));

process.env.DATABASE_URL = '';
const { newDb } = requireServer('pg-mem');
const { buildApp } = await import(path.join(root, 'server/app.js'));
const { createPlaceStore } = await import(path.join(root, 'server/store.js'));
const { createAuth } = await import(path.join(root, 'server/auth.js'));

const results = { checkedAt: new Date().toISOString(), static: {}, endToEnd: [], miniProgram: {}, summary: {} };

// ---------------- 1. 静态校验 ----------------
function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.git', '.mimosa', '.zcode'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}
const files = ['server', 'miniprogram', 'public'].flatMap((dir) => walk(path.join(root, dir)));
const jsFiles = files.filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));
const jsonFiles = files.filter((f) => f.endsWith('.json'));

const syntaxFailures = jsFiles
  .map((f) => {
    const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
    return r.status === 0 ? null : { file: path.relative(root, f), error: r.stderr.slice(0, 300) };
  })
  .filter(Boolean);
const jsonFailures = jsonFiles
  .map((f) => {
    try {
      JSON.parse(fs.readFileSync(f, 'utf8'));
      return null;
    } catch (err) {
      return { file: path.relative(root, f), error: err.message };
    }
  })
  .filter(Boolean);

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'miniprogram/app.json'), 'utf8'));
const missingPageFiles = appConfig.pages.flatMap((page) =>
  ['js', 'json', 'wxml', 'wxss']
    .filter((ext) => !fs.existsSync(path.join(root, 'miniprogram', `${page}.${ext}`)))
    .map((ext) => `${page}.${ext}`)
);

// 微信开发者工具自带编译器（wcc / wcsc）
const compilerRoot =
  process.env.WECHAT_COMPILER_ROOT ||
  '/Applications/wechatwebdevtools.app/Contents/Resources/app.asar.unpacked/node_modules/wcc-exec';
function compile(binary, entries) {
  if (!fs.existsSync(path.join(compilerRoot, binary))) return { available: false };
  const r = spawnSync(path.join(compilerRoot, binary), entries, {
    cwd: path.join(root, 'miniprogram'),
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  return {
    available: true,
    status: r.status,
    stderr: (r.stderr || '').slice(0, 300),
    outputBytes: Buffer.byteLength(r.stdout || ''),
  };
}
const wxmlFiles = files
  .filter((f) => f.includes(`${path.sep}miniprogram${path.sep}`) && f.endsWith('.wxml'))
  .map((f) => path.relative(path.join(root, 'miniprogram'), f));
const wxssFiles = files
  .filter((f) => f.includes(`${path.sep}miniprogram${path.sep}`) && f.endsWith('.wxss'))
  .map((f) => path.relative(path.join(root, 'miniprogram'), f));
const wxml = compile('wcc', wxmlFiles);
const wxss = compile('wcsc', wxssFiles);

results.static = {
  jsFiles: jsFiles.length,
  syntaxFailures,
  jsonFiles: jsonFiles.length,
  jsonFailures,
  registeredPages: appConfig.pages.length,
  missingPageFiles,
  wxml: { fileCount: wxmlFiles.length, ...wxml },
  wxss: { fileCount: wxssFiles.length, ...wxss },
};

// 关键修复点在源码里确实存在（防止"以为改了其实没改"）
const sourceContains = (relPath, needle) =>
  fs.readFileSync(path.join(root, relPath), 'utf8').includes(needle);
results.static.fixMarkers = {
  'server/app.js 有 /api/upload-config': sourceContains('server/app.js', "'/api/upload-config'"),
  'server/app.js 有 413 分支': sourceContains('server/app.js', 'entity.too.large'),
  'server/app.js 有安全响应头': sourceContains('server/app.js', 'Strict-Transport-Security'),
  'server/app.js 有公共广场单点接口': sourceContains('server/app.js', "'/api/public/places/:id'"),
  'photos.js 缩略图上限 64KB': sourceContains('server/routes/photos.js', '64 * 1024'),
  'photos.js 有幂等裁剪': sourceContains('server/routes/photos.js', 'trimPhotos'),
  'store.js 换码迁移行程与订阅': sourceContains('server/store.js', "'push_subscriptions',"),
  'store.js 软删清缓存': sourceContains('server/store.js', 'photoCache.delete(`${Number(row.id)}:${mapCode}`)'),
  'store.js 恢复有 30 天窗口': sourceContains('server/store.js', "interval '30 days'"),
  'auth.js 中间件有 try/catch': sourceContains('server/auth.js', '[auth] 解析登录态失败'),
  'ratelimit.js 存在': fs.existsSync(path.join(root, 'server/ratelimit.js')),
  '小程序 image.js 存在': fs.existsSync(path.join(root, 'miniprogram/utils/image.js')),
  '小程序上传按 upload-config 预算': sourceContains('miniprogram/pages/detail/detail.js', 'UPLOAD_TOTAL_BUDGET'),
  '小程序 marker 移到 onReady': sourceContains('miniprogram/pages/index/index.js', 'onReady()'),
  '小程序登录失败保留旧 token': sourceContains('miniprogram/utils/auth.js', '拿到新 token 才落盘'),
  '小程序排序按索引映射': sourceContains('miniprogram/pages/index/index.js', 'storage.SORTS[Number(event.detail.value)]'),
  '小程序请求超时 15s': sourceContains('miniprogram/utils/api.js', 'REQUEST_TIMEOUT = 15000'),
  '小程序删除地点提示三态': sourceContains('miniprogram/pages/index/index.js', 'loadError'),
  '网页 fetch 超时': sourceContains('public/js/api.js', 'AbortController'),
  '网页上传走 upload-config': sourceContains('public/js/app.js', 'uploadConfig'),
  '网页 SW 用 allSettled': sourceContains('public/sw.js', 'allSettled'),
  '网页焦点轮廓恢复': sourceContains('public/css/style.css', ':focus-visible { outline: 2px solid'),
  '内容安全模块存在': fs.existsSync(path.join(root, 'server/content-security.js')),
  '举报路由存在': fs.existsSync(path.join(root, 'server/routes/reports.js')),
  '微信回调路由存在': fs.existsSync(path.join(root, 'server/routes/wechat.js')),
  '照片审核状态字段': sourceContains('server/store.js', 'moderation TEXT NOT NULL'),
  '违规照片被列表过滤': sourceContains('server/store.js', "AND moderation <> 'risky'"),
  '小程序有举报入口': sourceContains('miniprogram/pages/detail/detail.wxml', 'bindtap="report"'),
  '网页有举报入口': sourceContains('public/index.html', 'id="btn-report"'),
};

// ---------------- 2. 端到端业务链路 ----------------
const tinyPng =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
// 模拟新小程序压缩后的产物：full ≈ 40KB 原图（base64 ≈ 54KB）、thumb ≈ 10KB（base64 ≈ 14KB）
const compressedFull = `data:image/jpeg;base64,${'A'.repeat(54 * 1024)}`;
const compressedThumb = `data:image/jpeg;base64,${'B'.repeat(14 * 1024)}`;

async function fixture({ uploader, auth, contentSecurity } = {}) {
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const app = buildApp({
    store,
    mapConfig: { key: 'k', securityJsCode: 's' },
    uploader,
    auth,
    contentSecurity,
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, { body, mapCode, token } = {}) => {
    const res = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(mapCode === undefined ? {} : { 'x-map-code': mapCode }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      /* 二进制或空响应 */
    }
    return { status: res.status, data, headers: res.headers, bytes: Buffer.byteLength(text) };
  };
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  };
  return { server, request, store, pool, close };
}

function step(id, name, evidence, ok = true) {
  results.endToEnd.push({ id, name, ok, evidence });
}

// 2.1 无 CDN（数据库存图）路径：模拟小程序真实请求体
{
  const f = await fixture();
  try {
    const health = await f.request('GET', '/api/health');
    step('E2E-01', 'GET /api/health', { status: health.status });
    assert.equal(health.status, 200);

    const cfg = await f.request('GET', '/api/upload-config');
    step('E2E-02', '上传配置（无图床）', cfg.data);
    assert.equal(cfg.data.cdn, false);

    const map = (await f.request('POST', '/api/maps', { body: { name: '端到端地图' } })).data;
    const place = (
      await f.request('POST', '/api/places', {
        body: { name: '外滩', category: '景点', lng: 121.4903, lat: 31.2397, map_code: map.code },
      })
    ).data;
    step('E2E-03', '建图 + 加地点', { code: map.code, placeId: place.id });
    assert.equal(place.name, '外滩');

    const body = { map_code: map.code, full: compressedFull, thumb: compressedThumb };
    const bodyBytes = Buffer.byteLength(JSON.stringify(body));
    const up = await f.request('POST', `/api/places/${place.id}/photos`, { body });
    step('E2E-04', '照片上传（full+thumb，模拟压缩后体积）', {
      status: up.status,
      bodyBytes,
      under100K: bodyBytes < 100 * 1024,
    });
    assert.equal(up.status, 201);
    assert.ok(bodyBytes < 100 * 1024, '请求体必须小于 callContainer 的 100K 上限');

    const photos = (await f.request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).data;
    step('E2E-05', '照片列表带缩略图', { count: photos.photos.length, thumbPrefix: photos.photos[0].thumb.slice(0, 22) });
    assert.match(photos.photos[0].thumb, /^data:image\/jpeg;base64,/);

    const raw = await f.request('GET', `/api/photos/${photos.photos[0].id}?map=${map.code}`);
    step('E2E-06', '原图端点可读', { status: raw.status });

    const comment = await f.request('POST', `/api/places/${place.id}/comments`, {
      body: { map_code: map.code, body: '好吃' },
    });
    const wish = await f.request('POST', `/api/places/${place.id}/wish`, {
      body: { map_code: map.code, who: '同学' },
    });
    const trip = await f.request('PUT', '/api/itinerary', {
      body: { map_code: map.code, place_ids: [place.id] },
    });
    step('E2E-07', '留言 / 想去 / 行程', {
      comment: comment.status,
      wish: wish.data.wished,
      stops: trip.data.stops.length,
    });
    assert.equal(comment.status, 201);
    assert.equal(wish.data.wished, true);
    assert.equal(trip.data.stops.length, 1);

    const exported = (await f.request('GET', `/api/maps/${map.code}/export`)).data;
    step('E2E-08', '全量导出含行程', {
      places: exported.places.length,
      itinerary: exported.itinerary.length,
      comments: exported.places[0].comments.length,
    });
    assert.equal(exported.itinerary.length, 1);

    await f.request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } });
    const pub = (await f.request('GET', `/api/public/places/${place.id}`)).data;
    step('E2E-09', '公共广场单点接口', { isPublic: pub.place.is_public, leaksMapCode: 'map_code' in pub.place });
    assert.equal('map_code' in pub.place, false);

    const del = await f.request('DELETE', `/api/places/${place.id}`, { mapCode: map.code });
    const afterDelete = await f.request('GET', `/api/photos/${photos.photos[0].id}?map=${map.code}`);
    step('E2E-10', '软删后照片立即不可读', { delete: del.status, photo: afterDelete.status });
    assert.equal(afterDelete.status, 404);

    const restored = await f.request('POST', `/api/places/${place.id}/restore`, {
      body: { map_code: map.code },
    });
    step('E2E-11', '回收站恢复', { status: restored.status });
    assert.equal(restored.status, 200);

    const rekeyed = (await f.request('POST', `/api/maps/${map.code}/rekey`, { body: {} })).data;
    const oldMap = await f.request('GET', `/api/maps/${map.code}`);
    const tripAfter = await f.request('GET', `/api/itinerary?map=${rekeyed.code}`);
    const oldPhoto = await f.request('GET', `/api/photos/${photos.photos[0].id}?map=${map.code}`);
    step('E2E-12', '换码：旧码失效、行程随迁、旧码照片不可读', {
      oldMap: oldMap.status,
      stops: tripAfter.data.stops.length,
      oldPhoto: oldPhoto.status,
    });
    assert.equal(oldMap.status, 404);
    assert.equal(tripAfter.data.stops.length, 1);
    assert.equal(oldPhoto.status, 404);

    const removed = await f.request('DELETE', `/api/maps/${rekeyed.code}`);
    step('E2E-13', '删除地图', { status: removed.status });
    assert.equal(removed.status, 204);
  } finally {
    await f.close();
  }
}

// 2.2 CDN 路径：小程序只传 full
{
  const uploads = [];
  const uploader = {
    configured: true,
    async upload(dataUrl) {
      uploads.push(dataUrl.length);
      return { publicId: 'demo/1', url: 'https://cdn.example/1.jpg', thumbUrl: 'https://cdn.example/1-t.jpg' };
    },
    async destroy() {},
  };
  const f = await fixture({ uploader });
  try {
    const cfg = (await f.request('GET', '/api/upload-config')).data;
    const map = (await f.request('POST', '/api/maps', { body: { name: 'CDN 地图' } })).data;
    const place = (
      await f.request('POST', '/api/places', {
        body: { name: '武康路', category: '景点', lng: 121.44, lat: 31.21, map_code: map.code },
      })
    ).data;
    const up = await f.request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: compressedFull },
    });
    const photos = (await f.request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).data;
    step('E2E-14', 'CDN 模式：只传 full 即可上传并返回 CDN 缩略图', {
      cdn: cfg.cdn,
      uploadStatus: up.status,
      thumb: photos.photos[0].thumb,
      uploadedBytes: uploads[0],
    });
    assert.equal(cfg.cdn, true);
    assert.equal(up.status, 201);
    assert.match(photos.photos[0].thumb, /^https:\/\/cdn\.example\//);
    assert.equal(photos.photos[0].full, 'https://cdn.example/1.jpg');
  } finally {
    await f.close();
  }
}

// 2.3 登录链路（小程序）
{
  const auth = createAuth({
    appid: 'wx-test',
    secret: 'secret',
    signSecret: 'fixed-secret',
    store: { async getUser() { return null; }, async ensureUser() { return { nickname: '' }; } },
    fetchSession: async () => ({ openid: 'openid-1' }),
  });
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const authReal = createAuth({
    appid: 'wx-test',
    secret: 'secret',
    signSecret: 'fixed-secret',
    store,
    fetchSession: async () => ({ openid: 'openid-1' }),
  });
  const app = buildApp({ store, mapConfig: { key: 'k' }, auth: authReal });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, route, { body, mapCode, token } = {}) =>
    fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(mapCode === undefined ? {} : { 'x-map-code': mapCode }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  try {
    const login = await (await request('POST', '/api/auth/login', { body: { code: 'x' } })).json();
    const token = login.token;
    const noNickname = await request('POST', '/api/maps', { body: { name: 'M' }, token });
    await request('POST', '/api/auth/profile', { body: { nickname: '同学A' }, token });
    const created = await (await request('POST', '/api/maps', { body: { name: 'M' }, token })).json();
    const forged = await (
      await request('POST', '/api/places', {
        body: { name: 'P', category: '景点', lng: 121, lat: 31, map_code: created.code, added_by: '假名字' },
        token,
      })
    ).json();
    step('E2E-15', '登录 → 昵称 → 服务端盖章署名（忽略客户端伪造）', {
      needsNickname: login.needs_nickname,
      withoutNickname: noNickname.status,
      stampedAuthor: forged.added_by,
    });
    assert.equal(login.needs_nickname, true);
    assert.equal(noNickname.status, 400);
    assert.equal(forged.added_by, '同学A');

    const expired = `${authReal.signToken('openid-1').split('.')[0]}.deadbeef`;
    const writeWithBadToken = await request('POST', '/api/maps', { body: { name: 'X' }, token: expired });
    const readWithBadToken = await request('GET', `/api/maps/${created.code}`, { token: expired });
    step('E2E-16', '失效 token：写请求 401、读请求按匿名放行', {
      write: writeWithBadToken.status,
      read: readWithBadToken.status,
    });
    assert.equal(writeWithBadToken.status, 401);
    assert.equal(readWithBadToken.status, 200);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await pool.end();
  }
}

// 2.4 错误语义
{
  const f = await fixture();
  try {
    const missing = await f.request('GET', '/api/not-exist');
    const big = await f.request('POST', '/api/maps', {
      body: { name: 'x'.repeat(3.2 * 1024 * 1024) },
    });
    step('E2E-17', '未知接口 404 / 超大请求体 413', { missing: missing.status, tooLarge: big.status });
    assert.equal(missing.status, 404);
    assert.equal(big.status, 413);

    const coordMap = (await f.request('POST', '/api/maps', { body: { name: '坐标校验' } })).data;
    const badCoord = await f.request('POST', '/api/places', {
      body: { name: 'P', category: '景点', lng: null, lat: false, map_code: coordMap.code },
    });
    step('E2E-18', '坐标 null/false 被拒（不再静默存成 0）', { status: badCoord.status, error: badCoord.data?.error });
    assert.equal(badCoord.status, 400);
  } finally {
    await f.close();
  }
}

// 2.5 合规链路：内容举报 + 图片异步审核回调
{
  const { createContentSecurity } = await import(path.join(root, 'server/content-security.js'));
  const { createHash } = await import('node:crypto');
  const msgToken = 'e2e-msg-token';
  const fetchImpl = async (url) => {
    if (String(url).includes('stable_token')) {
      return { json: async () => ({ access_token: 'tk', expires_in: 7200 }) };
    }
    if (String(url).includes('media_check_async')) {
      return { json: async () => ({ errcode: 0, trace_id: 'e2e-trace' }) };
    }
    return { json: async () => ({ errcode: 0, result: { suggest: 'pass' } }) };
  };
  const security = createContentSecurity({
    appid: 'wx-e2e',
    secret: 's',
    msgToken,
    fetchImpl,
    logger: { warn() {} },
  });
  const uploader = {
    configured: true,
    async upload() {
      return { publicId: 'e2e', url: 'https://cdn.example/e2e.jpg', thumbUrl: 'https://cdn.example/e2e-t.jpg' };
    },
    async destroy() {},
  };
  const f = await fixture({ uploader, contentSecurity: security });
  try {
    const map = (await f.request('POST', '/api/maps', { body: { name: '合规地图' } })).data;
    const place = (
      await f.request('POST', '/api/places', {
        body: { name: '某地点', category: '景点', lng: 121.44, lat: 31.21, map_code: map.code },
      })
    ).data;
    await f.request('POST', `/api/places/${place.id}/public`, { body: { map_code: map.code } });

    const report = await f.request('POST', '/api/reports', {
      body: { target_type: 'place', target_id: place.id, reason: '不实信息', detail: '地址是错的' },
    });
    const reports = (await f.request('GET', `/api/reports?map=${map.code}`)).data;
    const resolved = await f.request('POST', `/api/reports/${report.data.id}/resolve`, {
      body: { map_code: map.code },
    });
    step('E2E-19', '匿名举报公开内容 → owner 查看 → 结单', {
      create: report.status,
      openCount: reports.reports.length,
      resolve: resolved.status,
    });
    assert.equal(report.status, 201);
    assert.equal(reports.reports.length, 1);
    assert.equal(resolved.status, 200);

    const up = await f.request('POST', `/api/places/${place.id}/photos`, {
      body: { map_code: map.code, full: compressedFull },
    });
    const before = (await f.request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).data;
    const timestamp = '1700000000';
    const nonce = 'e2enonce';
    const signature = createHash('sha1')
      .update([msgToken, timestamp, nonce].sort().join(''))
      .digest('hex');
    const bad = await f.request(
      'POST',
      `/api/wechat/media-check-callback?signature=bad&timestamp=${timestamp}&nonce=${nonce}`,
      { body: { trace_id: 'e2e-trace', result: { suggest: 'risky' } } }
    );
    const cb = await f.request(
      'POST',
      `/api/wechat/media-check-callback?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`,
      { body: { trace_id: 'e2e-trace', result: { suggest: 'risky', label: 20001 } } }
    );
    const after = (await f.request('GET', `/api/places/${place.id}/photos?map=${map.code}`)).data;
    step('E2E-20', '图片送审 → 伪造签名被拒 → 判违规后列表隐藏', {
      upload: up.status,
      visibleBefore: before.photos.length,
      badSignature: bad.status,
      callback: cb.status,
      visibleAfter: after.photos.length,
    });
    assert.equal(up.status, 201);
    assert.equal(before.photos.length, 1);
    assert.equal(bad.status, 403);
    assert.equal(cb.status, 200);
    assert.equal(after.photos.length, 0);
  } finally {
    await f.close();
  }
}

// ---------------- 3. 小程序页面行为（VM + 官方编译器产物）----------------
{
  const configSource = fs
    .readFileSync(path.join(root, 'miniprogram/utils/config.js'), 'utf8')
    .replace(/export /g, '');
  const config = vm.runInNewContext(`${configSource}\n({ CATEGORIES, categoryMeta });`);
  const cache = new Map();
  let pageDef;
  function loadModule(rel, { wx, app, overrides = {} } = {}) {
    const filename = path.join(root, 'miniprogram', rel);
    if (overrides[rel]) return overrides[rel];
    if (cache.has(filename)) return cache.get(filename).exports;
    const mod = { exports: {} };
    cache.set(filename, mod);
    let source = fs.readFileSync(filename, 'utf8');
    const names = [...source.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+(\w+)/g)].map(
      (m) => m[1]
    );
    source = source
      .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, 'const {$1} = require("$2");')
      .replace(/export\s+(?=(?:async\s+)?(?:const|let|function))/g, '');
    source += `\n${names.map((n) => `exports.${n} = ${n};`).join('\n')}`;
    new vm.Script(source, { filename }).runInNewContext({
      module: mod,
      exports: mod.exports,
      require: (target) => {
        const abs = path.resolve(path.dirname(filename), target);
        const relTarget = path.relative(path.join(root, 'miniprogram'), abs);
        if (overrides[relTarget]) return overrides[relTarget];
        if (relTarget === 'utils/config.js') return { ...config, CATEGORIES: config.CATEGORIES };
        return loadModule(relTarget, { wx, app, overrides });
      },
      wx,
      getApp: () => app,
      Page: (value) => {
        pageDef = value;
      },
      Behavior: (value) => value,
      setTimeout,
      setInterval,
      clearInterval,
      console,
    });
    return mod.exports;
  }
  function makePage(rel, opts) {
    pageDef = null;
    loadModule(rel, opts);
    pageDef.data = JSON.parse(JSON.stringify(pageDef.data));
    pageDef.setData = function setData(patch) {
      Object.assign(this.data, patch);
    };
    return pageDef;
  }

  // 3.1 照片上传：CDN 模式不带 thumb；无 CDN 带预算内的 thumb
  const uploads = [];
  let cfg = { cdn: true, maxFullBytes: 1.5 * 1024 * 1024, maxThumbBytes: 64 * 1024 };
  const sizes = { '/tmp/orig.jpg': 4 * 1024 * 1024, '/tmp/small.jpg': 30 * 1024, '/tmp/thumb.jpg': 10 * 1024 };
  const contents = { '/tmp/small.jpg': 40 * 1024, '/tmp/thumb.jpg': 13 * 1024 };
  const detail = makePage('pages/detail/detail.js', {
    app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
    wx: {
      chooseMedia: async () => ({ tempFiles: [{ tempFilePath: '/tmp/orig.jpg', size: 4 * 1024 * 1024 }] }),
      compressImage: ({ compressedWidth, success }) =>
        success({ tempFilePath: compressedWidth >= 800 ? '/tmp/small.jpg' : '/tmp/thumb.jpg' }),
      getFileSystemManager: () => ({
        getFileInfo: ({ filePath, success }) => success({ size: sizes[filePath] || 0 }),
        readFile: ({ filePath, success }) => success({ data: 'A'.repeat(contents[filePath] || 0) }),
      }),
      showLoading() {},
      hideLoading() {},
      showToast() {},
    },
    overrides: {
      'utils/auth.js': { requireIdentity: async () => '同学' },
      'utils/identity-behavior.js': {},
      'utils/api.js': {
        api: {
          uploadConfig: async () => cfg,
          uploadPhoto: async (code, placeId, body) => {
            uploads.push({ code, placeId, body });
            return { id: uploads.length };
          },
          listPhotos: async () => [],
        },
      },
    },
  });
  detail.placeId = 7;
  await detail.addPhoto();
  cfg = { cdn: false, maxFullBytes: 1.5 * 1024 * 1024, maxThumbBytes: 64 * 1024 };
  await detail.addPhoto();
  const cdnBody = uploads[0].body;
  const dbBody = uploads[1].body;
  results.miniProgram.photoUpload = {
    calls: uploads.length,
    cdnModeHasThumb: 'thumb' in cdnBody,
    cdnModeBodyBytes: Buffer.byteLength(JSON.stringify(cdnBody)),
    dbModeHasThumb: 'thumb' in dbBody,
    dbModeBodyBytes: Buffer.byteLength(JSON.stringify(dbBody)),
    dbModeThumbBytes: dbBody.thumb ? dbBody.thumb.length : 0,
  };
  assert.equal('thumb' in cdnBody, false, 'CDN 模式不应带 thumb');
  assert.equal('thumb' in dbBody, true, '无 CDN 时必须带 thumb');
  assert.ok(dbBody.thumb.length <= 64 * 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(dbBody)) < 100 * 1024, '请求体需在 100K 内');

  // 3.2 排序：索引 → key
  const sortValues = new Map();
  const indexPage = makePage('pages/index/index.js', {
    app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
    wx: {
      getStorageSync: (k) => sortValues.get(k),
      setStorageSync: (k, v) => sortValues.set(k, v),
      showToast() {},
      setNavigationBarTitle() {},
    },
    overrides: { 'utils/api.js': { api: { listPlaces: async () => [] } } },
  });
  indexPage.setData({ places: [], activeCategories: [], hideVisitedOnly: false });
  indexPage.onSortChange({ detail: { value: '1' } });
  const afterName = { sort: indexPage.data.sort, index: indexPage.data.sortIndex, stored: sortValues.get('wish-sort') };
  indexPage.onSortChange({ detail: { value: '2' } });
  const afterWishes = { sort: indexPage.data.sort, stored: sortValues.get('wish-sort') };
  results.miniProgram.sort = { afterName, afterWishes };
  assert.equal(afterName.sort, 'name');
  assert.equal(afterWishes.sort, 'wishes');

  // 3.3 图标缺失时仍渲染点位
  indexPage.renderMarkers([{ id: 1, name: 'A', category: '景点', lat: 31, lng: 121, visited: false }]);
  results.miniProgram.markerFallback = {
    markers: indexPage.data.markers.length,
    hasIconPath: 'iconPath' in indexPage.data.markers[0],
  };
  assert.equal(indexPage.data.markers.length, 1);
  assert.equal('iconPath' in indexPage.data.markers[0], false);

  // 3.4 详情页分享带 place id
  detail.placeId = 42;
  detail.data.place = { id: 42, name: '某地点' };
  const share = detail.onShareAppMessage();
  const timeline = detail.onShareTimeline();
  results.miniProgram.share = { path: share.path, timeline: timeline.query };
  assert.match(share.path, /place=42/);
  assert.match(timeline.query, /place=42/);
}

// ---------------- 4. 测试套件 ----------------
const tests = spawnSync('npm', ['test'], {
  cwd: path.join(root, 'server'),
  encoding: 'utf8',
  timeout: 180000,
  maxBuffer: 20 * 1024 * 1024,
});
const testSummary = {};
for (const key of ['tests', 'pass', 'fail']) {
  const m = tests.stdout.match(new RegExp(`ℹ ${key} (\\d+)`));
  testSummary[key] = m ? Number(m[1]) : null;
}
results.tests = { ...testSummary, exitCode: tests.status };

results.summary = {
  staticOk:
    syntaxFailures.length === 0 &&
    jsonFailures.length === 0 &&
    missingPageFiles.length === 0 &&
    wxml.status === 0 &&
    wxss.status === 0,
  e2eSteps: results.endToEnd.length,
  e2eFailed: results.endToEnd.filter((s) => !s.ok).length,
  serverTests: results.tests,
};

fs.writeFileSync(
  path.join(here, 'fix-verification-results.json'),
  `${JSON.stringify(results, null, 2)}\n`
);
console.log(JSON.stringify(results.summary, null, 2));
console.log(`\n端到端步骤 ${results.summary.e2eSteps} 项、失败 ${results.summary.e2eFailed} 项`);
console.log(`服务端测试：${tests.stdout.match(/ℹ pass \d+/)?.[0]} / ${tests.stdout.match(/ℹ fail \d+/)?.[0]}`);
