const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta, CATEGORIES } = require('../../utils/config.js');
const storage = require('../../utils/storage.js');
const { getLocation } = require('../../utils/location.js');

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
    sortIndex: 0, // picker 索引，与 storage.SORTS 顺序一致
    places: [],
    filtered: [],
    markers: [],
    longitude: SHANGHAI_CENTER.longitude,
    latitude: SHANGHAI_CENTER.latitude,
    loading: true,
    loadError: '', // 加载失败时展示错误态 + 重试，而不是空态
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
  pendingPlaceId: null, // 分享链接 ?place=ID，仅消费一次

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
    this.restoreSort();

    // 分享链接直达：?map=CODE（加入地图）与 ?place=ID（打开详情，列表就绪后仅消费一次）
    if (query && query.place) this.pendingPlaceId = Number(query.place) || null;
    if (query && query.map) {
      this.joinByCode(query.map);
    }
  },

  onReady() {
    // canvas 节点要等首次渲染完成才存在，放 onLoad 会取到空节点 → marker 永远没图标
    this.prepareMarkerIcons();
  },

  onShow() {
    const g = app.globalData;
    if (!g.map && !g.isPublicView) {
      this.enterEntry();
      return;
    }
    this.restoreSort();
    this.setData({ mapName: g.map ? g.map.name : '公共广场', isPublicView: g.isPublicView });
    this.loadPlaces().finally(() => {
      // 正在加入分享地图时，由 joinByCode 负责打开详情
      if (!this._joining) this.openPendingPlace();
    });
  },

  // 排序偏好：picker 用索引，storage 存 newest|name|wishes
  restoreSort() {
    const sort = storage.getSort();
    const index = storage.SORTS.indexOf(sort);
    this.setData({ sort, sortIndex: index === -1 ? 0 : index });
  },

  // 分享链接带的 ?place=ID：地点列表加载完成后打开详情，只消费一次（返回时不重复跳转）
  openPendingPlace() {
    const id = this.pendingPlaceId;
    if (!id) return;
    this.pendingPlaceId = null;
    const place = this.data.places.find((p) => p.id === id);
    if (place) app.globalData.detailPlace = place;
    wx.navigateTo({ url: `/pages/detail/detail?placeId=${id}` });
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

  onShareTimeline() {
    const g = app.globalData;
    return {
      title: g.map ? `「${g.map.name}」· 魔都Explore` : '魔都·Explore · 和同学一起标记上海',
      query: g.map ? `map=${g.map.code}` : '',
    };
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
    this._unloaded = true; // 图标兜底超时回调可能晚于卸载，用它拦住 setData
    clearInterval(this.randomTimer);
  },

  async locateNearby() {
    if (this.data.places.length === 0) {
      wx.showToast({ title: '当前地图还没有地点', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '定位中…' });
    const result = await getLocation();
    wx.hideLoading();

    if (result.ok) {
      this.showNearby(result.data, false);
      return;
    }
    if (result.reason === 'cancel') return;
    if (result.reason === 'denied') {
      wx.showModal({
        title: '需要位置权限',
        content: '请在设置中允许使用位置信息后重试',
        confirmText: '去设置',
        success: (r) => r.confirm && wx.openSetting({}),
      });
      return;
    }
    // 未开通地理位置接口权限：按地图当前中心近似计算，功能不缺失
    if (result.reason === 'disabled' || result.reason === 'unsupported') {
      this.showNearby({ longitude: this.data.longitude, latitude: this.data.latitude }, true);
      return;
    }
    wx.showToast({ title: '暂时无法获取位置', icon: 'none' });
  },

  // 按给定坐标算最近 5 个地点；approximate=true 表示用的是地图中心而不是真实定位
  showNearby(location, approximate) {
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
      showLocation: !approximate,
      nearbyPlaces: nearest,
      nearbyOpen: true,
    });
    if (approximate) {
      wx.showToast({ title: '未开通定位权限，按地图中心近似排序', icon: 'none' });
    }
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
    this._joining = true;
    try {
      const map = await api.getMap(code.trim().toUpperCase());
      app.enterMap(map);
      this.setData({ mapName: map.name, isPublicView: false });
      await this.loadPlaces();
      wx.hideLoading();
      wx.showToast({ title: `已加入「${map.name}」`, icon: 'none' });
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    } finally {
      this._joining = false;
      // 分享链接同时带了 ?place=ID 时，等新地图地点就绪后再打开详情
      this.openPendingPlace();
    }
  },

  async loadPlaces() {
    const code = app.globalData.map?.code || '';
    const requestId = (this._placesRequestId || 0) + 1;
    this._placesRequestId = requestId;
    // 先清空：避免「新地图名 + 旧地图数据」，也避免旧数据在失败时被当成有效结果
    this.setData({ places: [], filtered: [], markers: [], loading: true, loadError: '' });
    try {
      const places = code ? await api.listPlaces(code) : await api.publicPlaces();
      if (requestId !== this._placesRequestId || code !== (app.globalData.map?.code || '')) return;
      this.setData({ places, loading: false, loadError: '' });
      this.applyFilters();
    } catch (err) {
      if (requestId !== this._placesRequestId || code !== (app.globalData.map?.code || '')) return;
      // 失败展示错误态 + 重试按钮，不再伪装成「这张地图还没有地点」
      this.setData({ loading: false, loadError: (err && err.message) || '加载失败，请重试' });
    }
  },

  retryLoad() {
    this.loadPlaces();
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

  // 用 canvas 生成分类色圆点作为 marker 图标（免打包图片资源）。
  // 7 个图标串行绘制：共用同一 canvas 时并发会互相串色；
  // 整体加 4s 超时兜底，无论如何都会 setData 一次，避免 marker 永久缺失
  async prepareMarkerIcons() {
    if (this._markerIconsRunning) return;
    this._markerIconsRunning = true;
    const categories = [...CATEGORIES.map((c) => c.id + '|' + c.color), 'visited|#8a94a3'];
    const icons = {};
    let finished = false;
    const apply = () => {
      if (this._unloaded) return;
      this.setData({ markerIcons: { ...icons } });
      this.renderMarkers(this.data.filtered); // 图标就绪后重新渲染一次 markers
    };
    const run = (async () => {
      try {
        for (const item of categories) {
          const [id, color] = item.split('|');
          icons[id] = await this.drawDotIcon(color); // 串行绘制：共用 canvas 并发会串色
        }
      } catch (err) {
        console.warn('[index] 生成 marker 图标失败，改用系统默认标记', err);
      } finally {
        finished = true;
        this._markerIconsRunning = false;
        apply();
      }
    })();
    // 兜底超时：4s 还没画完也先渲染一次，保证地图一定有点位（缺图标用系统默认标记）
    const timeout = new Promise((resolve) =>
      setTimeout(() => {
        if (!finished) apply();
        resolve();
      }, 4000)
    );
    await Promise.race([run, timeout]);
  },

  drawDotIcon(color) {
    return new Promise((resolve) => {
      // 任何一步异常都 resolve('')，保证 Promise 一定 settle（页面用系统默认标记兜底）
      try {
        const query = this.createSelectorQuery();
        query
          .select('#icon-factory')
          .fields({ node: true, size: true })
          .exec((res) => {
            const canvas = res && res[0] && res[0].node;
            if (!canvas) {
              console.warn('[index] marker 图标画布未就绪，改用系统默认标记');
              resolve('');
              return;
            }
            try {
              const ctx = canvas.getContext('2d');
              const dpr = 2;
              canvas.width = 44 * dpr; // 重置尺寸同时清空画布，避免上一张图残留
              canvas.height = 44 * dpr;
              ctx.clearRect(0, 0, canvas.width, canvas.height);
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
                success: (out) => resolve((out && out.tempFilePath) || ''),
                fail: (err) => {
                  console.warn('[index] marker 图标导出失败', err);
                  resolve('');
                },
              });
            } catch (err) {
              console.warn('[index] marker 图标绘制失败', err);
              resolve('');
            }
          });
      } catch (err) {
        console.warn('[index] marker 图标画布查询失败', err);
        resolve('');
      }
    });
  },

  renderMarkers(places) {
    const markerIcons = this.data.markerIcons || {};
    const hasIcon = !!markerIcons.visited || CATEGORIES.some((c) => markerIcons[c.id]);
    if (!hasIcon && (places || []).length > 0 && !this._warnedNoIcon) {
      // 图标没生成成功也要把点位画出来：不带 iconPath 时地图用系统默认标记
      this._warnedNoIcon = true;
      console.warn('[index] marker 图标缺失，改用系统默认标记');
    }
    const markers = (places || []).map((p) => {
      const meta = categoryMeta(p.category);
      const iconKey = p.visited ? 'visited' : p.category;
      const iconPath = markerIcons[iconKey] || markerIcons.visited || '';
      const marker = {
        id: p.id,
        latitude: p.lat,
        longitude: p.lng,
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
      if (iconPath) marker.iconPath = iconPath; // 缺图标时不传该字段，交给系统默认标记
      return marker;
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

  // picker 的 bindchange 给的是索引（'0'/'1'/'2'），必须映射成 newest|name|wishes 才能排序
  onSortChange(event) {
    const sort = storage.SORTS[Number(event.detail.value)] || 'newest';
    storage.setSort(sort);
    this.setData({ sort, sortIndex: storage.SORTS.indexOf(sort) });
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
