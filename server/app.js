import express from 'express';
import { createPlacesRouter } from './routes/places.js';

export function buildApp({ store, accessCode, mapConfig }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '200kb' }));

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/map-config', (req, res) => {
    if (!mapConfig || !mapConfig.key) {
      return res.status(503).json({ error: '服务端未配置高德 key（AMAP_KEY）' });
    }
    res.json({ key: mapConfig.key, securityJsCode: mapConfig.securityJsCode ?? '' });
  });

  app.use('/api/places', createPlacesRouter({ store, accessCode }));

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
