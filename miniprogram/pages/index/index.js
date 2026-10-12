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

// 随机抽取的分类范围：跨地图记住，空数组 = 全部地点（与 storage.js 的既有键风格一致）
const RANDOM_CATS_KEY = 'wish-random-cats';

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
    searchKeyword: '', // 列表关键词：纯本地过滤，输入时不发请求
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
    nearbyScope: '按当前位置的直线距离排序', // 附近面板副标题（区分当前位置与地图中心）
    nearbyPlaces: [],
    randomOpen: false,
    randomDrawing: false,
    randomPlace: null,
    randomCats: [], // 随机抽取的分类范围（空 = 全部地点）
    randomScope: '从全部地点中随机选择', // 随机面板副标题，随选择变化
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
    this.restoreRandomCats();
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
        if (point) {
          this.showNearby(point, 'device');
          return;
        }
        this.promptLocation();
      })
      .catch((err) => {
        // 兜底：定位流程里任何意外异常都必须给用户一个出口，
        // 否则会出现"转圈后什么都没有"的静默失败（正式版曾出现）
        console.warn('[index] 定位流程异常：', err);
        this.promptLocation();
      })
      .finally(() => {
        if (typeof wx.hideLoading === 'function') wx.hideLoading();
      });
  },

  // 定位不可用时的出口（两个都要给，避免走进死路）：
  //  · 去设置：用户拒绝过授权时，只有设置页能改
  //  · 用地图中心：把地图拖到你所在位置，点这个也能得到"附近"（不依赖任何权限）
  promptLocation() {
    const useMapCenter = () => {
      const point = { latitude: this.data.latitude, longitude: this.data.longitude };
      this.showNearby(point, 'mapCenter');
    };
    if (typeof wx.showModal !== 'function') {
      useMapCenter();
      return;
    }
    wx.showModal({
      title: '没有获取到位置',
      content: this.lastLocationDenied
        ? '位置权限被拒绝了。可以点「去设置」重新允许，或把地图拖到你所在的位置后用地图中心排序。'
        : '可以点「去设置」检查微信的位置权限，或把地图拖到你所在的位置后用地图中心排序。',
      confirmText: '去设置',
      cancelText: '用地图中心',
      success: (res) => {
        if (res.confirm) {
          if (typeof wx.openSetting === 'function') wx.openSetting({});
          return;
        }
        useMapCenter();
      },
      fail: useMapCenter,
    });
  },

  // 自动定位：地图组件自带定位（show-location + moveToLocation），
  // 不属于需要后台申请开通的地理位置接口，只需用户同意位置授权。
  //
  // 注意：不要用 wx.authorize({scope:'scope.userLocation'}) —— 微信要求位置授权由
  // 地理位置能力本身触发；该调用失败会被误判成"用户拒绝"，直接把用户送进设置页死路。
  // 这里改为：打开地图定位点（由地图组件触发授权弹窗）→ 轮询授权结果 → 再读坐标。
  async tryAutoLocate() {
    const state = await this.ensureLocationAuthorized();
    if (state !== 'granted') {
      this.lastLocationDenied = state === 'denied';
      return null;
    }
    return this.readCurrentCenter();
  },

  // 已授权 → granted；明确拒绝 → denied；未决定 → 打开地图定位点触发微信授权弹窗并等待
  async ensureLocationAuthorized({ timeoutMs = 8000 } = {}) {
    const first = await this.readLocationAuth();
    if (first === 'granted' || first === 'denied') return first;
    // 未决定：打开定位点（地图组件会请求位置授权），同时尝试移动一次，双保险触发弹窗
    await new Promise((resolve) => this.setData({ showMyDot: true }, resolve));
    this.safeMoveToCurrent();
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const state = await this.readLocationAuth();
      if (state === 'granted' || state === 'denied') return state;
    }
    return 'unknown';
  },

  readLocationAuth() {
    return new Promise((resolve) => {
      if (typeof wx.getSetting !== 'function') return resolve('granted');
      wx.getSetting({
        success: (res) => {
          const state = res.authSetting ? res.authSetting['scope.userLocation'] : undefined;
          if (state === true) return resolve('granted');
          if (state === false) return resolve('denied');
          resolve('unknown');
        },
        fail: () => resolve('unknown'),
      });
    });
  },

  safeMoveToCurrent() {
    try {
      const ctx = this.mapCtx || (this.mapCtx = wx.createMapContext('mainMap', this));
      if (ctx && typeof ctx.moveToLocation === 'function') ctx.moveToLocation({});
    } catch (err) {
      // 忽略：下面读中心点时还会再判断
    }
  },

  // 移动到当前位置后读地图中心点。已确认授权，因此不再用"是否移动过"来判定成败
  // （用户本来就站在地图中心附近时，那种判定会误报失败）。
  async readCurrentCenter() {
    await new Promise((resolve) => this.setData({ showMyDot: true }, resolve));
    if (typeof wx.createMapContext !== 'function') return null;
    let ctx;
    try {
      ctx = this.mapCtx || (this.mapCtx = wx.createMapContext('mainMap', this));
    } catch (err) {
      return null;
    }
    if (!ctx || typeof ctx.getCenterLocation !== 'function') return null;
    this.safeMoveToCurrent();
    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          ctx.getCenterLocation({
            success: (center) => {
              const latitude = Number(center.latitude);
              const longitude = Number(center.longitude);
              resolve(
                Number.isFinite(latitude) && Number.isFinite(longitude) ? { latitude, longitude } : null
              );
            },
            fail: () => resolve(null),
          });
        } catch (err) {
          resolve(null);
        }
      }, 1200);
    });
  },

  // 按当前位置算最近 5 个地点
  showNearby(location, source) {
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
      nearbyScope:
        source === 'mapCenter' ? '未获取到定位，按地图中心排序' : '按当前位置的直线距离排序',
    });
    wx.showToast({
      title: source === 'mapCenter' ? '按地图中心排序' : '已按当前位置排序',
      icon: 'none',
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

  // 从本地存储恢复抽取范围（脏数据 —— 非数组 / 已下线的分类 —— 一律当成「全部」）
  restoreRandomCats() {
    const raw = wx.getStorageSync(RANDOM_CATS_KEY);
    const ids = CATEGORIES.map((c) => c.id);
    const cats = Array.isArray(raw) ? ids.filter((id) => raw.indexOf(id) !== -1) : [];
    this.setData({ randomCats: cats, randomScope: this.randomScopeText(cats) });
  },

  // 面板副标题：让用户一眼看到这次的抽取范围
  randomScopeText(cats) {
    return cats && cats.length ? `从 ${cats.join(' · ')} 中随机选择` : '从全部地点中随机选择';
  },

  // 抽取候选 = 选中分类 ∩ 当前地图地点；没选分类（全部）时就是全部地点
  randomCandidates() {
    const places = this.data.places || [];
    const cats = this.data.randomCats || [];
    return cats.length ? places.filter((p) => cats.indexOf(p.category) !== -1) : places;
  },

  // 「全部」= 清空选择（data-id="全部"）；具体分类支持多选，再点一次取消
  toggleRandomCat(event) {
    const id = event.currentTarget.dataset.id;
    if (id === '全部') {
      this.applyRandomCats([]);
      return;
    }
    const current = this.data.randomCats || [];
    const next = current.indexOf(id) !== -1 ? current.filter((c) => c !== id) : [...current, id];
    this.applyRandomCats(next);
  },

  // 归一化：只留合法分类、顺序与 chips 一致，然后写本地存储（不改 storage.js，沿用首页既有写法）
  applyRandomCats(cats) {
    const valid = CATEGORIES.map((c) => c.id).filter((id) => cats.indexOf(id) !== -1);
    wx.setStorageSync(RANDOM_CATS_KEY, valid);
    this.setData({ randomCats: valid, randomScope: this.randomScopeText(valid) });
  },

  drawRandom() {
    const cats = this.data.randomCats || [];
    const places = this.randomCandidates();
    if (places.length === 0) {
      if (cats.length === 0) {
        wx.showToast({ title: '当前地图还没有地点', icon: 'none' });
        return;
      }
      // 选中分类里没有地点：只提示、不开抽奖动画；同时把面板打开，用户能直接改分类而不是走进死路
      this.setData({ randomOpen: true, randomScope: this.randomScopeText(cats) });
      wx.showToast({ title: '这个分类下还没有地点', icon: 'none' });
      return;
    }
    clearInterval(this.randomTimer);
    this.setData({
      randomOpen: true,
      randomDrawing: true,
      randomPlace: null,
      randomScope: this.randomScopeText(cats),
    });
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
    // 切换地图或下拉刷新后清空关键词：否则列表还是被上一次的搜索词过滤着，用户会以为地点丢了
    if (force || this._loadedMapCode !== code) {
      this._loadedMapCode = code;
      if (this.data.searchKeyword) this.setData({ searchKeyword: '' });
    }
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

  // 关键词匹配：name / address / tags / category，trim 后不区分大小写（中文直接 includes）。
  // 纯本地过滤，输入时不发任何请求。
  matchKeyword(place, keyword) {
    const needle = String(keyword == null ? '' : keyword).trim().toLowerCase();
    if (!needle) return true;
    const p = place || {};
    const tags = Array.isArray(p.tags) ? p.tags.join(' ') : p.tags;
    return [p.name, p.address, p.category, tags].some(
      (value) => String(value == null ? '' : value).toLowerCase().indexOf(needle) !== -1
    );
  },

  onSearchInput(event) {
    const value = (event && event.detail && event.detail.value) || '';
    this.setData({ searchKeyword: value });
    this.applyFilters(); // 输入即过滤，不需要「搜索」按钮
  },

  // 键盘「搜索」：输入时已经过滤过，这里只是确认时再跑一次兜底
  onSearchConfirm() {
    this.applyFilters();
  },

  clearSearch() {
    if (!this.data.searchKeyword) return;
    this.setData({ searchKeyword: '' });
    this.applyFilters();
  },

  applyFilters() {
    const { places, activeCategories, hideVisitedOnly, sort, searchKeyword } = this.data;
    let filtered = places.filter(
      (p) =>
        activeCategories.indexOf(p.category) !== -1 &&
        !(hideVisitedOnly && p.visited) &&
        this.matchKeyword(p, searchKeyword)
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

  // 计算 emoji 的绘制参数。
  // 背景：canvas 的 textAlign='center' 是按"排版宽度(advance)"居中的。真机实测 🏞️(U+1F3DE+FE0F)
  // 的排版宽度被异常放大，居中后 emoji 被推到圆圈左边外面；而 🍜/🏛️/🛍️/🎡 都正常。
  // 策略：① 若宽度异常且去掉变体选择符(U+FE0F)后变窄 → 用去掉后的串（同一图案）；
  //       ② 仍然异常 → 放弃按 advance 居中，改成"以名义 em 方框的左边对齐"，与 advance 无关。
  pickEmojiLayout(measure, glyph, fontPx) {
    let text = String(glyph == null ? '' : glyph);
    let advance = Number(measure(text));
    if (!Number.isFinite(advance) || advance <= 0) advance = fontPx;
    if (advance > fontPx * 1.35 && text.indexOf('\uFE0F') >= 0) {
      const stripped = text.split('\uFE0F').join('');
      const strippedAdvance = Number(measure(stripped));
      if (Number.isFinite(strippedAdvance) && strippedAdvance > 0 && strippedAdvance < advance) {
        text = stripped;
        advance = strippedAdvance;
      }
    }
    if (advance > fontPx * 1.35) {
      return { text: text, align: 'left', x: 22 - fontPx / 2, suspicious: true };
    }
    return { text: text, align: 'center', x: 22, suspicious: false };
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
                // 居中交给 canvas；仅当排版宽度异常（见 pickEmojiLayout）才改用左对齐锚点。
                // 不做像素测量/缩放变换：getImageData 在真机上返回整块不透明数据，会把 emoji 画没。
                ctx.font = `${EMOJI_FONT_PX}px sans-serif`;
                const measure = (text) => {
                  ctx.font = `${EMOJI_FONT_PX}px sans-serif`;
                  return ctx.measureText(text).width;
                };
                const layout = this.pickEmojiLayout(measure, emoji, EMOJI_FONT_PX);
                if (layout.suspicious) {
                  console.warn('[index] emoji 排版宽度异常，改用左对齐锚点：', emoji);
                }
                ctx.textAlign = layout.align;
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffffff';
                ctx.fillText(layout.text, layout.x + EMOJI_NUDGE_X, 22 + EMOJI_NUDGE_Y);
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
