// 一次性脚本：核对线上是否已经是新版前端（部署约 1 分钟，查不到就等会儿再跑）
// key 以 ! 开头表示「必须不包含」
const BASE = 'https://bqtj.pages.dev';
const CHECKS = [
  ['/assets/css/style.css', ['.filepick', '.drive-pick', '.link-code', '.more-code', '.send-toast', '.more-menu.drop-up']],
  ['/assets/js/site.js', ['function setNav', 'navBackdrop', "classList.toggle('drop-up'"]],
  ['/assets/js/games.js', ['toggleCard', 'codesOf', 'more-code', 'legacyCode', '无需提取码']],
  ['/assets/js/admin.js', ['sendState', 'netError', 'data-name', 'withShaRetry']],
  ['/assets/js/games-admin.js', ['sendState', 'withShaRetry', 'LIST_PWD', 'link-code', '无需码']],
  ['/assets/js/config.js', ['defaultExtractCode']],
  ['/games/admin/', ['listPwd', 'sendToast', '无需提取码', 'style.css?v=14', 'site.js?v=12', 'config.js?v=4', 'games-admin.js?v=8']],
  ['/admin/', ['sendToast', 'style.css?v=14', 'site.js?v=12', 'config.js?v=4', 'admin.js?v=5']],
  ['/games/', ['按自己喜好下载', 'style.css?v=14', 'site.js?v=12', 'games.js?v=5']],
  ['/subs/', ['style.css?v=14', 'site.js?v=12', 'subs.js?v=3']],
  ['/', ['style.css?v=14', 'site.js?v=12']],
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
      'style.css?v=14',
      'site.js?v=12',
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
const BRAND_PAGES = ['/', '/subs/', '/games/', '/about', '/admin/', '/games/admin/', '/404.html'];

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
