/* ==========================================================================
   games.js — 游戏列表页
   依赖 site.js：esc / fileUrl / relTime / renderError / gameLinksOf /
                gameDetailUrl / bindDriveCodeCopy / bindMoreMenu

   2026-09-21 改版（用户反馈：一排「复制提取码 xxx」按钮很难看）：
   - 列表里不再展开截图、不再摆提取码按钮；卡片只留简介 + 下载 + 进详情页。
   - 点云盘直接跳转，需要提取码的由 site.js 的 copyCodeOnOpen 自动复制。
   - 截图和详细介绍全部移到 /games/detail.html?id=xxx（见 game-detail.js）。
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

  /* 12 小时内的显示「刚刚 / N 小时前」，更早显示日期 —— 和字幕库保持一致 */
  const when = (iso) => (iso ? relTime(iso) : '');

  /* 云盘链接归一化用的是 site.js 里的 gameLinksOf —— 详情页也要用同一份，
     各写一份迟早会改歪其中一边。 */

  $list.className = 'game-list';
  $list.innerHTML = sorted.map((g) => {
    const links = gameLinksOf(g);
    const solo = links.length === 1;
    const detail = gameDetailUrl(g.id);

    /* 名字下面那行小字：大小（旧数据可能还有）· 版本 · 时间 · 网盘数。
       2026-09-21 改：这里原来还写「提取码 aaa / bbb / ccc」，
       云盘一多就有三个码挤在同一行 —— 用户反馈难看不直观。
       提取码改成点云盘时自动复制，页面上不再显示。 */
    const subBits = [g.size, g.version, when(g.mtime), links.length ? links.length + ' 个网盘' : '']
      .filter(Boolean);

    /* 下载入口：
       - 只有一个云盘 → 直接一个主色按钮
       - 有多个云盘 → 一个按钮，点开再选（用站点自己的菜单组件，不用原生 select）
       点了就直接跳转；需要提取码的交给 site.js 的 copyCodeOnOpen 自动复制，
       所以这里只在 data-code 上挂着码，菜单里不显示它。 */
    let dlHTML;
    if (!links.length) {
      dlHTML = '<span class="game-note">这个条目还没填下载链接。</span>';
    } else if (solo) {
      dlHTML = `<a class="btn btn-primary" href="${esc(links[0].url)}" target="_blank" rel="noopener"`
        + (links[0].code ? ` data-code="${esc(links[0].code)}"` : '')
        + `>去 ${esc(links[0].name || '网盘')} 下载</a>`;
    } else {
      dlHTML = '<div class="more">'
        + '<button class="btn btn-primary" data-act="more" type="button" aria-expanded="false" aria-haspopup="true">选择云盘下载</button>'
        + '<div class="more-menu" hidden>'
        + (links.some((l) => l.code) ? '<div class="more-hint">点云盘会自动复制提取码</div>' : '')
        + links.map((l) => `<a class="more-item" href="${esc(l.url)}" target="_blank" rel="noopener"`
            + (l.code ? ` data-code="${esc(l.code)}"` : '')
            + `>${esc(l.name || '下载')}</a>`).join('')
        + '</div></div>';
    }

    /* 整张卡片的头部就是一个链接，直接进详情页 ——
       截图和详细介绍都挪到那边去了，留在列表里只会让卡片变长。 */
    return `<article class="game-card">
  <a class="game-head" href="${esc(detail)}">
    ${coverHTML(g)}
    <div class="game-main">
      <div class="game-name">${esc(g.name || '未命名')}</div>
      ${g.brief ? `<div class="game-brief">${esc(g.brief)}</div>` : ''}
      <div class="game-sub">${subBits.map((m) => `<span>${esc(m)}</span>`).join('<span>·</span>')}</div>
    </div>
    <span class="game-go" aria-hidden="true">详情</span>
  </a>

  <div class="game-actions">
    ${dlHTML}
    <a class="btn" href="${esc(detail)}">查看详情</a>
  </div>
</article>`;
  }).join('');

  /* 点云盘自动复制提取码（实现在 site.js，和详情页同一套） */
  bindDriveCodeCopy($list);

  /* 多云盘时的「选择云盘下载」菜单（site.js 里的组件，和字幕库的「更多」同一套） */
  bindMoreMenu($list);
})();
