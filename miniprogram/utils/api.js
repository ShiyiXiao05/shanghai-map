import { BASE_URL, CLOUD_ENV_ID, CLOUD_SERVICE_NAME } from './config.js';
import { getAuthToken } from './storage.js';

// 与网页版 api.js 对齐的完整 API 封装。
// 配置了 CLOUD_ENV_ID 时走微信云托管 callContainer 通道（免域名备案，正式版可用）；
// 留空时回落 wx.request 直连 BASE_URL（体验版/本地调试，需勾选「不校验合法域名」）。
// 两种通道的 success 回调同为 { statusCode, data } 结构，页面代码无感知。
// 已登录时自动携带 Bearer token：服务端据此把署名（added_by/author/who）盖章为登录昵称
function request(method, path, { body, mapCode } = {}) {
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
      reject(error);
    };
    const fail = (err) => reject(new Error('网络异常：' + (err.errMsg || '')));
    if (CLOUD_ENV_ID) {
      wx.cloud.callContainer({
        config: { env: CLOUD_ENV_ID },
        path,
        method,
        data: body ?? undefined,
        header: { ...header, 'X-WX-SERVICE': CLOUD_SERVICE_NAME },
        success,
        fail,
      });
    } else {
      wx.request({
        url: BASE_URL + path,
        method,
        data: body ?? undefined,
        header,
        success,
        fail,
      });
    }
  });
}

function get(path) {
  return request('GET', path);
}

export const api = {
  health: () => get('/api/health'),

  // 登录（小程序）：code 换 token；昵称由服务端盖章，写接口不再传署名字段
  login: (code) => request('POST', '/api/auth/login', { body: { code } }),
  updateProfile: (nickname) =>
    request('POST', '/api/auth/profile', { body: { nickname } }).then((d) => d.nickname),

  // 地图
  createMap: (data) => request('POST', '/api/maps', { body: data }),
  getMap: (code) => get(`/api/maps/${encodeURIComponent(code)}`),
  memories: (code) => get(`/api/maps/${encodeURIComponent(code)}/memories`).then((d) => d.memories),

  // 地点
  listPlaces: (code) =>
    get(`/api/places?map=${encodeURIComponent(code)}`).then((d) => d.places),
  createPlace: (code, data) =>
    request('POST', '/api/places', { body: { ...data, map_code: code } }),
  updatePlace: (code, id, patch) =>
    request('PUT', `/api/places/${id}`, { body: patch, mapCode: code }),
  deletePlace: (code, id) => request('DELETE', `/api/places/${id}`, { mapCode: code }),
  toggleWish: (code, id) =>
    request('POST', `/api/places/${id}/wish`, { body: { map_code: code } }),
  togglePublic: (code, id) =>
    request('POST', `/api/places/${id}/public`, { body: { map_code: code } }),

  // 行程单
  itinerary: (code) =>
    get(`/api/itinerary?map=${encodeURIComponent(code)}`).then((d) => d.stops),
  setItinerary: (code, placeIds) =>
    request('PUT', '/api/itinerary', { body: { map_code: code, place_ids: placeIds } }).then(
      (d) => d.stops
    ),

  // 照片
  listPhotos: (code, placeId) =>
    get(`/api/places/${placeId}/photos?map=${encodeURIComponent(code)}`).then((d) => d.photos),
  uploadPhoto: (code, placeId, { full, thumb }) =>
    request('POST', `/api/places/${placeId}/photos`, {
      body: { map_code: code, full, thumb },
    }),
  photoUrl: (code, photoId) =>
    `${BASE_URL}/api/photos/${photoId}?map=${encodeURIComponent(code)}`,
  deletePhoto: (code, photoId) =>
    request('DELETE', `/api/photos/${photoId}`, { mapCode: code }),

  // 留言
  listComments: (code, placeId) =>
    get(`/api/places/${placeId}/comments?map=${encodeURIComponent(code)}`).then((d) => d.comments),
  createComment: (code, placeId, body) =>
    request('POST', `/api/places/${placeId}/comments`, {
      body: { map_code: code, body },
    }),
  deleteComment: (code, commentId) =>
    request('DELETE', `/api/comments/${commentId}`, { mapCode: code }),

  // 公共广场
  publicPlaces: () => get('/api/public/places').then((d) => d.places),
};
