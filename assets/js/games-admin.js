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
    line.className = 'log-line ' + kind;
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

  /* --------------------------- GitHub 调用 --------------------------- */
  async function gh(path, opts = {}) {
    const headers = { Authorization: `Bearer ${token}` };
    if (opts.body) headers['Content-Type'] = 'application/json';
    if (opts.accept) headers.Accept = opts.accept;
    const res = await fetch(repoBase() + path, { method: opts.method || 'GET', headers, body: opts.body });
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
    const sha = await shaOf(path);
    const body = { message, content: base64 };
    if (sha) body.sha = sha;
    if (BRANCH) body.branch = BRANCH;
    const res = await gh(`/contents/${encodePath(path)}`, { method: 'PUT', body: JSON.stringify(body) });
    if (res && res.content && res.content.sha) tree?.set(path, res.content.sha);
    else tree?.delete(path);
    return res;
  }

  async function deleteFile(path, message) {
    const sha = await shaOf(path);
    if (!sha) return;   // 本来就不在，当成功
    await gh(`/contents/${encodePath(path)}`, {
      method: 'DELETE',
      body: JSON.stringify({ message, sha, branch: BRANCH }),
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
   */
  const linkRowHTML = (name = '', url = '') => `<div class="link-row">
      <input class="input link-name" list="driveNames" autocomplete="off" placeholder="云盘名，如 123云盘" value="${esc(name)}">
      <input class="input link-url" autocomplete="off" placeholder="粘贴分享链接" value="${esc(url)}">
      <button class="btn btn-sm btn-danger link-del" type="button" title="删除这条">删除</button>
    </div>`;

  function addLinkRow(name = '', url = '') {
    $('linkList').insertAdjacentHTML('beforeend', linkRowHTML(name, url));
  }

  function setLinks(list) {
    $('linkList').innerHTML = '';
    if (!list.length) { addLinkRow(); return; }
    list.forEach((l) => addLinkRow(l.name || '', l.url || ''));
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
      out.push({ name, url });
    }
    if (dropped) {
      log(`有 ${dropped} 行填的内容不像链接，已跳过 —— 要填 http:// 或 https:// 开头的分享地址。`, 'warn');
    }
    return out;
  }

  /** 条目里的云盘链接；兼容早期版本的单个 url 字段 */
  function linksOfItem(g) {
    const arr = Array.isArray(g.links) ? g.links : [];
    const out = arr
      .map((l) => ({ name: String((l && l.name) || ''), url: String((l && l.url) || '') }))
      .filter((l) => l.url);
    if (out.length) return out;
    return g.url ? [{ name: '123云盘', url: g.url }] : [];
  }

  /* ------------------------------ 令牌设置 ------------------------------ */
  function setConn(cls, msg) {
    $('connBox').className = 'conn ' + cls;
    $('connMsg').innerHTML = msg;
  }

  async function verify(silent) {
    if (!token) { setConn('off', '还没填令牌'); if (!silent) $('setupCard').open = true; return false; }
    setConn('', '正在验证…');
    try {
      const res = await fetch(repoBase(), { headers: { Authorization: `Bearer ${token}` } });
      const repo = await res.json();
      if (!res.ok) throw new Error(`HTTP ${res.status}：${repo.message || res.status}`);
      const fine = res.headers.get('x-oauth-scopes') === null;
      setConn('ok', `已连接 <b>${repo.full_name}</b>` + (fine ? '（细粒度令牌，权限以实际写入为准）' : ''));
      $('setupCard').open = false;
      return true;
    } catch (e) {
      setConn('bad', '连接失败：' + e.message);
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
      $('gList').innerHTML = `<div class="result-info">读取失败：${esc(e.message)}</div>`;
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
      return `
      <div class="mg-row">
        <div class="mg-head">
          ${g.cover
            ? `<div class="mg-thumb"><img src="${esc(fileUrl(g.cover))}" alt=""></div>`
            : '<div class="mg-thumb"><span class="mg-ph">GAME</span></div>'}
          <div class="mg-body">
            <div class="mg-name">${esc(g.name || '未命名')}</div>
            <div class="mg-note">${esc([g.brief, g.size, links.length + ' 个云盘', (g.shots || []).length + ' 张截图'].filter(Boolean).join(' · '))}</div>
            <div class="mg-note">${drives ? '云盘：' + esc(drives) : '（未填云盘链接）'}</div>
          </div>
          <div class="mg-act">
            <button class="btn btn-sm" data-edit="${esc(g.id)}">编辑</button>
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
    $('gSize').value = '';
    $('gCode').value = S.defaultExtractCode || 'bqtj';
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
    $('gSize').value = g.size || '';
    $('gCode').value = g.code || S.defaultExtractCode || 'bqtj';
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
      item.size = $('gSize').value.trim();
      item.links = links;          // 统一的云盘链接格式
      delete item.url;             // 清掉早期版本的单个 url 字段
      item.code = $('gCode').value.trim() || 'bqtj';
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
      log('保存失败：' + e.message, 'bad');
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
    if (!confirm(`确定删除「${g.name}」？\n\n它的封面和截图也会一起从仓库里删掉，游戏本体在 123 云盘不受影响。`)) return;

    clearLog();
    log('正在删除…');
    try {
      const files = [g.cover, ...(g.shots || [])].filter(Boolean);
      for (const f of files) {
        try { await deleteFile(f.replace(/^\//, ''), `删除图片：${g.name}`); }
        catch (e) { log(`图片没删掉（跳过）：${f} — ${e.message}`, 'warn'); }
      }
      data.items = data.items.filter((x) => x.id !== id);
      await saveData(`删除游戏：${g.name}`);
      await loadTree(true);
      log(`已删除：${g.name}`, 'ok');
      if (editingId === id) resetForm();
      renderList();
    } catch (e) {
      log('删除失败：' + e.message, 'bad');
    }
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
      if (await verify()) { loadTree(true).catch(() => {}); load(); }
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
      addLinkRow();
      const rows = $('linkList').querySelectorAll('.link-row');
      rows[rows.length - 1].querySelector('.link-name').focus();
    });
    $('linkList').addEventListener('click', (e) => {
      const del = e.target.closest('.link-del');
      if (!del) return;
      const rows = $('linkList').querySelectorAll('.link-row');
      // 至少留一行，否则整个区域看着像坏了
      if (rows.length <= 1) {
        rows[0].querySelectorAll('input').forEach((i) => { i.value = ''; });
        return;
      }
      del.closest('.link-row').remove();
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
        catch (err) { log('删除失败：' + err.message, 'bad'); }
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
        } catch (err) { log('删除失败：' + err.message, 'bad'); }
        renderPreview();
      }
    });

    /* 表单按钮 */
    $('btnSaveGame').addEventListener('click', saveForm);
    $('btnResetForm').addEventListener('click', resetForm);

    /* 列表按钮 */
    $('gSearch').addEventListener('input', renderList);
    $('btnReload').addEventListener('click', () => loadTree(true).then(load).catch((e) => log(e.message, 'bad')));
    $('gList').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit]');
      if (ed) { const g = data.items.find((x) => x.id === ed.getAttribute('data-edit')); if (g) fillForm(g); return; }
      const del = e.target.closest('[data-del]');
      if (del) removeGame(del.getAttribute('data-del'));
    });
  }

  /* ------------------------------ 启动 ------------------------------ */
  document.addEventListener('DOMContentLoaded', () => {
    resetForm();
    bind();

    if (!token) {
      $('setupCard').open = true;
      $('listInfo').textContent = '';
      $('gList').innerHTML =
        '<div class="result-info">先在上面「上传设置」里保存 GitHub 令牌 —— 读取和修改游戏列表都要用它。</div>';
      return;
    }

    verify(true).then((ok) => {
      if (ok) { load(); return; }
      $('listInfo').textContent = '';
      $('gList').innerHTML = '<div class="result-info">令牌没通过验证，检查一下是不是过期或权限不对。</div>';
    });
  });
})();
