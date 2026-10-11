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
import { createRequire } from 'node:module';
import { lookup as systemLookup } from 'node:dns';
import { Resolver } from 'node:dns/promises';

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
