const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta, CATEGORIES } = require('../../utils/config.js');
const storage = require('../../utils/storage.js');
const { displayEmoji } = require('../../utils/emoji.js');
const cache = require('../../utils/cache.js');
const { applyTheme } = require('../../utils/theme.js');

const SHANGHAI_CENTER = { longitude: 121.4737, latitude: 31.2304 };
// 圆形标记里的 emoji 字号（逻辑 px）。圆内可用直径约 32，emoji 实际着色范围通常比字号大
// 1.2~1.4 倍，取 20px 既不溢出也能填满圆圈。
// 若在某些机型上仍有肉眼可见的偏移，只改这里即可（单位：逻辑 px）。
const EMOJI_FONT_PX = 20;
const EMOJI_NUDGE_X = 0;
const EMOJI_NUDGE_Y = 1;

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

function markerIconKey(place) {
  return `emoji:${place.category}:${displayEmoji(place)}:${place.visited ? 1 : 0}`;
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
    markerIcons: {}, // emoji/category/visited 组合 -> 临时图标路径
    isMapFs: false, // 地图全屏态
    refreshing: false, // 列表下拉刷新中
    isDark: false, // 跟随系统深色，控制下拉刷新指示器配色
    showMyDot: false, // 打开地图定位点（自动定位尝试时打开，由地图组件弹授权）
    nearbyOpen: false,
    nearbyPlaces: [],
    randomOpen: false,
    randomDrawing: false,
    randomPlace: null,
    selectedPlace: null,
    mapFraction: 0.43,
  },

  mapCtx: null,
  randomTimer: null,
  pendingPlaceId: null, // 分享链接 ?place=ID，仅消费一次

  noop() {},

  onLoad(query) {
    applyTheme(this);
    const sys = typeof wx.getWindowInfo === 'function'
      ? { ...wx.getWindowInfo(), ...(typeof wx.getAppBaseInfo === 'function' ? wx.getAppBaseInfo() : {}) }
      : wx.getSystemInfoSync();
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
    const savedFraction = Number(wx.getStorageSync('wish-map-fraction'));
    if (savedFraction >= 0.25 && savedFraction <= 0.7) this.setData({ mapFraction: savedFraction });

    // 分享链接直达：?map=CODE（加入地图）与 ?place=ID（打开详情，列表就绪后仅消费一次）
    if (query && query.place) this.pendingPlaceId = Number(query.place) || null;
    if (query && query.map) {
      this.joinByCode(query.map);
    }
  },

  onReady() {
    // canvas 节点要等首次渲染完成才存在，放 onLoad 会取到空节点 → marker 永远没图标
    this._markerCanvasReady = true;
    this.prepareMarkerIcons();
  },

  onShow() {
    applyTheme(this);
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
    this.loadPlaces(true).finally(() => this.setData({ refreshing: false }));
  },

  toggleMapFs() {
    this.setData({ isMapFs: !this.data.isMapFs });
  },

  onUnload() {
    this._unloaded = true; // 图标兜底超时回调可能晚于卸载，用它拦住 setData
    clearInterval(this.randomTimer);
  },

  onHide() {
    clearInterval(this.randomTimer);
    this.randomTimer = null;
  },

  onMapResize(event) {
    const height = Number(event.detail && event.detail.height);
    if (!height) return;
    const fraction = Math.max(0.25, Math.min(0.7, Number(this.data.mapFraction) + (Number(event.detail.deltaY) || 0) / height));
    this.setData({ mapFraction: fraction });
    wx.setStorageSync('wish-map-fraction', fraction);
  },

  onDividerStart(event) {
    const touch = event && event.touches && event.touches[0];
    const y = touch && Number(touch.clientY);
    if (!Number.isFinite(y)) return;
    this._dividerDragging = true;
    this._dividerStartY = y;
    this._dividerStartFraction = this.data.mapFraction;
    const sys = typeof wx.getWindowInfo === 'function' ? wx.getWindowInfo() : wx.getSystemInfoSync();
    this._dividerDragHeight = Math.max(1, Number(sys.windowHeight) - (Number(this.data.statusBarHeight) || 20) - 56 - 44);
    // 用实际的地图和列表高度作为分母；节点查询失败时保留窗口高度兜底值。
    if (this.createSelectorQuery) {
      const query = this.createSelectorQuery();
      query.select('.map-wrap').boundingClientRect();
      query.select('.panel').boundingClientRect();
      query.exec((rects) => {
        if (!this._dividerDragging) return;
        const mapHeight = Number(rects && rects[0] && rects[0].height) || 0;
        const panelHeight = Number(rects && rects[1] && rects[1].height) || 0;
        if (mapHeight + panelHeight > 0) this._dividerDragHeight = mapHeight + panelHeight;
      });
    }
  },

  onDividerMove(event) {
    if (!this._dividerDragging) return;
    const touch = event && event.touches && event.touches[0];
    const y = touch && Number(touch.clientY);
    const start = Number(this._dividerStartY);
    if (!Number.isFinite(y) || !Number.isFinite(start)) return;
    const height = Math.max(1, Number(this._dividerDragHeight) || 1);
    const fraction = Math.max(0.25, Math.min(0.7, this._dividerStartFraction + (y - start) / height));
    this.setData({ mapFraction: fraction });
  },

  onDividerEnd() {
    if (!this._dividerDragging) return;
    wx.setStorageSync('wish-map-fraction', this.data.mapFraction);
    this._dividerDragging = false;
    this._dividerStartY = null;
  },

  onDividerCancel() {
    this.onDividerEnd();
  },

  // 「附近」使用手机当前位置；定位失败时不使用地图中心点替代。
  // 「附近」：只用当前所在位置（地图组件定位能力，不调用被管控的地理位置接口）
  locateNearby() {
    if (this.data.places.length === 0) {
      wx.showToast({ title: '当前地图还没有地点', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '定位中…' });
    this.tryAutoLocate()
      .then((point) => {
        if (point) this.showNearby(point);
        else this.promptLocation();
      })
      .finally(() => wx.hideLoading());
  },

  // 定位不可用时的提示：能确定是用户拒绝就引导去设置，其余给可读原因
  promptLocation() {
    if (this.lastLocationDenied) {
      wx.showModal({
        title: '需要位置权限',
        content: '请在设置中允许使用位置信息，之后重新点「附近」。',
        confirmText: '去设置',
        success: (res) => {
          if (res.confirm && typeof wx.openSetting === 'function') wx.openSetting({});
        },
      });
      return;
    }
    wx.showToast({ title: '暂时定位不到，请稍后重试', icon: 'none' });
  },

  // 自动定位：地图组件自带定位（show-location + moveToLocation），不属于需要后台申请开通的
  // 地理位置接口，只要用户同意授权即可。组件未生效（未授权/中心点没移动）时返回 null。
  async tryAutoLocate() {
    const authorized = await this.ensureLocationAuth();
    if (!authorized) return null;
    if (typeof wx.createMapContext !== 'function') return null;
    let ctx;
    try {
      ctx = this.mapCtx || (this.mapCtx = wx.createMapContext('mainMap', this));
    } catch (err) {
      return null;
    }
    if (!ctx || typeof ctx.moveToLocation !== 'function' || typeof ctx.getCenterLocation !== 'function') {
      return null;
    }
    // moveToLocation 需要地图先打开定位点
    await new Promise((resolve) => this.setData({ showMyDot: true }, resolve));
    const before = { latitude: this.data.latitude, longitude: this.data.longitude };
    return new Promise((resolve) => {
      const done = (value) => resolve(value);
      try {
        ctx.moveToLocation({});
      } catch (err) {
        return done(null);
      }
      // 等地图动画结束再读中心点，此时中心点即当前位置
      setTimeout(() => {
        ctx.getCenterLocation({
          success: (center) => {
            const latitude = Number(center.latitude);
            const longitude = Number(center.longitude);
            if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return done(null);
            const moved = haversineKm(before, { lat: latitude, lng: longitude }) > 0.2;
            return done(moved ? { latitude, longitude } : null);
          },
          fail: () => done(null),
        });
      }, 1200);
    });
  },

  // 读取（必要时申请）地图定位所需的用户授权；明确拒绝过就不再弹
  ensureLocationAuth() {
    return new Promise((resolve) => {
      if (typeof wx.getSetting !== 'function') return resolve(true);
      wx.getSetting({
        success: (res) => {
          const state = res.authSetting ? res.authSetting['scope.userLocation'] : undefined;
          if (state === true) return resolve(true);
          if (state === false) {
            this.lastLocationDenied = true; // 明确拒绝过：可以引导去设置页
            return resolve(false);
          }
          if (typeof wx.authorize !== 'function') return resolve(true);
          wx.authorize({
            scope: 'scope.userLocation',
            success: () => resolve(true),
            fail: () => {
              this.lastLocationDenied = true;
              resolve(false);
            },
          });
        },
        fail: () => resolve(true),
      });
    });
  },

  // 按当前位置算最近 5 个地点
  showNearby(location) {
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
      nearbyPlaces: nearest,
      nearbyOpen: true,
    });
    wx.showToast({ title: '已按当前位置排序', icon: 'none' });
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
    let previousIndex = -1;
    const drawInterval = 80;
    const drawTicks = Math.ceil(2400 / drawInterval);
    this.randomTimer = setInterval(() => {
      let index = Math.floor(Math.random() * places.length);
      if (places.length > 1 && index === previousIndex) index = (index + 1) % places.length;
      previousIndex = index;
      const place = places[index];
      this.setData({ randomPlace: { ...place, emoji: displayEmoji(place) } });
      ticks += 1;
      if (ticks < drawTicks) return;
      clearInterval(this.randomTimer);
      this.randomTimer = null;
      this.setData({ randomDrawing: false });
    }, drawInterval);
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

  async loadPlaces(force = false) {
    const code = app.globalData.map?.code || '';
    const requestId = (this._placesRequestId || 0) + 1;
    this._placesRequestId = requestId;
    // 先清空：避免「新地图名 + 旧地图数据」，也避免旧数据在失败时被当成有效结果
    this.setData({ places: [], filtered: [], markers: [], loading: true, loadError: '' });
    try {
      const places = code ? await api.listPlaces(code, { force }) : await api.publicPlaces();
      if (requestId !== this._placesRequestId || code !== (app.globalData.map?.code || '')) return;
      cache.savePlaces(code, places);
      this.setData({ places, loading: false, loadError: '' });
      this.applyFilters();
    } catch (err) {
      if (requestId !== this._placesRequestId || code !== (app.globalData.map?.code || '')) return;
      // 失败展示错误态 + 重试按钮，不再伪装成「这张地图还没有地点」
      this.setData({ loading: false, loadError: (err && err.message) || '加载失败，请重试' });
    }
  },

  retryLoad() {
    this.loadPlaces(true);
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
        emoji: displayEmoji(p),
        emojiColor: meta.color,
        wishCount: p.wishes?.length ?? 0,
      };
    });
    this.setData({ filtered: decorated });
    this.renderMarkers(decorated);
  },

  // canvas 节点要等 onReady 后才能使用；所有地点图标都由同一条队列生成，避免多个 canvas 绘制任务互相覆盖。
  prepareMarkerIcons() {
    this._markerCanvasReady = true;
    this.preparePlaceIcons(this.data.filtered);
  },

  drawDotIcon(color, emoji = '', visited = false) {
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
              ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // 之后都用 44×44 的逻辑坐标
              ctx.clearRect(0, 0, 44, 44);
              ctx.beginPath();
              ctx.arc(22, 22, 17.5, 0, Math.PI * 2);
              ctx.fillStyle = color;
              ctx.fill();
              ctx.lineWidth = 3;
              ctx.strokeStyle = '#ffffff';
              ctx.stroke();
              if (emoji) {
                // 用 canvas 自身的居中能力画 emoji（不再做像素测量/缩放变换：
                // getImageData 在部分机型上返回整块不透明数据，会把缩放系数算成极小，
                // emoji 直接看不见）。字号与圆圈的比例已按"填满但不溢出"调好，
                // 个别机型若仍有偏移，只改上面的 EMOJI_FONT_PX / EMOJI_NUDGE_* 常量。
                ctx.font = `${EMOJI_FONT_PX}px sans-serif`;
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(emoji, 22 + EMOJI_NUDGE_X, 22 + EMOJI_NUDGE_Y);
              }
              if (visited) {
                ctx.beginPath();
                ctx.arc(35, 35, 7, 0, Math.PI * 2);
                ctx.fillStyle = '#8a94a3';
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 9px sans-serif';
                ctx.fillText('✓', 35, 35);
              }
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
    // 图标仍在生成时先使用系统默认标记，生成完成后会增量替换。
    const markers = (places || []).map((p) => {
      const emoji = displayEmoji(p);
      const selected = this.data.selectedPlace && Number(this.data.selectedPlace.id) === Number(p.id);
      const iconPath = markerIcons[markerIconKey(p)] || '';
      const marker = {
        id: p.id,
        latitude: p.lat,
        longitude: p.lng,
        width: selected ? 30 : p.visited ? 22 : 26,
        height: selected ? 30 : p.visited ? 22 : 26,
        // 圆形图标的中心就是地点坐标，避免默认底边锚点造成视觉偏移。
        anchor: { x: 0.5, y: 0.5 },
        callout: {
          content: `${emoji} ${p.name}${p.visited ? ' · ✓' : ''}`,
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
    this.preparePlaceIcons(places);
  },

  async preparePlaceIcons(places) {
    if (!this._markerCanvasReady || this._placeIconsRunning || this._unloaded) return;
    const wanted = [];
    const seen = new Set();
    for (const place of places || []) {
      const key = markerIconKey(place);
      const cached = Object.prototype.hasOwnProperty.call(this.data.markerIcons || {}, key);
      if (!seen.has(key) && !cached) { seen.add(key); wanted.push({ key, place }); }
      if (wanted.length >= 128) break;
    }
    if (!wanted.length) return;
    this._placeIconsRunning = true;
    const icons = { ...(this.data.markerIcons || {}) };
    try {
      for (const { key, place } of wanted) {
        try {
          icons[key] = await this.drawDotIcon(categoryMeta(place.category).color, displayEmoji(place), place.visited);
        } catch (err) {
          icons[key] = '';
          console.warn('[index] marker 图标绘制失败，改用系统默认标记', err);
        }
      }
      if (!this._unloaded) {
        this.setData({ markerIcons: icons });
        this.renderMarkers(this.data.filtered);
      }
    } finally { this._placeIconsRunning = false; }
  },

  onMarkerTap(event) {
    const place = this.data.places.find((p) => p.id === event.detail.markerId);
    if (place) this.selectPlace(place);
  },

  openDetail(place) {
    app.globalData.detailPlace = place; // 公共广场无邀请码时，详情页直接用这份只读数据
    wx.navigateTo({ url: `/pages/detail/detail?placeId=${place.id}` });
  },

  onTapPlace(event) {
    const id = event.currentTarget.dataset.id;
    const place = this.data.places.find((p) => p.id === Number(id));
    if (!place) return;
    this.selectPlace(place);
  },

  selectPlace(place) {
    if (!place) return;
    this.setData({ selectedPlace: { ...place, emoji: displayEmoji(place) }, longitude: place.lng, latitude: place.lat });
    this.renderMarkers(this.data.filtered);
    this.mapCtx && this.mapCtx.moveToLocation({ longitude: place.lng, latitude: place.lat });
  },

  closePreview() { this.setData({ selectedPlace: null }); this.renderMarkers(this.data.filtered); },

  openSelectedDetail() {
    if (this.data.selectedPlace) this.openDetail(this.data.selectedPlace);
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
