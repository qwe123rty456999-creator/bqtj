// 一次性脚本：核对线上是否已经是新版前端（部署约 1 分钟，查不到就等会儿再跑）
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
];

let bad = 0;
for (const [path, keys] of CHECKS) {
  const res = await fetch(BASE + path, { cache: 'no-store' });
  const text = await res.text();
  const missing = keys.filter((k) => !text.includes(k));
  if (missing.length) bad++;
  console.log(
    `${String(res.status).padEnd(4)} ${path.padEnd(26)} ${missing.length ? '✗ 缺: ' + missing.join(', ') : '✓ 全部命中'}`
  );
}
console.log(bad ? `\n${bad} 个文件还没更新完，等 1 分钟再跑一次` : '\n线上已全部是新版');
