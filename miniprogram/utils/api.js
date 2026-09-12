import { BASE_URL } from './config.js';

// 与网页版 api.js 对齐的完整 API 封装（wx.request 版）
function request(method, path, { body, mapCode } = {}) {
  return new Promise((resolve, reject) => {
    wx.request({
      url: BASE_URL + path,
      method,
      data: body ?? undefined,
      header: {
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(mapCode !== undefined ? { 'x-map-code': mapCode } : {}),
      },
      success(res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(res.data ?? null);
          return;
        }
        const error = new Error((res.data && res.data.error) || `请求失败（${res.statusCode}）`);
        error.status = res.statusCode;
        reject(error);
      },
      fail(err) {
        reject(new Error('网络异常：' + (err.errMsg || '')));
      },
    });
  });
}

function get(path) {
  return request('GET', path);
}

export const api = {
  health: () => get('/api/health'),

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
  toggleWish: (code, id, who) =>
    request('POST', `/api/places/${id}/wish`, { body: { map_code: code, who } }),
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
  uploadPhoto: (code, placeId, { full, thumb, addedBy }) =>
    request('POST', `/api/places/${placeId}/photos`, {
      body: { map_code: code, full, thumb, added_by: addedBy },
    }),
  photoUrl: (code, photoId) =>
    `${BASE_URL}/api/photos/${photoId}?map=${encodeURIComponent(code)}`,
  deletePhoto: (code, photoId) =>
    request('DELETE', `/api/photos/${photoId}`, { mapCode: code }),

  // 留言
  listComments: (code, placeId) =>
    get(`/api/places/${placeId}/comments?map=${encodeURIComponent(code)}`).then((d) => d.comments),
  createComment: (code, placeId, { body, author }) =>
    request('POST', `/api/places/${placeId}/comments`, {
      body: { map_code: code, body, author },
    }),
  deleteComment: (code, commentId) =>
    request('DELETE', `/api/comments/${commentId}`, { mapCode: code }),

  // 公共广场
  publicPlaces: () => get('/api/public/places').then((d) => d.places),
};
