const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');

// 解析逻辑与网页版 app.js 的 parseAmapShare 保持一致
function parseAmapShare(raw) {
  const text = (raw ?? '').trim();
  if (!text) return { error: '还没有粘贴内容' };

  const marker = text.match(/uri\.amap\.com\/marker\?([^\s"']+)/);
  if (marker) {
    const qs = marker[1].replace(/&amp;/g, '&');
    const get = (key) => {
      const m = qs.match(new RegExp(`(?:^|&)${key}=([^&]*)`));
      return m ? decodeURIComponent(m[1]).trim() : '';
    };
    const [lngStr, latStr] = get('position').split(',');
    const lng = Number(lngStr);
    const lat = Number(latStr);
    if (Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0) {
      return { lng, lat, name: get('name'), address: get('addr') };
    }
  }

  const coord = text.match(/(\d{1,3}\.\d{4,})\s*[,，]\s*(\d{1,2}\.\d{4,})/);
  const bracket = text.match(/【(.+?)】|「(.+?)」|『(.+?)』/);
  if (coord) {
    const lng = Number(coord[1]);
    const lat = Number(coord[2]);
    if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return {
        lng,
        lat,
        name: bracket?.[1] ?? bracket?.[2] ?? bracket?.[3] ?? '',
      };
    }
  }

  const name = bracket?.[1] ?? bracket?.[2] ?? bracket?.[3];
  if (name) return { keyword: name };

  if (/amap\.com\/(place|detail|p)\/[A-Za-z0-9]+/i.test(text)) {
    return { error: '这个链接只有地点编号。请粘贴高德 App 分享的完整文本（含地点名或「位置：经度,纬度」），或改用搜索选点。' };
  }

  return { error: '没有识别出坐标或地点名，确认粘贴的是高德分享文本/链接。' };
}

Page({
  behaviors: [identityBehavior],

  data: {
    raw: '',
    result: null, // 解析结果 {lng,lat,name,address} | {keyword} | {error}
    categories: CATEGORIES,
    category: CATEGORIES[0].id,
    nickname: '', // 登录身份展示用；署名由服务端按登录昵称盖章
    saving: false,
  },

  onShow() {
    this.setData({ nickname: storage.getNickname() });
  },

  onLoad() {
    // 高德 App 分享后直接进来：自动读剪贴板
    wx.getClipboardData({
      success: (res) => {
        if (res.data && res.data.trim()) {
          this.setData({ raw: res.data.trim() });
          this.parse();
        }
      },
    });
  },

  onRaw(event) {
    this.setData({ raw: event.detail.value });
  },

  parse() {
    const result = parseAmapShare(this.data.raw);
    this.setData({ result });
  },

  onCategory(event) {
    this.setData({ category: this.data.categories[event.detail.value].id });
  },

  async save() {
    const r = this.data.result;
    if (!r || r.error || r.keyword) return;
    // 登录守卫：未登录静默登录；昵称未确认时弹层，确认后自动重试导入
    const nickname = await auth.requireIdentity(this, () => this.save());
    if (!nickname) return;
    this.setData({ saving: true });
    try {
      await api.createPlace(app.globalData.map.code, {
        name: r.name || '未命名地点',
        category: this.data.category,
        address: r.address ?? '',
        lng: r.lng,
        lat: r.lat,
      });
      wx.showToast({ title: '已导入' });
      setTimeout(() => wx.navigateBack({ delta: 2 }), 700);
    } catch (err) {
      this.setData({ saving: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  goSearch() {
    wx.navigateBack();
  },
});
