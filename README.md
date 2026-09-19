# 爆枪突击字幕库（bqtj.pages.dev）

只做一件事：**把爆枪突击的字幕整理好，让人点一下就能下载。**

纯静态站点，零依赖、零构建。不需要 `npm install`，不需要任何框架。

> 站点内容全是同一部作品的简体中文字幕，**所以不做语言 / 格式 / 作品分类筛选**，
> 只保留搜索和排序。

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

## 访问地址（重要）

| 地址 | 国内直连 | 用途 |
| --- | --- | --- |
| **https://bqtj.pages.dev** | ✅ 可直连 | **对外分享用这个** |
| https://bqtj.cc.cd | ❌ 连接被重置 | 备用地址，需代理 |

**2026-09 排查记录**（症状：手机不挂代理报「网络错误」，挂上代理才能打开）：

实测 `bqtj.cc.cd` 是被**按域名**阻断的。同一台 Cloudflare IP（`104.21.49.87`）上：

```text
明文 HTTP  Host: bqtj.pages.dev       → 301   正常
明文 HTTP  Host: bqtj.cc.cd           → RST   被重置
HTTPS      SNI = bqtj.pages.dev       → 200   正常
HTTPS      SNI = bqtj.cc.cd           → RST   被重置
```

**关键：被封的是整个 `.cc.cd` 后缀，不是 `bqtj` 这个名字。**

> 一开始用「虚构子域名」做实验不可靠 —— 得先排除「Cloudflare 自己对未知 SNI 也会重置」的可能。
> 校准实验（同一 IP）：虚构的 `zz9k7test.pages.dev` 得到 **HTTP 530**（握手成功，Cloudflare 正常应答），
> 而虚构的 `zz9k7test.cc.cd` 是 RST → 说明 RST 不是 Cloudflare 发的。
> 再拿**真实存在**的另一个 cc.cd 子域 `panel.cc.cd`（同样在 Cloudflare 上）实测：
> 也是 `Connection was reset` —— 连域名商的客户面板都打不开。
> 结论：在这个后缀下换任何名字都没用。

结论：**与 Cloudflare 无关、与 IP 无关、与 DNS 配置无关**（CNAME → `bqtj.pages.dev` 已代理，配置完全正确），
被封的是 `.cc.cd` 这个域名后缀本身 —— 换 IP、换 CDN、换子域名都无效，**只能换域名**。

> 由此还顺带解释了「挂代理看到的是缓存的旧页面」：域名连不上时，
> 浏览器会把磁盘里那份旧页面拿出来顶替（或直接提示网络错误），
> 并不是服务器发错了内容。手机上对比「共 N 个字幕」就能看出是不是旧副本。

随时可用脚本复查某个域名能不能直连（**记得先关代理**）：

```powershell
powershell -ExecutionPolicy Bypass -File tools\net-check.ps1 新域名.com
```

⚠️ 换新域名前**务必先跑一遍**这个脚本。免费域名后缀被整段拉黑是常事，
别等分享出去才发现打不开。

换域名时，这几处要一起改（都指向「对外分享的那个域名」）：
各页面的 `canonical`、首页的 `og:url` / `og:image`、`sitemap.xml`、`robots.txt`。
页面内链一律用根相对路径（`/assets/...`、`/subs/`），所以网址本身不影响功能。

---

## 目录结构

```
bqtj.cc.cd/
├── index.html              首页（搜索框 + 数据概览 + 最新收录）
├── about.html              关于页（对外链接写 /about：Pages 会把 /about.html 做 308 跳转，多一个往返）
├── 404.html                404 页
├── subs/index.html         字幕库（搜索 + 排序 + 分页）
├── admin/index.html        上传助手（浏览器选文件直传仓库 + 下载统计）
│
├── functions/              Cloudflare Pages Functions（下载计数）
│   ├── _middleware.js        拦截 /files/subs/* 计数
│   └── api/counts.js         GET /api/counts
│
├── assets/
│   ├── css/style.css       全站样式（改主题只改顶部的 CSS 变量）
│   ├── js/config.js        ★ 站点配置（站点名、仓库地址、上传上限）
│   ├── js/site.js          通用：主题切换、导航、工具函数
│   ├── js/subs.js          字幕库逻辑
│   ├── js/admin.js         上传助手逻辑
│   └── data/
│       └── subs.json       ← 脚本/上传助手生成，不要手改
│
├── files/subs/             ★ 字幕文件放这里
│
└── tools/
    ├── build-subs-index.mjs  扫字幕 → 生成 subs.json
    ├── check-subs.mjs        校验索引与文件是否对得上（--fix 删掉顶层重名副本）
    ├── net-check.ps1         检查某域名国内能否直连（区分「域名被封」和「IP 被封」）
    └── serve.mjs             本地预览服务器
```

线上配套文件：`CNAME`、`robots.txt`、`sitemap.xml`、`_headers`、`.nojekyll`。

---

## 怎么加字幕

### 方式一：网页上传（推荐，不用碰命令行）

打开 **`https://bqtj.pages.dev/admin/`**（本地是 `http://localhost:5173/admin/`），
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

> **作品分组只是给文件归类用的，页面上不显示。**
> 直接放在 `files/subs/` 根目录的文件会被归为「未分类」，效果完全一样。

---

## 批量导入（字幕在别的盘 / 别的文件夹）

字幕散落在别处（比如 `D:\音乐\字幕`）时，**不用手动一个个拷**。一条命令搞定复制 + 建索引：

```powershell
node tools/build-subs-index.mjs --src "D:\音乐\字幕" --copy
```

| 参数 | 作用 |
| --- | --- |
| `--src "目录"` | 扫描任意目录（不填就是 `files/subs/`） |
| `--copy` | 先把字幕复制进 `files/subs/` 再建索引（已存在的会跳过） |
| `--stats` | 只打统计、不写文件（先试跑可以看语言识别对不对） |

复制规则：**保持源目录的相对结构**。源目录根下的文件 → `files/subs/` 根；
源目录的子文件夹 → `files/subs/子文件夹/`。

然后提交推送，Cloudflare 约 1 分钟后自动上线：

```powershell
node tools/check-subs.mjs      # 先体检
node tools/serve.mjs           # 想先本地看一眼就跑这个

git add -A
git commit -m "新增 N 个字幕"
git push
```

### ⚠ 批量导入唯一的坑：同名文件会变成两条重复记录

复制是**按文件名**过去的。如果源目录里有 `A.ass`，而站上 `files/subs/某文件夹/A.ass`
已经存在，就会多出一份 `files/subs/A.ass` —— 页面上出现两条一模一样的。

该删的是**新导入的顶层副本**，不是原有那份：原有那份上面挂着管理员写的
说明 / 缩略图 / 视频链接，而且下载统计（D1）是按**路径**记的，换了路径统计就断了。

用体检工具自动处理（会先把重复项列出来再删）：

```powershell
tools\check-subs.mjs --fix   # 即 node tools/check-subs.mjs --fix
node tools/build-subs-index.mjs   # 重跑索引
```

### 导入后必看的两个数字

```
node tools/check-subs.mjs
```

```
索引条数        : 92
文件缺失        : 0      ← 不是 0 就是有死链，访客点了会 404
体积不一致      : 0
重复 path       : 0
顶层重名副本    : 0      ← 不是 0 就是有重复条目
```

这条命令退出码为 0 才算全部通过，可以放心推送。

---

## 游戏板块

| | |
| --- | --- |
| 公开页 | `/games/` —— 不需要密码 |
| 管理页 | `/games/admin/` —— 用**同一个** GitHub 令牌（和字幕上传助手共用） |
| 数据 | `assets/data/games.json`（后台自动写，也可以手改） |
| 图片 | `files/games/<id>/cover.jpg`、`shot-N.jpg` |

**游戏本体不进仓库**，放云盘，页面只登记链接。
原因：Cloudflare Pages 单文件上限 **25 MiB**，而这个游戏有 38.7 MB，直接放上来会被拒。

**一个游戏可以挂任意多个云盘**（同一个文件传几份，访客自己挑一个能用的）——
不设上限，提取码全站统一。

**提取码统一 `bqtj`**：存在 `config.js` 的 `defaultExtractCode` 里，管理页表单会自动填上。
⚠️ 这只是页面上的**显示文字**，云盘那边的提取码要你自己也设成 `bqtj` 才对得上。

### 卡片字段

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `name` | 是 | 游戏名 |
| `brief` | 否 | 一句话简介 |
| `size` | 否 | 文件大小，**纯文本**（如 `38.7 MB`），不会自动算 |
| `links` | 是 | 云盘链接数组，格式 `[{ "name": "123云盘", "url": "https://..." }]`，**条数不限** |
| `code` | 否 | 提取码，默认 `bqtj` |
| `cover` | 否 | 封面图（列表里按 160×90 显示，16:9 最好看），不填用灰底占位 |
| `shots` | 否 | 截图数组，展开后排成网格，点一下放大 |

只有 1 个云盘时那个按钮是**主色**（页面唯一的行动点）；有多个时全部是普通按钮，
前面加一句「选择云盘：」—— 不给任何一个云盘加优先级。

> 早期版本用的是单个 `url` 字段。页面和管理页都**兼容旧数据**（自动当成一条「123云盘」），
> 但管理页一旦保存就会写成新的 `links` 格式。

**详情默认折叠**：每张卡片就是一个 `<details>`，点标题栏才展开下载按钮和截图 ——
这样一屏能扫完所有游戏，想看哪个再点开。展开/收起那几个字用 CSS 的 `content` 切，不需要 JS。

### 也可以直接手改 games.json

不想开后台就编辑 `assets/data/games.json`：

```json
{
  "items": [
    {
      "id": "g1",
      "name": "game_orig_test",
      "brief": "一个自己写的横轴跳跃小游戏",
      "size": "38.7 MB",
      "links": [
        { "name": "123云盘", "url": "https://www.123pan.com/s/xxxx" },
        { "name": "百度网盘", "url": "https://pan.baidu.com/s/yyyy" }
      ],
      "code": "bqtj",
      "cover": "/files/games/g1/cover.jpg",
      "shots": ["/files/games/g1/shot-1.jpg"],
      "mtime": "2026-09-19T06:00:00.000Z"
    }
  ]
}
```

`id` 只要全站唯一即可，图片路径由它决定 —— **改 `id` 等于换一套图**。

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

## 外观

设计原则：**浅色默认、无渐变、不用表情符号**，尽量简洁。

配色集中在 `assets/css/style.css` 顶部两个变量块 —— `:root` 是浅色（默认），
`html[data-theme="dark"]` 是深色：

```css
:root {
  --accent: #2563eb;   /* 主色 */
  --bg: #ffffff;       /* 背景 */
  --border: #e4e7ec;   /* 描边 */
  --radius: 10px;      /* 圆角 */
}
```

右上角的「深色 / 浅色」文字按钮可切换，用户偏好存在浏览器本地
（localStorage 键名 `bqtj-theme`）。**默认不跟随系统的深浅色设置**，
这样所有人看到的是同一套设计。

### 站点图标

| 文件 | 用途 |
|---|---|
| `assets/img/favicon-32.png` | 浏览器标签页图标 |
| `assets/img/favicon-180.png` | iOS 添加到主屏幕 / 社交分享缩略图 |
| `assets/img/logo.png` | 页头左侧的品牌图标 |

改图标：把新图放进 `assets/img/` 覆盖同名文件即可（保持尺寸一致）。
如果原图是 webp，可以用 ffmpeg 转：

```powershell
ffmpeg -y -i 原图.webp -vf "scale=32:32:flags=lanczos" assets/img/favicon-32.png
ffmpeg -y -i 原图.webp -vf "scale=180:180:flags=lanczos" assets/img/favicon-180.png
ffmpeg -y -i 原图.webp -vf "scale=96:96:flags=lanczos" assets/img/logo.png
```

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
