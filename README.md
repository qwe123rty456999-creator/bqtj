# bqtj.cc.cd

个人分享站：**小游戏 + 动漫 + 大量字幕文件**。
纯静态，零依赖，零构建 —— 不需要 npm install，不需要任何框架。

---

## 快速开始

```powershell
# 1. 本地预览（会自动打开提示，浏览器访问 http://localhost:5173）
node tools/serve.mjs

# 2. 扫描字幕目录，生成字幕库索引
node tools/build-subs-index.mjs
```

> ⚠️ 不要直接双击 `index.html` 打开。`file://` 协议下浏览器禁止网页读取本地 JSON，
> 字幕库和列表页会加载不出来。用上面的本地服务器，或者 VS Code 的 Live Preview
> （右键 html → **Show Preview**）。

---

## 目录结构

```
bqtj.cc.cd/
├── index.html              首页
├── about.html              关于页
├── 404.html                404 页（Cloudflare Pages / GitHub Pages 会自动用）
├── CNAME                   GitHub Pages 绑定自定义域名用
├── robots.txt              搜索引擎规则
├── sitemap.xml             站点地图
├── _headers                Cloudflare Pages 响应头（其它平台忽略）
│
├── games/index.html        小游戏列表页
├── anime/index.html        动漫列表页
├── subs/index.html         字幕库（搜索 / 筛选 / 分页）
│
├── assets/
│   ├── css/style.css       全站样式（改主题只改顶部的 CSS 变量）
│   ├── js/site.js          通用：主题切换、导航、工具函数
│   ├── js/collection.js    通用列表页渲染（游戏/动漫共用）
│   ├── js/subs.js          字幕库逻辑
│   └── data/
│       ├── games.json      ← 手写
│       ├── anime.json      ← 手写
│       └── subs.json       ← 脚本生成，别手改
│
├── files/
│   ├── subs/<作品名>/      字幕文件放这里（一个文件夹 = 一部作品）
│   └── games/<游戏名>/     网页游戏放这里
│
└── tools/
    ├── build-subs-index.mjs  扫字幕 → 生成 subs.json
    └── serve.mjs             本地预览服务器
```

---

## 怎么加内容

### 加字幕（最常用）

1. 在 `files/subs/` 下建一个用作品名命名的文件夹，例如 `files/subs/孤独摇滚/`
2. 把字幕文件丢进去。**文件名建议带上作品名 + 集数 + 语言标记**，检索全靠它：
   - ✅ `孤独摇滚 第01话 [简][星空字幕组].ass`
   - ✅ `Bocchi 01 [繁中].ass`
   - ❌ `1.ass`（搜不到，语言也认不出来）
3. 跑一次索引：
   ```powershell
   node tools/build-subs-index.mjs
   ```
4. 刷新字幕库页面即可看到。

**如果字幕现在散落在别的地方**（比如 `D:\我的字幕`），不用手动搬：

```powershell
# 只看统计，不写文件（先确认识别是否正常）
node tools/build-subs-index.mjs --src "D:\我的字幕" --stats

# 扫描那个目录并生成索引（文件仍在原处，网站会指向原路径，不推荐）
node tools/build-subs-index.mjs --src "D:\我的字幕"

# 复制进项目再建索引（推荐，上传时不会漏文件）
node tools/build-subs-index.mjs --src "D:\我的字幕" --copy
```

**语言识别规则**（可改 `tools/build-subs-index.mjs` 里的 `LANG_RULES`）：

| 文件名里出现 | 识别为 |
|---|---|
| `简繁` `简+繁` `CHS&CHT` `GB&BIG5` | 简繁 |
| `中日` `日中` `JPSC` | 中日 |
| `简` `简体` `CHS` `GB` `GBK` | 简中 |
| `繁` `繁體` `CHT` `BIG5` | 繁中 |
| `日语` `JP` `JPN` | 日语 |
| `英语` `ENG` | 英语 |

**给作品加元信息**（可选）：在作品文件夹里放 `meta.json`

```json
{
  "title": "孤独摇滚",
  "tags": ["音乐", "日常"],
  "url": "https://example.com/detail"
}
```

### 加小游戏

1. 网页游戏：整个目录（含 `index.html`）放进 `files/games/<游戏名>/`
2. 离线游戏：打包成 zip 放进 `files/games/`
3. 在 `assets/data/games.json` 的 `items` 里加一条：

```json
{
  "title": "游戏名",
  "desc": "一句话简介",
  "tags": ["休闲", "在线玩"],
  "platform": "网页 · 手机可玩",
  "play": "/files/games/snake/index.html",
  "download": "/files/games/pack.zip",
  "updated": "2026-09-18",
  "size": 48234496
}
```

`play` 在线玩、`download` 下载，两个都可以只写一个（按钮会自动只显示有值的）。

### 加动漫

编辑 `assets/data/anime.json`，字段见文件里的 `_说明`。
关键是 `subs` 字段填 `/subs/?q=番名`，点「找字幕」就会跳到字幕库并自动搜索。

---

## 部署（把网站挂到域名上）

三选一，都免费、都自动 HTTPS。

### 方案 A：Cloudflare Pages ⭐ 推荐

1. 把整个项目目录推到 GitHub 仓库
2. Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages** → 连接这个仓库
3. 构建设置：**Framework preset = None**，**Build command 留空**，**Output directory = `/`**
4. 部署完成后进 **Custom domains** → 添加 `bqtj.cc.cd`
5. 按提示去域名 DNS 添加它给出的 `CNAME` 记录

**优势**：自动支持 `_headers`、404.html、无限带宽、国内访问相对友好。

> 如果你的字幕文件特别多、仓库很大，可以在 Cloudflare 用 **R2 对象存储** 放 `files/`，
> 然后用一个自定义域 `files.bqtj.cc.cd` 指向它，页面里的 `/files/...` 改成绝对地址即可。

### 方案 B：GitHub Pages

1. 仓库 Settings → **Pages** → Source 选 `Deploy from a branch`，分支 `main`，目录 `/ (root)`
2. `CNAME` 文件已经写好 `bqtj.cc.cd`，会自动生效
3. 在域名 DNS 添加 4 条 `A` 记录指向 `185.199.108.153` / `.109.153` / `.110.153` / `.111.153`，
   再添加一条 `CNAME` 把 `www` 指向 `<你的用户名>.github.io`
4. 回 Pages 设置页勾选 **Enforce HTTPS**

> 注意：GitHub Pages 单仓库建议不超过 1 GB，软限制 100 GB/月流量。

### 方案 C：Vercel / Netlify

导入仓库后框架选 **Other / Static**，输出目录填 `.`，其余默认。
Netlify 同样认 `_headers`；Vercel 需要另写 `vercel.json`。

### 域名解析（本域名实测状态，2026-09-18）

先用 nslookup / `Resolve-DnsName` 确认过的事实：

| 检查项 | 实测结果 | 含义 |
|---|---|---|
| `bqtj.cc.cd` NS | `khloe.ns.cloudflare.com` / `morgan.ns.cloudflare.com` | NS 已委派给 **Cloudflare** |
| `bqtj.cc.cd` SOA | `khloe.ns.cloudflare.com` | **Cloudflare 是权威 DNS** |
| 现有记录 | 只有 SOA，无 A / CNAME | 域名尚未指向任何服务 |
| `cc.cd`（上级）NS | `a.ns.dnshe.org` / `b.ns.dnshe.org` | 域名注册商是 **DNSHE** |

> ⚠️ **结论：解析记录要加在 Cloudflare，不是加在 DNSHE 面板。**
> DNSHE 面板会提示「域名正在使用外部 DNS 解析，请先将 NS 修改为本站 DNS 后再试」——
> 这是正常的，它现在只保留「修改 DNS 服务器」这一个权力。

#### 路线 A：Cloudflare DNS（推荐，NS 已经在 Cloudflare 了）

1. 登录 <https://dash.cloudflare.com> → 确认左侧域名列表里有 `bqtj.cc.cd`
2. 该域名 → **DNS** → **Records** → Add record：
   | Type | Name | Target | Proxy |
   |---|---|---|---|
   | `CNAME` | `@` | 你的平台目标（如 `<项目>.pages.dev` 或 `<用户名>.github.io`） | 🟠 已代理 |
3. 若用 Cloudflare Pages，更省事：Pages 项目 → **Custom domains** → Add →
   填 `bqtj.cc.cd`，**记录由它自动创建，不用手写**
4. 顺手把 `www` 也加上：`CNAME` / `www` / `bqtj.cc.cd`

Cloudflare 会自动做 CNAME 扁平化（apex 也能用 CNAME）、自动签发 HTTPS 证书。

#### 路线 B：改回 DNSHE 的 DNS（拿不到 Cloudflare 账号时）

1. DNSHE 面板 → **DNS 服务器** → 修改 DNS 服务器 → 改回
   `a.ns.dnshe.org` / `b.ns.dnshe.org`
2. 等生效（几分钟到几小时），面板不再报错后即可添加记录
3. 缺点：失去 Cloudflare 的 CDN 与自动 HTTPS，apex 可能不支持 CNAME，
   需要改用平台给的 A 记录（GitHub Pages 为 4 个 `185.199.10x.153`）

#### 记录填写速查

| 你要的效果 | 记录类型 | 名称 | 内容 |
|---|---|---|---|
| 裸域 `bqtj.cc.cd` 访问 | `CNAME` | `@` | 平台目标域名 |
| 同时支持 `www.bqtj.cc.cd` | `CNAME` | `www` | `bqtj.cc.cd` |
| 只想用 GitHub Pages 裸域 | `A` ×4 | `@` | `185.199.108.153` / `.109.153` / `.110.153` / `.111.153` |

记录加完一般几分钟内生效，可用以下命令自查：

```powershell
Resolve-DnsName bqtj.cc.cd -Type A
Resolve-DnsName bqtj.cc.cd -Type CNAME
```

---

## 改外观

全站配色集中在 `assets/css/style.css` 开头：

```css
:root {
  --accent: #5b8cff;     /* 主色 */
  --accent-2: #a06bff;   /* 渐变中间色 */
  --accent-3: #ff6b9d;   /* 渐变收尾色 */
  --radius: 14px;        /* 圆角 */
}
```

改这几个值，整站风格就变了。右上角 ☀️/🌙 按钮可切换深浅色，用户偏好存在浏览器本地。

---

## 性能提醒

- 字幕超过 **2000 条**时，`subs.json` 会变得较大，首次加载会慢。
  届时可以改成分块：每 500 条一个 `subs-1.json`、`subs-2.json`，页面按需加载。
- `files/` 里的图片建议压缩后再放，单张控制在 200 KB 以内。
- 大文件（游戏包）尽量别进 Git 仓库，放对象存储或用 Git LFS。

---

## 版权

站内资源仅供学习交流，请勿用于商业用途。
字幕版权归原字幕组所有。若你是版权方且不希望内容出现在本站，请联系下架。
