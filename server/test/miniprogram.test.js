import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const miniRoot = fileURLToPath(new URL('../../miniprogram/', import.meta.url));

function createRuntime({ app = {}, wx = {}, modules = {} } = {}) {
  const cache = new Map();
  let page;
  function load(relative) {
    const filename = path.resolve(miniRoot, relative);
    if (modules[filename]) return modules[filename];
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    let source = fs.readFileSync(filename, 'utf8');
    const names = [...source.matchAll(/export\s+(?:async\s+)?(?:const|let|function)\s+(\w+)/g)]
      .map((match) => match[1]);
    source = source
      .replace(/import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"];?/g, 'const {$1} = require("$2");')
      .replace(/export\s+(?=(?:async\s+)?(?:const|let|function))/g, '');
    source += '\n' + names.map((name) => `exports.${name} = ${name};`).join('\n');
    new vm.Script(source, { filename }).runInNewContext({
      module,
      exports: module.exports,
      require: (target) => load(path.resolve(path.dirname(filename), target)),
      wx,
      getApp: () => app,
      Page: (value) => { page = value; },
      Behavior: (value) => value,
      setTimeout,
      setInterval,
      clearInterval,
    });
    return module.exports;
  }
  return {
    load,
    page(relative) {
      load(relative);
      return {
        ...page,
        data: JSON.parse(JSON.stringify(page.data)),
        setData(patch) { Object.assign(this.data, patch); },
      };
    },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function createLoginRuntime(respond, loginFailure) {
  const values = new Map([['wish-wmp-token', 'expired-token'], ['shanghai-wish-nickname', '同学']]);
  const requests = [];
  let loginCount = 0;
  const runtime = createRuntime({
    wx: {
      getStorageSync: (key) => values.get(key),
      setStorageSync: (key, value) => values.set(key, value),
      login: async () => {
        loginCount += 1;
        if (loginFailure) throw loginFailure;
        return { code: 'new-code' };
      },
      cloud: {
        callContainer(options) {
          requests.push(options);
          if (options.path === '/api/auth/login') {
            options.success({ statusCode: 200, data: { token: 'new-token', nickname: '同学' } });
          } else {
            respond(options);
          }
        },
      },
    },
  });
  return { runtime, values, requests, loginCount: () => loginCount };
}

describe('miniprogram regressions', () => {
  it('分享加入地图后立即刷新名称、只读状态和地点', async () => {
    const target = { code: 'NEW123', name: '分享地图' };
    const app = { globalData: { map: null, isPublicView: true }, enterMap(map) { this.globalData.map = map; this.globalData.isPublicView = false; } };
    const runtime = createRuntime({
      app,
      wx: { showLoading() {}, hideLoading() {}, showToast() {} },
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: { getMap: async () => target, listPlaces: async () => [{ id: 1, name: '分享地点', category: '景点' }] } } },
    });
    const page = runtime.page('pages/index/index.js');
    await page.joinByCode(target.code);
    assert.equal(page.data.mapName, target.name);
    assert.equal(page.data.isPublicView, false);
    assert.equal(page.data.places[0].name, '分享地点');
  });

  for (const outcome of ['success', 'error']) {
    it(`切图后的旧地点请求 ${outcome} 不覆盖新地图`, async () => {
      const oldRequest = deferred();
      let rejectOld;
      const oldPromise = outcome === 'error' ? new Promise((resolve, reject) => { rejectOld = reject; }) : oldRequest.promise;
      const app = { globalData: { map: { code: 'OLD123' } } };
      const toasts = [];
      const runtime = createRuntime({
        app,
        wx: { showToast: (options) => toasts.push(options.title) },
        modules: { [path.join(miniRoot, 'utils/api.js')]: { api: { listPlaces: (code) => code === 'OLD123' ? oldPromise : Promise.resolve([{ id: 2, name: '新地点', category: '景点' }]) } } },
      });
      const page = runtime.page('pages/index/index.js');
      const pending = page.loadPlaces();
      app.globalData.map = { code: 'NEW123' };
      await page.loadPlaces();
      if (outcome === 'error') rejectOld(new Error('旧地图失败'));
      else oldRequest.resolve([{ id: 1, name: '旧地点', category: '景点' }]);
      await pending;
      assert.equal(page.data.places[0].name, '新地点');
      assert.equal(toasts.length, 0);
    });
  }

  it('写操作遇到 AUTH_EXPIRED 后自动登录并重试一次', async () => {
    const client = createLoginRuntime((options) => options.success(options.header.authorization === 'Bearer expired-token'
      ? { statusCode: 401, data: { code: 'AUTH_EXPIRED', error: '登录过期' } }
      : { statusCode: 201, data: { code: 'NEW123' } }));
    const { api } = client.runtime.load('utils/api.js');
    assert.equal((await api.createMap({ name: '地图' })).code, 'NEW123');
    assert.equal(client.loginCount(), 1);
    assert.equal(client.values.get('wish-wmp-token'), 'new-token');
    assert.equal(client.requests.length, 3);
  });

  it('并发过期请求共享一次登录', async () => {
    const client = createLoginRuntime((options) => options.success(options.header.authorization === 'Bearer expired-token'
      ? { statusCode: 401, data: { code: 'AUTH_EXPIRED' } }
      : { statusCode: 200, data: { code: 'NEW123' } }));
    const { api } = client.runtime.load('utils/api.js');
    await Promise.all([api.createMap({ name: '一' }), api.createMap({ name: '二' })]);
    assert.equal(client.loginCount(), 1);
    assert.equal(client.requests.length, 5);
  });

  it('重新登录后仍然过期时停止，不循环重登', async () => {
    const client = createLoginRuntime((options) => options.success({ statusCode: 401, data: { code: 'AUTH_EXPIRED' } }));
    const { api } = client.runtime.load('utils/api.js');
    await assert.rejects(api.createMap({ name: '地图' }), (error) => error.code === 'AUTH_EXPIRED');
    assert.equal(client.loginCount(), 1);
    assert.equal(client.requests.length, 3);
  });

  it('迟到的过期响应复用已更新的 token，不重复登录', async () => {
    let delayed;
    const client = createLoginRuntime((options) => {
      if (!delayed) {
        delayed = options;
        return;
      }
      options.success(options.header.authorization === 'Bearer expired-token'
        ? { statusCode: 401, data: { code: 'AUTH_EXPIRED' } }
        : { statusCode: 200, data: { code: 'NEW123' } });
    });
    const { api } = client.runtime.load('utils/api.js');
    const pending = api.createMap({ name: '慢请求' });
    await api.createMap({ name: '快请求' });
    delayed.success({ statusCode: 401, data: { code: 'AUTH_EXPIRED' } });
    await pending;
    assert.equal(client.loginCount(), 1);
  });

  it('重登失败清除失效 token 并返回错误，不执行写操作', async () => {
    const client = createLoginRuntime(
      (options) => options.success({ statusCode: 401, data: { code: 'AUTH_EXPIRED' } }),
      new Error('微信登录失败')
    );
    const { api } = client.runtime.load('utils/api.js');
    await assert.rejects(api.createMap({ name: '地图' }), /微信登录失败/);
    assert.equal(client.values.get('wish-wmp-token'), '');
    assert.equal(client.requests.length, 1);
  });

  it('重登后的编辑请求保留方法、邀请码和请求体', async () => {
    const client = createLoginRuntime((options) => options.success(options.header.authorization === 'Bearer expired-token'
      ? { statusCode: 401, data: { code: 'AUTH_EXPIRED' } }
      : { statusCode: 200, data: { id: 7 } }));
    const { api } = client.runtime.load('utils/api.js');
    await api.updatePlace('MAP123', 7, { visited: true });
    const retried = client.requests.at(-1);
    assert.equal(retried.method, 'PUT');
    assert.equal(retried.path, '/api/places/7');
    assert.equal(retried.header['x-map-code'], 'MAP123');
    assert.equal(retried.data.visited, true);
  });

  it('普通 401 不触发自动登录', async () => {
    const client = createLoginRuntime((options) => options.success({ statusCode: 401, data: { error: '没有权限' } }));
    const { api } = client.runtime.load('utils/api.js');
    await assert.rejects(api.createMap({ name: '地图' }), (error) => error.status === 401);
    assert.equal(client.loginCount(), 0);
    assert.equal(client.requests.length, 1);
  });

  for (const cancelled of [true, false]) {
    it(cancelled ? '取消选照片静默返回' : '选照片失败给出提示而非未捕获异常', async () => {
      const toasts = [];
      let uploads = 0;
      const runtime = createRuntime({
        wx: {
          chooseMedia: async () => { throw { errMsg: cancelled ? 'chooseMedia:fail cancel' : 'chooseMedia:fail permission denied' }; },
          showToast: (options) => toasts.push(options.title),
        },
        modules: {
          [path.join(miniRoot, 'utils/auth.js')]: { requireIdentity: async () => '同学' },
          [path.join(miniRoot, 'utils/identity-behavior.js')]: {},
          [path.join(miniRoot, 'utils/api.js')]: { api: { uploadPhoto: async () => { uploads += 1; } } },
        },
      });
      await runtime.page('pages/detail/detail.js').addPhoto();
      assert.equal(uploads, 0);
      assert.equal(toasts.length, cancelled ? 0 : 1);
    });
  }
});
