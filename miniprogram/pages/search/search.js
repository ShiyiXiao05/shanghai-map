Page({
  data: { keyword: '', results: [], tip: '搜索与地图选点添加正在接入腾讯位置服务（下一迭代）' },
  onInput(e) { this.setData({ keyword: e.detail.value }); },
});
