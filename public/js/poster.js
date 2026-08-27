// 纯 canvas 合成 1080×1440 深色霓虹分享海报，无第三方依赖

const W = 1080;
const H = 1440;
const INK = '#e8ecf8';
const SOFT = '#9aa7c7';
const FAINT = '#5f6d92';
const BG = '#0a0f1e';
const CARD = '#10182b';
const NEON_A = '#ff3d81';
const NEON_B = '#22d3ee';

const PIN_PATH =
  'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z';

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function drawBackground(ctx) {
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // 城市网格底纹
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.05)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= W; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y <= H; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }

  // 霓虹光晕
  const glowA = ctx.createRadialGradient(140, 120, 0, 140, 120, 560);
  glowA.addColorStop(0, 'rgba(255, 61, 129, 0.22)');
  glowA.addColorStop(1, 'rgba(255, 61, 129, 0)');
  ctx.fillStyle = glowA;
  ctx.fillRect(0, 0, W, H);
  const glowB = ctx.createRadialGradient(W - 120, H - 200, 0, W - 120, H - 200, 620);
  glowB.addColorStop(0, 'rgba(34, 211, 238, 0.18)');
  glowB.addColorStop(1, 'rgba(34, 211, 238, 0)');
  ctx.fillStyle = glowB;
  ctx.fillRect(0, 0, W, H);
}

function drawBadge(ctx, x, y, r) {
  const grad = ctx.createLinearGradient(x - r, y - r, x + r, y + r);
  grad.addColorStop(0, NEON_A);
  grad.addColorStop(1, NEON_B);
  ctx.fillStyle = grad;
  ctx.shadowColor = 'rgba(255, 61, 129, 0.55)';
  ctx.shadowBlur = 34;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  ctx.save();
  ctx.translate(x, y + 2);
  const scale = (r * 1.15) / 24;
  ctx.scale(scale, scale);
  ctx.translate(-12, -12);
  ctx.fillStyle = '#070b16';
  ctx.fill(new Path2D(PIN_PATH));
  ctx.restore();
}

function drawHeader(ctx, mapName) {
  drawBadge(ctx, 104, 104, 52);

  const grad = ctx.createLinearGradient(180, 0, 640, 0);
  grad.addColorStop(0, NEON_A);
  grad.addColorStop(1, NEON_B);
  ctx.fillStyle = grad;
  ctx.font = '800 62px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('魔都·Explore', 180, 122);

  ctx.fillStyle = SOFT;
  ctx.font = '400 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('城市探索 · 地点收藏', 182, 164);

  // 地图名胶囊
  ctx.font = '600 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  const nameWidth = ctx.measureText(mapName).width;
  const pillX = 182;
  const pillY = 196;
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.55)';
  ctx.lineWidth = 2;
  roundRect(ctx, pillX, pillY, nameWidth + 56, 50, 25);
  ctx.stroke();
  ctx.fillStyle = NEON_B;
  ctx.fillText(`🗂 ${mapName}`, pillX + 28, pillY + 34);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawStats(ctx, places) {
  const visited = places.filter((p) => p.visited).length;
  const wishes = places.reduce((sum, p) => sum + (p.wishes?.length ?? 0), 0);
  const comments = places.reduce((sum, p) => sum + (p.comment_count ?? 0), 0);
  const photos = places.reduce((sum, p) => sum + (p.photo_count ?? 0), 0);
  const items = [
    [places.length, '地点'],
    [visited, '已去过'],
    [wishes, '想要'],
    [comments, '留言'],
    [photos, '照片'],
  ];
  const top = 316;
  const colW = W / items.length;
  items.forEach(([value, label], i) => {
    const cx = colW * i + colW / 2;
    ctx.fillStyle = i === 0 ? NEON_B : INK;
    ctx.font = '800 64px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(String(value), cx, top + 58);
    ctx.fillStyle = SOFT;
    ctx.font = '400 25px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.fillText(label, cx, top + 98);
  });
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(38, 51, 82, 0.9)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(70, top + 140);
  ctx.lineTo(W - 70, top + 140);
  ctx.stroke();
}

function drawCategories(ctx, places) {
  const palette = {
    景点: '#34d399',
    美食: '#fb923c',
    展馆: '#60a5fa',
    购物: '#f472b6',
    娱乐: '#a78bfa',
    其他: '#94a3b8',
  };
  const counts = new Map();
  for (const place of places) {
    counts.set(place.category, (counts.get(place.category) ?? 0) + 1);
  }
  const entries = [...counts.entries()];
  const top = 530;
  ctx.fillStyle = INK;
  ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('我们的清单', 80, top);

  if (entries.length === 0) return;
  const barY = top + 32;
  const barW = W - 160;
  let x = 80;
  const total = places.length || 1;
  for (const [category, count] of entries) {
    const seg = Math.max((count / total) * barW, 14);
    ctx.fillStyle = palette[category] ?? '#94a3b8';
    roundRect(ctx, x, barY, seg, 24, 8);
    ctx.fill();
    x += seg + 4;
  }

  // 图例
  ctx.font = '400 23px "PingFang SC", "Microsoft YaHei", sans-serif';
  let lx = 80;
  const ly = barY + 62;
  for (const [category, count] of entries) {
    ctx.fillStyle = palette[category] ?? '#94a3b8';
    ctx.beginPath();
    ctx.arc(lx + 8, ly - 8, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = SOFT;
    const text = `${category} ${count}`;
    ctx.fillText(text, lx + 24, ly);
    lx += 24 + ctx.measureText(text).width + 26;
  }
}

async function drawPhotos(ctx, photos) {
  const top = 690;
  ctx.fillStyle = INK;
  ctx.font = '700 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('沿途的瞬间', 80, top);

  const gap = 18;
  const cols = 3;
  const cellW = (W - 160 - gap * (cols - 1)) / cols;
  const cellH = 208;
  const startY = top + 26;

  if (photos.length === 0) {
    ctx.strokeStyle = 'rgba(38, 51, 82, 0.9)';
    ctx.setLineDash([10, 8]);
    ctx.lineWidth = 2;
    roundRect(ctx, 80, startY, W - 160, cellH * 2 + gap, 24);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = FAINT;
    ctx.font = '400 26px "PingFang SC", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('还没有照片，去过后传一张，海报会更有味道', W / 2, startY + cellH + 14);
    ctx.textAlign = 'left';
    return;
  }

  for (let i = 0; i < 6; i += 1) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = 80 + col * (cellW + gap);
    const y = startY + row * (cellH + gap);
    if (i < photos.length) {
      const img = await loadImage(photos[i]);
      ctx.save();
      roundRect(ctx, x, y, cellW, cellH, 20);
      ctx.clip();
      if (img) {
        // cover 裁剪
        const scale = Math.max(cellW / img.width, cellH / img.height);
        const dw = img.width * scale;
        const dh = img.height * scale;
        ctx.drawImage(img, x + (cellW - dw) / 2, y + (cellH - dh) / 2, dw, dh);
      } else {
        ctx.fillStyle = CARD;
        ctx.fillRect(x, y, cellW, cellH);
      }
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(16, 24, 43, 0.6)';
      roundRect(ctx, x, y, cellW, cellH, 20);
      ctx.fill();
    }
  }
}

function drawInvite(ctx, code) {
  const top = 1174;
  ctx.textAlign = 'center';
  ctx.fillStyle = SOFT;
  ctx.font = '400 28px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('把邀请码发给同学，一起标记这座城', W / 2, top);

  ctx.shadowColor = 'rgba(34, 211, 238, 0.5)';
  ctx.shadowBlur = 26;
  ctx.fillStyle = NEON_B;
  ctx.font = '800 108px "PingFang SC", "Microsoft YaHei", sans-serif';
  // 手动字距：等宽摆放 6 位码
  const chars = code.split('');
  const step = 118;
  const startX = W / 2 - ((chars.length - 1) * step) / 2;
  chars.forEach((ch, i) => ctx.fillText(ch, startX + i * step, top + 132));
  ctx.shadowBlur = 0;

  ctx.fillStyle = FAINT;
  ctx.font = '400 26px "PingFang SC", "Microsoft YaHei", sans-serif';
  const link = `${location.origin}/?map=${code}`;
  ctx.fillText(link, W / 2, top + 192);

  const grad = ctx.createLinearGradient(0, 0, 160, 0);
  grad.addColorStop(0, NEON_A);
  grad.addColorStop(1, NEON_B);
  ctx.fillStyle = grad;
  ctx.font = '800 30px "PingFang SC", "Microsoft YaHei", sans-serif';
  ctx.fillText('魔都·Explore', W / 2, H - 56);
  ctx.textAlign = 'left';
}

export async function generatePoster(canvas, { mapName, code, places, photos }) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx);
  drawHeader(ctx, mapName || '共享地图');
  drawStats(ctx, places);
  drawCategories(ctx, places);
  await drawPhotos(ctx, photos);
  drawInvite(ctx, code);
}
