export const CLIENT_VERSION = '0.4.1';
export const CHANGELOG = [
  { version: '0.4.1', date: '2026-10-09', channel: '体验版', notes: ['地点 emoji 图标与六类预设、自定义图标', '首页地点简介、地图比例调整与显示全部地点', '列表缓存、详情预取及操作结果即时更新', '地图改名与删除', '浅色、深色与跟随系统，微信版本更新提醒'] },
];
let manager;
let ready = false;
let available = null;

export function initUpdates() {
  if (manager || typeof wx.getUpdateManager !== 'function') return;
  manager = wx.getUpdateManager();
  manager.onCheckForUpdate((result) => { available = !!result.hasUpdate; });
  manager.onUpdateReady(() => { ready = true; promptUpdate(); });
  manager.onUpdateFailed(() => { ready = false; wx.showToast({ title: '新版本下载失败，请稍后重新进入', icon: 'none' }); });
}
function promptUpdate() {
  wx.showModal({ title: '新版本已准备好', content: '重新启动以使用新版本。', confirmText: '重新启动', success: (result) => { if (result.confirm) manager.applyUpdate(); } });
}
export function checkUpdates() {
  initUpdates();
  if (ready) promptUpdate();
  else wx.showToast({ title: available ? '新版本正在下载' : available === false ? '当前已是最新可用版本' : '请重新进入以检查最新版本', icon: 'none' });
}
