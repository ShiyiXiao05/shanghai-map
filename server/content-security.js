// 内容安全：调用微信 security.msgSecCheck（v2）拦截不适宜文本，
// 并用 security.mediaCheckAsync 对照片做异步审核（结果通过 mp 后台"消息推送"回调回来）。
//
// 设计取舍（与 pusher/uploader 的降级风格一致）：
// - 未配置 MINIPROGRAM_APPID/SECRET 时整体停用，写入不受影响
// - 检测接口报错/超时一律「放行 + 记日志」：可用性优先，避免微信侧抖动导致全站写不进去
// - 只有拿到明确的「不通过」结论（errcode 87014 或 result.suggest !== pass）才拒绝写入
// - mediaCheckAsync 需要 mp 后台配置「消息推送」（Token + 明文模式）才有意义，
//   因此只有配置了 WECHAT_MSG_TOKEN 才送审；送审失败同样放行，照片按未审核处理
// - access_token 用 stable_token 接口获取并缓存，提前 5 分钟刷新

import crypto from 'node:crypto';
import { wechatFetch } from './net.js';

const STABLE_TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token';
const MSG_SEC_CHECK_URL = 'https://api.weixin.qq.com/wxa/msg_sec_check';
const MEDIA_CHECK_URL = 'https://api.weixin.qq.com/wxa/media_check_async';
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;
// 外部调用一律带超时：否则微信侧抖动会把写请求一直挂住（fail-open 前必须能返回）
const TOKEN_TIMEOUT_MS = 5000;
const TEXT_CHECK_TIMEOUT_MS = 3000;
const MEDIA_CHECK_TIMEOUT_MS = 5000;

export const RISKY_ERRCODE = 87014;
export const MEDIA_TYPE_IMAGE = 2;
// 场景值：1 资料 / 2 评论 / 3 论坛 / 4 社交日志
export const SCENE = { PROFILE: 1, COMMENT: 2, FORUM: 3 };

/** 微信「消息推送」明文模式回调签名校验：sha1(sort(token, timestamp, nonce).join('')) */
export function verifyCallbackSignature({ token, signature, timestamp, nonce } = {}) {
  if (!token || !signature || !timestamp || !nonce) return false;
  const expected = crypto
    .createHash('sha1')
    .update([String(token), String(timestamp), String(nonce)].sort().join(''))
    .digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function createContentSecurity({
  appid,
  secret,
  enabled = true,
  msgToken = '',
  fetchImpl,
  logger = console,
} = {}) {
  // 微信接口统一走 wechatFetch：云托管容器内自动改用 http（平台本地代理 + 自签证书），
  // 普通环境下仍是 https。测试注入的 fetchImpl 优先，保持可测性。
  const wechatFetchImpl = fetchImpl
    ? (url, options) => fetchImpl(url, options)
    : (url, options) => wechatFetch(url, options, { logger });
  const configured = Boolean(enabled && appid && secret);
  // 异步图片审核依赖回调通道：没配 Token 就没有结果回来，送审没有意义
  const mediaCheckEnabled = configured && Boolean(msgToken);
  let token = '';
  let tokenExpireAt = 0;

  async function getAccessToken() {
    if (token && Date.now() < tokenExpireAt) return token;
    const res = await wechatFetchImpl(STABLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid, secret }),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const data = await res.json();
    if (!data.access_token) {
      throw new Error(data.errmsg || `获取 access_token 失败（${data.errcode}）`);
    }
    token = data.access_token;
    tokenExpireAt =
      Date.now() + Math.max(60_000, (data.expires_in ?? 7200) * 1000 - TOKEN_REFRESH_MARGIN_MS);
    return token;
  }

  function dropToken() {
    token = '';
    tokenExpireAt = 0;
  }

  /**
   * 文本检测
   * @returns {Promise<{checked: boolean, pass: boolean, label?: number, reason?: string}>}
   */
  async function checkText(content, { openid, scene = SCENE.COMMENT } = {}) {
    if (!configured) return { checked: false, pass: true };
    const text = typeof content === 'string' ? content.trim() : '';
    if (!text) return { checked: false, pass: true };
    try {
      const accessToken = await getAccessToken();
      const res = await wechatFetchImpl(
        `${MSG_SEC_CHECK_URL}?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            content: text.slice(0, 2500),
            version: 2,
            scene,
            ...(openid ? { openid } : {}),
          }),
          signal: AbortSignal.timeout(TEXT_CHECK_TIMEOUT_MS),
        }
      );
      const data = await res.json();
      if (data.errcode === RISKY_ERRCODE) {
        return { checked: true, pass: false, label: data.result?.label, reason: 'risky' };
      }
      if (data.errcode && data.errcode !== 0) {
        if ([40001, 40014, 42001].includes(data.errcode)) dropToken();
        logger.warn?.('[content-security] 检测异常，按放行处理：', data.errcode, data.errmsg);
        return { checked: false, pass: true, reason: `errcode:${data.errcode}` };
      }
      const suggest = data.result?.suggest;
      if (suggest && suggest !== 'pass') {
        return { checked: true, pass: false, label: data.result?.label, reason: suggest };
      }
      return { checked: true, pass: true };
    } catch (err) {
      logger.warn?.('[content-security] 检测失败，按放行处理：', err?.message ?? err);
      return { checked: false, pass: true, reason: 'error' };
    }
  }

  /**
   * 图片异步审核：成功返回 trace_id，结果稍后由 mp 后台「消息推送」回调带回
   * @returns {Promise<{submitted: boolean, traceId?: string, reason?: string}>}
   */
  async function mediaCheckAsync(mediaUrl, { openid, scene = SCENE.FORUM } = {}) {
    if (!mediaCheckEnabled) return { submitted: false, reason: 'disabled' };
    const url = typeof mediaUrl === 'string' ? mediaUrl.trim() : '';
    if (!/^https:\/\//.test(url)) return { submitted: false, reason: 'not-public-url' };
    try {
      const accessToken = await getAccessToken();
      const res = await wechatFetchImpl(
        `${MEDIA_CHECK_URL}?access_token=${encodeURIComponent(accessToken)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            media_url: url,
            media_type: MEDIA_TYPE_IMAGE,
            version: 2,
            scene,
            ...(openid ? { openid } : {}),
          }),
          signal: AbortSignal.timeout(MEDIA_CHECK_TIMEOUT_MS),
        }
      );
      const data = await res.json();
      if (data.errcode === 0 && data.trace_id) return { submitted: true, traceId: data.trace_id };
      if ([40001, 40014, 42001].includes(data.errcode)) dropToken();
      logger.warn?.('[content-security] 图片送审失败，按放行处理：', data.errcode, data.errmsg);
      return { submitted: false, reason: `errcode:${data.errcode}` };
    } catch (err) {
      logger.warn?.('[content-security] 图片送审异常，按放行处理：', err?.message ?? err);
      return { submitted: false, reason: 'error' };
    }
  }

  /** mp 后台「消息推送」回调（明文模式）签名校验 */
  function verifyCallback(query = {}) {
    return verifyCallbackSignature({ token: msgToken, ...query });
  }

  return {
    configured,
    mediaCheckEnabled,
    checkText,
    mediaCheckAsync,
    verifyCallback,
    RISKY_ERRCODE,
  };
}

/**
 * 批量校验若干字段；任一不通过即返回 { error }（调用方直接 400）。
 * contentSecurity 未注入时视为全部通过。
 */
export async function guardTexts(contentSecurity, fields, { openid } = {}) {
  if (!contentSecurity) return {};
  for (const [label, value] of fields) {
    if (!value) continue;
    const result = await contentSecurity.checkText(value, { openid });
    if (!result.pass) {
      return { error: `${label}包含不适宜内容，请修改后重试` };
    }
  }
  return {};
}
