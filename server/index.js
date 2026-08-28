import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import './env.js';
import { buildApp } from './app.js';
import { placeStore as productionStore, createPlaceStore } from './store.js';

async function resolveStore() {
  if (productionStore) return productionStore;
  if (process.env.NODE_ENV === 'production') {
    console.error('缺少 DATABASE_URL：请在环境变量中配置 Neon 连接串');
    process.exit(1);
  }
  const { newDb } = await import('pg-mem');
  const pgLib = newDb().adapters.createPg();
  const store = createPlaceStore(new pgLib.Pool());
  console.warn('未配置 DATABASE_URL：本次运行使用内存数据库，重启后数据清空（仅建议本地体验）');
  return store;
}

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, '..', 'public');

const store = await resolveStore();
await store.init();

const app = buildApp({
  store,
  mapConfig: { key: process.env.AMAP_KEY, securityJsCode: process.env.AMAP_SECURITY_CODE },
});
app.use(
  express.static(publicDir, {
    // HTML/SW/manifest 协商缓存；其余静态资源 10 分钟强缓存（发版后过期上限可控）
    maxAge: '10m',
    setHeaders(res, filePath) {
      const base = path.basename(filePath);
      if (filePath.endsWith('.html') || base === 'sw.js' || base === 'manifest.webmanifest') {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  })
);

const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`上海地点地图已启动：http://localhost:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
