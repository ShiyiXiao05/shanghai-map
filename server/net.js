// 出网加固。
//
// 背景：微信云托管容器内出现过 DNS 解析失败 —— 服务端所有外部请求（微信 code2Session、
// 高德搜索、Cloudinary 上传）都会以 `TypeError: fetch failed` 结束，表现为"添加地点
// 报服务器内部错误"（登录必须先调 code2Session）。同类故障的通用解法是换可达的 DNS。
//
// 做法：用 undici 的 Agent 覆盖"域名 → IP"这一步：
//   ① 先用系统解析（保持正常环境下的行为与速度）；
//   ② 系统解析失败或 2.5 秒未返回 → 用公共 DNS（默认 223.5.5.5 / 119.29.29.29 /
//      114.114.114.114，UDP 直连指定服务器，不依赖容器里的 resolv.conf）兜底。
// 另提供 fetchWithRetry：瞬时网络失败重试一次。
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { lookup as systemLookup } from 'node:dns';
import { Resolver } from 'node:dns/promises';
import tls from 'node:tls';

const require = createRequire(import.meta.url);

const DEFAULT_DNS_SERVERS = ['223.5.5.5', '119.29.29.29', '114.114.114.114'];
// 系统解析最多等这么久，超时就走公共 DNS（避免坏 resolv.conf 让每个请求都卡到超时）
const SYSTEM_LOOKUP_TIMEOUT_MS = 2500;

/**
 * 安装 DNS 兜底。
 * @param {{ servers?: string[], enabled?: boolean, logger?: object }} options
 * @returns {{ enabled: boolean, servers: string[], restore?: () => void }}
 */
export function installDnsFallback({ servers, enabled = true, logger = console } = {}) {
  if (!enabled || process.env.CUSTOM_DNS === 'off') return { enabled: false, servers: [] };

  const fromEnv = String(process.env.CUSTOM_DNS_SERVERS || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const list = (servers && servers.length ? servers : fromEnv.length ? fromEnv : DEFAULT_DNS_SERVERS).filter(Boolean);

  let undici;
  try {
    undici = require('undici');
  } catch (err) {
    logger.warn?.('[net] 未安装 undici，跳过 DNS 兜底：', err?.message ?? err);
    return { enabled: false, servers: [] };
  }

  const resolver = new Resolver();
  resolver.setServers(list);

  const lookup = (hostname, options, callback) => {
    const wantAll = typeof options === 'object' && options !== null && options.all === true;
    let settled = false;
    let timer = null;
    const done = (err, address, family) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      callback(err, address, family);
    };
    const viaPublicDns = (firstErr) => {
      if (settled) return;
      resolver
        .resolve4(hostname)
        .then((addresses) => {
          if (!addresses || addresses.length === 0) {
            done(firstErr || new Error(`DNS 无 A 记录：${hostname}`));
            return;
          }
          if (wantAll) done(null, addresses.map((address) => ({ address, family: 4 })));
          else done(null, addresses[0], 4);
        })
        .catch((err) => done(firstErr || err));
    };

    timer = setTimeout(() => viaPublicDns(new Error('系统 DNS 超时')), SYSTEM_LOOKUP_TIMEOUT_MS);
    systemLookup(hostname, wantAll ? { all: true } : { family: options?.family || 0 }, (err, address, family) => {
      if (err || !address) viaPublicDns(err);
      else done(null, address, family);
    });
  };

  const previous = typeof undici.getGlobalDispatcher === 'function' ? undici.getGlobalDispatcher() : null;
  undici.setGlobalDispatcher(new undici.Agent({ connect: { lookup, timeout: 10_000 } }));
  logger.warn?.(`[net] DNS 兜底已启用：系统解析失败时改用 ${list.join(' / ')}`);

  return {
    enabled: true,
    servers: list,
    restore: () => {
      if (previous) undici.setGlobalDispatcher(previous);
    },
  };
}

// 微信云托管容器内，发往 api.weixin.qq.com 的请求会被平台「开放接口服务」本地代理接管，
// 并使用容器内一次性生成的自签名证书（官方文档：开放接口服务 → 证书与 HTTPS）。
// 官方建议容器内直接用 **http://** 调 api.weixin.qq.com（请求不出公网、被本地代理接管）；
// 若用 https，则需要信任 /app/cert/certificate.crt，否则报 DEPTH_ZERO_SELF_SIGNED_CERT。
const CLOUD_CERT_PATH = '/app/cert/certificate.crt';
const WECHAT_HOST = 'api.weixin.qq.com';

/** 当前环境该用 http 还是 https 访问微信接口（容器内代理存在时用 http）。 */
export function wechatApiBase({ certPath = process.env.WECHAT_CERT_PATH || CLOUD_CERT_PATH } = {}) {
  try {
    if (fs.existsSync(certPath)) return `http://${WECHAT_HOST}`;
  } catch (err) {
    // 读不到就按普通环境处理
  }
  return `https://${WECHAT_HOST}`;
}

// 备用通道：https + 信任容器内注入的自签名证书（undici Agent 指定 ca）
let containerCertAgent = null;
function httpsAgentTrustingContainerCert(certPath) {
  if (containerCertAgent !== null) return containerCertAgent;
  try {
    const undici = require('undici');
    const extra = fs.readFileSync(certPath);
    containerCertAgent = new undici.Agent({ connect: { ca: [...tls.rootCertificates, extra] } });
  } catch (err) {
    containerCertAgent = false; // 用不了（文件不存在/undici 缺失），后续不再尝试
  }
  return containerCertAgent;
}

/**
 * 调微信接口专用 fetch（三级通道，全部失败才抛出）：
 * ① 容器内有云调用证书 → 走官方推荐的 http（本地代理接管，不出公网）；
 *    普通环境 → 正常 https；
 * ② https 遇证书校验失败（DEPTH_ZERO_SELF_SIGNED_CERT）→ 退回 http；
 * ③ http 被代理拒绝（社区有 502 案例）→ 用 https + 信任容器内证书再试一次。
 * 其余瞬时失败由 fetchWithRetry 重试。
 */
export async function wechatFetch(url, options = {}, { retries = 1, logger = console, certPath } = {}) {
  const resolvedCertPath = certPath || process.env.WECHAT_CERT_PATH || CLOUD_CERT_PATH;
  const base = wechatApiBase({ certPath: resolvedCertPath });
  const target = String(url).replace(/^https?:\/\/api\.weixin\.qq\.com/, base);
  try {
    return await fetchWithRetry(target, options, { retries, logger });
  } catch (err) {
    const reason = String(err?.cause?.code || err?.cause?.message || '');
    const certIssue = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALT_NAME/i.test(reason);
    if (target.startsWith('https://') && certIssue) {
      logger.warn?.('[net] 微信接口证书校验失败，改用容器内 http 代理重试：', reason);
      return fetchWithRetry(target.replace(/^https:/, 'http:'), options, { retries, logger });
    }
    if (target.startsWith('http://')) {
      const agent = httpsAgentTrustingContainerCert(resolvedCertPath);
      if (agent) {
        logger.warn?.('[net] http 通道失败，改用 https + 容器证书重试：', err?.message ?? err);
        return fetchWithRetry(
          target.replace(/^http:/, 'https:'),
          { ...options, dispatcher: agent },
          { retries, logger }
        );
      }
    }
    throw err;
  }
}

/** 瞬时网络失败（连接被重置、DNS 抖动）重试一次；HTTP 状态码不算失败，直接返回。 */
export async function fetchWithRetry(url, options = {}, { retries = 1, delayMs = 250, logger = console } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (err) {
      lastError = err;
      const cause = err?.cause?.code || err?.cause?.message || '';
      logger.warn?.(
        `[net] 请求失败（第 ${attempt + 1}/${retries + 1} 次）：${err?.message ?? err}${cause ? ` / ${cause}` : ''}`
      );
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}
