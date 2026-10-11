// 地点关键词搜索：服务端代理高德「关键字搜索」Web 服务。
// 为什么要代理：小程序端没有配置腾讯/高德的小程序 key，也不想往 mp 后台加请求域名，
// 而服务端本来就有高德 key。于是搜索统一走本服务，key 只留在服务端。
// 注意：必须用「Web服务」类型的 key（AMAP_WEB_SERVICE_KEY）；网页端那个 JS API key
// 调 restapi 会返回 USERKEY_PLAT_NOMATCH。
// 成本控制：按 IP 限流 + 5 分钟内存缓存，避免用户连点把高德配额刷爆。
import { Router } from 'express';
import { createRateLimiter } from '../ratelimit.js';

const AMAP_TEXT_URL = 'https://restapi.amap.com/v3/place/text';
const DEFAULT_CITY = '上海'; // 与「魔都 Explore」的默认城市一致
const MAX_KEYWORD = 50;
const MAX_CITY = 20;
const MAX_RESULTS = 10;
const UPSTREAM_TIMEOUT_MS = 5000;
const CACHE_TTL_MS = 5 * 60_000;
const CACHE_MAX = 200; // 超出后先清最旧（Map 的插入序即时间序）
const UPSTREAM_ERROR = '地点搜索暂时不可用，请稍后再试';

// 高德 business 层错误 → 可操作的排查提示（写进日志，不回传给客户端，避免泄漏 key/内部信息）
const AMAP_HINTS = {
  USERKEY_PLAT_NOMATCH:
    'key 的服务平台不匹配：本站需要「Web服务」类型的 key（现有的 JS API key 不能用于 REST 接口），请在高德控制台新建后配置 AMAP_WEB_SERVICE_KEY',
  INVALID_USER_KEY: 'key 无效或已被删除，请检查 AMAP_WEB_SERVICE_KEY',
  SERVICE_NOT_AVAILABLE: '该 key 未开通「Web服务」平台，请在高德控制台调整',
  DAILY_QUERY_OVER_LIMIT: '高德当日调用量已用完，请稍后再试或提高配额',
  INVALID_USER_SCODE: '缺少安全密钥：Web服务 key 无需 securityJsCode，请确认配置的是 Web服务 key',
};

/** 上游响应是否可用：兼容注入了只带 status / 只带 ok 的测试替身。 */
function upstreamOk(response) {
  if (!response) return false;
  if (typeof response.status === 'number') return response.status === 200;
  return response.ok !== false;
}

/** "lng,lat" → { lng, lat }；任何非有限数都视为非法（跳过该条）。 */
function parseLocation(raw) {
  const [lngText, latText] = String(raw ?? '').split(',');
  // 注意 Number('') === 0：必须显式排除空串，否则 "121.5," 会被当成纬度 0
  if (!lngText?.trim() || !latText?.trim()) return null;
  const lng = Number(lngText);
  const lat = Number(latText);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/** 高德 POI → 前端契约字段；坐标非法的条目返回 null。 */
function mapPoi(poi) {
  if (!poi || typeof poi !== 'object') return null;
  const point = parseLocation(poi.location);
  if (!point) return null;
  // 兜底地址：高德部分 POI（尤其景区内的点）address 为空，用 城市+区 拼一个可读地址
  const address = poi.address || [poi.cityname, poi.adname].filter(Boolean).join('');
  return {
    id: poi.id ?? '',
    name: poi.name ?? '',
    address,
    lng: point.lng,
    lat: point.lat,
    category: poi.type ?? '',
  };
}

/**
 * @param {{ amapKey?: string, fetchImpl?: typeof fetch }} options
 *   amapKey  服务端持有的高德 Web 服务 key（缺失时接口整体 503）
 *   fetchImpl 可注入的 fetch（测试用；不传则用全局 fetch）
 */
export function createGeoRouter({ amapKey, fetchImpl } = {}) {
  const router = Router();
  const doFetch = fetchImpl ?? fetch;
  // 搜索是高德配额消耗大户：单 IP 每分钟 30 次（参数名与 ratelimit.js 现有 limiter 一致）
  const searchLimiter = createRateLimiter({ max: 30, message: '搜索过于频繁，请稍后再试' });
  const cache = new Map(); // `${city}:${keyword}` → { at, places }

  function readCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.at > CACHE_TTL_MS) {
      cache.delete(key);
      return null;
    }
    return entry.places;
  }

  function writeCache(key, places) {
    cache.set(key, { at: Date.now(), places });
    while (cache.size > CACHE_MAX) {
      // Map 迭代按插入顺序：第一个即最旧
      const oldest = cache.keys().next();
      if (oldest.done) break;
      cache.delete(oldest.value);
    }
  }

  router.get('/search', searchLimiter, async (req, res, next) => {
    try {
      if (!amapKey) {
        // 契约（与 /api/map-config 同风格）：客户端只看这句，具体该配哪个变量写在日志与注释里
        // 注意：网页版用的 JS API key 不能用于本接口，这里必须是「Web服务」类型的 key
        console.warn('[geo] 未配置地点搜索 key：请配置 AMAP_WEB_SERVICE_KEY（高德「Web服务」类型 key）');
        // 客户端文案不带变量名（用户看不懂也没法处理），该配哪个变量在上一行日志里
        return res.status(503).json({ error: '地点搜索暂未开通' });
      }
      const keyword = String(req.query.keyword ?? '').trim();
      if (!keyword || keyword.length > MAX_KEYWORD) {
        return res.status(400).json({ error: '请输入要搜索的地点名称' });
      }
      const city = (String(req.query.city ?? '').trim() || DEFAULT_CITY).slice(0, MAX_CITY);

      const cacheKey = `${city}:${keyword}`;
      const cached = readCache(cacheKey);
      if (cached) return res.json({ places: cached, source: 'amap' });

      // 与高德 Web 服务契约一致的固定参数：citylimit 只搜指定城市，extensions=base 拿基础字段
      const url =
        `${AMAP_TEXT_URL}?key=${encodeURIComponent(amapKey)}` +
        `&keywords=${encodeURIComponent(keyword)}` +
        `&city=${encodeURIComponent(city)}` +
        `&citylimit=true&offset=${MAX_RESULTS}&page=1&extensions=base`;

      // 实测 Render(新加坡) → 高德(国内) 偶发抖动（约每 6 次 1 次失败），
      // 因此瞬时失败（网络异常 / 超时 / HTTP 非 200）重试一次再放弃；
      // 业务层错误（status!=='1'）不重试：那是确定性的（配额、key 类型）。
      let upstream = null;
      let lastError = 'unknown';
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          // 5s 超时：高德抖动时宁可让用户改用地图点选，也不让请求悬着
          const response = await doFetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
          if (upstreamOk(response)) {
            upstream = response;
            break;
          }
          lastError = `HTTP ${response?.status ?? 'unknown'}`;
        } catch (err) {
          // 注意：日志不要带 url（含 key）
          lastError = err?.name === 'TimeoutError' ? '超时' : err?.message ?? String(err);
        }
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!upstream) {
        console.warn('[geo] 高德搜索两次都失败：', lastError);
        return res.status(502).json({ error: UPSTREAM_ERROR });
      }

      let data;
      try {
        data = await upstream.json();
      } catch (err) {
        console.warn('[geo] 高德搜索响应解析失败：', err?.message ?? err);
        return res.status(502).json({ error: UPSTREAM_ERROR });
      }

      // 高德用 status:'1' 表示成功；business 层错误（配额、key 失效）走 status:'0'
      if (!data || data.status !== '1') {
        const info = String(data?.info ?? data?.infocode ?? 'unknown');
        const hint = AMAP_HINTS[info];
        console.warn(`[geo] 高德搜索返回错误：${info}${hint ? ` — ${hint}` : ''}`);
        return res.status(502).json({ error: UPSTREAM_ERROR });
      }

      const pois = Array.isArray(data.pois) ? data.pois : [];
      const places = [];
      for (const poi of pois) {
        const place = mapPoi(poi);
        if (place) places.push(place);
        if (places.length >= MAX_RESULTS) break;
      }

      writeCache(cacheKey, places);
      res.json({ places, source: 'amap' });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
