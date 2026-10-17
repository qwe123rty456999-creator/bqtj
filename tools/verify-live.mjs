// 一次性脚本：核对线上是否已经是新版前端（部署约 1 分钟，查不到就等会儿再跑）
// key 以 ! 开头表示「必须不包含」
//
// 注意：资源必须查**带 ?v= 的地址**。
// /assets/* 在 _headers 里是 max-age=31536000, immutable —— 无参数的旧地址会被
// Cloudflare 边缘缓存一年，部署完也一直返回旧副本（实测），拿它做判断会误报「没更新」。
// 访客实际请求的就是带版本号的地址，那才是该核对的东西。
const BASE = 'https://bqtj.pages.dev';
const CHECKS = [
  ['/assets/css/style.css?v=22', ['.filepick', '.drive-pick', '.link-code', '.send-toast', '.more-menu.drop-up', '.gd-drive', '.gd-cover', '.gd-sec', '.gd-drive-code', '.textarea', '.more-dl', '.dl-hint', '.ly-text', '.mg-lyrics', '.mg-variants', '.sd-thumb', '.sd-sec', '.sd-dl', 'a.file-name', '.hist-btn', '!more-code', '!game-actions', '!game-shots', '!more-hint']],
  ['/assets/js/site.js?v=21', ['function setNav', 'navBackdrop', "classList.toggle('drop-up'", 'copyCodeOnOpen', 'bindDriveCodeCopy', 'gameLinksOf', 'gameDetailUrl', 'siteToast', 'legacyCopy', 'subsVariantsOf', 'lyricsUrl', 'subDetailUrl', 'bindRowClick', '原版歌词预览', "[data-hist]", 'navEnter', 'navGo', 'history.back()', 'history.forward()']],
  // 列表页整张卡就是一个进详情页的链接：下载按钮、菜单、提取码按钮全删了。
  // ⚠️ 负向检查必须选**不会出现在注释里的写法**（`let dlHTML` / `bindMoreMenu(` 而不是裸的
  // `dlHTML` / `bindMoreMenu`）—— 代码注释里会解释「这里不再需要 dlHTML」，
  // 用裸标识符查必误报（这个坑踩过两次：一次是中文文案，一次就是这个）。
  ['/assets/js/games.js?v=7', ['gameDetailUrl', 'gameLinksOf', '还没填下载链接', '!let dlHTML', '!bindMoreMenu(', '!data-act="more"', '!data-copy', '!shotsHTML', '!codesOf']],
  ['/assets/js/game-detail.js?v=3', ['gameLinksOf', 'bindDriveCodeCopy', 'gd-drive-code', '无需提取码', 'gd-drives', 'lightbox', '详细介绍', 'hist-nav', 'data-hist="forward"']],
  // 上传助手：一次一条 + 基本信息 + ASS/SRT 配对；歌词是能往下展开的 textarea
  ['/assets/js/admin.js?v=7', ['sendState', 'netError', 'withShaRetry', 'saveSubEntry', 'uploadVariant', 'removeVariant', 'captureDrafts', 'openRows', 'toggleRow', 'upThumb', "'lyrics'", '!patchSubsIndex', '!renderList(', '!btnUploadAll']],
  ['/assets/js/lyrics.js?v=2', ['subsVariantsOf', 'ly-text', '原版歌词', 'ly-actions', 'hist-nav', '找不到这条字幕']],
  ['/assets/js/sub-detail.js?v=6', ['subsVariantsOf', 'lyricsUrl', 'sd-thumb', 'sd-dl', 'sd-lyric', 'hist-nav', 'data-hist="back"', '打开完整歌词页', 'ASS 字幕由我制作，含特效/样式', 'SRT 为原歌词文本', 'ASS 字幕由我个人制作', '如需使用请标注译者', 'SRT 字幕已对好时间轴', '找不到这条字幕']],
  ['/assets/js/games-admin.js?v=9', ['sendState', 'withShaRetry', 'LIST_PWD', 'link-code', '无需码', 'gDetail', '看详情']],
  ['/assets/js/config.js?v=4', ['defaultExtractCode']],
  // 搜索只能匹配看得见的内容：haystack 里不能再出现原始文件名 / path（见 subs.js 注释）
  ['/assets/js/subs.js?v=7', ['matchKeywords', 'search-scope: name + desc + variant kinds', 'downloadHTML', 'more-dl', 'dl-kind', 'subDetailUrl', 'bindRowClick', 'data-href', '!item.path', '!item.file']],
  ['/games/admin/', ['listPwd', 'sendToast', 'gDetail', 'data-hist="back"', 'style.css?v=22', 'site.js?v=21', 'config.js?v=4', 'games-admin.js?v=9']],
  ['/admin/', ['sendToast', 'id="upAss"', 'id="upSrt"', 'id="upLyrics"', 'id="upThumb"', 'id="btnUploadOne"', 'data-hist="back"', 'data-hist="forward"', 'style.css?v=22', 'site.js?v=21', 'config.js?v=4', 'admin.js?v=7', '!id="btnUploadAll"', '!id="picker"']],
  ['/games/', ['按自己喜好下载', '仅供学习交流', '请勿用于商业用途', '如有侵权请联系删除', '点卡片进详情页', '会自动复制到剪贴板', 'data-hist="back"', 'data-hist="forward"', 'style.css?v=22', 'site.js?v=21', 'games.js?v=7', '!复制提取码', '!选择云盘下载']],
  ['/games/detail.html?id=gmu9cq47yr2q', ['game-detail.js?v=3', 'site.js?v=21', 'gdBox', 'lightbox']],
  ['/subs/', ['data-hist="back"', 'data-hist="forward"', 'style.css?v=22', 'site.js?v=21', 'subs.js?v=7']],
  ['/subs/lyrics/', ['lyrics.js?v=2', 'site.js?v=21', 'lyBox']],
  ['/subs/detail/', ['sub-detail.js?v=6', 'site.js?v=21', 'sdBox']],
  ['/', ['style.css?v=22', 'site.js?v=21', 'data-href', 'bindRowClick', 'subDetailUrl', 'https://bqtj.top/', '!data-hist']],
  ['/robots.txt', ['Sitemap: https://bqtj.top/sitemap.xml']],
  ['/sitemap.xml', ['<loc>https://bqtj.top/</loc>', '<loc>https://bqtj.top/subs/</loc>', '<loc>https://bqtj.top/about</loc>', '!bqtj.pages.dev']],
  [
    '/about',
    [
      'space.bilibili.com/1421373636',
      '3357075023',
      '能帮上一点忙就挺好',
      '想委托翻译',
      'B 站私信',
      'message.bilibili.com',            // 私信改成消息中心直达
      'https://bqtj.top/about',          // canonical 已换主域名
      '走腾讯云 EdgeOne 加速',
      '直连 Cloudflare',
      '只有一个自建的下载计数',
      '自制的 ASS / SRT 格式的字幕文件',
      'data-hist="back"',
      'style.css?v=22',
      'site.js?v=21',
      'config.js?v=4',
      '!怎么找字幕',                     // 整节已删
      '!不用跟我打招呼',                 // 这句已删
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
const BRAND_PAGES = ['/', '/subs/', '/subs/detail/', '/subs/lyrics/', '/games/', '/games/detail.html', '/about', '/admin/', '/games/admin/', '/404.html'];

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
