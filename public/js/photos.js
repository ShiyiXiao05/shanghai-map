// 上传前在浏览器端压缩：展示图长边 1200px、缩略图 240px，优先 WebP，不支持时回退 JPEG/PNG

const FULL_MAX_EDGE = 1200;
const THUMB_MAX_EDGE = 240;

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

export async function compressPhoto(file) {
  if (!(file instanceof File) || !file.type.startsWith('image/')) {
    throw new Error('只能上传图片文件');
  }
  const bitmap = await loadBitmap(file);
  try {
    const full = toDataUrl(drawScaled(bitmap, FULL_MAX_EDGE), [
      ['image/webp', 0.82],
      ['image/jpeg', 0.85],
    ]);
    const thumb = toDataUrl(drawScaled(bitmap, THUMB_MAX_EDGE), [
      ['image/webp', 0.8],
      ['image/jpeg', 0.8],
    ]);
    return { full, thumb };
  } finally {
    bitmap.close?.();
  }
}
