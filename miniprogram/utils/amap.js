// 高德分享文本解析：从「高德 App → 分享 → 复制链接」得到的文本里取出坐标与名称。
//
// 两个用途：
//   1. pages/import：粘贴一条地点分享，直接建一个地点；
//   2. pages/index：粘贴自己的当前位置分享，当作「我的位置」——这是在不申请微信
//      地理位置接口权限的前提下，拿到**精确坐标**的办法（高德 App 能分享"我的位置"）。
//
// 解析逻辑与网页版 public/js/app.js 的 parseAmapShare 保持一致。
export function parseAmapShare(raw) {
  const text = (raw ?? '').trim();
  if (!text) return { error: '还没有粘贴内容' };

  const marker = text.match(/uri\.amap\.com\/marker\?([^\s"']+)/);
  if (marker) {
    const qs = marker[1].replace(/&amp;/g, '&');
    const get = (key) => {
      const m = qs.match(new RegExp(`(?:^|&)${key}=([^&]*)`));
      return m ? decodeURIComponent(m[1]).trim() : '';
    };
    const [lngStr, latStr] = get('position').split(',');
    const lng = Number(lngStr);
    const lat = Number(latStr);
    if (Number.isFinite(lng) && Number.isFinite(lat) && lng !== 0 && lat !== 0) {
      return { lng, lat, name: get('name'), address: get('addr') };
    }
  }

  const coord = text.match(/(\d{1,3}\.\d{4,})\s*[,，]\s*(\d{1,2}\.\d{4,})/);
  const bracket = text.match(/【(.+?)】|「(.+?)」|『(.+?)』/);
  if (coord) {
    const lng = Number(coord[1]);
    const lat = Number(coord[2]);
    if (Math.abs(lng) <= 180 && Math.abs(lat) <= 90) {
      return {
        lng,
        lat,
        name: bracket?.[1] ?? bracket?.[2] ?? bracket?.[3] ?? '',
      };
    }
  }

  const name = bracket?.[1] ?? bracket?.[2] ?? bracket?.[3];
  if (name) return { keyword: name };

  if (/amap\.com\/(place|detail|p)\/[A-Za-z0-9]+/i.test(text)) {
    return { error: '这个链接只有地点编号。请粘贴高德 App 分享的完整文本（含地点名或「位置：经度,纬度」），或改用搜索选点。' };
  }

  // 是高德 marker 链接但没解析出坐标（缺 position 或数值越界）
  if (marker) {
    return { error: '这个高德链接里没有可用的坐标，请在高德 App 里重新分享，或改用搜索选点。' };
  }

  return { error: '没有识别出坐标或地点名，确认粘贴的是高德分享文本/链接。' };
}
