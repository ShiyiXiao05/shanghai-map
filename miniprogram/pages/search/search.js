const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');

// 权限类失败（位置权限被拒、隐私授权未声明等）统一引导去设置页
const AUTH_PATTERN = /auth|deny|privacy|scope/i;

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
      // 用户主动取消不算失败，静默返回
      if (/cancel/i.test(err?.errMsg || '')) return;
      if (AUTH_PATTERN.test(err?.errMsg || '')) {
        wx.showModal({
          title: '需要位置权限',
          content: '请在设置中允许使用位置信息后重试',
          confirmText: '去设置',
          success: (r) => r.confirm && wx.openSetting({}),
        });
        return;
      }
      // 其余失败给可读中文提示，不把英文 errMsg 抛给用户
      wx.showToast({ title: '选择位置失败，请重试或改用粘贴导入', icon: 'none' });
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
    if (this.submitting) return; // 防重复提交：弱网连点会创建多个地点
    const { picked, category, description, priceHint, hours, tags } = this.data;
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
    } finally {
      this.submitting = false;
    }
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
});
