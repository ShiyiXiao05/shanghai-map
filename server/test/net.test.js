// 出网加固：DNS 兜底安装 + 瞬时失败重试。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installDnsFallback, fetchWithRetry, wechatApiBase, wechatFetch } from '../net.js';

describe('出网加固', () => {
  it('环境变量 CUSTOM_DNS=off 时不启用（可用于应急关闭）', () => {
    const before = process.env.CUSTOM_DNS;
    process.env.CUSTOM_DNS = 'off';
    try {
      assert.equal(installDnsFallback({ logger: { warn() {} } }).enabled, false);
    } finally {
      if (before === undefined) delete process.env.CUSTOM_DNS;
      else process.env.CUSTOM_DNS = before;
    }
  });

  it('启用时安装 undici dispatcher 并报告使用的 DNS，可还原', () => {
    const logs = [];
    const result = installDnsFallback({ servers: ['1.1.1.1', '223.5.5.5'], logger: { warn: (m) => logs.push(String(m)) } });
    try {
      assert.equal(result.enabled, true);
      assert.deepEqual(result.servers, ['1.1.1.1', '223.5.5.5']);
      assert.match(logs.join('\n'), /DNS 兜底已启用/);
    } finally {
      result.restore?.();
    }
  });

  it('微信接口地址：容器内存在云调用证书时用 http，否则用 https', () => {
    const tmp = path.join(os.tmpdir(), `wxcert-${Date.now()}`);
    try {
      assert.equal(wechatApiBase({ certPath: tmp }), 'https://api.weixin.qq.com', '无证书文件 = 普通环境');
      fs.writeFileSync(tmp, 'dummy');
      assert.equal(wechatApiBase({ certPath: tmp }), 'http://api.weixin.qq.com', '容器内改用 http（官方推荐）');
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  });

  it('wechatFetch：https 遇自签证书 → 自动退回 http 重试', async () => {
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      if (String(url).startsWith('https://')) {
        throw Object.assign(new Error('fetch failed'), { cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } });
      }
      return { ok: true, status: 200, json: async () => ({ openid: 'o1' }) };
    };
    try {
      const res = await wechatFetch('https://api.weixin.qq.com/sns/jscode2session?js_code=x', {}, { retries: 0, logger: { warn() {} } });
      assert.equal(res.status, 200);
      assert.equal(calls.length, 2, '应先 https 再 http');
      assert.match(calls[1], /^http:\/\/api\.weixin\.qq\.com\//);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('wechatFetch：http 被代理拒绝时 → 改用 https + 容器证书再试（带 dispatcher）', async () => {
    const tmp = path.join(os.tmpdir(), `wxcert2-${Date.now()}`);
    fs.writeFileSync(tmp, 'dummy-cert');
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), hasDispatcher: Boolean(options.dispatcher) });
      if (String(url).startsWith('http://')) throw new Error('proxy rejected');
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    try {
      const res = await wechatFetch(
        'https://api.weixin.qq.com/sns/jscode2session?a=1',
        {},
        { retries: 0, logger: { warn() {} }, certPath: tmp }
      );
      assert.equal(res.status, 200);
      assert.equal(calls.length, 2);
      assert.match(calls[0].url, /^http:\/\/api\.weixin\.qq\.com\//, '容器内先走 http');
      assert.match(calls[1].url, /^https:\/\/api\.weixin\.qq\.com\//, '失败后回到 https');
      assert.equal(calls[1].hasDispatcher, true, 'https 重试必须带上信任容器证书的 dispatcher');
    } finally {
      globalThis.fetch = original;
      fs.rmSync(tmp, { force: true });
    }
  });

  it('fetchWithRetry：瞬时失败重试后成功', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } });
      return { ok: true, status: 200, json: async () => ({ ok: 1 }) };
    };
    try {
      const res = await fetchWithRetry('https://example.com', {}, { retries: 1, logger: { warn() {} } });
      assert.equal(res.status, 200);
      assert.equal(calls, 2, '应当重试一次');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('fetchWithRetry：一直失败则抛出最后一次错误（不无限重试）', async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error('fetch failed');
    };
    try {
      await assert.rejects(() => fetchWithRetry('https://example.com', {}, { retries: 1, logger: { warn() {} } }));
      assert.equal(calls, 2);
    } finally {
      globalThis.fetch = original;
    }
  });
});
