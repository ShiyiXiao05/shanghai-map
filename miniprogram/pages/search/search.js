const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');

// 添加地点：wx.chooseLocation 是微信原生的「搜索+地图选点」合一选择器
// （自带腾讯 POI 搜索与逆地理吸附，无需额外位置服务 key）
Page({
  behaviors: [identityBehavior],

  data: {
    categories: CATEGORIES,
    picked: null, // { name, address, latitude, longitude }
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
    try {
      const res = await wx.chooseLocation({});
      if (!res) return;
      this.setData({
        picked: {
          name: res.name || '',
          address: res.address || '',
          latitude: res.latitude,
          longitude: res.longitude,
        },
      });
    } catch (err) {
      if (err?.errMsg?.includes('auth')) {
        wx.showModal({
          title: '需要位置权限',
          content: '请在设置中允许使用位置信息',
          confirmText: '去设置',
          success: (r) => r.confirm && wx.openSetting({}),
        });
      }
    }
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
    const { picked, category, description, priceHint, hours, tags } = this.data;
    if (!picked) {
      wx.showToast({ title: '先选择一个位置', icon: 'none' });
      return;
    }
    // 登录守卫：未登录静默登录；昵称未确认时弹层，确认后自动重试保存
    const nickname = await auth.requireIdentity(this, () => this.save());
    if (!nickname) return;
    this.setData({ saving: true });
    try {
      await api.createPlace(app.globalData.map.code, {
        name: picked.name || '未命名地点',
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
    }
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
});
