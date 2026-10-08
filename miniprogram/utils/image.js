// 图片处理：上传前的压缩与 data URL 转换。
// 为什么必须压缩：微信云托管 callContainer 请求体上限 100K（官方明确「请求中不建议包含图片」），
// Render 通道 express.json 上限 3MB，服务端又要求 thumb ≤64KB、full ≤1.5MB；
// 手机原图 base64 动辄数 MB，不压缩直接上传必然失败。

const DEFAULT_WIDTHS = [1280, 1080, 960, 800];
const DEFAULT_QUALITIES = [80, 70, 60, 45];

// 读取文件体积（字节）：优先 FileSystemManager.getFileInfo，回落已废弃但兼容性更好的 wx.getFileInfo
export function readFileSize(filePath) {
  return new Promise((resolve, reject) => {
    const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    const fail = (err) => reject(new Error('读取图片大小失败：' + ((err && err.errMsg) || '未知错误')));
    if (fs && typeof fs.getFileInfo === 'function') {
      fs.getFileInfo({
        filePath,
        success: (res) => resolve(Number(res.size) || 0),
        fail,
      });
      return;
    }
    if (typeof wx.getFileInfo === 'function') {
      wx.getFileInfo({
        filePath,
        success: (res) => resolve(Number(res.size) || 0),
        fail,
      });
      return;
    }
    reject(new Error('当前微信版本无法读取图片大小，请升级微信后重试'));
  });
}

// 单次压缩：无论成功失败都 resolve（失败给空串），保证调用方不会卡在永不 settle 的分支
function compressOnce(src, quality, compressedWidth) {
  return new Promise((resolve) => {
    wx.compressImage({
      src,
      quality,
      compressedWidth,
      success: (res) => resolve((res && res.tempFilePath) || ''),
      fail: (err) => {
        console.warn('[image] 压缩失败，尝试下一档', quality, compressedWidth, err);
        resolve('');
      },
    });
  });
}

// 迭代压缩到体积上限以内：按「先降质量、再降宽度」的顺序尝试，
// 命中第一个 ≤ maxBytes 的结果即返回 { path, size }；
// 全部超标时返回体积最小的一次（由调用方决定是否报错中止）。
export async function compressToLimit(src, options = {}) {
  const rawMax = Number(options.maxBytes);
  const maxBytes = Number.isFinite(rawMax) && rawMax > 0 ? Math.floor(rawMax) : Infinity;
  const widths =
    Array.isArray(options.widths) && options.widths.length > 0 ? options.widths : DEFAULT_WIDTHS;
  const qualities =
    Array.isArray(options.qualities) && options.qualities.length > 0
      ? options.qualities
      : DEFAULT_QUALITIES;

  const originalSize = await readFileSize(src).catch(() => -1);
  // 上限本身无效（没传/传错）时没有压缩的意义，直接用原图
  if (maxBytes === Infinity) return { path: src, size: originalSize < 0 ? 0 : originalSize };

  if (typeof wx.compressImage !== 'function') {
    // 基础库过低：没有任何压缩手段，只能原图直传或明确报错
    if (originalSize >= 0 && originalSize <= maxBytes) return { path: src, size: originalSize };
    throw new Error('当前微信版本不支持图片压缩，请升级微信后重试');
  }

  let best = originalSize >= 0 ? { path: src, size: originalSize } : null;
  for (const width of widths) {
    for (const quality of qualities) {
      const path = await compressOnce(src, quality, width);
      if (!path) continue;
      const size = await readFileSize(path).catch(() => -1);
      if (size < 0) continue;
      if (!best || size < best.size) best = { path, size };
      if (size <= maxBytes) return { path, size };
    }
  }
  if (best) return best;
  throw new Error('图片处理失败，请换一张照片试试');
}

// 本地文件 → data URL（服务端只接受 data:image/(webp|jpeg|png);base64, 前缀）
export function fileToDataUrl(filePath) {
  return new Promise((resolve, reject) => {
    const fs = typeof wx.getFileSystemManager === 'function' ? wx.getFileSystemManager() : null;
    if (!fs || typeof fs.readFile !== 'function') {
      reject(new Error('当前微信版本无法读取照片'));
      return;
    }
    fs.readFile({
      filePath,
      encoding: 'base64',
      success: (res) => {
        const lower = String(filePath).toLowerCase();
        const ext = lower.endsWith('.png') ? 'png' : lower.endsWith('.webp') ? 'webp' : 'jpeg';
        resolve(`data:image/${ext};base64,${res.data}`);
      },
      fail: (err) => reject(new Error('读取照片失败：' + ((err && err.errMsg) || '未知错误'))),
    });
  });
}
