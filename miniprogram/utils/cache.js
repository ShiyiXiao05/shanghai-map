const STORAGE_KEY = 'wish-place-cache-v1';
const MAX_PERSISTED_BYTES = 512 * 1024;
const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
const MAX_MAPS = 6;
const MAX_MEDIA = 20;
export const CACHE_TTL = 60 * 1000;
const maps = new Map();
const revisions = new Map();
const media = new Map();
const mediaRevisions = new Map();
const pending = new Map();
let hydrated = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function bytes(value) { return encodeURIComponent(JSON.stringify(value)).replace(/%[A-F\d]{2}/gi, 'x').length; }
function mapKey(code) { return code || 'public'; }

function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const stored = wx.getStorageSync(STORAGE_KEY);
    if (!Array.isArray(stored)) return;
    for (const entry of stored.slice(-MAX_MAPS)) {
      if (entry && typeof entry.key === 'string' && Array.isArray(entry.places) && Number.isFinite(entry.savedAt)) maps.set(entry.key, entry);
    }
  } catch { /* Cache storage is optional. */ }
}

function persist() {
  while (maps.size > MAX_MAPS || (maps.size && bytes(Array.from(maps.values())) > MAX_PERSISTED_BYTES)) maps.delete(maps.keys().next().value);
  try { wx.setStorageSync(STORAGE_KEY, Array.from(maps.values())); }
  catch { /* Full storage must not turn a successful write into a failure. */ }
}

export function placesRevision(code) { return revisions.get(mapKey(code)) || 0; }
export function readPlaces(code) {
  hydrate();
  const entry = maps.get(mapKey(code));
  return entry ? clone(entry) : null;
}
export function fresh(entry) { return !!entry && Date.now() - entry.savedAt < CACHE_TTL; }
export function savePlaces(code, places) {
  hydrate();
  const key = mapKey(code);
  revisions.set(key, placesRevision(code) + 1);
  maps.delete(key);
  maps.set(key, { key, places: clone(places), savedAt: Date.now() });
  persist();
}
export function findPlace(code, id) { return readPlaces(code)?.places.find((place) => Number(place.id) === Number(id)) || null; }
export function upsertPlace(code, place) {
  const list = readPlaces(code)?.places || [];
  const index = list.findIndex((p) => Number(p.id) === Number(place.id));
  if (index === -1) list.unshift(place);
  else list[index] = { ...list[index], ...place };
  savePlaces(code, list);
  // Private writes may change public visibility; public data is revalidated on next visit.
  if (code) clearMap('');
}
export function removePlace(code, id) {
  const list = readPlaces(code)?.places || [];
  savePlaces(code, list.filter((place) => Number(place.id) !== Number(id)));
  clearMedia(code, id);
  if (code) clearMap('');
}
export function clearMap(code) {
  hydrate();
  const key = mapKey(code);
  revisions.set(key, placesRevision(code) + 1);
  maps.delete(key);
  for (const mediaKey of new Set([...media.keys(), ...pending.keys()])) {
    if (mediaKey.startsWith(`${key}:`)) {
      media.delete(mediaKey);
      pending.delete(mediaKey);
      mediaRevisions.set(mediaKey, (mediaRevisions.get(mediaKey) || 0) + 1);
    }
  }
  persist();
}

function mediaKey(code, id, kind) { return `${mapKey(code)}:${id}:${kind}`; }
export function readMedia(code, id, kind) {
  const entry = media.get(mediaKey(code, id, kind));
  return entry ? clone(entry) : null;
}
export function saveMedia(code, id, kind, items) {
  const key = mediaKey(code, id, kind);
  mediaRevisions.set(key, (mediaRevisions.get(key) || 0) + 1);
  media.delete(key);
  media.set(key, { items: clone(items), savedAt: Date.now() });
  while (media.size > MAX_MEDIA || (media.size && bytes(Array.from(media.values())) > MAX_MEDIA_BYTES)) media.delete(media.keys().next().value);
}
export function clearMedia(code, id) {
  for (const kind of ['photos', 'comments']) {
    const key = mediaKey(code, id, kind);
    media.delete(key);
    pending.delete(key);
    mediaRevisions.set(key, (mediaRevisions.get(key) || 0) + 1);
  }
}
export async function loadMedia(code, id, kind, loader, force = false) {
  const key = mediaKey(code, id, kind);
  const entry = readMedia(code, id, kind);
  if (!force && fresh(entry)) return entry.items;
  if (pending.has(key)) return pending.get(key);
  const revision = mediaRevisions.get(key) || 0;
  const promise = Promise.resolve().then(loader).then((items) => {
    if (revision === (mediaRevisions.get(key) || 0)) saveMedia(code, id, kind, items);
    return readMedia(code, id, kind)?.items || items;
  }).finally(() => { if (pending.get(key) === promise) pending.delete(key); });
  pending.set(key, promise);
  return promise;
}
