/* ==========================================================================
   site.js — 全站通用逻辑（主题、导航、工具函数）
   所有页面都引用这一份，放在 <head> 之前或 body 末尾均可
   ========================================================================== */

/* ----------------------------- 主题 ----------------------------- */
/* 用新键名，避免旧的深浅色偏覆盖新的「默认浅色」 */
const THEME_KEY = 'bqtj-theme';

(function initTheme() {
  // 默认浅色。只有用户手动点过切换按钮，才用保存的偏好。
  // 不跟随系统的 prefers-color-scheme，保证所有人看到的是同一套设计。
  const saved = localStorage.getItem(THEME_KEY);
  document.documentElement.setAttribute(
    'data-theme',
    saved === 'light' || saved === 'dark' ? saved : 'light'
  );
})();

function themeLabel(theme) {
  // 按钮上显示的是「点了会切到哪个模式」
  return theme === 'light' ? '深色' : '浅色';
}

function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme');
  const next = cur === 'light' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem(THEME_KEY, next);
  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = themeLabel(next);
}

/* ----------------------------- 导航 ----------------------------- */
function toggleNav() {
  document.getElementById('siteNav')?.classList.toggle('open');
}

/** 根据当前路径高亮导航项 */
function markActiveNav() {
  const path = location.pathname.replace(/index\.html$/, '');
  document.querySelectorAll('.nav a[data-nav]').forEach((a) => {
    const key = a.getAttribute('data-nav');
    const isHome = key === 'home' && (path === '/' || path.endsWith('/bqtj.cc.cd/'));
    const inSection = key !== 'home' && path.includes('/' + key);
    if (isHome || inSection) a.classList.add('active');
  });
}

/* ----------------------------- 小工具 ----------------------------- */

/** 转义 HTML，防止文件名里的特殊字符破坏页面 */
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

/** 在文本中标出命中的关键词 */
function mark(text, kw) {
  if (!kw) return esc(text);
  const i = text.toLowerCase().indexOf(kw.toLowerCase());
  if (i < 0) return esc(text);
  return (
    esc(text.slice(0, i)) +
    '<mark>' +
    esc(text.slice(i, i + kw.length)) +
    '</mark>' +
    esc(text.slice(i + kw.length))
  );
}

/** 逐段 URL 编码，但保留 / 分隔符 */
function encodePath(p) {
  return p.split('/').map((seg) => encodeURIComponent(seg)).join('/');
}

/**
 * 把数据里的文件路径转成可访问的网址。
 * 数据里统一存 /files/... 形式；若 config.js 里配了 fileBase（CDN / 对象存储），
 * 就自动换成外部地址，页面代码无需改动。
 *
 * 注意：必须做编码。字幕文件名里常有 # ? 空格 等字符，
 * 不编码的话浏览器会把 # 之后当锚点，请求路径被截断 → 404。
 * 注意：只对「文件路径」调用，不要对带查询串的页面链接（如 /subs/?q=x）调用。
 */
function fileUrl(p) {
  if (!p) return '';
  if (/^(https?:)?\/\//i.test(p) || p.startsWith('data:')) return p; // 已是完整网址

  const base = (window.SITE && window.SITE.fileBase) || '';
  const full = base ? base.replace(/\/+$/, '') + p.replace(/^\/files/, '') : p;

  const i = full.indexOf('://');
  if (i < 0) return encodePath(full);
  const j = full.indexOf('/', i + 3);
  return j < 0 ? full : full.slice(0, j) + encodePath(full.slice(j));
}

/** 字节数 → 人类可读 */
function humanSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n < 10 ? 1 : 0)) + ' ' + u[i];
}

/** 日期 → 相对时间（刚刚 / 3 小时前 / 5 天前 / 2026-03-01） */
function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const diff = Date.now() - t;
  const m = 60 * 1000, h = 60 * m, d = 24 * h;
  if (diff < 2 * m) return '刚刚';
  if (diff < h) return Math.floor(diff / m) + ' 分钟前';
  if (diff < d) return Math.floor(diff / h) + ' 小时前';
  if (diff < 30 * d) return Math.floor(diff / d) + ' 天前';
  return new Date(t).toLocaleDateString('zh-CN');
}

/** 读取 JSON，失败时给出可读提示（file:// 打开时 fetch 会被浏览器拦截） */
async function loadJSON(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (err) {
    console.error('[loadJSON]', url, err);
    throw new Error(
      '无法读取 ' + url + '\n' +
      '· 如果你是用「双击 html 文件」的方式打开的，浏览器出于安全策略不允许读取本地 JSON。\n' +
      '· 请改用 VS Code 的 Live Preview（右键 html → Show Preview）或任意本地服务器打开。'
    );
  }
}

/** 渲染错误态 */
function renderError(el, err) {
  el.innerHTML =
    '<div class="empty"><h3>内容加载失败</h3>' +
    '<p style="white-space:pre-line;max-width:620px;margin:10px auto 0">' +
    esc(err.message) + '</p></div>';
}

/** 复制到剪贴板（自动回退到 execCommand） */
async function copyText(text, btn) {
  const old = btn ? btn.textContent : '';
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  if (btn) {
    btn.textContent = '已复制';
    setTimeout(() => { btn.textContent = old; }, 1200);
  }
}

/* ----------------------------- URL 查询参数 ----------------------------- */
function getParam(key) {
  return new URLSearchParams(location.search).get(key) || '';
}

/** 把当前筛选状态写进地址栏，便于分享 / 刷新后保持 */
function setParams(obj) {
  const p = new URLSearchParams(location.search);
  Object.entries(obj).forEach(([k, v]) => {
    if (v === '' || v === null || v === undefined) p.delete(k);
    else p.set(k, v);
  });
  const qs = p.toString();
  history.replaceState(null, '', qs ? '?' + qs : location.pathname);
}

/* ----------------------------- 启动 ----------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  markActiveNav();

  const btn = document.getElementById('themeBtn');
  if (btn) btn.textContent = themeLabel(document.documentElement.getAttribute('data-theme'));

  document.getElementById('navToggle')?.addEventListener('click', toggleNav);
  btn?.addEventListener('click', toggleTheme);

  // 年份
  document.querySelectorAll('[data-year]').forEach((el) => {
    el.textContent = new Date().getFullYear();
  });

  // 点击导航后自动收起移动端菜单
  document.querySelectorAll('.nav a').forEach((a) =>
    a.addEventListener('click', () => document.getElementById('siteNav')?.classList.remove('open'))
  );
});
