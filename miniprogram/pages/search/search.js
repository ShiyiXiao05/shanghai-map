const app = getApp();
const { api } = require('../../utils/api.js');
const { CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const storage = require('../../utils/storage.js');
const cache = require('../../utils/cache.js');
const { displayEmoji, validEmoji } = require('../../utils/emoji.js');
const { applyTheme } = require('../../utils/theme.js');

// 地图手动点选的初始中心（上海市中心）：全程不调用地理位置接口，因此不需要任何权限
const SHANGHAI_CENTER = { latitude: 31.2304, longitude: 121.4737 };

// 添加地点：在本页内嵌的地图上手动点选（不调用地理位置接口，无需申请权限）。
// 想要更省事的路径可以用「粘贴高德分享导入」，那条路能一次带出名称/地址/坐标。
Page({
  behaviors: [identityBehavior],

  data: {
    categories: CATEGORIES,
    picked: null, // { name, address, latitude, longitude }
    name: '', // 地点名称：原生选点会回填，地图点选时由用户填写
    mapPick: false, // 地图手动点选模式（不依赖地理位置接口权限）
    pickCenter: SHANGHAI_CENTER,
    pickMarkers: [],
    pickPoint: null,
    category: CATEGORIES[0].id,
    description: '',
    priceHint: '',
    hours: '',
    tags: '',
    nickname: '', // 登录身份展示用；署名由服务端按登录昵称盖章
    saving: false,
    emoji: '',
    // 关键词搜索（服务端代理高德）：结果与地图点选共用 picked
    searchKeyword: '',
    searching: false,
    searchResults: [],
    searchHint: '',
  },

  onShow() {
    applyTheme(this);
    this.setData({ nickname: storage.getNickname() });
  },

  // 打开地图点选（没有"原生选点"这一步，因此不涉及任何权限）
  openMapPick() {
    this.setData({ mapPick: true, pickMarkers: [], pickPoint: null });
  },

  // 地图手动点选：完全不用地理位置接口，只读取用户点击的屏幕坐标
  onMapTap(event) {
    const detail = event.detail || {};
    const latitude = Number(detail.latitude);
    const longitude = Number(detail.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    this.setData({
      pickPoint: { latitude, longitude },
      pickMarkers: [{ id: 1, latitude, longitude, width: 28, height: 28 }],
    });
  },

  confirmMapPick() {
    const point = this.data.pickPoint;
    if (!point) {
      wx.showToast({ title: '先在地图上点一下位置', icon: 'none' });
      return;
    }
    this.setData({
      picked: { name: '', address: '', latitude: point.latitude, longitude: point.longitude },
      mapPick: false,
    });
  },

  cancelMapPick() {
    this.setData({ mapPick: false });
  },

  // 关键词搜索：走服务端 /api/geo/search 代理高德（小程序端不配 key、也不加请求域名）
  onSearchInput(event) {
    this.setData({ searchKeyword: event.detail.value });
  },

  async doSearch() {
    if (this.searching) return; // 防重复提交：连点不会重复请求上游
    const keyword = (this.data.searchKeyword || '').trim();
    if (!keyword) {
      wx.showToast({ title: '请输入地点名称', icon: 'none' });
      return;
    }
    this.searching = true;
    this.setData({ searching: true, searchResults: [], searchHint: '' });
    try {
      const places = await api.searchPlaces(keyword);
      if (!places.length) {
        this.setData({ searchResults: [], searchHint: '没找到，换个关键词或在地图上点选' });
        return;
      }
      this.setData({ searchResults: places, searchHint: '' });
    } catch (err) {
      // 后端不可用（503/502/网络异常）：明确给出兜底路径，绝不把页面留在「搜索中」
      this.setData({
        searchResults: [],
        searchHint: '搜索暂时不可用，可以改用下面的「在地图上点选位置」',
      });
      wx.showToast({ title: (err && err.message) || '搜索失败，可改用地图点选', icon: 'none' });
    } finally {
      // 无论成功失败都复位，按钮不会一直停在「搜索中…」
      this.searching = false;
      this.setData({ searching: false });
    }
  },

  // 选中搜索结果：与地图点选写入同一个 picked 结构，保存逻辑不用改
  pickSearchResult(event) {
    const index = Number(event.currentTarget.dataset.index);
    const place = this.data.searchResults[index];
    if (!place) return;
    const latitude = Number(place.lat);
    const longitude = Number(place.lng);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      wx.showToast({ title: '这条结果没有坐标，请改用地图点选', icon: 'none' });
      return;
    }
    this.setData({
      picked: {
        name: place.name || '',
        address: place.address || '',
        latitude,
        longitude,
      },
      searchResults: [], // 收起结果列表，让上方 picker 卡片就是「已选中」的反馈
      searchHint: '',
    });
    if (wx.pageScrollTo) wx.pageScrollTo({ scrollTop: 0, duration: 200 });
    wx.showToast({ title: '已选择', icon: 'success' });
  },

  onName(event) {
    this.setData({ name: event.detail.value });
  },

  onCategory(event) {
    this.setData({ category: this.data.categories[event.detail.value].id });
  },

  onDescription(event) {
    this.setData({ description: event.detail.value });
  },

  onPriceHint(event) {
    this.setData({ priceHint: event.detail.value });
  },

  onHours(event) {
    this.setData({ hours: event.detail.value });
  },

  onTags(event) {
    this.setData({ tags: event.detail.value });
  },

  onEmojiChange(event) { this.setData({ emoji: event.detail.value }); },

  async save() {
    if (this.submitting) return; // 防重复提交：弱网连点会创建多个地点
    const { picked, category, description, priceHint, hours, tags } = this.data;
    const name = (this.data.name || '').trim() || (picked && picked.name) || '';
    if (!picked) {
      wx.showToast({ title: '先选择一个位置', icon: 'none' });
      return;
    }
    if (!name) {
      wx.showToast({ title: '请填写地点名称', icon: 'none' });
      return;
    }
    this.submitting = true;
    try {
      // 登录守卫：未登录静默登录；昵称未确认时弹层，确认后自动重试保存
      const nickname = await auth.requireIdentity(this, () => this.save());
      if (!nickname) return;
      this.setData({ saving: true });
      await api.createPlace(app.globalData.map.code, {
        name,
        category,
        description: description.trim(),
        price_hint: priceHint.trim(),
        hours: hours.trim(),
        tags: tags.trim(),
        address: picked.address,
        lng: picked.longitude,
        lat: picked.latitude,
        emoji: validEmoji(this.data.emoji) ? this.data.emoji : '',
      });
      wx.showToast({ title: '已添加到地图' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (err) {
      // 保存失败按钮必须回到可点：先复位 saving，再按错误类型给提示
      this.setData({ saving: false });
      if (err && err.code === 'DUPLICATE_PLACE') {
        this.showDuplicateModal(err, name); // 服务端去重拦截：409 + code=DUPLICATE_PLACE
        return;
      }
      wx.showToast({ title: (err && err.message) || '保存失败，请重试', icon: 'none' });
    } finally {
      this.submitting = false;
    }
  },

  // 重复地点（409）：标题固定，内容优先用服务端那句中文 error（api.js 已透传 message）；
  // attemptName 是本次要保存的名称，服务端 duplicate/trashed 拿不到时用它兜底文案与回查
  showDuplicateModal(err, attemptName) {
    const duplicate = (err && err.duplicate) || null;
    const trashed = (err && err.trashed) || null;
    const name = (duplicate && duplicate.name) || (trashed && trashed.name) || attemptName || '';
    let content = (err && err.message) || (name ? `地图里已经有「${name}」了` : '这张地图里已经有同一个地点了');
    if (trashed) content += '\n回收站里也有一个同名的，可以先去回收站恢复';
    wx.showModal({
      title: '已经添加过了',
      content,
      confirmText: '去看看',
      cancelText: '知道了',
      success: (res) => {
        if (!res || !res.confirm) return;
        const id = this.duplicatePlaceId(err, name);
        if (id) wx.navigateTo({ url: `/pages/detail/detail?placeId=${id}` });
        else wx.showToast({ title: '在地图列表里就能看到它', icon: 'none' });
      },
    });
  },

  // 服务端 409 里的 duplicate.id 没有被 api.js 透传（utils/ 不在本次改动范围），
  // 因此先看 err.duplicate，再退回本地地点缓存按名称回查一次（纯本地，不发请求）
  duplicatePlaceId(err, name) {
    const duplicate = err && err.duplicate;
    if (duplicate && duplicate.id !== undefined && duplicate.id !== null) return Number(duplicate.id);
    if (!name) return null;
    try {
      const code = (app.globalData.map && app.globalData.map.code) || '';
      const entry = cache.readPlaces(code);
      // 与服务端同一套判定：忽略大小写与首尾空格
      const target = String(name).trim().toLowerCase();
      const hit = ((entry && entry.places) || []).find(
        (place) => String(place.name == null ? '' : place.name).trim().toLowerCase() === target
      );
      return hit ? Number(hit.id) : null;
    } catch (err2) {
      return null;
    }
  },

  goImport() {
    wx.navigateTo({ url: '/pages/import/import' });
  },
});
