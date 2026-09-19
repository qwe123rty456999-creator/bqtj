/* ==========================================================================
   admin.js — 字幕上传助手 + 下载统计
   ① 浏览器选字幕 → 经 GitHub Contents API 提交到 files/subs/
   ② 自动追加条目到 assets/data/subs.json（语言自动判断，默认简体中文）
   ③ 展示 /api/counts 的下载次数
   令牌只存在本机 localStorage，绝不写入仓库
   ========================================================================== */

(function () {
  const S = window.SITE || {};
  const REPO = S.github || { owner: '', repo: '', branch: 'main' };
  const MAX = S.repoUploadMaxBytes || 20 * 1024 * 1024;
  const LS_KEY = 'bqtj_gh_token';

  /* 本站只做一部作品、全是简体中文，所以上传目录和语言都固定 */
  const DEST = 'files/subs';
  const DEFAULT_LANG = '简中';

  /* 缩略图：公开列表里按 96×54 显示（16:9），上传前统一处理成 480×270 的 jpg */
  const THUMB_W = 480;
  const THUMB_H = 270;
  const THUMB_DIR = 'files/thumbs';

  const $ = (id) => document.getElementById(id);
  const ui = {
    setupCard: $('setupCard'), token: $('token'),
    connBox: $('connBox'), connMsg: $('connMsg'),
    drop: $('drop'), picker: $('picker'),
    upList: $('upList'), upActions: $('upActions'), log: $('log'),
    statSummary: $('statSummary'), statTable: $('statTable'), maxSize: $('maxSize'),
    overview: $('overview'),
  };

  const state = { token: '', files: [], tree: null };
  let seq = 0;

  let countsMap = new Map();   // path → 下载次数（来自 /api/counts）
  let mgItems = [];            // 字幕管理的当前列表（来自 subs.json）
  let statEntries = [];        // 下载统计原始数据 [[path, 次数], ...]
  let statTotal = 0;
  let statKw = '';             // 数据概览的搜索词
  let mgKw = '';               // 字幕管理的搜索词

  if (ui.maxSize) ui.maxSize.textContent = humanSize(MAX);   // 该元素可能已从页面移除

  /* ======================= 通用工具 ======================= */

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function log(msg, kind = '') {
    ui.log.hidden = false;
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = document.createElement('div');
    line.className = kind ? 'l-' + kind : '';
    line.textContent = `[${t}] ${msg}`;
    ui.log.appendChild(line);
    ui.log.scrollTop = ui.log.scrollHeight;
  }

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  const extOf = (name) => {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };
  const SUB_EXTS = ['ass', 'ssa', 'srt', 'vtt', 'sub', 'idx', 'sup'];
  const isSub = (ext) => SUB_EXTS.includes(ext);

  /* ======================= 文件名处理（与本地索引脚本一致） ======================= */

  const LANG_RULES = [
    [/简繁|简\+繁|繁简|CHS\s*[&+]\s*CHT|GB\s*[&+]\s*BIG5/i, '简繁'],
    [/中日|日中|JPSC/i, '中日'],
    [/中英|ENG\s*[&+]\s*CHS/i, '中英'],
    [/简体|简中|简日|简|CHS|\bGB\b|GBK|GB2312/i, '简中'],
    [/繁体|繁中|繁日|繁|CHT|BIG5|正体/i, '繁中'],
    [/zh[-_ ]?hans|zh[-_ ]?cn\b|zh[-_ ]?sg\b/i, '简中'],
    [/zh[-_ ]?hant|zh[-_ ]?tw\b|zh[-_ ]?hk\b/i, '繁中'],
    [/日语|日文|\bJP\b|\bJPN\b/i, '日语'],
    [/英语|英文|\bENG\b/i, '英语'],
  ];
  const LANG_CLASS = {
    '简中': 'zh-hans', '繁中': 'zh-hant', '简繁': 'zh-both',
    '中日': 'ja', '中英': 'zh-both', '日语': 'ja', '英语': 'en',
  };

  function detectLang(name) {
    for (const [re, lang] of LANG_RULES) if (re.test(name)) return lang;
    return '';
  }

  /** 去掉 YouTube 视频 ID、#话题标签等噪音，让显示名干净 */
  function cleanName(base) {
    const n = base
      .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '')
      .replace(/\s*\([A-Za-z0-9_-]{11}\)\s*$/, '')
      .replace(/#[^\s#]+/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[\s\-_·]+$/, '')
      .trim();
    return n || base;
  }

  /* ======================= GitHub API ======================= */
  /* 只发 Authorization + Content-Type —— GitHub 的 CORS 预检只放行白名单内的头 */

  const repoBase = () => `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function gh(path, opts = {}) {
    const headers = { Authorization: `Bearer ${state.token}` };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.accept) headers.Accept = opts.accept;

    const res = await fetch(repoBase() + path, {
      method: opts.method || 'GET', headers, body: opts.body,
    });

    if (opts.raw) {
      if (!res.ok) {
        // GitHub 在 raw 请求下也返回 JSON 错误体，把里面的 message 抽出来，
        // 否则用户看到的是一整块带 \r\n 的原始 JSON
        const body = await res.text();
        let msg = body;
        try { const j = JSON.parse(body); if (j && j.message) msg = j.message; } catch { /* 不是 JSON */ }
        const err = new Error(`HTTP ${res.status}：${String(msg).slice(0, 160)}`);
        err.status = res.status;
        throw err;
      }
      return res.text();
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}：${data && data.message ? data.message : res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** 一次请求拿到仓库全部文件路径 → blob sha，避免逐个查 */
  async function loadTree(force) {
    if (state.tree && !force) return state.tree;
    const data = await gh(`/git/trees/${REPO.branch}?recursive=1`);
    const map = new Map();
    (data.tree || []).forEach((n) => { if (n.type === 'blob') map.set(n.path, n.sha); });
    state.tree = map;
    return map;
  }

  const readText = (p) =>
    gh(`/contents/${encodePath(p)}?ref=${REPO.branch}`, {
      accept: 'application/vnd.github.raw', raw: true,
    });

  /** 取某个路径当前的 blob sha（缓存里没有就强刷一次 tree） */
  async function shaOf(path) {
    let tree = await loadTree();
    if (!tree.has(path)) tree = await loadTree(true);
    return tree.get(path);
  }

  async function putFile(path, base64, message) {
    const sha = await shaOf(path);
    const body = { message, content: base64 };
    if (sha) body.sha = sha;
    if (REPO.branch) body.branch = REPO.branch;
    const res = await gh(`/contents/${encodePath(path)}`, {
      method: 'PUT', body: JSON.stringify(body),
    });
    // PUT 返回的 content.sha 就是刚写入的新 blob sha，直接回填缓存。
    // （以前是 delete(path)：同一文件第二次写入时缓存里查不到 sha，
    //   会被当成「新建文件」→ GitHub 直接 409 拒绝）
    if (res && res.content && res.content.sha) state.tree?.set(path, res.content.sha);
    else state.tree?.delete(path);
    return res;
  }

  /** 删除仓库里的一个文件 */
  async function deleteFile(path, message) {
    const sha = await shaOf(path);
    if (!sha) throw new Error('仓库里找不到这个文件，可能已经被删掉了');
    await gh(`/contents/${encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: REPO.branch }),
    });
    state.tree?.delete(path);
  }

  /* ======================= 设置（令牌） ======================= */

  function setConn(cls, msg) {
    ui.connBox.className = 'conn ' + cls;
    ui.connMsg.innerHTML = msg;
  }

  async function verify(silent) {
    if (!state.token) { setConn('off', '还没填令牌'); return false; }
    setConn('', '正在验证…');
    try {
      const repo = await gh('');
      if (!(repo.permissions && repo.permissions.push)) {
        setConn('off', `连上了 <b>${esc(repo.full_name)}</b>，但这个令牌<b>没有写入权限</b>，请检查 Contents 权限`);
        return false;
      }
      const tree = await loadTree(true);
      setConn('on', `已连接 <b>${esc(repo.full_name)}</b> · 分支 <b>${esc(repo.default_branch)}</b> · 仓库内 ${tree.size} 个文件`);
      if (!silent) log(`连接成功：${repo.full_name}（${tree.size} 个文件）`, 'ok');
      return true;
    } catch (e) {
      setConn('off', `连接失败：${esc(e.message)}`);
      if (!silent) log(`连接失败：${e.message}`, 'err');
      return false;
    }
  }

  $('btnSave').addEventListener('click', async () => {
    const v = ui.token.value.trim();
    if (!v) { log('令牌是空的', 'err'); return; }
    state.token = v;
    localStorage.setItem(LS_KEY, v);
    log('令牌已保存到本机浏览器', 'ok');
    const ok = await verify(false);
    if (ok) ui.setupCard.open = false;   // 配好了就收起来，页面回到「只有上传」
  });

  $('btnForget').addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    state.token = '';
    ui.token.value = '';
    state.tree = null;
    setConn('off', '令牌已清除');
    ui.setupCard.open = true;
    log('已清除本机保存的令牌', 'warn');
  });

  {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      state.token = saved;
      ui.token.value = saved;
      ui.setupCard.open = false;   // 已配置 → 折叠，页面主体只剩上传
      verify(true);
    } else {
      ui.setupCard.open = true;    // 首次使用 → 展开，引导配置
      setConn('off', '尚未配置，先填令牌并保存');
    }
  }

  /* ======================= 选文件 ======================= */

  ui.drop.addEventListener('click', () => ui.picker.click());
  ui.drop.addEventListener('dragover', (e) => { e.preventDefault(); ui.drop.classList.add('over'); });
  ui.drop.addEventListener('dragleave', () => ui.drop.classList.remove('over'));
  ui.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    ui.drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
  ui.picker.addEventListener('change', () => { addFiles(ui.picker.files); ui.picker.value = ''; });

  function addFiles(list) {
    const arr = [...list];
    if (!arr.length) return;
    let bad = 0;
    for (const f of arr) {
      const ext = extOf(f.name);
      if (!isSub(ext)) { bad++; continue; }
      state.files.push({ id: ++seq, file: f, name: f.name, size: f.size, ext, status: 'wait', note: '' });
    }
    renderList();
    log(`加入 ${arr.length - bad} 个字幕文件${bad ? `（跳过 ${bad} 个非字幕文件）` : ''}`, bad ? 'warn' : 'info');
  }

  function badge(it) {
    const map = {
      wait: ['wait', '待处理'], busy: ['busy', '上传中'],
      ok: ['ok', '已上传'], err: ['err', '失败'], skip: ['skip', '太大'],
    };
    const [c, t] = map[it.status] || map.wait;
    return `<span class="state ${c}">${t}</span>`;
  }

  function renderList() {
    if (!state.files.length) {
      ui.upList.innerHTML = '';
      ui.upActions.hidden = true;
      return;
    }
    ui.upActions.hidden = false;

    ui.upList.innerHTML = state.files.map((it) => `
      <div class="up-row" data-id="${it.id}">
        <span class="up-icon">${esc(it.ext)}</span>
        <div class="up-main">
          <div class="up-name">${esc(it.name)}</div>
          <div class="up-sub">
            <span>${humanSize(it.size)}</span>
            <span class="tag">${esc(it.ext)}</span>
            ${badge(it)}
            ${it.note ? `<span>${esc(it.note)}</span>` : ''}
          </div>
          ${it.status === 'busy' ? '<div class="bar"><i style="width:45%"></i></div>' : ''}
        </div>
        <div class="up-act">
          <button class="btn btn-sm" data-act="del" data-id="${it.id}">移除</button>
        </div>
      </div>`).join('');

    const pending = state.files.filter((f) => f.size <= MAX && f.status !== 'ok').length;
    $('btnUploadAll').disabled = pending === 0;
    $('btnUploadAll').textContent = pending ? `上传 ${pending} 个字幕` : '全部已上传';
  }

  ui.upList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="del"]');
    if (!btn) return;
    const id = Number(btn.getAttribute('data-id'));
    const i = state.files.findIndex((f) => f.id === id);
    if (i >= 0) { state.files.splice(i, 1); renderList(); }
  });

  $('btnClearList').addEventListener('click', () => { state.files = []; renderList(); });

  /* ======================= 上传 ======================= */

  $('btnUploadAll').addEventListener('click', async () => {
    if (!state.token) {
      ui.setupCard.open = true;
      log('还没配置令牌 —— 已帮你展开「上传设置」，填好保存再点上传', 'err');
      return;
    }
    const targets = state.files.filter((f) => f.size <= MAX && f.status !== 'ok');
    if (!targets.length) { log('没有待上传的文件', 'warn'); return; }
    if (!(await verify(true))) return;

    log(`开始上传 ${targets.length} 个文件到 ${DEST} …`, 'info');
    const done = [];
    let ok = 0, fail = 0;

    for (const it of targets) {
      it.status = 'busy';
      renderList();
      const path = `${DEST}/${it.name}`;
      try {
        await putFile(path, await fileToBase64(it.file), `上传字幕 ${it.name}`);
        it.status = 'ok';
        it.note = path;
        done.push(it);
        ok++;
        log(`完成 ${it.name} → ${path}`, 'ok');
      } catch (e) {
        it.status = 'err';
        it.note = e.message;
        fail++;
        log(`失败 ${it.name}：${e.message}`, 'err');
      }
      renderList();
    }

    log(`上传结束：成功 ${ok}，失败 ${fail}`, fail ? 'warn' : 'ok');

    if (done.length) {
      try {
        await patchSubsIndex(done);
      } catch (e) {
        log(`字幕库索引更新失败：${friendlyErr(e)}（文件已上传，可再点一次上传重试）`, 'err');
      }
    }

    if (ok) log('Cloudflare 会自动重新部署，约 1 分钟后线上可搜。', 'info');
  });

  /** 把新上传的字幕追加进 assets/data/subs.json */
  async function patchSubsIndex(files) {
    log('正在更新字幕库索引 assets/data/subs.json …', 'info');
    const data = JSON.parse(await readText('assets/data/subs.json'));
    data.items = data.items || [];

    const have = new Set(data.items.map((x) => x.path));
    let added = 0;

    for (const it of files) {
      const p = `/${DEST}/${it.name}`;
      if (have.has(p)) continue;
      const lang = detectLang(it.name) || DEFAULT_LANG;
      data.items.unshift({
        name: cleanName(it.name.replace(/\.[^.]+$/, '')),
        file: it.name,
        path: p,
        ext: it.ext,
        size: it.size,
        mtime: new Date(it.file.lastModified || Date.now()).toISOString(),
        lang,
        langClass: LANG_CLASS[lang] || '',
        langSource: 'auto',
        group: '',
        groupTitle: '',
        tags: [],
        url: '',
      });
      added++;
    }

    await saveIndex(data, `更新字幕库索引（新增 ${added} 条）`);
    log(`字幕库索引已更新：新增 ${added} 条，累计 ${data.count} 条`, 'ok');
  }

  /** 重算 subs.json 的计数与统计（新增 / 改说明 / 删除后都要跑一次） */
  function recomputeIndex(data) {
    data.items = data.items || [];
    data.items.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
    data.count = data.items.length;
    data.generated = new Date().toISOString();

    const byLang = {}, byExt = {};
    for (const x of data.items) {
      const l = x.lang || '未标注';
      byLang[l] = (byLang[l] || 0) + 1;
      byExt[x.ext] = (byExt[x.ext] || 0) + 1;
    }
    data.stats = { languages: byLang, formats: byExt, groups: {} };
    return data;
  }

  /** 写回 subs.json（自动重算计数据） */
  function saveIndex(data, message) {
    recomputeIndex(data);
    return putFile(
      'assets/data/subs.json',
      utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
      message
    );
  }

  /* ======================= 下载统计 ======================= */

  async function loadStats() {
    ui.statSummary.textContent = '加载中…';
    ui.statTable.innerHTML = '';

    /* 概览：字幕总数 / 最近更新（来自 subs.json） */
    const ov = ui.overview ? ui.overview.querySelectorAll('.stat b') : [];
    try {
      const sres = await fetch('/assets/data/subs.json', { cache: 'no-store' });
      const sdata = await sres.json();
      const items = sdata.items || [];
      const latest = items.map((i) => i.mtime || '').filter(Boolean).sort().pop() || '';
      if (ov[0]) ov[0].textContent = items.length;
      if (ov[2]) ov[2].textContent = latest ? latest.slice(5, 10).replace('-', '/') : '—';
    } catch {
      if (ov[0]) ov[0].textContent = '—';
      if (ov[2]) ov[2].textContent = '—';
    }

    let timer;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), 10000);

      const res = await fetch('/api/counts', { cache: 'no-store', signal: ctrl.signal });
      const data = await res.json();
      if (ov[1]) ov[1].textContent = data.enabled ? data.total : '—';

      if (!data.enabled) {
        ui.statSummary.innerHTML = data.reason === 'not-bound'
          ? `统计未开启。<br><span style="color:var(--text-dim)">${esc(data.hint || '')}</span>`
          : `统计不可用${data.error ? '：' + esc(data.error) : ''}`;
        return;
      }

      const entries = Object.entries(data.counts || {}).sort((a, b) => b[1] - a[1]);
      countsMap = new Map(entries);
      renderManage();   // 管理列表也顺便显示下载次数
      statEntries = entries;
      statTotal = data.total || 0;
      renderStatTable();
    } catch (e) {
      ui.statSummary.innerHTML =
        `读取统计失败：${e.name === 'AbortError' ? '请求超时' : esc(e.message)}` +
        `<br><span style="color:var(--text-dim)">本地预览时统计接口不可用是正常的 —— ` +
        `Pages Functions 只在 Cloudflare 上运行；本地请确认 <code>node tools/serve.mjs</code> 是最新版。</span>`;
    } finally {
      clearTimeout(timer);
    }
  }

  /** 渲染下载排行表（受 #statSearch 过滤） */
  function renderStatTable() {
    const kw = statKw.trim().toLowerCase();

    if (!statEntries.length) {
      ui.statSummary.textContent = '还没有下载记录。等有人从字幕库下载后，这里就会出现数据。';
      ui.statTable.innerHTML = '';
      return;
    }

    const list = kw
      ? statEntries.filter(([p]) => p.toLowerCase().includes(kw))
      : statEntries;

    const sum = list.reduce((s, [, n]) => s + n, 0);

    ui.statSummary.innerHTML = kw
      ? `匹配 <b>${list.length}</b> / ${statEntries.length} 个文件 · 这些文件共 <b>${sum}</b> 次下载`
      : `共 <b>${statTotal}</b> 次下载 · 涉及 <b>${statEntries.length}</b> 个文件` +
        (list.length > 100 ? '（下表只显示前 100 个）' : '');

    if (!list.length) {
      ui.statTable.innerHTML = '<div class="result-info">没有匹配的文件。</div>';
      return;
    }

    const max = Math.max(...list.map(([, n]) => n)) || 1;
    ui.statTable.innerHTML = `
      <table class="stat-table">
        <thead><tr><th>文件</th><th class="num">下载</th><th class="bar-cell"></th></tr></thead>
        <tbody>
          ${list.slice(0, 100).map(([p, n]) => {
            const segs = p.split('/').filter(Boolean);
            const name = segs[segs.length - 1] || p;
            return `<tr>
              <td>
                <a href="${esc(fileUrl(p))}" target="_blank" rel="noopener">${esc(name)}</a>
              </td>
              <td class="num">${n}</td>
              <td class="bar-cell"><div class="mini-bar" style="width:${Math.max(3, Math.round((n / max) * 100))}%"></div></td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;
  }

  $('btnReloadStats').addEventListener('click', loadStats);
  $('statSearch').addEventListener('input', (e) => { statKw = e.target.value; renderStatTable(); });

  /* ======================= 字幕管理（改说明 / 删除） ======================= */

  const mgUI = { list: $('mgList'), info: $('mgInfo'), log: $('mgLog'), reload: $('btnReloadMg') };

  function mglog(msg, kind = '') {
    mgUI.log.hidden = false;
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = document.createElement('div');
    line.className = kind ? 'l-' + kind : '';
    line.textContent = `[${t}] ${msg}`;
    mgUI.log.appendChild(line);
    mgUI.log.scrollTop = mgUI.log.scrollHeight;
  }

  function needToken(what) {
    if (state.token) return true;
    ui.setupCard.open = true;
    mglog(`还没配置令牌，无法${what} —— 已展开「上传设置」`, 'err');
    return false;
  }

  /* ----------------------- 缩略图 ----------------------- */

  const pendingThumb = new Map();   // item.path → 处理好的 jpg base64（等用户确认）

  /** 缩略图在仓库里的路径：与字幕同名，扩展名换成 .jpg */
  function thumbPathFor(item) {
    const base = String(item.file || item.name).replace(/\.[^.]+$/, '');
    return `${THUMB_DIR}/${base}.jpg`;
  }

  const dataUrlToB64 = (u) => String(u).split(',')[1] || '';

  function readImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('浏览器认不出这张图')); };
      img.src = url;
    });
  }

  /**
   * 居中裁成 16:9 并缩到 480×270，返回 jpeg 的 dataURL。
   * needsCrop  —— 原图比例不是 16:9（要切掉两边或上下）
   * needsResize —— 原图大于 480×270
   * 两个都为 false 时可以直接用，不必再问用户。
   */
  function makeThumb(img, w, h) {
    const target = THUMB_W / THUMB_H;
    const needsCrop = Math.abs(w / h - target) > 0.02;
    const needsResize = w > THUMB_W || h > THUMB_H;

    // 以中心为准取 16:9 的最大内接矩形
    let cw = w, ch = Math.round(w / target);
    if (ch > h) { ch = h; cw = Math.round(h * target); }
    const cx = Math.round((w - cw) / 2);
    const cy = Math.round((h - ch) / 2);

    const cv = document.createElement('canvas');
    cv.width = THUMB_W;
    cv.height = THUMB_H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';   // 透明 PNG 导成 jpeg 会变黑，先铺白底
    ctx.fillRect(0, 0, THUMB_W, THUMB_H);
    ctx.drawImage(img, cx, cy, cw, ch, 0, 0, THUMB_W, THUMB_H);

    return {
      dataUrl: cv.toDataURL('image/jpeg', 0.85),
      needsCrop,
      needsResize,
      from: `${w}×${h}`,
      crop: `${cw}×${ch}`,
    };
  }

  /** 选图后的处理：能直接用就传，需要裁剪就先给预览等确认 */
  async function pickThumb(item, row, file) {
    setNote(row, '正在读取图片…');
    try {
      if (!/^image\//.test(file.type)) throw new Error('只能选图片文件');
      if (file.size > 8 * 1024 * 1024) throw new Error('图片太大了（上限 8 MB）');

      const img = await readImage(file);
      const t = makeThumb(img, img.naturalWidth, img.naturalHeight);

      if (!t.needsCrop && !t.needsResize) {
        setNote(row, `${t.from}，尺寸合适，正在上传…`);
        await uploadThumb(item, dataUrlToB64(t.dataUrl), `${t.from}`);
        return;
      }

      pendingThumb.set(item.path, dataUrlToB64(t.dataUrl));

      row.querySelector('.mg-crop-img').src = t.dataUrl;
      row.querySelector('.mg-crop-note').innerHTML =
        `原图 <b>${t.from}</b> —— ` +
        (t.needsCrop ? '比例不是 16:9，需要切掉多余部分' : '尺寸超过 480×270') +
        `。下面是<b>取最中间</b>裁成 16:9 的效果（${t.crop} → 480×270）。<br>` +
        `不满意就先自己裁好再选一次。`;
      row.querySelector('.mg-crop').hidden = false;
      setNote(row, '等待确认');
    } catch (e) {
      setNote(row, e.message, 'err');
    }
  }

  async function confirmThumb(item, row, btn) {
    const b64 = pendingThumb.get(item.path);
    if (!b64) { setNote(row, '没有待上传的图', 'err'); return; }
    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '上传中…';
    try {
      await uploadThumb(item, b64, '已裁剪');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  async function uploadThumb(item, b64, how) {
    if (!needToken('上传缩略图')) return;
    const path = thumbPathFor(item);
    try {
      await putFile(path, b64, `上传缩略图 ${path}`);

      // 把缩略图路径写回索引（重新读一次，避开别处的改动）
      const data = JSON.parse(await readText('assets/data/subs.json'));
      const target = (data.items || []).find((x) => x.path === item.path);
      if (!target) throw new Error('索引里找不到这个条目，可能已被删除');
      target.thumb = '/' + path;
      await saveIndex(data, `关联缩略图：${item.name}`);

      item.thumb = '/' + path;
      pendingThumb.delete(item.path);
      renderManage();
      mglog(`缩略图已上传（${how}）：${path}`, 'ok');
    } catch (e) {
      const msg = friendlyErr(e);
      mglog(`缩略图上传失败：${msg}`, 'err');
      const live = [...mgUI.list.querySelectorAll('.mg-row')]
        .find((r) => r.getAttribute('data-path') === item.path);
      if (live) setNote(live, msg, 'err');
    }
  }

  async function clearThumb(item, row, btn) {
    if (!needToken('移除缩略图')) return;
    if (!confirm(`移除这张缩略图吗？\n\n${item.thumb}\n\n图片会从仓库删掉，字幕本身不受影响。`)) return;

    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '移除中…';
    try {
      await deleteFile(String(item.thumb).replace(/^\//, ''), `删除缩略图 ${item.thumb}`);

      const data = JSON.parse(await readText('assets/data/subs.json'));
      const target = (data.items || []).find((x) => x.path === item.path);
      if (target) delete target.thumb;
      await saveIndex(data, `解除缩略图关联：${item.name}`);

      delete item.thumb;
      renderManage();
      mglog(`已移除缩略图：${item.name}`, 'ok');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = old;
      setNote(row, friendlyErr(e), 'err');
    }
  }

  /** 把 GitHub 的报错翻译成能直接照着做的提示 */
  function friendlyErr(e) {
    const m = String((e && e.message) || e);
    if (/\b401\b/.test(m)) {
      ui.setupCard.open = true;
      return '令牌无效或已过期（GitHub 401）—— 已展开「上传设置」，请重新保存一个有效的令牌';
    }
    if (/\b403\b/.test(m)) {
      ui.setupCard.open = true;
      return '令牌没有写权限（GitHub 403）—— 到令牌设置里把 Contents 改成 Read and write';
    }
    if (/\b404\b/.test(m)) {
      return '仓库或文件找不到（GitHub 404）—— 检查令牌是否勾选了 bqtj 仓库';
    }
    return m;
  }

  async function loadManage() {
    mgUI.list.innerHTML = '<div class="spinner"></div>';
    try {
      const res = await fetch('/assets/data/subs.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      mgItems = data.items || [];
      renderManage();
    } catch (e) {
      mgUI.list.innerHTML =
        `<div class="empty"><h3>读取字幕索引失败</h3><p>${esc(e.message)}</p></div>`;
      mgUI.info.textContent = '';
    }
  }

  /** 管理列表的搜索匹配：名字 / 文件名 / 路径 / 说明（空格分词 = AND） */
  function matchMg(it, kw) {
    if (!kw) return true;
    const hay = (it.name + ' ' + (it.file || '') + ' ' + it.path + ' ' + (it.desc || '')).toLowerCase();
    return kw.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
  }

  function renderManage() {
    if (!mgUI.list) return;

    if (!mgItems.length) {
      mgUI.list.innerHTML =
        '<div class="empty"><h3>还没有字幕</h3><p>在「1 上传字幕」里传几个再回来。</p></div>';
      mgUI.info.textContent = '共 0 个字幕';
      return;
    }

    const kw = mgKw.trim();
    const list = mgItems.filter((it) => matchMg(it, kw));

    mgUI.info.textContent = kw
      ? `匹配 ${list.length} / ${mgItems.length}`
      : `共 ${mgItems.length} 个字幕`;

    if (!list.length) {
      mgUI.list.innerHTML =
        '<div class="empty"><h3>没有匹配的字幕</h3><p>换个关键词试试。</p></div>';
      return;
    }

    mgUI.list.innerHTML = list.map((it) => {
      const n = countsMap.get(it.path);
      return `
      <div class="mg-row" data-path="${esc(it.path)}">
        <div class="mg-head">
          <div class="mg-thumb${it.thumb ? '' : ' no-thumb'}">
            ${it.thumb
              ? `<img src="${esc(fileUrl(it.thumb))}" alt="" loading="lazy">`
              : esc(it.ext)}
          </div>
          <div class="up-main">
            <div class="up-name">${esc(it.name)}</div>
            <div class="up-sub">
              <span>${humanSize(it.size)}</span>
              <span title="${esc(it.mtime)}">${relTime(it.mtime)}</span>
              ${n ? `<span class="count-badge">${n} 次下载</span>` : ''}
              ${it.desc ? '<span class="state ok">已有说明</span>' : ''}
            </div>
          </div>
        </div>

        <div class="mg-edit">
          <input class="input" data-desc maxlength="120"
                 placeholder="写一句说明（会显示在名字下方，留空则清除）"
                 value="${esc(it.desc || '')}">
          <button class="btn btn-sm btn-primary" data-act="save">保存说明</button>
          <button class="btn btn-sm btn-danger" data-act="del">删除字幕</button>
        </div>

        <div class="mg-tools">
          <button class="btn btn-sm" data-act="thumb">${it.thumb ? '更换缩略图' : '选择缩略图'}</button>
          ${it.thumb ? '<button class="btn btn-sm" data-act="thumb-clear">移除缩略图</button>' : ''}
          <span class="mg-note"></span>
          <input type="file" accept="image/*" hidden data-thumb-input>
        </div>

        <div class="mg-crop" hidden>
          <img class="mg-crop-img" alt="裁剪后预览">
          <div class="mg-crop-side">
            <div class="mg-crop-note"></div>
            <div class="file-actions">
              <button class="btn btn-sm btn-primary" data-act="thumb-ok">使用裁剪后的图</button>
              <button class="btn btn-sm" data-act="thumb-cancel">取消</button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  mgUI.reload.addEventListener('click', loadManage);

  $('mgSearch').addEventListener('input', (e) => { mgKw = e.target.value; renderManage(); });

  /* ---- 展开「字幕管理」需要访问密码 ----
     注意：这是前端校验，只能挡住随手点开的人，不是真正的安全措施
     （任何人都能查看页面源码看到密码）。真正管住写入的是 GitHub 令牌。 */
  const MG_PWD = S.adminPassword || 'bqtj';
  const mgCard = $('mgCard');
  let mgUnlocked = false;

  function lockManage(msg = '') {
    mgUnlocked = false;
    $('mgLock').hidden = false;
    $('mgBody').hidden = true;
    $('mgPwd').value = '';
    $('mgLockMsg').textContent = msg;
  }

  function unlockManage() {
    if ($('mgPwd').value.trim() !== MG_PWD) {
      lockManage('密码不对');
      $('mgPwd').focus();
      return;
    }
    mgUnlocked = true;
    $('mgLock').hidden = true;
    $('mgBody').hidden = false;
    $('mgLockMsg').textContent = '';
    $('mgPwd').value = '';
    loadManage();
  }

  $('mgUnlock').addEventListener('click', unlockManage);
  $('mgPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockManage(); });

  // 收起时重新上锁 —— 下次展开还要再输一次
  mgCard.addEventListener('toggle', () => { if (!mgCard.open && mgUnlocked) lockManage(); });

  function rowItem(row) {
    return mgItems.find((x) => x.path === row.getAttribute('data-path'));
  }

  function setNote(row, text, kind = '') {
    const n = row.querySelector('.mg-note');
    if (n) { n.textContent = text; n.className = 'mg-note' + (kind ? ' ' + kind : ''); }
  }

  mgUI.list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const row = btn.closest('.mg-row');
    const item = rowItem(row);
    if (!item) return;

    switch (btn.dataset.act) {
      case 'save':         return saveDesc(item, row, btn);
      case 'del':          return removeSub(item, row, btn);
      case 'thumb':        return row.querySelector('input[data-thumb-input]')?.click();
      case 'thumb-clear':  return clearThumb(item, row, btn);
      case 'thumb-ok':     return confirmThumb(item, row, btn);
      case 'thumb-cancel': {
        pendingThumb.delete(item.path);
        const box = row.querySelector('.mg-crop');
        if (box) box.hidden = true;
        setNote(row, '已取消');
        return;
      }
    }
  });

  // <input type=file> 选好图后冒泡到这里
  mgUI.list.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-thumb-input]');
    if (!input || !input.files || !input.files[0]) return;
    const row = input.closest('.mg-row');
    const file = input.files[0];
    input.value = '';                    // 清空，保证再选同一张也会触发 change
    const item = rowItem(row);
    if (item) pickThumb(item, row, file);
  });

  /** 改说明：只改索引里的 desc 字段，不动字幕文件 */
  async function saveDesc(item, row, btn) {
    if (!needToken('保存说明')) return;
    const desc = row.querySelector('input[data-desc]').value.trim();
    if (desc === (item.desc || '')) { mglog('说明没有变化', 'warn'); return; }

    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      // 重新读一次索引，避免覆盖别处的改动
      const data = JSON.parse(await readText('assets/data/subs.json'));
      const target = (data.items || []).find((x) => x.path === item.path);
      if (!target) throw new Error('索引里找不到这个条目，可能已被删除');

      if (desc) target.desc = desc;
      else delete target.desc;

      await saveIndex(data, `更新字幕说明：${item.name}`);
      item.desc = desc;
      renderManage();
      mglog(desc ? `已保存说明：${item.name}` : `已清空说明：${item.name}`, 'ok');
    } catch (e) {
      mglog(`保存失败：${friendlyErr(e)}`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /** 删除：先删仓库里的文件，再从索引里去掉条目 */
  async function removeSub(item, row, btn) {
    if (!needToken('删除字幕')) return;
    if (!confirm(`确定删除这个字幕吗？\n\n${item.file}\n\n文件会从仓库删除，索引条目也会移除。`)) return;

    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '删除中…';
    try {
      // 有缩略图就一并删掉；缩略图删失败不阻断字幕删除
      if (item.thumb) {
        try {
          await deleteFile(String(item.thumb).replace(/^\//, ''), `删除缩略图 ${item.thumb}`);
        } catch (err) {
          mglog(`缩略图没删掉（不影响字幕删除）：${err.message}`, 'warn');
        }
      }

      await deleteFile(item.path, `删除字幕 ${item.file}`);

      const data = JSON.parse(await readText('assets/data/subs.json'));
      data.items = (data.items || []).filter((x) => x.path !== item.path);
      await saveIndex(data, `从索引移除 ${item.file}`);

      const i = mgItems.findIndex((x) => x.path === item.path);
      if (i >= 0) mgItems.splice(i, 1);
      renderManage();
      mglog(`已删除：${item.file}`, 'ok');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = old;
      mglog(`删除失败：${friendlyErr(e)}`, 'err');
    }
  }

  /* ======================= 初始化 ======================= */

  renderList();
  loadStats();
  // 字幕管理要输密码解锁后才加载（unlockManage 里调 loadManage）
  setTimeout(() => { if (!state.token) log('提示：先在「上传设置」里保存 GitHub 令牌，才能上传。', 'warn'); }, 300);
})();
