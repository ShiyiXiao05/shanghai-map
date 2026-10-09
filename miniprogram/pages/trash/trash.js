const app = getApp();
const { api } = require('../../utils/api.js');
const { applyTheme } = require('../../utils/theme.js');

const KEEP_DAYS = 30;

function formatDeleted(value) {
  if (!value) return '未知时间';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function daysLeft(value) {
  if (!value) return KEEP_DAYS;
  const elapsed = (Date.now() - new Date(value).getTime()) / 86400000;
  return Math.max(0, KEEP_DAYS - Math.floor(elapsed));
}

Page({
  data: {
    items: [],
    loading: true,
    error: '',
    noMap: false,
  },

  onShow() {
    applyTheme(this);
    this.load();
  },

  async load() {
    const code = app.globalData.map?.code;
    if (!code) {
      this.setData({ noMap: true, loading: false, items: [], error: '' });
      return;
    }
    this.setData({ loading: true, error: '' });
    try {
      const places = await api.trash(code);
      this.setData({
        items: places.map((p) => ({
          ...p,
          deletedText: formatDeleted(p.deleted_at),
          daysLeft: daysLeft(p.deleted_at),
          restoring: false,
        })),
        loading: false,
        noMap: false,
      });
    } catch (err) {
      this.setData({
        loading: false,
        error: (err && err.message) || '加载失败，请重试',
      });
    }
  },

  async restore(event) {
    const id = Number(event.currentTarget.dataset.id);
    const code = app.globalData.map?.code;
    if (!id || !code) return;
    const item = this.data.items.find((p) => p.id === id);
    if (!item || item.restoring) return; // 防连点：同一条恢复中忽略重复触发
    this.setData({ items: this.data.items.map((p) => (p.id === id ? { ...p, restoring: true } : p)) });
    try {
      await api.restorePlace(code, id);
      wx.showToast({ title: '已恢复到地图', icon: 'none' });
      await this.load();
    } catch (err) {
      this.setData({
        items: this.data.items.map((p) => (p.id === id ? { ...p, restoring: false } : p)),
      });
      wx.showToast({ title: (err && err.message) || '恢复失败，请重试', icon: 'none' });
    }
  },

  goEntry() {
    wx.reLaunch({ url: '/pages/entry/entry' });
  },

  back() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    });
  },
});
