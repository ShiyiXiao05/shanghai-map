import { Router } from 'express';

const MAX_STOPS = 50;

export function createItineraryRouter({ store }) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const code = (req.query.map ?? '').toString().trim().toUpperCase();
      if (!code) return res.status(400).json({ error: '缺少 map 参数（邀请码）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      res.json({ stops: await store.listItinerary(code) });
    } catch (err) {
      next(err);
    }
  });

  // 全量替换：place_ids 数组顺序即行程顺序，增删/重排/清空都走这一个接口
  router.put('/', async (req, res, next) => {
    try {
      const code = typeof req.body?.map_code === 'string' ? req.body.map_code.trim().toUpperCase() : '';
      if (!code) return res.status(400).json({ error: '缺少邀请码（map_code）' });
      if (!(await store.getMapByCode(code))) {
        return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      }
      const ids = req.body.place_ids;
      if (!Array.isArray(ids)) {
        return res.status(400).json({ error: 'place_ids 必须是地点 id 数组' });
      }
      if (ids.length > MAX_STOPS) {
        return res.status(400).json({ error: `行程最多 ${MAX_STOPS} 站` });
      }
      if (ids.some((v) => !Number.isSafeInteger(v) || v <= 0)) {
        return res.status(400).json({ error: 'place_ids 里必须是正整数地点 id' });
      }
      res.json({ stops: await store.setItinerary(code, ids) });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
