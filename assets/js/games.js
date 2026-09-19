/* ==========================================================================
   games.js — 游戏页
   依赖 site.js 里的：esc / fileUrl / cleanUrl / copyText / loadJSON / renderError
   ========================================================================== */

(async function () {
  const $list = document.getElementById('gameList');
  const $info = document.getElementById('gameInfo');

  /* 复用一个已经发出去的请求（<head> 里就发了），省一个往返 */
  let data;
  try {
    const res = window.__gamesJson ? await window.__gamesJson : await fetch('/assets/data/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    console.error('[games]', err);
    if ($info) $info.textContent = '';
    $list.className = '';
    renderError($list, new Error('游戏列表读取失败（HTTP 状态异常）。刷新一下再试。'));
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];

  if (!items.length) {
    if ($info) $info.textContent = '';
    $list.className = '';
    $list.innerHTML =
      '<div class="empty"><h3>还没有游戏</h3>' +
      '<p>去 <a href="/games/admin/">游戏管理</a> 添加一个就会出现在这里。</p></div>';
    return;
  }

  /* 按更新时间倒序 */
  const sorted = [...items].sort((a, b) => String(b.mtime || '').localeCompare(String(a.mtime || '')));
  $info.innerHTML = '共 <b>' + sorted.length + '</b> 个游戏';

  const coverHTML = (g) => {
    if (g.cover) {
      return `<img class="game-cover" src="${esc(fileUrl(g.cover))}" alt="" loading="lazy">`;
    }
    return `<div class="game-cover placeholder">GAME</div>`;
  };

  const shotsHTML = (g) => {
    const shots = Array.isArray(g.shots) ? g.shots.filter(Boolean) : [];
    if (!shots.length) return '';
    return '<div class="shots">' + shots.map((s, i) =>
      `<a class="shot" href="${esc(fileUrl(s))}" data-shot="${esc(fileUrl(s))}" title="点击放大">
         <img src="${esc(fileUrl(s))}" alt="截图 ${i + 1}" loading="lazy">
       </a>`).join('') + '</div>';
  };

  /* 12 小时内的显示「刚刚 / N 小时前」，更早显示日期 —— 和字幕库保持一致 */
  const when = (iso) => (iso ? relTime(iso) : '');

  /**
   * 云盘链接归一化。
   * 新格式是 links: [{ name, url }]，可以有很多条；
   * 早期版本用的是单个 url 字段 —— 这里兼容一下，当成一条「123云盘」，
   * 免得旧数据在页面上突然消失。管理页保存时会把格式统一成 links。
   */
  const linksOf = (g) => {
    const arr = Array.isArray(g.links) ? g.links : [];
    const out = arr
      .map((l) => ({ name: String((l && l.name) || '').trim(), url: cleanUrl(l && l.url) }))
      .filter((l) => l.url);
    if (out.length) return out;
    const legacy = cleanUrl(g.url);
    return legacy ? [{ name: '123云盘', url: legacy }] : [];
  };

  $list.className = 'game-list';
  $list.innerHTML = sorted.map((g) => {
    const code = String(g.code || '').trim() || 'bqtj';
    const links = linksOf(g);
    const solo = links.length === 1;
    const meta = [g.size, g.version, when(g.mtime)].filter(Boolean);

    /* 只有一个云盘时用主色按钮（唯一的行动点）；多个时全部用普通按钮，不加优先级 */
    const linkBtns = links.map((l) =>
      `<a class="btn${solo ? ' btn-primary' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">` +
      `${l.name ? '去 ' + esc(l.name) + ' 下载' : '下载'}</a>`).join('');

    return `<details class="game-card">
  <summary class="game-head">
    ${coverHTML(g)}
    <div class="game-main">
      <div class="game-name">${esc(g.name || '未命名')}</div>
      ${g.brief ? `<div class="game-brief">${esc(g.brief)}</div>` : ''}
      <div class="game-sub">
        ${meta.map((m) => `<span>${esc(m)}</span>`).join('<span>·</span>')}
        <span>·</span><span>提取码 ${esc(code)}</span>
      </div>
    </div>
    <span class="game-toggle" aria-hidden="true"></span>
  </summary>

  <div class="game-body">
    <div class="game-actions">
      ${links.length
        ? (links.length > 1 ? '<span class="game-note">选择云盘：</span>' : '') + linkBtns
        : '<span class="game-note">这个条目还没填下载链接。</span>'}
      <button class="btn" data-copy="${esc(code)}">复制提取码 ${esc(code)}</button>
    </div>
    ${shotsHTML(g)}
  </div>
</details>`;
  }).join('');

  /* ------------------------- 复制按钮（事件委托） ------------------------- */
  $list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    copyText(btn.getAttribute('data-copy'), btn);
  });

  /* ------------------------------ 截图放大 ------------------------------ */
  const $box = document.getElementById('lightbox');
  const $img = document.getElementById('lightboxImg');

  const closeBox = () => { $box.hidden = true; $img.removeAttribute('src'); };

  $list.addEventListener('click', (e) => {
    const shot = e.target.closest('[data-shot]');
    if (!shot) return;
    e.preventDefault();
    $img.src = shot.getAttribute('data-shot');
    $box.hidden = false;
  });

  $box.addEventListener('click', closeBox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$box.hidden) closeBox(); });

  /* <details> 是原生折叠，不需要 JS —— 只有「展开/收起」那个标签用 CSS 切文字 */
})();
