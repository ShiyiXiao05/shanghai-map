const app = getApp();
const { api } = require('../../utils/api.js');
const storage = require('../../utils/storage.js');

Page({
  data: {
    joinedMaps: [],
    currentCode: '',
    mode: 'list', // list | create | join | created
    name: '',
    nickname: '',
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

  onNicknameInput(event) {
    this.setData({ nickname: event.detail.value });
  },

  onCodeInput(event) {
    this.setData({ code: event.detail.value.toUpperCase() });
  },

  async createMap() {
    const name = this.data.name.trim();
    if (!name) {
      wx.showToast({ title: '给地图起个名字吧', icon: 'none' });
      return;
    }
    if (this.data.nickname.trim()) storage.setNickname(this.data.nickname.trim());
    wx.showLoading({ title: '创建中…' });
    try {
      const map = await api.createMap({
        name,
        createdBy: this.data.nickname.trim(),
      });
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
    if (!/^[A-Z0-9]{4,10}$/.test(code)) {
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

  copyInviteLink() {
    const code = this.data.createdCode;
    wx.setClipboardData({
      data: `#小程序://魔都Explore/${code}`,
      success: () => wx.showToast({ title: '口令已复制', icon: 'none' }),
    });
  },

  back() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    });
  },
});
