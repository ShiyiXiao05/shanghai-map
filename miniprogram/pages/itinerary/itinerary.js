const app = getApp();
const { api } = require('../../utils/api.js');
const { categoryMeta } = require('../../utils/config.js');

const WALK_KMH = 4.5; // 步行速度，估算站间耗时

function haversineKm(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(s));
}

function fmtKm(km) {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`;
}

function fmtWalk(km) {
  const minutes = Math.max(1, Math.round((km / WALK_KMH) * 60));
  return minutes < 60 ? `${minutes} 分钟` : `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分`;
}

Page({
  data: {
    mapName: '',
    stops: [], // { id, name, emoji, emojiColor, visited, legText, canUp, canDown }
    summary: '',
    chips: [], // 未入行程的地点
    navUrl: '',
    loading: true,
  },

  ids: [], // 行程地点 id 顺序
  places: [], // 本地图全部地点

  onShow() {
    const g = app.globalData;
    if (!g.map || g.isPublicView) {
      wx.showToast({ title: '公共广场是只读的，先加入一张地图', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 900);
      return;
    }
    this.setData({ mapName: g.map.name });
    this.load();
  },

  async load() {
    wx.showLoading({ title: '加载中…' });
    try {
      const code = app.globalData.map.code;
      [this.ids, this.places] = await Promise.all([api.itinerary(code), api.listPlaces(code)]);
      this.ids = this.ids.map((s) => s.id);
      wx.hideLoading();
      this.render();
    } catch (err) {
      wx.hideLoading();
      this.setData({ loading: false });
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  stopPlaces() {
    const byId = new Map(this.places.map((p) => [p.id, p]));
    return this.ids.map((id) => byId.get(id)).filter(Boolean);
  },

  render() {
    const stops = this.stopPlaces();
    let totalKm = 0;
    const rows = stops.map((p, i) => {
      const meta = categoryMeta(p.category);
      const next = stops[i + 1];
      let legText = '';
      if (next) {
        const km = haversineKm(p, next);
        totalKm += km;
        legText = `↳ ${fmtKm(km)} · 步行约 ${fmtWalk(km)}`;
      }
      return {
        id: p.id,
        name: p.name,
        emoji: meta.emoji,
        emojiColor: meta.color,
        visited: p.visited,
        legText,
        canUp: i > 0,
        canDown: Boolean(next),
      };
    });

    const inTrip = new Set(this.ids);
    const chips = this.places
      .filter((p) => !inTrip.has(p.id))
      .map((p) => ({ id: p.id, name: p.name }));

    const summary =
      stops.length > 1
        ? `${stops.length} 站 · 全程步行 ${fmtKm(totalKm)} · 约 ${fmtWalk(totalKm)}`
        : `${stops.length} 站`;

    this.setData({
      stops: rows,
      chips,
      summary,
      navUrl: stops.length >= 2 ? this.buildNavUrl(stops) : '',
      loading: false,
    });
  },

  async save() {
    try {
      const stops = await api.setItinerary(app.globalData.map.code, this.ids);
      this.ids = stops.map((s) => s.id);
      this.render();
    } catch (err) {
      wx.showToast({ title: err.message, icon: 'none' });
    }
  },

  onMoveUp(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (i <= 0) return;
    [this.ids[i - 1], this.ids[i]] = [this.ids[i], this.ids[i - 1]];
    this.save();
  },

  onMoveDown(e) {
    const i = Number(e.currentTarget.dataset.index);
    if (i >= this.ids.length - 1) return;
    [this.ids[i + 1], this.ids[i]] = [this.ids[i], this.ids[i + 1]];
    this.save();
  },

  onRemove(e) {
    const i = Number(e.currentTarget.dataset.index);
    this.ids.splice(i, 1);
    this.save();
  },

  onAddChip(e) {
    const id = Number(e.currentTarget.dataset.id);
    this.ids.push(id);
    this.save();
  },

  // 高德多点步行导航：首站起点、末站终点、中间走 via
  buildNavUrl(stops) {
    const pt = (p) => `${p.lng},${p.lat},${encodeURIComponent(p.name)}`;
    const parts = [`from=${pt(stops[0])}`, `to=${pt(stops[stops.length - 1])}`];
    if (stops.length > 2) parts.push(`via=${stops.slice(1, -1).map(pt).join(';')}`);
    parts.push('mode=walk', 'coordinate=gaode', 'src=moduExplore');
    return `https://uri.amap.com/navigation?${parts.join('&')}`;
  },

  buildText() {
    const stops = this.stopPlaces();
    if (stops.length === 0) return '';
    const lines = [`《${app.globalData.map?.name ?? '魔都Explore'}》行程单`, ''];
    stops.forEach((p, i) => lines.push(`${i + 1}. ${p.name}${p.visited ? '（已去过）' : ''}`));
    if (stops.length > 1) {
      let totalKm = 0;
      for (let i = 1; i < stops.length; i += 1) totalKm += haversineKm(stops[i - 1], stops[i]);
      lines.push('', `全程步行 ${fmtKm(totalKm)}，约 ${fmtWalk(totalKm)}`);
    }
    return lines.join('\n');
  },

  onCopyText() {
    const text = this.buildText();
    if (!text) {
      wx.showToast({ title: '行程还是空的', icon: 'none' });
      return;
    }
    wx.setClipboardData({ data: text });
  },

  onCopyNav() {
    if (!this.data.navUrl) {
      wx.showToast({ title: '至少要 2 站才能导航', icon: 'none' });
      return;
    }
    wx.setClipboardData({ data: this.data.navUrl });
  },
});
