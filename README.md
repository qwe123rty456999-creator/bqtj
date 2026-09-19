# bqtj.cc.cd — 字幕分享站

只做一件事：**把字幕整理好，让人点一下就能下载。**

纯静态站点，零依赖、零构建。不需要 `npm install`，不需要任何框架。

---

## 快速开始

```powershell
# 本地预览（浏览器打开 http://localhost:5173）
node tools/serve.mjs

# 扫描字幕目录，生成字幕库索引
node tools/build-subs-index.mjs
```

> ⚠️ **不要直接双击 `index.html` 打开。** `file://` 协议下浏览器禁止网页读取本地 JSON，
> 字幕库会加载不出来。用上面的本地服务器，或者 VS Code 的 Live Preview
> （右键 html → **Show Preview**）。
>
> VS Code 里按 **Ctrl+Shift+B** 也能一键启动预览。

---

## 目录结构

```
bqtj.cc.cd/
├── index.html              首页（搜索框 + 数据概览 + 最新收录）
├── about.html              关于页
├── 404.html                404 页
├── subs/index.html         字幕库（搜索 / 语言 / 格式 / 作品 四维筛选 + 分页）
├── admin/index.html        上传助手（浏览器选文件直传仓库）
│
├── assets/
│   ├── css/style.css       全站样式（改主题只改顶部的 CSS 变量）
│   ├── js/config.js        ★ 站点配置（仓库地址、上传上限）
│   ├── js/site.js          通用：主题切换、导航、工具函数
│   ├── js/subs.js          字幕库逻辑
│   ├── js/admin.js         上传助手逻辑
│   └── data/
│       └── subs.json       ← 脚本/上传助手生成，不要手改
│
├── files/subs/<作品名>/     ★ 字幕文件放这里（一个文件夹 = 一部作品）
│
└── tools/
    ├── build-subs-index.mjs  扫字幕 → 生成 subs.json
    └── serve.mjs             本地预览服务器
```

线上配套文件：`CNAME`、`robots.txt`、`sitemap.xml`、`_headers`、`.nojekyll`。

---

## 怎么加字幕

### 方式一：网页上传（推荐，不用碰命令行）

打开 **`https://bqtj.cc.cd/admin/`**（本地是 `http://localhost:5173/admin/`），
首次需要配一个 GitHub 令牌：

> GitHub → Settings → Developer settings → Personal access tokens →
> **Fine-grained tokens** → 新建，仓库访问选 *Only select repositories* → 只勾 `bqtj`，
> 权限只给 **Contents: Read and write**。把令牌粘进上传助手第 1 步保存。

令牌只存在你自己浏览器的 localStorage 里，**不会写进仓库、不会发给第三方**。

之后每次加字幕：

1. 拖入字幕文件（支持多选）
2. 「上传到哪个作品目录」填 `files/subs/作品名`
3. 文件名没有语言标记时，用「这批字幕的语言」下拉框兜底
4. 点「全部上传」

上传助手会自动提交文件 + **重新生成 `subs.json`**（追加条目、判语言、按时间排序），
Cloudflare 随后自动部署，约 1 分钟后线上可搜。

### 方式二：本地脚本

1. 在 `files/subs/` 下建一个用作品名命名的文件夹，例如 `files/subs/孤独摇滚/`
2. 把字幕丢进去
3. 跑一次索引：
   ```powershell
   node tools/build-subs-index.mjs
   ```
4. 提交并推送

**如果字幕现在散落在别处**（比如 `D:\我的字幕`），不用手动搬：

```powershell
# 只看统计，不写文件（先确认识别是否正常）
node tools/build-subs-index.mjs --src "D:\我的字幕" --stats

# 复制进项目再建索引（推荐）
node tools/build-subs-index.mjs --src "D:\我的字幕" --copy
```

---

## 命名规范

文件名带的信息越多，搜索和语言识别就越准。

```
✅ 孤独摇滚 第01话 [简][星空字幕组].ass
✅ Bocchi the Rock 01 [繁中].ass
✅ 作品名 第03话 [简繁][字幕组].srt

❌ 1.ass                   ← 搜不到，也认不出语言
❌ subtitle_final_v2.ass   ← 同上
```

### 语言识别规则

按顺序匹配文件名里的标记：

| 匹配到 | 识别为 |
|---|---|
| `简繁` `简+繁` `CHS&CHT` `GB&BIG5` | 简繁 |
| `中日` `日中` `JPSC` | 中日 |
| `简` `简体` `CHS` `GB` `GBK` `GB2312` | 简中 |
| `繁` `繁體` `CHT` `BIG5` `正体` | 繁中 |
| `zh-Hans` `zh-CN` | 简中 |
| `zh-Hant` `zh-TW` `zh-HK` | 繁中 |
| `日语` `JP` `JPN` | 日语 |
| `英语` `ENG` | 英语 |

规则在 `tools/build-subs-index.mjs` 的 `LANG_RULES` 和 `assets/js/admin.js` 的
`LANG_RULES` 里（两处保持一致）。

### 兜底：读正文判语言

本地脚本在文件名没标记时，会**读字幕正文**判断简/繁/日语：

- 统计「简繁不通用字」的比例（如 `们/們`、`这/這`、`说/說`）
- 假名占比 > 15% 判为日语
- 非 UTF-8 的老字幕（GBK/BIG5）解码失败会自动放弃判断

**上传助手没有这一步**（浏览器里逐个下载文件太慢），所以网页上传时请用下拉框指定语言。

### 可选的 `meta.json`

在作品文件夹里放一个 `meta.json`，可以显式指定和补充信息：

```json
{
  "title": "孤独摇滚",
  "tags": ["音乐", "日常"],
  "url": "",
  "lang": "简中"
}
```

`lang` 优先级最高（会覆盖文件名识别）。

---

## 部署（Cloudflare Pages）

1. 代码推到 GitHub 仓库（`qwe123rty456999-creator/bqtj`）
2. Cloudflare Dashboard → **Workers & Pages** → **Create application** → **Pages**
   → **Import an existing Git repository** → 选 `bqtj`
3. 构建设置按官方「Static HTML」指南填：

   | 配置项 | 值 |
   |---|---|
   | Production branch | `main` |
   | Framework preset | `None` |
   | Build command | `exit 0` |
   | Build output directory | `/` |

   > 官方文档明确建议无构建站点把 Build command 填 `exit 0`（而不是留空）。

4. 部署完成后进 **Custom domains** → **Set up a custom domain** → 填 `bqtj.cc.cd`
5. 因为域名的 NS 已经在 Cloudflare，**DNS 记录会自动创建**，无需手写

### ⚠️ 平台限制（官方文档，免费版）

| 限制项 | 值 |
|---|---|
| 站点文件总数 | **20,000 个**（付费版 100,000） |
| 单个文件大小 | **25 MiB** |
| `_headers` 规则数 | 100 条 |

字幕都是几 KB 到几百 KB，2 万条以内完全够用。
**超过 2 万个文件时**：把 `files/` 挪到对象存储/CDN，
然后只改 `assets/js/config.js` 里的 `fileBase` 一行，页面代码不用动。

---

## 下载次数统计（可选）

字幕库每个文件旁边的 `⬇ N`、以及上传助手第 2 步的排行榜，都来自
`functions/` 里的两个 Pages Functions：

| 文件 | 作用 |
|---|---|
| `functions/_middleware.js` | 拦截 `/files/subs/*` 的下载请求并计数 |
| `functions/api/counts.js` | `GET /api/counts` 返回所有次数（JSON） |

**原理**：Cloudflare Pages 会把仓库根目录的 `functions/` 当作 Pages Functions 运行，
**不需要单独部署 Worker**。计数在 `waitUntil()` 里异步写库，**不阻塞下载**；
统计出错会被吞掉，绝不影响访客。

**去重**：同一访客（IP + UA 的哈希，不存明文 IP）12 小时内重复下载同一个文件只算一次，
所以数字更接近「有多少人下过」，而不是「请求了几次」。

### 开启方法

不配置的话整站照常工作，只是不显示次数。要开启：

1. Cloudflare Dashboard → **Storage & databases** → **D1** → 创建数据库（名字随意，如 `bqtj-counts`）
2. 进入你的 **Pages 项目** → **设置** → **绑定** → 添加 → **D1 数据库**
   - 变量名必须正好是 **`COUNTS`**（大小写敏感）
   - 选择刚创建的数据库
3. 重新部署一次（绑定变更需要重新部署才生效）

表结构不用手动建 —— 首次请求时会自动 `CREATE TABLE IF NOT EXISTS`。

### 本地预览

`tools/serve.mjs` 里有一个内存版模拟实现（重启清零），所以本地也能看到次数变化、方便调 UI。
**真实的 Pages Functions 只在 Cloudflare 上运行，本地不会跑。**

### 免费额度

D1 免费版：5 GB 存储、每天 10 万行写入 / 500 万行读取 —— 对字幕站远超所需。

---

## 域名与 DNS 实测状态（2026-09-19）

| 检查项 | 实测结果 | 含义 |
|---|---|---|
| `bqtj.cc.cd` NS | `khloe.ns.cloudflare.com` / `morgan.ns.cloudflare.com` | NS 已委派给 **Cloudflare** |
| SOA | `khloe.ns.cloudflare.com` | **Cloudflare 是权威 DNS** |
| `cc.cd`（上级）NS | `a.ns.dnshe.org` / `b.ns.dnshe.org` | 域名注册商是 **DNSHE** |

> ⚠️ **解析记录要加在 Cloudflare，不是 DNSHE 面板。**
> DNSHE 会提示「域名正在使用外部 DNS 解析，请先将 NS 修改为本站 DNS 后再试」——
> 这是正常的，它现在只保留「修改 DNS 服务器」这一个权力。

自查命令：

```powershell
Resolve-DnsName bqtj.cc.cd -Type NS
Resolve-DnsName bqtj.cc.cd -Type A
```

---

## 改外观

配色集中在 `assets/css/style.css` 开头：

```css
:root {
  --accent: #5b8cff;     /* 主色 */
  --accent-2: #a06bff;   /* 渐变中间色 */
  --accent-3: #ff6b9d;   /* 渐变收尾色 */
  --radius: 14px;        /* 圆角 */
}
```

右上角 ☀️/🌙 可切换深浅主题，用户偏好存在浏览器本地。

---

## 性能提醒

- 字幕超过 **2000 条**时 `subs.json` 会偏大，首屏加载变慢。
  届时可以改成分块（每 500 条一个 json），或改成搜索时按需请求。
- 封面图（如果以后加）建议压缩后再放，单张控制在 200 KB 以内。

---

## 版权

站内资源仅供学习交流，请勿用于商业用途。
字幕版权归原字幕组所有，文件名里保留了署名。

若你是版权方且不希望内容出现在本站，请联系下架。
