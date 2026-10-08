// 轻量内存限流：按客户端 IP 计数，固定窗口。
// 单实例内存实现，够用且零依赖；多实例时需要换成共享存储（Redis 等）。
//
// IP 取值：优先取 X-Forwarded-For 最左侧（原始客户端），否则用 socket 地址。
// 说明：XFF 可被伪造，因此限流只能防"脚本顺手刷"，不能防有意的分布式攻击；
// 但比完全不限流安全得多，且不会把 Cloudflare 之后的真实用户误判成同一个 IP。

const MAX_KEYS = 5000; // 防止 Map 无限增长

function clientIp(req) {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  return req.socket?.remoteAddress ?? 'unknown';
}

function prune(hits, now) {
  if (hits.size <= MAX_KEYS) return;
  for (const [key, entry] of hits) {
    if (entry.resetAt <= now) hits.delete(key);
    if (hits.size <= MAX_KEYS / 2) break;
  }
}

/**
 * @param {{ windowMs?: number, max: number, message?: string }} options
 */
export function createRateLimiter({ windowMs = 60_000, max, message } = {}) {
  const hits = new Map();
  return function rateLimiter(req, res, next) {
    const now = Date.now();
    const key = clientIp(req);
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      const retryAfter = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: message ?? '请求过于频繁，请稍后再试' });
    }
    prune(hits, now);
    return next();
  };
}

/** 给整个 /api 挂上"读/写"两档限流（限值刻意宽松，避免误伤正常用户）。 */
export function createApiRateLimiters() {
  const read = createRateLimiter({ max: 600, message: '请求过于频繁，请稍后再试' });
  const write = createRateLimiter({ max: 120, message: '操作过于频繁，请稍后再试' });
  return (req, res, next) => (req.method === 'GET' || req.method === 'HEAD' ? read : write)(req, res, next);
}

export const limiters = {
  // 建图：匿名可用，必须限得最严
  createMap: () => createRateLimiter({ max: 30, message: '创建地图过于频繁，请稍后再试' }),
  login: () => createRateLimiter({ max: 30, message: '登录请求过于频繁，请稍后再试' }),
  // 邀请码探测：错误码尝试超过阈值直接拒绝
  probe: () => createRateLimiter({ max: 120, message: '请求过于频繁，请稍后再试' }),
  // 举报：单 IP 10 分钟最多 10 次，防止刷举报
  report: () => createRateLimiter({ windowMs: 10 * 60_000, max: 10, message: '举报过于频繁，请稍后再试' }),
};
