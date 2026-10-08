// 上传前在浏览器端压缩：展示图长边 1200px、缩略图 240px，优先 WebP，不支持时回退 JPEG/PNG

const FULL_MAX_EDGE = 1200;
const THUMB_MAX_EDGE = 240;
// 迭代压缩档位：先只降质量，仍超限再按比例缩小长边（外层为长边比例，内层为编码质量）
const EDGE_STEPS = [1, 0.75, 0.55, 0.4];
const QUALITY_STEPS = [0.82, 0.68, 0.55];

async function loadBitmap(file) {
  if ('createImageBitmap' in window) {
    return createImageBitmap(file, { imageOrientation: 'from-image' });
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((resolve, reject) => {
      img.onload = resolve;
      img.onerror = () => reject(new Error('图片读取失败'));
      img.src = url;
    });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function drawScaled(source, maxEdge) {
  const width = source.naturalWidth ?? source.width;
  const height = source.naturalHeight ?? source.height;
  if (!width || !height) throw new Error('图片尺寸异常');
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.getContext('2d').drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function toDataUrl(canvas, candidates) {
  for (const [type, quality] of candidates) {
    const url = canvas.toDataURL(type, quality);
    // 编码器不支持该类型时会静默回退成 PNG，用前缀确认真的拿到了目标格式
    if (url.startsWith(`data:${type}`)) return url;
  }
  return canvas.toDataURL('image/png');
}

// dataURL 解码后的字节数：服务端按解码后大小判定上限，base64 会膨胀约 4/3
function dataUrlBytes(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

// 在 maxBytes 以内逐档尝试编码；全部超限时返回其中最小的一次，由调用方决定是否放弃
function compressWithin(bitmap, baseEdge, maxBytes) {
  let best = null;
  for (const scale of EDGE_STEPS) {
    const edge = Math.max(1, Math.round(baseEdge * scale));
    for (const quality of QUALITY_STEPS) {
      const dataUrl = toDataUrl(drawScaled(bitmap, edge), [
        ['image/webp', quality],
        ['image/jpeg', quality],
      ]);
      const bytes = dataUrlBytes(dataUrl);
      if (!best || bytes < best.bytes) best = { dataUrl, bytes };
      if (bytes <= maxBytes) return { dataUrl, bytes };
    }
  }
  return best;
}

function assertImage(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    throw new Error('只能上传图片文件');
  }
}

// 按目标字节数压缩展示图：先试 1200px + 高质量，超限则逐档降质量、再降长边
export async function compressToLimit(file, maxBytes) {
  assertImage(file);
  const bitmap = await loadBitmap(file);
  try {
    return compressWithin(bitmap, FULL_MAX_EDGE, maxBytes);
  } finally {
    bitmap.close?.();
  }
}

// 非 CDN 模式下服务端不派生缩略图，thumb 必须由客户端带上，同样要压进目标字节数
export async function compressThumbToLimit(file, maxBytes) {
  assertImage(file);
  const bitmap = await loadBitmap(file);
  try {
    return compressWithin(bitmap, THUMB_MAX_EDGE, maxBytes);
  } finally {
    bitmap.close?.();
  }
}

// 旧调用：一次拿到大图与缩略图（不设字节上限，第一次编码即返回）
export async function compressPhoto(file) {
  assertImage(file);
  const bitmap = await loadBitmap(file);
  try {
    return {
      full: compressWithin(bitmap, FULL_MAX_EDGE, Number.POSITIVE_INFINITY).dataUrl,
      thumb: compressWithin(bitmap, THUMB_MAX_EDGE, Number.POSITIVE_INFINITY).dataUrl,
    };
  } finally {
    bitmap.close?.();
  }
}
