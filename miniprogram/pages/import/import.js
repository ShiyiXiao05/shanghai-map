const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
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
  data: {
    raw: '',
    result: null, // 解析结果 {lng,lat,name,address} | {keyword} | {error}
    categories: CATEGORIES,
    category: CATEGORIES[0].id,
    nickname: '',
    saving: false,
  },

  onLoad() {
    this.setData({ nickname: storage.getNickname() });
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

  onNickname(event) {
    this.setData({ nickname: event.detail.value });
  },

  async save() {
    const r = this.data.result;
    if (!r || r.error || r.keyword) return;
    if (this.data.nickname.trim()) storage.setNickname(this.data.nickname.trim());
    this.setData({ saving: true });
    try {
      await api.createPlace(app.globalData.map.code, {
        name: r.name || '未命名地点',
        category: this.data.category,
        address: r.address ?? '',
        lng: r.lng,
        lat: r.lat,
        added_by: this.data.nickname.trim(),
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
