import express from 'express';
import compression from 'compression';
import { createPlacesRouter } from './routes/places.js';
import { createMapsRouter } from './routes/maps.js';
import { createPhotosRouter, MAX_FULL_BYTES, MAX_THUMB_BYTES } from './routes/photos.js';
import { createCommentsRouter } from './routes/comments.js';
import { createItineraryRouter } from './routes/itinerary.js';
import { createPushRouter } from './routes/push.js';
import { createAuthRouter } from './routes/auth.js';
import { createApiRateLimiters } from './ratelimit.js';
import { createContentSecurity } from './content-security.js';
import { createReportsRouter } from './routes/reports.js';
import { createWechatRouter } from './routes/wechat.js';
import { createGeoRouter } from './routes/geo.js';

export function buildApp({ store, mapConfig, uploader, pusher, auth, contentSecurity, geo }) {
  const app = express();
  // 未显式注入时：有 AppID/Secret 就启用内容安全，否则整体停用（写入不受影响）
  const security =
    contentSecurity ??
    createContentSecurity({
      appid: process.env.MINIPROGRAM_APPID,
      secret: process.env.MINIPROGRAM_SECRET,
      enabled: process.env.CONTENT_SECURITY !== 'off',
    });
  app.disable('x-powered-by');

  // 基础安全响应头（不引入 helmet 依赖）。
  // 注意：本轮刻意不加 CSP——网页端依赖高德 JS SDK、内联主题脚本与 data: 图片，
  // 策略写错会直接打挂地图，需浏览器实测后再灰度上线（见审计报告 F-12）。
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=()');
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    next();
  });

  app.use(compression());
  // /api 限流：先于 body 解析，避免超大请求绕过计数（读 600/分、写 120/分，按 IP）
  app.use('/api', createApiRateLimiters());
  // 3mb：照片上传的 base64 数据远大于普通 JSON 请求
  app.use(express.json({ limit: '3mb' }));
  // 微信「消息推送」若把数据格式选成 XML：保留原始文本，由回调路由做兜底解析
  app.use(
    express.text({
      type: (req) => /xml/i.test(req.headers['content-type'] || ''),
      limit: '64kb',
    })
  );

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  // 就绪探针：/api/health 只代表进程活着；这里额外确认数据库可用（监控用，不改 Render 健康检查语义）
  app.get('/api/ready', async (req, res) => {
    let timer;
    try {
      await Promise.race([
        store.ping(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('数据库检查超时')), 3000);
        }),
      ]);
      res.json({ ok: true, db: 'up' });
    } catch (err) {
      res.status(503).json({ ok: false, db: 'down', error: err?.message ?? '数据库不可用' });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get('/api/map-config', (req, res) => {
    if (!mapConfig || !mapConfig.key) {
      return res.status(503).json({ error: '服务端未配置高德 key（AMAP_KEY）' });
    }
    res.json({ key: mapConfig.key, securityJsCode: mapConfig.securityJsCode ?? '' });
  });

  // 上传能力协商：客户端据此决定压缩目标，以及是否需要额外上传缩略图。
  // cdn=true（配了图床）时服务端自行派生缩略图，客户端只传 full 即可——
  // 这对小程序尤其重要：callContainer 请求体上限 100K，多传一份 thumb 会直接超限。
  app.get('/api/upload-config', (req, res) => {
    res.json({
      cdn: Boolean(uploader?.configured),
      maxFullBytes: MAX_FULL_BYTES,
      maxThumbBytes: MAX_THUMB_BYTES,
    });
  });

  // 小程序登录：先挂身份中间件（解析 Bearer token → req.user），再挂 /api/auth
  if (auth) {
    app.use('/api', auth.middleware());
    app.use('/api/auth', createAuthRouter({ auth, store, contentSecurity: security }));
  }

  // 地点关键词搜索：服务端代理高德（小程序端不需要 key，也不用给它加请求域名）。
  // 挂在全局 /api 限流与 express.json 之后、/api 404 兜底之前，且不在其它路由的前缀下。
  // amapKey 必须是高德「Web服务」类型的 key（AMAP_WEB_SERVICE_KEY）：
  // 网页版那个 JS API key 会返回 USERKEY_PLAT_NOMATCH
  app.use('/api/geo', createGeoRouter({ amapKey: geo?.amapKey, fetchImpl: geo?.fetchImpl }));

  app.use('/api/maps', createMapsRouter({ store, uploader }));
  app.use('/api/places', createPlacesRouter({ store, uploader, pusher, contentSecurity: security }));
  app.use('/api', createPhotosRouter({ store, uploader, pusher, contentSecurity: security }));
  app.use('/api', createCommentsRouter({ store, pusher, contentSecurity: security }));
  app.use('/api/itinerary', createItineraryRouter({ store }));
  app.use('/api/push', createPushRouter({ store, pusher }));
  app.use('/api/reports', createReportsRouter({ store }));
  // 微信「消息推送」回调（mediaCheckAsync 审核结果）：签名校验在路由内完成
  app.use('/api/wechat', createWechatRouter({ store, contentSecurity: security }));

  // 公共广场：无需邀请码的只读聚合（不含 map_code，不泄露各地图邀请码）
  app.get('/api/public/places', async (req, res, next) => {
    try {
      res.json({ places: await store.listPublicPlaces() });
    } catch (err) {
      next(err);
    }
  });

  // 公共广场单个地点：供小程序详情页在"冷启动直达 / 无邀请码"时读取只读数据
  app.get('/api/public/places/:id', async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'id 必须是正整数' });
      }
      const place = await store.getPublicPlace(id);
      if (!place) return res.status(404).json({ error: '地点不存在或未公开' });
      res.json({ place });
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
    // body 超过 express.json 的 3mb 上限：给 413 与可操作提示，而不是笼统的 500
    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({ error: '上传内容过大，请压缩图片后重试' });
    }
    console.error(err);
    res.status(500).json({ error: '服务器内部错误' });
  });

  return app;
}
