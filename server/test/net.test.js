// 出网加固：DNS 兜底安装 + 瞬时失败重试。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installDnsFallback, fetchWithRetry } from '../net.js';

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
