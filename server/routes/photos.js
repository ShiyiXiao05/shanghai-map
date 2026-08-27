import { Router } from 'express';

const MAX_PHOTOS_PER_PLACE = 9;
const MAX_FULL_BYTES = 1.5 * 1024 * 1024;
const MAX_THUMB_BYTES = 150 * 1024;

const DATA_URL_RE = /^data:(image\/(?:webp|jpeg|png));base64,([A-Za-z0-9+/=]+)$/;

function parseImageDataUrl(dataUrl, field) {
  if (typeof dataUrl !== 'string') return { error: `${field} 格式不对` };
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return { error: `${field} 必须是 WebP / JPEG / PNG 图片数据` };
  return { mime: match[1], b64: match[2], bytes: Math.floor((match[2].length * 3) / 4) };
}

function parseId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function createPhotosRouter({ store }) {
  const router = Router();

  // 列表含缩略图 data URL，供详情页直接渲染
  router.get('/places/:id/photos', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      if (!(await store.getPlace(id, code))) {
        return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      }
      res.json({ photos: await store.listPhotos(id, code) });
    } catch (err) {
      next(err);
    }
  });

  router.post('/places/:id/photos', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const code = typeof body.map_code === 'string' ? body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getPlace(id, code))) {
        return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      }
      if ((await store.countPhotos(id, code)) >= MAX_PHOTOS_PER_PLACE) {
        return res.status(400).json({ error: `每个地点最多 ${MAX_PHOTOS_PER_PLACE} 张照片` });
      }
      const full = parseImageDataUrl(body.full, '照片');
      if (full.error) return res.status(400).json({ error: full.error });
      if (full.bytes > MAX_FULL_BYTES) {
        return res.status(400).json({ error: '照片太大，压缩后需小于 1.5MB' });
      }
      const thumb = parseImageDataUrl(body.thumb, '缩略图');
      if (thumb.error) return res.status(400).json({ error: thumb.error });
      if (thumb.bytes > MAX_THUMB_BYTES) {
        return res.status(400).json({ error: '缩略图异常，请重试' });
      }
      const addedBy =
        typeof body.added_by === 'string' ? body.added_by.trim().slice(0, 30) : '';
      const photo = await store.createPhoto({
        placeId: id,
        mapCode: code,
        mime: full.mime,
        fullB64: full.b64,
        thumbB64: thumb.b64,
        addedBy,
      });
      res.status(201).json({ id: photo.id });
    } catch (err) {
      next(err);
    }
  });

  // 原图二进制输出；id 全局唯一且必须带对的邀请码，可长缓存
  router.get('/photos/:id', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      const photo = await store.getPhoto(id, code);
      if (!photo) return res.status(404).json({ error: '照片不存在或邀请码不匹配' });
      res.set('Content-Type', photo.mime);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(Buffer.from(photo.full_b64, 'base64'));
    } catch (err) {
      next(err);
    }
  });

  router.delete('/photos/:id', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = (req.get('x-map-code') ?? '').trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少邀请码（x-map-code）' });
      const removed = await store.removePhoto(id, code);
      if (!removed) return res.status(404).json({ error: '照片不存在或邀请码不匹配' });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
