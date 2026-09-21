// 一次性脚本：核对线上是否已经是新版前端（部署约 1 分钟，查不到就等会儿再跑）
// key 以 ! 开头表示「必须不包含」
//
// 注意：资源必须查**带 ?v= 的地址**。
// /assets/* 在 _headers 里是 max-age=31536000, immutable —— 无参数的旧地址会被
// Cloudflare 边缘缓存一年，部署完也一直返回旧副本（实测），拿它做判断会误报「没更新」。
// 访客实际请求的就是带版本号的地址，那才是该核对的东西。
const BASE = 'https://bqtj.pages.dev';
const CHECKS = [
  ['/assets/css/style.css?v=16', ['.filepick', '.drive-pick', '.link-code', '.send-toast', '.more-menu.drop-up', '.gd-drive', '.gd-cover', '.gd-sec', '.gd-drive-code', '.textarea', '!more-code', '!game-actions', '!game-shots', '!more-hint']],
  ['/assets/js/site.js?v=14', ['function setNav', 'navBackdrop', "classList.toggle('drop-up'", 'copyCodeOnOpen', 'bindDriveCodeCopy', 'gameLinksOf', 'gameDetailUrl', 'siteToast', 'legacyCopy']],
  // 列表页整张卡就是一个进详情页的链接：下载按钮、菜单、提取码按钮全删了。
  // ⚠️ 负向检查必须选**不会出现在注释里的写法**（`let dlHTML` / `bindMoreMenu(` 而不是裸的
  // `dlHTML` / `bindMoreMenu`）—— 代码注释里会解释「这里不再需要 dlHTML」，
  // 用裸标识符查必误报（这个坑踩过两次：一次是中文文案，一次就是这个）。
  ['/assets/js/games.js?v=7', ['gameDetailUrl', 'gameLinksOf', '还没填下载链接', '!let dlHTML', '!bindMoreMenu(', '!data-act="more"', '!data-copy', '!shotsHTML', '!codesOf']],
  ['/assets/js/game-detail.js?v=2', ['gameLinksOf', 'bindDriveCodeCopy', 'gd-drive-code', '无需提取码', 'gd-drives', 'lightbox', '详细介绍']],
  ['/assets/js/admin.js?v=5', ['sendState', 'netError', 'data-name', 'withShaRetry']],
  ['/assets/js/games-admin.js?v=9', ['sendState', 'withShaRetry', 'LIST_PWD', 'link-code', '无需码', 'gDetail', '看详情']],
  ['/assets/js/config.js?v=4', ['defaultExtractCode']],
  // 搜索只能匹配看得见的内容：haystack 里不能再出现原始文件名 / path（见 subs.js 注释）
  ['/assets/js/subs.js?v=4', ['matchKeywords', 'search-scope: name + desc + ext', '!item.path', '!item.file']],
  ['/games/admin/', ['listPwd', 'sendToast', 'gDetail', 'style.css?v=16', 'site.js?v=14', 'config.js?v=4', 'games-admin.js?v=9']],
  ['/admin/', ['sendToast', 'style.css?v=16', 'site.js?v=14', 'config.js?v=4', 'admin.js?v=5']],
  ['/games/', ['按自己喜好下载', '仅供学习交流', '请勿用于商业用途', '如有侵权请联系删除', '点卡片进详情页', '会自动复制到剪贴板', 'style.css?v=16', 'site.js?v=14', 'games.js?v=7', '!复制提取码', '!选择云盘下载']],
  ['/games/detail.html?id=gmu9cq47yr2q', ['game-detail.js?v=2', 'site.js?v=14', 'gdBox', 'lightbox']],
  ['/subs/', ['style.css?v=16', 'site.js?v=14', 'subs.js?v=4']],
  ['/', ['style.css?v=16', 'site.js?v=14']],
  [
    '/about',
    [
      'space.bilibili.com/1421373636',
      '3357075023',
      '能帮上一点忙就挺好',
      '想委托翻译',
      'B 站私信',
      '国内因后缀强制重置导致连不上',
      '只有一个自建的下载计数',
      '整理了 ASS / SRT 格式的字幕文件',
      'style.css?v=16',
      'site.js?v=14',
      'config.js?v=4',
      '!SSA',
      '!VTT',
      '!爆枪突击的字幕',
      '!如需转载',
      '!想投稿',
      '!只有一个东西',
      '!无第三方统计',
    ],
  ],
];

// 每个页面的左上角 logo 都要指向 B 站主页
const BRAND = 'href="https://space.bilibili.com/1421373636" target="_blank" rel="noopener"';
const BRAND_PAGES = ['/', '/subs/', '/games/', '/games/detail.html', '/about', '/admin/', '/games/admin/', '/404.html'];

let bad = 0;
for (const [path, keys] of CHECKS) {
  const res = await fetch(BASE + path, { cache: 'no-store' });
  const text = await res.text();
  const miss = keys.filter((k) => (k.startsWith('!') ? text.includes(k.slice(1)) : !text.includes(k)));
  if (miss.length) bad++;
  console.log(
    `${String(res.status).padEnd(4)} ${path.padEnd(26)} ${miss.length ? '✗ ' + miss.join(', ') : '✓ 全部命中'}`
  );
}

for (const path of BRAND_PAGES) {
  const res = await fetch(BASE + path, { cache: 'no-store' });
  const text = await res.text();
  const ok = text.includes(BRAND);
  if (!ok) bad++;
  console.log(
    `${String(res.status).padEnd(4)} ${(path + ' (logo)').padEnd(26)} ${ok ? '✓ 指向 B 站' : '✗ logo 还不是 B 站链接'}`
  );
}

console.log(bad ? `\n${bad} 项还没更新完，等 1 分钟再跑一次` : '\n线上已全部是新版');
