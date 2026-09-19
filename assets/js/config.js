/* ==========================================================================
   config.js — 站点配置（必须在 site.js 之前加载）
   ========================================================================== */

window.SITE = {
  name: '爆枪突击 · 字幕库',

  /* 字幕文件的存放位置
     留空          → 与网页同源，即 https://bqtj.cc.cd/files/subs/...
     填完整网址    → 从对象存储/CDN 取，如 'https://files.bqtj.cc.cd'

     为什么留这个开关：Cloudflare Pages 单次部署最多 20000 个文件，
     字幕超过这个数就要把 files/ 挪走，届时只改这一行，页面代码不用动。 */
  fileBase: '',

  /* 首页「最新收录」显示几条 */
  latestCount: 8,

  /* ============ 上传助手（/admin/）配置 ============ */

  /* 「3 字幕管理」的访问密码。展开那一栏时要输入。
     注意：这是前端校验，只能挡住随手点开的人 —— 任何人查看页面源码都能看到它，
     不是真正的安全措施。真正管住写入的是 GitHub 令牌（没令牌改了也提交不上去）。 */
  adminPassword: 'bqtj',

  /* 站点自己的 GitHub 仓库。上传助手会把字幕文件直接提交到这里，
     提交后 Cloudflare Pages 会自动重新构建部署。 */
  github: {
    owner: 'qwe123rty456999-creator',
    repo: 'bqtj',
    branch: 'main',
  },

  /* 单个文件超过这个大小就不允许上传。
     Cloudflare Pages 单文件硬上限是 25 MiB，所以这里设 20 MB：
     base64 后约 27 MB 的请求体，GitHub Contents API 能接受，且留有余量。
     上传进仓库的文件天然就有直链（https://bqtj.cc.cd/files/subs/...），点一下就开始下载。 */
  repoUploadMaxBytes: 20 * 1024 * 1024, // 20 MB
};
