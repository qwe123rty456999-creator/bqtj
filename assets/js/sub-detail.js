/* ==========================================================================
   sub-detail.js — 字幕详情页（/subs/detail/?id=<字幕条目的 path>）

   为什么要有这一页（2026-10-16 用户要求「整行可点 → 字幕详情页」）：
   列表里一行能放的信息太少 —— 缩略图只有 160×90、说明只有一行、
   歌词只能从「更多」菜单里进。想让访客点进来一次看全，就单独给一页。

   和歌词页、游戏详情页同一套做法：一个页面 + ?id=，站主在后台改完自动生效，
   不用为每条字幕生成文件。

   依赖 site.js：esc / fileUrl / relTime / subsVariantsOf / lyricsUrl / humanSize
   ========================================================================== */

(async function () {
  const $box = document.getElementById('sdBox');
  const id = new URLSearchParams(location.search).get('id') || '';

  /** 出错时给一个能走下去的页面，而不是一片空白 */
  const fail = (title, msg) => {
    $box.removeAttribute('style');
    $box.innerHTML =
      '<div class="empty"><h3>' + esc(title) + '</h3>' +
      '<p>' + msg + '</p>' +
      '<p style="margin-top:16px"><a class="btn" href="/subs/">回字幕库</a></p></div>';
  };

  if (!id) {
    fail('链接不完整', '这个地址少了字幕编号（<code>?id=</code>），从<a href="/subs/">字幕库</a>点进来就有了。');
    return;
  }

  let data;
  try {
    const res = window.__subsJson
      ? await window.__subsJson
      : await fetch('/assets/data/subs.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    console.error('[sub-detail]', err);
    fail('读取失败', '字幕索引没能取到，多半是网络或服务器的问题 —— 刷新一下再试。');
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  /* 注意：URLSearchParams.get 已经把百分号编码解好了，**不能**再 decodeURIComponent 一次
     —— 文件名里带字面量 % 时那样会抛 URIError。 */
  const item =
    items.find((x) => x.path === id)
    || items.find((x) => '/' + String(x.file) === id || String(x.file) === id)
    || items.find((x) => String(x.name) === id);

  if (!item) {
    fail('找不到这条字幕', '它可能已经被删掉了，或者链接里的编号不对。');
    return;
  }

  const name = item.name || '未命名';
  document.title = name + ' · 爆枪突击字幕库';

  /* 下载次数是可选功能：没部署统计后端时静默跳过（同 subs.js） */
  let count = 0;
  try {
    const c = await (await fetch('/api/counts', { cache: 'no-store' })).json();
    if (c && c.enabled && c.counts) count = c.counts[item.path] || 0;
  } catch { /* 忽略 */ }

  const vs = subsVariantsOf(item);
  const lyrics = String(item.lyrics || '').trim();

  /* 缩略图：上传时统一压到 640×360，所以这里放到 640 以内是清晰的，不要再放大 */
  const thumbHTML = item.thumb
    ? `<img class="sd-thumb" src="${esc(fileUrl(item.thumb))}" alt="${esc(name)} 的缩略图">`
    : `<div class="sd-thumb placeholder">${esc(item.ext || 'sub')}</div>`;

  const dlButtons = vs.length
    ? vs.map((v) => `<a class="btn btn-primary" href="${esc(fileUrl(v.path))}" download>下载 ${esc(v.kind.toUpperCase())}</a>`).join('')
    : '<span class="sd-hint">这条还没有可下载的文件。</span>';

  /* 歌词只给个开头（前 4 行）当引子，完整版在歌词页 —— 详情页不用把整篇都铺开 */
  const lyricLines = lyrics ? lyrics.split('\n') : [];
  const teaser = lyricLines.slice(0, 4).join('\n');

  const metaBits = [
    relTime(item.mtime),
    vs.length ? vs.map((v) => v.kind.toUpperCase()).join(' / ') : '',
    item.size ? humanSize(item.size) : '',
    count ? count + ' 次下载' : '',
  ].filter(Boolean);

  /* 版权 / 使用说明：ASS 一行、SRT 另起一行（用户要求「srt 字幕介绍另起一行」）。
     第一行总是带着「请勿用于商业用途 / 如需使用请标注译者」这两条约定 ——
     不管这个条目只有 ASS 还是只有 SRT，访客都得看到它们。
     只有 SRT 的条目不能写「ASS 字幕…」，所以那种情况把约定挪到 SRT 那一行。 */
  const hasAss = vs.some((v) => v.kind === 'ass');
  const hasSrt = vs.some((v) => v.kind === 'srt');
  const pledge = '<b>请勿用于商业用途</b>，<b>如需使用请标注译者</b>';

  const noticeLines = [];
  if (hasAss) noticeLines.push(`ASS 字幕由我个人制作，可自由下载使用，${pledge}。`);
  if (hasSrt) {
    noticeLines.push(hasAss
      ? 'SRT 字幕已对好时间轴，方便你在它基础上再做一版。'
      : `SRT 字幕已对好时间轴，由我个人制作，可自由下载使用，${pledge}。`);
  }
  if (!noticeLines.length) noticeLines.push(`字幕由我个人制作，可自由下载使用，${pledge}。`);

  $box.removeAttribute('style');
  $box.innerHTML = `
    <div class="page-head">
      <div class="breadcrumb"><a href="/">首页</a> / <a href="/subs/">字幕库</a> / ${esc(name)}</div>
      <h1>${esc(name)}</h1>
      ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
    </div>

    ${thumbHTML}

    <div class="sd-meta">${metaBits.map((m) => `<span>${esc(m)}</span>`).join('<span>·</span>')}</div>

    <section class="sd-sec">
      <h2>下载</h2>
      <p class="sd-hint">${
        vs.length > 1
          ? 'ASS 是我自己制作的，SRT 是没有加工的。'
          : (vs.length === 1 ? '点击即可下载。' : '')
      }</p>
      <div class="sd-dl">${dlButtons}</div>
    </section>

    ${lyrics ? `<section class="sd-sec">
      <h2>原版歌词</h2>
      <p class="sd-hint">这首歌没翻译过的原文歌词。</p>
      <div class="sd-lyric">${esc(teaser)}${lyricLines.length > 4 ? '\n…' : ''}</div>
      <div class="sd-dl"><a class="btn" href="${esc(lyricsUrl(item.path))}">打开完整歌词页</a></div>
    </section>` : ''}

    <div class="notice">
      <div>${noticeLines.join('<br>')}</div>
    </div>

    <div class="sd-actions">
      <a class="btn" href="/subs/">回字幕库</a>
    </div>
  `;
})();
