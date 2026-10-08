import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
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
const results = [];
const serverErrors = [];
const originalError = console.error;
console.error = (err) => serverErrors.push({ type: err?.type, code: err?.code, message: err?.message });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const placeInput = { name: 'Audit location', category: '景点', lng: 121.4375, lat: 31.2054 };

async function fixture({ uploader, authEnabled = false } = {}) {
  const db = newDb();
  const pg = db.adapters.createPg();
  const pool = new pg.Pool();
  const store = createPlaceStore(pool);
  await store.init();
  const auth = authEnabled ? createAuth({ appid: 'audit-app', secret: 'audit-secret', signSecret: 'audit-signing-key', store, fetchSession: async () => ({ openid: 'audit-user' }) }) : undefined;
  const server = buildApp({ store, uploader, auth }).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (method, route, body, code, token) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(code === undefined ? {} : { 'x-map-code': code }),
        ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    return { status: response.status, data, headers: Object.fromEntries(response.headers) };
  };
  const seed = async (name = 'Audit map') => {
    const map = (await request('POST', '/api/maps', { name })).data;
    const place = (await request('POST', '/api/places', { ...placeInput, map_code: map.code })).data;
    return { map, place };
  };
  const upload = (map, place) => request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full: png, thumb: png });
  const close = async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
    await pool.end();
  };
  return { db, pool, store, auth, request, seed, upload, close };
}

async function record(id, name, run, options = {}) {
  const f = await fixture(options);
  try {
    const evidence = await run(f);
    results.push({ id, name, verification: id === 'CONTROL' ? 'control-passed' : 'reproduced', evidence });
    console.log(`${id}: ${name} -> ${JSON.stringify(evidence)}`);
  } finally { await f.close(); }
}

const configSource = fs.readFileSync(path.join(root, 'miniprogram/utils/config.js'), 'utf8').replace(/export /g, '');
const config = vm.runInNewContext(configSource + '\n({ CATEGORIES, categoryMeta });');
function page(relative, { api = {}, app = { globalData: {} }, wx = {}, storage = { KEYS: { sort: 'wish-sort' } } } = {}) {
  let definition;
  const context = {
    Page: (value) => { definition = value; },
    getApp: () => app,
    wx: { showToast() {}, showLoading() {}, hideLoading() {}, setStorageSync() {}, setNavigationBarTitle() {}, ...wx },
    require: (name) => name.includes('api.js') ? { api } : name.includes('config.js') ? config : name.includes('identity-behavior.js') ? {} : name.includes('auth.js') ? { requireIdentity: async () => 'Audit user' } : storage,
    setTimeout: () => 0,
    setInterval,
    clearInterval,
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'miniprogram/pages', relative), 'utf8'), context, { filename: relative });
  definition.data = structuredClone(definition.data);
  definition.setData = function (patch) { Object.assign(this.data, patch); };
  return definition;
}
function pageRecord(id, name, evidence, verification = 'reproduced-with-page-api-mocks') {
  results.push({ id, name, verification, evidence });
  console.log(`${id}: ${name} -> ${JSON.stringify(evidence)}`);
}

try {
  await record('CONTROL', 'Cross-map access remains isolated', async ({ seed, request }) => {
    const a = await seed('A');
    const b = await seed('B');
    const r = await request('PUT', `/api/places/${a.place.id}`, { name: 'Unexpected' }, b.map.code);
    assert.equal(r.status, 404);
    return { status: r.status };
  });

  await record('AUTH-OMISSION', 'Omitting the token bypasses identity stamping even when login is configured', async ({ seed, request, auth }) => {
    const { map } = await seed();
    const r = await request('POST', '/api/places', { ...placeInput, map_code: map.code, added_by: 'Impersonated author' });
    assert.equal(auth.configured, true);
    assert.equal(r.status, 201);
    assert.equal(r.data.added_by, 'Impersonated author');
    const edited = await request('PUT', `/api/places/${r.data.id}`, { added_by: 'Another fake author' }, map.code);
    assert.equal(edited.data.added_by, 'Another fake author');
    return { authConfigured: true, tokenProvided: false, createStatus: r.status, createAuthor: r.data.added_by, editedAuthor: edited.data.added_by };
  }, { authEnabled: true });

  await record('AUTH-DATABASE-FAILURE', 'An authentication database failure terminates an Express 4 server process', async () => {
    const childSource = `
      import { buildApp } from ${JSON.stringify(path.join(root, 'server/app.js'))};
      import { createAuth } from ${JSON.stringify(path.join(root, 'server/auth.js'))};
      const store = { async getUser() { throw new Error('Audit injected database outage'); } };
      const auth = createAuth({ appid: 'audit-app', secret: 'audit-secret', signSecret: 'audit-only', store });
      const server = buildApp({store, auth}).listen(0, '127.0.0.1', async () => {
        const timer = setTimeout(() => process.exit(2), 2000);
        try { await fetch('http://127.0.0.1:' + server.address().port + '/api/maps/ANY', { headers: { authorization: 'Bearer ' + auth.signToken('audit-user') } }); } catch {}
        clearTimeout(timer);
        server.closeAllConnections();
        server.close();
      });
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', childSource], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 1);
    assert.ok(child.stderr.includes('Audit injected database outage'));
    return { fault: 'store.getUser rejects', expected: 'HTTP 500 with live server', childExitCode: child.status, unhandledRejectionTerminatedServer: true, productionServerAffected: false };
  });

  await record('WISH-IDENTITY', 'Two authenticated users with the same nickname cancel each other vote', async ({ seed, store, auth, request }) => {
    const { map, place } = await seed();
    for (const openid of ['audit-a', 'audit-b']) { await store.ensureUser(openid); await store.setNickname(openid, 'Same nickname'); }
    const a = await request('POST', `/api/places/${place.id}/wish`, { map_code: map.code }, undefined, auth.signToken('audit-a'));
    const b = await request('POST', `/api/places/${place.id}/wish`, { map_code: map.code }, undefined, auth.signToken('audit-b'));
    assert.equal(a.data.wished, true);
    assert.equal(b.data.wished, false);
    return { distinctAuthenticatedUsers: 2, firstVote: a.data.wished, secondVote: b.data.wished, finalWishCount: b.data.wishes.length };
  }, { authEnabled: true });

  await record('PHOTO-SOFT-DELETE', 'Cached photo remains readable after soft delete', async ({ seed, upload, request }) => {
    const { map, place } = await seed();
    const photo = (await upload(map, place)).data;
    const route = `/api/photos/${photo.id}?map=${map.code}`;
    assert.equal((await request('GET', route)).status, 200);
    await request('DELETE', `/api/places/${place.id}`, undefined, map.code);
    const after = await request('GET', route);
    assert.equal(after.status, 200);
    return { expected: 404, actual: after.status, cacheControl: after.headers['cache-control'] };
  });

  await record('REKEY', 'Rekey leaves cached old-code photo, itinerary and subscriptions behind', async ({ seed, upload, request, store }) => {
    const { map, place } = await seed();
    const photo = (await upload(map, place)).data;
    await request('GET', `/api/photos/${photo.id}?map=${map.code}`);
    await request('PUT', '/api/itinerary', { map_code: map.code, place_ids: [place.id] });
    await store.saveSubscription({ mapCode: map.code, endpoint: 'https://audit.invalid/sub', p256dh: 'test', auth: 'test' });
    const changed = (await request('POST', `/api/maps/${map.code}/rekey`, {})).data;
    const oldMap = await request('GET', `/api/maps/${map.code}`);
    const oldPhoto = await request('GET', `/api/photos/${photo.id}?map=${map.code}`);
    const trip = (await request('GET', `/api/itinerary?map=${changed.code}`)).data;
    const oldSubs = await store.listSubscriptions(map.code);
    const newSubs = await store.listSubscriptions(changed.code);
    assert.equal(oldMap.status, 404);
    assert.equal(oldPhoto.status, 200);
    assert.equal(trip.stops.length, 0);
    assert.equal(oldSubs.length, 1);
    return { oldMapStatus: oldMap.status, oldPhotoStatus: oldPhoto.status, newItineraryCount: trip.stops.length, oldSubscriptionCount: oldSubs.length, newSubscriptionCount: newSubs.length };
  });

  await record('REKEY-COLLISION', 'A generated-code collision moves another map place into the original map', async ({ seed, request, store }) => {
    const a = await seed('A');
    const b = await seed('B');
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const previous = crypto.randomInt;
    let offset = 0;
    crypto.randomInt = () => alphabet.indexOf(b.map.code[offset++ % 6]);
    let response;
    try { response = await request('POST', `/api/maps/${a.map.code}/rekey`, {}); }
    finally { crypto.randomInt = previous; }
    const aPlaces = await store.listPlaces(a.map.code);
    const bPlaces = await store.listPlaces(b.map.code);
    assert.equal(response.status, 500);
    assert.ok(aPlaces.some((p) => p.id === b.place.id));
    assert.equal(bPlaces.length, 0);
    return { fault: 'force collision with map B on all five attempts', status: response.status, mapAPlaceCount: aPlaces.length, mapBPlaceCount: bPlaces.length };
  });

  await record('UPLOAD-THUMB', 'A 200 KiB photo sent as its own thumbnail is rejected by database storage', async ({ seed, request }) => {
    const { map, place } = await seed();
    const image = 'data:image/jpeg;base64,' + Buffer.alloc(200 * 1024).toString('base64');
    const r = await request('POST', `/api/places/${place.id}/photos`, { map_code: map.code, full: image, thumb: image });
    assert.equal(r.status, 400);
    return { fullAndThumbBytes: 200 * 1024, status: r.status, error: r.data.error, note: 'synthetic payload tests size handling, not image decoding' };
  });

  await record('UPLOAD-BODY', 'A 1.3 MiB photo duplicated into thumb exceeds the 3 MiB JSON limit', async ({ seed, request }) => {
    const { map, place } = await seed();
    const image = 'data:image/jpeg;base64,' + Buffer.alloc(Math.floor(1.3 * 1024 * 1024)).toString('base64');
    const body = { map_code: map.code, full: image, thumb: image };
    const r = await request('POST', `/api/places/${place.id}/photos`, body);
    assert.equal(r.status, 500);
    return { originalBytes: Math.floor(1.3 * 1024 * 1024), jsonBytes: Buffer.byteLength(JSON.stringify(body)), expected: 413, actual: r.status, error: r.data.error };
  });

  await record('COORD-TYPE', 'Null and boolean coordinates are coerced to zero', async ({ seed, request }) => {
    const { map } = await seed();
    const r = await request('POST', '/api/places', { ...placeInput, map_code: map.code, lng: null, lat: false });
    assert.equal(r.status, 201);
    assert.equal(r.data.lng, 0);
    assert.equal(r.data.lat, 0);
    return { expected: 400, actual: r.status, storedLng: r.data.lng, storedLat: r.data.lat };
  });

  await record('RESTORE-EXPIRED', 'A 31-day deleted place can be restored without first opening trash', async ({ seed, request, pool }) => {
    const { map, place } = await seed();
    await request('DELETE', `/api/places/${place.id}`, undefined, map.code);
    await pool.query('UPDATE public.places SET deleted_at = $1 WHERE id = $2', [new Date(Date.now() - 31 * 86400000), place.id]);
    const r = await request('POST', `/api/places/${place.id}/restore`, { map_code: map.code });
    assert.equal(r.status, 200);
    return { deletedDaysAgo: 31, expected: 404, actual: r.status };
  });

  await record('EXPORT-DB-PHOTO', 'JSON export omits stored photo contents and itinerary', async ({ seed, upload, request }) => {
    const { map, place } = await seed();
    await upload(map, place);
    await request('PUT', '/api/itinerary', { map_code: map.code, place_ids: [place.id] });
    const exported = (await request('GET', `/api/maps/${map.code}/export`)).data;
    const photo = exported.places[0].photos[0];
    assert.equal(photo.url, '');
    assert.equal(photo.thumb_url, '');
    assert.equal(photo.full_b64, undefined);
    return { photoUrl: photo.url, photoThumbUrl: photo.thumb_url, photoContainsImageData: Object.hasOwn(photo, 'full_b64'), containsItinerary: Object.hasOwn(exported, 'itinerary') };
  });

  await record('UNSUBSCRIBE-AUTH', 'An invalid nonempty map code can unsubscribe another map endpoint', async ({ seed, store, request }) => {
    const { map } = await seed();
    const endpoint = 'https://audit.invalid/private-endpoint';
    await store.saveSubscription({ mapCode: map.code, endpoint, p256dh: 'test', auth: 'test' });
    const r = await request('DELETE', '/api/push/subscribe', { endpoint }, 'NOT-A-MAP');
    const remaining = await store.listSubscriptions(map.code);
    assert.equal(r.status, 204);
    assert.equal(remaining.length, 0);
    return { invalidMapCodeAccepted: true, status: r.status, remainingSubscriptions: remaining.length };
  });

  await record('PUSH-ENDPOINT', 'Subscription API accepts loopback destinations and pusher builds an outbound HTTPS request', async ({ seed, request, store }) => {
    const { map } = await seed();
    const r = await request('POST', '/api/push/subscribe', { map_code: map.code, subscription: { endpoint: 'https://127.0.0.1:12345/internal', keys: { p256dh: 'not-a-key', auth: 'not-a-key' } } });
    assert.equal(r.status, 201);
    const webpush = requireServer('web-push');
    const keys = webpush.generateVAPIDKeys();
    const client = crypto.createECDH('prime256v1');
    client.generateKeys();
    await store.saveSubscription({ mapCode: map.code, endpoint: 'https://127.0.0.1:12345/internal', p256dh: client.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url') });
    const { createPusher } = await import(path.join(root, 'server/pusher.js'));
    const pusher = createPusher({ ...keys, subject: 'mailto:audit@example.invalid', store });
    const previous = https.request;
    let destination;
    https.request = (options, callback) => {
      destination = { hostname: options.hostname, port: options.port, path: options.path, method: options.method, timeoutConfigured: Boolean(options.timeout) };
      const req = new EventEmitter();
      req.write = () => {};
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 201;
        res.headers = {};
        callback(res);
        queueMicrotask(() => res.emit('end'));
      };
      return req;
    };
    try { await pusher.notifyMap(map.code, { title: 'Audit' }); }
    finally { https.request = previous; }
    assert.equal(destination.hostname, '127.0.0.1');
    return { status: r.status, outboundRequestOptions: destination, transportIntercepted: true, realNetworkRequestSent: false };
  });

  await record('ITINERARY-ATOMICITY', 'A failed second INSERT leaves an incomplete replacement itinerary', async ({ seed, store, pool }) => {
    const { map, place } = await seed();
    const second = await store.create({ ...placeInput, name: 'Second', map_code: map.code });
    await store.setItinerary(map.code, [place.id, second.id]);
    const previous = pool.query.bind(pool);
    let inserts = 0;
    pool.query = async (sql, values) => {
      if (sql.startsWith('INSERT INTO itinerary_stops') && ++inserts === 2) throw new Error('Audit injected database failure');
      return previous(sql, values);
    };
    let failed = false;
    try { await store.setItinerary(map.code, [second.id, place.id]); } catch { failed = true; }
    finally { pool.query = previous; }
    const remaining = await store.listItinerary(map.code);
    assert.equal(failed, true);
    assert.equal(remaining.length, 1);
    return { fault: 'second itinerary INSERT fails', previousStopCount: 2, actualStopCountAfterFailure: remaining.length, previousOrderPreserved: false };
  });

  let arrivals = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await record('PHOTO-CONCURRENCY', 'Two concurrent uploads bypass the nine-photo limit', async ({ seed, store, request }) => {
    const { map, place } = await seed();
    for (let i = 0; i < 8; i++) await store.createPhoto({ placeId: place.id, mapCode: map.code, mime: 'image/png', fullB64: png.split(',')[1], thumbB64: png.split(',')[1] });
    const body = { map_code: map.code, full: png, thumb: png };
    const responses = await Promise.all([request('POST', `/api/places/${place.id}/photos`, body), request('POST', `/api/places/${place.id}/photos`, body)]);
    const count = await store.countPhotos(place.id, map.code);
    assert.equal(count, 10);
    return { initialPhotoCount: 8, uploadStatuses: responses.map((r) => r.status), expectedMaximum: 9, actualPhotoCount: count };
  }, { uploader: { configured: true, async upload() { const id = ++arrivals; if (arrivals === 2) release(); await gate; return { publicId: `audit-${id}`, url: `https://audit.invalid/${id}.png`, thumbUrl: `https://audit.invalid/${id}-thumb.png` }; } } });

  const sorting = page('index/index.js');
  sorting.data.places = [
    { id: 1, name: 'A', category: '景点', wishes: ['one', 'two'] },
    { id: 2, name: 'Z', category: '景点', wishes: [] },
  ];
  sorting.onSortChange({ detail: { value: '1' } });
  const nameOrder = sorting.data.filtered.map((p) => p.id);
  sorting.onSortChange({ detail: { value: '2' } });
  const wishOrder = sorting.data.filtered.map((p) => p.id);
  assert.equal(nameOrder.join(','), '2,1');
  assert.equal(wishOrder.join(','), '2,1');
  pageRecord('PAGE-SORT', 'Picker indices never match name/wishes sort keys', { nameOrder, wishOrder, expectedBoth: [1, 2] });

  let resolveJoin;
  const joined = new Promise((resolve) => { resolveJoin = resolve; });
  const app = { globalData: { map: null, isPublicView: true }, enterMap(map) { this.globalData.map = map; this.globalData.isPublicView = false; } };
  const index = page('index/index.js', { app, api: { getMap: () => joined, publicPlaces: async () => [{ id: 100, name: 'Public', category: '景点' }], listPlaces: async () => [{ id: 200, name: 'Private', category: '景点' }] } });
  const pendingJoin = index.joinByCode('AUDIT2');
  index.onShow();
  await new Promise((resolve) => setImmediate(resolve));
  resolveJoin({ code: 'AUDIT2', name: 'Joined map' });
  await pendingJoin;
  assert.equal(index.data.mapName, 'Joined map');
  assert.equal(index.data.places[0].id, 200);
  assert.equal(index.data.isPublicView, false);
  pageRecord('PAGE-SHARE-JOIN', 'Latest revision correctly refreshes the page after a shared-link join', { globalMap: app.globalData.map.name, displayedMap: index.data.mapName, displayedPlace: index.data.places[0].id, viewStillPublic: index.data.isPublicView }, 'control-passed-fixed-since-b1fa516');

  let failLoad = false;
  const staleApp = { globalData: { map: { code: 'AUDITA', name: 'A' }, isPublicView: false } };
  const stale = page('index/index.js', { app: staleApp, api: { listPlaces: async () => { if (failLoad) throw new Error('Network unavailable'); return [{ id: 1, name: 'A place', category: '景点' }]; } } });
  stale.onShow();
  await new Promise((resolve) => setImmediate(resolve));
  staleApp.globalData.map = { code: 'AUDITB', name: 'B' };
  failLoad = true;
  stale.onShow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stale.data.mapName, 'B');
  assert.equal(stale.data.places[0].name, 'A place');
  pageRecord('PAGE-STALE-DATA', 'Failed map switch displays previous map data under the new map name', { displayedMap: stale.data.mapName, displayedPlace: stale.data.places[0].name, loading: stale.data.loading });

  const importPage = page('import/import.js');
  importPage.data.raw = 'https://uri.amap.com/marker?position=121.4375,31.2054&name=%E0%A4%A';
  let parseError;
  try { importPage.parse(); } catch (error) { parseError = error.name; }
  assert.equal(parseError, 'URIError');
  pageRecord('PAGE-IMPORT', 'Malformed URL percent encoding throws without a user-facing error', { actualException: parseError });

  const detail = page('detail/detail.js', { app: { globalData: { map: { code: 'AUDITA', name: 'A' } } }, wx: { chooseMedia: async () => { throw new Error('chooseMedia:fail cancel'); } } });
  let cancelRejected = false;
  try { await detail.addPhoto(); } catch { cancelRejected = true; }
  assert.equal(cancelRejected, false);
  pageRecord('PAGE-PHOTO-CANCEL', 'Latest revision handles photo picker cancellation', { handlerRejects: cancelRejected }, 'control-passed-fixed-since-b1fa516');
  detail.data.place = { id: 42, name: 'Shared place' };
  const shared = detail.onShareAppMessage();
  assert.equal(shared.path.includes('42'), false);
  pageRecord('PAGE-DETAIL-SHARE', 'Place detail share path omits the place ID', { actualPath: shared.path, containsPlaceId: false });

  const poster = page('poster/poster.js', { app: { globalData: { map: { code: 'AUDITA', name: 'A' } } }, api: { listPlaces: async () => { throw new Error('Network unavailable'); } } });
  poster.draw = async () => {};
  await poster.generate();
  assert.equal(poster.data.ready, true);
  assert.equal(poster.data.stats.total, 0);
  pageRecord('PAGE-POSTER-ERROR', 'A failed API request still generates a ready zero-statistics poster', { ready: poster.data.ready, total: poster.data.stats.total });

  const nearby = page('index/index.js', { wx: { getLocation(options) { options.success({ latitude: 31.2054, longitude: 121.4375 }); options.complete(); } } });
  nearby.data.places = Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Place ${i + 1}`, category: '景点', lat: 31.2054, lng: 121.4375 + i / 1000 })).reverse();
  nearby.locateNearby();
  assert.equal(nearby.data.nearbyPlaces.length, 5);
  assert.equal(nearby.data.nearbyPlaces[0].id, 1);
  pageRecord('PAGE-NEARBY', 'Nearby sorting selects the nearest five locations', { resultCount: nearby.data.nearbyPlaces.length, nearestId: nearby.data.nearbyPlaces[0].id, showLocation: nearby.data.showLocation }, 'control-passed-with-location-mock');
  nearby.drawRandom();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  assert.equal(nearby.data.randomDrawing, false);
  assert.ok(nearby.data.places.some((p) => p.id === nearby.data.randomPlace.id));
  nearby.closeRandom();
  assert.equal(nearby.randomTimer, null);
  pageRecord('PAGE-RANDOM', 'Random drawing completes and closing it clears the timer', { drawingCompleted: true, resultBelongsToMap: true, timerCleared: true }, 'control-passed-with-page-api-mocks');

  const commit = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).stdout.trim();
  const report = { auditedAt: new Date().toISOString(), commit, nodeVersion: process.version, database: 'isolated pg-mem only', productionMutations: false, interpretation: 'reproduced means the defect was observed; it does not mean the feature passed', scenarios: results, serverErrors };
  fs.writeFileSync(path.join(here, 'reproduction-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Recorded ${results.length} scenarios.`);
} finally { console.error = originalError; }
