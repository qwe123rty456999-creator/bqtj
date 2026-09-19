/* ==========================================================================
   collection.js — 通用「作品列表」页（小游戏 / 动漫共用）
   用法：页面里先定义 window.COLLECTION = { source, kind, placeholder }
   ========================================================================== */

(function () {
  const cfg = window.COLLECTION;
  if (!cfg) return;

  const state = {
    all: [],
    kw: getParam('q'),
    tag: getParam('tag'),
    sort: getParam('sort') || 'date-desc',
  };

  const $grid = document.getElementById('grid');
  const $info = document.getElementById('info');
  const $search = document.getElementById('search');
  const $clear = document.getElementById('clear');
  const $sort = document.getElementById('sort');
  const $chips = document.getElementById('chips');

  /* ----------------------------- 渲染 ----------------------------- */

  function cardHTML(it) {
    const kind = cfg.kind;
    const tags = (it.tags || []).slice(0, 4)
      .map((t) => `<button class="chip" data-tag-jump="${esc(t)}">${esc(t)}</button>`)
      .join('');

    const meta = [];
    if (kind === 'game') {
      if (it.platform) meta.push(esc(it.platform));
      if (it.version) meta.push(`<span class="ver-badge">${esc(it.version)}</span>`);
      if (it.updated) meta.push(relTime(it.updated));
    } else {
      if (it.year) meta.push(esc(String(it.year)));
      if (it.episodes) meta.push(esc(it.episodes) + ' 话');
      if (it.status) meta.push(esc(it.status));
    }

    // 体积徽章（硬盘版游戏包体积很大，单独强调）
    const sizeBadge = it.size ? `<span class="size-badge">💾 ${humanSize(it.size)}</span>` : '';

    // 网盘下载区：本站不存大文件，只存分享链接 + 提取码
    let panBox = '';
    if (it.pan && it.pan.url) {
      panBox = `<div class="pan">
        <a class="btn btn-sm btn-primary" href="${esc(it.pan.url)}" target="_blank" rel="noopener">
          📥 ${esc(it.pan.name || '网盘')}下载</a>
        ${it.pan.code
          ? `<span class="code-pill">提取码 <code>${esc(it.pan.code)}</code>
             <button data-copy-code="${esc(it.pan.code)}">复制</button></span>`
          : ''}
        ${it.password
          ? `<span class="code-pill" style="background:rgba(91,140,255,.12);border-color:rgba(91,140,255,.32);color:#9dbaff">
             解压密码 <code style="color:#9dbaff">${esc(it.password)}</code>
             <button data-copy-code="${esc(it.password)}" style="background:rgba(91,140,255,.2);color:#9dbaff">复制</button></span>`
          : ''}
      </div>`;
    }

    // 操作按钮
    const actions = [];
    if (kind === 'game') {
      if (it.play) actions.push(`<a class="btn btn-sm btn-primary" href="${esc(fileUrl(it.play))}">▶ 开始玩</a>`);
      if (it.download) actions.push(`<a class="btn btn-sm" href="${esc(fileUrl(it.download))}" download>⬇ 直链下载</a>`);
    } else {
      if (it.play) actions.push(`<a class="btn btn-sm btn-primary" href="${esc(fileUrl(it.play))}">▶ 在线播放</a>`);
      if (it.subs) actions.push(`<a class="btn btn-sm" href="${esc(it.subs)}">📝 找字幕</a>`);
      if (it.link) actions.push(`<a class="btn btn-sm" href="${esc(it.link)}" target="_blank" rel="noopener">🔗 详情</a>`);
    }

    const coverSrc = it.cover || it.thumb;
    const cover = coverSrc
      ? `<img src="${esc(fileUrl(coverSrc))}" alt="" loading="lazy"
              style="width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:10px;margin-bottom:14px;border:1px solid var(--border)">`
      : '';

    const shots = (it.screenshots || []).length
      ? `<div class="screens">${it.screenshots.slice(0, 4)
          .map((s) => `<img src="${esc(fileUrl(s))}" alt="" loading="lazy">`).join('')}</div>`
      : '';

    return `
      <div class="card">
        ${cover}
        <h3>${mark(it.title, state.kw)}</h3>
        ${(it.titleEn || it.titleJa) ? `<div style="color:var(--text-dim);font-size:13px;margin:-4px 0 8px">${esc(it.titleEn || it.titleJa)}</div>` : ''}
        <p>${esc(it.desc || '')}</p>
        ${shots}
        ${tags ? `<div class="chips" style="margin:0 0 12px">${tags}</div>` : ''}
        <div class="meta" style="margin-bottom:12px">${meta.map((m) => `<span>${m}</span>`).join('<span>·</span>')}</div>
        ${sizeBadge ? `<div style="margin-bottom:12px">${sizeBadge}</div>` : ''}
        ${panBox}
        ${actions.length ? `<div class="file-actions" style="margin-top:auto">${actions.join('')}</div>` : ''}
      </div>`;
  }

  function render() {
    const kw = state.kw.trim().toLowerCase();

    let list = state.all.filter((it) => {
      if (state.tag && !(it.tags || []).includes(state.tag)) return false;
      if (!kw) return true;
      const hay = [it.title, it.titleJa, it.desc, (it.tags || []).join(' '), it.author]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(kw);
    });

    const [field, dir] = state.sort.split('-');
    const mul = dir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (field === 'title') return mul * String(a.title).localeCompare(String(b.title), 'zh-CN');
      const av = a[field] || a.updated || a.date || '';
      const bv = b[field] || b.updated || b.date || '';
      return mul * String(av).localeCompare(String(bv));
    });

    $info.innerHTML = `共 <b>${list.length}</b> 个结果` +
      (state.tag ? ` · 标签 <b>${esc(state.tag)}</b>` : '') +
      (kw ? ` · 关键词 <b>${esc(state.kw)}</b>` : '');

    if (!list.length) {
      $grid.className = '';
      $grid.innerHTML = `<div class="empty"><div class="big">🔍</div><h3>没有匹配的内容</h3>
        <p>换个关键词，或者<a href="${location.pathname}">清空筛选条件</a>。</p></div>`;
      return;
    }

    $grid.className = 'grid';
    $grid.innerHTML = list.map(cardHTML).join('');
  }

  /* ----------------------------- 标签栏 ----------------------------- */

  function buildChips() {
    const counter = new Map();
    state.all.forEach((it) => (it.tags || []).forEach((t) => counter.set(t, (counter.get(t) || 0) + 1)));
    const tags = [...counter.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));

    $chips.innerHTML =
      `<button class="chip ${!state.tag ? 'active' : ''}" data-tag="">全部 ${state.all.length}</button>` +
      tags.map(([t, n]) =>
        `<button class="chip ${state.tag === t ? 'active' : ''}" data-tag="${esc(t)}">${esc(t)} ${n}</button>`
      ).join('');

    $chips.querySelectorAll('.chip').forEach((c) =>
      c.addEventListener('click', () => {
        state.tag = c.getAttribute('data-tag') || '';
        setParams({ tag: state.tag });
        buildChips();
        render();
      })
    );
  }

  /* ----------------------------- 事件 ----------------------------- */

  if ($search) {
    $search.value = state.kw;
    $search.closest('.search-box')?.classList.toggle('has-value', !!state.kw);
    $search.placeholder = cfg.placeholder || '搜索…';

    let timer;
    $search.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        state.kw = $search.value;
        $search.closest('.search-box')?.classList.toggle('has-value', !!state.kw);
        setParams({ q: state.kw });
        render();
      }, 160);
    });
  }

  $clear?.addEventListener('click', () => {
    state.kw = '';
    $search.value = '';
    $search.closest('.search-box')?.classList.remove('has-value');
    setParams({ q: '' });
    render();
    $search.focus();
  });

  if ($sort) {
    $sort.value = state.sort;
    $sort.addEventListener('change', () => {
      state.sort = $sort.value;
      setParams({ sort: state.sort });
      render();
    });
  }

  // 复制提取码 / 解压密码
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    e.preventDefault();
    copyText(btn.getAttribute('data-copy-code'), btn);
  });

  // 卡片里的标签点击 → 直接筛选
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-tag-jump]');
    if (!btn) return;
    state.tag = btn.getAttribute('data-tag-jump');
    setParams({ tag: state.tag });
    buildChips();
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  /* ----------------------------- 启动 ----------------------------- */

  (async function init() {
    try {
      const data = await loadJSON(cfg.source);
      state.all = data.items || [];
      buildChips();
      render();
    } catch (err) {
      renderError($grid, err);
    }
  })();
})();
