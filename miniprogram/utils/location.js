// 「我的位置」：由用户一次性标记，之后一直复用。
//
// 为什么不直接读设备定位：
// 微信的「地理位置接口」（getLocation / chooseLocation）自 2022-04-18 起实行准入开通。
// 没申请到权限时，只要包里出现这两个接口名就会——① 开发者工具弹「接口无权限」；
// ② 提交代码审核被 61040 拦截。因此这里完全不调用定位接口。
//
// 改为：用户在首页把地图拖到自己所在位置（或在地图上点一下），点「设为我的位置」，
// 记到本地存储。这个点就是"真实位置"（精度由用户自己掌握），且不涉及任何隐私接口。
// 将来申请到地理位置接口权限后要换回设备定位，步骤与代码见
// docs/待启用-设备定位实现.md（服务端测试里有一条守卫，会在包内出现接口名时失败）。
const STORAGE_KEY = 'wish-my-location';

export function getMyLocation() {
  try {
    const saved = wx.getStorageSync(STORAGE_KEY);
    if (!saved) return null;
    const latitude = Number(saved.latitude);
    const longitude = Number(saved.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { latitude, longitude, at: Number(saved.at) || 0 };
  } catch (err) {
    return null;
  }
}

export function setMyLocation(point) {
  const latitude = Number(point && point.latitude);
  const longitude = Number(point && point.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const saved = { latitude, longitude, at: Date.now() };
  try {
    wx.setStorageSync(STORAGE_KEY, saved);
  } catch (err) {
    // 存储失败不影响本次排序
  }
  return saved;
}

export function clearMyLocation() {
  try {
    wx.removeStorageSync(STORAGE_KEY);
  } catch (err) {
    // 忽略：清不掉时下次仍会复用旧位置，不影响功能
  }
}
