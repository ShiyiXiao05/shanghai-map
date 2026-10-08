const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');

// 地图手动点选的初始中心（上海市中心）：全程不调用地理位置接口，因此不需要任何权限
const SHANGHAI_CENTER = { latitude: 31.2304, longitude: 121.4737 };

// 添加地点：在本页内嵌的地图上手动点选（不调用地理位置接口，无需申请权限）。
// 想要更省事的路径可以用「粘贴高德分享导入」，那条路能一次带出名称/地址/坐标。
Page({
  behaviors: [identityBehavior],

  data: {
    categories: CATEGORIES,
    picked: null, // { name, address, latitude, longitude }
    name: '', // 地点名称：原生选点会回填，地图点选时由用户填写
    mapPick: false, // 地图手动点选模式（不依赖地理位置接口权限）
    pickCenter: SHANGHAI_CENTER,
    pickMarkers: [],
    pickPoint: null,
    category: CATEGORIES[0].id,
    description: '',
    priceHint: '',
    hours: '',
    tags: '',
    nickname: '', // 登录身份展示用；署名由服务端按登录昵称盖章
    saving: false,
  },

  onShow() {
    this.setData({ nickname: storage.getNickname() });
  },

  // 打开地图点选（没有"原生选点"这一步，因此不涉及任何权限）
  openMapPick() {
    this.setData({ mapPick: true, pickMarkers: [], pickPoint: null });
  },

  // 地图手动点选：完全不用地理位置接口，只读取用户点击的屏幕坐标
  onMapTap(event) {
    const detail = event.detail || {};
    const latitude = Number(detail.latitude);
    const longitude = Number(detail.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.setData({
      pickPoint: { latitude, longitude },
      pickMarkers: [{ id: 1, latitude, longitude, width: 28, height: 28 }],
    });
  },

  confirmMapPick() {
    const point = this.data.pickPoint;
    if (!point) {
      wx.showToast({ title: '先在地图上点一下位置', icon: 'none' });
      return;
    }
    this.setData({
      picked: { name: '', address: '', latitude: point.latitude, longitude: point.longitude },
      mapPick: false,
    });
  },

  cancelMapPick() {
    this.setData({ mapPick: false });
  },

  onName(event) {
    this.setData({ name: event.detail.value });
  },

  onCategory(event) {
    this.setData({ category: this.data.categories[event.detail.value].id });
  },

  onDescription(event) {
    this.setData({ description: event.detail.value });
  },

  onPriceHint(event) {
    this.setData({ priceHint: event.detail.value });
  },

  onHours(event) {
    this.setData({ hours: event.detail.value });
  },

  onTags(event) {
    this.setData({ tags: event.detail.value });
  },

  async save() {
    if (this.submitting) return; // 防重复提交：弱网连点会创建多个地点
    const { picked, category, description, priceHint, hours, tags } = this.data;
    const name = (this.data.name || '').trim() || (picked && picked.name) || '';
    if (!picked) {
      wx.showToast({ title: '先选择一个位置', icon: 'none' });
      return;
    }
    this.submitting = true;
    try {
      // 登录守卫：未登录静默登录；昵称未确认时弹层，确认后自动重试保存
      const nickname = await auth.requireIdentity(this, () => this.save());
      if (!nickname) return;
      this.setData({ saving: true });
      await api.createPlace(app.globalData.map.code, {
        name: name || '未命名地点',
        category,
        description: description.trim(),
        price_hint: priceHint.trim(),
        hours: hours.trim(),
        tags: tags.trim(),
        address: picked.address,
        lng: picked.longitude,
        lat: picked.latitude,
      });
      wx.showToast({ title: '已添加到地图' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.submitting = false;
    }
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
});
