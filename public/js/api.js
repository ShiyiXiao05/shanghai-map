// 单次请求 15s 预算（含响应体读取）：Render 免费实例冷启动可能十几秒，
// 超时后必须给出可读提示，否则调用侧的按钮会一直停在 disabled 上，用户没有任何恢复入口
const TIMEOUT_MS = 15000;
// 上传原图（服务端上限 1.5MB，base64 后约 2MB）在弱网上行可能超过 15s，单独放宽
const UPLOAD_TIMEOUT_MS = 60000;
// 只有幂等的 GET 才自动重试一次：写请求重试可能产生重复数据（如重复打卡/留言）
const RETRY_DELAY_MS = 600;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// 超时 / 断网统一换成中文可读文案并带上 status=0；HTTP 错误仍保留真实状态码
function toReadableError(err) {
  const error = new Error(
    err?.name === 'AbortError' ? '请求超时，请重试' : '网络连接失败，请检查网络后重试'
  );
  error.status = 0;
  error.cause = err;
  return error;
}

// 返回 { res, text }：响应体也在这里读完，超时计时器才能覆盖整个请求
// （只等 headers 的话，body 卡住时按钮照样会一直转）
async function fetchOnce(method, url, init, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, method, signal: controller.signal });
    return { res, text: await res.text() };
  } catch (err) {
    throw toReadableError(err);
  } finally {
    clearTimeout(timer);
  }
}

async function request(method, url, { body, mapCode, timeoutMs } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (mapCode !== undefined) headers['x-map-code'] = mapCode;

  const init = {
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  };

  let attempt;
  try {
    attempt = await fetchOnce(method, url, init, timeoutMs);
  } catch (err) {
    // 冷启动/瞬时抖动：GET 间隔 600ms 重试一次；写请求直接抛出，交给用户手动重试
    if (method !== 'GET') throw err;
    await sleep(RETRY_DELAY_MS);
    attempt = await fetchOnce(method, url, init, timeoutMs);
  }

  const { res, text } = attempt;
  if (res.status === 204) return null;

  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    /* 空响应体 / 非 JSON */
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
  // 上传口径（是否 CDN、大小上限）：无需邀请码，上传前先取一次做体积预检
  uploadConfig: () => request('GET', '/api/upload-config'),
  createMap: (data) => request('POST', '/api/maps', { body: data }),
  getMap: (code) => request('GET', `/api/maps/${encodeURIComponent(code)}`),
  listPlaces: async (mapCode) =>
    (await request('GET', `/api/places?map=${encodeURIComponent(mapCode)}`)).places,
  createPlace: (mapCode, data) =>
    request('POST', '/api/places', { body: { ...data, map_code: mapCode } }),
  updatePlace: (mapCode, id, patch) =>
    request('PUT', `/api/places/${id}`, { body: patch, mapCode }),
  deletePlace: (mapCode, id) => request('DELETE', `/api/places/${id}`, { mapCode }),
  trashPlaces: async (mapCode) =>
    (
      await request(
        'GET',
        `/api/places?map=${encodeURIComponent(mapCode)}&view=trash`
      )
    ).places,
  restorePlace: (mapCode, id) =>
    request('POST', `/api/places/${id}/restore`, { body: { map_code: mapCode } }),
  listPhotos: async (mapCode, placeId) =>
    (
      await request(
        'GET',
        `/api/places/${placeId}/photos?map=${encodeURIComponent(mapCode)}`
      )
    ).photos,
  addPhoto: (mapCode, placeId, data) =>
    request('POST', `/api/places/${placeId}/photos`, {
      body: { ...data, map_code: mapCode },
      timeoutMs: UPLOAD_TIMEOUT_MS,
    }),
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
  togglePublic: (mapCode, placeId) =>
    request('POST', `/api/places/${placeId}/public`, { body: { map_code: mapCode } }),
  publicPlaces: async () => (await request('GET', '/api/public/places')).places,
  renameMap: (mapCode, name) =>
    request('PUT', `/api/maps/${encodeURIComponent(mapCode)}`, { body: { name } }),
  rekeyMap: (mapCode) => request('POST', `/api/maps/${encodeURIComponent(mapCode)}/rekey`),
  deleteMap: (mapCode) => request('DELETE', `/api/maps/${encodeURIComponent(mapCode)}`),
  itinerary: async (mapCode) =>
    (await request('GET', `/api/itinerary?map=${encodeURIComponent(mapCode)}`)).stops,
  setItinerary: (mapCode, placeIds) =>
    request('PUT', '/api/itinerary', { body: { map_code: mapCode, place_ids: placeIds } }),
  // 内容举报：地图内内容带 mapCode；公共广场内容不带（服务端只允许举报公开内容）
  report: (data) => request('POST', '/api/reports', { body: data }),

  pushKey: () => request('GET', '/api/push/key'),
  subscribePush: (mapCode, subscription, who) =>
    request('POST', '/api/push/subscribe', {
      body: { map_code: mapCode, subscription, who },
    }),
  unsubscribePush: (mapCode, endpoint) =>
    request('DELETE', '/api/push/subscribe', { mapCode, body: { endpoint } }),
};
