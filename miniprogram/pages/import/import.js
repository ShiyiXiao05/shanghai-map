const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');
const { validEmoji } = require('../../utils/emoji.js');
const { applyTheme } = require('../../utils/theme.js');
const { parseAmapShare } = require('../../utils/amap.js');

// 畸形百分号编码（如 %E0%A4%A）会让 decodeURIComponent 抛 URIError，统一兜底文案
const BAD_LINK_TIP = '链接格式不正确，请在高德 App 里重新分享';

Page({
  behaviors: [identityBehavior],

  data: {
    raw: '',
    result: null, // 解析结果 {lng,lat,name,address} | {keyword} | {error}
    categories: CATEGORIES,
    category: CATEGORIES[0].id,
    nickname: '', // 登录身份展示用；署名由服务端按登录昵称盖章
    saving: false,
    emoji: '',
  },

  onShow() {
    applyTheme(this);
    this.setData({ nickname: storage.getNickname() });
  },

  // 不自动读剪贴板：iOS 进页面就弹"允许粘贴"很打扰，也可能被当成过度收集。
  // 由用户点「读取剪贴板」按钮后再读（高德分享过来的文本一直在剪贴板里，随时可读）。
  readClipboard() {
    wx.getClipboardData({
      success: (res) => {
        const text = (res.data || '').trim();
        if (!text) {
          wx.showToast({ title: '剪贴板是空的', icon: 'none' });
          return;
        }
        this.setData({ raw: text });
        this.parse();
      },
      fail: () => wx.showToast({ title: '读不到剪贴板，请手动粘贴', icon: 'none' }),
    });
  },

  onRaw(event) {
    this.setData({ raw: event.detail.value });
  },

  parse() {
    let result;
    try {
      // 畸形链接（非法百分号编码等）会在这里抛异常，兜住并提示，不留下半解析状态
      result = parseAmapShare(this.data.raw);
    } catch (err) {
      wx.showToast({ title: BAD_LINK_TIP, icon: 'none' });
      result = { error: BAD_LINK_TIP };
    }
    this.setData({ result });
  },

  onCategory(event) {
    this.setData({ category: this.data.categories[event.detail.value].id });
  },

  onEmojiChange(event) { this.setData({ emoji: event.detail.value }); },

  async save() {
    if (this.submitting) return; // 防重复提交：弱网连点会导入多个相同地点
    const r = this.data.result;
    if (!r || r.error || r.keyword) return;
    this.submitting = true;
    try {
      // 登录守卫：未登录静默登录；昵称未确认时弹层，确认后自动重试导入
      const nickname = await auth.requireIdentity(this, () => this.save());
      if (!nickname) return;
      this.setData({ saving: true });
      await api.createPlace(app.globalData.map.code, {
        name: r.name || '未命名地点',
        category: this.data.category,
        address: r.address ?? '',
        lng: r.lng,
        lat: r.lat,
        emoji: validEmoji(this.data.emoji) ? this.data.emoji : '',
      });
      wx.showToast({ title: '已导入' });
      setTimeout(() => wx.navigateBack({ delta: 2 }), 700);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this.submitting = false;
    }
  },

  goSearch() {
    wx.navigateBack();
  },
});
