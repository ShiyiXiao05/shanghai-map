const app = getApp();
const { api } = require('../../utils/api.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');
const { applyTheme, getThemeMode, setThemeMode, THEME_MODES, THEME_LABELS } = require('../../utils/theme.js');
const { checkUpdates, CLIENT_VERSION } = require('../../utils/updates.js');

Page({
  behaviors: [identityBehavior],

  data: {
    joinedMaps: [],
    currentCode: '',
    mode: 'list', // list | create | join | rename | created
    name: '',
    nickname: '', // 创建地图时展示署名，实际创建者由服务端按登录昵称盖章
    code: '',
    createdCode: '',
    themeModes: THEME_LABELS,
    themeIndex: THEME_MODES.indexOf(getThemeMode()),
    version: CLIENT_VERSION,
  },

  onShow() {
    applyTheme(this);
    this.setData({
      joinedMaps: storage.getJoinedMaps(),
      currentCode: storage.getCurrentMapCode(),
      nickname: storage.getNickname(),
    });
  },

  onThemeChange(event) {
    const mode = THEME_MODES[Number(event.detail.value)] || 'system';
    setThemeMode(mode);
    this.setData({ themeIndex: THEME_MODES.indexOf(mode) });
  },

  // 改昵称：先静默登录（没有 token 时 /api/auth/profile 会 401「请先登录」），再弹层
  async editNickname() {
    try {
      await auth.ensureLogin();
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '登录失败，请重试', icon: 'none' });
      return;
    }
    this.setData({ nickModalShow: true });
  },

  logout() {
    wx.showModal({
      title: '退出登录',
      content: '退出后重新做写操作会再次静默登录，地图数据不受影响。',
      success: (res) => {
        if (!res.confirm) return;
        auth.logout();
        this.setData({ nickname: '' });
        wx.showToast({ title: '已退出登录', icon: 'none' });
      },
    });
  },

  goChangelog() { wx.navigateTo({ url: '/pages/changelog/changelog' }); },
  checkUpdates() { checkUpdates(); },

  startRename() {
    if (!app.globalData.map) return;
    this.setData({ mode: 'rename', name: app.globalData.map.name });
  },

  async renameMap() {
    const name = this.data.name.trim();
    if (!name || !app.globalData.map) return wx.showToast({ title: '地图名称不能为空', icon: 'none' });
    if (this.renaming) return;
    this.renaming = true;
    try {
      const map = await api.renameMap(app.globalData.map.code, name);
      app.enterMap(map);
      this.setData({ mode: 'list', name: '', joinedMaps: storage.getJoinedMaps() });
      wx.showToast({ title: '地图名称已更新', icon: 'none' });
    } catch (err) { wx.showToast({ title: err?.message || '改名失败，请重试', icon: 'none' }); }
    finally { this.renaming = false; }
  },

  deleteMap() {
    const map = app.globalData.map;
    if (!map?.code) return;
    wx.showModal({
      title: `删除「${map.name}」？`,
      content: '地图、地点、照片、留言和行程都会永久删除，无法恢复。',
      confirmText: '永久删除',
      confirmColor: '#be4a43',
      success: async (result) => {
        if (!result.confirm || this.deleting) return;
        this.deleting = true;
        wx.showLoading({ title: '删除中…' });
        try {
          await api.deleteMap(map.code);
          storage.removeJoinedMap(map.code);
          storage.setCurrentMapCode('');
          app.exitToPublic();
          wx.hideLoading();
          wx.showToast({ title: '地图已删除', icon: 'none' });
          setTimeout(() => wx.reLaunch({ url: '/pages/index/index' }), 500);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err?.message || '删除失败，请重试', icon: 'none' });
        } finally { this.deleting = false; }
      },
    });
  },

  switchMode(event) {
    this.setData({ mode: event.currentTarget.dataset.mode });
  },

  onNameInput(event) {
    this.setData({ name: event.detail.value });
  },

  onCodeInput(event) {
    this.setData({ code: event.detail.value.toUpperCase() });
  },

  async createMap() {
    if (this.creating) return; // 防连点：弱网下重复点会建出多张地图
    this.creating = true;
    try {
      await this.createMapInner();
    } finally {
      this.creating = false;
    }
  },

  async createMapInner() {
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '给地图起个名字吧', icon: 'none' });
      return;
    }
    // 登录守卫：未登录静默登录；昵称未确认时弹层，确认后自动重试创建
    const nickname = await auth.requireIdentity(this, () => this.createMap());
    if (!nickname) return;
    wx.showLoading({ title: '创建中…' });
    try {
      const map = await api.createMap({ name });
      app.enterMap(map);
      wx.hideLoading();
      this.setData({ createdCode: map.code, mode: 'created', name: '' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async joinMap() {
    const code = this.data.code.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) {
      wx.showToast({ title: '邀请码是 6 位字母数字', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加入中…' });
    try {
      const map = await api.getMap(code);
      app.enterMap(map);
      wx.hideLoading();
      this.back();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.status === 404 ? '邀请码不存在' : err.message, icon: 'none' });
    }
  },

  chooseMap(event) {
    const code = event.currentTarget.dataset.code;
    const map = this.data.joinedMaps.find((m) => m.code === code);
    if (!map) return;
    app.enterMap(map);
    this.back();
  },

  copyInvite() {
    const map = app.globalData.map;
    wx.setClipboardData({
      data: `「${map?.name}」邀请码：${this.data.createdCode}，打开小程序加入一起标记吧`,
    });
  },

  // 退出当前地图会话，切到公共广场只读视图
  enterPublic() {
    app.exitToPublic();
    wx.reLaunch({ url: '/pages/index/index' });
  },

  back() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    });
  },

  goMemories() {
    wx.navigateTo({ url: '/pages/memories/memories' });
  },

  goPoster() {
    wx.navigateTo({ url: '/pages/poster/poster' });
  },

  goTrash() {
    wx.navigateTo({ url: '/pages/trash/trash' });
  },

  // 确认创建者昵称后，同步创建地图表单中的署名提示。
  async onNickConfirm(event) {
    try {
      const saved = await auth.confirmNickname(this, event.detail);
      if (saved) this.setData({ nickname: saved });
    } catch (err) {
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
    }
  },

  // 换邀请码：旧码立即失效，本地存的码同步替换，避免自己把自己锁在门外
  rekeyMap() {
    const oldCode = this.data.currentCode;
    if (!oldCode) return;
    wx.showModal({
      title: '换邀请码',
      content: '旧邀请码会立即失效。其他同学设备里保存的还是旧码，需要用新码重新加入一次；你自己不受影响（会自动切换）。',
      confirmText: '确认更换',
      success: async (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '更换中…' });
        try {
          const map = await api.rekey(oldCode);
          storage.removeJoinedMap(oldCode);
          storage.saveJoinedMap({ code: map.code, name: map.name });
          storage.setCurrentMapCode(map.code);
          app.enterMap({ code: map.code, name: map.name });
          wx.hideLoading();
          this.setData({ currentCode: map.code, createdCode: map.code, mode: 'created' });
          wx.showToast({ title: '已生成新邀请码', icon: 'none' });
        } catch (err) {
          wx.hideLoading();
          wx.showToast({ title: err?.message || '更换失败，请重试', icon: 'none' });
        }
      },
    });
  },
});
