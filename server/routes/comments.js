import { Router } from 'express';
import { identityOr401 } from './identity.js';
import { guardTexts } from '../content-security.js';

const MAX_BODY_CHARS = 280;
const MAX_AUTHOR_CHARS = 30;

function parseId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function createCommentsRouter({ store, pusher, contentSecurity }) {
  const router = Router();

  router.get('/places/:id/comments', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      if (!(await store.getPlace(id, code))) {
        return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      }
      res.json({ comments: await store.listComments(id, code) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/places/:id/comments', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const code = typeof body.map_code === 'string' ? body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getPlace(id, code))) {
        return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      }
      if (typeof body.body !== 'string' || !body.body.trim()) {
        return res.status(400).json({ error: '留言不能为空' });
      }
      const text = body.body.trim().slice(0, MAX_BODY_CHARS + 1);
      if (text.length > MAX_BODY_CHARS) {
        return res.status(400).json({ error: `留言最多 ${MAX_BODY_CHARS} 字` });
      }
      const guard = await guardTexts(contentSecurity, [['留言', text]], {
        openid: req.user?.openid,
      });
      if (guard.error) return res.status(400).json({ error: guard.error });
      const clientAuthor =
        typeof body.author === 'string' ? body.author.trim().slice(0, MAX_AUTHOR_CHARS) : '';
      const author = identityOr401(req, res, clientAuthor);
      if (author === null) return;
      const comment = await store.createComment({ placeId: id, mapCode: code, author, body: text });
      res.status(201).json(comment);
      // 新留言通知订阅者
      pusher?.notifyMap(code, {
        title: '💬 魔都·Explore 有新留言',
        body: `${author || '同学'}：${text.slice(0, 40)}`,
        url: `/?map=${code}&place=${id}`,
      });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/comments/:id', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = (req.get('x-map-code') ?? '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少邀请码（x-map-code）' });
      const removed = await store.removeComment(id, code);
      if (!removed) return res.status(404).json({ error: '留言不存在或邀请码不匹配' });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
