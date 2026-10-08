// 小程序登录：静默 wx.login 换 token（服务端 code2Session），首次写操作前补一次昵称确认。
// 2022-10 起 wx.getUserProfile 只返回「微信用户」，取真实昵称唯一合规方式是
// input type="nickname"（键盘上方会展示微信昵称供一键选用），见 nickname-modal 组件。
import { api } from './api.js';
import { getAuthToken, setAuthToken, getNickname, setNickname } from './storage.js';

let pendingLogin = null;

function login() {
  if (!pendingLogin) {
    pendingLogin = (async () => {
      const { code } = await wx.login();
      const res = await api.login(code);
      setAuthToken(res.token);
      if (res.nickname !== undefined) setNickname(res.nickname);
      return res;
    })().finally(() => {
      pendingLogin = null;
    });
  }
  return pendingLogin;
}

export async function ensureLogin({ force = false } = {}) {
  if (force) setAuthToken('');
  if (getAuthToken()) return { token: getAuthToken(), nickname: getNickname() };
  const res = await login();
  return { token: res.token, nickname: res.nickname };
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
