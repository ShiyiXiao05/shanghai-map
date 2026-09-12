const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const storage = require('../../utils/storage.js');

// 添加地点：wx.chooseLocation 是微信原生的「搜索+地图选点」合一选择器
// （自带腾讯 POI 搜索与逆地理吸附，无需额外位置服务 key）
Page({
  data: {
    categories: CATEGORIES,
    picked: null, // { name, address, latitude, longitude }
    category: CATEGORIES[0].id,
    description: '',
    priceHint: '',
    hours: '',
    tags: '',
    nickname: '',
    saving: false,
  },

  onLoad() {
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

  onNickname(event) {
    this.setData({ nickname: event.detail.value });
  },

  async save() {
    const { picked, category, description, priceHint, hours, tags, nickname } = this.data;
    if (!picked) {
      wx.showToast({ title: '先选择一个位置', icon: 'none' });
      return;
    }
    if (nickname.trim()) storage.setNickname(nickname.trim());
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
        added_by: nickname.trim(),
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
