import { Router } from 'express';

export function createMapsRouter({ store, uploader }) {
  const router = Router();

  // 回忆时间线：已打卡地点 + 缩略图（要放在 /:code 之前定义更清晰）
  router.get('/:code/memories', async (req, res, next) => {
    try {
      const code = (req.params.code ?? '').trim().toUpperCase();
      const map = await store.getMapByCode(code);
      if (!map) return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      res.json({ memories: await store.listMemories(code) });
    } catch (err) {
      next(err);
    }
  });

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

  // 以下地图管理操作均以「持有邀请码」为权限（与整体模型一致）

  router.put('/:code', async (req, res, next) => {
    try {
      const code = (req.params.code ?? '').trim().toUpperCase();
      const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (!name) return res.status(400).json({ error: '地图名称不能为空' });
      if (name.length > 40) return res.status(400).json({ error: '地图名称不能超过 40 字' });
      const map = await store.renameMap(code, name);
      if (!map) return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      res.json(map);
    } catch (err) {
      next(err);
    }
  });

  // 换邀请码（权限重置）：旧码立即失效
  router.post('/:code/rekey', async (req, res, next) => {
    try {
      const code = (req.params.code ?? '').trim().toUpperCase();
      const map = await store.rekeyMap(code);
      if (!map) return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      res.json(map);
    } catch (err) {
      next(err);
    }
  });

  // 全量导出：JSON 备份（知道邀请码即可导出，与权限模型一致）
  router.get('/:code/export', async (req, res, next) => {
    try {
      const code = (req.params.code ?? '').trim().toUpperCase();
      const data = await store.exportMap(code);
      if (!data) return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      res.json(data);
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:code', async (req, res, next) => {
    try {
      const code = (req.params.code ?? '').trim().toUpperCase();
      const removed = await store.deleteMap(code);
      if (!removed) return res.status(404).json({ error: '邀请码不存在，检查一下再试' });
      // 级联销毁 CDN 资源，避免删图后云上照片成孤儿
      if (uploader?.configured && removed.photoPublicIds.length > 0) {
        await Promise.all(
          removed.photoPublicIds.map((publicId) =>
            uploader.destroy(publicId).catch(() => {
              /* 单张销毁失败不阻塞删图 */
            })
          )
        );
      }
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
}
