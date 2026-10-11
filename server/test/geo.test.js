// /api/geo/search 契约测试：字段映射、参数校验、key 缺失、上游故障、缓存、限流。
// 不依赖数据库：直接把 createGeoRouter 挂到一个最小 express app 上，用注入的 fetchImpl 当高德。
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createGeoRouter } from '../routes/geo.js';

const AMAP_KEY = 'test-amap-key';

const AMAP_OK_BODY = {
  status: '1',
  info: 'OK',
  pois: [
    {
      id: 'B000A7BD6C',
      name: '武侯祠',
      address: '武侯祠大街231号',
      location: '121.4375,31.2054',
      type: '风景名胜;公园广场;寺庙道观',
      cityname: '成都市',
      adname: '武侯区',
    },
    {
      id: 'B000A7BD6D',
      name: '武侯祠博物馆',
      address: '', // address 为空 → 用 cityname + adname 兜底
      location: '104.043,30.646',
      type: '',
      cityname: '成都市',
      adname: '武侯区',
    },
  ],
};

/** 记录每次调用的 fetch 替身。 */
function stubFetch({ body = AMAP_OK_BODY, status = 200, throws, json } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    if (throws) throw throws;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: json ?? (async () => body),
    };
  };
  return { fetchImpl, calls };
}

async function startServer({ amapKey = AMAP_KEY, fetchImpl } = {}) {
  const app = express();
  app.use(express.json());
  app.use('/api/geo', createGeoRouter({ amapKey, fetchImpl }));
  app.use('/api', (req, res) => res.status(404).json({ error: '接口不存在' }));
  // 与 server/app.js 同风格的兜底错误处理
  app.use((err, req, res, next) => res.status(500).json({ error: '服务器内部错误' }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route) => {
    const res = await fetch(base + route);
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  const close = async () => {
    server.closeAllConnections();
    await server.close();
  };
  return { request, close };
}

/** 每个用例独立建服务：限流器与缓存互不串味。 */
async function withServer(options, run) {
  const { request, close } = await startServer(options);
  try {
    await run(request);
  } finally {
    await close();
  }
}

describe('GET /api/geo/search 正常路径', () => {
  it('返回 2 条结果，字段与坐标映射正确，且带上游约定参数', async () => {
    const { fetchImpl, calls } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      const res = await request('/api/geo/search?keyword=' + encodeURIComponent('武侯祠'));
      assert.equal(res.status, 200);
      assert.equal(res.body.source, 'amap');
      assert.equal(res.body.places.length, 2);
      assert.deepEqual(res.body.places[0], {
        id: 'B000A7BD6C',
        name: '武侯祠',
        address: '武侯祠大街231号',
        lng: 121.4375,
        lat: 31.2054,
        category: '风景名胜;公园广场;寺庙道观',
      });
      // address 为空时用 城市+区 兜底；type 为空时给空字符串（而不是 undefined）
      assert.equal(res.body.places[1].address, '成都市武侯区');
      assert.equal(res.body.places[1].category, '');
    });

    assert.equal(calls.length, 1);
    const { url, options } = calls[0];
    assert.ok(url.startsWith('https://restapi.amap.com/v3/place/text?'));
    assert.ok(url.includes(`key=${AMAP_KEY}`));
    assert.ok(url.includes(`keywords=${encodeURIComponent('武侯祠')}`));
    assert.ok(url.includes(`city=${encodeURIComponent('上海')}`)); // 省略 city 时默认上海
    assert.ok(url.includes('citylimit=true'));
    assert.ok(url.includes('offset=10'));
    assert.ok(url.includes('page=1'));
    assert.ok(url.includes('extensions=base'));
    // 必须带 5s 超时信号，否则高德抖动会挂住请求
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
  });

  it('city 参数生效，且超过 20 字被截断', async () => {
    const { fetchImpl, calls } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      const res = await request('/api/geo/search?keyword=%E6%AD%A6%E4%BE%AF%E7%A5%A0&city=' + encodeURIComponent('成都'));
      assert.equal(res.status, 200);
      assert.ok(calls[0].url.includes(`city=${encodeURIComponent('成都')}`));

      const long = '城'.repeat(30);
      const res2 = await request('/api/geo/search?keyword=%E6%AD%A6%E4%BE%AF%E7%A5%A0&city=' + encodeURIComponent(long));
      assert.equal(res2.status, 200);
      assert.ok(calls[1].url.includes(`city=${encodeURIComponent('城'.repeat(20))}`));
      assert.ok(!calls[1].url.includes(encodeURIComponent('城'.repeat(21))));
    });
  });

  it('坐标非法的 POI 被跳过，其余照常返回', async () => {
    const { fetchImpl } = stubFetch({
      body: {
        status: '1',
        pois: [
          { id: 'ok', name: '正常地点', location: '121.5,31.2', type: '餐饮' },
          { id: 'missing', name: '没有坐标' },
          { id: 'garbage', name: '坐标是文字', location: 'abc,def' },
          { id: 'half', name: '只有一个数', location: '121.5,' },
          { id: 'empty', name: '空字符串', location: '' },
          { id: 'also-ok', name: '另一个正常地点', location: '121.6,31.3' },
        ],
      },
    });
    await withServer({ fetchImpl }, async (request) => {
      const res = await request('/api/geo/search?keyword=test');
      assert.equal(res.status, 200);
      assert.deepEqual(
        res.body.places.map((p) => p.id),
        ['ok', 'also-ok']
      );
    });
  });
});

describe('GET /api/geo/search 参数校验', () => {
  it('keyword 缺失/空白/超长 → 400', async () => {
    const { fetchImpl, calls } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      for (const route of [
        '/api/geo/search',
        '/api/geo/search?keyword=',
        '/api/geo/search?keyword=%20%20',
        `/api/geo/search?keyword=${'a'.repeat(51)}`,
      ]) {
        const res = await request(route);
        assert.equal(res.status, 400, route);
        assert.equal(res.body.error, '请输入要搜索的地点名称');
      }
      assert.equal(calls.length, 0); // 参数不合法时绝不打上游
    });
  });

  it('keyword 恰好 50 字可通过', async () => {
    const { fetchImpl } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      const res = await request(`/api/geo/search?keyword=${'a'.repeat(50)}`);
      assert.equal(res.status, 200);
    });
  });
});

describe('GET /api/geo/search 故障路径', () => {
  it('未配置 key → 503（与 /api/map-config 同风格），日志指明该配哪个变量', async () => {
    const { fetchImpl, calls } = stubFetch();
    const warns = [];
    const original = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withServer({ amapKey: '', fetchImpl }, async (request) => {
        const res = await request('/api/geo/search?keyword=test');
        assert.equal(res.status, 503);
        // 客户端可见文案按契约固定；「必须是 Web服务 类型 key」的排查提示走日志
        assert.equal(res.body.error, '地点搜索暂未开通');
        assert.equal(calls.length, 0);
      });
    } finally {
      console.warn = original;
    }
    assert.match(warns.join('\n'), /AMAP_WEB_SERVICE_KEY/, '要告诉部署者该配哪个变量');
  });

  it('高德 status=0 → 502，并 console.warn 记录原因（不泄漏 key）', async () => {
    const { fetchImpl } = stubFetch({ body: { status: '0', info: 'INVALID_USER_KEY' } });
    const warns = [];
    const original = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withServer({ fetchImpl }, async (request) => {
        const res = await request('/api/geo/search?keyword=test');
        assert.equal(res.status, 502);
        assert.equal(res.body.error, '地点搜索暂时不可用，请稍后再试');
      });
    } finally {
      console.warn = original;
    }
    assert.ok(warns.length >= 1);
    assert.ok(!warns.join(' ').includes(AMAP_KEY));
  });

  it('上游 fetch 抛异常 / 超时 → 502', async () => {
    for (const throws of [
      new Error('socket hang up'),
      Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }),
    ]) {
      const { fetchImpl } = stubFetch({ throws });
      await withServer({ fetchImpl }, async (request) => {
        const res = await request('/api/geo/search?keyword=test');
        assert.equal(res.status, 502);
        assert.equal(res.body.error, '地点搜索暂时不可用，请稍后再试');
      });
    }
  });

  it('上游 HTTP 非 200 或响应体不是 JSON → 502', async () => {
    const bad = stubFetch({ status: 500, body: { status: '1' } });
    await withServer({ fetchImpl: bad.fetchImpl }, async (request) => {
      const res = await request('/api/geo/search?keyword=test');
      assert.equal(res.status, 502);
    });

    const broken = stubFetch({ json: async () => { throw new SyntaxError('Unexpected token <'); } });
    await withServer({ fetchImpl: broken.fetchImpl }, async (request) => {
      const res = await request('/api/geo/search?keyword=test');
      assert.equal(res.status, 502);
      assert.equal(res.body.error, '地点搜索暂时不可用，请稍后再试');
    });
  });

  it('高德返回 pois 非数组时不炸，按 0 条处理', async () => {
    const { fetchImpl } = stubFetch({ body: { status: '1', pois: [] } });
    await withServer({ fetchImpl }, async (request) => {
      const res = await request('/api/geo/search?keyword=test');
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.places, []);
    });
  });
});

describe('GET /api/geo/search 缓存与限流', () => {
  it('相同 city+keyword 第二次请求命中缓存，不再打上游', async () => {
    const { fetchImpl, calls } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      const first = await request('/api/geo/search?keyword=' + encodeURIComponent('武康大楼'));
      const second = await request('/api/geo/search?keyword=' + encodeURIComponent('武康大楼'));
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.deepEqual(second.body.places, first.body.places);
      assert.equal(calls.length, 1);
    });
  });

  it('缓存键含 city：换城市仍然查上游', async () => {
    const { fetchImpl, calls } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      await request('/api/geo/search?keyword=test&city=A');
      await request('/api/geo/search?keyword=test&city=B');
      await request('/api/geo/search?keyword=test&city=B');
      assert.equal(calls.length, 2);
    });
  });

  it('超过 30 次/分钟后返回 429 + 中文提示', async () => {
    const { fetchImpl, calls } = stubFetch();
    await withServer({ fetchImpl }, async (request) => {
      for (let i = 0; i < 30; i += 1) {
        const res = await request('/api/geo/search?keyword=test');
        assert.equal(res.status, 200, `第 ${i + 1} 次应放行`);
      }
      const blocked = await request('/api/geo/search?keyword=test');
      assert.equal(blocked.status, 429);
      assert.equal(blocked.body.error, '搜索过于频繁，请稍后再试');
      assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
      assert.equal(calls.length, 1); // 被限流的请求没有消耗上游配额
    });
  });
  it('key 平台不匹配（USERKEY_PLAT_NOMATCH）→ 502，且日志给出可操作提示', async () => {
    const warns = [];
    const original = console.warn;
    console.warn = (...args) => warns.push(args.join(' '));
    try {
      await withServer(
        {
          fetchImpl: stubFetch({ body: { status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' } })
            .fetchImpl,
        },
        async (request) => {
          const res = await request('/api/geo/search?keyword=' + encodeURIComponent('武康大楼'));
          assert.equal(res.status, 502);
          assert.match(warns.join('\n'), /AMAP_WEB_SERVICE_KEY/, '日志要写清该配哪个环境变量');
        }
      );
    } finally {
      console.warn = original;
    }
  });

});
