const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta, CATEGORIES } = require('../../utils/config.js');
const auth = require('../../utils/auth.js');
const identityBehavior = require('../../utils/identity-behavior.js');
const { compressToLimit, fileToDataUrl } = require('../../utils/image.js');
const { displayEmoji, validEmoji } = require('../../utils/emoji.js');
const { applyTheme } = require('../../utils/theme.js');

// 照片上传预算：微信云托管 callContainer 请求体上限 100K（官方明确「请求中不建议包含图片」），
// 因此整包按 92K 预留给 base64 字符串；无 CDN 时服务端还要求 thumb ≤ maxThumbBytes
const UPLOAD_TOTAL_BUDGET = 92 * 1024;
const UPLOAD_THUMB_BUDGET = 20 * 1024;
const UPLOAD_OVERHEAD = 2048; // map_code / 字段名 / JSON 结构开销
const DEFAULT_MAX_FULL_BYTES = 1.5 * 1024 * 1024;
const DEFAULT_MAX_THUMB_BYTES = 64 * 1024;

Page({
  behaviors: [identityBehavior],

  data: {
    place: null,
    meta: {},
    badges: [],
    categories: CATEGORIES,
    photos: [],
    comments: [],
    commentText: '',
    editing: false,
    form: {},
    isPublicView: false,
    amapUrl: '',
    loading: true,
    loadError: '', // 加载失败时展示错误态 + 重试，而不是整页空白
  },

  onLoad(query) {
    applyTheme(this);
    this.placeId = Number(query.placeId);
    // 只读标记：进页面先按全局会话判定，refresh() 拿到接口结果后再以 found.publicOnly 为准
    this.publicOnly = Boolean(app.globalData && app.globalData.isPublicView);
    if (!this.placeId) this.setData({ loading: false, loadError: '缺少地点参数，请从列表重新进入' });
  },

  onShow() {
    applyTheme(this);
    this.refresh();
  },

  onShareAppMessage() {
    const p = this.data.place;
    const g = app.globalData;
    const code = this.mapCode();
    return {
      title: `「${p?.name ?? '地点'}」${p?.visited ? '我们去过了' : '一起去吗？'} · ${g.map?.name ?? '魔都Explore'}`,
      // 带邀请码：收件人加入地图后直达该地点；公共广场：只带地点 id，详情页走公开接口
      path: code
        ? `/pages/index/index?map=${code}&place=${this.placeId}`
        : `/pages/index/index?place=${this.placeId}`,
    };
  },

  onShareTimeline() {
    const p = this.data.place;
    const code = this.mapCode();
    return {
      title: `「${p?.name ?? '地点'}」${p?.visited ? '我们去过了' : '一起去吗？'} · 魔都Explore`,
      query: code ? `map=${code}&place=${this.placeId}` : `place=${this.placeId}`,
    };
  },

  mapCode() {
    // 公开广场的只读详情：即便本地已加入某张私人地图，也绝不能把它的邀请码带进分享/举报
    if (this.publicOnly) return '';
    return app.globalData.map?.code ?? '';
  },

  // 内容举报：原因用原生 ActionSheet，无需新增页面；公共广场语境下不带邀请码
  report() {
    const reasons = ['不实信息', '广告营销', '侵权/抄袭', '违法违规', '其他'];
    wx.showActionSheet({
      itemList: reasons,
      success: async (res) => {
        const reason = reasons[res.tapIndex] || '其他';
        try {
          const code = this.mapCode();
          await api.report({
            target_type: 'place',
            target_id: this.placeId,
            reason,
            ...(code ? { map_code: code } : {}),
          });
          wx.showToast({ title: '已收到举报，感谢反馈', icon: 'none' });
        } catch (err) {
          wx.showToast({ title: err?.message || '举报失败，请稍后再试', icon: 'none' });
        }
      },
    });
  },

  // 写操作防连点：同一 key 处理期间忽略重复触发（避免重复提交）
  async runOnce(key, task) {
    if (!this._busy) this._busy = {};
    if (this._busy[key]) return;
    this._busy[key] = true;
    try {
      await task();
    } finally {
      this._busy[key] = false;
    }
  },

  // 取当前应展示的地点：私有地图走列表接口；公共广场走只读接口
  async fetchPlace() {
    const code = this.mapCode();
    if (code) {
      const places = await api.listPlaces(code);
      const found = places.find((p) => p.id === this.placeId);
      if (found) return { place: found, publicOnly: false };
    } else {
      // 快速路径：列表页已传入的公开地点数据，避免多一次网络往返
      const cached = app.globalData.detailPlace;
      if (cached && Number(cached.id) === this.placeId) return { place: cached, publicOnly: true };
    }
    // 分享链接冷启动直达 / 地点不在当前地图：回落到公共广场只读接口（404 表示不存在或未公开）
    const place = await api.publicPlace(this.placeId);
    return { place: place ?? null, publicOnly: true };
  },

  async refresh() {
    if (!this.placeId) return;
    if (this.data.place) this.setData({ loadError: '' });
    else this.setData({ loading: true, loadError: '' });
    const code = this.mapCode();
    let found;
    try {
      found = await this.fetchPlace();
    } catch (err) {
      const message = (err && err.message) || '加载失败，请重试';
      if (this.data.place) wx.showToast({ title: message, icon: 'none' }); // 已有内容时只提示，不清空
      else this.setData({ loading: false, loadError: message });
      return;
    }
    const place = found.place;
    // 同步只读标记：公开回落的详情页据此不带邀请码分享/举报（isPublicView 仍照旧只用于 UI）
    this.publicOnly = Boolean(found.publicOnly);
    if (!place) {
      this.setData({ loading: false, loadError: '地点不存在或已下架' });
      return;
    }
    const meta = categoryMeta(place.category);
    const badges = [];
    if (place.price_hint) badges.push(`💰 ${place.price_hint}`);
    if (place.hours) badges.push(`🕐 ${place.hours}`);
    for (const tag of String(place.tags ?? '')
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)) {
      badges.push(`🏷️ ${tag}`);
    }
    this.setData({
      place,
      meta,
      badges,
      isPublicView: app.globalData.isPublicView || found.publicOnly,
      amapUrl: `https://uri.amap.com/marker?position=${place.lng},${place.lat}&name=${encodeURIComponent(place.name)}&src=moduExplore&coordinate=gaode`,
      loading: false,
      loadError: '',
    });
    wx.setNavigationBarTitle({ title: place.name });
    if (code && !found.publicOnly) {
      this.loadPhotos(false);
      this.loadComments(false);
    } else {
      // 公开只读：照片/留言需要邀请码，不加载
      this.setData({ photos: [], comments: [] });
    }
  },

  retryLoad() {
    this.refresh();
  },

  goBack() {
    wx.navigateBack();
  },

  async loadPhotos(force = false) {
    try {
      const photos = await api.listPhotos(this.mapCode(), this.placeId, { force });
      this.setData({
        photos: photos.map((p) => ({
          ...p,
          // CDN 原图直链优先（预览不经过后端域名）；存量 DB 照片回落后端 302 端点
          fullUrl: p.full || api.photoUrl(this.mapCode(), p.id),
        })),
      });
    } catch {
      /* 无照片权限时静默 */
    }
  },

  async loadComments(force = false) {
    try {
      const comments = await api.listComments(this.mapCode(), this.placeId, { force });
      this.setData({ comments });
    } catch {
      /* 留言加载失败不阻塞 */
    }
  },

  toggleVisited() {
    return this.runOnce('visited', async () => {
      const { place } = this.data;
      if (!place) return;
      try {
        await api.updatePlace(this.mapCode(), place.id, { visited: !place.visited });
        await this.refresh();
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  toggleWish() {
    return this.runOnce('wish', async () => {
      // 登录守卫：署名（who）由服务端按登录昵称盖章
      const nickname = await auth.requireIdentity(this, () => this.toggleWish());
      if (!nickname) return;
      try {
        await api.toggleWish(this.mapCode(), this.placeId);
        await this.refresh();
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  togglePublic() {
    return this.runOnce('public', async () => {
      const { place } = this.data;
      if (!place) return;
      try {
        await api.togglePublic(this.mapCode(), place.id);
        await this.refresh();
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  previewPhoto(event) {
    const index = event.currentTarget.dataset.index;
    const urls = this.data.photos.map((p) => p.fullUrl);
    wx.previewImage({ current: urls[index], urls });
  },

  addPhoto() {
    if (this.data.isPublicView) return Promise.resolve();
    return this.runOnce('photo-upload', async () => {
      const nickname = await auth.requireIdentity(this, () => this.addPhoto());
      if (!nickname) return;
      let choose;
      try {
        choose = await wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sizeType: ['compressed'],
        });
      } catch (err) {
        const message = err?.errMsg || err?.message || '选择照片失败，请重试';
        if (!/cancel/i.test(message)) wx.showToast({ title: message, icon: 'none' });
        return;
      }
      const file = choose.tempFiles && choose.tempFiles[0];
      if (!file) return;

      // 上传配置（失败按有 CDN 处理：只传 full，由服务端派生缩略图）
      const cfg = await api.uploadConfig().catch(() => ({
        cdn: true,
        maxFullBytes: DEFAULT_MAX_FULL_BYTES,
        maxThumbBytes: DEFAULT_MAX_THUMB_BYTES,
      }));
      const needThumb = !cfg.cdn;
      const maxFullBytes =
        Number(cfg.maxFullBytes) > 0 ? Number(cfg.maxFullBytes) : DEFAULT_MAX_FULL_BYTES;
      const maxThumbBytes =
        Number(cfg.maxThumbBytes) > 0 ? Number(cfg.maxThumbBytes) : DEFAULT_MAX_THUMB_BYTES;
      const thumbBudget = needThumb ? Math.min(UPLOAD_THUMB_BUDGET, maxThumbBytes) : 0;
      // 预算按 base64 字符串长度算（100K 卡的是请求体）；换算成文件体积要 ×3/4
      const fullB64Budget = UPLOAD_TOTAL_BUDGET - thumbBudget - UPLOAD_OVERHEAD;
      const fullRawBudget = Math.min(Math.floor((fullB64Budget * 3) / 4), maxFullBytes);
      // 服务端 full 上限换算成 base64 长度，两个上限取更严的做客户端自检
      const fullB64Cap = Math.min(fullB64Budget, Math.floor((maxFullBytes * 4) / 3));

      wx.showLoading({ title: '压缩上传中…' });
      const abort = (title) => {
        wx.hideLoading();
        wx.showToast({ title, icon: 'none' });
      };
      try {
        const fullFile = await compressToLimit(file.tempFilePath, { maxBytes: fullRawBudget });
        const full = await fileToDataUrl(fullFile.path);
        if (full.length > fullB64Cap) {
          abort('图片过大，已自动压缩后重试');
          return;
        }
        let thumb = '';
        if (needThumb) {
          thumb = await this.buildThumb(file.tempFilePath, thumbBudget);
          if (!thumb) {
            abort('图片过大，已自动压缩后重试');
            return;
          }
        }
        await api.uploadPhoto(this.mapCode(), this.placeId, needThumb ? { full, thumb } : { full });
        wx.hideLoading();
        wx.showToast({ title: '照片已添加' });
        this.loadPhotos(true);
      } catch (err) {
        abort(this.photoErrorMessage(err));
      }
    });
  },

  // 无 CDN 时服务端要求自带缩略图：240px/quality50 起，超标依次降级到 35/200
  async buildThumb(src, budget) {
    if (typeof wx.compressImage !== 'function') {
      throw new Error('当前微信版本不支持图片压缩，请升级微信后重试');
    }
    const attempts = [
      { quality: 50, compressedWidth: 240 },
      { quality: 35, compressedWidth: 240 },
      { quality: 35, compressedWidth: 200 },
    ];
    for (const attempt of attempts) {
      const path = await new Promise((resolve) => {
        wx.compressImage({
          src,
          quality: attempt.quality,
          compressedWidth: attempt.compressedWidth,
          success: (res) => resolve((res && res.tempFilePath) || ''),
          fail: (err) => {
            console.warn('[detail] 缩略图压缩失败', attempt, err);
            resolve('');
          },
        });
      });
      if (!path) continue;
      const dataUrl = await fileToDataUrl(path).catch(() => '');
      if (dataUrl && dataUrl.length <= budget) return dataUrl;
    }
    return '';
  },

  // 上传失败提示：给用户可操作的说法，不把「网络异常」直接抛出去
  photoErrorMessage(err) {
    const status = err && err.status;
    if (status === 413) return '照片太大，已自动压缩仍超出上限，请换一张';
    if (status === 429) return '上传太频繁，请稍后再试';
    if (status === 404) return '地点不存在或邀请码已失效';
    if (status === 401 || status === 403) return '登录已过期，请退出重进后再试';
    if (status && err.message) return err.message; // 服务端返回的中文原因可直接展示
    const message = (err && err.message) || '';
    // 本地压缩/读取失败的提示本身就可操作，只有 api.js 的「网络异常」需要换成用户能懂的说法
    if (message && !message.startsWith('网络异常')) return message;
    return '上传失败：网络不稳定，请稍后重试';
  },

  removePhoto(event) {
    const id = event.currentTarget.dataset.id;
    return this.runOnce(`photo-del-${id}`, async () => {
      const { confirm } = await new Promise((resolve) =>
        wx.showModal({ title: '删除这张照片？', success: resolve })
      );
      if (!confirm) return;
      try {
        await api.deletePhoto(this.mapCode(), id);
        await this.loadPhotos(true);
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  onCommentInput(event) {
    this.setData({ commentText: event.detail.value });
  },

  sendComment() {
    return this.runOnce('comment', async () => {
      const body = this.data.commentText.trim();
      if (!body) return;
      // 登录守卫：署名（author）由服务端按登录昵称盖章
      const nickname = await auth.requireIdentity(this, () => this.sendComment());
      if (!nickname) return;
      try {
        await api.createComment(this.mapCode(), this.placeId, body);
        this.setData({ commentText: '' });
        await this.loadComments(true);
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  removeComment(event) {
    const id = event.currentTarget.dataset.id;
    return this.runOnce(`comment-del-${id}`, async () => {
      const { confirm } = await new Promise((resolve) =>
        wx.showModal({ title: '删除这条留言？', success: resolve })
      );
      if (!confirm) return;
      try {
        await api.deleteComment(this.mapCode(), id);
        await this.loadComments(true);
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  openEdit() {
    const { place } = this.data;
    if (!place) return;
    this.setData({
      editing: true,
      form: {
        name: place.name,
        category: place.category,
        emoji: place.emoji ?? '',
        description: place.description ?? '',
        address: place.address ?? '',
        price_hint: place.price_hint ?? '',
        hours: place.hours ?? '',
          tags: place.tags ?? '',
      },
    });
  },

  onFormInput(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({ [`form.${key}`]: event.detail.value });
  },

  onFormCategory(event) {
    this.setData({ 'form.category': this.data.categories[event.detail.value].id });
  },

  onFormEmoji(event) { this.setData({ 'form.emoji': event.detail.value }); },

  cancelEdit() {
    this.setData({ editing: false });
  },

  saveEdit() {
    return this.runOnce('saveEdit', async () => {
      const f = this.data.form;
      if (!f.name.trim()) {
        wx.showToast({ title: '名称不能为空', icon: 'none' });
        return;
      }
      try {
        const updated = await api.updatePlace(this.mapCode(), this.placeId, {
          name: f.name.trim(),
          category: f.category,
          description: f.description.trim(),
          address: f.address.trim(),
          price_hint: (f.price_hint ?? '').trim(),
          hours: (f.hours ?? '').trim(),
          tags: (f.tags ?? '').trim(),
          emoji: validEmoji(f.emoji ?? '') ? f.emoji.trim() : '',
        });
        this.setData({ editing: false, place: updated || { ...this.data.place, ...f, emoji: f.emoji || '' } });
        await this.refresh();
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  removePlace() {
    return this.runOnce('removePlace', async () => {
      const { place } = this.data;
      if (!place) return;
      const { confirm } = await new Promise((resolve) =>
        wx.showModal({
          title: `删除「${place.name}」？`,
          content: '照片和留言会一起删除',
          success: resolve,
        })
      );
      if (!confirm) return;
      try {
        await api.deletePlace(this.mapCode(), this.placeId);
        wx.showToast({ title: '已移入回收站（30 天内可在「切换 → 回收站」恢复）', icon: 'none' });
        setTimeout(() => wx.navigateBack(), 600);
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
      }
    });
  },

  openAmap() {
    wx.setClipboardData({
      data: this.data.amapUrl,
      success: () =>
        wx.showToast({ title: '高德链接已复制，浏览器打开可导航', icon: 'none' }),
    });
  },
});
