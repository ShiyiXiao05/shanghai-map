// 微信「消息推送」回调：接收 security.mediaCheckAsync 的异步审核结果。
//
// 需要 mp 后台配置（开发管理 → 消息推送）：
//   URL   = https://<你的后端域名>/api/wechat/media-check-callback
//   Token = 任意随机串，填到服务端环境变量 WECHAT_MSG_TOKEN
//   加密方式 = 明文模式（本项目只实现明文模式；安全模式的 AES 解密未实现）
//
// 回调体（明文模式）示例：
//   { "ToUserName": "...", "FromUserName": "...", "CreateTime": 123,
//     "MsgType": "event", "Event": "wxa_media_check",
//     "trace_id": "...", "version": 2, "result": { "suggest": "risky", "label": 20001 } }
import { Router } from 'express';

export function createWechatRouter({ store, contentSecurity }) {
  const router = Router();

  router.post('/media-check-callback', async (req, res, next) => {
    try {
      const { signature, timestamp, nonce } = req.query;
      if (!contentSecurity?.verifyCallback?.({ signature, timestamp, nonce })) {
        // 签名不符 → 直接拒绝，避免被伪造回调（例如把别人的照片标记为违规）
        return res.status(403).type('text').send('invalid signature');
      }
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const traceId = body.trace_id || body.TraceId || '';
      const suggest = body.result?.suggest || body.result?.Suggest || '';
      if (traceId && suggest) {
        // 只有明确 pass 才算通过；review / risky 一律先隐藏（保守处置）
        const moderation = suggest === 'pass' ? 'pass' : 'risky';
        const updated = await store.setPhotoModerationByTrace(traceId, moderation);
        console.warn(
          `[media-check] trace=${traceId} suggest=${suggest} -> ${moderation}` +
            (updated ? ` photo=${updated.id}` : ' (未匹配到照片)')
        );
      }
      // 微信要求 200；明文模式回 "success" 即可
      res.status(200).type('text').send('success');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
