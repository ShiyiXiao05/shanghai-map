// 微信「消息推送」回调：① URL 校验握手 ② 接收 security.mediaCheckAsync 的异步审核结果。
//
// mp 后台配置（管理 → 开发管理 → 消息推送）：
//   URL       = https://<你的后端域名>/api/wechat/media-check-callback
//   Token     = 与服务器环境变量 WECHAT_MSG_TOKEN 完全一致
//   加密方式   = 明文模式（本实现只支持明文；安全模式需要 AES 解密，未实现）
//   数据格式   = 建议 JSON；选 XML 也能兜底解析
//
// 明文模式回调体（JSON）示例：
//   { "ToUserName": "...", "FromUserName": "...", "CreateTime": 123,
//     "MsgType": "event", "Event": "wxa_media_check",
//     "trace_id": "...", "version": 2, "result": { "suggest": "risky", "label": 20001 } }
// XML 形式：<xml><trace_id><![CDATA[...]]></trace_id><result><suggest>risky</suggest></result></xml>
import { Router } from 'express';

// 从 XML 文本里取第一个命中的标签值（微信 XML 常用 CDATA 包裹）
function xmlField(xml, names) {
  for (const name of names) {
    const match = xml.match(
      new RegExp(`<${name}>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?</${name}>`, 'i')
    );
    if (match && match[1]) return match[1].trim();
  }
  return '';
}

export function createWechatRouter({ store, contentSecurity }) {
  const router = Router();

  // ① 微信服务器 URL 校验：把 echostr 原样回显（不带这一步，后台「提交」永远保存不了）
  router.get('/media-check-callback', (req, res) => {
    const { signature, timestamp, nonce, echostr } = req.query;
    if (!contentSecurity?.verifyCallback?.({ signature, timestamp, nonce })) {
      return res.status(403).type('text').send('invalid signature');
    }
    return res.status(200).type('text').send(String(echostr ?? ''));
  });

  // ② 审核结果回调
  router.post('/media-check-callback', async (req, res, next) => {
    try {
      const { signature, timestamp, nonce } = req.query;
      if (!contentSecurity?.verifyCallback?.({ signature, timestamp, nonce })) {
        // 签名不符 → 直接拒绝，避免被伪造回调（例如把别人的照片标记为违规）
        return res.status(403).type('text').send('invalid signature');
      }

      let traceId = '';
      let suggest = '';
      if (typeof req.body === 'string') {
        // 数据格式选了 XML：express.text 会把原始 XML 交到这里
        traceId = xmlField(req.body, ['trace_id', 'TraceId']);
        suggest = xmlField(req.body, ['suggest', 'Suggest']);
      } else if (req.body && typeof req.body === 'object') {
        traceId = req.body.trace_id || req.body.TraceId || '';
        suggest = req.body.result?.suggest || req.body.result?.Suggest || '';
      }

      if (traceId && suggest) {
        // 只有明确 pass 才算通过；review / risky 一律先隐藏（保守处置）
        const moderation = suggest === 'pass' ? 'pass' : 'risky';
        const updated = await store.setPhotoModerationByTrace(traceId, moderation);
        if (updated) {
          console.warn(`[media-check] trace=${traceId} suggest=${suggest} -> ${moderation} photo=${updated.id}`);
        } else {
          // 回调可能早于 trace_id 落库（上传链路还在等送审响应）：
          // 结果先存起来，等照片写入 trace_id 后再补关联，避免违规结果永久丢失（二次复核 P1-4）
          await store.saveMediaCheckResult(traceId, moderation, JSON.stringify(req.body).slice(0, 2000));
          console.warn(`[media-check] trace=${traceId} suggest=${suggest} -> ${moderation}（结果先到，已暂存待关联）`);
        }
      } else {
        console.warn('[media-check] 回调缺少 trace_id/suggest，已忽略');
      }
      // 微信要求 200；明文模式回 "success" 即可
      res.status(200).type('text').send('success');
    } catch (err) {
      next(err);
    }
  });

  return router;
}
