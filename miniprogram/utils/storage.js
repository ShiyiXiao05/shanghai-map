// 本地存储：与网页版 localStorage 同名同构（换端可无缝）
export const KEYS = {
  maps: 'wish-maps', // [{code, name}]
  currentMap: 'wish-current-map', // code
  nickname: 'shanghai-wish-nickname',
  sort: 'wish-sort',
};

export function getJoinedMaps() {
  const raw = wx.getStorageSync(KEYS.maps);
  if (!Array.isArray(raw)) return [];
  return raw.filter((m) => m && m.code && m.name);
}

export function saveJoinedMap(map) {
  const maps = getJoinedMaps().filter((m) => m.code !== map.code);
  maps.unshift(map);
  wx.setStorageSync(KEYS.maps, maps);
}

export function getCurrentMapCode() {
  return wx.getStorageSync(KEYS.currentMap) || '';
}

export function setCurrentMapCode(code) {
  wx.setStorageSync(KEYS.currentMap, code);
}

export function getCurrentMap() {
  const code = getCurrentMapCode();
  return getJoinedMaps().find((m) => m.code === code) ?? null;
}

export function getNickname() {
  return wx.getStorageSync(KEYS.nickname) || '';
}

export function setNickname(name) {
  wx.setStorageSync(KEYS.nickname, name);
}
