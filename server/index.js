import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import './env.js';
import { buildApp } from './app.js';
import { placeStore as productionStore, createPlaceStore } from './store.js';
import { createCloudinaryUploader } from './uploader.js';
import { createPusher } from './pusher.js';

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

const uploader = createCloudinaryUploader(process.env.CLOUDINARY_URL);
if (!uploader.configured) {
  console.warn('未配置 CLOUDINARY_URL：照片将存入数据库（占用 Neon 存储，建议配置免费图床）');
}

const pusher = createPusher({
  publicKey: process.env.VAPID_PUBLIC_KEY,
  privateKey: process.env.VAPID_PRIVATE_KEY,
  subject: process.env.VAPID_SUBJECT,
  store,
});
if (!pusher.configured) {
  console.warn('未配置 VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY：Web Push 通知停用（配置后自动启用）');
}

const app = buildApp({
  store,
  mapConfig: { key: process.env.AMAP_KEY, securityJsCode: process.env.AMAP_SECURITY_CODE },
  uploader,
  pusher,
});
app.use(
  express.static(publicDir, {
    // 页面与代码资源走 ETag 协商缓存（发布即生效，304 开销极小）；仅图标长缓存
    etag: true,
    setHeaders(res, filePath) {
      if (filePath.includes(`${path.sep}icons${path.sep}`)) {
        res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
      } else {
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
