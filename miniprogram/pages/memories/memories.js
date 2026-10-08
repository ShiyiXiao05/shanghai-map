const app = getApp();
const { api } = require('../../utils/api.js');

Page({
  data: {
    groups: [], // [{month, items: [{id, name, category, added_by, address, date, photos}]}]
    loading: true,
    error: '', // 非空即加载失败态，与「还没有打卡记录」区分
    noMap: false, // 未加入地图：文案与入口都不同于空态
  },

  onShow() {
    this.load();
  },

  load() {
    const map = app.globalData.map;
    if (!map?.code) {
      this.setData({ loading: false, groups: [], error: '', noMap: true });
      return;
    }
    wx.setNavigationBarTitle({ title: `回忆 · ${map.name}` });
    this.setData({ loading: true, error: '', noMap: false, groups: [] });
    api
      .memories(map.code)
      .then((memories) => {
        const list = Array.isArray(memories) ? memories : [];
        const groups = [];
        const index = {};
        for (const m of list) {
          const date = new Date(m.visited_at);
          const month = `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
          if (!index[month]) {
            index[month] = { month, items: [] };
            groups.push(index[month]);
          }
          index[month].items.push({
            ...m,
            date: `${date.getMonth() + 1}/${date.getDate()}`,
            photos: (m.photos ?? []).slice(0, 4),
          });
        }
        this.setData({ groups, loading: false, error: '' });
      })
      .catch((err) => {
        // 失败态：给出重试，不伪装成「还没有打卡记录」
        this.setData({
          groups: [],
          loading: false,
          error: err?.message || '加载失败，请重试',
        });
      });
  },

  retry() {
    this.load();
  },

  goEntry() {
    wx.navigateTo({
      url: '/pages/entry/entry',
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    });
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?placeId=${event.currentTarget.dataset.id}` });
  },
});
