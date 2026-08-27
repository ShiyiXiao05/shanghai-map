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
};
