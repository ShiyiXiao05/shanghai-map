const CODE_STORAGE_KEY = 'shanghai-wish-access-code';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function getAccessCode() {
  return localStorage.getItem(CODE_STORAGE_KEY) ?? '';
}

export function setAccessCode(code) {
  localStorage.setItem(CODE_STORAGE_KEY, code);
}

async function request(method, url, body) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const code = getAccessCode();
  if (code) headers['x-access-code'] = code;

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
    throw new ApiError(res.status, payload?.error ?? `请求失败（${res.status}）`);
  }
  return payload;
}

export const api = {
  mapConfig: () => request('GET', '/api/map-config'),
  listPlaces: async () => (await request('GET', '/api/places')).places,
  createPlace: (data) => request('POST', '/api/places', data),
  updatePlace: (id, patch) => request('PUT', `/api/places/${id}`, patch),
  deletePlace: (id) => request('DELETE', `/api/places/${id}`),
};
