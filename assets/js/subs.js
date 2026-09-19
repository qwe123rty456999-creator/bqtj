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

  /**
   * 「更多」菜单里的项。顺序固定：1 分享链接 → 2 原视频 → 3 下载视频。
   * 后两项由管理员在 /admin/ 里填，没填就不出现。
   */
  function moreItems(f) {
    const list = [{ kind: 'copy', label: '分享链接', path: f.path }];
    if (f.videoUrl) list.push({ kind: 'link', label: '原视频', href: f.videoUrl, blank: true });
    if (f.videoDl) list.push({ kind: 'link', label: '下载视频', href: f.videoDl, dl: true });
    return list;
  }

  function moreMenu(f) {
    const list = moreItems(f);
    // 只有一项时不加编号 —— 孤零零一个「1」看着很怪
    const numbered = list.length > 1;

    const body = list.map((it, i) => {
      const label = (numbered ? `<span class="more-num">${i + 1}</span>` : '') + esc(it.label);
      return it.kind === 'copy'
        ? `<button class="more-item" data-copy="${esc(it.path)}">${label}</button>`
        : `<a class="more-item" href="${esc(it.href)}"` +
          (it.blank ? ' target="_blank" rel="noopener"' : '') +
          (it.dl ? ' download' : '') + `>${label}</a>`;
    }).join('');

    return `
      <div class="more">
        <button class="btn btn-sm" data-act="more" aria-expanded="false" aria-haspopup="true">更多</button>
        <div class="more-menu" hidden>${body}</div>
      </div>`;
  }

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
          ${moreMenu(f)}
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

  $sort.value = state.sort;
  $sort.addEventListener('change', () => {
    state.sort = $sort.value;
    render();
  });

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

  // 「更多」菜单：点按钮开合，点别处关掉
  function closeAllMenus() {
    $list.querySelectorAll('.more-menu').forEach((m) => { m.hidden = true; });
    $list.querySelectorAll('[data-act="more"]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  }

  $list.addEventListener('click', (e) => {
    const more = e.target.closest('[data-act="more"]');
    if (more) {
      const menu = more.parentElement.querySelector('.more-menu');
      const wasOpen = menu && !menu.hidden;
      closeAllMenus();
      if (menu && !wasOpen) {
        menu.hidden = false;
        more.setAttribute('aria-expanded', 'true');
      }
      return;
    }
    // 点菜单里的链接/按钮后也顺手收起
    if (e.target.closest('.more-menu')) { closeAllMenus(); return; }
    closeAllMenus();
  });

  // 点页面其他地方也收起。
  // 必须挂在 document 上 —— 点在列表外面时事件不会冒泡到 $list，挂在 $list 上收不掉。
  document.addEventListener('click', (e) => {
    if (e.target.closest('.more')) return;   // 菜单/按钮自己的点击由上面的监听器处理
    closeAllMenus();
  });

  // 复制直链
  $list.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    copyText(new URL(fileUrl(btn.getAttribute('data-copy')), location.origin).href, btn);
  });

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
