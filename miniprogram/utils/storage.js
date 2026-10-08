// 本地存储：与网页版 localStorage 同名同构（换端可无缝）
export const KEYS = {
  maps: 'wish-maps', // [{code, name}]
  currentMap: 'wish-current-map', // code
  nickname: 'shanghai-wish-nickname',
  sort: 'wish-sort',
  authToken: 'wish-wmp-token', // 小程序登录 token（网页版不用）
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

export function removeJoinedMap(code) {
  const maps = getJoinedMaps().filter((m) => m.code !== code);
  wx.setStorageSync(KEYS.maps, maps);
}

export function getCurrentMapCode() {
  return wx.getStorageSync(KEYS.currentMap) || '';
}

export function setCurrentMapCode(code) {
  wx.setStorageSync(KEYS.currentMap, code);
}

// 公共广场意图：exitToPublic() 只改内存态的话，冷启动会被 restoreSession 拉回上一张地图
export function setPublicView(on) {
  wx.setStorageSync('wish-public-view', !!on);
}

export function isPublicView() {
  return !!wx.getStorageSync('wish-public-view');
}

export function getCurrentMap() {
  const code = getCurrentMapCode();
  return getJoinedMaps().find((m) => m.code === code) ?? null;
}

// 排序偏好：只接受 newest|name|wishes，与 index 页 picker 的索引一一对应
export const SORTS = ['newest', 'name', 'wishes'];

export function getSort() {
  const raw = wx.getStorageSync(KEYS.sort);
  return SORTS.indexOf(raw) === -1 ? 'newest' : raw;
}

export function setSort(value) {
  if (SORTS.indexOf(value) === -1) return;
  wx.setStorageSync(KEYS.sort, value);
}

export function getNickname() {
  return wx.getStorageSync(KEYS.nickname) || '';
}

export function setNickname(name) {
  wx.setStorageSync(KEYS.nickname, name);
}

export function getAuthToken() {
  return wx.getStorageSync(KEYS.authToken) || '';
}

export function setAuthToken(token) {
  wx.setStorageSync(KEYS.authToken, token);
}
