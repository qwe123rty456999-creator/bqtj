/* ==========================================================================
   admin.js — 上传助手
   ① 浏览器选文件 → 小文件经 GitHub Contents API 直接提交到仓库
   ② 大文件自动分流到网盘，并生成站点条目写回数据文件
   ③ 令牌只存在本机 localStorage，绝不写入仓库
   ========================================================================== */

(function () {
  const S = window.SITE || {};
  const REPO = S.github || { owner: '', repo: '', branch: 'main' };
  const PAN = S.pan || {};
  const MAX = S.repoUploadMaxBytes || 10 * 1024 * 1024;
  const LS_KEY = 'bqtj_gh_token';

  const $ = (id) => document.getElementById(id);
  const api = {
    token: $('token'), connBox: $('connBox'), connMsg: $('connMsg'),
    repoText: $('repoText'),
    drop: $('drop'), picker: $('picker'), dest: $('dest'), batchLang: $('batchLang'),
    upList: $('upList'), upActions: $('upActions'), log: $('log'),
    bigList: $('bigList'), panHelp: $('panHelp'),
    kind: $('kind'), preview: $('preview'),
  };

  const state = { token: '', files: [], tree: null, pendingSize: 0, pendingName: '' };
  let fileSeq = 0;

  api.repoText.textContent = `${REPO.owner}/${REPO.repo}`;
  api.panHelp.textContent = PAN.shareHelp || '';
  api.dest.value = 'files/subs/';
  if (PAN.uploadUrl) $('btnOpenPan').href = PAN.uploadUrl;

  /* ======================= 日志 ======================= */

  function log(msg, kind = '') {
    api.log.hidden = false;
    const t = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const line = document.createElement('div');
    line.className = kind ? 'l-' + kind : '';
    line.textContent = `[${t}] ${msg}`;
    api.log.appendChild(line);
    api.log.scrollTop = api.log.scrollHeight;
  }

  /* ======================= 编码工具 ======================= */

  function utf8ToBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function base64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1]);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(file);
    });
  }

  /* ======================= GitHub API ======================= */
  /* 只发送 Authorization 和 Content-Type 两个头 ——
     实测 GitHub 的 CORS 预检只放行白名单内的头，多一个自定义头就会被拒。 */

  const base = () => `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;

  async function gh(path, opts = {}) {
    const headers = { Authorization: `Bearer ${state.token}` };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.accept) headers.Accept = opts.accept;

    const res = await fetch(base() + path, {
      method: opts.method || 'GET',
      headers,
      body: opts.body,
    });

    if (opts.raw) {
      if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
      return res.text();
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!res.ok) {
      const msg = data && data.message ? data.message : res.status;
      const err = new Error(`HTTP ${res.status}：${msg}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  /** 拉取整个仓库的文件清单（path → blob sha），一次请求拿到所有 sha */
  async function loadTree(force) {
    if (state.tree && !force) return state.tree;
    const data = await gh(`/git/trees/${REPO.branch}?recursive=1`);
    const map = new Map();
    (data.tree || []).forEach((n) => { if (n.type === 'blob') map.set(n.path, n.sha); });
    state.tree = map;
    return map;
  }

  async function shaOf(path) {
    const tree = await loadTree();
    return tree.get(path) || undefined;
  }

  async function readText(path) {
    return gh(`/contents/${encodePath(path)}?ref=${REPO.branch}`, {
      accept: 'application/vnd.github.raw',
      raw: true,
    });
  }

  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

  async function putFile(path, base64, message) {
    const sha = await shaOf(path);
    const body = { message, content: base64 };
    if (sha) body.sha = sha;
    if (REPO.branch) body.branch = REPO.branch;

    const res = await gh(`/contents/${encodePath(path)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    state.tree = null; // 内容变了，缓存作废
    return res;
  }

  /* ======================= 文件名处理（与本地索引脚本保持一致） ======================= */

  const LANG_RULES = [
    [/简繁|简\+繁|繁简|CHS\s*[&+]\s*CHT|GB\s*[&+]\s*BIG5/i, '简繁'],
    [/中日|日中|JPSC/i, '中日'],
    [/简体|简中|简日|简|CHS|\bGB\b|GBK|GB2312/i, '简中'],
    [/繁体|繁中|繁日|繁|CHT|BIG5|正体/i, '繁中'],
    [/zh[-_ ]?hans|zh[-_ ]?cn\b/i, '简中'],
    [/zh[-_ ]?hant|zh[-_ ]?tw\b|zh[-_ ]?hk\b/i, '繁中'],
    [/日语|日文|\bJP\b|\bJPN\b/i, '日语'],
    [/英语|英文|\bENG\b|\bEN\b/i, '英语'],
  ];
  const LANG_CLASS = { '简中': 'zh-hans', '繁中': 'zh-hant', '简繁': 'zh-both', '中日': 'ja', '日语': 'ja', '英语': 'en' };

  function detectLang(name) {
    for (const [re, lang] of LANG_RULES) if (re.test(name)) return lang;
    return '';
  }

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

  const extOf = (name) => {
    const i = name.lastIndexOf('.');
    return i < 0 ? '' : name.slice(i + 1).toLowerCase();
  };

  const isSub = (ext) => ['ass', 'ssa', 'srt', 'vtt', 'sub', 'idx', 'sup'].includes(ext);
  const isImage = (ext) => ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif', 'svg'].includes(ext);
  const isVideo = (ext) => ['mp4', 'mkv', 'avi', 'mov', 'webm', 'flv', 'ts', 'm2ts', 'rmvb'].includes(ext);
  const isArchive = (ext) => ['zip', 'rar', '7z', 'iso', 'tar', 'gz', 'xz', '001'].includes(ext);

  /* ======================= 连接设置 ======================= */

  function setConn(cls, msg) {
    api.connBox.className = 'conn ' + cls;
    api.connMsg.innerHTML = msg;
  }

  async function verify(silent) {
    if (!state.token) { setConn('off', '还没填令牌'); return false; }
    setConn('', '正在验证…');
    try {
      const repo = await gh('');
      const canPush = repo.permissions && repo.permissions.push;
      if (!canPush) {
        setConn('off', `连上了 <b>${repo.full_name}</b>，但这个令牌<b>没有写入权限</b>，请检查 Contents 权限`);
        return false;
      }
      const tree = await loadTree(true);
      setConn('on', `已连接 <b>${repo.full_name}</b> · 分支 <b>${repo.default_branch}</b> · 仓库内 ${tree.size} 个文件`);
      if (!silent) log(`连接成功：${repo.full_name}（${tree.size} 个文件）`, 'ok');
      return true;
    } catch (e) {
      setConn('off', `连接失败：${esc(e.message)}`);
      if (!silent) log(`连接失败：${e.message}`, 'err');
      return false;
    }
  }

  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  $('btnSave').addEventListener('click', async () => {
    const v = api.token.value.trim();
    if (!v) { log('令牌是空的', 'err'); return; }
    state.token = v;
    localStorage.setItem(LS_KEY, v);
    log('令牌已保存到本机浏览器', 'ok');
    await verify(false);
  });

  $('btnVerify').addEventListener('click', () => verify(false));

  $('btnForget').addEventListener('click', () => {
    localStorage.removeItem(LS_KEY);
    state.token = '';
    api.token.value = '';
    state.tree = null;
    setConn('off', '令牌已清除');
    log('已清除本机保存的令牌', 'warn');
  });

  {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) {
      state.token = saved;
      api.token.value = saved;
      verify(true);
    } else {
      setConn('off', '尚未连接，先把令牌填到下面并保存');
    }
  }

  /* ======================= 选文件 ======================= */

  $('drop').addEventListener('click', () => api.picker.click());
  $('drop').addEventListener('dragover', (e) => { e.preventDefault(); api.drop.classList.add('over'); });
  $('drop').addEventListener('dragleave', () => api.drop.classList.remove('over'));
  $('drop').addEventListener('drop', (e) => {
    e.preventDefault();
    api.drop.classList.remove('over');
    addFiles(e.dataTransfer.files);
  });
  api.picker.addEventListener('change', () => { addFiles(api.picker.files); api.picker.value = ''; });

  function addFiles(fileList) {
    const arr = [...fileList];
    if (!arr.length) return;
    for (const f of arr) {
      state.files.push({
        id: ++fileSeq,
        file: f,
        name: f.name,
        size: f.size,
        ext: extOf(f.name),
        status: 'wait',
        note: '',
      });
    }
    renderList();
    log(`加入 ${arr.length} 个文件`, 'info');
  }

  function icon(it) {
    if (isSub(it.ext)) return '📝';
    if (isImage(it.ext)) return '🖼';
    if (isVideo(it.ext)) return '🎬';
    if (isArchive(it.ext)) return '📦';
    if (it.ext === 'json') return '🧾';
    return '📄';
  }

  function stateBadge(it) {
    const map = {
      wait: ['wait', '待处理'],
      busy: ['busy', '上传中'],
      ok: ['ok', '已完成'],
      err: ['err', '失败'],
      skip: ['skip', '需走网盘'],
    };
    const [c, t] = map[it.status] || map.wait;
    return `<span class="state ${c}">${t}</span>`;
  }

  function renderList() {
    const small = state.files.filter((f) => f.size <= MAX);
    const big = state.files.filter((f) => f.size > MAX);

    if (!state.files.length) {
      api.upList.innerHTML = '';
      api.upActions.hidden = true;
    } else {
      api.upActions.hidden = false;
      api.upList.innerHTML = state.files.map((it) => `
        <div class="up-row" data-id="${it.id}">
          <span class="up-icon">${icon(it)}</span>
          <div class="up-main">
            <div class="up-name">${esc(it.name)}</div>
            <div class="up-sub">
              <span>${humanSize(it.size)}</span>
              <span class="tag">${esc(it.ext || '无扩展名')}</span>
              ${stateBadge(it)}
              ${it.note ? `<span>${esc(it.note)}</span>` : ''}
            </div>
            ${it.status === 'busy' ? '<div class="bar"><i style="width:45%"></i></div>' : ''}
          </div>
          <div class="up-act">
            ${it.size > MAX
              ? `<button class="btn btn-sm" data-act="tobig" data-id="${it.id}">生成条目</button>`
              : ''}
            <button class="btn btn-sm" data-act="del" data-id="${it.id}">移除</button>
          </div>
        </div>`).join('');
    }

    // 大文件区
    if (!big.length) {
      $('bigList').textContent = '（还没有超过 ' + humanSize(MAX) + ' 的文件）';
    } else {
      $('bigList').textContent = big
        .map((f) => `${humanSize(f.size).padStart(9)}  ${f.name}`)
        .join('\n');
    }

    $('btnUploadAll').disabled = !small.some((f) => f.status === 'wait' || f.status === 'err');
    $('btnUploadAll').textContent = small.length
      ? `⬆ 上传 ${small.filter((f) => f.status !== 'ok').length} 个文件到仓库`
      : '⬆ 全部上传到仓库';
  }

  api.upList.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.getAttribute('data-id'));
    const idx = state.files.findIndex((f) => f.id === id);
    if (idx < 0) return;
    if (btn.getAttribute('data-act') === 'del') {
      state.files.splice(idx, 1);
      renderList();
    } else if (btn.getAttribute('data-act') === 'tobig') {
      const f = state.files[idx];
      state.pendingSize = f.size;
      state.pendingName = cleanName(f.name.replace(/\.[^.]+$/, ''));
      $('f-title').value = state.pendingName;
      $('f-pan').focus();
      location.hash = '#item';
      $('f-pan').scrollIntoView({ behavior: 'smooth', block: 'center' });
      log(`已把「${state.pendingName}」填进条目表单，填上网盘链接即可提交`, 'info');
      updatePreview();
    }
  });

  $('btnClearList').addEventListener('click', () => {
    state.files = [];
    renderList();
  });

  $('btnCopyNames').addEventListener('click', (e) => {
    const names = state.files.filter((f) => f.size > MAX).map((f) => f.name).join('\n');
    if (!names) { log('没有大文件需要复制', 'warn'); return; }
    copyText(names, e.target);
  });

  $('btnBigHelp').addEventListener('click', () => {
    const big = state.files.filter((f) => f.size > MAX);
    log(
      big.length
        ? `有 ${big.length} 个大文件（共 ${humanSize(big.reduce((s, f) => s + f.size, 0))}）。` +
          '请点第 3 步的「打开网盘上传页」，把文件传上去后拿到分享链接和提取码，再回到第 4 步生成条目。'
        : '当前没有大文件。',
      'info'
    );
    $('bigList').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });

  /* ======================= 上传小文件 ======================= */

  $('btnUploadAll').addEventListener('click', async () => {
    if (!state.token) { log('先在第 1 步保存令牌', 'err'); return; }
    const dest = normalizeDest(api.dest.value);
    const targets = state.files.filter((f) => f.size <= MAX && f.status !== 'ok');
    if (!targets.length) { log('没有待上传的小文件', 'warn'); return; }

    if (!(await verify(true))) return;

    log(`开始上传 ${targets.length} 个文件到 ${dest}/ …`, 'info');
    let ok = 0, fail = 0;
    const uploaded = [];

    for (const it of targets) {
      it.status = 'busy';
      renderList();
      const path = `${dest}/${it.name}`;
      try {
        const b64 = await fileToBase64(it.file);
        await putFile(path, b64, `上传 ${it.name}`);
        it.status = 'ok';
        it.note = path;
        uploaded.push(it);
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

    // 字幕文件 → 同步更新字幕库索引
    if (dest.startsWith('files/subs') && uploaded.some((f) => isSub(f.ext))) {
      try {
        await patchSubsIndex(uploaded, dest);
      } catch (e) {
        log(`字幕库索引更新失败：${e.message}（文件已上传，可稍后手动重试）`, 'err');
      }
    }

    if (ok) log('Cloudflare Pages 会自动重新部署，约 1 分钟后生效。', 'info');
  });

  function normalizeDest(v) {
    let d = (v || '').trim().replace(/^\/+|\/+$/g, '');
    if (!d) d = 'files/uploads';
    return d;
  }

  /** 把新上传的字幕追加进 assets/data/subs.json */
  async function patchSubsIndex(files, dest) {
    const group = dest.split('/').slice(2).join('/') || '未分类';
    const batchLang = api.batchLang.value;

    log('正在更新字幕库索引 assets/data/subs.json …', 'info');
    const cur = await gh(`/contents/assets/data/subs.json?ref=${REPO.branch}`, {
      accept: 'application/vnd.github.raw', raw: true,
    });
    const data = JSON.parse(cur);
    data.items = data.items || [];

    const have = new Set(data.items.map((x) => x.path));
    let added = 0;

    for (const it of files) {
      if (!isSub(it.ext)) continue;
      const p = '/' + dest + '/' + it.name;
      if (have.has(p)) continue;
      const lang = batchLang || detectLang(it.name);
      data.items.unshift({
        name: cleanName(it.name.replace(/\.[^.]+$/, '')),
        file: it.name,
        path: p,
        ext: it.ext,
        size: it.size,
        mtime: new Date(it.file.lastModified || Date.now()).toISOString(),
        lang,
        langClass: LANG_CLASS[lang] || '',
        langSource: batchLang ? 'batch' : (lang ? 'filename' : ''),
        group,
        groupTitle: group,
        tags: [],
        url: '',
      });
      added++;
    }

    data.items.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)));
    data.count = data.items.length;
    data.generated = new Date().toISOString();
    data.stats = data.stats || {};
    const byLang = {}, byExt = {}, byGroup = {};
    for (const x of data.items) {
      const l = x.lang || '未标注';
      byLang[l] = (byLang[l] || 0) + 1;
      byExt[x.ext] = (byExt[x.ext] || 0) + 1;
      byGroup[x.group] = (byGroup[x.group] || 0) + 1;
    }
    data.stats.languages = byLang;
    data.stats.formats = byExt;
    data.stats.groups = byGroup;

    await putFile(
      'assets/data/subs.json',
      utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
      `更新字幕库索引（新增 ${added} 条）`
    );
    log(`字幕库索引已更新，新增 ${added} 条，累计 ${data.count} 条`, 'ok');
  }

  /* ======================= 条目表单 ======================= */

  function syncFormForKind() {
    const g = api.kind.value === 'game';
    $('wrap-plat').style.display = g ? '' : 'none';
    $('wrap-ver').style.display = g ? '' : 'none';
    $('wrap-eps').style.display = g ? 'none' : '';   // 话数只对动画有意义
    $('wrap-year').style.display = g ? 'none' : '';
    $('f-year').hidden = g;
    $('f-sub').placeholder = g ? '英文名 / 副标题' : '日文原名';
    updatePreview();
  }

  function buildItem() {
    const g = api.kind.value === 'game';
    const tags = $('f-tags').value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    const panUrl = $('f-pan').value.trim();
    const panCode = $('f-code').value.trim();
    const pan = panUrl ? { name: PAN.name || '网盘', url: panUrl, code: panCode } : null;

    const today = new Date().toISOString().slice(0, 10);

    if (g) {
      const it = {
        title: $('f-title').value.trim(),
        titleEn: $('f-sub').value.trim(),
        desc: $('f-desc').value.trim(),
        tags,
        platform: $('f-plat').value.trim() || 'Windows',
        version: $('f-ver').value.trim(),
        updated: today,
      };
      if ($('f-cover').value.trim()) it.cover = $('f-cover').value.trim();
      if (state.pendingSize) it.size = state.pendingSize;
      if ($('f-pwd').value.trim()) it.password = $('f-pwd').value.trim();
      if (pan) it.pan = pan;
      return it;
    }
    const it = {
      title: $('f-title').value.trim(),
      titleJa: $('f-sub').value.trim(),
      year: Number($('f-year').value) || undefined,
      episodes: Number($('f-eps').value) || undefined,
      desc: $('f-desc').value.trim(),
      tags,
      date: today,
      subs: '/subs/?q=' + encodeURIComponent($('f-title').value.trim()),
    };
    if ($('f-cover').value.trim()) it.cover = $('f-cover').value.trim();
    if (pan) it.pan = pan;
    return it;
  }

  function updatePreview() {
    const it = buildItem();
    Object.keys(it).forEach((k) => { if (it[k] === '' || it[k] === undefined) delete it[k]; });
    api.preview.textContent = JSON.stringify(it, null, 2);
    return it;
  }

  ['f-title', 'f-sub', 'f-tags', 'f-desc', 'f-plat', 'f-ver', 'f-year', 'f-eps',
   'f-cover', 'f-pan', 'f-code', 'f-pwd'].forEach((id) =>
    $(id)?.addEventListener('input', updatePreview));

  api.kind.addEventListener('change', syncFormForKind);

  $('btnCopyJSON').addEventListener('click', (e) => {
    copyText(api.preview.textContent, e.target);
  });

  $('btnSubmitItem').addEventListener('click', async () => {
    const it = updatePreview();
    if (!it.title) { log('名称不能为空', 'err'); $('f-title').focus(); return; }
    if (!it.pan) { log('网盘分享链接不能为空（访客就靠这个下载）', 'err'); $('f-pan').focus(); return; }
    if (!state.token) { log('先在第 1 步保存令牌', 'err'); return; }
    if (!(await verify(true))) return;

    const isGame = api.kind.value === 'game';
    const dataPath = isGame ? 'assets/data/games.json' : 'assets/data/anime.json';

    try {
      log(`正在写入 ${dataPath} …`, 'info');
      const raw = await gh(`/contents/${dataPath}?ref=${REPO.branch}`, {
        accept: 'application/vnd.github.raw', raw: true,
      });
      const data = JSON.parse(raw);
      data.items = data.items || [];
      data.items.unshift(it);
      data.updated = new Date().toISOString().slice(0, 10);

      await putFile(
        dataPath,
        utf8ToBase64(JSON.stringify(data, null, 2) + '\n'),
        `添加${isGame ? '游戏' : '动漫'}：${it.title}`
      );
      log(`✅ 已写入：${it.title}（共 ${data.items.length} 条）`, 'ok');
      log('Cloudflare 会自动重新部署，约 1 分钟后在首页可见。', 'info');
    } catch (e) {
      log(`写入失败：${e.message}`, 'err');
    }
  });

  /* ======================= 初始化 ======================= */

  syncFormForKind();
  renderList();
  setTimeout(() => { if (!state.token) log('提示：先在「1」保存 GitHub 令牌，才能上传。', 'warn'); }, 300);
})();
