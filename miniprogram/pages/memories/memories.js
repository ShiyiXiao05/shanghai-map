const app = getApp();
const { api } = require('../../utils/api.js');

Page({
  data: {
    groups: [], // [{month, items: [{id, name, category, added_by, address, date, photos}]}]
    loading: true,
  },

  onShow() {
    const code = app.globalData.map?.code;
    if (!code) {
      this.setData({ loading: false, groups: [] });
      return;
    }
    wx.setNavigationBarTitle({ title: `回忆 · ${app.globalData.map.name}` });
    api
      .memories(code)
      .then((memories) => {
        const groups = [];
        const index = {};
        for (const m of memories) {
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
        this.setData({ groups, loading: false });
      })
      .catch((err) => {
        this.setData({ loading: false });
        wx.showToast({ title: err.message, icon: 'none' });
      });
  },

  openDetail(event) {
    wx.navigateTo({ url: `/pages/detail/detail?placeId=${event.currentTarget.dataset.id}` });
  },
});
