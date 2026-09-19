/* ==========================================================================
   subs.js — 字幕库：搜索 / 排序 / 分页 / 下载
   说明：本站内容全是同一部作品的简体中文字幕，所以不做语言 / 格式 / 作品
        这类分类筛选，只保留搜索和排序。
   数据来自 assets/data/subs.json（由 tools/build-subs-index.mjs 或上传助手生成）
   ========================================================================== */

(function () {
  const PAGE_SIZE = 50;

  const state = {
    all: [],
    counts: new Map(),          // path → 下载次数（没有统计后端时为空）
    kw: getParam('q'),
    sort: getParam('sort') || 'mtime-desc',
    page: Math.max(1, parseInt(getParam('page'), 10) || 1),
  };

  const $list = document.getElementById('list');
  const $info = document.getElementById('info');
  const $pager = document.getElementById('pager');
  const $search = document.getElementById('search');
  const $clear = document.getElementById('clear');
  const $sort = document.getElementById('sort');
  const sortDrop = initDropdown(document.getElementById('sortDrop'));

  /* ----------------------------- 筛选与排序 ----------------------------- */

  /** 空格分隔的多关键词 = AND 匹配 */
  function matchKeywords(item, kw) {
    if (!kw) return true;
    const hay = (item.name + ' ' + (item.file || '') + ' ' + item.path + ' ' + (item.desc || '')).toLowerCase();
    return kw.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function filtered() {
    const list = state.all.filter((it) => matchKeywords(it, state.kw.trim()));
    const [field, dir] = state.sort.split('-');
    const mul = dir === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (field === 'name') return mul * String(a.name).localeCompare(String(b.name), 'zh-CN');
      if (field === 'size') return mul * ((a.size || 0) - (b.size || 0));
      if (field === 'count') {
        return mul * ((state.counts.get(a.path) || 0) - (state.counts.get(b.path) || 0));
      }
      return mul * String(a.mtime || '').localeCompare(String(b.mtime || ''));
    });
    return list;
  }

  /* ----------------------------- 渲染 ----------------------------- */

  function rowHTML(f) {
    const n = state.counts.get(f.path);
    return `
      <div class="file-row">
        ${f.thumb
          ? `<img class="file-thumb" src="${esc(fileUrl(f.thumb))}" alt="" loading="lazy">`
          : `<div class="file-thumb placeholder ${esc(f.ext)}">${esc(f.ext)}</div>`}
        <div class="file-main">
          <div class="file-name">${mark(f.name, state.kw.trim())}</div>
          ${f.desc ? `<div class="file-desc">${esc(f.desc)}</div>` : ''}
          <div class="file-sub">
            <span>${humanSize(f.size)}</span>
            <span>·</span>
            <span title="${esc(f.mtime)}">${relTime(f.mtime)}</span>
            ${n ? `<span class="count-badge">${n} 次下载</span>` : ''}
          </div>
        </div>
        <div class="file-actions">
          <a class="btn btn-sm btn-primary" href="${esc(fileUrl(f.path))}" download>下载</a>
          ${moreMenuHTML(f)}
        </div>
      </div>`;
  }

  function render({ keepPage = false } = {}) {
    const list = filtered();

    if (!keepPage) state.page = 1;
    const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page > pages) state.page = pages;

    const start = (state.page - 1) * PAGE_SIZE;
    const slice = list.slice(start, start + PAGE_SIZE);
    const kw = state.kw.trim();

    $info.innerHTML =
      `共 <b>${list.length}</b> 个字幕` +
      (kw ? ` · 关键词 <b>${esc(kw)}</b>` : '') +
      (list.length > PAGE_SIZE ? ` · 第 <b>${state.page}</b>/${pages} 页` : '');

    if (!list.length) {
      $list.className = '';
      $list.innerHTML = `<div class="empty"><h3>没找到匹配的字幕</h3>
        <p>换个更短的关键词试试。</p>
        <p style="margin-top:14px"><button class="btn btn-sm" id="resetAll">清空搜索</button></p></div>`;
      document.getElementById('resetAll')?.addEventListener('click', resetAll);
      $pager.innerHTML = '';
      return;
    }

    $list.className = 'file-list';
    $list.innerHTML = slice.map(rowHTML).join('');
    renderPager(pages);

    setParams({
      q: kw,
      page: state.page > 1 ? state.page : '',
      sort: state.sort === 'mtime-desc' ? '' : state.sort,
    });
  }

  /* ----------------------------- 分页 ----------------------------- */

  function renderPager(pages) {
    if (pages <= 1) { $pager.innerHTML = ''; return; }

    const p = state.page;
    const nums = new Set([1, pages, p, p - 1, p + 1]);
    if (p <= 4) [2, 3, 4, 5].forEach((n) => nums.add(n));
    if (p >= pages - 3) [pages - 1, pages - 2, pages - 3, pages - 4].forEach((n) => nums.add(n));

    const arr = [...nums].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);

    let html = `<button data-page="${p - 1}" ${p === 1 ? 'disabled' : ''}>‹ 上一页</button>`;
    let prev = 0;
    for (const n of arr) {
      if (prev && n - prev > 1) html += '<span class="gap">…</span>';
      html += `<button data-page="${n}" class="${n === p ? 'active' : ''}">${n}</button>`;
      prev = n;
    }
    html += `<button data-page="${p + 1}" ${p === pages ? 'disabled' : ''}>下一页 ›</button>`;

    $pager.innerHTML = html;
    $pager.querySelectorAll('button[data-page]').forEach((b) =>
      b.addEventListener('click', () => {
        const target = parseInt(b.getAttribute('data-page'), 10);
        if (target < 1 || target > pages || target === state.page) return;
        state.page = target;
        render({ keepPage: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      })
    );
  }

  /* ----------------------------- 事件 ----------------------------- */

  let timer;
  $search.value = state.kw;
  $search.closest('.search-box')?.classList.toggle('has-value', !!state.kw);

  $search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.kw = $search.value;
      $search.closest('.search-box')?.classList.toggle('has-value', !!state.kw);
      render();
    }, 160);
  });

  $clear.addEventListener('click', () => {
    state.kw = '';
    $search.value = '';
    $search.closest('.search-box')?.classList.remove('has-value');
    render();
    $search.focus();
  });

  // 排序用的是自定义下拉（见 site.js 的 initDropdown）。它内部仍走一个 hidden input
  // 并派发 change，所以下面这段逻辑与以前用原生 select 时完全一样。
  $sort.addEventListener('change', () => {
    state.sort = $sort.value;
    render();
  });
  sortDrop?.setValue(state.sort, true);

  // 快捷键：/ 聚焦搜索框，Esc 清空
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $search) {
      e.preventDefault();
      $search.focus();
      $search.select();
    }
    if (e.key === 'Escape' && document.activeElement === $search) {
      $search.value = '';
      state.kw = '';
      $search.blur();
      render();
    }
  });

  // 「更多」菜单与「分享链接」的事件委托（实现在 site.js，首页用的是同一份）
  bindMoreMenu($list);
  bindCopyButtons($list);

  function resetAll() {
    state.kw = '';
    state.page = 1;
    $search.value = '';
    $search.closest('.search-box')?.classList.remove('has-value');
    render();
  }

  /* ----------------------------- 启动 ----------------------------- */

  (async function init() {
    try {
      const data = await loadJSON('/assets/data/subs.json');
      state.all = data.items || [];

      // 下载次数是可选功能：没部署统计后端时静默跳过，页面照常工作
      try {
        const c = await loadJSON('/api/counts');
        if (c && c.enabled && c.counts) {
          Object.entries(c.counts).forEach(([k, v]) => state.counts.set(k, v));
        }
      } catch { /* 忽略 */ }

      if (!state.all.length) {
        $list.className = '';
        $list.innerHTML = `<div class="empty"><h3>字幕库还是空的</h3>
          <p>去 <a href="/admin/">上传助手</a> 传几个字幕，或者把文件放进
          <code>files/subs/</code> 后跑 <code>node tools/build-subs-index.mjs</code>。</p></div>`;
        $info.textContent = '共 0 个字幕';
        return;
      }

      render();
    } catch (err) {
      renderError($list, err);
      $info.textContent = '加载失败';
    }
  })();
})();
