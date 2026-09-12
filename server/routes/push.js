import { Router } from 'express';

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
