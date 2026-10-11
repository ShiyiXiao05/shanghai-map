import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import './env.js';
import { buildApp } from './app.js';
import { placeStore as productionStore, createPlaceStore } from './store.js';
import { createCloudinaryUploader } from './uploader.js';
import { createPusher } from './pusher.js';
import { createAuth } from './auth.js';
import { createContentSecurity } from './content-security.js';

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

const auth = createAuth({
  appid: process.env.MINIPROGRAM_APPID,
  secret: process.env.MINIPROGRAM_SECRET,
  signSecret: process.env.AUTH_SECRET,
  store,
});
if (!auth.configured) {
  console.warn('未配置 MINIPROGRAM_APPID/MINIPROGRAM_SECRET：小程序登录停用（配置后自动启用）');
}
if (auth.ephemeralSecret) {
  console.warn('未配置 AUTH_SECRET：登录 token 重启后失效，生产环境建议配置');
}

const contentSecurity = createContentSecurity({
  appid: process.env.MINIPROGRAM_APPID,
  secret: process.env.MINIPROGRAM_SECRET,
  // mp 后台「消息推送」的 Token：配置后才启用图片异步审核（回调走 /api/wechat/media-check-callback）
  msgToken: process.env.WECHAT_MSG_TOKEN,
  // 需要临时关闭时设 CONTENT_SECURITY=off（例如微信接口故障期间）
  enabled: process.env.CONTENT_SECURITY !== 'off',
});
if (contentSecurity.configured) {
  console.log(
    `内容安全：文本检测已启用（msgSecCheck）${contentSecurity.mediaCheckEnabled ? '；图片异步审核已启用（mediaCheckAsync）' : '；图片异步审核未启用（缺少 WECHAT_MSG_TOKEN）'}`
  );
} else {
  console.warn('未配置 MINIPROGRAM_APPID/MINIPROGRAM_SECRET：内容安全检测停用');
}

const app = buildApp({
  store,
  mapConfig: { key: process.env.AMAP_KEY, securityJsCode: process.env.AMAP_SECURITY_CODE },
  uploader,
  pusher,
  auth,
  contentSecurity,
  // 地点搜索代理：key 只留在服务端，小程序端不配置、也不加请求域名。
  // 用「Web 服务」类型的 key：本地实测 AMAP_KEY 是「Web端(JS API)」key，
  // 直接调 restapi.amap.com 会返回 status=0 / USERKEY_PLAT_NOMATCH（502）；
  // AMAP_WEB_SERVICE_KEY 才可用。线上若只有 AMAP_KEY，请在其为 Web 服务类型或补配该变量。
  geo: { amapKey: process.env.AMAP_WEB_SERVICE_KEY || process.env.AMAP_KEY },
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

// 请求级异常不应终止进程：Express 4 不会捕获 async 中间件/路由的 Promise 拒绝，
// 过去一次数据库抖动就会让服务崩溃重启（审计 F-07）。未捕获异常仍然退出，交给平台重启。
process.on('unhandledRejection', (err) => {
  console.error('[unhandledRejection]', err);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException] 进程即将退出：', err);
  process.exit(1);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
