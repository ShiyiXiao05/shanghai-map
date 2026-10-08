import { Router } from 'express';
import { identityOr401 } from './identity.js';

export const MAX_PHOTOS_PER_PLACE = 9;
export const MAX_FULL_BYTES = 1.5 * 1024 * 1024;
// 缩略图上限 64KB：给客户端明确预算，同时避免列表/回忆页响应过大
// （云托管 callContainer 响应包上限 1000KiB，见审计报告 F-58）
export const MAX_THUMB_BYTES = 64 * 1024;

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

export function createPhotosRouter({ store, uploader, pusher, contentSecurity }) {
  const publicBase = (process.env.PUBLIC_BASE_URL || 'https://shanghai-wish-map.onrender.com').replace(
    /\/$/,
    ''
  );

  // 图片内容审核（异步）：送审成功则先标记 pending，结果由 mp 后台回调更新为 pass/risky。
  // 未配置 WECHAT_MSG_TOKEN 或送审失败都不影响上传本身（可用性优先）。
  //
  // 审核策略：**先发后审** —— pending/none 的照片照常展示，只有明确判为 risky 才从所有
  // 读取路径隐藏（列表/回忆/公共广场/单张取图）。这是产品取舍：上传即可见，体验优先。
  // 若要改成"先审后发"，把 store.js 各处过滤条件由 `moderation <> 'risky'` 改为
  // `moderation = 'pass'` 即可，无需改动其它代码。
  async function submitMediaCheck(photoId, mapCode, openid, cdnUrl) {
    if (!contentSecurity?.mediaCheckAsync) return;
    const mediaUrl = cdnUrl || `${publicBase}/api/photos/${photoId}?map=${encodeURIComponent(mapCode)}`;
    const result = await contentSecurity.mediaCheckAsync(mediaUrl, { openid });
    if (!result.submitted) return;
    try {
      await store.setPhotoModeration(photoId, { moderation: 'pending', traceId: result.traceId });
    } catch (err) {
      // trace_id 写不进去 = 这张图的审核结果永远关联不上，必须留日志而不是静默吞掉
      console.warn('[media-check] trace_id 落库失败：', err?.message ?? err);
      return;
    }
    // 回调可能比 trace_id 更早到达：补一次关联
    try {
      const early = await store.getMediaCheckResult(result.traceId);
      if (early) {
        await store.setPhotoModerationByTrace(result.traceId, early.moderation);
        console.warn(`[media-check] 已补关联早到的审核结果 trace=${result.traceId} -> ${early.moderation}`);
      }
    } catch (err) {
      console.warn('[media-check] 补关联失败：', err?.message ?? err);
    }
  }

  const router = Router();

  // 并发上传可能同时通过 count 检查（检查与插入非原子）：
  // 插入后按 id 顺序裁剪到上限，并把被裁掉那几张的 CDN 资源一并销毁。
  // 返回本次请求插入的照片是否被保留。
  async function enforcePhotoLimit(placeId, mapCode, photoId) {
    const { removed, keepIds } = await store.trimPhotos(placeId, mapCode, MAX_PHOTOS_PER_PLACE);
    if (removed.length > 0 && uploader?.configured) {
      await Promise.all(
        removed
          .filter((row) => row.public_id)
          .map((row) => uploader.destroy(row.public_id).catch(() => {}))
      );
    }
    // 以"保留集合"判定本次插入是否留下，避免并发下两路都报成功
    return keepIds.includes(Number(photoId));
  }

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
      const clientAddedBy =
        typeof body.added_by === 'string' ? body.added_by.trim().slice(0, 30) : '';
      const addedBy = identityOr401(req, res, clientAddedBy);
      if (addedBy === null) return;

      // 配置了 CDN（Cloudinary）时上传原图、由 URL 派生缩略图；否则走数据库 base64
      if (uploader?.configured) {
        let uploaded;
        try {
          uploaded = await uploader.upload(body.full, { folder: 'shanghai-map' });
        } catch (err) {
          return res.status(502).json({ error: `照片上传失败：${err.message}` });
        }
        const photo = await store
          .createPhoto({
            placeId: id,
            mapCode: code,
            mime: full.mime,
            addedBy,
            publicId: uploaded.publicId,
            url: uploaded.url,
            thumbUrl: uploaded.thumbUrl,
          })
          .catch(async (err) => {
            // 图已传到 CDN 但入库失败：销毁远端资源，避免孤儿文件占额度（二次复核 P2-8）
            await uploader.destroy(uploaded.publicId).catch(() => {});
            throw err;
          });
        if (!(await enforcePhotoLimit(id, code, photo.id))) {
          return res.status(400).json({ error: `每个地点最多 ${MAX_PHOTOS_PER_PLACE} 张照片` });
        }
        await submitMediaCheck(photo.id, code, req.user?.openid, uploaded.url);
        res.status(201).json({ id: photo.id });
        // 新照片通知订阅者
        pusher?.notifyMap(code, {
          title: '📷 魔都·Explore 有新照片',
          body: `${addedBy || '同学'} 上传了一张照片`,
          url: `/?map=${code}&place=${id}`,
        });
        return;
      }

      // 未配置图床时缩略图必传：否则列表只能内联原图，响应体没有量级上限
      // （客户端按 /api/upload-config 的 maxThumbBytes 预算压缩后再传）
      const thumbProvided = body.thumb !== undefined && body.thumb !== null && body.thumb !== '';
      if (!thumbProvided) {
        return res.status(400).json({ error: '缺少缩略图（thumb）：未配置图床时需随原图一起上传' });
      }
      const thumb = parseImageDataUrl(body.thumb, '缩略图');
      if (thumb.error) return res.status(400).json({ error: thumb.error });
      if (thumb.bytes > MAX_THUMB_BYTES) {
        return res
          .status(400)
          .json({ error: `缩略图需小于 ${Math.floor(MAX_THUMB_BYTES / 1024)}KB，请重新选择照片` });
      }
      const thumbB64 = thumb.b64;
      const photo = await store.createPhoto({
        placeId: id,
        mapCode: code,
        mime: full.mime,
        fullB64: full.b64,
        thumbB64,
        addedBy,
      });
      if (!(await enforcePhotoLimit(id, code, photo.id))) {
        return res.status(400).json({ error: `每个地点最多 ${MAX_PHOTOS_PER_PLACE} 张照片` });
      }
      await submitMediaCheck(photo.id, code, req.user?.openid);
      res.status(201).json({ id: photo.id });
      // 新照片通知订阅者
      pusher?.notifyMap(code, {
        title: '📷 魔都·Explore 有新照片',
        body: `${addedBy || '同学'} 上传了一张照片`,
        url: `/?map=${code}&place=${id}`,
      });
    } catch (err) {
      next(err);
    }
  });

  // 原图：CDN 照片 302 到 CDN；数据库存量照片输出二进制；可长缓存
  router.get('/photos/:id', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      const photo = await store.getPhoto(id, code);
      if (!photo) return res.status(404).json({ error: '照片不存在或邀请码不匹配' });
      if (photo.url) return res.redirect(302, photo.url);
      res.set('Content-Type', photo.mime);
      res.set('Cache-Control', 'public, max-age=31536000, immutable');
      res.send(photo.buf);
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
      if (uploader?.configured && removed.public_id) {
        try {
          await uploader.destroy(removed.public_id);
        } catch {
          /* CDN 资源清理失败不阻塞删除记录 */
        }
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
