const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');
const { chooseLocation, locationApiEnabled } = require('../../utils/location.js');

// 地图手动点选的初始中心（上海市中心）：未开通地理位置接口时的兜底方案
const SHANGHAI_CENTER = { latitude: 31.2304, longitude: 121.4737 };

// 权限类失败（位置权限被拒、隐私授权未声明等）统一引导去设置页
const AUTH_PATTERN = /auth|deny|privacy|scope/i;

// 添加地点：wx.chooseLocation 是微信原生的「搜索+地图选点」合一选择器
// （自带腾讯 POI 搜索与逆地理吸附，无需额外位置服务 key）
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

  async chooseLocation() {
    const result = await chooseLocation();
    if (result.ok) {
      const res = result.data;
      this.setData({
        picked: {
          name: res.name || '',
          address: res.address || '',
          latitude: res.latitude,
          longitude: res.longitude,
        },
        name: res.name || this.data.name,
        mapPick: false,
      });
      return;
    }
    // 未开通地理位置接口权限（或基础库不支持）：退化为"在地图上手动点选"，不需要任何权限
    if (result.reason === 'disabled' || result.reason === 'unsupported') {
      if (result.reason === 'unsupported' && locationApiEnabled()) {
        wx.showToast({ title: '当前微信版本不支持选点，请改用地图点选', icon: 'none' });
      }
      this.setData({ mapPick: true, pickMarkers: [], pickPoint: null });
      return;
    }
    if (result.reason === 'cancel') return; // 用户主动取消不算失败
    if (result.reason === 'denied') {
      wx.showModal({
        title: '需要位置权限',
        content: '请在设置中允许使用位置信息后重试，或直接在地图上点选',
        confirmText: '去设置',
        success: (r) => r.confirm && wx.openSetting({}),
      });
      return;
    }
    wx.showToast({ title: '选择位置失败，请重试或改用粘贴导入', icon: 'none' });
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
