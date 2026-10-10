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
        setData(patch, callback) {
          Object.assign(this.data, patch);
          if (typeof callback === 'function') callback();
        },
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

  it('重登失败时保留旧 token、返回错误且不重复写请求', async () => {
    const client = createLoginRuntime(
      (options) => options.success({ statusCode: 401, data: { code: 'AUTH_EXPIRED' } }),
      new Error('微信登录失败')
    );
    const { api } = client.runtime.load('utils/api.js');
    await assert.rejects(api.createMap({ name: '地图' }), /微信登录失败/);
    // 关键：登录没成功就不该动本地 token（旧实现先清空 → 用户永久掉登录态且无自救入口）
    assert.equal(client.values.get('wish-wmp-token'), 'expired-token');
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

  it('排序：picker 索引映射为 sort key 并写入本地存储', async () => {
    const values = new Map();
    const runtime = createRuntime({
      wx: { getStorageSync: (key) => values.get(key), setStorageSync: (key, value) => values.set(key, value) },
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: { listPlaces: async () => [] } } },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [], activeCategories: [], hideVisitedOnly: false });
    page.onSortChange({ detail: { value: '1' } });
    assert.equal(page.data.sort, 'name');
    assert.equal(page.data.sortIndex, 1);
    assert.equal(values.get('wish-sort'), 'name');
    page.onSortChange({ detail: { value: '2' } });
    assert.equal(page.data.sort, 'wishes');
    assert.equal(page.data.sortIndex, 2);
  });

  it('附近：首次使用让用户标记我的位置（拖动中心点），并按该点排序', async () => {
    const toasts = [];
    const sheets = [];
    const values = new Map();
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        removeStorageSync: (key) => values.delete(key),
        showActionSheet: (options) => sheets.push(options),
        showToast: (options) => toasts.push(options.title),
        createMapContext: () => ({
          getCenterLocation: (options) => options.success({ latitude: 31.2054, longitude: 121.4375 }),
        }),
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [
      { id: 1, name: '近处', category: '景点', lat: 31.2054, lng: 121.4375 },
      { id: 2, name: '远处', category: '景点', lat: 31.25, lng: 121.5 },
    ] });

    page.locateNearby();
    // locateNearby 会先尝试一次自动定位（异步），这里等它放弃后再断言弹出了手动选择
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(sheets.length, 1, '没有标记过时应先询问');

    await page.useMapCenterAsMyLocation();
    assert.equal(page.data.nearbyPlaces[0].id, 1);
    assert.equal(page.data.longitude, 121.4375);
    assert.equal(page.data.latitude, 31.2054);
    assert.equal(page.data.nearbyOpen, true);
    assert.equal(toasts.at(-1), '按你标记的位置排序');
    assert.equal(values.get('wish-my-location').latitude, 31.2054, '应记住标记的位置');
  });

  it('附近：已标记过时直接排序，不再询问', () => {
    const sheets = [];
    const values = new Map([['wish-my-location', { latitude: 31.25, longitude: 121.5 }]]);
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        showActionSheet: (options) => sheets.push(options),
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [
      { id: 1, name: '近处', category: '景点', lat: 31.2054, lng: 121.4375 },
      { id: 2, name: '远处', category: '景点', lat: 31.25, lng: 121.5 },
    ] });
    page.locateNearby();
    assert.equal(sheets.length, 0, '已标记过不应再询问');
    assert.equal(page.data.nearbyPlaces[0].id, 2);
  });

  it('附近：在地图上点选也能标记我的位置', () => {
    const values = new Map();
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [
      { id: 1, name: '近处', category: '景点', lat: 31.2054, lng: 121.4375 },
      { id: 2, name: '远处', category: '景点', lat: 31.25, lng: 121.5 },
    ] });

    page.onMapTapForLocation({ detail: { latitude: 31.2054, longitude: 121.4375 } });
    assert.equal(page.data.nearbyOpen, false, '非标记模式下点击地图不应触发排序');

    page.startMarkLocation();
    assert.equal(page.data.markLocation, true);
    page.onMapTapForLocation({ detail: { latitude: 31.2054, longitude: 121.4375 } });
    assert.equal(page.data.markLocation, false);
    assert.equal(page.data.nearbyPlaces[0].id, 1);
    assert.equal(values.get('wish-my-location').longitude, 121.4375);
  });

  it('附近：重新标记会忘掉旧位置并重新询问', () => {
    const sheets = [];
    const values = new Map([['wish-my-location', { latitude: 31.25, longitude: 121.5 }]]);
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        removeStorageSync: (key) => values.delete(key),
        showActionSheet: (options) => sheets.push(options),
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [{ id: 1, name: '地点', category: '景点', lat: 31.2, lng: 121.4 }] });
    page.remarkMyLocation();
    assert.equal(values.has('wish-my-location'), false);
    assert.equal(sheets.length, 1);
  });

  it('附近：自动定位可用时直接用当前位置排序（不调用地理位置接口）', async () => {
    const values = new Map();
    const toasts = [];
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        getSetting: (options) => options.success({ authSetting: { 'scope.userLocation': true } }),
        createMapContext: () => ({
          moveToLocation() {},
          getCenterLocation: (options) => options.success({ latitude: 31.2054, longitude: 121.4375 }),
        }),
        showToast: (options) => toasts.push(options.title),
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({
      places: [
        { id: 1, name: '近处', category: '景点', lat: 31.2054, lng: 121.4375 },
        { id: 2, name: '远处', category: '景点', lat: 31.25, lng: 121.5 },
      ],
    });
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 1400));
    assert.equal(page.data.showMyDot, true, '自动定位时需要打开地图定位点');
    assert.equal(page.data.nearbyPlaces[0].id, 1);
    assert.equal(page.data.nearbyOpen, true);
    assert.equal(values.get('wish-my-location').latitude, 31.2054);
    assert.equal(toasts.at(-1), '已按当前位置排序');
  });

  it('附近：地图组件定位没生效（中心点未移动）时退回手动方式', async () => {
    const sheets = [];
    const runtime = createRuntime({
      wx: {
        getStorageSync: () => null,
        setStorageSync() {},
        getSetting: (options) => options.success({ authSetting: { 'scope.userLocation': true } }),
        createMapContext: () => ({
          moveToLocation() {},
          getCenterLocation: (options) => options.success({ latitude: 31.2304, longitude: 121.4737 }),
        }),
        showActionSheet: (options) => sheets.push(options),
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [{ id: 1, name: '地点', category: '景点', lat: 31.2, lng: 121.4 }] });
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 1400));
    assert.equal(sheets.length, 1, '定位没生效应弹出手动选择');
    assert.equal(sheets[0].itemList[0], '从常用地标选（最快）');
    assert.equal(page.data.nearbyOpen, false);
  });

  it('附近：用户拒绝授权时不再弹授权、直接给手动方式', async () => {
    const sheets = [];
    let authorized = 0;
    const runtime = createRuntime({
      wx: {
        getStorageSync: () => null,
        setStorageSync() {},
        getSetting: (options) => options.success({ authSetting: { 'scope.userLocation': false } }),
        authorize: () => {
          authorized += 1;
        },
        createMapContext: () => ({
          moveToLocation() {},
          getCenterLocation: (options) => options.success({ latitude: 31.2, longitude: 121.4 }),
        }),
        showActionSheet: (options) => sheets.push(options),
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [{ id: 1, name: '地点', category: '景点', lat: 31.2, lng: 121.4 }] });
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(authorized, 0, '明确拒绝过就不该再调 authorize');
    assert.equal(sheets.length, 1);
  });

  it('附近：从常用地标一键标记', () => {
    const values = new Map();
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        showActionSheet: (options) => options.success({ tapIndex: 1 }), // 徐家汇
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({
      places: [
        { id: 1, name: '徐家汇近', category: '景点', lat: 31.1905, lng: 121.437 },
        { id: 2, name: '人民广场', category: '景点', lat: 31.2331, lng: 121.4692 },
      ],
    });
    page.pickAnchor();
    assert.equal(values.get('wish-my-location').latitude, 31.1905);
    assert.equal(page.data.nearbyPlaces[0].id, 1);
  });

  it('入口页：改昵称会先静默登录再落库，并同步页面与本地存储', async () => {
    const values = new Map();
    const profiles = [];
    let loggedIn = 0;
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        removeStorageSync: (key) => values.delete(key),
        login: async () => ({ code: 'CODE' }),
        showToast() {},
      },
      modules: {
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            login: async () => {
              loggedIn += 1;
              return { token: 'TOKEN-1', nickname: '' };
            },
            updateProfile: async (nickname) => {
              profiles.push(nickname);
              return nickname;
            },
          },
          setAuthRecovery() {},
        },
      },
    });
    const page = runtime.page('pages/entry/entry.js');
    assert.equal(values.get('wish-wmp-token'), undefined, '前置：本地没有登录态');

    await page.editNickname();
    assert.equal(loggedIn, 1, '没有 token 时必须先登录（否则 /api/auth/profile 会 401）');
    assert.equal(page.data.nickModalShow, true, '登录成功后应打开昵称弹层');

    await page.onNickConfirm({ detail: '新名字' });
    assert.deepEqual(profiles, ['新名字']);
    assert.equal(page.data.nickname, '新名字', '页面上的昵称要立即更新');
    assert.equal(values.get('shanghai-wish-nickname'), '新名字');
    assert.equal(page.data.nickModalShow, false);
  });

  it('入口页：登录失败时不弹昵称层（避免白填一次）', async () => {
    const values = new Map();
    const toasts = [];
    const runtime = createRuntime({
      app: { globalData: {} },
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        login: async () => ({ code: 'CODE' }),
        showToast: (options) => toasts.push(options.title),
      },
      modules: {
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            login: async () => {
              throw new Error('服务暂时不可用');
            },
          },
          setAuthRecovery() {},
        },
      },
    });
    const page = runtime.page('pages/entry/entry.js');
    await page.editNickname();
    assert.ok(!page.data.nickModalShow, '登录失败时不应打开昵称弹层');
    assert.equal(toasts.at(-1), '服务暂时不可用');
  });

  it('入口页：退出登录清空本地身份', async () => {
    const values = new Map([
      ['wish-wmp-token', 'TOKEN-1'],
      ['shanghai-wish-nickname', '旧名字'],
    ]);
    const toasts = [];
    const runtime = createRuntime({
      app: { globalData: {} },
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        removeStorageSync: (key) => values.delete(key),
        showModal: (options) => options.success({ confirm: true }),
        showToast: (options) => toasts.push(options.title),
      },
    });
    const page = runtime.page('pages/entry/entry.js');
    page.setData({ nickname: '旧名字' });
    page.logout();
    assert.equal(values.get('wish-wmp-token'), '');
    assert.equal(values.get('shanghai-wish-nickname'), '');
    assert.equal(page.data.nickname, '');
    assert.equal(toasts.at(-1), '已退出登录');
  });

  it('昵称弹层：打开时预填当前昵称，空白输入不触发确认', () => {
    const modalJs = fs.readFileSync(path.join(miniRoot, 'components/nickname-modal/nickname-modal.js'), 'utf8');
    const modalWxml = fs.readFileSync(path.join(miniRoot, 'components/nickname-modal/nickname-modal.wxml'), 'utf8');
    assert.match(modalJs, /initial:\s*\{\s*type:\s*String/, '弹层要支持预填属性');
    assert.match(modalJs, /this\.setData\(\{\s*value:\s*this\.data\.initial/, '打开时要把当前昵称填进输入框');
    assert.match(modalWxml, /\{\{title\}\}/, '标题应可配置（首次是"你的昵称"，改昵称时是"修改昵称"）');
    const entryWxml = fs.readFileSync(path.join(miniRoot, 'pages/entry/entry.wxml'), 'utf8');
    assert.match(entryWxml, /我的身份/, '入口页要有改昵称/退出登录入口');
    assert.match(entryWxml, /initial="\{\{nickname\}\}"/, '入口页要把当前昵称传给弹层');
  });

  it('高德分享解析：marker 链接与裸坐标都能取到经纬度', async () => {
    const { parseAmapShare } = await import(new URL('../../miniprogram/utils/amap.js', import.meta.url));
    const marker = parseAmapShare(
      '我在高德地图发现了一个好地方：https://uri.amap.com/marker?position=121.4375,31.2054&name=%E6%AD%A6%E5%BA%B7%E5%A4%A7%E6%A5%BC&src=mypage'
    );
    assert.equal(marker.lng, 121.4375);
    assert.equal(marker.lat, 31.2054);
    assert.equal(marker.name, '武康大楼');

    const bare = parseAmapShare('我的位置：121.4737,31.2304 【人民广场】');
    assert.equal(bare.lng, 121.4737);
    assert.equal(bare.lat, 31.2304);
    assert.equal(bare.name, '人民广场');

    assert.ok(parseAmapShare('随便一段文字').error, '认不出来时应给出错误而不是空坐标');
  });

  it('附近：粘贴高德位置链接可当作我的位置（不调用定位接口）', () => {
    const values = new Map();
    const toasts = [];
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        getClipboardData: (options) =>
          options.success({ data: 'https://uri.amap.com/marker?position=121.4375,31.2054&name=%E6%88%91%E7%9A%84%E4%BD%8D%E7%BD%AE' }),
        showToast: (options) => toasts.push(options.title),
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [
      { id: 1, name: '近处', category: '景点', lat: 31.2054, lng: 121.4375 },
      { id: 2, name: '远处', category: '景点', lat: 31.25, lng: 121.5 },
    ] });
    page.markByAmapLink();
    assert.equal(values.get('wish-my-location').latitude, 31.2054);
    assert.equal(page.data.nearbyPlaces[0].id, 1);
    assert.equal(toasts.at(-1), '按你标记的位置排序');
  });

  it('附近：粘贴的内容认不出来时给出引导，不写入位置', () => {
    const values = new Map();
    const modals = [];
    const runtime = createRuntime({
      wx: {
        getStorageSync: (key) => values.get(key),
        setStorageSync: (key, value) => values.set(key, value),
        getClipboardData: (options) => options.success({ data: '一段无关的文字' }),
        showModal: (options) => modals.push(options),
        showToast() {},
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [{ id: 1, name: '地点', category: '景点', lat: 31.2, lng: 121.4 }] });
    page.markByAmapLink();
    assert.equal(values.has('wish-my-location'), false);
    assert.equal(modals.length, 1);
    assert.match(modals[0].content, /高德地图/);
  });

  it('回归守卫：小程序包里不得出现地理位置接口（会被提审 61040 拦截）', () => {
    const root = miniRoot; // 文件顶部已用 import.meta.url 解析（ESM 无 __dirname）
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|json|wxml|wxss)$/.test(entry.name)) continue;
        const text = fs.readFileSync(full, 'utf8');
        // 注意：scope.userLocation 是"地图组件定位点"所需的用户授权（show-location），
        // 不属于需要后台准入开通的地理位置接口，因此不在禁止清单里；被管控的是下面这些。
        for (const token of ['wx.getLocation', 'wx.chooseLocation', 'getFuzzyLocation', 'requiredPrivateInfos']) {
          if (text.includes(token)) offenders.push(path.relative(root, full) + ' → ' + token);
        }
      }
    };
    walk(root);
    assert.deepEqual(
      offenders,
      [],
      '地理位置接口需要后台准入开通，未开通时包里出现即无法提审；启用方案见 docs/待启用-设备定位实现.md'
    );
  });

  it('首页布局：列表保留可滚动高度，导航按钮不换行', () => {
    const wxss = fs.readFileSync(path.join(miniRoot, 'pages/index/index.wxss'), 'utf8');
    const wxml = fs.readFileSync(path.join(miniRoot, 'pages/index/index.wxml'), 'utf8');
    assert.match(wxss, /\.place-scroll\s*\{[\s\S]*?height:\s*0;[\s\S]*?min-height:\s*0;/);
    assert.match(wxss, /\.nav-btn\s*\{[\s\S]*?flex:\s*none;[\s\S]*?white-space:\s*nowrap;/);
    assert.match(wxml, /<switch\s+class="toggle-switch"/);
  });

  it('照片上传：CDN 模式只传 full，无 CDN 时带一张预算内的缩略图', async () => {
    const uploads = [];
    let cfg = { cdn: true, maxFullBytes: 1.5 * 1024 * 1024, maxThumbBytes: 64 * 1024 };
    const fileSizes = { '/tmp/orig.jpg': 4 * 1024 * 1024, '/tmp/small.jpg': 30 * 1024, '/tmp/thumb.jpg': 10 * 1024 };
    const contents = { '/tmp/small.jpg': 40 * 1024, '/tmp/thumb.jpg': 13 * 1024 };
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: {
        chooseMedia: async () => ({ tempFiles: [{ tempFilePath: '/tmp/orig.jpg', size: 4 * 1024 * 1024 }] }),
        compressImage: ({ compressedWidth, success }) =>
          success({ tempFilePath: compressedWidth >= 800 ? '/tmp/small.jpg' : '/tmp/thumb.jpg' }),
        getFileSystemManager: () => ({
          getFileInfo: ({ filePath, success }) => success({ size: fileSizes[filePath] || 4 * 1024 * 1024 }),
          readFile: ({ filePath, success }) => success({ data: 'A'.repeat(contents[filePath] || 0) }),
        }),
        showLoading() {},
        hideLoading() {},
        showToast() {},
      },
      modules: {
        [path.join(miniRoot, 'utils/auth.js')]: { requireIdentity: async () => '同学' },
        [path.join(miniRoot, 'utils/identity-behavior.js')]: {},
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            uploadConfig: async () => cfg,
            uploadPhoto: async (code, placeId, body) => {
              uploads.push(body);
              return { id: uploads.length };
            },
            listPhotos: async () => [],
          },
        },
      },
    });
    const page = runtime.page('pages/detail/detail.js');
    page.placeId = 7;

    await page.addPhoto();
    assert.equal(uploads.length, 1);
    assert.match(uploads[0].full, /^data:image\/jpeg;base64,/);
    assert.equal(uploads[0].thumb, undefined, 'CDN 模式不应携带 thumb（会撞 callContainer 100K 上限）');

    cfg = { cdn: false, maxFullBytes: 1.5 * 1024 * 1024, maxThumbBytes: 64 * 1024 };
    await page.addPhoto();
    assert.equal(uploads.length, 2);
    assert.match(uploads[1].thumb || '', /^data:image\/jpeg;base64,/);
    assert.ok(uploads[1].thumb.length <= 64 * 1024, '缩略图 base64 需在服务端 64KB 上限内');
    assert.ok(uploads[1].full.length + uploads[1].thumb.length < 100 * 1024, '请求体需在 100K 以内');
  });

  it('详情页分享路径带上 place id（并支持分享朋友圈）', async () => {
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: {},
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: {}, setAuthRecovery() {} } },
    });
    const page = runtime.page('pages/detail/detail.js');
    page.placeId = 42;
    page.data.place = { id: 42, name: '某地点' };
    assert.match(page.onShareAppMessage().path, /place=42/);
    assert.match(page.onShareTimeline().query, /place=42/);
  });

  it('图标未生成时地图仍渲染点位（使用系统默认标记）', async () => {
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123' } } },
      wx: { showToast() {}, setNavigationBarTitle() {} },
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: { listPlaces: async () => [] } } },
    });
    const page = runtime.page('pages/index/index.js');
    page.renderMarkers([{ id: 1, name: 'A', category: '景点', lat: 31, lng: 121, visited: false }]);
    assert.equal(page.data.markers.length, 1, '没有图标也必须画出点位');
    assert.equal(page.data.markers[0].iconPath, undefined);
  });
});
