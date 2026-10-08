// 位置能力适配层
//
// 背景：wx.getLocation / wx.chooseLocation 属于「地理位置接口」，微信自 2022-04-18 起
// 实行准入开通——未在 mp 后台「开发管理 → 接口设置」申请到权限时：
//   1) 开发者工具会弹「接口无权限」；
//   2) 提交代码审核会被拦截（错误码 61040）。
//
// 因此这里做成可切换的：
//   - config.LOCATION_API_ENABLED = false（当前）：完全不调用这两个接口，
//     「添加地点」退化为在地图上手动点选，「附近」用地当前中心点近似计算——都不需要任何权限；
//   - config.LOCATION_API_ENABLED = true（申请到权限后）：走微信原生选点/定位。
//
// ⚠️ 切换为 true 时必须同步做三件事，否则提审会被 61040 拦截：
//   1) app.json 恢复 "requiredPrivateInfos": ["chooseLocation", "getLocation"]
//                 与 "permission": { "scope.userLocation": { "desc": "..." } }
//   2) mp 后台「用户隐私保护指引」勾选位置相关类型
//   3) mp 后台「开发管理 → 接口设置」确认两个接口状态为「已获得」
import { LOCATION_API_ENABLED } from './config.js';

export function locationApiEnabled() {
  return LOCATION_API_ENABLED;
}

function classify(err) {
  const message = String((err && err.errMsg) || '');
  if (/cancel/i.test(message)) return { ok: false, reason: 'cancel', message };
  if (/auth|deny|privacy|scope/i.test(message)) return { ok: false, reason: 'denied', message };
  return { ok: false, reason: 'failed', message };
}

// 选点：返回 { ok:true, data:{name,address,latitude,longitude} } 或 { ok:false, reason }
export function chooseLocation() {
  if (!LOCATION_API_ENABLED) return Promise.resolve({ ok: false, reason: 'disabled' });
  if (typeof wx.chooseLocation !== 'function') return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    wx.chooseLocation({
      success: (res) => resolve({ ok: true, data: res || {} }),
      fail: (err) => resolve(classify(err)),
    });
  });
}

// 定位：返回 { ok:true, data:{latitude,longitude} } 或 { ok:false, reason }
export function getLocation() {
  if (!LOCATION_API_ENABLED) return Promise.resolve({ ok: false, reason: 'disabled' });
  if (typeof wx.getLocation !== 'function') return Promise.resolve({ ok: false, reason: 'unsupported' });
  return new Promise((resolve) => {
    wx.getLocation({
      type: 'gcj02',
      isHighAccuracy: true,
      success: (res) => resolve({ ok: true, data: res || {} }),
      fail: (err) => resolve(classify(err)),
    });
  });
}
