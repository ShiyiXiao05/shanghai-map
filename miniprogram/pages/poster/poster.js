const app = getApp();
const { api } = require('../../utils/api.js');
const { applyTheme } = require('../../utils/theme.js');

// 权限类失败（相册写入被拒、隐私授权未声明等）统一引导去设置页
const AUTH_PATTERN = /auth|deny|privacy|scope/i;

// 海报：canvas 2d 绘制 1080×1440（霓虹夜行风格简化版），保存到相册
Page({
  data: {
    canvasId: 'poster-canvas',
    stats: null,
    ready: false,
    saving: false,
    loadError: '', // 非空即错误态：页面展示「点击重试」，不生成海报
    noMap: false, // 未加入地图：展示返回 / 去加入地图入口
  },

  onShow() {
    applyTheme(this);
    const g = app.globalData;
    if (!g.map) {
      // 没有地图就不该画海报：给出返回/去加入的入口，而不是停在空白页
      this.setData({ noMap: true, loadError: '', ready: false, stats: null });
      this.canvasNode = null;
      return;
    }
    wx.setNavigationBarTitle({ title: `海报 · ${g.map.name}` });
    this.setData({ noMap: false });
    this.generate();
  },

  async generate() {
    const g = app.globalData;
    if (!g.map) {
      this.setData({ noMap: true, loadError: '', ready: false });
      return;
    }
    this.canvasNode = null;
    this.setData({ loadError: '', ready: false });
    let places;
    try {
      places = await api.listPlaces(g.map.code);
    } catch (err) {
      // 加载失败不生成海报，否则会产出一张「0 个地点」的错误海报被分享出去
      this.setData({ loadError: '加载失败，点击重试', stats: null, ready: false });
      return;
    }
    const list = Array.isArray(places) ? places : [];
    const visited = list.filter((p) => p.visited).length;
    const wishes = list.reduce((sum, p) => sum + (p.wishes?.length ?? 0), 0);
    const stats = {
      total: list.length,
      visited,
      wishes,
    };
    this.setData({ stats });
    const drawn = await this.draw(stats, g.map);
    if (!drawn) {
      this.setData({ loadError: '海报生成失败，点击重试', ready: false });
      return;
    }
    this.setData({ ready: true });
  },

  retryLoad() {
    this.generate();
  },

  backHome() {
    // 页面栈可能只有一页，navigateBack 失败时回首页兜底
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: '/pages/index/index' }),
    });
  },

  goJoin() {
    wx.reLaunch({ url: '/pages/index/index' });
  },

  draw(stats, map) {
    return new Promise((resolve) => {
      const query = this.createSelectorQuery();
      query
        .select('#poster-canvas')
        .fields({ node: true, size: true })
        .exec((res) => {
          const canvas = res?.[0]?.node;
          if (!canvas) {
            // canvas 节点没取到：返回失败交给 generate 提示，不抛异常
            resolve(false);
            return;
          }
          canvas.width = 1080;
          canvas.height = 1440;
          const ctx = canvas.getContext('2d');
          ctx.scale(1, 1);

          // 深夜底
          ctx.fillStyle = '#0a0f1e';
          ctx.fillRect(0, 0, 1080, 1440);
          // 城市网格
          ctx.strokeStyle = 'rgba(34,211,238,0.08)';
          ctx.lineWidth = 2;
          for (let x = 0; x <= 1080; x += 90) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, 1440);
            ctx.stroke();
          }
          for (let y = 0; y <= 1440; y += 90) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(1080, y);
            ctx.stroke();
          }
          // 双色光晕
          const glowA = ctx.createRadialGradient(200, 260, 40, 200, 260, 500);
          glowA.addColorStop(0, 'rgba(255,61,129,0.30)');
          glowA.addColorStop(1, 'rgba(255,61,129,0)');
          ctx.fillStyle = glowA;
          ctx.fillRect(0, 0, 1080, 1440);
          const glowB = ctx.createRadialGradient(900, 1150, 40, 900, 1150, 520);
          glowB.addColorStop(0, 'rgba(34,211,238,0.28)');
          glowB.addColorStop(1, 'rgba(34,211,238,0)');
          ctx.fillStyle = glowB;
          ctx.fillRect(0, 0, 1080, 1440);

          // 徽章
          const grad = ctx.createLinearGradient(90, 150, 330, 390);
          grad.addColorStop(0, '#ff3d81');
          grad.addColorStop(1, '#22d3ee');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(180, 240, 78, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = '#070B16';
          ctx.font = 'bold 62px sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('魔', 180, 244);

          // 标题
          ctx.textAlign = 'left';
          ctx.fillStyle = '#e8ecf8';
          ctx.font = 'bold 74px sans-serif';
          ctx.fillText('魔都·Explore', 300, 210);
          ctx.fillStyle = '#9aa7c7';
          ctx.font = '30px sans-serif';
          ctx.fillText('我们的上海收藏地图', 302, 275);

          // 地图名
          ctx.fillStyle = 'rgba(34,211,238,0.15)';
          this.roundRect(ctx, 300, 320, 560, 62, 31);
          ctx.fill();
          ctx.fillStyle = '#22d3ee';
          ctx.font = '28px sans-serif';
          ctx.fillText(`🗂 ${map.name}`, 322, 352);

          // 统计三宫格
          const cells = [
            [`${stats.total}`, '个地点'],
            [`${stats.visited}`, '已去过'],
            [`${stats.wishes}`, '个想去'],
          ];
          cells.forEach((cell, i) => {
            const x = 90 + i * 310;
            ctx.fillStyle = 'rgba(232,236,248,0.06)';
            this.roundRect(ctx, x, 470, 280, 210, 26);
            ctx.fill();
            ctx.textAlign = 'center';
            const numGrad = i === 1 ? '#ff5d7a' : '#22d3ee';
            ctx.fillStyle = numGrad;
            ctx.font = 'bold 86px sans-serif';
            ctx.fillText(cell[0], x + 140, 555);
            ctx.fillStyle = '#9aa7c7';
            ctx.font = '28px sans-serif';
            ctx.fillText(cell[1], x + 140, 630);
          });

          // 邀请码
          ctx.textAlign = 'center';
          ctx.fillStyle = '#9aa7c7';
          ctx.font = '28px sans-serif';
          ctx.fillText('邀请码 · 发给同学一起标记', 540, 810);
          ctx.fillStyle = 'rgba(255,61,129,0.10)';
          this.roundRect(ctx, 140, 850, 800, 190, 30);
          ctx.fill();
          ctx.fillStyle = '#ff5d7a';
          ctx.font = 'bold 108px sans-serif';
          ctx.fillText(map.code, 540, 960);

          ctx.fillStyle = '#5f6c8f';
          ctx.font = '26px sans-serif';
          ctx.fillText('微信小程序搜「魔都Explore」· 输入邀请码加入', 540, 1130);
          ctx.fillText('魔都·Explore · 与同学共享的上海足迹', 540, 1360);

          this.canvasNode = canvas;
          resolve(true);
        });
    });
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  },

  async saveToAlbum() {
    if (this.data.saving) return; // 保存中，忽略重复点击
    if (!this.canvasNode) {
      // 节点为空时不再静默无反应：提示用户先重试生成
      wx.showToast({ title: '海报还没生成好，请点重试', icon: 'none' });
      return;
    }
    this.setData({ saving: true });
    try {
      const out = await new Promise((resolve, reject) =>
        wx.canvasToTempFilePath({
          canvas: this.canvasNode,
          width: 1080,
          height: 1440,
          destWidth: 1080,
          destHeight: 1440,
          success: resolve,
          fail: reject,
        })
      );
      await new Promise((resolve, reject) =>
        wx.saveImageToPhotosAlbum({ filePath: out.tempFilePath, success: resolve, fail: reject })
      );
      wx.showToast({ title: '已存相册，去发同学吧' });
    } catch (err) {
      const errMsg = err?.errMsg || '';
      if (AUTH_PATTERN.test(errMsg)) {
        wx.showModal({
          title: '需要相册权限',
          content: '请在设置中允许保存到相册后重试',
          confirmText: '去设置',
          success: (r) => r.confirm && wx.openSetting({}),
        });
      } else {
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    }
    this.setData({ saving: false });
  },
});
