async function request(method, url, { body, mapCode } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (mapCode !== undefined) headers['x-map-code'] = mapCode;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* 空响应体 */
  }

  if (!res.ok) {
    const error = new Error(payload?.error ?? `请求失败（${res.status}）`);
    error.status = res.status;
    throw error;
  }
  return payload;
}

export const api = {
  mapConfig: () => request('GET', '/api/map-config'),
  createMap: (data) => request('POST', '/api/maps', { body: data }),
  getMap: (code) => request('GET', `/api/maps/${encodeURIComponent(code)}`),
  listPlaces: async (mapCode) =>
    (await request('GET', `/api/places?map=${encodeURIComponent(mapCode)}`)).places,
  createPlace: (mapCode, data) =>
    request('POST', '/api/places', { body: { ...data, map_code: mapCode } }),
  updatePlace: (mapCode, id, patch) =>
    request('PUT', `/api/places/${id}`, { body: patch, mapCode }),
  deletePlace: (mapCode, id) => request('DELETE', `/api/places/${id}`, { mapCode }),
  listPhotos: async (mapCode, placeId) =>
    (
      await request(
        'GET',
        `/api/places/${placeId}/photos?map=${encodeURIComponent(mapCode)}`
      )
    ).photos,
  addPhoto: (mapCode, placeId, data) =>
    request('POST', `/api/places/${placeId}/photos`, { body: { ...data, map_code: mapCode } }),
  deletePhoto: (mapCode, photoId) => request('DELETE', `/api/photos/${photoId}`, { mapCode }),
  photoUrl: (mapCode, photoId) => `/api/photos/${photoId}?map=${encodeURIComponent(mapCode)}`,
  listComments: async (mapCode, placeId) =>
    (
      await request(
        'GET',
        `/api/places/${placeId}/comments?map=${encodeURIComponent(mapCode)}`
      )
    ).comments,
  addComment: (mapCode, placeId, data) =>
    request('POST', `/api/places/${placeId}/comments`, { body: { ...data, map_code: mapCode } }),
  deleteComment: (mapCode, commentId) =>
    request('DELETE', `/api/comments/${commentId}`, { mapCode }),
  toggleWish: (mapCode, placeId, who) =>
    request('POST', `/api/places/${placeId}/wish`, { body: { map_code: mapCode, who } }),
  memories: async (mapCode) =>
    (await request('GET', `/api/maps/${encodeURIComponent(mapCode)}/memories`)).memories,
};
