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

   ⚠️ 哪些路径**不**接管（或特殊处理）：
     · /api/counts     —— 例外，进缓存但只缓存 60 秒（只是下载次数徽章，晚 1 分钟无感）
     · 其它 /api/*     —— 一律放行，不进缓存
     · /files/subs/*   —— 下载计数中间件必须收到真实请求，绝不缓存
     · /admin/ /games/admin/ —— 管理后台永远要最新的

   想强制让所有访客丢掉旧缓存：把下面的 VERSION 改一下即可（activate 会清旧表）。
   ========================================================================== */

const VERSION = 'v16';
const CACHE = 'bqtj-' + VERSION;
const TTL = 10 * 60 * 1000;          // 10 分钟：页面 / 索引 / 图片
const TTL_COUNTS = 60 * 1000;        // 60 秒：下载次数（变化快，但晚 1 分钟无感）

/* 预缓存的页面壳（数据是靠 JS 拉 subs.json/games.json 渲染的，壳很小）
   ⚠️ 这里只写「不会 302 的规范地址」。Cloudflare Pages 会自动把 /xxx.html
   重定向到 /xxx（/about.html → /about、/games/detail.html → /games/detail），
   而 cache.add() 遇到重定向会直接 reject —— 之前列表里写了 12 条 .html，
   实际有一半装不进去。现在靠下面的 navKey() 把 .html 归一到同一个键。 */
const SHELLS = [
  '/',
  '/subs/',
  '/subs/detail/',
  '/subs/lyrics/',
  '/games/',
  '/games/detail',
  '/about',
  '/404.html',
];

/* 页面壳的缓存键：把各种写法归一到同一个
   /index.html → /            /subs/index.html → /subs/
   /games/detail.html → /games/detail        /about.html → /about */
function navKey(pathname) {
  if (pathname === '/index.html') return '/';
  if (pathname.endsWith('/index.html')) return pathname.slice(0, -'index.html'.length);
  if (pathname.endsWith('.html') && pathname !== '/404.html') return pathname.slice(0, -'.html'.length);
  return pathname;
}

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

/** 后台换新：失败就保持旧副本，绝不抛错给页面 */
async function refresh(cache, key, url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res && res.status === 200) await cache.put(key, res.clone());
  } catch (_) {
    /* 离线 / 超时：继续用旧副本 */
  }
}

/** 存副本；任何失败都吞掉（存不下也不该让页面报错） */
async function remember(cache, key, res) {
  try {
    if (res && res.ok) await cache.put(key, res.clone());
  } catch (_) { /* ignore */ }
}

/* ---------------------------- 拦截 ---------------------------- */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // /api/counts 例外：它只是个下载次数徽章，进缓存用 60 秒 TTL。
  // 其它 /api/* 仍然一律放行（以后加别的接口默认不回缓存）。
  const isCounts = url.pathname === '/api/counts';
  if (!isCounts && SKIP.some((re) => re.test(url.pathname))) return;

  const isNav = req.mode === 'navigate';
  const isData = url.pathname.startsWith('/assets/data/');
  // css / js 的 URL 里带 ?v=，改了代码版本号就变，所以可以永久缓存；
  // img 没有版本号（logo.png 会被直接覆盖），必须跟其它内容一样按 TTL 刷新。
  const isVersioned = /^\/assets\/(css|js)\//.test(url.pathname);
  const isAsset = isVersioned || url.pathname.startsWith('/assets/img/');
  if (!isNav && !isData && !isAsset && !isCounts) return;

  const ttl = isCounts ? TTL_COUNTS : TTL;

  // 导航页按「归一化后的路径」存（?id=xxx 的详情页共用一个壳，
  // /games/detail.html 和 /games/detail 也共用一个）；
  // 资源必须带 ?v= 存，否则新版本会命中旧文件。
  const key = isNav ? new Request(url.origin + navKey(url.pathname)) : req;
  const matchOpts = isNav ? { ignoreSearch: true } : {};

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        const hit = await cache.match(key, matchOpts);

        if (hit) {
          if (!isVersioned) {
            const t = Date.parse(hit.headers.get('date') || '');
            if (!Number.isFinite(t) || Date.now() - t >= ttl) {
              try {
                event.waitUntil(refresh(cache, key, url.href));
              } catch (_) { /* 事件已结束就放弃这次后台刷新 */ }
            }
          }
          return hit;
        }

        // ⚠️⚠️ 这里绝对不能写 fetch(req)。
        // 导航请求的 mode 是 'navigate'，而 fetch() 规范上不允许 mode 为 navigate 的
        // Request → 直接抛 TypeError → respondWith 变成 rejected → 浏览器只会显示
        // 「ERR_FAILED / 无法访问此页面」。2026-10-17 就是这样把 /games/detail.html?id=…
        // 整页打挂的（命中预缓存时不会走到这里，所以只有"没缓存到的那几个页面"会中招）。
        // 用 url.href（字符串）重建请求就没这个问题。
        const res = await fetch(url.href);
        try {
          event.waitUntil(remember(cache, key, res));
        } catch (_) { /* ignore */ }
        return res;
      } catch (_) {
        // 任何意外都退回直接请求网络：宁可慢一点，也绝不能让页面白屏
        return fetch(url.href);
      }
    })()
  );
});
