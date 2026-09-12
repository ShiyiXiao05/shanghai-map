const { getJoinedMaps, getCurrentMapCode, setCurrentMapCode, saveJoinedMap } = require('./utils/storage.js');

App({
  globalData: {
    // 当前地图会话：{ code, name } 或 null（进入公共广场/引导）
    map: null,
    // 公共广场只读视图标记
    isPublicView: false,
    // 列表页传给详情页的地点对象（公共广场无邀请码时兜底）
    detailPlace: null,
  },

  onLaunch() {
    this.restoreSession();
  },

  restoreSession() {
    const code = getCurrentMapCode();
    const map = getJoinedMaps().find((m) => m.code === code) ?? getJoinedMaps()[0] ?? null;
    this.globalData.map = map;
    this.globalData.isPublicView = !map;
    if (map) setCurrentMapCode(map.code);
  },

  // 加入/切换地图会话
  enterMap(map) {
    this.globalData.map = map;
    this.globalData.isPublicView = false;
    saveJoinedMap(map);
    setCurrentMapCode(map.code);
  },

  // 退出到公共广场
  exitToPublic() {
    this.globalData.map = null;
    this.globalData.isPublicView = true;
  },
});
