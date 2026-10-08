const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta, CATEGORIES } = require('../../utils/config.js');
const storage = require('../../utils/storage.js');

const SHANGHAI_CENTER = { longitude: 121.4737, latitude: 31.2304 };

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (Number(b.lat) - Number(a.latitude)) * rad;
  const dLng = (Number(b.lng) - Number(a.longitude)) * rad;
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(Number(a.latitude) * rad) * Math.cos(Number(b.lat) * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(value));
}

function formatDistance(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

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
    isMapFs: false, // 地图全屏态
    refreshing: false, // 列表下拉刷新中
    isDark: false, // 跟随系统深色，控制下拉刷新指示器配色
    showLocation: false,
    nearbyOpen: false,
    nearbyPlaces: [],
    randomOpen: false,
    randomDrawing: false,
    randomPlace: null,
  },

  mapCtx: null,
  randomTimer: null,

  noop() {},

  onLoad(query) {
    const sys = wx.getSystemInfoSync();
    this.setData({ statusBarHeight: sys.statusBarHeight || 20, isDark: sys.theme === 'dark' });
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

  // 页面本身 disableScroll（防止拖地图时页面跟着动），下拉刷新由列表 scroll-view 承担
  onRefresherRefresh() {
    if (this.data.refreshing) return;
    this.setData({ refreshing: true });
    this.loadPlaces().finally(() => this.setData({ refreshing: false }));
  },

  toggleMapFs() {
    this.setData({ isMapFs: !this.data.isMapFs });
  },

  onUnload() {
    clearInterval(this.randomTimer);
  },

  locateNearby() {
    if (this.data.places.length === 0) {
      wx.showToast({ title: '当前地图还没有地点', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '定位中…' });
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (location) => {
        const nearest = this.data.places
          .filter((place) => Number.isFinite(Number(place.lng)) && Number.isFinite(Number(place.lat)))
          .map((place) => {
            const distanceKm = haversineKm(location, place);
            const meta = categoryMeta(place.category);
            return { ...place, emoji: meta.emoji, distance: formatDistance(distanceKm), distanceKm };
          })
          .sort((a, b) => a.distanceKm - b.distanceKm)
          .slice(0, 5);
        this.setData({
          longitude: location.longitude,
          latitude: location.latitude,
          showLocation: true,
          nearbyPlaces: nearest,
          nearbyOpen: true,
        });
      },
      fail: (err) => {
        const denied = String(err.errMsg || '').includes('auth deny');
        wx.showToast({ title: denied ? '请在设置中允许位置权限' : '暂时无法获取位置', icon: 'none' });
      },
      complete: () => wx.hideLoading(),
    });
  },

  closeNearby() {
    this.setData({ nearbyOpen: false });
  },

  openNearbyPlace(event) {
    const place = this.data.places.find((item) => item.id === Number(event.currentTarget.dataset.id));
    if (!place) return;
    this.setData({ nearbyOpen: false, longitude: place.lng, latitude: place.lat });
    this.openDetail(place);
  },

  drawRandom() {
    const places = this.data.places;
    if (places.length === 0) {
      wx.showToast({ title: '当前地图还没有地点', icon: 'none' });
      return;
    }
    clearInterval(this.randomTimer);
    this.setData({ randomOpen: true, randomDrawing: true, randomPlace: null });
    let ticks = 0;
    this.randomTimer = setInterval(() => {
      const place = places[Math.floor(Math.random() * places.length)];
      const meta = categoryMeta(place.category);
      this.setData({ randomPlace: { ...place, emoji: meta.emoji } });
      ticks += 1;
      if (ticks < 12) return;
      clearInterval(this.randomTimer);
      this.randomTimer = null;
      this.setData({ randomDrawing: false });
    }, 70);
  },

  closeRandom() {
    clearInterval(this.randomTimer);
    this.randomTimer = null;
    this.setData({ randomOpen: false, randomDrawing: false });
  },

  openRandomPlace() {
    const place = this.data.randomPlace;
    if (!place || this.data.randomDrawing) return;
    this.closeRandom();
    this.setData({ longitude: place.lng, latitude: place.lat });
    this.openDetail(place);
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
      this.setData({
        mapName: map.name,
        isPublicView: false,
        places: [],
        filtered: [],
        markers: [],
        loading: true,
      });
      await this.loadPlaces();
      wx.hideLoading();
      wx.showToast({ title: `已加入「${map.name}」`, icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async loadPlaces() {
    const code = app.globalData.map?.code || '';
    const requestId = (this._placesRequestId || 0) + 1;
    this._placesRequestId = requestId;
    try {
      const places = code ? await api.listPlaces(code) : await api.publicPlaces();
      if (requestId !== this._placesRequestId || code !== (app.globalData.map?.code || '')) return;
      this.setData({ places, loading: false });
      this.applyFilters();
    } catch (err) {
      if (requestId !== this._placesRequestId || code !== (app.globalData.map?.code || '')) return;
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
