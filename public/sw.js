/* 魔都·Explore Service Worker
   策略：核心静态资源预缓存 + stale-while-revalidate；API 一律走网络；跨域直通 */

const CACHE_NAME = 'wishmap-static-v9';
const CORE_ASSETS = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/js/api.js',
  '/js/map.js',
  '/js/photos.js',
  '/js/poster.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  // cache:'reload' 绕过浏览器 HTTP 强缓存，确保发版后拿到的一定是新资源
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        Promise.all(
          CORE_ASSETS.map(async (url) => {
            const response = await fetch(url, { cache: 'reload' });
            if (response.ok) await cache.put(url, response);
          })
        )
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // 高德等第三方直通
  if (url.pathname.startsWith('/api/')) return; // 接口不缓存

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cached = await cache.match(request, { ignoreSearch: true });
      // waitUntil 保证 respondWith 返回缓存后 SW 不被提前杀死，后台更新才能落盘
      const network = fetch(request)
        .then((response) => {
          if (response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      event.waitUntil(network);
      // 有缓存先用缓存，同时后台更新；离线且无缓存时返回网络错误兜底
      return cached || (await network) || new Response('离线且无缓存', { status: 504 });
    })()
  );
});
