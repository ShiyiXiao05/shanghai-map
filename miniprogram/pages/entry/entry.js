const app = getApp();
const { api } = require('../../utils/api.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');

Page({
  behaviors: [identityBehavior],

  data: {
    joinedMaps: [],
    currentCode: '',
    mode: 'list', // list | create | join | created
    name: '',
    nickname: '', // 登录身份展示用；创建者署名由服务端按登录昵称盖章
    code: '',
    createdCode: '',
  },

  onShow() {
    this.setData({
      joinedMaps: storage.getJoinedMaps(),
      currentCode: storage.getCurrentMapCode(),
      nickname: storage.getNickname(),
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

  // 改昵称：直接复用既有昵称弹层（identity-behavior 的 onNickConfirm 会调 updateProfile 落库）
  editNickname() {
    this.setData({ nickModalShow: true });
  },

  // 退出登录：清本地 token 与昵称。不清地图，重新写操作时会静默重新登录
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

  // 换邀请码：旧码立即失效，本地存的码同步替换，避免自己把自己锁在门外
  rekeyMap() {
    const oldCode = this.data.currentCode;
    if (!oldCode) return;
    wx.showModal({
      title: '换邀请码',
      content: '旧邀请码会立即失效。已经加入的同学不受影响，之后邀请新人要用新码。',
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
