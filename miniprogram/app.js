const {
  getJoinedMaps,
  getCurrentMapCode,
  setCurrentMapCode,
  saveJoinedMap,
  setPublicView,
  isPublicView,
} = require('./utils/storage.js');
const { CLOUD_ENV_ID } = require('./utils/config.js');
const { watchTheme } = require('./utils/theme.js');
const { initUpdates } = require('./utils/updates.js');

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
    // 微信云托管通道初始化（CLOUD_ENV_ID 为空时走 BASE_URL 直连，无需 init）
    if (CLOUD_ENV_ID && wx.cloud) {
      wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: false });
    }
    this.restoreSession();
    watchTheme();
    initUpdates();
  },

  restoreSession() {
    // 上次主动进了公共广场：保持只读广场，不再自动跳回上一张地图
    if (isPublicView()) {
      this.globalData.map = null;
      this.globalData.isPublicView = true;
      return;
    }
    const code = getCurrentMapCode();
    const map = getJoinedMaps().find((m) => m.code === code) ?? getJoinedMaps()[0] ?? null;
    this.globalData.map = map;
    this.globalData.isPublicView = !map;
    if (map) setCurrentMapCode(map.code);
  },

  // 加入/切换地图会话
  enterMap(map) {
    this.globalData.detailPlace = null;
    this.globalData.detailMapCode = '';
    this.globalData.map = map;
    this.globalData.isPublicView = false;
    setPublicView(false);
    saveJoinedMap(map);
    setCurrentMapCode(map.code);
  },

  // 退出到公共广场
  exitToPublic() {
    this.globalData.detailPlace = null;
    this.globalData.detailMapCode = '';
    this.globalData.map = null;
    this.globalData.isPublicView = true;
    setPublicView(true);
  },
});
