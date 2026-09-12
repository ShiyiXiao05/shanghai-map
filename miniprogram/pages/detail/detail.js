const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta, CATEGORIES } = require('../../utils/config.js');
const storage = require('../../utils/storage.js');

Page({
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
  },

  onLoad(query) {
    this.placeId = Number(query.placeId);
  },

  onShow() {
    this.refresh();
  },

  onShareAppMessage() {
    const p = this.data.place;
    const g = app.globalData;
    return {
      title: `「${p?.name ?? '地点'}」${p?.visited ? '我们去过了' : '一起去吗？'} · ${g.map?.name ?? '魔都Explore'}`,
      path: g.map ? `/pages/index/index?map=${g.map.code}` : '/pages/index/index',
    };
  },

  mapCode() {
    return app.globalData.map?.code ?? '';
  },

  async refresh() {
    if (!this.placeId) return;
    const code = this.mapCode();
    let place = null;
    if (code) {
      try {
        const places = await api.listPlaces(code);
        place = places.find((p) => p.id === this.placeId) ?? null;
      } catch (err) {
        wx.showToast({ title: err.message, icon: 'none' });
        return;
      }
    } else {
      // 公共广场：无邀请码，用列表页传来的公开地点，只读（照片/留言需要邀请码，不加载）
      place = app.globalData.detailPlace?.id === this.placeId ? app.globalData.detailPlace : null;
    }
    if (!place) {
      wx.showToast({ title: '地点不存在', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 800);
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
      isPublicView: app.globalData.isPublicView,
      amapUrl: `https://uri.amap.com/marker?position=${place.lng},${place.lat}&name=${encodeURIComponent(place.name)}&src=moduExplore&coordinate=gaode`,
    });
    wx.setNavigationBarTitle({ title: place.name });
    if (code) {
      this.loadPhotos();
      this.loadComments();
    }
  },

  async loadPhotos() {
    try {
      const photos = await api.listPhotos(this.mapCode(), this.placeId);
      this.setData({
        photos: photos.map((p) => ({ ...p, fullUrl: api.photoUrl(this.mapCode(), p.id) })),
      });
    } catch {
      /* 无照片权限时静默 */
    }
  },

  async loadComments() {
    try {
      const comments = await api.listComments(this.mapCode(), this.placeId);
      this.setData({ comments });
    } catch {
      /* 留言加载失败不阻塞 */
    }
  },

  async toggleVisited() {
    const { place } = this.data;
    try {
      await api.updatePlace(this.mapCode(), place.id, { visited: !place.visited });
      this.refresh();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async toggleWish() {
    let who = storage.getNickname();
    if (!who) {
      const { confirm, value } = await new Promise((resolve) =>
        wx.showModal({
          title: '先留个昵称',
          editable: true,
          placeholderText: '同学怎么称呼你',
          success: (res) => resolve(res),
        })
      );
      if (!confirm || !value.trim()) return;
      who = value.trim();
      storage.setNickname(who);
    }
    try {
      await api.toggleWish(this.mapCode(), this.placeId, who);
      this.refresh();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async togglePublic() {
    const { place } = this.data;
    try {
      await api.togglePublic(this.mapCode(), place.id);
      this.refresh();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  previewPhoto(event) {
    const index = event.currentTarget.dataset.index;
    const urls = this.data.photos.map((p) => p.fullUrl);
    wx.previewImage({ current: urls[index], urls });
  },

  async addPhoto() {
    if (this.data.isPublicView) return;
    const choose = await wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sizeType: ['compressed'],
    });
    const file = choose.tempFiles[0];
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) {
      wx.showToast({ title: '图片太大，请换一张', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '上传中…' });
    try {
      const dataUrl = await this.fileToBase64(file.tempFilePath);
      await api.uploadPhoto(this.mapCode(), this.placeId, {
        full: dataUrl,
        thumb: dataUrl,
        addedBy: storage.getNickname(),
      });
      wx.hideLoading();
      wx.showToast({ title: '照片已添加' });
      this.loadPhotos();
    } catch (err) {
      wx.hideLoading();
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  fileToBase64(filePath) {
    return new Promise((resolve, reject) => {
      const fs = wx.getFileSystemManager();
      fs.readFile({
        filePath,
        encoding: 'base64',
        success: (res) => {
          const ext = filePath.endsWith('.png') ? 'png' : 'jpeg';
          resolve(`data:image/${ext};base64,${res.data}`);
        },
        fail: reject,
      });
    });
  },

  async removePhoto(event) {
    const id = event.currentTarget.dataset.id;
    const { confirm } = await new Promise((resolve) =>
      wx.showModal({ title: '删除这张照片？', success: resolve })
    );
    if (!confirm) return;
    try {
      await api.deletePhoto(this.mapCode(), id);
      this.loadPhotos();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onCommentInput(event) {
    this.setData({ commentText: event.detail.value });
  },

  async sendComment() {
    const body = this.data.commentText.trim();
    if (!body) return;
    let who = storage.getNickname();
    if (!who) {
      const { confirm, value } = await new Promise((resolve) =>
        wx.showModal({
          title: '先留个昵称',
          editable: true,
          placeholderText: '同学怎么称呼你',
          success: resolve,
        })
      );
      if (!confirm || !value.trim()) return;
      who = value.trim();
      storage.setNickname(who);
    }
    try {
      await api.createComment(this.mapCode(), this.placeId, { body, author: who });
      this.setData({ commentText: '' });
      this.loadComments();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async removeComment(event) {
    const id = event.currentTarget.dataset.id;
    const { confirm } = await new Promise((resolve) =>
      wx.showModal({ title: '删除这条留言？', success: resolve })
    );
    if (!confirm) return;
    try {
      await api.deleteComment(this.mapCode(), id);
      this.loadComments();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  openEdit() {
    const { place } = this.data;
    this.setData({
      editing: true,
      form: {
        name: place.name,
        category: place.category,
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

  cancelEdit() {
    this.setData({ editing: false });
  },

  async saveEdit() {
    const f = this.data.form;
    if (!f.name.trim()) {
      wx.showToast({ title: '名称不能为空', icon: 'none' });
      return;
    }
    try {
      await api.updatePlace(this.mapCode(), this.placeId, {
        name: f.name.trim(),
        category: f.category,
        description: f.description.trim(),
        address: f.address.trim(),
        price_hint: (f.price_hint ?? '').trim(),
        hours: (f.hours ?? '').trim(),
        tags: (f.tags ?? '').trim(),
      });
      this.setData({ editing: false });
      this.refresh();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  async removePlace() {
    const { confirm } = await new Promise((resolve) =>
      wx.showModal({ title: `删除「${this.data.place.name}」？`, content: '照片和留言会一起删除', success: resolve })
    );
    if (!confirm) return;
    try {
      await api.deletePlace(this.mapCode(), this.placeId);
      wx.showToast({ title: '已删除' });
      setTimeout(() => wx.navigateBack(), 600);
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  openAmap() {
    wx.setClipboardData({
      data: this.data.amapUrl,
      success: () =>
        wx.showToast({ title: '高德链接已复制，浏览器打开可导航', icon: 'none' }),
    });
  },
});
