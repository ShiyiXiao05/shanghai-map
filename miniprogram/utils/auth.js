// 小程序登录：静默 wx.login 换 token（服务端 code2Session），首次写操作前补一次昵称确认。
// 2022-10 起 wx.getUserProfile 只返回「微信用户」，取真实昵称唯一合规方式是
// input type="nickname"（键盘上方会展示微信昵称供一键选用），见 nickname-modal 组件。
import { api, setAuthRecovery } from './api.js';
import { getAuthToken, setAuthToken, getNickname, setNickname } from './storage.js';

let pendingLogin = null;

function login() {
  if (!pendingLogin) {
    pendingLogin = (async () => {
      const { code } = await wx.login();
      const res = await api.login(code);
      // 拿到新 token 才落盘：登录失败（503/超时）时本地旧 token 原样保留，不丢身份
      setAuthToken(res.token);
      if (res.nickname !== undefined) setNickname(res.nickname);
      return res;
    })().finally(() => {
      pendingLogin = null;
    });
  }
  return pendingLogin;
}

// force=true 时跳过「已有 token 就直接用」的短路，强制重新登录；
// 无论哪种情况都先登录成功再覆盖本地 token，失败时抛错并保留旧 token
export async function ensureLogin({ force = false } = {}) {
  if (!force && getAuthToken()) return { token: getAuthToken(), nickname: getNickname() };
  const res = await login();
  return { token: res.token, nickname: res.nickname };
}

export function hasToken() {
  return !!getAuthToken();
}

// 退出登录：清 token 与昵称（供「我的身份」等入口使用）
export function logout() {
  setAuthToken('');
  setNickname('');
}

// 写操作守卫：返回登录昵称；昵称未设置时在页面上弹一次性确认层并返回 ''，
// 确认后自动重试 retry（页面需挂 nickname-modal 组件 + requireIdentityBehavior）
export async function requireIdentity(page, retry) {
  let session;
  try {
    session = await ensureLogin();
  } catch (err) {
    wx.showToast({ title: err.message || '登录失败，请重试', icon: 'none' });
    return '';
  }
  if (session.nickname) return session.nickname;
  page.setData({ nickModalShow: true });
  page.__nickRetry = retry || null;
  return '';
}

export async function confirmNickname(page, nickname) {
  const saved = await api.updateProfile(nickname);
  setNickname(saved);
  page.setData({ nickModalShow: false });
  const retry = page.__nickRetry;
  page.__nickRetry = null;
  if (retry) retry(saved);
  return saved;
}

export function cancelNickname(page) {
  page.setData({ nickModalShow: false });
  page.__nickRetry = null;
}

// 把「401 后恢复登录」注册给 api.js（模块顶层注册，避免 api.js ↔ auth.js 循环依赖）
if (typeof setAuthRecovery === 'function') setAuthRecovery((opts) => ensureLogin(opts));
