/* ==========================================================================
   sw.js — 全站预缓存 + 10 分钟后台刷新
   ------------------------------------------------------------------------
   为什么要这个：站挂在腾讯云 EdgeOne 香港节点上，国内直连一个往返 120ms 起，
   链路抖动时单次请求会飙到 0.5~2 秒。HTTP 缓存能省掉「发请求」，
   但 subs.json / HTML 这类需要按时间刷新的东西总有到期的时候，
   到期那一下就要吃一次跨境往返。

   Service Worker 把这一层接管过来：
     · 首次访问时在后台把 12 个页面 + 2 个索引 JSON 全部拉一遍（预缓存）
     · 之后所有导航、数据请求一律**先给缓存**（0ms），永不阻塞
     · 缓存超过 10 分钟就在**后台**悄悄换新，用户下一次导航才用上
     · `/assets/*` 带版本号，永久缓存（改代码时 HTML 里的 ?v= 会变，自然是新文件）

   所以用户感受到的是：第一次进站慢一点，之后每一次点都是瞬间。

   ⚠️ 千万别让它接管这几个路径：
     · /api/*          —— 下载次数要实时
     · /files/subs/*   —— 下载计数中间件必须收到请求
     · /admin/ /games/admin/ —— 管理后台永远要最新的

   想强制让所有访客丢掉旧缓存：把下面的 VERSION 改一下即可（activate 会清旧表）。
   ========================================================================== */

const VERSION = 'v1';
const CACHE = 'bqtj-' + VERSION;
const TTL = 10 * 60 * 1000;          // 10 分钟

/* 预缓存的页面壳（数据是靠 JS 拉 subs.json/games.json 渲染的，壳很小） */
const SHELLS = [
  '/',
  '/index.html',
  '/subs/',
  '/subs/index.html',
  '/subs/detail/',
  '/subs/lyrics/',
  '/games/',
  '/games/index.html',
  '/games/detail.html',
  '/about',
  '/about.html',
  '/404.html',
];

/* 预缓存的数据索引 */
const DATA = ['/assets/data/subs.json', '/assets/data/games.json'];

/* 这些路径一律走网络，不进 SW 缓存 */
const SKIP = [
  /^\/api\//,
  /^\/files\/subs\//,
  /^\/admin(\/|$)/,
  /^\/games\/admin(\/|$)/,
  /^\/sw\.js$/,
];

/* ---------------------------- 安装：预缓存 ---------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // 逐个加，单个失败（比如某个页面 404）不影响整体
      await Promise.all(
        [...SHELLS, ...DATA].map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
        )
      );
      await self.skipWaiting();
    })()
  );
});

/* ---------------------------- 激活：清旧表 ---------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith('bqtj-') && k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

/* 后台换新：失败就保持旧副本，绝不抛错给页面 */
async function refresh(cache, key, url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res && res.status === 200) await cache.put(key, res.clone());
  } catch (_) {
    /* 离线 / 超时：继续用旧副本 */
  }
}

/* ---------------------------- 拦截 ---------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (SKIP.some((re) => re.test(url.pathname))) return;

  const isNav = req.mode === 'navigate';
  const isData = url.pathname.startsWith('/assets/data/');
  // css / js 的 URL 里带 ?v=，改了代码版本号就变，所以可以永久缓存；
  // img 没有版本号（logo.png 会被直接覆盖），必须跟其它内容一样按 TTL 刷新。
  const isVersioned = /^\/assets\/(css|js)\//.test(url.pathname);
  const isAsset = isVersioned || url.pathname.startsWith('/assets/img/');
  if (!isNav && !isData && !isAsset) return;

  // 导航页按「路径」存（?id=xxx 的详情页共用一个壳）；
  // 资源必须带 ?v= 存，否则新版本会命中旧文件。
  const key = isNav ? new Request(url.origin + url.pathname) : req;
  const matchOpts = isNav ? { ignoreSearch: true } : {};

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(key, matchOpts);

      if (hit) {
        if (!isVersioned) {
          const t = Date.parse(hit.headers.get('date') || '');
          if (!Number.isFinite(t) || Date.now() - t >= TTL) {
            try {
              event.waitUntil(refresh(cache, key, url.href));
            } catch (_) { /* 事件已结束就放弃这次后台刷新 */ }
          }
        }
        return hit;
      }

      const res = await fetch(req);
      if (res && res.ok) event.waitUntil(cache.put(key, res.clone()));
      return res;
    })()
  );
});
