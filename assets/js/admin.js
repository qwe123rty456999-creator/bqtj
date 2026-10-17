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

  /* 缩略图：公开列表里按 160×90 显示（16:9），上传前统一处理成 640×360 的 jpg */
  const THUMB_W = 640;
  const THUMB_H = 360;
  const THUMB_DIR = 'files/thumbs';

  const $ = (id) => document.getElementById(id);
  const ui = {
    setupCard: $('setupCard'), token: $('token'),
    connBox: $('connBox'), connMsg: $('connMsg'),
    log: $('log'),
    statSummary: $('statSummary'), statTable: $('statTable'), maxSize: $('maxSize'),
    overview: $('overview'),
  };

  const state = { token: '', tree: null };

  /* --------------------------- 发送状态提示 --------------------------- */
  /**
   * 每次和 GitHub 通信都过这里。
   * 国内访问 api.github.com 经常很慢、甚至根本没回应 —— 不给反馈的话用户只能干等，
   * 分不清「还在发」和「早就卡死了」。所以：发出去时亮「正在发送」，
   * 拿到状态码时说「GitHub 已回应（HTTP xxx）」，连不上就直接说发不出去。
   */
  let toastTimer = 0;
  function sendState(kind, msg) {
    const el = $('sendToast');
    if (!el) return;
    clearTimeout(toastTimer);
    el.className = 'send-toast ' + kind;
    el.textContent = msg;
    el.hidden = false;
    // 「发送中」不自动消失；结果停几秒再收，失败多停一会儿好让人看清原因
    if (kind !== 'sending') {
      toastTimer = setTimeout(() => { el.hidden = true; }, kind === 'bad' ? 7000 : 2600);
    }
  }

  /* 请求超时：不给超时的话，连不上时会一直转，看不出是「在发」还是「已经死了」 */
  const REQ_TIMEOUT = 20000;
  const timeoutSignal = () =>
    (typeof AbortSignal !== 'undefined' && AbortSignal.timeout)
      ? AbortSignal.timeout(REQ_TIMEOUT) : undefined;

  /** 把 fetch 抛出的网络错误翻译成一句话 */
  function sendFailReason(e) {
    if (e && e.name === 'TimeoutError') return `等不到回应（${REQ_TIMEOUT / 1000} 秒超时）`;
    if (e && e.name === 'AbortError') return '请求被中断';
    return '请求发不出去（网络不通或被拦截）';
  }

  /**
   * 把 fetch 抛出的网络错误包成统一的人话错误。
   * 浏览器原始信息是 "Failed to fetch" / "Load failed"，用户看了不知道该怎么办。
   */
  function netError(e) {
    const err = new Error(sendFailReason(e));
    err.sendFailed = true;
    return err;
  }

  let countsMap = new Map();   // path → 下载次数（来自 /api/counts）
  let mgItems = [];            // 字幕管理的当前列表（来自 subs.json）
  let statEntries = [];        // 下载统计原始数据 [[path, 次数], ...]
  let statTotal = 0;
  let statKw = '';             // 数据概览的搜索词
  let mgKw = '';               // 字幕管理的搜索词
  let mgPage = 1;              // 字幕管理当前页（94 条全铺出来太长，改成一页一页翻）
  const MG_PAGE_SIZE = 20;

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

    sendState('sending', '正在发送请求…');
    let res;
    try {
      res = await fetch(repoBase() + path, {
        method: opts.method || 'GET', headers, body: opts.body, signal: timeoutSignal(),
      });
    } catch (e) {
      const why = sendFailReason(e);
      sendState('bad', '发送失败：' + why);
      throw netError(e);
    }
    // 能拿到状态码就说明「发出去了、GitHub 也回应了」—— 这正是用户要确认的
    sendState(res.ok ? 'ok' : 'bad', `GitHub 已回应（HTTP ${res.status}）`);

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

  /**
   * 写仓库时的 409 重试。
   *
   * GitHub Contents API 要求带上「文件当前的 sha」，跟服务端对不上就拒收：
   *   409：assets/data/subs.json does not match 1bcd41f…
   * 我们对 sha 的认知来自一次 /git/trees 快照 —— 只要期间文件被**别处**改过
   * （另一个标签页、手机、线上管理页、GitHub 网页上直接编辑），快照就过期了。
   * 强刷一次 tree 拿到新 sha 再试一遍，绝大多数情况直接就过了。
   */
  async function withShaRetry(fn) {
    try {
      return await fn();
    } catch (e) {
      if (e.status !== 409) throw e;
      await loadTree(true);
      return await fn();
    }
  }

  async function putFile(path, base64, message) {
    const res = await withShaRetry(async () => {
      const sha = await shaOf(path);
      const body = { message, content: base64 };
      if (sha) body.sha = sha;
      if (REPO.branch) body.branch = REPO.branch;
      return await gh(`/contents/${encodePath(path)}`, {
        method: 'PUT', body: JSON.stringify(body),
      });
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
    const missing = await withShaRetry(async () => {
      const sha = await shaOf(path);
      if (!sha) return true;      // 本来就不在，当成功
      await gh(`/contents/${encodePath(path)}`, {
        method: 'DELETE',
        body: JSON.stringify({ message, sha, branch: REPO.branch }),
      });
      return false;
    });
    if (missing) throw new Error('仓库里找不到这个文件，可能已经被删掉了');
    state.tree?.delete(path);
  }

  /* ======================= 设置（令牌） ======================= */

  function setConn(cls, msg) {
    ui.connBox.className = 'conn ' + cls;
    ui.connMsg.innerHTML = msg;
  }

  async function verify(silent) {
    if (!state.token) { setConn('off', '还没填令牌'); return false; }
    setConn('', '正在发送请求给 GitHub…');
    sendState('sending', '正在发送请求给 GitHub…');
    try {
      // 这里直接用 fetch 而不是 gh()，因为需要读响应头来判断令牌类型
      let res;
      try {
        res = await fetch(repoBase(), {
          headers: { Authorization: `Bearer ${state.token}` }, signal: timeoutSignal(),
        });
      } catch (e) {
        throw netError(e);
      }
      const repo = await res.json();
      sendState(res.ok ? 'ok' : 'bad', `GitHub 已回应（HTTP ${res.status}）`);
      if (!res.ok) throw new Error(`HTTP ${res.status}：${repo.message || res.status}`);

      /* 细粒度令牌（fine-grained）不会返回 x-oauth-scopes 头。
         它的 permissions 字段反映的是「你账号」对仓库的权限，而不是令牌被授予的权限 ——
         所以这里显示 push:true 并不代表真能写，上传时仍可能 403。必须提醒。 */
      const fineGrained = res.headers.get('x-oauth-scopes') === null;

      if (!(repo.permissions && repo.permissions.push)) {
        setConn('off', `连上了 <b>${esc(repo.full_name)}</b>，但这个令牌<b>没有写入权限</b>，请检查 Contents 权限`);
        return false;
      }

      const tree = await loadTree(true);
      setConn('on',
        `已连接 <b>${esc(repo.full_name)}</b> · 分支 <b>${esc(repo.default_branch)}</b> · 仓库内 ${tree.size} 个文件` +
        (fineGrained
          ? '<br><span style="color:var(--warn)">细粒度令牌：此处只验证了<b>读取</b>权限。' +
            '上传/保存若报 403，请到令牌设置里把 <b>Contents</b> 改成 <b>Read and write</b>。</span>'
          : '')
      );
      if (!silent) log(`连接成功：${repo.full_name}（${tree.size} 个文件）`, 'ok');
      return true;
    } catch (e) {
      const why = e.sendFailed ? e.message : esc(e.message);
      setConn('off', `连接失败：${why}`);
      sendState('bad', '连接失败：' + why);
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
    // 保存后要去 GitHub 验一下，这段得等网络 —— 按钮变成「发送中…」并禁用，
    // 否则用户会反复点，看不出到底有没有发出去
    const btn = $('btnSave');
    const old = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = '发送中…';
    const ok = await verify(false);
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    btn.textContent = old;
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

  /* ======================= 选文件（一次一条） ======================= */

  /**
   * 2026-10-16 用户要求改造：原来是「一次拖一堆文件 → 批量上传 → 再跑到第 3 步
   * 一条条补说明」，改成**一次传一条**，选文件的当下就把基本信息填完。
   * 同一个条目的 ASS 和 SRT 一次选中即可，省得传完再回来补。
   */
  const upFiles = { ass: null, srt: null };      // 当前表单选中的两个文件
  const UP_INPUT = { ass: 'upAss', srt: 'upSrt' };
  const UP_LABEL = { ass: 'upAssName', srt: 'upSrtName' };

  /** 文件主名（去掉扩展名）—— 判断 ASS / SRT 是不是同一首的依据 */
  function baseNameOf(fileName) {
    return String(fileName || '').replace(/\.[^.]+$/, '');
  }
  const fileOf = (p) => String(p || '').split('/').pop();

  function setPickLabel(kind, file) {
    const el = $(UP_LABEL[kind]);
    if (!el) return;
    el.textContent = file ? `${file.name}（${humanSize(file.size)}）` : '还没有选择文件';
    el.classList.toggle('has-file', !!file);
  }

  /* ----------------------- 缩略图（选填） -----------------------
     用户问「上传略缩图呢？」—— 原来只有第 3 步（字幕管理）能挂缩略图，
     新传的字幕得先去那边补一次。这里直接复用同一套处理：
     readImage + makeThumb（居中裁 16:9、压到 640×360），上传时一起提交。 */
  let upThumb = null;                            // { b64, dataUrl, from }

  function showUpThumbPreview() {
    const el = $('upThumbPreview');
    if (!el) return;
    if (!upThumb) { el.hidden = true; el.innerHTML = ''; return; }
    el.hidden = false;
    el.innerHTML = '<div class="pv-title">缩略图预览</div><div class="pv-grid">' +
      '<div class="pv-item">' +
        `<img src="${upThumb.dataUrl}" alt="">` +
        `<span class="pv-tag">${esc(upThumb.from)} → ${THUMB_W}×${THUMB_H}</span>` +
        '<button class="pv-del" type="button" data-cancel-upthumb title="取消">×</button>' +
      '</div></div>';
  }

  {
    const input = $('upThumb');
    if (input) {
      input.addEventListener('change', async () => {
        const f = input.files && input.files[0];
        input.value = '';                        // 清空，保证再选同一张也会触发 change
        if (!f) return;
        if (!/^image\//.test(f.type)) { log('缩略图只能选图片文件', 'err'); return; }
        if (f.size > 8 * 1024 * 1024) { log('图片太大了（上限 8 MB）', 'err'); return; }
        try {
          const img = await readImage(f);
          const t = makeThumb(img, img.naturalWidth, img.naturalHeight);
          upThumb = { b64: dataUrlToB64(t.dataUrl), dataUrl: t.dataUrl, from: t.from };
          const label = $('upThumbName');
          if (label) {
            label.textContent = `${f.name}（${humanSize(f.size)}）`;
            label.classList.add('has-file');
          }
          showUpThumbPreview();
          log(`缩略图已就绪：原图 ${t.from} → ${THUMB_W}×${THUMB_H}${t.needsCrop ? '（居中裁成 16:9）' : ''}`, 'info');
        } catch (e) {
          log(`缩略图读取失败：${e.message}`, 'err');
        }
      });
    }
  }

  /* 预览里那个 × —— 取消已选的缩略图（不用重选文件就能撤） */
  document.addEventListener('click', (e) => {
    if (!e.target.closest('[data-cancel-upthumb]')) return;
    upThumb = null;
    showUpThumbPreview();
    const label = $('upThumbName');
    if (label) { label.textContent = '还没有选择图片'; label.classList.remove('has-file'); }
    log('已取消缩略图', 'info');
  });


  /** 用文件名自动填「显示名称」。只在那一栏还是空的、或还停在上次自动填的值时才覆盖。 */
  let lastNameAuto = '';
  function autoFillName(file) {
    const el = $('upName');
    if (!el) return;
    const cur = el.value.trim();
    if (cur && cur !== lastNameAuto) return;      // 用户自己改过，别动它
    lastNameAuto = cleanName(baseNameOf(file.name));
    el.value = lastNameAuto;
  }

  /* 自定义文件选择器：普通按钮去触发藏起来的 <input type=file> */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-pick]');
    if (b) $(b.getAttribute('data-pick')).click();
  });

  Object.entries(UP_INPUT).forEach(([kind, id]) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';                          // 清空，保证再选同一个文件也会触发 change
      if (!f) return;

      const ext = extOf(f.name);
      if (kind === 'ass' && ext !== 'ass' && ext !== 'ssa') {
        log('ASS 那一栏只能选 .ass 或 .ssa', 'err');
        return;
      }
      if (kind === 'srt' && ext !== 'srt') {
        log('SRT 那一栏只能选 .srt', 'err');
        return;
      }
      if (f.size > MAX) {
        log(`${f.name} 有 ${humanSize(f.size)}，超过上限 ${humanSize(MAX)}`, 'err');
        return;
      }

      upFiles[kind] = f;
      setPickLabel(kind, f);
      autoFillName(f);

      /* 两个都选了但主名不一样 → 立刻提醒，别等点上传才发现 */
      if (upFiles.ass && upFiles.srt &&
          baseNameOf(upFiles.ass.name) !== baseNameOf(upFiles.srt.name)) {
        log(`两个文件的主名不一样（${baseNameOf(upFiles.ass.name)} / ${baseNameOf(upFiles.srt.name)}），` +
            '别人会分不清是不是同一首。建议改成一样，或只传其中一个。', 'warn');
      } else {
        log(`已选择 ${kind.toUpperCase()}：${f.name}`, 'info');
      }
    });
  });

  function clearForm() {
    upFiles.ass = null;
    upFiles.srt = null;
    upThumb = null;
    lastNameAuto = '';
    setPickLabel('ass', null);
    setPickLabel('srt', null);
    showUpThumbPreview();
    const tl = $('upThumbName');
    if (tl) { tl.textContent = '还没有选择图片'; tl.classList.remove('has-file'); }
    ['upName', 'upDesc', 'upVideo', 'upVideoDl', 'upLyrics'].forEach((id) => {
      const el = $(id);
      if (el) el.value = '';
    });
  }

  $('btnClearForm').addEventListener('click', () => { clearForm(); log('表单已清空', 'info'); });

  /* ======================= 上传 ======================= */

  /** 有值就写、没值就删掉那个字段（subs.json 不留空串，保持干净） */
  function setOrDelete(obj, key, val) {
    if (val) obj[key] = val; else delete obj[key];
  }

  $('btnUploadOne').addEventListener('click', async () => {
    if (!state.token) {
      ui.setupCard.open = true;
      log('还没配置令牌 —— 已帮你展开「上传设置」，填好保存再点上传', 'err');
      return;
    }

    const picked = [['ass', upFiles.ass], ['srt', upFiles.srt]].filter(([, f]) => f);
    if (!picked.length) {
      log('先选一个字幕文件（ASS、SRT 都行，也可以两个一起选）', 'err');
      return;
    }

    const name = $('upName').value.trim();
    if (!name) {
      log('「显示名称」不能为空', 'err');
      $('upName').focus();
      return;
    }

    if (upFiles.ass && upFiles.srt &&
        baseNameOf(upFiles.ass.name) !== baseNameOf(upFiles.srt.name)) {
      log('两个文件的主名不一样，先改成一致再传（文件名决定它们是不是同一条字幕）', 'err');
      return;
    }

    if (!(await verify(true))) return;

    const btn = $('btnUploadOne');
    btn.disabled = true;
    btn.textContent = '上传中…';
    try {
      const paths = {};
      for (const [kind, f] of picked) {
        const p = `${DEST}/${f.name}`;
        log(`上传 ${f.name}（${humanSize(f.size)}）…`, 'info');
        await putFile(p, await fileToBase64(f), `上传字幕 ${f.name}`);
        paths[kind] = { path: '/' + p, file: f.name, size: f.size, lastModified: f.lastModified };
        log(`已上传 ${f.name} → ${p}`, 'ok');
      }

      /* 缩略图和第 3 步用同一套命名：files/thumbs/<主名>.jpg */
      let thumbPath = '';
      if (upThumb) {
        thumbPath = thumbPathFor({ file: (paths.ass || paths.srt).file });
        log(`上传缩略图（${humanSize(Math.round(upThumb.b64.length * 0.75))}）…`, 'info');
        await putFile(thumbPath, upThumb.b64, `上传缩略图 ${thumbPath}`);
      }

      await saveSubEntry({ name, paths, thumbPath: thumbPath ? '/' + thumbPath : '' });
      log('完成。Cloudflare 约 1 分钟后生效。', 'ok');
      clearForm();
    } catch (e) {
      log(`上传失败：${friendlyErr(e)}`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = '上传这一条';
    }
  });

  /**
   * 把这一条写进 subs.json。
   *
   * 关键点：
   * - **先按文件路径、再按主名找已有条目** —— 这样「之前只传了 ass，现在单独补一个 srt」
   *   会挂到同一条上，而不是新建一条重复的。
   * - 条目的 path / file / ext / size 始终跟着**主版本**走，主版本优先 ASS：
   *   列表缩略图、下载统计、管理页都以 path 为准，没有特殊情况不要让它来回变。
   *   （只有「先传 SRT、后来才补 ASS」这一种情况会让 path 从 srt 换成 ass，那是应该的。）
   */
  async function saveSubEntry({ name, paths, thumbPath }) {
    log('正在更新字幕库索引 assets/data/subs.json …', 'info');
    const data = JSON.parse(await readText('assets/data/subs.json'));
    data.items = data.items || [];

    const first = paths.ass || paths.srt;

    let item = data.items.find((x) =>
      x.path === first.path || x.ass === first.path || x.srt === first.path);
    if (!item) {
      /* 再按主名找：覆盖「已有 X.ass，这次只传 X.srt」的情况 */
      const base = baseNameOf(first.file);
      item = data.items.find((x) => baseNameOf(x.file || '') === base);
    }

    const isNew = !item;
    if (isNew) {
      item = {
        path: '', file: '', ext: '', size: 0, mtime: '',
        lang: '', langClass: '', langSource: 'auto', tags: [], url: '',
      };
      data.items.unshift(item);
    }

    if (paths.ass) item.ass = paths.ass.path;
    if (paths.srt) item.srt = paths.srt.path;

    const primaryKind = item.ass ? 'ass' : 'srt';
    const primaryPath = item.ass || item.srt;
    item.path = primaryPath;
    item.file = fileOf(primaryPath);
    item.ext = extOf(item.file);

    /* size / mtime 只有「这次传的正好是主版本」时才更新，
       否则补传一个 SRT 会把列表上显示的大小改成 SRT 的。 */
    if (paths[primaryKind]) {
      item.size = paths[primaryKind].size;
      item.mtime = new Date(paths[primaryKind].lastModified || Date.now()).toISOString();
    } else if (!item.mtime) {
      item.mtime = new Date().toISOString();
    }

    item.name = name;
    if (thumbPath) item.thumb = thumbPath;
    setOrDelete(item, 'desc', $('upDesc').value.trim());
    setOrDelete(item, 'videoUrl', cleanUrl($('upVideo').value));
    setOrDelete(item, 'videoDl', cleanUrl($('upVideoDl').value));
    setOrDelete(item, 'lyrics', $('upLyrics').value.trim());

    if (!item.lang) {
      const lang = detectLang(item.file) || DEFAULT_LANG;
      item.lang = lang;
      item.langClass = LANG_CLASS[lang] || '';
    }

    await saveIndex(data, `${isNew ? '新增' : '更新'}字幕：${name}`);
    log(`索引已更新：${isNew ? '新增' : '更新'} 1 条，累计 ${data.count} 条`, 'ok');
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
        (t.needsCrop ? '比例不是 16:9，需要切掉多余部分' : `尺寸超过 ${THUMB_W}×${THUMB_H}`) +
        `。下面是<b>取最中间</b>裁成 16:9 的效果（${t.crop} → ${THUMB_W}×${THUMB_H}）。<br>` +
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
    if (/\b409\b/.test(m)) {
      return '这个文件在别处被改过（版本对不上，GitHub 409）—— 已自动重试过一次。还是不行就刷新页面再来，避免两个标签页同时改。';
    }
    if (/\b409\b/.test(m)) {
      return '这个文件在别处被改过（版本对不上，GitHub 409）—— 已自动重试过一次。还是不行就刷新页面再来，避免两个标签页同时改。';
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

  /* ----------------------- 未保存内容的「草稿」 -----------------------
     renderManage() 是整段重建 innerHTML，而输入框的值只活在 DOM 里。
     所以只要触发一次重渲染（保存缩略图、补传 SRT、切搜索词、删掉别的条目……），
     用户正在编辑但还没点「保存」的内容就会被打回 subs.json 里的旧值 ——
     用户实测报过「保存略缩图会丢失前面已经输入的内容」，根因就在这里。

     解法：渲染前先把每行输入框的当前值存成草稿，渲染时优先用草稿。
     保存成功后就把它从草稿里去掉（数据已经是新的了）。 */
  const drafts = new Map();          // item.path → { name, desc, lyrics, videoUrl, videoDl }
  const DRAFT_FIELDS = ['name', 'desc', 'lyrics', 'videoUrl', 'videoDl'];
  const DRAFT_SEL = {
    name: 'input[data-name]', desc: 'input[data-desc]', lyrics: 'textarea[data-lyrics]',
    videoUrl: 'input[data-video]', videoDl: 'input[data-videodl]',
  };

  /* 展开着的行。默认全部收起（用户反馈「现在显示的太多，不好找」——
     一行摊开是六个输入框 + 一排按钮，93 条根本翻不动）。
     保存 / 补传缩略图后会 renderManage() 整表重建 —— 不记住的话
     刚编辑完的那行会自己收起，还得重新点开，所以用 Set 存住。 */
  const openRows = new Set();

  function captureDrafts() {
    mgUI.list.querySelectorAll('.mg-row').forEach((row) => {
      const p = row.getAttribute('data-path');
      const d = {};
      for (const k of DRAFT_FIELDS) {
        const el = row.querySelector(DRAFT_SEL[k]);
        if (el) d[k] = el.value;
      }
      if (Object.keys(d).length) drafts.set(p, d);
    });
  }

  function renderManage() {
    if (!mgUI.list) return;

    /* 先抢在重建 DOM 之前，把还没保存的输入收进草稿 */
    captureDrafts();
    for (const k of [...drafts.keys()]) {
      if (!mgItems.some((x) => x.path === k)) drafts.delete(k);
    }

    if (!mgItems.length) {
      mgUI.list.innerHTML =
        '<div class="empty"><h3>还没有字幕</h3><p>在「1 上传字幕」里传几个再回来。</p></div>';
      mgUI.info.textContent = '共 0 个字幕';
      return;
    }

    const kw = mgKw.trim();
    const list = mgItems.filter((it) => matchMg(it, kw));

    /* 分页：一页 20 条。页码越界会自动夹回来（搜索词变了、删了一条都会导致总数变小） */
    const pages = Math.max(1, Math.ceil(list.length / MG_PAGE_SIZE));
    if (mgPage > pages) mgPage = pages;
    if (mgPage < 1) mgPage = 1;
    const start = (mgPage - 1) * MG_PAGE_SIZE;
    const pageList = list.slice(start, start + MG_PAGE_SIZE);

    mgUI.info.textContent =
      (kw ? `匹配 ${list.length} / ${mgItems.length}` : `共 ${mgItems.length} 个字幕`) +
      (pages > 1 ? ` · 第 ${mgPage}/${pages} 页` : '');

    if (!list.length) {
      mgUI.list.innerHTML =
        '<div class="empty"><h3>没有匹配的字幕</h3><p>换个关键词试试。</p></div>';
      return;
    }

    mgUI.list.innerHTML = pageList.map((it) => {
      const n = countsMap.get(it.path);
      const vs = subsVariantsOf(it);
      const kinds = vs.map((v) => v.kind);
      const d = drafts.get(it.path) || {};
      /* 有草稿（用户改过还没保存）就用草稿，否则用数据里的值 */
      const val = (k) => (k in d ? d[k] : (it[k] || ''));
      const open = openRows.has(it.path);
      return `
      <div class="mg-row${open ? ' open' : ''}" data-path="${esc(it.path)}">
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
              ${vs.length ? `<span class="tag">${kinds.map((k) => k.toUpperCase()).join(' / ')}</span>` : ''}
              ${n ? `<span class="count-badge">${n} 次下载</span>` : ''}
              ${it.desc ? '<span class="state ok">已有说明</span>' : ''}
              ${it.lyrics ? '<span class="state ok">已有歌词</span>' : ''}
              ${it.videoUrl ? '<span class="state">有原视频</span>' : ''}
              ${it.videoDl ? '<span class="state">有下载直链</span>' : ''}
            </div>
          </div>
          <button class="btn btn-sm mg-toggle" type="button" data-act="toggle"
                  aria-expanded="${open ? 'true' : 'false'}">${open ? '收起' : '编辑'}</button>
        </div>

        <div class="mg-edit">
          <input class="input" data-name maxlength="80"
                 placeholder="显示名称（只改网站上显示的名字，文件名和下载链接都不变）"
                 value="${esc(val('name'))}">
          <input class="input" data-desc maxlength="120"
                 placeholder="说明（显示在名字下方，留空则清除）"
                 value="${esc(val('desc'))}">
          <!-- 歌词单独一块、能往下展开（用户要求：别挤在一行里，和说明分开） -->
          <div class="mg-lyrics">
            <div class="mg-lyrics-head">
              原版歌词
              <span class="h2-tail">填了之后列表的「更多 → 原版歌词预览」才会出现</span>
            </div>
            <textarea class="textarea" data-lyrics rows="6"
                      placeholder="整段粘进来就行，保留换行（一行一句）。留空则清除。">${esc(val('lyrics'))}</textarea>
          </div>
          <input class="input" data-video maxlength="600"
                 placeholder="原视频链接，如 YouTube / B站（需 VPN 才能看；留空则不显示）"
                 value="${esc(val('videoUrl'))}">
          <input class="input" data-videodl maxlength="2000"
                 placeholder="下载原视频链接，如蓝奏云（提取码 bqtj；只填链接，别把「密码:xxxx」一起粘进来）"
                 value="${esc(val('videoDl'))}">
          <div class="mg-btns">
            <button class="btn btn-sm btn-primary" data-act="save">保存</button>
            <button class="btn btn-sm btn-danger" data-act="del">删除字幕</button>
          </div>
        </div>

        <div class="mg-tools">
          <!-- 两个版本各占一格：点一下就能补传 / 更换 -->
          <span class="mg-variants" title="这条字幕现有的文件">
            ${vs.length
              ? vs.map((v) => `<b class="v-${v.kind}">${v.kind.toUpperCase()}</b>`).join('')
              : '<b class="v-none">没有文件</b>'}
          </span>
          <button class="btn btn-sm" data-act="add-variant" data-kind="ass">${kinds.includes('ass') ? '更换 ASS' : '补传 ASS'}</button>
          <button class="btn btn-sm" data-act="add-variant" data-kind="srt">${kinds.includes('srt') ? '更换 SRT' : '补传 SRT'}</button>
          ${kinds.length > 1 ? '<button class="btn btn-sm btn-danger" data-act="del-variant" data-kind="srt">移除 SRT</button>' : ''}

          <button class="btn btn-sm" data-act="thumb">${it.thumb ? '更换缩略图' : '选择缩略图'}</button>
          ${it.thumb ? '<button class="btn btn-sm" data-act="thumb-clear">移除缩略图</button>' : ''}
          <span class="mg-note"></span>
          <input type="file" accept="image/*" hidden data-thumb-input>
          <input type="file" accept=".ass,.ssa" hidden data-var-input="ass">
          <input type="file" accept=".srt" hidden data-var-input="srt">
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
    }).join('') + pagerHTML(pages);
  }

  /** 分页控件（直接复用全站的 .pager 样式，不另写 CSS） */
  function pagerHTML(pages) {
    if (pages <= 1) return '';
    const nums = [];
    if (pages <= 7) {
      // 页数不多就全列出来 —— 否则会出现「1 2 3 … 5」这种只跳过一个数字的省略号
      for (let i = 1; i <= pages; i++) nums.push(i);
    } else {
      for (let i = 1; i <= pages; i++) {
        if (i === 1 || i === pages || Math.abs(i - mgPage) <= 2) nums.push(i);
        else if (nums[nums.length - 1] !== '…') nums.push('…');
      }
    }
    return `<div class="pager">
      <button type="button" data-act="prev-page"${mgPage <= 1 ? ' disabled' : ''}>上一页</button>
      ${nums.map((n) => n === '…'
        ? '<span class="gap">…</span>'
        : `<button type="button" data-act="goto-page" data-page="${n}"${n === mgPage ? ' class="active"' : ''}>${n}</button>`
      ).join('')}
      <button type="button" data-act="next-page"${mgPage >= pages ? ' disabled' : ''}>下一页</button>
    </div>`;
  }

  mgUI.reload.addEventListener('click', loadManage);

  /* 翻页：这三个按钮不在 .mg-row 里，所以单独一条委托（下面那条会因为找不到 item 而直接返回） */
  mgUI.list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act="prev-page"], button[data-act="next-page"], button[data-act="goto-page"]');
    if (!btn || btn.disabled) return;
    e.preventDefault();
    const act = btn.dataset.act;
    mgPage = act === 'goto-page' ? Number(btn.dataset.page) : mgPage + (act === 'next-page' ? 1 : -1);
    renderManage();
    mgUI.list.scrollIntoView({ block: 'start', behavior: 'smooth' });
  });

  $('mgSearch').addEventListener('input', (e) => { mgKw = e.target.value; mgPage = 1; renderManage(); });

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
    if (!row) return null;          // 分页按钮之类不在 .mg-row 里
    return mgItems.find((x) => x.path === row.getAttribute('data-path'));
  }

  function setNote(row, text, kind = '') {
    const n = row.querySelector('.mg-note');
    if (n) { n.textContent = text; n.className = 'mg-note' + (kind ? ' ' + kind : ''); }
  }

  /**
   * 展开 / 收起一行。
   * 只切 class 和按钮文字，**不重渲染** —— 表里有 90 多行，
   * 每点一次就重建一遍 DOM 又慢、还会把滚动位置抖掉。
   */
  function toggleRow(btn) {
    const row = btn.closest('.mg-row');
    if (!row) return;
    const open = !row.classList.contains('open');
    row.classList.toggle('open', open);
    btn.textContent = open ? '收起' : '编辑';
    btn.setAttribute('aria-expanded', String(open));
    const p = row.getAttribute('data-path');
    if (open) openRows.add(p); else openRows.delete(p);
  }

  /* 点整行头部也能展开 / 收起（点在按钮、输入框上时交给它们自己处理） */
  mgUI.list.addEventListener('click', (e) => {
    if (!e.target.closest('.mg-head')) return;
    if (e.target.closest('button, a, input, textarea, label, select')) return;
    const btn = e.target.closest('.mg-row')?.querySelector('[data-act="toggle"]');
    if (btn) toggleRow(btn);
  });

  mgUI.list.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn || btn.disabled) return;
    const row = btn.closest('.mg-row');
    const item = rowItem(row);
    if (!item) return;

    switch (btn.dataset.act) {
      case 'toggle':       return toggleRow(btn);
      case 'save':         return saveItem(item, row, btn);
      case 'del':          return removeSub(item, row, btn);
      case 'add-variant':  return row.querySelector(`input[data-var-input="${btn.dataset.kind}"]`)?.click();
      case 'del-variant':  return removeVariant(item, row, btn.dataset.kind);
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

  // 补传 / 更换 ASS、SRT
  mgUI.list.addEventListener('change', (e) => {
    const input = e.target.closest('input[data-var-input]');
    if (!input || !input.files || !input.files[0]) return;
    const row = input.closest('.mg-row');
    const kind = input.getAttribute('data-var-input');
    const file = input.files[0];
    input.value = '';
    const item = rowItem(row);
    if (item) uploadVariant(item, row, kind, file);
  });

  /**
   * 补传 / 更换一个版本（ASS 或 SRT）。
   *
   * ★ 文件名会被改成**和条目现有主名一致**（如条目是 `歌名.ass`，补传的 srt 就叫 `歌名.srt`）——
   *   站上「下载」二选一是靠主名判断两个文件是不是同一首的，名字不一致会让人看不懂。
   * ★ 之前只有 SRT、现在补上 ASS 时，主版本会从 SRT 换成 ASS（列表缩略图 / 下载统计都认 path，
   *   ASS 是成品，应该当主）。
   */
  async function uploadVariant(item, row, kind, file) {
    if (!needToken(`上传 ${kind.toUpperCase()}`)) return;

    const isAss = kind === 'ass';
    const ext = extOf(file.name);
    if (isAss ? (ext !== 'ass' && ext !== 'ssa') : ext !== 'srt') {
      setNote(row, `这一栏只能选 ${isAss ? '.ass / .ssa' : '.srt'} 文件`, 'err');
      return;
    }
    if (file.size > MAX) {
      setNote(row, `${humanSize(file.size)} 超过上限 ${humanSize(MAX)}`, 'err');
      return;
    }

    const oldPath = item.path;
    const base = baseNameOf(item.file || item.ass || item.srt || '') || baseNameOf(file.name);
    const target = `${base}.${isAss ? (ext === 'ssa' ? 'ssa' : 'ass') : 'srt'}`;
    const path = `${DEST}/${target}`;

    setNote(row, '上传中…');
    try {
      await putFile(path, await fileToBase64(file), `上传 ${kind.toUpperCase()}：${target}`);

      const data = JSON.parse(await readText('assets/data/subs.json'));
      const t = (data.items || []).find((x) => x.path === oldPath);
      if (!t) throw new Error('索引里找不到这个条目，可能已被删除');

      t[kind] = '/' + path;
      /* 主版本优先 ASS */
      const primary = t.ass || t.srt;
      t.path = primary;
      t.file = fileOf(primary);
      t.ext = extOf(t.file);
      if (isAss) t.size = file.size;
      if (!t.mtime) t.mtime = new Date().toISOString();

      await saveIndex(data, `补传 ${kind.toUpperCase()}：${item.name}`);

      /* 内存里的条目也跟着改，免得要重新拉一次列表 */
      item[kind] = '/' + path;
      item.path = primary;
      item.file = t.file;
      item.ext = t.ext;
      if (isAss) item.size = file.size;

      /* path 可能变了（SRT 主 → ASS 主），两边旧草稿都清掉再重渲染 */
      drafts.delete(oldPath);
      drafts.delete(item.path);
      renderManage();
      mglog(`已上传 ${kind.toUpperCase()}：${path}`, 'ok');
    } catch (e) {
      setNote(row, friendlyErr(e), 'err');
      mglog(`上传 ${kind.toUpperCase()} 失败：${friendlyErr(e)}`, 'err');
    }
  }

  /** 移除一个版本（只允许在另一个还在的时候用，否则整条就空了） */
  async function removeVariant(item, row, kind) {
    const path = item[kind];
    if (!path) return;
    const other = kind === 'ass' ? item.srt : item.ass;
    if (!other) {
      setNote(row, '至少要留一个文件 —— 想整条删掉请用「删除字幕」', 'err');
      return;
    }
    if (!needToken(`移除 ${kind.toUpperCase()}`)) return;
    if (!confirm(`移除这个 ${kind.toUpperCase()} 吗？\n\n${path}\n\n文件会从仓库删除，另一个版本保留。`)) return;

    setNote(row, '移除中…');
    try {
      await deleteFile(String(path).replace(/^\//, ''), `删除 ${kind.toUpperCase()}：${item.name}`);

      const data = JSON.parse(await readText('assets/data/subs.json'));
      const t = (data.items || []).find((x) => x.path === item.path);
      if (t) delete t[kind];
      await saveIndex(data, `移除 ${kind.toUpperCase()}：${item.name}`);

      delete item[kind];
      drafts.delete(item.path);
      renderManage();
      mglog(`已移除 ${kind.toUpperCase()}：${path}`, 'ok');
    } catch (e) {
      setNote(row, friendlyErr(e), 'err');
      mglog(`移除 ${kind.toUpperCase()} 失败：${friendlyErr(e)}`, 'err');
    }
  }

  /** 保存名称 / 说明 / 原版歌词 / 原视频 / 下载视频：只改索引，不动字幕文件 */
  async function saveItem(item, row, btn) {
    if (!needToken('保存')) return;

    const val = (sel) => (row.querySelector(sel)?.value || '').trim();
    const next = {
      name: val('input[data-name]'),
      desc: val('input[data-desc]'),
      lyrics: val('textarea[data-lyrics]'),
      videoUrl: val('input[data-video]'),
      videoDl: val('input[data-videodl]'),
    };
    // 名称只改显示用的那一份（subs.json 里的 name），不动 files/subs 下的文件名 ——
    // 改文件名会改掉下载链接，该字幕的下载统计也会从 0 重算。
    if (!next.name) { setNote(row, '名称不能为空', 'err'); row.querySelector('input[data-name]').focus(); return; }

    const FIELDS = ['name', 'desc', 'lyrics', 'videoUrl', 'videoDl'];

    if (FIELDS.every((k) => (item[k] || '') === next[k])) {
      drafts.delete(item.path);          // 内容和数据一致，草稿没意义了
      setNote(row, '没有变化');
      return;
    }

    const old = btn.textContent;
    btn.disabled = true;
    btn.textContent = '保存中…';
    try {
      // 重新读一次索引，避免覆盖别处的改动
      const data = JSON.parse(await readText('assets/data/subs.json'));
      const target = (data.items || []).find((x) => x.path === item.path);
      if (!target) throw new Error('索引里找不到这个条目，可能已被删除');

      for (const k of FIELDS) {
        if (next[k]) target[k] = next[k];
        else delete target[k];
      }

      await saveIndex(data, `更新字幕信息：${item.name}`);
      Object.assign(item, next);
      drafts.delete(item.path);          // 已落盘，草稿清掉
      renderManage();
      mglog(`已保存：${item.name}`, 'ok');
    } catch (e) {
      mglog(`保存失败：${friendlyErr(e)}`, 'err');
    } finally {
      btn.disabled = false;
      btn.textContent = old;
    }
  }

  /** 删除：先删仓库里的文件（ASS / SRT 都删），再从索引里去掉条目 */
  async function removeSub(item, row, btn) {
    if (!needToken('删除字幕')) return;

    const vs = subsVariantsOf(item);
    const listTxt = vs.length ? vs.map((v) => '· ' + v.path).join('\n') : item.file;
    if (!confirm(`确定删除这个字幕吗？\n\n${listTxt}\n\n文件会从仓库删除，索引条目也会移除。`)) return;

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

      // 主版本删不掉就中止（保持仓库和索引一致）；另一个版本失败只警告
      for (const [i, v] of vs.entries()) {
        const rel = String(v.path).replace(/^\//, '');
        try {
          await deleteFile(rel, `删除字幕 ${fileOf(v.path)}`);
        } catch (err) {
          if (i === 0) throw err;
          mglog(`${v.kind.toUpperCase()} 没删掉（继续）：${err.message}`, 'warn');
        }
      }

      const data = JSON.parse(await readText('assets/data/subs.json'));
      data.items = (data.items || []).filter((x) => x.path !== item.path);
      await saveIndex(data, `从索引移除 ${item.file}`);

      const i = mgItems.findIndex((x) => x.path === item.path);
      if (i >= 0) mgItems.splice(i, 1);
      drafts.delete(item.path);
      renderManage();
      mglog(`已删除：${item.file}`, 'ok');
    } catch (e) {
      btn.disabled = false;
      btn.textContent = old;
      mglog(`删除失败：${friendlyErr(e)}`, 'err');
    }
  }

  /* ======================= 全站强制刷新缓存 ======================= */

  /**
   * 「立即刷新全站缓存」。
   *
   * 线上有三层缓存，各自最长滞留时间：
   *   1. 访客浏览器的 Service Worker —— 10 分钟 ← 「改了看不到」基本都是它
   *   2. 腾讯云 EdgeOne 节点 —— HTML / 数据 60 秒（自动过期，不用管）
   *   3. Cloudflare Pages —— 部署完就是最新的
   *
   * Service Worker 的缓存名里带版本号（sw.js 顶部的 VERSION），版本号一变，
   * activate 就会把所有旧缓存删掉，访客下次打开页面整站重新下载。
   *
   * 所以这个按钮只做一件事：把 GitHub 上的 sw.js 版本号 +1 提交。
   * 不需要腾讯云密钥，也不用登录任何控制台。
   */
  const SW_VERSION_RE = /const VERSION = 'v(\d+)';/;

  async function bumpSwVersion() {
    const src = await readText('sw.js');
    const m = src.match(SW_VERSION_RE);
    if (!m) throw new Error('sw.js 里找不到 VERSION，可能被改过结构');
    const next = 'v' + (Number(m[1]) + 1);
    await putFile(
      'sw.js',
      utf8ToBase64(src.replace(m[0], `const VERSION = '${next}';`)),
      `chore(sw): 管理页强制刷新全站缓存 → ${next}`
    );
    return next;
  }

  /** 轮询线上 /sw.js，等 Cloudflare Pages 把新版部署出来 */
  async function waitSwDeploy(version, onTick) {
    const want = `const VERSION = '${version}';`;
    for (let i = 0; i < 40; i++) {          // 最多等 4 分钟
      await new Promise((r) => setTimeout(r, 6000));
      onTick((i + 1) * 6);
      try {
        const txt = await (await fetch('/sw.js', { cache: 'reload' })).text();
        if (txt.includes(want)) return true;
      } catch { /* 网络抖一下就继续等 */ }
    }
    return false;
  }

  (function initPurge() {
    const btn = $('btnPurgeAll');
    const msg = $('purgeMsg');
    if (!btn || !msg) return;
    const set = (t) => { msg.textContent = t; };

    btn.addEventListener('click', async () => {
      if (!state.token) { set('先在「上传设置」里保存 GitHub 令牌。'); return; }
      if (btn.disabled) return;
      btn.disabled = true;
      try {
        set('正在把 sw.js 的版本号 +1 提交到 GitHub…');
        const v = await bumpSwVersion();
        set(`已提交（新版本 ${v}），等 Cloudflare Pages 部署…`);
        const ok = await waitSwDeploy(v, (s) =>
          set(`已提交（新版本 ${v}），等 Cloudflare Pages 部署…已等 ${s} 秒`));
        set(ok
          ? `完成：线上 sw.js 已是 ${v}。访客下次打开页面会整站重新下载（那一次稍慢），之后照常秒开。`
          : `sw.js 已提交（${v}），但 4 分钟内没等到部署完成 —— 去 Cloudflare Pages 面板看下构建状态。`);
      } catch (e) {
        set('失败：' + (e && e.message ? e.message : e));
      } finally {
        btn.disabled = false;
      }
    });
  })();

  /* ======================= 初始化 ======================= */

  loadStats();
  // 字幕管理要输密码解锁后才加载（unlockManage 里调 loadManage）
  setTimeout(() => { if (!state.token) log('提示：先在「上传设置」里保存 GitHub 令牌，才能上传。', 'warn'); }, 300);
})();
