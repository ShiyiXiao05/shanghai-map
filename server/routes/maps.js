import { Router } from 'express';

export function createMapsRouter({ store }) {
  const router = Router();

  router.post('/', async (req, res, next) => {
    try {
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: '地图名称不能为空' });
      if (name.length > 40) return res.status(400).json({ error: '地图名称不能超过 40 字' });
      const createdBy = typeof body.createdBy === 'string' ? body.createdBy.trim().slice(0, 30) : '';
      const map = await store.createMap({ name, createdBy });
      res.status(201).json(map);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:code', async (req, res, next) => {
    try {
      const code = (req.params.code ?? '').trim().toUpperCase();
      const map = await store.getMapByCode(code);
      if (!map) return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      res.json(map);
    } catch (err) {
      next(err);
    }
  });

  return router;
}
