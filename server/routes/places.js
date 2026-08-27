import { Router } from 'express';
import { CATEGORIES } from '../store.js';

const LIMITS = { name: 100, description: 500, address: 200, added_by: 30 };

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
  const num = typeof value === 'number' ? value : Number(value);
  const range = field === 'lng' ? 180 : 90;
  if (!Number.isFinite(num) || Math.abs(num) > range) {
    return { error: `${field}必须是 ${-range} ~ ${range} 之间的数字` };
  }
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

export function createPlacesRouter({ store }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      res.json({ places: await store.listPlaces(code) });
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
      const place = await store.create({ ...checked.value, map_code: code });
      res.status(201).json(place);
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
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
