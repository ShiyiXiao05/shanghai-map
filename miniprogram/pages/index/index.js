const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta, CATEGORIES } = require('../../utils/config.js');
const storage = require('../../utils/storage.js');

const SHANGHAI_CENTER = { longitude: 121.4737, latitude: 31.2304 };

Page({
  data: {
    statusBarHeight: 20,
    navRightInset: 100, // 右侧避让胶囊的内缩 px
    navBottomPad: 8, // 导航栏底部留白 px
    mapName: '',
    isPublicView: false,
    categories: CATEGORIES,
    activeCategories: CATEGORIES.map((c) => c.id),
    hideVisitedOnly: false,
    sort: 'newest',
    places: [],
    filtered: [],
    markers: [],
    longitude: SHANGHAI_CENTER.longitude,
    latitude: SHANGHAI_CENTER.latitude,
    loading: true,
    markerIcons: {}, // categoryId -> 临时图标路径
  },

  mapCtx: null,

  onLoad(query) {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight || 20 });
    // 避让右上角微信胶囊：按钮区右边界缩到胶囊左侧，导航栏高度包住胶囊
    const menu = wx.getMenuButtonBoundingClientRect();
    if (menu && menu.left > 0) {
      this.setData({
        navRightInset: sys.windowWidth - menu.left + 8,
        navBottomPad: Math.max(6, menu.top - (sys.statusBarHeight || 20)),
      });
    } else {
      this.setData({ navRightInset: 100, navBottomPad: 8 });
    }
    this.mapCtx = wx.createMapContext('mainMap', this);
    this.prepareMarkerIcons();

    // 分享链接直达：?map=CODE
    if (query && query.map) {
      this.joinByCode(query.map);
    }
  },

  onShow() {
    const g = app.globalData;
    if (!g.map && !g.isPublicView) {
      this.enterEntry();
      return;
    }
    this.setData({ mapName: g.map ? g.map.name : '公共广场', isPublicView: g.isPublicView });
    this.loadPlaces();
  },

  onShareAppMessage() {
    const g = app.globalData;
    if (g.map) {
      return {
        title: `「${g.map.name}」邀请你一起标记想去的地方`,
        path: `/pages/index/index?map=${g.map.code}`,
      };
    }
    return { title: '魔都·Explore · 和同学一起标记上海', path: '/pages/index/index' };
  },

  onPullDownRefresh() {
    this.loadPlaces().finally(() => wx.stopPullDownRefresh());
  },

  enterEntry() {
    wx.navigateTo({ url: '/pages/entry/entry' });
  },

  goItinerary() {
    if (!app.globalData.map || app.globalData.isPublicView) {
      wx.showToast({ title: '公共广场是只读的，先加入一张地图', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: '/pages/itinerary/itinerary' });
  },

  async joinByCode(code) {
    wx.showLoading({ title: '加入地图…' });
    try {
      const map = await api.getMap(code.trim().toUpperCase());
      app.enterMap(map);
      wx.hideLoading();
      wx.showToast({ title: `已加入「${map.name}」`, icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async loadPlaces() {
    const g = app.globalData;
    try {
      const places = g.map ? await api.listPlaces(g.map.code) : await api.publicPlaces();
      this.setData({ places, loading: false });
      this.applyFilters();
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  applyFilters() {
    const { places, activeCategories, hideVisitedOnly, sort } = this.data;
    let filtered = places.filter(
      (p) => activeCategories.indexOf(p.category) !== -1 && !(hideVisitedOnly && p.visited)
    );
    if (sort === 'name') {
      filtered = [...filtered].sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh'));
    } else if (sort === 'wishes') {
      filtered = [...filtered].sort(
        (a, b) => (b.wishes?.length ?? 0) - (a.wishes?.length ?? 0)
      );
    } else {
      filtered = [...filtered].sort((a, b) => b.id - a.id);
    }
    const decorated = filtered.map((p) => {
      const meta = categoryMeta(p.category);
      return {
        ...p,
        emoji: meta.emoji,
        emojiColor: meta.color,
        wishCount: p.wishes?.length ?? 0,
      };
    });
    this.setData({ filtered: decorated });
    this.renderMarkers(decorated);
  },

  // 用 canvas 生成分类色圆点作为 marker 图标（免打包图片资源）
  prepareMarkerIcons() {
    const categories = [...CATEGORIES.map((c) => c.id + '|' + c.color), 'visited|#8a94a3'];
    const icons = {};
    let pending = categories.length;
    categories.forEach((item) => {
      const [id, color] = item.split('|');
      this.drawDotIcon(color).then((path) => {
        icons[id] = path;
        pending -= 1;
        if (pending === 0) {
          this.setData({ markerIcons: icons });
          this.renderMarkers(this.data.filtered);
        }
      });
    });
  },

  drawDotIcon(color) {
    return new Promise((resolve) => {
      const query = this.createSelectorQuery();
      query
        .select('#icon-factory')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res[0].node;
          const ctx = canvas.getContext('2d');
          const dpr = 2;
          canvas.width = 44 * dpr;
          canvas.height = 44 * dpr;
          ctx.scale(dpr, dpr);
          ctx.beginPath();
          ctx.arc(22, 22, 17, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
          ctx.lineWidth = 4;
          ctx.strokeStyle = '#ffffff';
          ctx.stroke();
          wx.canvasToTempFilePath({
            canvas,
            width: 44,
            height: 44,
            destWidth: 88,
            destHeight: 88,
            success: (out) => resolve(out.tempFilePath),
            fail: () => resolve(''),
          });
        });
    });
  },

  renderMarkers(places) {
    const { markerIcons } = this.data;
    if (!markerIcons['visited']) return;
    const markers = places.map((p) => {
      const meta = categoryMeta(p.category);
      const iconKey = p.visited ? 'visited' : p.category;
      return {
        id: p.id,
        latitude: p.lat,
        longitude: p.lng,
        iconPath: markerIcons[iconKey] || markerIcons['visited'],
        width: p.visited ? 22 : 26,
        height: p.visited ? 22 : 26,
        callout: {
          content: `${meta.emoji} ${p.name}`,
          display: 'BYCLICK',
          borderRadius: 8,
          padding: 6,
          fontSize: 12,
          bgColor: '#ffffff',
          color: '#1f2d2a',
        },
      };
    });
    this.setData({ markers });
  },

  onMarkerTap(event) {
    const place = this.data.places.find((p) => p.id === event.detail.markerId);
    if (place) this.openDetail(place);
  },

  openDetail(place) {
    app.globalData.detailPlace = place; // 公共广场无邀请码时，详情页直接用这份只读数据
    wx.navigateTo({ url: `/pages/detail/detail?placeId=${place.id}` });
  },

  onTapPlace(event) {
    const id = event.currentTarget.dataset.id;
    const place = this.data.places.find((p) => p.id === Number(id));
    if (!place) return;
    this.mapCtx.moveToLocation({ longitude: place.lng, latitude: place.lat });
    this.openDetail(place);
  },

  toggleCategory(event) {
    const id = event.currentTarget.dataset.id;
    let active = [...this.data.activeCategories];
    if (active.indexOf(id) !== -1) {
      if (active.length === 1) return;
      active = active.filter((c) => c !== id);
    } else {
      active.push(id);
    }
    this.setData({ activeCategories: active });
    this.applyFilters();
  },

  toggleHideVisited() {
    this.setData({ hideVisitedOnly: !this.data.hideVisitedOnly });
    this.applyFilters();
  },

  onSortChange(event) {
    this.setData({ sort: event.detail.value });
    wx.setStorageSync(storage.KEYS.sort, event.detail.value);
    this.applyFilters();
  },

  goSearch() {
    if (this.data.isPublicView) {
      this.enterEntry();
      return;
    }
    wx.navigateTo({ url: '/pages/search/search' });
  },

  goMapEntry() {
    wx.navigateTo({ url: '/pages/entry/entry' });
  },

  goMemories() {
    wx.navigateTo({ url: '/pages/memories/memories' });
  },
});
