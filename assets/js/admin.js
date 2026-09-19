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

  const $ = (id) => document.getElementById(id);
  const ui = {
    setupCard: $('setupCard'), token: $('token'),
    connBox: $('connBox'), connMsg: $('connMsg'),
    drop: $('drop'), picker: $('picker'),
    upList: $('upList'), upActions: $('upActions'), log: $('log'),
    statSummary: $('statSummary'), statTable: $('statTable'), maxSize: $('maxSize'),
  };

  const state = { token: '', files: [], tree: null };
  let seq = 0;

  ui.maxSize.textContent = humanSize(MAX);

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
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
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

  async function putFile(path, base64, message) {
    const sha = (await loadTree()).get(path);
    const body = { message, content: base64 };
    if (sha) body.sha = sha;
    if (REPO.branch) body.branch = REPO.branch;
    const res = await gh(`/contents/${encodePath(path)}`, {
      method: 'PUT', body: JSON.stringify(body),
    });
    state.tree = null;  // 内容变了，缓存作废
    return res;
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
        <span class="up-icon">📝</span>
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
    $('btnUploadAll').textContent = pending ? `⬆ 上传 ${pending} 个字幕` : '⬆ 全部已上传';
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
        log(`✓ ${it.name} → ${path}`, 'ok');
      } catch (e) {
        it.status = 'err';
        it.note = e.message;
        fail++;
        log(`✗ ${it.name}：${e.message}`, 'err');
      }
      renderList();
    }

    log(`上传结束：成功 ${ok}，失败 ${fail}`, fail ? 'warn' : 'ok');

    if (done.length) {
      try {
        await patchSubsIndex(done);
      } catch (e) {
        log(`字幕库索引更新失败：${e.message}（文件已上传，可再点一次上传重试）`, 'err');
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

    await putFile(
      'assets/data/subs.json',
      utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
      `更新字幕库索引（新增 ${added} 条）`
    );
    log(`字幕库索引已更新：新增 ${added} 条，累计 ${data.count} 条`, 'ok');
  }

  /* ======================= 下载统计 ======================= */

  async function loadStats() {
    ui.statSummary.textContent = '加载中…';
    ui.statTable.innerHTML = '';

    let timer;
    try {
      const ctrl = new AbortController();
      timer = setTimeout(() => ctrl.abort(), 10000);

      const res = await fetch('/api/counts', { cache: 'no-store', signal: ctrl.signal });
      const data = await res.json();

      if (!data.enabled) {
        ui.statSummary.innerHTML = data.reason === 'not-bound'
          ? `统计未开启。<br><span style="color:var(--text-dim)">${esc(data.hint || '')}</span>`
          : `统计不可用${data.error ? '：' + esc(data.error) : ''}`;
        return;
      }

      const entries = Object.entries(data.counts || {}).sort((a, b) => b[1] - a[1]);
      if (!entries.length) {
        ui.statSummary.textContent = '还没有下载记录。等有人从字幕库下载后，这里就会出现数据。';
        return;
      }

      ui.statSummary.innerHTML =
        `共 <b>${data.total}</b> 次下载 · 涉及 <b>${entries.length}</b> 个文件` +
        (entries.length > 100 ? '（下表只显示前 100）' : '');

      const max = entries[0][1];
      ui.statTable.innerHTML = `
        <table class="stat-table">
          <thead><tr><th>文件</th><th class="num">下载</th><th class="bar-cell"></th></tr></thead>
          <tbody>
            ${entries.slice(0, 100).map(([p, n]) => {
              const segs = p.split('/').filter(Boolean);
              const name = segs[segs.length - 1] || p;
              return `<tr>
                <td>
                  <a href="${esc(fileUrl(p))}" target="_blank" rel="noopener">${esc(name)}</a>
                  <div class="path-cell">${esc(p)}</div>
                </td>
                <td class="num">${n}</td>
                <td class="bar-cell"><div class="mini-bar" style="width:${Math.max(3, Math.round((n / max) * 100))}%"></div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    } catch (e) {
      ui.statSummary.innerHTML =
        `读取统计失败：${e.name === 'AbortError' ? '请求超时' : esc(e.message)}` +
        `<br><span style="color:var(--text-dim)">本地预览时统计接口不可用是正常的 —— ` +
        `Pages Functions 只在 Cloudflare 上运行；本地请确认 <code>node tools/serve.mjs</code> 是最新版。</span>`;
    } finally {
      clearTimeout(timer);
    }
  }

  $('btnReloadStats').addEventListener('click', loadStats);

  /* ======================= 初始化 ======================= */

  renderList();
  loadStats();
  setTimeout(() => { if (!state.token) log('提示：先在「上传设置」里保存 GitHub 令牌，才能上传。', 'warn'); }, 300);
})();
