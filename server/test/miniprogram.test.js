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

  it('添加地点：关键词搜索出结果，选中后即可用坐标保存', async () => {
    const created = [];
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: {
        showToast() {},
        pageScrollTo() {},
      },
      modules: {
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            searchPlaces: async (keyword) => {
              assert.equal(keyword, '武康大楼');
              return [
                { id: 'B0FF', name: '武康大楼', address: '淮海中路1850号', lng: 121.4375, lat: 31.2054 },
                { id: 'B0FG', name: '武康路', address: '徐汇区', lng: 121.4401, lat: 31.2066 },
              ];
            },
            createPlace: async (code, data) => {
              created.push({ code, data });
              return { id: 1 };
            },
          },
          setAuthRecovery() {},
        },
      },
    });
    const page = runtime.page('pages/search/search.js');
    page.setData({ searchKeyword: '武康大楼' });
    await page.doSearch();
    assert.equal(page.data.searchResults.length, 2);
    assert.equal(page.data.searching, false, '搜索结束必须复位按钮状态');

    page.pickSearchResult({ currentTarget: { dataset: { index: 0 } } });
    assert.equal(page.data.picked.name, '武康大楼');
    assert.equal(page.data.picked.latitude, 31.2054);
    assert.equal(page.data.picked.longitude, 121.4375);
    assert.equal(page.data.searchResults.length, 0, '选中后应收起结果列表');
  });

  it('添加地点：搜索不可用时提示改用地图点选，不卡在「搜索中」', async () => {
    const toasts = [];
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: { showToast: (options) => toasts.push(options.title) },
      modules: {
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            searchPlaces: async () => {
              throw new Error('地点搜索暂时不可用，请稍后再试');
            },
          },
          setAuthRecovery() {},
        },
      },
    });
    const page = runtime.page('pages/search/search.js');
    page.setData({ searchKeyword: '武康大楼' });
    await page.doSearch();
    assert.equal(page.data.searching, false);
    assert.match(page.data.searchHint, /地图上点选/);
    assert.equal(toasts.at(-1), '地点搜索暂时不可用，请稍后再试');
  });

  it('标记 emoji：字号在"填满但不溢出"的区间，且不依赖不可靠的像素测量', () => {
    const source = fs.readFileSync(path.join(miniRoot, 'pages/index/index.js'), 'utf8');
    // 字号：emoji 实际着色范围约为字号的 1.2~1.4 倍，圆内可用直径约 32 逻辑 px
    const match = source.match(/const EMOJI_FONT_PX = (\d+);/);
    assert.ok(match, '应有可调的字号常量');
    const size = Number(match[1]);
    assert.ok(size >= 18 && size <= 22, `字号应在 18~22 之间（当前 ${size}）：过小显得空、过大会溢出`);
    assert.match(source, /ctx\.font = `\$\{EMOJI_FONT_PX\}px sans-serif`/, '绘制应使用该常量');
    assert.match(source, /ctx\.textAlign = layout\.align/, '横向锚点由 pickEmojiLayout 决定');
    assert.match(source, /ctx\.textBaseline = 'middle'/, '纵向居中交给 canvas');
    // 回归守卫：真机实测 getImageData 会返回整块不透明数据，缩放系数被算成极小 → emoji 消失。
    // 只禁"调用"（注释里解释原因是可以的）。
    assert.ok(!/getImageData\s*\(/.test(source), '不要再调用 getImageData 做像素测量');
    assert.ok(!/measureEmojiInk\s*\(/.test(source), '不要再引入墨迹测量方案');
  });

  it('emoji 锚点自适应：正常宽度居中；宽度异常时改用左对齐，不被 advance 推偏', () => {
    const runtime = createRuntime({ wx: {} });
    const page = runtime.page('pages/index/index.js');
    const F = 20;

    // 正常：advance ≈ 字号 → 交给 canvas 居中
    const normal = page.pickEmojiLayout(() => 20, '🍜', F);
    // 注意：页面方法在 vm 沙箱里执行，返回对象的原型与测试不同，逐字段断言
    assert.equal(normal.text, '🍜');
    assert.equal(normal.align, 'center');
    assert.equal(normal.x, 22);
    assert.equal(normal.suspicious, false);

    // 异常 + 含变体选择符：去掉 U+FE0F 后变窄 → 用去掉后的串，并回到居中
    const withVs = page.pickEmojiLayout((t) => (t.indexOf('\uFE0F') >= 0 ? 40 : 20), '🏞️', F);
    assert.equal(withVs.text, '🏞', '应去掉变体选择符');
    assert.equal(withVs.align, 'center');
    assert.equal(withVs.suspicious, false);

    // 异常且无法通过去变体选择符改善：改用左对齐锚点（与 advance 无关）
    const bad = page.pickEmojiLayout(() => 60, '🎡', F);
    assert.equal(bad.align, 'left');
    assert.equal(bad.x, 22 - F / 2);
    assert.equal(bad.suspicious, true);

    // measure 返回 NaN/0（某些机型）→ 按字号处理，不误判为异常
    assert.equal(page.pickEmojiLayout(() => NaN, '🍜', F).align, 'center');
    assert.equal(page.pickEmojiLayout(() => 0, '🍜', F).align, 'center');

    // 回归守卫：绘制必须使用 layout 的结果
    const source = fs.readFileSync(path.join(miniRoot, 'pages/index/index.js'), 'utf8');
    assert.match(source, /ctx\.fillText\(layout\.text, layout\.x/, '应按 layout 绘制');
  });

  it('附近：已授权时移动并读取当前位置排序（不再依赖 wx.authorize）', async () => {
    const toasts = [];
    let authorized = false;
    const runtime = createRuntime({
      wx: {
        getSetting: (options) => options.success({ authSetting: authorized ? { 'scope.userLocation': true } : {} }),
        authorize: () => {
          throw new Error('不应调用 wx.authorize（对 scope.userLocation 不可靠）');
        },
        createMapContext: () => ({
          moveToLocation() {},
          getCenterLocation: (options) => options.success({ latitude: 31.2054, longitude: 121.4375 }),
        }),
        showLoading() {},
        hideLoading() {},
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
    authorized = true;
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 1500));
    assert.equal(page.data.nearbyPlaces[0].id, 1);
    assert.equal(page.data.nearbyOpen, true);
    assert.equal(page.data.showMyDot, true);
    assert.equal(toasts.at(-1), '已按当前位置排序');
  });

  it('附近：未决定授权 → 打开定位点等待弹窗；用户允许后即可定位', async () => {
    const toasts = [];
    let authorized = false;
    let settingCalls = 0;
    const runtime = createRuntime({
      wx: {
        getSetting: (options) => {
          settingCalls += 1;
          // 第 3 次查询（约 1 秒后）模拟用户点了"允许"
          if (settingCalls >= 3) authorized = true;
          options.success({ authSetting: authorized ? { 'scope.userLocation': true } : {} });
        },
        createMapContext: () => ({
          moveToLocation() {},
          getCenterLocation: (options) => options.success({ latitude: 31.2054, longitude: 121.4375 }),
        }),
        showLoading() {},
        hideLoading() {},
        showToast: (options) => toasts.push(options.title),
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [{ id: 1, name: '地点', category: '景点', lat: 31.2054, lng: 121.4375 }] });
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 2500));
    assert.equal(page.data.showMyDot, true, '要先打开地图定位点以触发授权弹窗');
    assert.equal(page.data.nearbyOpen, true, '授权后应出结果');
    assert.ok(settingCalls >= 2, '应轮询授权结果');
  });

  it('附近：一直未授权 → 弹双出口（去设置 / 用地图中心）', async () => {
    const modals = [];
    const runtime = createRuntime({
      wx: {
        getSetting: (options) => options.success({ authSetting: {} }),
        createMapContext: () => ({ moveToLocation() {}, getCenterLocation: (options) => options.fail({}) }),
        showLoading() {},
        hideLoading() {},
        showToast() {},
        showModal: (options) => modals.push(options),
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places: [{ id: 1, name: '地点', category: '景点', lat: 31.2304, lng: 121.4737 }] });
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 9500));
    assert.equal(modals.length, 1);
    assert.equal(modals[0].confirmText, '去设置');
    assert.equal(modals[0].cancelText, '用地图中心');
  });

  it('附近：拒绝授权后选「用地图中心」也能出结果（不再走进死路）', async () => {
    const modals = [];
    const toasts = [];
    const runtime = createRuntime({
      wx: {
        getSetting: (options) => options.success({ authSetting: { 'scope.userLocation': false } }),
        createMapContext: () => ({ moveToLocation() {}, getCenterLocation: (options) => options.fail({}) }),
        showLoading() {},
        hideLoading() {},
        showToast: (options) => toasts.push(options.title),
        showModal: (options) => {
          modals.push(options);
          options.success({ confirm: false, cancel: true }); // 用户点「用地图中心」
        },
      },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({
      longitude: 121.4737,
      latitude: 31.2304,
      places: [
        { id: 1, name: '中心附近', category: '景点', lat: 31.2304, lng: 121.4737 },
        { id: 2, name: '远处', category: '景点', lat: 31.4, lng: 121.6 },
      ],
    });
    page.locateNearby();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(page.data.nearbyOpen, true, '用地图中心也应能出结果');
    assert.equal(page.data.nearbyPlaces[0].id, 1);
    assert.equal(toasts.at(-1), '按地图中心排序');
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

  it('首页搜索：关键词并入筛选管道，空词恢复全部且与分类叠加', async () => {
    const places = [
      { id: 1, name: '武康大楼', category: '景点', address: '淮海中路1850号', tags: ['拍照'], visited: false },
      { id: 2, name: '老吉士酒家', category: '美食', address: '天平路41号', tags: 'Brunch, 本帮菜', visited: false },
      { id: 3, name: '上海博物馆', category: '展馆', address: '人民大道201号', visited: true },
    ];
    const app = { globalData: { map: { code: 'MAP123', name: '地图' } } };
    const runtime = createRuntime({
      app,
      wx: { getStorageSync: () => undefined, setStorageSync() {} },
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: { listPlaces: async () => places } } },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({ places, activeCategories: ['景点', '美食', '展馆'] });

    // 名称命中（前后空格先 trim）
    page.onSearchInput({ detail: { value: '  武康  ' } });
    assert.equal(page.data.searchKeyword, '  武康  ');
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '1');
    assert.equal(page.data.markers.map((m) => m.id).join(','), '1', 'markers 与列表共用同一份 filtered');

    // tags 不区分大小写（字符串形式的 tags 也能命中）
    page.onSearchInput({ detail: { value: 'brunch' } });
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '2');

    // address / category 也在匹配范围内
    page.onSearchInput({ detail: { value: '人民大道' } });
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '3');
    page.onSearchInput({ detail: { value: '美食' } });
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '2');

    // 空关键词恢复全部（默认 newest：id 倒序）
    page.onSearchInput({ detail: { value: '' } });
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '3,2,1');

    // 与分类筛选叠加：只留「美食 / 展馆」时，命中的「景点」被挡掉
    page.setData({ activeCategories: ['美食', '展馆'] });
    page.onSearchInput({ detail: { value: '武康' } });
    assert.equal(page.data.filtered.length, 0);
    page.onSearchInput({ detail: { value: '人民大道' } });
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '3');

    // 与「只看还没去的」叠加
    page.setData({ activeCategories: ['景点', '美食', '展馆'], hideVisitedOnly: true });
    page.onSearchInput({ detail: { value: '' } });
    assert.equal(page.data.filtered.map((p) => p.id).join(','), '2,1');

    // 清除搜索（先关掉「只看还没去的」，只验证关键词这一层）
    page.setData({ hideVisitedOnly: false });
    page.onSearchInput({ detail: { value: '武康' } });
    assert.equal(page.data.filtered.length, 1);
    page.clearSearch();
    assert.equal(page.data.searchKeyword, '');
    assert.equal(page.data.filtered.length, 3);

    // 下拉刷新（force）后清空关键词：列表不能还停在上一次的搜索结果里
    page.onSearchInput({ detail: { value: '武康' } });
    await page.loadPlaces(true);
    assert.equal(page.data.searchKeyword, '');
    assert.equal(page.data.filtered.length, 3);

    // 切换地图后同样清空关键词
    page.onSearchInput({ detail: { value: '武康' } });
    app.globalData.map = { code: 'MAP456', name: '新地图' };
    await page.loadPlaces();
    assert.equal(page.data.searchKeyword, '');
  });

  it('随机抽取：只在选中的分类里抽，候选为空时只提示不开动画', async () => {
    const toasts = [];
    const runtime = createRuntime({
      wx: {
        getStorageSync: () => undefined,
        setStorageSync() {},
        showToast: (options) => toasts.push(options.title),
      },
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: {} } },
    });
    const page = runtime.page('pages/index/index.js');
    page.setData({
      places: [
        { id: 1, name: '武康大楼', category: '景点' },
        { id: 2, name: '老吉士酒家', category: '美食' },
        { id: 3, name: '南翔小笼', category: '美食' },
      ],
    });

    page.toggleRandomCat({ currentTarget: { dataset: { id: '美食' } } });
    assert.equal(page.data.randomScope, '从 美食 中随机选择');
    assert.equal(page.randomCandidates().map((p) => p.id).join(','), '2,3');

    page.drawRandom();
    assert.equal(page.data.randomOpen, true);
    assert.equal(page.data.randomDrawing, true);
    await new Promise((resolve) => setTimeout(resolve, 2600)); // 等 2.4s 滚动动画跑完
    assert.equal(page.data.randomDrawing, false);
    assert.equal(page.data.randomPlace.category, '美食');
    assert.equal(toasts.length, 0);

    // 选中的分类里没有地点：只提示、不开抽奖动画（面板仍打开，用户能直接改分类）
    page.applyRandomCats(['购物']);
    const drawn = page.data.randomPlace;
    page.drawRandom();
    assert.equal(page.data.randomDrawing, false);
    assert.equal(page.data.randomPlace, drawn, '没有候选时不应重新滚动');
    assert.equal(page.data.randomOpen, true);
    assert.equal(toasts.at(-1), '这个分类下还没有地点');
  });

  it('随机抽取：分类选择写在本地存储，脏数据回落「全部」', () => {
    const values = new Map();
    const runtime = createRuntime({
      wx: { getStorageSync: (key) => values.get(key), setStorageSync: (key, value) => values.set(key, value) },
      modules: { [path.join(miniRoot, 'utils/api.js')]: { api: {} } },
    });
    const page = runtime.page('pages/index/index.js');
    assert.equal(page.data.randomCats.length, 0, '默认「全部」');
    assert.equal(page.data.randomScope, '从全部地点中随机选择');

    page.toggleRandomCat({ currentTarget: { dataset: { id: '美食' } } });
    page.toggleRandomCat({ currentTarget: { dataset: { id: '娱乐' } } });
    assert.equal(page.data.randomCats.join(','), '美食,娱乐');
    assert.equal(values.get('wish-random-cats').join(','), '美食,娱乐');
    assert.equal(page.data.randomScope, '从 美食 · 娱乐 中随机选择');

    // 再点一次同一个分类 = 取消；「全部」= 清空
    page.toggleRandomCat({ currentTarget: { dataset: { id: '美食' } } });
    assert.equal(page.data.randomCats.join(','), '娱乐');
    page.toggleRandomCat({ currentTarget: { dataset: { id: '全部' } } });
    assert.equal(page.data.randomCats.length, 0);
    assert.equal(values.get('wish-random-cats').length, 0);
    assert.equal(page.data.randomScope, '从全部地点中随机选择');

    // 冷启动（onLoad）从存储恢复
    values.set('wish-random-cats', ['购物']);
    page.restoreRandomCats();
    assert.equal(page.data.randomCats.join(','), '购物');

    // 存储里是脏数据（已下线的分类 / 不是数组）时当成「全部」
    values.set('wish-random-cats', ['不存在的分类']);
    page.restoreRandomCats();
    assert.equal(page.data.randomCats.length, 0);
    values.set('wish-random-cats', '美食');
    page.restoreRandomCats();
    assert.equal(page.data.randomCats.length, 0);
  });

  it('添加地点：重复被拒时弹「已经添加过了」，保存按钮复位', async () => {
    const modals = [];
    const navs = [];
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: {
        showToast() {},
        navigateTo: (options) => navs.push(options.url),
        showModal: (options) => {
          modals.push(options);
          if (options.success) options.success({ confirm: true });
        },
      },
      modules: {
        [path.join(miniRoot, 'utils/auth.js')]: { requireIdentity: async () => '同学' },
        [path.join(miniRoot, 'utils/identity-behavior.js')]: {},
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            createPlace: async () => {
              // 服务端 409 契约（api.js 只透传 message / code）
              const error = new Error('地图里已经有「武康大楼」了');
              error.code = 'DUPLICATE_PLACE';
              error.status = 409;
              error.duplicate = { id: 12, name: '武康大楼' };
              error.trashed = { id: 7, name: '武康大楼' };
              throw error;
            },
          },
          setAuthRecovery() {},
        },
      },
    });
    const page = runtime.page('pages/search/search.js');
    page.setData({
      picked: { name: '武康大楼', address: '淮海中路1850号', latitude: 31.2054, longitude: 121.4375 },
      name: '武康大楼',
      category: '景点',
    });
    await page.save();

    assert.equal(modals.length, 1);
    assert.equal(modals[0].title, '已经添加过了');
    assert.equal(modals[0].confirmText, '去看看');
    assert.equal(modals[0].cancelText, '知道了');
    assert.match(modals[0].content, /地图里已经有「武康大楼」了/);
    assert.match(modals[0].content, /回收站里也有一个同名的/);
    assert.equal(navs.join(','), '/pages/detail/detail?placeId=12');
    assert.equal(page.data.saving, false, '失败后按钮要恢复可点');
    assert.equal(page.submitting, false);
  });

  it('添加地点：服务端没给 duplicate 时，用本地缓存回查也能「去看看」', async () => {
    const navs = [];
    const runtime = createRuntime({
      app: { globalData: { map: { code: 'MAP123', name: '地图' } } },
      wx: {
        showToast() {},
        navigateTo: (options) => navs.push(options.url),
        showModal: (options) => { if (options.success) options.success({ confirm: true }); },
      },
      modules: {
        [path.join(miniRoot, 'utils/auth.js')]: { requireIdentity: async () => '同学' },
        [path.join(miniRoot, 'utils/identity-behavior.js')]: {},
        [path.join(miniRoot, 'utils/cache.js')]: {
          readPlaces: (code) => (code === 'MAP123'
            ? { places: [{ id: 8, name: ' 武康大楼 ' }, { id: 9, name: '别的地方' }] }
            : null),
        },
        [path.join(miniRoot, 'utils/api.js')]: {
          api: {
            createPlace: async () => {
              const error = new Error('地图里已经有「武康大楼」了');
              error.code = 'DUPLICATE_PLACE';
              throw error;
            },
          },
          setAuthRecovery() {},
        },
      },
    });
    const page = runtime.page('pages/search/search.js');
    page.setData({
      picked: { name: '武康大楼', address: '', latitude: 31.2054, longitude: 121.4375 },
      name: '武康大楼',
    });
    await page.save();
    // 缓存里的同名地点忽略大小写/首尾空格（与服务端同一套判定）
    assert.equal(navs.join(','), '/pages/detail/detail?placeId=8');
  });
});
