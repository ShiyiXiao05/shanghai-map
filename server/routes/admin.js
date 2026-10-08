// 临时诊断端点：直接向微信查询本小程序的「用户隐私保护指引」配置状态。
//
// 用途：控制台里找不到隐私指引入口时，用接口拿到微信侧的权威答案
//      （能不能配、已配了哪些、代码检测出需要声明哪些）。
//
// 鉴权：请求头 x-admin-token 必须等于 WECHAT_MSG_TOKEN（该值只存在于服务端环境变量与
//      小程序后台，不会出现在前端代码里）。未配置时该端点直接 404。
// 只读：仅调用查询接口，不修改任何配置。
import { Router } from 'express';

const STABLE_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token';

async function callWechat(url, { method = 'POST', token } = {}) {
  const target = token ? `${url}?access_token=${encodeURIComponent(token)}` : url;
  const res = await fetch(target, {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? '{}' : undefined,
  });
  const text = await res.text();
  try {
    return { httpStatus: res.status, data: JSON.parse(text) };
  } catch {
    return { httpStatus: res.status, data: { raw: text.slice(0, 500) } };
  }
}

export function createAdminRouter() {
  const router = Router();

  router.get('/wechat-privacy', async (req, res) => {
    const expected = process.env.WECHAT_MSG_TOKEN || '';
    const provided = req.get('x-admin-token') || '';
    if (!expected || provided !== expected) {
      return res.status(404).json({ error: '接口不存在' });
    }
    const appid = process.env.MINIPROGRAM_APPID;
    const secret = process.env.MINIPROGRAM_SECRET;
    if (!appid || !secret) {
      return res.json({ configured: false, reason: '服务端未配置 MINIPROGRAM_APPID/SECRET' });
    }
    try {
      const tokenRes = await callWechat(STABLE_TOKEN_URL, { method: 'POST' });
      const accessToken = tokenRes.data?.access_token;
      if (!accessToken) {
        return res.json({ configured: true, tokenOk: false, tokenResponse: tokenRes.data });
      }
      // 查询用户隐私保护指引（试点 POST，若接口只支持 GET 再由调用方按返回信息调整）
      const queried = await callWechat('https://api.weixin.qq.com/wxa/getprivacysetting', {
        method: 'POST',
        token: accessToken,
      });
      return res.json({
        configured: true,
        tokenOk: true,
        appidTail: String(appid).slice(-6),
        privacySetting: queried.data,
        httpStatus: queried.httpStatus,
      });
    } catch (err) {
      return res.status(502).json({ error: `调用微信接口失败：${err?.message ?? err}` });
    }
  });

  return router;
}
