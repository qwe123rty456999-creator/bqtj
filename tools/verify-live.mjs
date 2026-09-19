// 一次性脚本：核对线上是否已经是新版前端（部署约 1 分钟，查不到就等会儿再跑）
const BASE = 'https://bqtj.pages.dev';
const CHECKS = [
  ['/assets/css/style.css', ['.filepick', '.filepick-name', 'nav-backdrop', 'rgba(0, 0, 0, 0.55)']],
  ['/assets/js/site.js', ['function setNav', 'navBackdrop', "btn.textContent = open ? '关闭' : '菜单'"]],
  ['/assets/js/games-admin.js', ['setPickName', "closest('[data-pick]')"]],
  ['/games/admin/', ['data-pick="gCover"', 'data-pick="gShots"', 'filepick-name', 'style.css?v=10', 'site.js?v=11', 'games-admin.js?v=4']],
  ['/games/', ['style.css?v=10', 'site.js?v=11', 'games.js?v=3']],
  ['/subs/', ['style.css?v=10', 'site.js?v=11', 'subs.js?v=3']],
  ['/admin/', ['style.css?v=10', 'site.js?v=11', 'admin.js?v=3']],
  ['/', ['style.css?v=10', 'site.js?v=11']],
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
