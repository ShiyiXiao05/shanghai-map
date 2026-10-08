import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../../..');
const requireServer = createRequire(path.join(root, 'server/package.json'));
const { newDb } = requireServer('pg-mem');
const { buildApp } = await import(path.join(root, 'server/app.js'));
const { createPlaceStore } = await import(path.join(root, 'server/store.js'));
const { createContentSecurity } = await import(path.join(root, 'server/content-security.js'));
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const input = { name: 'Local review place', category: '\u666f\u70b9', lng: 121.47, lat: 31.23 };
const results = [];
const warnings = [];
const errors = [];
const originalWarn = console.warn;
const originalError = console.error;
console.warn = (...args) => warnings.push(args.map(String).join(' '));
console.error = (...args) => errors.push(args.map((v) => v?.message || String(v)).join(' '));

async function fixture({ uploader, contentSecurity } = {}) {
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const server = buildApp({ store, uploader, contentSecurity: contentSecurity || {
    checkText: async () => ({ checked: false, pass: true }),
  } }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(method, route, body) {
    const response = await fetch(base + route, {
      method,
      redirect: 'manual',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, data, text, bytes: Buffer.byteLength(text), headers: Object.fromEntries(response.headers) };
  }
  async function seed(name = 'Local review map') {
    const map = (await request('POST', '/api/maps', { name })).data;
    const place = (await request('POST', '/api/places', { ...input, map_code: map.code })).data;
    assert.ok(map.code && place.id);
    return { map, place };
  }
  return { db, pool, store, request, seed, close: async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await pool.end();
  } };
}

async function record(id, run, options) {
  const f = await fixture(options);
  try {
    const evidence = await run(f);
    results.push({ id, status: 'reproduced', evidence });
    console.log(`${id}: ${JSON.stringify(evidence)}`);
  } catch (error) {
    results.push({ id, status: 'verification-failed', error: error.stack });
    console.log(`${id}: VERIFICATION FAILED: ${error.message}`);
  } finally {
    await f.close();
  }
}

const callbackToken = 'local-review-token';
const timestamp = '1791400000';
const nonce = 'local-review-nonce';
const signature = crypto.createHash('sha1').update([callbackToken, timestamp, nonce].sort().join('')).digest('hex');
const callbackPath = `/api/wechat/media-check-callback?signature=${signature}&timestamp=${timestamp}&nonce=${nonce}`;
const verifier = createContentSecurity({ msgToken: callbackToken });
const cdnUploader = {
  configured: true,
  upload: async () => ({ publicId: 'local-review-photo', url: 'https://cdn.example/photo.png', thumbUrl: 'https://cdn.example/thumb.png' }),
  destroy: async () => {},
};

try {
  await record('R01-MODERATION-CACHE', async ({ seed, request, store }) => {
    const { map, place } = await seed();
    const upload = await request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full: png });
    assert.equal(upload.status, 201);
    const id = upload.data.id;
    const before = await request('GET', `/api/photos/${id}?map=${map.code}`);
    assert.equal(before.status, 302);
    const pendingList = await request('GET', `/api/places/${place.id}/photos?map=${map.code}`);
    const callback = await request('POST', callbackPath, { trace_id: 'local-trace-cache', result: { suggest: 'risky' } });
    assert.equal(callback.status, 200);
    const afterList = await request('GET', `/api/places/${place.id}/photos?map=${map.code}`);
    const cachedPhoto = await request('GET', `/api/photos/${id}?map=${map.code}`);
    assert.equal(afterList.data.photos.length, 0);
    assert.equal(cachedPhoto.status, 302);
    return { pendingVisibleCount: pendingList.data.photos.length, riskyVisibleCount: afterList.data.photos.length, riskyRawStatus: cachedPhoto.status, cacheEntries: store.__photoCacheStats().size };
  }, { uploader: cdnUploader, contentSecurity: {
    checkText: async () => ({ pass: true }),
    mediaCheckAsync: async () => ({ submitted: true, traceId: 'local-trace-cache' }),
    verifyCallback: verifier.verifyCallback,
  } });

  let raceRequest;
  await record('R02-CALLBACK-RACE', async ({ seed, request, pool }) => {
    raceRequest = request;
    const { map, place } = await seed();
    const upload = await request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full: png });
    const rows = (await pool.query('SELECT moderation, trace_id FROM place_photos')).rows;
    const list = await request('GET', `/api/places/${place.id}/photos?map=${map.code}`);
    assert.equal(upload.status, 201);
    assert.equal(rows[0].moderation, 'pending');
    assert.equal(list.data.photos.length, 1);
    return { earlyCallbackAcknowledged: true, finalModeration: rows[0].moderation, visiblePhotos: list.data.photos.length };
  }, { uploader: cdnUploader, contentSecurity: {
    checkText: async () => ({ pass: true }),
    async mediaCheckAsync() {
      const response = await raceRequest('POST', callbackPath, { trace_id: 'local-trace-race', result: { suggest: 'risky' } });
      assert.equal(response.status, 200);
      return { submitted: true, traceId: 'local-trace-race' };
    },
    verifyCallback: verifier.verifyCallback,
  } });

  await record('R03-REKEY-COLLISION', async ({ seed, request, store }) => {
    const a = await seed('Map A');
    const b = await seed('Map B');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const freshCode = ['ZZZZZZ', 'YYYYYY', 'XXXXXX'].find((code) => code !== a.map.code && code !== b.map.code);
    const previous = crypto.randomInt;
    let i = 0;
    crypto.randomInt = () => {
      const code = i < 6 ? b.map.code : freshCode;
      return alphabet.indexOf(code[i++ % 6]);
    };
    let changed;
    try { changed = await request('POST', `/api/maps/${a.map.code}/rekey`, {}); }
    finally { crypto.randomInt = previous; }
    assert.equal(changed.status, 200);
    const placesA = await store.listPlaces(changed.data.code);
    const placesB = await store.listPlaces(b.map.code);
    assert.equal(placesA.length, 2);
    assert.equal(placesB.length, 0);
    return { fault: 'first generated code collides with Map B; second is unique', rekeyStatus: changed.status, mapAPlaces: placesA.length, mapBPlaces: placesB.length };
  });

  await record('R04-REPORT-MIGRATION', async ({ seed, request, store, pool }) => {
    const { map, place } = await seed();
    const report = await store.createReport({ targetType: 'place', targetId: place.id, mapCode: map.code, reason: 'Local review' });
    const changed = await request('POST', `/api/maps/${map.code}/rekey`, {});
    const list = await request('GET', `/api/reports?map=${changed.data.code}`);
    const resolve = await request('POST', `/api/reports/${report.id}/resolve`, { map_code: changed.data.code });
    assert.equal(list.data.reports.length, 0);
    assert.equal(resolve.status, 404);
    await request('DELETE', `/api/maps/${changed.data.code}`);
    const orphanCount = Number((await pool.query('SELECT count(*) AS n FROM content_reports')).rows[0].n);
    assert.equal(orphanCount, 1);
    return { reportsBeforeRekey: 1, reportsAfterRekey: list.data.reports.length, resolveWithNewCodeStatus: resolve.status, orphanReportsAfterMapDelete: orphanCount };
  });

  let destroyed = 0;
  await record('R05-CDN-DB-FAILURE', async ({ seed, request, store }) => {
    const { map, place } = await seed();
    store.createPhoto = async () => { throw new Error('Injected local database write failure'); };
    const uploaded = await request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full: png });
    assert.equal(uploaded.status, 500);
    assert.equal(destroyed, 0);
    return { uploadStatus: uploaded.status, uploadedCdnResources: 1, cleanedCdnResources: destroyed };
  }, { uploader: { ...cdnUploader, destroy: async () => { destroyed += 1; } } });

  await record('R06-RISKY-PHOTO-QUOTA', async ({ seed, store, request }) => {
    const { map, place } = await seed();
    for (let i = 0; i < 9; i += 1) {
      const photo = await store.createPhoto({ placeId: place.id, mapCode: map.code, mime: 'image/png', fullB64: png.split(',')[1] });
      await store.setPhotoModeration(photo.id, { moderation: 'risky' });
    }
    const list = await request('GET', `/api/places/${place.id}/photos?map=${map.code}`);
    const upload = await request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full: png });
    assert.equal(list.data.photos.length, 0);
    assert.equal(upload.status, 400);
    return { visiblePhotos: 0, storedPhotos: await store.countPhotos(place.id, map.code), uploadStatus: upload.status, message: upload.data.error };
  });

  await record('R07-DB-THUMB-AND-EXPORT', async ({ seed, request }) => {
    const { map, place } = await seed();
    // A large declared image is enough to test the byte contract; this does not test image decoding.
    const full = `data:image/png;base64,${Buffer.alloc(800 * 1024).toString('base64')}`;
    const upload = await request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full });
    assert.equal(upload.status, 201);
    const list = await request('GET', `/api/places/${place.id}/photos?map=${map.code}`);
    const exported = await request('GET', `/api/maps/${map.code}/export`);
    const photo = exported.data.places[0].photos[0];
    assert.ok(list.bytes > 1000 * 1024);
    assert.equal(photo.url, '');
    assert.equal(photo.thumb_url, '');
    assert.equal(Object.hasOwn(photo, 'full_b64'), false);
    return { declaredImageBytes: 800 * 1024, uploadStatus: upload.status, photoListResponseBytes: list.bytes, exportedUrl: photo.url, exportedThumbUrl: photo.thumb_url, exportedImageData: false };
  });

  await record('R10-HEALTH-DB-FAILURE', async ({ request, pool }) => {
    const originalQuery = pool.query.bind(pool);
    pool.query = async () => { throw new Error('Injected database outage'); };
    try {
      const health = await request('GET', '/api/health');
      const places = await request('GET', '/api/public/places');
      assert.equal(health.status, 200);
      assert.equal(health.data.ok, true);
      assert.equal(places.status, 500);
      return { databaseAvailable: false, healthStatus: health.status, healthOk: health.data.ok, publicPlacesStatus: places.status };
    } finally { pool.query = originalQuery; }
  });

  const requests = [];
  const security = createContentSecurity({ appid: 'local-app', secret: 'local-secret', msgToken: callbackToken, logger: { warn() {} }, fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ api: new URL(url).pathname, body, hasAbortSignal: !!options.signal });
    return { json: async () => url.includes('stable_token') ? { access_token: 'local-token', expires_in: 7200 } : { errcode: 40003, errmsg: 'Injected missing openid validation failure' } };
  } });
  const textResult = await security.checkText('Local anonymous text');
  const mediaResult = await security.mediaCheckAsync('https://cdn.example/photo.png');
  assert.equal(textResult.pass, true);
  assert.equal(textResult.checked, false);
  assert.equal(mediaResult.submitted, false);
  assert.equal(requests.some((r) => Object.hasOwn(r.body, 'openid')), false);
  results.push({ id: 'R08-ANONYMOUS-SECURITY-CONTRACT', status: 'reproduced-with-vendor-error-mock', evidence: { textResult, mediaResult, requests } });

  let releaseCheck;
  let submittedSignal;
  const slowSecurity = createContentSecurity({ appid: 'local-app', secret: 'local-secret', fetchImpl: async (url, options) => {
    if (url.includes('stable_token')) return { json: async () => ({ access_token: 'local-token', expires_in: 7200 }) };
    submittedSignal = options.signal;
    return new Promise((resolve) => { releaseCheck = resolve; });
  } });
  const pendingCheck = slowSecurity.checkText('Local delayed text');
  const state = await Promise.race([pendingCheck.then(() => 'settled'), new Promise((resolve) => setTimeout(() => resolve('pending'), 100))]);
  assert.equal(state, 'pending');
  assert.equal(submittedSignal, undefined);
  releaseCheck({ json: async () => ({ errcode: 0, result: { suggest: 'pass' } }) });
  await pendingCheck;
  results.push({ id: 'R11-VENDOR-TIMEOUT', status: 'reproduced-with-delayed-vendor-mock', evidence: { observationMs: 100, stateDuringDelay: state, requestHasAbortSignal: false, scope: 'absence of application deadline; no real WeChat outage simulated' } });

  const configSource = fs.readFileSync(path.join(root, 'miniprogram/utils/config.js'), 'utf8').replace(/export /g, '');
  const config = vm.runInNewContext(`${configSource}\n({CATEGORIES,categoryMeta})`);
  const app = { globalData: { map: { code: 'PRIV23', name: 'Private Map' }, isPublicView: false } };
  let page;
  let reported;
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/pages/detail/detail.js'), 'utf8'), {
    getApp: () => app,
    Page: (value) => { page = value; },
    wx: { setNavigationBarTitle() {}, showToast() {}, showActionSheet: ({ success }) => success({ tapIndex: 0 }) },
    require: (name) => name.includes('api.js') ? { api: {
      listPlaces: async () => [],
      publicPlace: async () => ({ ...input, id: 789, is_public: true }),
      report: async (body) => { reported = body; },
    } } : name.includes('config.js') ? config : {},
  });
  page.data = structuredClone(page.data);
  page.setData = function (patch) { Object.assign(this.data, patch); };
  page.placeId = 789;
  await page.refresh();
  assert.equal(page.data.isPublicView, true);
  const share = page.onShareAppMessage();
  const timeline = page.onShareTimeline();
  page.report();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(share.path.includes('map=PRIV23'));
  assert.ok(timeline.query.includes('map=PRIV23'));
  assert.equal(reported.map_code, 'PRIV23');
  results.push({ id: 'R09-PUBLIC-SHARE-PRIVATE-MAP', status: 'reproduced-with-page-api-mocks', evidence: { publicReadOnlyView: page.data.isPublicView, sharePath: share.path, timelineQuery: timeline.query, reportMapCode: reported.map_code } });
} finally {
  console.warn = originalWarn;
  console.error = originalError;
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
  const output = { revision, generatedAt: new Date().toISOString(), database: 'isolated pg-mem only', externalServices: 'mocked; no production mutations', results, warnings, errors };
  fs.writeFileSync(path.join(here, 'results.json'), JSON.stringify(output, null, 2) + '\n');
  console.log(`Recorded ${results.length} cases; failures: ${results.filter((r) => r.status === 'verification-failed').length}`);
  if (results.some((r) => r.status === 'verification-failed')) process.exitCode = 1;
}
