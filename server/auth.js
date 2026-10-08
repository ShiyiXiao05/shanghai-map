import crypto from 'node:crypto';

// 小程序登录：wx.login 的 code 换 openid（code2Session），HMAC 签名 token。
// 未配置 MINIPROGRAM_APPID/SECRET 时整体停用（登录接口 503），与 pusher/uploader 的降级风格一致。
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

export function createAuth({ appid, secret, signSecret, store, fetchSession }) {
  const configured = Boolean(appid && secret);
  // AUTH_SECRET 未配置时退化为进程内随机密钥：token 重启即失效，仅本地可接受
  const ephemeralSecret = configured && !signSecret;
  const hmacKey = signSecret || crypto.randomBytes(32).toString('base64url');

  const exchangeCode =
    fetchSession ??
    (async (code) => {
      const url =
        'https://api.weixin.qq.com/sns/jscode2session' +
        `?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}` +
        `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
      // 登录接口也要有超时：微信侧慢时不能让写请求无限等待
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const data = await res.json();
      if (data.errcode) {
        const err = new Error(data.errmsg || `微信登录失败（${data.errcode}）`);
        err.status = 502;
        throw err;
      }
      if (!data.openid) {
        const err = new Error('微信登录未返回 openid');
        err.status = 502;
        throw err;
      }
      return { openid: data.openid };
    });

  const b64u = (buf) => buf.toString('base64url');
  const signBody = (body) => b64u(crypto.createHmac('sha256', hmacKey).update(body).digest());

  function signToken(openid) {
    const body = b64u(Buffer.from(JSON.stringify({ o: openid, exp: Date.now() + TOKEN_TTL_MS })));
    return `${body}.${signBody(body)}`;
  }

  function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const [body, sig] = token.split('.');
    if (!body || !sig) return null;
    const expect = Buffer.from(signBody(body));
    const got = Buffer.from(sig);
    if (expect.length !== got.length || !crypto.timingSafeEqual(expect, got)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
      if (typeof payload.o !== 'string' || typeof payload.exp !== 'number') return null;
      if (payload.exp < Date.now()) return null;
      return payload;
    } catch {
      return null;
    }
  }

  async function login(code) {
    const { openid } = await exchangeCode(code);
    const user = await store.ensureUser(openid);
    return { token: signToken(openid), nickname: user.nickname, needs_nickname: !user.nickname };
  }

  // 身份中间件：带合法 Bearer token 的请求挂 req.user；写请求带失效 token 一律 401 触发重登，
  // 读请求带失效 token 视为匿名（网页端永远不带 token，行为不变）
  function middleware() {
    return async (req, res, next) => {
      if (req.path === '/auth/login') return next();
      const header = req.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) return next();
      let user = null;
      try {
        const payload = verifyToken(token);
        user = payload ? await store.getUser(payload.o) : null;
      } catch (err) {
        // Express 4 不捕获 async 中间件的拒绝，未处理会终止整个进程；
        // 数据库瞬时故障时：读请求按匿名放行，写请求回 503 让客户端重试
        console.error('[auth] 解析登录态失败：', err?.message ?? err);
        if (req.method !== 'GET') {
          return res.status(503).json({ error: '服务暂时不可用，请稍后重试' });
        }
        return next();
      }
      if (user) {
        req.user = user;
        return next();
      }
      if (req.method !== 'GET') {
        return res.status(401).json({ error: '登录已过期，请重新操作', code: 'AUTH_EXPIRED' });
      }
      next();
    };
  }

  return { configured, ephemeralSecret, login, signToken, verifyToken, middleware };
}
