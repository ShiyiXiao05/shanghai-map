import { Router } from 'express';
import { limiters } from '../ratelimit.js';
import { guardTexts } from '../content-security.js';

const MAX_NICKNAME_CHARS = 30;

export function createAuthRouter({ auth, store, contentSecurity }) {
  const router = Router();
  // 登录会调用微信 code2Session：限流避免被刷
  const loginLimiter = limiters.login();

  // 小程序登录：body { code }（wx.login 的登录凭证）→ { token, nickname, needs_nickname }
  router.post('/login', loginLimiter, async (req, res, next) => {
    try {
      if (!auth.configured) {
        return res
          .status(503)
          .json({ error: '服务端未配置小程序登录（MINIPROGRAM_APPID / MINIPROGRAM_SECRET）' });
      }
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!code) return res.status(400).json({ error: '缺少 code（wx.login 的登录凭证）' });
      res.json(await auth.login(code));
    } catch (err) {
      if (err?.status) return res.status(err.status).json({ error: err.message });
      next(err);
    }
  });

  // 设置/更新昵称（需登录，走身份中间件）
  router.post('/profile', async (req, res, next) => {
    try {
      if (!req.user) return res.status(401).json({ error: '请先登录' });
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const nickname = typeof body.nickname === 'string' ? body.nickname.trim() : '';
      if (!nickname) return res.status(400).json({ error: '昵称不能为空' });
      if (nickname.length > MAX_NICKNAME_CHARS) {
        return res.status(400).json({ error: `昵称不能超过 ${MAX_NICKNAME_CHARS} 字` });
      }
      const guard = await guardTexts(contentSecurity, [['昵称', nickname]], {
        openid: req.user.openid,
      });
      if (guard.error) return res.status(400).json({ error: guard.error });
      const user = await store.setNickname(req.user.openid, nickname);
      res.json({ nickname: user.nickname });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
