/* ==========================================================================
   config.js — 站点配置（在 site.js 之前加载）
   ========================================================================== */

window.SITE = {
  name: 'bqtj.cc.cd',

  /* 文件存放位置（字幕 / 游戏包 / 视频）
     留空          → 与网页同源，即 https://bqtj.cc.cd/files/...
     填完整网址    → 从对象存储/CDN 取，如 'https://files.bqtj.cc.cd' */
  fileBase: '',

  /* 首页「最新收录」显示几条 */
  latestCount: 6,

  /* ============ 上传助手（/admin/）配置 ============ */

  /* 站点自己的 GitHub 仓库。上传助手会把小文件直接提交到这里，
     提交后 Cloudflare Pages 会自动重新构建部署。 */
  github: {
    owner: 'qwe123rty456999-creator',
    repo: 'bqtj',
    branch: 'main',
  },

  /* 单个文件超过这个大小就不走 GitHub，改用网盘。
     GitHub Contents API 走 base64，太大会很慢也容易失败。 */
  repoUploadMaxBytes: 10 * 1024 * 1024, // 10 MB

  /* 大文件（硬盘版游戏包、视频）用的网盘 */
  pan: {
    name: '123云盘',
    uploadUrl: 'https://www.123pan.com/', // 点「去网盘上传」时打开的地址
    shareHelp: '上传后在网盘里选「分享」，把「分享链接」和「提取码」填到下面的表单里。',
  },
};
