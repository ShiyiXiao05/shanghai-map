import { BASE_URL, CLOUD_ENV_ID, CLOUD_SERVICE_NAME } from './config.js';
import { getAuthToken } from './storage.js';
import { loadMedia, readPlaces, fresh, savePlaces, upsertPlace, findPlace, removePlace, clearMedia } from './cache.js';
const cache = { loadMedia, readPlaces, fresh, savePlaces, upsertPlace, findPlace, removePlace, clearMedia };

// 与网页版 api.js 对齐的完整 API 封装。
// 配置了 CLOUD_ENV_ID 时走微信云托管 callContainer 通道（免域名备案，正式版可用）；
// 留空时回落 wx.request 直连 BASE_URL（体验版/本地调试，需勾选「不校验合法域名」）。
// 两种通道的 success 回调同为 { statusCode, data } 结构，页面代码无感知。
// 已登录时自动携带 Bearer token：服务端据此把署名（added_by/author/who）盖章为登录昵称

// 请求超时：兜底 15s，避免弱网下 Promise 永不 settle（服务端还有温和限流，客户端不做高频重试）
const REQUEST_TIMEOUT = 15000;

// 401 恢复回调由 auth.js 在模块顶层注册（避免 api.js ↔ auth.js 循环依赖）；
// 未注册时回退到 require('./auth.js')，保证任何加载顺序都能工作
let authRecovery = null;

export function setAuthRecovery(fn) {
  authRecovery = typeof fn === 'function' ? fn : null;
}

async function recoverAuth(error) {
  const handler = authRecovery || ((opts) => require('./auth.js').ensureLogin(opts));
  await handler({ force: getAuthToken() === error.authToken });
}

function sendRequest(method, path, { body, mapCode } = {}) {
  return new Promise((resolve, reject) => {
    const token = getAuthToken();
    const header = {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(mapCode !== undefined ? { 'x-map-code': mapCode } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    };
    const success = (res) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        resolve(res.data ?? null);
        return;
      }
      const error = new Error((res.data && res.data.error) || `请求失败（${res.statusCode}）`);
      error.status = res.statusCode;
      error.code = res.data && res.data.code;
      error.authToken = token;
      reject(error);
    };
    // 网络层失败不带 status，供上层区分「网络异常」与「HTTP 错误码」
    const fail = (err) => reject(new Error('网络异常：' + ((err && err.errMsg) || '请求未完成')));
    if (CLOUD_ENV_ID) {
      wx.cloud.callContainer({
        config: { env: CLOUD_ENV_ID },
        path,
        method,
        data: body ?? undefined,
        header: { ...header, 'X-WX-SERVICE': CLOUD_SERVICE_NAME },
        timeout: REQUEST_TIMEOUT,
        success,
        fail,
      });
    } else {
      wx.request({
        url: BASE_URL + path,
        method,
        data: body ?? undefined,
        header,
        timeout: REQUEST_TIMEOUT,
        success,
        fail,
      });
    }
  });
}

async function request(method, path, opts) {
  let authRetried = false;
  let networkRetried = false;
  for (;;) {
    try {
      return await sendRequest(method, path, opts);
    } catch (err) {
      // 登录过期：重新登录后原样重放一次（写请求也重放，因为服务端未执行）
      if (
        !authRetried &&
        err.status === 401 &&
        err.code === 'AUTH_EXPIRED' &&
        path !== '/api/auth/login'
      ) {
        authRetried = true;
        await recoverAuth(err); // 恢复失败（登录接口 503/超时）时直接抛出，不再重放
        continue;
      }
      // 幂等 GET 网络失败重试 1 次；写请求不自动重试，避免重复写入
      if (!networkRetried && method === 'GET' && err.status === undefined) {
        networkRetried = true;
        continue;
      }
      throw err;
    }
  }
}

function get(path) {
  return request('GET', path);
}

export const api = {
  health: () => get('/api/health'),

  // 上传配置：{ cdn, maxFullBytes, maxThumbBytes }；无需邀请码、无需登录
  uploadConfig: () => get('/api/upload-config'),

  // 登录（小程序）：code 换 token；昵称由服务端盖章，写接口不再传署名字段
  login: (code) => request('POST', '/api/auth/login', { body: { code } }),
  updateProfile: (nickname) =>
    request('POST', '/api/auth/profile', { body: { nickname } }).then((d) => d.nickname),

  // 地图
  createMap: (data) => request('POST', '/api/maps', { body: data }),
  getMap: (code) => get(`/api/maps/${encodeURIComponent(code)}`),
  renameMap: (code, name) => request('PUT', `/api/maps/${encodeURIComponent(code)}`, { body: { name } }),
  deleteMap: (code) => request('DELETE', `/api/maps/${encodeURIComponent(code)}`),
  memories: (code) => get(`/api/maps/${encodeURIComponent(code)}/memories`).then((d) => d.memories),

  // 地点
  listPlaces: (code, { force = false } = {}) =>
    Promise.resolve().then(() => {
      const entry = cache.readPlaces(code);
      if (!force && cache.fresh(entry)) return entry.places;
      return get(`/api/places?map=${encodeURIComponent(code)}`).then((d) => {
        cache.savePlaces(code, d.places);
        return d.places;
      });
    }),
  // 地点关键词搜索：服务端代理高德，小程序端不需要 key、也不加请求域名
  // 返回 [{ id, name, address, lng, lat, category }]；失败抛带中文 message 的 Error
  searchPlaces: (keyword, city) =>
    get(
      `/api/geo/search?keyword=${encodeURIComponent(keyword)}${city ? `&city=${encodeURIComponent(city)}` : ''}`
    ).then((d) => (d && d.places) || []),
  createPlace: (code, data) =>
    request('POST', '/api/places', { body: { ...data, map_code: code } }).then((place) => {
      if (place && place.id !== undefined) cache.upsertPlace(code, place);
      return place;
    }),
  updatePlace: (code, id, patch) =>
    request('PUT', `/api/places/${id}`, { body: patch, mapCode: code }).then((place) => {
      if (place && place.id !== undefined) cache.upsertPlace(code, place);
      return place;
    }),
  deletePlace: (code, id) => request('DELETE', `/api/places/${id}`, { mapCode: code }).then(() => { cache.removePlace(code, id); }),
  toggleWish: (code, id) =>
    request('POST', `/api/places/${id}/wish`, { body: { map_code: code } }).then((result) => {
      const place = cache.findPlace(code, id);
      if (place) cache.upsertPlace(code, { ...place, wishes: result.wishes || [] });
      return result;
    }),
  togglePublic: (code, id) =>
    request('POST', `/api/places/${id}/public`, { body: { map_code: code } }).then((result) => {
      const place = cache.findPlace(code, id);
      if (place) cache.upsertPlace(code, { ...place, is_public: result.is_public });
      return result;
    }),

  // 行程单
  itinerary: (code) =>
    get(`/api/itinerary?map=${encodeURIComponent(code)}`).then((d) => d.stops),
  setItinerary: (code, placeIds) =>
    request('PUT', '/api/itinerary', { body: { map_code: code, place_ids: placeIds } }).then(
      (d) => d.stops
    ),

  // 照片
  listPhotos: (code, placeId, { force = false } = {}) =>
    cache.loadMedia(code, placeId, 'photos', () => get(`/api/places/${placeId}/photos?map=${encodeURIComponent(code)}`).then((d) => d.photos), force),
  // CDN 模式（cfg.cdn=true）只传 full，服务端自行派生缩略图；无 CDN 时 thumb 必传
  uploadPhoto: (code, placeId, { full, thumb }) =>
    request('POST', `/api/places/${placeId}/photos`, {
      body: { map_code: code, full, ...(thumb ? { thumb } : {}) },
    }).then((result) => { cache.clearMedia(code, placeId); return result; }),
  // 注意：这里硬编码了 Render 域名 BASE_URL。云托管通道（CLOUD_ENV_ID）下仍依赖 Render：
  // 存量 DB 照片只能通过该端点取出；后续若迁移到服务端下发 URL，再统一替换
  photoUrl: (code, photoId) =>
    `${BASE_URL}/api/photos/${photoId}?map=${encodeURIComponent(code)}`,
  deletePhoto: (code, photoId) => request('DELETE', `/api/photos/${photoId}`, { mapCode: code }),

  // 留言
  listComments: (code, placeId, { force = false } = {}) =>
    cache.loadMedia(code, placeId, 'comments', () => get(`/api/places/${placeId}/comments?map=${encodeURIComponent(code)}`).then((d) => d.comments), force),
  createComment: (code, placeId, body) =>
    request('POST', `/api/places/${placeId}/comments`, {
      body: { map_code: code, body },
    }).then((result) => { cache.clearMedia(code, placeId); return result; }),
  deleteComment: (code, commentId) =>
    request('DELETE', `/api/comments/${commentId}`, { mapCode: code }),

  // 回收站（服务端 30 天软删）：列表与恢复
  trash: (code) =>
    get(`/api/places?map=${encodeURIComponent(code)}&view=trash`).then((d) => d.places),
  restorePlace: (code, id) =>
    request('POST', `/api/places/${id}/restore`, { body: { map_code: code } }),
  // 换邀请码（权限重置）：返回 { code, name, created_by }，旧码立即失效
  rekey: (code) => request('POST', `/api/maps/${encodeURIComponent(code)}/rekey`, { body: {} }),

  // 内容举报：UGC 合规入口。地图内内容带 map_code；公共广场内容可不带（只允许举报公开内容）
  report: (data) => request('POST', '/api/reports', { body: data }),

  // 公共广场
  publicPlaces: () => get('/api/public/places').then((d) => d.places),
  // 公共广场单个地点（只读、无邀请码）：详情页冷启动直达时用，非公开/已删除返回 404
  publicPlace: (id) => get(`/api/public/places/${id}`).then((d) => d.place),
};
