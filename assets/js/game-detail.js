/* ==========================================================================
   game-detail.js — 游戏详情页（/games/detail.html?id=xxx）

   为什么是「一个页面 + ?id=」而不是每个游戏一个静态文件：
   这是纯静态站、没有构建步骤，游戏是站主在后台随时增删的 —— 每个游戏生成一个
   文件就意味着每次加/删游戏都要额外写一次仓库，还得处理旧文件清理。
   一个页面按 id 现取数据，站主在后台改完就自动生效。

   依赖 site.js：esc / fileUrl / relTime / gameLinksOf / bindDriveCodeCopy
   ========================================================================== */

(async function () {
  const $box = document.getElementById('gdBox');
  const id = new URLSearchParams(location.search).get('id') || '';

  /** 出错时给一个能走下去的页面，而不是一片空白 */
  const fail = (title, msg) => {
    $box.removeAttribute('style');
    $box.innerHTML =
      '<div class="empty"><h3>' + esc(title) + '</h3>' +
      '<p>' + msg + '</p>' +
      '<p style="margin-top:16px"><a class="btn" href="/games/">回到游戏列表</a></p></div>';
  };

  if (!id) {
    fail('链接不完整', '这个地址少了游戏编号（<code>?id=</code>），从<a href="/games/">游戏列表</a>点进来就有了。');
    return;
  }

  let data;
  try {
    const res = window.__gamesJson
      ? await window.__gamesJson
      : await fetch('/assets/data/games.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    console.error('[game-detail]', err);
    fail('读取失败', '游戏信息没能取到，多半是网络或服务器的问题 —— 刷新一下再试。');
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  const g = items.find((x) => String(x.id) === id);
  if (!g) {
    fail('找不到这个游戏', '它可能已经被删掉了，或者链接里的编号不对。');
    return;
  }

  const links = gameLinksOf(g);
  const hasCode = links.some((l) => l.code);
  const name = g.name || '未命名';

  document.title = name + ' · 爆枪突击字幕库';

  const coverHTML = g.cover
    ? `<img class="gd-cover" src="${esc(fileUrl(g.cover))}" alt="${esc(name)} 的封面">`
    : '<div class="gd-cover placeholder">GAME</div>';

  /* 详细介绍：一段一行，空行分段。
     站主写的是纯文本，所以这里只做转义 + 按行切段，不解析任何标记 ——
     真去解析 HTML 的话，站主随手打的尖括号就能把页面结构弄坏。 */
  const detailHTML = String(g.detail || '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => '<p>' + esc(s) + '</p>')
    .join('');

  /* 云盘按钮：名字后面直接标出这个云盘自己的提取码 / 「无需提取码」。
     2026-09-21 改（用户要求「网盘后面显示提取码或无需提取码」）——
     各盘的码不一定一样，访客得先知道点哪个要哪个码。
     码同时仍会在点击时自动复制（site.js 的 copyCodeOnOpen），两件事不冲突。 */
  const drivesHTML = links.length
    ? '<div class="gd-drives">' + links.map((l) => {
        const label = esc(l.name || '下载');
        const code = l.code
          ? `<span class="gd-drive-code">提取码 ${esc(l.code)}</span>`
          : '<span class="gd-drive-code none">无需提取码</span>';
        return `<a class="gd-drive" href="${esc(l.url)}" target="_blank" rel="noopener"` +
          (l.code ? ` data-code="${esc(l.code)}"` : '') +
          `><span class="gd-drive-name">${label}</span>${code}</a>`;
      }).join('') + '</div>'
    : '<p class="gd-hint">这个条目还没有填下载链接。</p>';

  const shots = (Array.isArray(g.shots) ? g.shots : []).filter(Boolean);
  const shotsHTML = shots.length
    ? '<div class="shots">' + shots.map((s, i) =>
        `<a class="shot" href="${esc(fileUrl(s))}" data-shot="${esc(fileUrl(s))}" title="点击放大">
           <img src="${esc(fileUrl(s))}" alt="截图 ${i + 1}" loading="lazy">
         </a>`).join('') + '</div>'
    : '';

  const meta = [relTime(g.mtime || g.created), links.length ? links.length + ' 个网盘' : ''].filter(Boolean);

  $box.innerHTML = `
    <div class="page-head">
      <div class="breadcrumb"><a href="/">首页</a> / <a href="/games/">游戏</a> / ${esc(name)}</div>
      <h1>${esc(name)}</h1>
      ${g.brief ? `<p>${esc(g.brief)}</p>` : ''}
    </div>

    ${coverHTML}

    <div class="gd-meta">${meta.map((m) => `<span>${esc(m)}</span>`).join('<span>·</span>')}</div>

    <section class="gd-sec">
      <h2>下载</h2>
      <p class="gd-hint">${
        links.length
          ? (hasCode
              ? '点下面的网盘直接打开分享页。右边标着「提取码」的，点开时会<b>自动复制到剪贴板</b>，粘贴一下就行。'
              : '点下面的网盘直接打开分享页，这些都不需要提取码。')
          : '还没填下载链接。'
      }</p>
      ${drivesHTML}
    </section>

    ${detailHTML ? `<section class="gd-sec">
      <h2>详细介绍</h2>
      <div class="gd-text">${detailHTML}</div>
    </section>` : ''}

    ${shotsHTML ? `<section class="gd-sec">
      <h2>截图</h2>
      ${shotsHTML}
    </section>` : ''}

    <div class="notice">
      <div>
        <b>免责声明：</b>本站分享的游戏仅供学习交流，请勿用于商业用途。游戏版权归原作者或相关权利人所有，如有侵权请联系删除。
      </div>
    </div>
  `;

  /* 点云盘自动复制提取码（实现在 site.js，和游戏列表页同一套） */
  bindDriveCodeCopy($box);

  /* 截图放大 */
  const $lb = document.getElementById('lightbox');
  const $lbImg = document.getElementById('lightboxImg');
  const closeBox = () => { $lb.hidden = true; $lbImg.removeAttribute('src'); };

  $box.addEventListener('click', (e) => {
    const shot = e.target.closest('[data-shot]');
    if (!shot) return;
    e.preventDefault();
    $lbImg.src = shot.getAttribute('data-shot');
    $lb.hidden = false;
  });
  $lb.addEventListener('click', closeBox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$lb.hidden) closeBox(); });
})();
