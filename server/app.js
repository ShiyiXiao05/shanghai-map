import express from 'express';
import compression from 'compression';
import { createPlacesRouter } from './routes/places.js';
import { createMapsRouter } from './routes/maps.js';
import { createPhotosRouter } from './routes/photos.js';
import { createCommentsRouter } from './routes/comments.js';
import { createItineraryRouter } from './routes/itinerary.js';

export function buildApp({ store, mapConfig, uploader }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression());
  // 3mb：照片上传的 base64 数据远大于普通 JSON 请求
  app.use(express.json({ limit: '3mb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/map-config', (req, res) => {
    if (!mapConfig || !mapConfig.key) {
      return res.status(503).json({ error: '服务端未配置高德 key（AMAP_KEY）' });
    }
    res.json({ key: mapConfig.key, securityJsCode: mapConfig.securityJsCode ?? '' });
  });

  app.use('/api/maps', createMapsRouter({ store, uploader }));
  app.use('/api/places', createPlacesRouter({ store, uploader }));
  app.use('/api', createPhotosRouter({ store, uploader }));
  app.use('/api', createCommentsRouter({ store }));
  app.use('/api/itinerary', createItineraryRouter({ store }));

  // 公共广场：无需邀请码的只读聚合（不含 map_code，不泄露各地图邀请码）
  app.get('/api/public/places', async (req, res, next) => {
    try {
      res.json({ places: await store.listPublicPlaces() });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: '接口不存在' });
  });

  app.use((err, req, res, next) => {
    if (err && err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: '请求体不是合法 JSON' });
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}
