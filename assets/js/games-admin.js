/* ==========================================================================
   games-admin.js — 游戏管理页
   依赖：config.js（window.SITE）、site.js（esc / fileUrl / cleanUrl）

   设计要点：
   - 令牌与字幕上传助手共用同一个 localStorage key，配过一次两边都认。
   - 数据只写 assets/data/games.json（很小）；封面/截图写 files/games/<id>/。
     游戏本体放 123 云盘，不进仓库 —— 38.7MB 这种体积远超 Pages 单文件 25 MiB 上限。
   - 图片在浏览器里先压到 1280px / JPEG 0.85 再上传，避免把仓库撑大。
   - 每次写入是独立 commit，Cloudflare 会各自触发一次部署（个人站，能接受）。
   ========================================================================== */

(function () {
  const S = window.SITE || {};
  const REPO = S.github || {};
  const BRANCH = REPO.branch || 'main';

  const TOKEN_KEY = 'bqtj_gh_token';       // 和字幕上传助手共用
  const DATA_PATH = 'assets/data/games.json';
  const IMG_DIR = 'files/games';

  const $ = (id) => document.getElementById(id);
  const repoBase = () => `https://api.github.com/repos/${REPO.owner}/${REPO.repo}`;
  const encodePath = (p) => p.split('/').map(encodeURIComponent).join('/');

  /* -------------------------------- 状态 -------------------------------- */
  let token = localStorage.getItem(TOKEN_KEY) || '';
  let tree = null;                 // path -> blob sha（一次拉全，省得逐个查）
  let data = { generated: null, count: 0, items: [] };

  let editingId = null;            // 正在编辑的条目 id；null = 新增
  let pendingCover = null;         // { b64, dataUrl, name }
  let pendingShots = [];           // [{ b64, dataUrl, name }]

  /* ------------------------------ 小工具 ------------------------------ */
  function log(msg, kind = '') {
    const el = $('log');
    el.hidden = false;
    const line = document.createElement('div');
    // 类名要和 CSS 对上（.log .l-ok / .l-err / .l-info / .l-warn）。
    // 原来写的是 'log-line ' + kind，两边对不上，所以日志一直是灰的。
    line.className = kind === 'bad' ? 'l-err' : (kind ? 'l-' + kind : '');
    line.textContent = msg;
    el.appendChild(line);
    el.scrollTop = el.scrollHeight;
  }
  const clearLog = () => { const el = $('log'); el.innerHTML = ''; el.hidden = true; };

  const utf8ToBase64 = (str) =>
    btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  const base64ToUtf8 = (b64) =>
    new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, '')), (c) => c.charCodeAt(0)));

  const newId = () => 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

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

  /* --------------------------- GitHub 调用 --------------------------- */
  async function gh(path, opts = {}) {
    const headers = { Authorization: `Bearer ${token}` };
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
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}：${(body && body.message) || res.status}`);
      err.status = res.status;
      throw err;
    }
    return body;
  }

  /** 一次拉全部文件路径 → sha */
  async function loadTree(force) {
    if (tree && !force) return tree;
    const res = await gh(`/git/trees/${BRANCH}?recursive=1`);
    const map = new Map();
    (res.tree || []).forEach((n) => { if (n.type === 'blob') map.set(n.path, n.sha); });
    tree = map;
    return map;
  }

  async function shaOf(path) {
    let t = await loadTree();
    if (!t.has(path)) t = await loadTree(true);
    return t.get(path);
  }

  /**
   * 写仓库时的 409 重试。
   *
   * GitHub Contents API 要求带上「文件当前的 sha」，跟服务端对不上就拒收：
   *   409：assets/data/games.json does not match 1bcd41f…
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

  /** 读仓库里的 JSON 文件；不存在返回 null */
  async function readJSON(path) {
    try {
      const res = await gh(`/contents/${encodePath(path)}?ref=${BRANCH}`);
      if (!res || !res.content) return null;
      return JSON.parse(base64ToUtf8(res.content));
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  }

  async function putFile(path, base64, message) {
    const res = await withShaRetry(async () => {
      const sha = await shaOf(path);
      const body = { message, content: base64 };
      if (sha) body.sha = sha;
      if (BRANCH) body.branch = BRANCH;
      return await gh(`/contents/${encodePath(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    });
    if (res && res.content && res.content.sha) tree?.set(path, res.content.sha);
    else tree?.delete(path);
    return res;
  }

  async function deleteFile(path, message) {
    await withShaRetry(async () => {
      const sha = await shaOf(path);
      if (!sha) return;   // 本来就不在，当成功
      await gh(`/contents/${encodePath(path)}`, {
        method: 'DELETE',
        body: JSON.stringify({ message, sha, branch: BRANCH }),
      });
    });
    tree?.delete(path);
  }

  const saveData = (message) => {
    data.count = data.items.length;
    data.generated = new Date().toISOString();
    return putFile(DATA_PATH, utf8ToBase64(JSON.stringify(data, null, 2)), message);
  };

  /* ------------------------------ 图片处理 ------------------------------ */
  function readImage(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); res(img); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('图片读不出来：' + file.name)); };
      img.src = url;
    });
  }

  /** 等比例缩到 maxW 以内并转 JPEG，避免上传几十 MB 的原图 */
  async function compress(file, maxW = 1280, quality = 0.85) {
    const img = await readImage(file);
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#ffffff';        // PNG 透明底转 JPEG 会变黑，先铺白
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = cv.toDataURL('image/jpeg', quality);
    return { b64: dataUrl.split(',')[1], dataUrl, bytes: Math.round(dataUrl.length * 0.75) };
  }

  const humanKB = (b) => (b < 1024 * 1024 ? Math.round(b / 1024) + ' KB' : (b / 1024 / 1024).toFixed(1) + ' MB');

  /** 自定义文件选择器旁边那行小字（真正的 <input type=file> 被藏起来了） */
  function setPickName(id, text, hasFile) {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '还没有选择文件';
    el.classList.toggle('has-file', !!hasFile);
  }

  /* ------------------------------ 云盘链接行 ------------------------------ */

  /**
   * 一个游戏可以挂任意多个云盘链接（用户要求不设上限），所以这里是一组可增删的输入行。
   * 顺序就是页面上的按钮顺序，第一条不特殊。
   *
   * 云盘名用**站内自己的下拉**（复用 site.js 那套 .dropdown 样式），不用原生
   * select / datalist —— 原生展开的候选列表由操作系统渲染，圆角和配色一律改不了。
   * 菜单最后一行留了个输入框：列表里没有的云盘可以自己写，两种方式都要能用。
   */

  /** 常用云盘名：直接读页面上的 <datalist id="driveNames">，想加名字改那段 HTML 就行 */
  const driveNames = () =>
    [...document.querySelectorAll('#driveNames option')].map((o) => o.value).filter(Boolean);

  /**
   * 下拉菜单的内容。每个链接行各生成一份，不共享 DOM ——
   * 共享的话一行的选中高亮会显示到别的行上。
   *
   * 「自己写」的输入框故意放在**列表上方**：放下面时选项一多就被挤到滚动区外，
   * “列表里没有的可以自己写”这个入口就没人看得到。
   */
  const driveMenuHTML = () =>
    '<li class="drive-other" role="presentation">' +
      '<input class="input drive-other-input" type="text" autocomplete="off" placeholder="其它云盘名（自己写）">' +
    '</li>' +
    '<li class="drive-sep" role="presentation"></li>' +
    driveNames()
      .map((n) => `<li class="dropdown-item" role="option" aria-selected="false">${esc(n)}</li>`)
      .join('');

  const linkRowHTML = (name = '', url = '', code = '') => `<div class="link-row">
      <div class="dropdown drive-pick">
        <button class="dropdown-toggle" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span class="dropdown-label">选择云盘</span>
          <span class="dropdown-arrow" aria-hidden="true"></span>
        </button>
        <ul class="dropdown-menu" role="listbox" hidden>${driveMenuHTML()}</ul>
        <input class="link-name" type="hidden" value="">
      </div>
      <input class="input link-url" autocomplete="off" placeholder="粘贴分享链接" value="${esc(url)}">
      <!-- 提取码按云盘单独填：有的云盘不能设提取码、有的本来就不需要，留空即可 -->
      <input class="input link-code" autocomplete="off" placeholder="无需提取码" value="${esc(code)}">
      <button class="btn btn-sm btn-danger link-del" type="button" title="删除这条">删除</button>
    </div>`;

  /**
   * 把云盘名写回一行：真正的值存在 hidden input 里（列取名还是只读 .link-name），
   * 按钮上只显示名字。自己写的名字会回填到菜单里那个输入框，方便再改。
   */
  function setDriveName(row, name) {
    const n = String(name || '').trim();
    const custom = !!n && !driveNames().includes(n);
    row.querySelector('.link-name').value = n;
    row.querySelector('.dropdown-label').textContent = n || '选择云盘';
    row.querySelectorAll('.dropdown-item').forEach((it) => {
      it.setAttribute('aria-selected', String(it.textContent.trim() === n));
    });
    const other = row.querySelector('.drive-other-input');
    if (other) other.value = custom ? n : '';
  }

  /** 收起所有云盘名菜单（点别处、按 Esc、选中一项都走这里） */
  function closeAllDriveMenus() {
    $('linkList').querySelectorAll('.drive-pick').forEach((p) => {
      p.querySelector('.dropdown-menu').hidden = true;
      p.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'false');
    });
  }

  function bindDrivePicker(row) {
    const pick = row.querySelector('.drive-pick');
    const toggle = pick.querySelector('.dropdown-toggle');
    const menu = pick.querySelector('.dropdown-menu');
    const other = pick.querySelector('.drive-other-input');

    toggle.addEventListener('click', () => {
      const wasClosed = menu.hidden;
      closeAllDriveMenus();          // 同时只留一个菜单开着
      menu.hidden = !wasClosed;
      toggle.setAttribute('aria-expanded', String(wasClosed));
      if (!wasClosed) return;
      // 按上下剩余空间定高 + 下面放不下就往上弹。
      // 写死 max-height 挡不住这种情况：手机上表单滚到后半段时，
      // 固定高度会让菜单直接顶出屏幕底部，最后几个云盘点不到。
      const r = toggle.getBoundingClientRect();
      const below = window.innerHeight - r.bottom - 14;
      const above = r.top - 14;
      const up = below < 300 && above > below;
      menu.classList.toggle('drop-up', up);
      // 下限给 140：再矮也够放下「自己写」那一格，重点是**绝不超出屏幕**
      menu.style.maxHeight = Math.max(140, Math.min(480, up ? above : below)) + 'px';
    });

    menu.addEventListener('click', (e) => {
      const item = e.target.closest('.dropdown-item');
      if (!item) return;             // 点「自己写」那一格不该把菜单关掉
      setDriveName(row, item.textContent.trim());
      closeAllDriveMenus();
      toggle.focus();
    });

    // 自己写的名字：按回车就生效
    other.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = other.value.trim();
      if (v) setDriveName(row, v);
      closeAllDriveMenus();
      toggle.focus();
    });

    // 点走（失焦）也把名字收下，但**不关菜单** ——
    // 否则点右上角箭头想收起菜单时，blur 先关了、紧接着 click 又打开，菜单永远关不掉。
    other.addEventListener('blur', () => {
      const v = other.value.trim();
      if (v) setDriveName(row, v);
    });
  }

  /** 清空一行（只剩一行时「删除」不能把行去掉，否则那块看着像坏了） */
  function resetLinkRow(row) {
    row.querySelector('.link-url').value = '';
    row.querySelector('.link-code').value = '';
    setDriveName(row, '');
  }

  function addLinkRow(name = '', url = '', code = '') {
    $('linkList').insertAdjacentHTML('beforeend', linkRowHTML(name, url, code));
    const row = $('linkList').lastElementChild;
    bindDrivePicker(row);
    setDriveName(row, name);
    return row;
  }

  function setLinks(list) {
    $('linkList').innerHTML = '';
    if (!list.length) { addLinkRow(); return; }
    list.forEach((l) => addLinkRow(l.name || '', l.url || '', l.code || ''));
  }

  /**
   * 把粘进来的东西整理成能用的链接。
   * 云盘分享链接一定是 http(s) 的：少了协议就补 https://；
   * 明显不是链接的（比如随手打的「123」）直接丢掉 ——
   * 否则页面上会出现点了没反应的按钮，访客还以为网站坏了。
   */
  function normalizeUrl(raw) {
    const s = cleanUrl(raw);
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    // 长得像域名的（至少一个点 + 字母后缀）就补协议
    if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return 'https://' + s;
    return '';
  }

  /** 读出所有填了链接的行；空行忽略，乱填的丢掉并提示 */
  function collectLinks() {
    const rows = [...$('linkList').querySelectorAll('.link-row')];
    const out = [];
    let dropped = 0;
    for (const row of rows) {
      const name = row.querySelector('.link-name').value.trim();
      const raw = row.querySelector('.link-url').value;
      if (!raw.trim()) continue;
      const url = normalizeUrl(raw);
      if (!url) { dropped++; continue; }
      // code 留空就是「这个云盘不需要提取码」，不是「没填」—— 所以要写进数据
      out.push({ name, url, code: row.querySelector('.link-code').value.trim() });
    }
    if (dropped) {
      log(`有 ${dropped} 行填的内容不像链接，已跳过 —— 要填 http:// 或 https:// 开头的分享地址。`, 'warn');
    }
    return out;
  }

  /** 条目里的云盘链接；兼容早期版本的单个 url 字段 */
  function linksOfItem(g) {
    const legacyCode = String(g.code || '').trim();
    const arr = Array.isArray(g.links) ? g.links : [];
    const out = arr
      .map((l) => ({
        name: String((l && l.name) || ''),
        url: String((l && l.url) || ''),
        // 每条云盘自己的提取码。老条目没有这个字段（undefined）→ 回落到原来那个全局提取码；
        // 明确写了空字符串就是「这个云盘不需要提取码」。
        code: (l && (l.code === undefined || l.code === null)) ? legacyCode : String(l.code || '').trim(),
      }))
      .filter((l) => l.url);
    if (out.length) return out;
    return g.url ? [{ name: '123云盘', url: g.url, code: legacyCode }] : [];
  }

  /** 把 GitHub 的报错翻译成能照着做的提示 */
  function friendlyErr(e) {
    const m = String((e && e.message) || e);
    if (/\b401\b/.test(m)) return '令牌无效或已过期（GitHub 401）—— 到「上传设置」重新保存一个有效的令牌';
    if (/\b403\b/.test(m)) return '令牌没有写入权限（GitHub 403）—— 把令牌的 Contents 改成 Read and write';
    if (/\b404\b/.test(m)) return '仓库或文件找不到（GitHub 404）—— 检查令牌是否勾选了 bqtj 仓库';
    if (/\b409\b/.test(m)) return '这个文件在别处被改过（版本对不上，GitHub 409）—— 已自动重试过一次。还是不行就刷新页面再来，避免两个标签页同时改。';
    return m;
  }

  /* ------------------------------ 令牌设置 ------------------------------ */
  function setConn(cls, msg) {
    $('connBox').className = 'conn ' + cls;
    $('connMsg').innerHTML = msg;
  }

  async function verify(silent) {
    if (!token) { setConn('off', '还没填令牌'); if (!silent) $('setupCard').open = true; return false; }
    setConn('', '正在发送请求给 GitHub…');
    sendState('sending', '正在发送请求给 GitHub…');
    try {
      let res;
      try {
        res = await fetch(repoBase(), { headers: { Authorization: `Bearer ${token}` }, signal: timeoutSignal() });
      } catch (e) {
        throw netError(e);
      }
      const repo = await res.json();
      sendState(res.ok ? 'ok' : 'bad', `GitHub 已回应（HTTP ${res.status}）`);
      if (!res.ok) throw new Error(`HTTP ${res.status}：${repo.message || res.status}`);
      const fine = res.headers.get('x-oauth-scopes') === null;
      setConn('ok', `已连接 <b>${repo.full_name}</b>` + (fine ? '（细粒度令牌，权限以实际写入为准）' : ''));
      $('setupCard').open = false;
      return true;
    } catch (e) {
      const why = e.sendFailed ? e.message : esc(e.message);
      setConn('bad', '连接失败：' + why);
      sendState('bad', '连接失败：' + why);
      if (!silent) $('setupCard').open = true;
      return false;
    }
  }

  /* ------------------------------ 数据加载 ------------------------------ */
  async function load() {
    $('gList').innerHTML = '<div class="result-info">加载中…</div>';
    try {
      const d = await readJSON(DATA_PATH);
      data = d && Array.isArray(d.items) ? d : { generated: null, count: 0, items: [] };
      renderList();
    } catch (e) {
      $('gList').innerHTML = `<div class="result-info">读取失败：${esc(friendlyErr(e))}</div>`;
    }
  }

  /* ------------------------------ 列表渲染 ------------------------------ */
  function renderList() {
    const kw = ($('gSearch').value || '').trim().toLowerCase();
    const items = data.items.filter((g) => !kw ||
      String(g.name || '').toLowerCase().includes(kw) ||
      String(g.brief || '').toLowerCase().includes(kw));

    $('listInfo').innerHTML = `共 <b>${data.items.length}</b> 个` + (kw ? `，匹配 ${items.length} 个` : '');

    if (!items.length) {
      $('gList').innerHTML = '<div class="result-info">' +
        (data.items.length ? '没有匹配的' : '还没有游戏，用上面第 1 步添加一个') + '</div>';
      return;
    }

    $('gList').innerHTML = items.map((g) => {
      const links = linksOfItem(g);
      const drives = links.map((l) => l.name || l.url).join(' / ');
      // 提取码按云盘算，所以这里列出「用到的所有不同的码」；一个都没有就直接写无需提取码
      const codes = [...new Set(links.map((l) => l.code).filter(Boolean))];
      const codeTxt = codes.length ? '提取码 ' + codes.join(' / ') : '无需提取码';
      return `
      <div class="mg-row">
        <div class="mg-head">
          ${g.cover
            ? `<div class="mg-thumb"><img src="${esc(fileUrl(g.cover))}" alt=""></div>`
            : '<div class="mg-thumb"><span class="mg-ph">GAME</span></div>'}
          <div class="mg-body">
            <div class="mg-name">${esc(g.name || '未命名')}</div>
            <div class="mg-note">${esc([g.brief, links.length + ' 个云盘', codeTxt, (g.shots || []).length + ' 张截图'].filter(Boolean).join(' · '))}</div>
            <div class="mg-note">${drives ? '云盘：' + esc(links.map((l) => (l.name || l.url) + (l.code ? '（' + l.code + '）' : '（无需码）')).join(' / ')) : '（未填云盘链接）'}</div>
          </div>
          <div class="mg-act">
            <button class="btn btn-sm" data-edit="${esc(g.id)}">编辑</button>
            <a class="btn btn-sm" href="/games/detail.html?id=${encodeURIComponent(g.id)}" target="_blank" rel="noopener">看详情</a>
            <button class="btn btn-sm btn-danger" data-del="${esc(g.id)}">删除</button>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  /* ------------------------------ 表单 ------------------------------ */
  function resetForm() {
    editingId = null;
    pendingCover = null;
    pendingShots = [];
    $('gName').value = '';
    $('gBrief').value = '';
    $('gDetail').value = '';
    setLinks([]);
    $('gCover').value = '';
    $('gShots').value = '';
    setPickName('coverName', '', false);
    setPickName('shotsName', '', false);
    $('formMode').textContent = '';
    $('btnSaveGame').textContent = '保存游戏';
    renderPreview();
  }

  function fillForm(g) {
    editingId = g.id;
    pendingCover = null;
    pendingShots = [];
    $('gName').value = g.name || '';
    $('gBrief').value = g.brief || '';
    $('gDetail').value = g.detail || '';
    setLinks(linksOfItem(g));
    $('gCover').value = '';
    $('gShots').value = '';
    setPickName('coverName', '', false);
    setPickName('shotsName', '', false);
    $('formMode').textContent = '（正在编辑：' + (g.name || '未命名') + '）';
    $('btnSaveGame').textContent = '保存修改';
    renderPreview();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function renderPreview() {
    const $pv = $('preview');
    const g = editingId ? data.items.find((x) => x.id === editingId) : null;
    const bits = [];

    if (pendingCover) {
      bits.push(`<div class="pv-item"><img src="${pendingCover.dataUrl}" alt=""><span class="pv-tag">新封面 ${humanKB(pendingCover.bytes)}</span><button class="pv-del" data-cancel-cover title="取消">×</button></div>`);
    } else if (g && g.cover) {
      bits.push(`<div class="pv-item"><img src="${esc(fileUrl(g.cover))}" alt=""><span class="pv-tag">当前封面</span><button class="pv-del" data-del-cover="1" title="删除封面">×</button></div>`);
    }

    const existingShots = (g && Array.isArray(g.shots)) ? g.shots : [];
    existingShots.forEach((s, i) => {
      bits.push(`<div class="pv-item"><img src="${esc(fileUrl(s))}" alt=""><span class="pv-tag">截图 ${i + 1}</span><button class="pv-del" data-del-shot="${i}" title="删除这张">×</button></div>`);
    });
    pendingShots.forEach((s, i) => {
      bits.push(`<div class="pv-item"><img src="${s.dataUrl}" alt=""><span class="pv-tag">新截图 ${i + 1} · ${humanKB(s.bytes)}</span><button class="pv-del" data-cancel-shot="${i}" title="取消">×</button></div>`);
    });

    if (!bits.length) { $pv.hidden = true; $pv.innerHTML = ''; return; }
    $pv.hidden = false;
    $pv.innerHTML = '<div class="pv-title">封面 / 截图（点 × 可删）</div><div class="pv-grid">' + bits.join('') + '</div>';
  }

  /* ------------------------------ 保存 ------------------------------ */
  async function saveForm() {
    if (!token) { log('先在「上传设置」里保存 GitHub 令牌。', 'bad'); $('setupCard').open = true; return; }

    const name = $('gName').value.trim();
    const links = collectLinks();
    if (!name) { log('游戏名不能为空。', 'bad'); $('gName').focus(); return; }
    if (!links.length) { log('至少要填一个云盘下载链接。', 'bad'); $('linkList').querySelector('.link-url').focus(); return; }

    const btn = $('btnSaveGame');
    btn.disabled = true;
    clearLog();
    log('开始保存…');

    try {
      const id = editingId || newId();
      const item = (editingId ? data.items.find((x) => x.id === editingId) : null) || {
        id, cover: '', shots: [], mtime: '', created: new Date().toISOString(),
      };
      item.id = id;
      item.name = name;
      item.brief = $('gBrief').value.trim();
      item.detail = $('gDetail').value.trim();   // 详情页的「详细介绍」，纯文本、按行分段
      item.links = links;          // [{ name, url, code }]，code 可以为空 = 无需提取码
      delete item.url;             // 清掉早期版本的单个 url 字段
      delete item.code;            // 提取码现在挂在每条链接上，全局那个不再用
      item.mtime = new Date().toISOString();

      /* 封面 */
      if (pendingCover) {
        const p = `${IMG_DIR}/${id}/cover.jpg`;
        log(`上传封面（${humanKB(pendingCover.bytes)}）…`);
        await putFile(p, pendingCover.b64, `游戏封面：${name}`);
        item.cover = '/' + p;
      }

      /* 截图：沿用已有编号往后排 */
      if (pendingShots.length) {
        item.shots = Array.isArray(item.shots) ? item.shots : [];
        let n = item.shots.length;
        for (const s of pendingShots) {
          n += 1;
          const p = `${IMG_DIR}/${id}/shot-${n}.jpg`;
          log(`上传截图 ${n}（${humanKB(s.bytes)}）…`);
          await putFile(p, s.b64, `游戏截图：${name} (${n})`);
          item.shots.push('/' + p);
        }
      }

      if (!editingId) data.items.unshift(item);
      else data.items = data.items.map((x) => (x.id === id ? item : x));

      log('写入 games.json…');
      await saveData(`${editingId ? '更新' : '新增'}游戏：${name}`);
      await loadTree(true);

      log(`完成：${name}。Cloudflare 约 1 分钟后生效。`, 'ok');
      resetForm();
      renderList();
      // 预览里的旧图路径可能已变（换封面），重新渲染一次
      renderPreview();
    } catch (e) {
      log('保存失败：' + friendlyErr(e), 'bad');
      if (e.status === 401) log('令牌无效或已过期，重新生成一个。', 'bad');
      if (e.status === 403) log('令牌没有写入权限：确认给了 Contents: Read and write。', 'bad');
    } finally {
      btn.disabled = false;
    }
  }

  /* ------------------------------ 删除 ------------------------------ */
  async function removeGame(id) {
    const g = data.items.find((x) => x.id === id);
    if (!g) return;
if (!confirm(`确定删除「${g.name}」？\n\n它的封面和截图也会一起从仓库里删掉，游戏本体在云盘不受影响。`)) return;

    clearLog();
    log('正在删除…');
    try {
      const files = [g.cover, ...(g.shots || [])].filter(Boolean);
      for (const f of files) {
        try { await deleteFile(f.replace(/^\//, ''), `删除图片：${g.name}`); }
        catch (e) { log(`图片没删掉（跳过）：${f} — ${friendlyErr(e)}`, 'warn'); }
      }
      data.items = data.items.filter((x) => x.id !== id);
      await saveData(`删除游戏：${g.name}`);
      await loadTree(true);
      log(`已删除：${g.name}`, 'ok');
      if (editingId === id) resetForm();
      renderList();
    } catch (e) {
      log('删除失败：' + friendlyErr(e), 'bad');
    }
  }

  /* --------------------- 「现有游戏」的访问密码 ---------------------
     注意：这是前端校验，只能挡住随手点开的人，不是真正的安全措施
     （任何人都能查看页面源码看到密码）。真正管住写入的是 GitHub 令牌。 */
  const LIST_PWD = S.adminPassword || 'bqtj';
  const listCard = $('listCard');
  let listUnlocked = false;

  function lockList(msg = '') {
    listUnlocked = false;
    $('listBody').hidden = true;
    $('listLock').hidden = false;
    $('listPwd').value = '';
    $('listLockMsg').textContent = msg;
  }

  function unlockList() {
    if ($('listPwd').value.trim() !== LIST_PWD) {
      $('listLockMsg').textContent = '密码不对，再试一次。';
      $('listPwd').select();
      $('listPwd').focus();
      return;
    }
    listUnlocked = true;
    $('listLock').hidden = true;
    $('listBody').hidden = false;
    $('listPwd').value = '';
    $('listLockMsg').textContent = '';
    load();                       // 解锁后才去读游戏列表
  }

  /* ------------------------------ 事件绑定 ------------------------------ */
  function bind() {
    /* 令牌 */
    if (token) { $('token').value = token; verify(true); }
    $('btnSaveToken').addEventListener('click', async () => {
      const v = $('token').value.trim();
      if (!v) { setConn('bad', '令牌是空的'); return; }
      token = v;
      localStorage.setItem(TOKEN_KEY, v);
      // 保存后要去 GitHub 验一下，这段得等网络 —— 按钮变成「发送中…」并禁用，
      // 否则用户会反复点，看不出到底有没有发出去
      const btn = $('btnSaveToken');
      const old = btn.textContent;
      btn.disabled = true;
      btn.setAttribute('aria-busy', 'true');
      btn.textContent = '发送中…';
      const ok = await verify();
      btn.disabled = false;
      btn.removeAttribute('aria-busy');
      btn.textContent = old;
      if (!ok) return;
      loadTree(true).catch(() => {});
      if (listUnlocked) load();
      else $('listLockMsg').textContent = '输入密码后就能看到游戏列表。';
    });
    $('btnForget').addEventListener('click', () => {
      token = '';
      localStorage.removeItem(TOKEN_KEY);
      $('token').value = '';
      tree = null;
      setConn('off', '已清除令牌');
    });

    /* 云盘链接行：加一行 / 删一行 */
    $('btnAddLink').addEventListener('click', () => {
      addLinkRow().querySelector('.dropdown-toggle').focus();
    });
    $('linkList').addEventListener('click', (e) => {
      const del = e.target.closest('.link-del');
      if (!del) return;
      const rows = $('linkList').querySelectorAll('.link-row');
      // 至少留一行，否则整个区域看着像坏了
      if (rows.length <= 1) { resetLinkRow(rows[0]); return; }
      del.closest('.link-row').remove();
    });

    /* 云盘名下拉：点别处 / 按 Esc 收起（同时只留一个开着） */
    document.addEventListener('click', (e) => {
      const cur = e.target.closest('.drive-pick');
      $('linkList').querySelectorAll('.drive-pick').forEach((p) => {
        if (p === cur) return;
        p.querySelector('.dropdown-menu').hidden = true;
        p.querySelector('.dropdown-toggle').setAttribute('aria-expanded', 'false');
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeAllDriveMenus();
    });

    /* 图片选择：按钮去触发藏起来的 file input */
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pick]');
      if (b) $(b.getAttribute('data-pick')).click();
    });

    $('gCover').addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      try {
        const c = await compress(f, 1280);
        pendingCover = { ...c, name: f.name };
        setPickName('coverName', f.name + ' · ' + humanKB(c.bytes), true);
        renderPreview();
        log('封面已就绪：' + f.name);
      } catch (err) { log(err.message, 'bad'); }
    });

    $('gShots').addEventListener('change', async (e) => {
      const files = [...(e.target.files || [])];
      if (!files.length) return;
      for (const f of files) {
        try { pendingShots.push({ ...(await compress(f, 1600)), name: f.name }); }
        catch (err) { log(err.message, 'bad'); }
      }
      setPickName('shotsName', `已选 ${files.length} 张` + (pendingShots.length > files.length ? `（待传共 ${pendingShots.length} 张）` : ''), true);
      log(`已选 ${files.length} 张截图`);
      renderPreview();
      e.target.value = '';      // 清掉，同一批文件可以再选一次
    });

    /* 预览里的删除 */
    $('preview').addEventListener('click', async (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      const g = editingId ? data.items.find((x) => x.id === editingId) : null;

      if (b.hasAttribute('data-cancel-cover')) { pendingCover = null; renderPreview(); return; }
      const ci = b.getAttribute('data-cancel-shot');
      if (ci !== null) { pendingShots.splice(Number(ci), 1); renderPreview(); return; }

      if (!g) return;
      if (b.hasAttribute('data-del-cover')) {
        if (!confirm('删除这张封面？')) return;
        try { await deleteFile(g.cover.replace(/^\//, ''), `删除封面：${g.name}`); g.cover = ''; log('封面已删', 'ok'); }
        catch (err) { log('删除失败：' + friendlyErr(err), 'bad'); }
        renderPreview();
        return;
      }
      const si = b.getAttribute('data-del-shot');
      if (si !== null) {
        if (!confirm('删除这张截图？')) return;
        const path = g.shots[Number(si)];
        try {
          await deleteFile(String(path).replace(/^\//, ''), `删除截图：${g.name}`);
          g.shots.splice(Number(si), 1);
          log('截图已删（记得再点一次「保存修改」同步索引）', 'ok');
        } catch (err) { log('删除失败：' + friendlyErr(err), 'bad'); }
        renderPreview();
      }
    });

    /* 表单按钮 */
    $('btnSaveGame').addEventListener('click', saveForm);
    $('btnResetForm').addEventListener('click', resetForm);

    /* 列表按钮 */
    $('gSearch').addEventListener('input', renderList);
    $('btnReload').addEventListener('click', () => loadTree(true).then(load).catch((e) => log(friendlyErr(e), 'bad')));
    $('gList').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) { const g = data.items.find((x) => x.id === ed.getAttribute('data-edit')); if (g) fillForm(g); return; }
      const del = e.target.closest('[data-del]');
      if (del) removeGame(del.getAttribute('data-del'));
    });

    /* 「现有游戏」的密码门 */
    $('listUnlock').addEventListener('click', unlockList);
    $('listPwd').addEventListener('keydown', (e) => { if (e.key === 'Enter') unlockList(); });
    // 收起时重新上锁 —— 下次展开还要再输一次
    listCard.addEventListener('toggle', () => { if (!listCard.open && listUnlocked) lockList(); });
  }

  /* ------------------------------ 启动 ------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    resetForm();
    bind();

    if (!token) {
      $('setupCard').open = true;
      $('listLockMsg').textContent = '先在上面「上传设置」里保存 GitHub 令牌 —— 读取和修改游戏列表都要用它。';
      return;
    }

    verify(true).then((ok) => {
      if (!ok) {
        // 「上传设置」折叠着的话，失败原因就藏在里面看不见了 —— 展开它
        $('setupCard').open = true;
        $('listLockMsg').textContent = '令牌没通过验证，检查一下是不是过期或权限不对。';
        return;
      }
      $('listLockMsg').textContent = '输入密码后就能看到游戏列表。';
    });
  });
})();
