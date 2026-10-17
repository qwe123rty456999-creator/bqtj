/* ==========================================================================
   lyrics.js — 原版歌词预览页（/subs/lyrics/?id=<字幕条目的 path>）

   为什么是「一个页面 + ?id=」：
   歌词是站主在 /admin/ 里随手粘进去的多行文本，存在 subs.json 里。
   纯静态站没有构建步骤，为一个页面写死歌词等于每次改歌词都要重新生成文件；
   按 id 现取数据，站主改完自动生效。

   id 用条目的 path —— 全站（下载统计 / 缩略图 / 管理页）都以 path 为主键，
   第 3 项兜底是为了容错：万一有人手抄链接时把路径写错，还能按文件名找到。

   依赖 site.js：esc / fileUrl / relTime / subsVariantsOf
   ========================================================================== */

(async function () {
  const $box = document.getElementById('lyBox');
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
    fail('链接不完整', '这个地址少了字幕编号（<code>?id=</code>），从<a href="/subs/">字幕库</a>的「更多」里点进来就有了。');
    return;
  }

  let data;
  try {
    const res = window.__subsJson
      ? await window.__subsJson
      : await fetch('/assets/data/subs.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    data = await res.json();
  } catch (err) {
    console.error('[lyrics]', err);
    fail('读取失败', '字幕索引没能取到，多半是网络或服务器的问题 —— 刷新一下再试。');
    return;
  }

  const items = Array.isArray(data.items) ? data.items : [];
  /* 注意：URLSearchParams.get 已经把百分号编码解好了，**不能**再 decodeURIComponent 一次
     —— 文件名里带字面量 % 时那样会抛 URIError。 */
  const raw = id;
  const item =
    items.find((x) => x.path === raw)
    || items.find((x) => '/' + String(x.file) === raw || String(x.file) === raw)
    || items.find((x) => String(x.name) === raw);

  if (!item) {
    fail('找不到这条字幕', '它可能已经被删掉了，或者链接里的编号不对。');
    return;
  }

  const name = item.name || '未命名';
  document.title = name + ' 原版歌词 · 爆枪突击字幕库';

  const lyrics = String(item.lyrics || '').trim();

  /* 歌词是纯文本，只 esc 不解析任何标记 —— 站主随手打的尖括号不该破坏页面结构。
     换行靠 CSS 的 white-space: pre-wrap 保留，不用 <br> 拼。 */
  const lyricsHTML = lyrics
    ? `<section class="ly-sec">
         <h2>原版歌词</h2>
         <div class="ly-text">${esc(lyrics)}</div>
       </section>`
    : `<div class="empty"><h3>这条还没有填原版歌词</h3>
         <p>歌词由站主在后台补，填好之后这里就能看到。</p></div>`;

  /* 下载按钮：和字幕库列表同一套逻辑（两个版本都有就让访客自己选） */
  const vs = subsVariantsOf(item);
  const dlHTML = vs.length === 1
    ? `<a class="btn btn-primary" href="${esc(fileUrl(vs[0].path))}" download>下载 ${esc(vs[0].kind.toUpperCase())}</a>`
    : vs.map((v) => `<a class="btn btn-primary" href="${esc(fileUrl(v.path))}" download>下载 ${esc(v.kind.toUpperCase())}</a>`).join('');

  const metaBits = [
    relTime(item.mtime),
    vs.length ? vs.map((v) => v.kind.toUpperCase()).join(' / ') : '',
  ].filter(Boolean);

  $box.removeAttribute('style');
  $box.innerHTML = `
    <div class="page-head">
      <div class="breadcrumb"><a href="/">首页</a> / <a href="/subs/">字幕库</a> / 原版歌词</div>
      <div class="hist-nav">
        <button class="hist-btn" type="button" data-hist="back" title="回上一个页面">← 上一页</button>
        <button class="hist-btn" type="button" data-hist="forward" title="前进到下一个页面">下一页 →</button>
      </div>
      <h1>${esc(name)}</h1>
      ${item.desc ? `<p>${esc(item.desc)}</p>` : ''}
    </div>

    <div class="ly-meta">${metaBits.map((m) => `<span>${esc(m)}</span>`).join('<span>·</span>')}</div>

    <div class="notice">
      <div>
        这里是<b>原版歌词</b>，也就是没翻译过的原文，方便想自己翻译或二次制作的人对照。
        字幕文件在页面最下面的按钮里下载。
      </div>
    </div>

    ${lyricsHTML}

    <div class="ly-actions">
      ${dlHTML}
      <a class="btn" href="/subs/">回字幕库</a>
    </div>
  `;
})();
