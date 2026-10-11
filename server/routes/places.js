import { Router } from 'express';
import { CATEGORIES } from '../store.js';
import { identityOr401 } from './identity.js';
import { guardTexts } from '../content-security.js';

const LIMITS = {
  name: 100,
  description: 500,
  address: 200,
  added_by: 30,
  price_hint: 50,
  hours: 100,
  tags: 100,
  emoji: 32,
};

function readString(value, field, { fallback = '' } = {}) {
  if (value === undefined || value === null) {
    return fallback === null ? { error: `${field}不能为空` } : { value: fallback };
  }
  if (typeof value !== 'string') {
    return { error: `${field}必须是字符串` };
  }
  const trimmed = value.trim();
  if (trimmed.length > LIMITS[field]) {
    return { error: `${field}长度不能超过 ${LIMITS[field]} 字` };
  }
  return { value: trimmed };
}

function readCoord(value, field) {
  const range = field === 'lng' ? 180 : 90;
  const error = { error: `${field}必须是 ${-range} ~ ${range} 之间的数字` };
  // 只接受数字或纯数字字符串：null / false / '' 过去会被 Number() 静默转成 0 并入库
  let num;
  if (typeof value === 'number') num = value;
  else if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) num = Number(value.trim());
  else return error;
  if (!Number.isFinite(num) || Math.abs(num) > range) return error;
  return { value: num };
}

function validatePlace(body, { partial }) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { error: '请求体必须是 JSON 对象' };
  }

  const out = {};
  const fail = (error) => ({ error });

  if (!partial || body.name !== undefined) {
    const name = readString(body.name, 'name', { fallback: null });
    if (name.error) return fail(name.error);
    if (!name.value) return fail('名称不能为空');
    out.name = name.value;
  }
  if (body.description !== undefined) {
    const description = readString(body.description, 'description');
    if (description.error) return fail(description.error);
    out.description = description.value;
  }
  for (const field of ['price_hint', 'hours', 'tags', 'emoji']) {
    if (body[field] !== undefined) {
      const checked = readString(body[field], field);
      if (checked.error) return fail(checked.error);
      out[field] = checked.value;
      if (field === 'emoji' && checked.value &&
          (!/^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[0-9#*]\uFE0F?\u20E3)/u.test(checked.value) ||
           [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(checked.value)].length !== 1)) {
        return fail('请选择一个 emoji');
      }
    }
  }
  if (!partial || body.category !== undefined) {
    if (!CATEGORIES.includes(body.category)) {
      return fail(`分类必须是以下之一：${CATEGORIES.join('、')}`);
    }
    out.category = body.category;
  }
  if (!partial || body.lng !== undefined) {
    const lng = readCoord(body.lng, 'lng');
    if (lng.error) return fail(lng.error);
    out.lng = lng.value;
  }
  if (!partial || body.lat !== undefined) {
    const lat = readCoord(body.lat, 'lat');
    if (lat.error) return fail(lat.error);
    out.lat = lat.value;
  }
  if (body.address !== undefined) {
    const address = readString(body.address, 'address');
    if (address.error) return fail(address.error);
    out.address = address.value;
  }
  if (body.added_by !== undefined) {
    const addedBy = readString(body.added_by, 'added_by');
    if (addedBy.error) return fail(addedBy.error);
    out.added_by = addedBy.value;
  }
  if (body.visited !== undefined) {
    if (typeof body.visited !== 'boolean') return fail('visited 必须是布尔值');
    out.visited = body.visited;
  }

  if (partial && Object.keys(out).length === 0) {
    return fail('没有可更新的字段');
  }
  return { value: out };
}

function parseId(raw) {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

export function createPlacesRouter({ store, uploader, pusher, contentSecurity }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      if ((req.query.view ?? '') === 'trash') {
        // 打开回收站时顺带彻底清理软删超 30 天的地点（惰性过期）
        const expiredPublicIds = await store.purgeExpired(code);
        if (uploader?.configured && expiredPublicIds.length > 0) {
          await Promise.all(
            expiredPublicIds.map((publicId) =>
              uploader.destroy(publicId).catch(() => {
                /* 单张销毁失败不阻塞 */
              })
            )
          );
        }
        return res.json({ places: await store.listTrash(code) });
      }
      res.json({ places: await store.listPlaces(code) });
    } catch (err) {
      next(err);
    }
  });

  // 从回收站恢复地点（软删除 30 天内）
  router.post('/:id/restore', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const code = typeof req.body?.map_code === 'string' ? req.body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const place = await store.restorePlace(id, code);
      if (!place) return res.status(404).json({ error: '回收站里没有这个地点' });
      res.json(place);
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const code = typeof req.body?.map_code === 'string' ? req.body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const checked = validatePlace(req.body, { partial: false });
      if (checked.error) return res.status(400).json({ error: checked.error });
      // 去重：同一张地图里已有同名地点 → 409 拒绝，避免误点两次/重复导入。
      // 容错：去重只是保护措施，它自己出问题（方法缺失/数据库抖动）绝不能挡住正常添加，
      // 因此整体 try/catch 后按"不重复"继续。
      let duplicate = null;
      let trashed = null;
      try {
        ({ duplicate, trashed } = await store.findDuplicatePlace(code, {
          name: checked.value.name,
        }));
      } catch (err) {
        console.warn('[places] 去重检查失败，按不重复处理：', err?.message ?? err);
      }
      if (duplicate) {
        return res.status(409).json({
          error: `地图里已经有「${duplicate.name}」了`,
          code: 'DUPLICATE_PLACE',
          duplicate: { id: Number(duplicate.id), name: duplicate.name },
          trashed: trashed ? { id: Number(trashed.id), name: trashed.name } : null,
        });
      }
      // 内容安全：UGC 文本写入前先过一遍微信内容检测（未配置时自动跳过）
      const guard = await guardTexts(
        contentSecurity,
        [
          ['名称', checked.value.name],
          ['描述', checked.value.description],
          ['地址', checked.value.address],
          ['标签', checked.value.tags],
        ],
        { openid: req.user?.openid }
      );
      if (guard.error) return res.status(400).json({ error: guard.error });
      const addedBy = identityOr401(req, res, checked.value.added_by);
      if (addedBy === null) return;
      const place = await store.create({ ...checked.value, added_by: addedBy, map_code: code });
      res.status(201).json(place);
      // 新地点通知订阅者（异步广播，不影响响应；自己订阅的也会收到一条轻提醒）
      pusher?.notifyMap(code, {
        title: '📍 魔都·Explore 有新地点',
        body: `${place.added_by || '同学'} 添加了「${place.name}」`,
        url: `/?map=${code}&place=${place.id}`,
      });
    } catch (err) {
      next(err);
    }
  });

  // 「我也想去」切换式投票
  router.post('/:id/wish', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const code = typeof body.map_code === 'string' ? body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      const clientWho = typeof body.who === 'string' ? body.who.trim().slice(0, 30) : '';
      const who = identityOr401(req, res, clientWho);
      if (who === null) return;
      if (!who) return res.status(400).json({ error: '需要昵称（who）才能投票' });
      if (!(await store.getPlace(id, code))) {
        return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      }
      const { wished } = await store.toggleWish(id, code, who);
      res.json({ wished, wishes: await store.listWishes(id, code) });
    } catch (err) {
      next(err);
    }
  });

  // 公开/取消公开到公共广场
  router.post('/:id/public', async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const code = typeof body.map_code === 'string' ? body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      const result = await store.togglePublic(id, code);
      if (!result) return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      res.json({ is_public: result.is_public });
    } catch (err) {
      next(err);
    }
  });

  const requireMapCode = (req, res, next) => {
    const code = (req.get('x-map-code') ?? '').trim().toUpperCase();
    if (!code) return res.status(400).json({ error: '缺少邀请码（x-map-code）' });
    req.mapCode = code;
    next();
  };

  router.put('/:id', requireMapCode, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const checked = validatePlace(req.body, { partial: true });
      if (checked.error) return res.status(400).json({ error: checked.error });
      const guard = await guardTexts(
        contentSecurity,
        [
          ['名称', checked.value.name],
          ['描述', checked.value.description],
          ['地址', checked.value.address],
          ['标签', checked.value.tags],
        ],
        { openid: req.user?.openid }
      );
      if (guard.error) return res.status(400).json({ error: guard.error });
      // 已登录时编辑不改原作者：忽略客户端传的 added_by（编辑本身不记录昵称）
      if (req.user && checked.value.added_by !== undefined) delete checked.value.added_by;
      const place = await store.update(id, req.mapCode, checked.value);
      if (!place) return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      res.json(place);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requireMapCode, async (req, res, next) => {
    try {
      const id = parseId(req.params.id);
      if (id === null) return res.status(400).json({ error: 'id 必须是正整数' });
      const removed = await store.remove(id, req.mapCode);
      if (!removed) return res.status(404).json({ error: '地点不存在或邀请码不匹配' });
      // 软删除：照片/CDN 原样保留，30 天内可在回收站恢复；超期清理在回收站打开时触发
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
