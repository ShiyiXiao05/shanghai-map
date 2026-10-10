// 小程序全局配置：填好下面两项即可完整运行
// 1. 后端地址（回落通道）：体验版在开发者工具勾选「不校验合法域名」即可直连
export const BASE_URL = 'https://shanghai-wish-map.onrender.com';

// 1.5 微信云托管（正式版通道）：开通云托管后填入环境 ID（形如 xxx-1a2b3c），
// 所有请求自动改走 wx.cloud.callContainer，免域名备案、正式版可直接提审；
// 留空则回落 wx.request 直连上面的 BASE_URL（体验版/本地调试用）
export const CLOUD_ENV_ID = 'shanghai-map-d4gh58zcjddcf3dc1';
// 云托管服务名：与控制台创建的服务名一致（见 docs/微信云托管部署指引.md）
export const CLOUD_SERVICE_NAME = 'shanghai-map';

// 关于「在地图上选点 / 附近」的说明
//
// 两者都不调用微信的地理位置接口（那些接口需要后台准入开通，未开通时提审会被 61040 拦截）：
// 「添加地点」在地图上手动点选；「附近」以用户标记的「我的位置」为原点（首页可拖动地图
// 设为我的位置，记在本地存储里复用）。
// 申请到权限后要换回设备定位，步骤与代码见 docs/待启用-设备定位实现.md。

// 2. 腾讯位置服务 key（https://lbs.qq.com 控制台创建，选「WebServiceAPI」并勾选微信小程序授权）
// 用途：地点关键词搜索 / 逆地理（吸附选点）
export const TMAP_KEY = '';

// 「附近」在无法自动定位时的快捷锚点：一键选一个大区域，比手动拖动地图省事
// （坐标取区域中心，精度约 1–2 公里；要更准用「在地图上点选」或「粘贴高德位置链接」）
export const NEARBY_ANCHORS = [
  { name: '人民广场', latitude: 31.2331, longitude: 121.4692 },
  { name: '徐家汇', latitude: 31.1905, longitude: 121.437 },
  { name: '静安寺', latitude: 31.2246, longitude: 121.4453 },
  { name: '陆家嘴', latitude: 31.2397, longitude: 121.4998 },
  { name: '五角场', latitude: 31.301, longitude: 121.5147 },
  { name: '中山公园', latitude: 31.2213, longitude: 121.42 },
  { name: '虹桥', latitude: 31.197, longitude: 121.336 },
  { name: '莘庄', latitude: 31.112, longitude: 121.386 },
  { name: '松江大学城', latitude: 31.034, longitude: 121.22 },
  { name: '迪士尼', latitude: 31.144, longitude: 121.657 },
  { name: '浦东机场', latitude: 31.1443, longitude: 121.8083 },
  { name: '临港', latitude: 30.9, longitude: 121.9 },
];

export const CATEGORIES = [
  { id: '景点', emoji: '🏞️', color: '#2fa877' },
  { id: '美食', emoji: '🍜', color: '#e8862e' },
  { id: '展馆', emoji: '🏛️', color: '#4d82d4' },
  { id: '购物', emoji: '🛍️', color: '#e0568f' },
  { id: '娱乐', emoji: '🎡', color: '#8e63d8' },
  { id: '其他', emoji: '📍', color: '#7e8f9c' },
];

export function categoryMeta(id) {
  return CATEGORIES.find((c) => c.id === id) ?? CATEGORIES[CATEGORIES.length - 1];
}
