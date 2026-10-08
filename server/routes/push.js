import { Router } from 'express';

// 推送端点校验：只接受 https 公网主机，阻断"订阅一个内网地址让服务端去请求"的 SSRF 面。
// 需要更严格时可用环境变量 PUSH_ALLOWED_HOSTS 指定域名后缀白名单（逗号分隔）。
const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_HOST_RE = /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i;

function isAllowedEndpoint(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (IPV4_RE.test(host)) return false; // IP 字面量（含 127.0.0.1 / 10.x / 192.168.x）
  if (host.includes(':')) return false; // IPv6 字面量
  if (PRIVATE_HOST_RE.test(host) || !host.includes('.')) return false;
  const allowed = (process.env.PUSH_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return true;
  return allowed.some((suffix) => host === suffix || host.endsWith('.' + suffix));
}

export function createPushRouter({ store, pusher }) {
  const router = Router();

  router.get('/key', (req, res) => {
    if (!pusher?.configured) {
      return res.status(503).json({ error: '通知未启用（服务端未配置 VAPID 密钥）' });
    }
    res.json({ publicKey: pusher.publicKey });
  });

  // 订阅：同 endpoint 重复订阅按 upsert 处理
  router.post('/subscribe', async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const code = typeof body.map_code === 'string' ? body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const sub = body.subscription;
      const endpoint = typeof sub?.endpoint === 'string' ? sub.endpoint : '';
      const p256dh = typeof sub?.keys?.p256dh === 'string' ? sub.keys.p256dh : '';
      const auth = typeof sub?.keys?.auth === 'string' ? sub.keys.auth : '';
      if (!endpoint || !p256dh || !auth) {
        return res.status(400).json({ error: 'subscription 缺少 endpoint 或 keys' });
      }
      if (!isAllowedEndpoint(endpoint)) {
        return res.status(400).json({ error: '推送端点不合法（必须为 https 公网地址）' });
      }
      const who = typeof body.who === 'string' ? body.who.trim().slice(0, 30) : '';
      await store.saveSubscription({ mapCode: code, endpoint, p256dh, auth, who });
      res.status(201).json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/subscribe', async (req, res, next) => {
    try {
      const code = (req.get('x-map-code') ?? '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少邀请码（x-map-code）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : '';
      if (!endpoint) return res.status(400).json({ error: '缺少 endpoint' });
      await store.removeSubscription(endpoint);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
