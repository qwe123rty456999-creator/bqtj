/* ==========================================================================
   subs.js — 字幕库：搜索 / 筛选 / 排序 / 分页 / 下载
   数据来自 assets/data/subs.json（由 tools/build-subs-index.mjs 生成）
   ========================================================================== */

(function () {
  const PAGE_SIZE = 30;

  const state = {
    all: [],
    kw: getParam('q'),
    lang: getParam('lang'),
    ext: getParam('ext'),
    group: getParam('group'),
    sort: getParam('sort') || 'mtime-desc',
    page: Math.max(1, parseInt(getParam('page'), 10) || 1),
  };

  const $list = document.getElementById('list');
  const $info = document.getElementById('info');
  const $pager = document.getElementById('pager');
  const $search = document.getElementById('search');
  const $clear = document.getElementById('clear');
  const $sort = document.getElementById('sort');
  const $group = document.getElementById('group');
  const $langChips = document.getElementById('langChips');
  const $extChips = document.getElementById('extChips');

  const LANGS = [
    ['', '全部语言'],
    ['简中', '简体中文', 'zh-hans'],
    ['繁中', '繁体中文', 'zh-hant'],
    ['简繁', '简繁双语', 'zh-both'],
    ['中日', '中日双语', 'ja'],
    ['日语', '日语', 'ja'],
    ['英语', '英语', 'en'],
    ['其他', '其他', ''],
  ];

  /* ----------------------------- 筛选逻辑 ----------------------------- */

  /** 空格分隔的多关键词 = AND 匹配 */
  function matchKeywords(item, kw) {
    if (!kw) return true;
    const hay = (item.name + ' ' + item.path + ' ' + (item.group || '')).toLowerCase();
    return kw.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function filtered() {
    let list = state.all.filter((it) => {
      if (state.lang && it.lang !== state.lang) return false;
      if (state.ext && it.ext !== state.ext) return false;
      if (state.group && it.group !== state.group) return false;
      return matchKeywords(it, state.kw.trim());
    });

    const [field, dir] = state.sort.split('-');
    const mul = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (field === 'name') return mul * String(a.name).localeCompare(String(b.name), 'zh-CN');
      if (field === 'size') return mul * ((a.size || 0) - (b.size || 0));
      return mul * String(a.mtime || '').localeCompare(String(b.mtime || ''));
    });
    return list;
  }

  /* ----------------------------- 渲染列表 ----------------------------- */

  function rowHTML(f) {
    const langTag = f.lang
      ? `<span class="tag ${esc(f.langClass || '')}">${esc(f.lang)}</span>`
      : '';

    return `
      <div class="file-row">
        <div class="file-badge ${esc(f.ext)}">${esc(f.ext)}</div>
        <div class="file-main">
          <div class="file-name">${mark(f.name, state.kw.trim())}</div>
          <div class="file-sub">
            ${langTag}
            ${f.group ? `<span>📁 ${esc(f.group)}</span>` : ''}
            <span>${humanSize(f.size)}</span>
            <span>·</span>
            <span title="${esc(f.mtime)}">${relTime(f.mtime)}</span>
          </div>
          <div class="file-path" title="${esc(f.path)}">${esc(f.path)}</div>
        </div>
        <div class="file-actions">
          <a class="btn btn-sm btn-primary" href="${esc(fileUrl(f.path))}" download>下载</a>
          <button class="btn btn-sm" data-copy="${esc(f.path)}">复制链接</button>
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

    // 结果概要
    const bits = [];
    if (state.kw.trim()) bits.push(`关键词 <b>${esc(state.kw.trim())}</b>`);
    if (state.lang) bits.push(`语言 <b>${esc(state.lang)}</b>`);
    if (state.ext) bits.push(`格式 <b>${esc(state.ext.toUpperCase())}</b>`);
    if (state.group) bits.push(`作品 <b>${esc(state.group)}</b>`);

    $info.innerHTML =
      `共 <b>${list.length}</b> 个字幕` +
      (bits.length ? ` · ${bits.join(' · ')}` : '') +
      (list.length > PAGE_SIZE ? ` · 第 <b>${state.page}</b>/${pages} 页` : '');

    if (!list.length) {
      $list.className = '';
      $list.innerHTML = `<div class="empty"><div class="big">🔍</div><h3>没找到匹配的字幕</h3>
        <p>试试更短的关键词，或者清空筛选条件。</p>
        <p style="margin-top:14px"><button class="btn btn-sm" id="resetAll">清空全部筛选</button></p></div>`;
      document.getElementById('resetAll')?.addEventListener('click', resetAll);
      $pager.innerHTML = '';
      return;
    }

    $list.className = 'file-list';
    $list.innerHTML = slice.map(rowHTML).join('');
    renderPager(pages);
    setParams({
      q: state.kw.trim(), lang: state.lang, ext: state.ext,
      group: state.group, page: state.page > 1 ? state.page : '',
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

  /* ----------------------------- 筛选控件 ----------------------------- */

  function renderLangChips() {
    const counter = new Map();
    state.all.forEach((it) => {
      const k = it.lang || '其他';
      counter.set(k, (counter.get(k) || 0) + 1);
    });

    $langChips.innerHTML = LANGS.map(([val, label, cls]) => {
      const n = val ? (counter.get(val) || 0) : state.all.length;
      if (val && !n) return ''; // 没数据的语言不显示，保持干净
      return `<button class="chip ${state.lang === val ? 'active' : ''}" data-lang="${esc(val)}">
        <span class="${esc(cls)}">${esc(label)}</span> ${n}</button>`;
    }).join('');

    $langChips.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        state.lang = c.getAttribute('data-lang') || '';
        renderLangChips();
        render();
      })
    );
  }

  function renderExtChips() {
    const exts = [...new Set(state.all.map((f) => f.ext).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));

    $extChips.innerHTML =
      `<button class="chip ${!state.ext ? 'active' : ''}" data-ext="">全部格式</button>` +
      exts.map((e) =>
        `<button class="chip ${state.ext === e ? 'active' : ''}" data-ext="${esc(e)}">${esc(e.toUpperCase())}</button>`
      ).join('');

    $extChips.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        state.ext = c.getAttribute('data-ext') || '';
        renderExtChips();
        render();
      })
    );
  }

  function fillGroups() {
    const counter = new Map();
    state.all.forEach((f) => {
      const g = f.group || '（未分类）';
      counter.set(g, (counter.get(g) || 0) + 1);
    });
    const groups = [...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));

    $group.innerHTML = '<option value="">全部作品</option>' +
      groups.map(([g, n]) => `<option value="${esc(g)}">${esc(g)}（${n}）</option>`).join('');
    $group.value = state.group;
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

  $sort.value = state.sort;
  $sort.addEventListener('change', () => {
    state.sort = $sort.value;
    render();
  });

  $group.addEventListener('change', () => {
    state.group = $group.value;
    render();
  });

  // 键盘 / 快捷键：按 / 聚焦搜索框
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

  // 复制直链
  $list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const rel = btn.getAttribute('data-copy');
    copyText(new URL(fileUrl(rel), location.origin).href, btn);
  });

  function resetAll() {
    state.kw = ''; state.lang = ''; state.ext = ''; state.group = ''; state.page = 1;
    $search.value = '';
    $search.closest('.search-box')?.classList.remove('has-value');
    $group.value = '';
    renderLangChips();
    renderExtChips();
    render();
  }

  /* ----------------------------- 启动 ----------------------------- */

  (async function init() {
    try {
      const data = await loadJSON('/assets/data/subs.json');
      state.all = data.items || [];

      if (!state.all.length) {
        $list.className = '';
        $list.innerHTML = `<div class="empty"><div class="big">📭</div><h3>字幕库还是空的</h3>
          <p>把字幕文件放进 <code>files/subs/&lt;作品名&gt;/</code>，
          然后在终端运行 <code>node tools/build-subs-index.mjs</code> 生成索引。</p></div>`;
        $info.textContent = '共 0 个字幕';
        renderLangChips();
        renderExtChips();
        fillGroups();
        return;
      }

      renderLangChips();
      renderExtChips();
      fillGroups();
      render();
    } catch (err) {
      renderError($list, err);
      $info.textContent = '加载失败';
    }
  })();
})();
