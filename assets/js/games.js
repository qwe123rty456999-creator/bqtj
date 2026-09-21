/* ==========================================================================
   games.js — 游戏列表页
   依赖 site.js：esc / fileUrl / relTime / renderError / gameLinksOf / gameDetailUrl

   本页只负责「挑游戏」：整张卡片就是一个链接，点进 /games/detail.html?id=xxx。
   下载、提取码、截图、详细介绍全在详情页（game-detail.js）。

   2026-09-21 改版（用户反馈：一排「复制提取码 xxx」按钮很难看）：
   - 第一次：列表里去掉截图和提取码按钮，卡片下方留「选择云盘下载 + 查看详情」。
   - 第二次（用户要求「移除下面两个，必须打开详情」）：那两个按钮也删了。
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
    const detail = gameDetailUrl(g.id);

    /* 名字下面那行小字：大小（旧数据可能还有）· 版本 · 时间 · 网盘数。
       2026-09-21 第二次改：这里原本还写「提取码 aaa / bbb / ccc」，
       云盘一多就挤成一片；后来干脆连下载按钮也不放了（见下）。 */
    const subBits = [g.size, g.version, when(g.mtime),
      links.length ? links.length + ' 个网盘' : '还没填下载链接'].filter(Boolean);

    /* 整张卡片只有头部这一个链接，直接进详情页。
       2026-09-21 第二次改（用户要求「移除下面两个，必须打开详情」）：
       原来下面还有「选择云盘下载」+「查看详情」两个按钮，现在全删了 ——
       下载、提取码、截图、详细介绍一律去详情页看，列表只负责挑游戏。
       所以这里不再需要 dlHTML / bindMoreMenu / bindDriveCodeCopy。 */
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
</article>`;
  }).join('');
})();
