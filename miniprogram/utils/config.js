// 小程序全局配置：填好下面两项即可完整运行
// 1. 后端地址：体验版在开发者工具勾选「不校验合法域名」即可直连
export const BASE_URL = 'https://shanghai-wish-map.onrender.com';

// 2. 腾讯位置服务 key（https://lbs.qq.com 控制台创建，选「WebServiceAPI」并勾选微信小程序授权）
// 用途：地点关键词搜索 / 逆地理（吸附选点）
export const TMAP_KEY = '';

export const CATEGORIES = [
  { id: '景点', emoji: '📍', color: '#2fa877' },
  { id: '美食', emoji: '🍜', color: '#e8862e' },
  { id: '展馆', emoji: '🖼️', color: '#4d82d4' },
  { id: '购物', emoji: '🛍️', color: '#e0568f' },
  { id: '娱乐', emoji: '🎡', color: '#8e63d8' },
  { id: '其他', emoji: '✨', color: '#7e8f9c' },
];

export function categoryMeta(id) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}
