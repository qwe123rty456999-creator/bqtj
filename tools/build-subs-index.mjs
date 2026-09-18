#!/usr/bin/env node
/* ==========================================================================
   build-subs-index.mjs — 扫描字幕目录，生成 assets/data/subs.json
   零依赖，用 Node 内置模块即可运行。

   用法：
     node tools/build-subs-index.mjs
        扫描 files/subs/ 并生成索引

     node tools/build-subs-index.mjs --src "D:\我的字幕"
        扫描任意目录（不复制文件），按该目录的一级子文件夹分组

     node tools/build-subs-index.mjs --src "D:\我的字幕" --copy
        先把字幕复制进 files/subs/，再生成索引（推荐，上传网站时不会漏文件）

     node tools/build-subs-index.mjs --stats
        只打印统计信息，不写文件

   分组规则：扫描根目录下的一级子文件夹 = 一个「作品」。
           直接放在根目录的文件归入「未分类」。
   语言识别：从文件名里找 简/繁/CHS/CHT/GB/BIG5/中日/JP/ENG 等标记。
   可选：在某作品文件夹里放一个 meta.json：
         { "title": "孤独摇滚", "tags": ["音乐","日常"], "url": "https://..." }
         会被合并进该作品的每一条记录（页面可以用 groupTitle 显示更好看的名）。
   ========================================================================== */

import { readdir, stat, writeFile, mkdir, copyFile, open, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

/* ----------------------------- 参数解析 ----------------------------- */
const argv = process.argv.slice(2);
const getArg = (name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : null;
};
const hasFlag = (name) => argv.includes(name);

const SRC_DIR = getArg('--src');
const DO_COPY = hasFlag('--copy');
const STATS_ONLY = hasFlag('--stats');

const SCAN_ROOT = SRC_DIR ? path.resolve(SRC_DIR) : path.join(ROOT, 'files', 'subs');
const OUT_FILE = path.join(ROOT, 'assets', 'data', 'subs.json');
const COPY_DEST = path.join(ROOT, 'files', 'subs');

/* 视为字幕的扩展名（想加别的就往这里加） */
const SUB_EXTS = new Set(['.ass', '.ssa', '.srt', '.vtt', '.sub', '.idx', '.sup', '.zip']);
/* 忽略的文件名 */
const IGNORE = /^(thumbs\.db|desktop\.ini|\.ds_store|meta\.json)$/i;

/* ----------------------------- 语言识别 ----------------------------- */

/* 语言名 → 页面上的徽章配色 class */
const LANG_CLASS = {
  '简中': 'zh-hans', '繁中': 'zh-hant', '简繁': 'zh-both',
  '中日': 'ja', '中英': 'zh-both', '日语': 'ja', '英语': 'en',
};

const LANG_RULES = [
  // 顺序重要：复合语言要先判定
  { re: /简繁|简\+繁|繁简|CHS\s*[&+]\s*CHT|CHT\s*[&+]\s*CHS|GB\s*[&+]\s*BIG5|BIG5\s*[&+]\s*GB/i, lang: '简繁' },
  { re: /中日|日中|JPSC|JP\s*[&+]\s*SC|SC\s*[&+]\s*JP|中日双语/i, lang: '中日' },
  { re: /中英|ENG\s*[&+]\s*CHS|CHS\s*[&+]\s*ENG/i, lang: '中英' },
  { re: /简体|简中|简日|简|CHS|\bGB\b|GBK|GB2312/i, lang: '简中' },
  { re: /繁体|繁中|繁日|繁|CHT|BIG5|正体/i, lang: '繁中' },
  // BCP-47 语言标记（yt-dlp / YouTube 下载的字幕常见形式：xxx.zh-Hans.ass）
  { re: /zh[-_ ]?hans|zh[-_ ]?cn\b|zh[-_ ]?sg\b|中文\(简体\)/i, lang: '简中' },
  { re: /zh[-_ ]?hant|zh[-_ ]?tw\b|zh[-_ ]?hk\b|中文\(繁體\)/i, lang: '繁中' },
  { re: /日语|日文|原生日|JPSC|\bJP\b|\bJPN\b/i, lang: '日语' },
  { re: /英语|英文|\bENG\b|\bEN\b/i, lang: '英语' },
  // 单独的语言 token，如 "xxx.ja.ass" / "[ja]" / "(en)"
  { re: /(^|[.\-_\s\[(])ja([.\-_\s\])]|$)/i, lang: '日语' },
  { re: /(^|[.\-_\s\[(])en([.\-_\s\])]|$)/i, lang: '英语' },
];

function detectLang(filename) {
  for (const r of LANG_RULES) {
    if (r.re.test(filename)) return { lang: r.lang, langClass: LANG_CLASS[r.lang] || '' };
  }
  return { lang: '', langClass: '' };
}

/* ---- 正文兜底识别：文件名没标记时，读字幕内容判断简/繁/日 ---- */

/* 只收录「简繁不通用」的字，避免误判 */
const ZH_PAIRS = [
  ['們', '们'], ['個', '个'], ['這', '这'], ['說', '说'], ['時', '时'], ['會', '会'], ['來', '来'],
  ['對', '对'], ['開', '开'], ['關', '关'], ['麼', '么'], ['樣', '样'], ['還', '还'], ['過', '过'],
  ['裡', '里'], ['兒', '儿'], ['學', '学'], ['國', '国'], ['愛', '爱'], ['車', '车'], ['東', '东'],
  ['馬', '马'], ['鳥', '鸟'], ['魚', '鱼'], ['龍', '龙'], ['見', '见'], ['語', '语'], ['話', '话'],
  ['讓', '让'], ['請', '请'], ['誰', '谁'], ['嗎', '吗'], ['聽', '听'], ['點', '点'], ['現', '现'],
  ['發', '发'], ['實', '实'], ['際', '际'], ['種', '种'], ['頭', '头'], ['長', '长'], ['門', '门'],
  ['問', '问'], ['間', '间'], ['無', '无'], ['為', '为'], ['與', '与'], ['萬', '万'], ['業', '业'],
  ['樂', '乐'], ['體', '体'], ['麗', '丽'], ['務', '务'], ['員', '员'], ['動', '动'], ['單', '单'],
  ['賣', '卖'], ['買', '买'], ['錢', '钱'], ['銀', '银'], ['鐵', '铁'], ['錯', '错'], ['鏡', '镜'],
  ['鐘', '钟'], ['陽', '阳'], ['隊', '队'], ['隨', '随'], ['險', '险'], ['難', '难'], ['雙', '双'],
  ['隻', '只'], ['幾', '几'], ['帶', '带'], ['幫', '帮'], ['應', '应'], ['該', '该'], ['認', '认'],
  ['識', '识'], ['記', '记'], ['訊', '讯'], ['討', '讨'], ['論', '论'], ['課', '课'], ['讀', '读'],
  ['寫', '写'], ['譯', '译'], ['張', '张'], ['場', '场'], ['區', '区'], ['醫', '医'], ['藥', '药'],
  ['圖', '图'], ['團', '团'], ['園', '园'], ['遠', '远'], ['邊', '边'], ['達', '达'], ['適', '适'],
  ['選', '选'], ['遺', '遗'], ['郵', '邮'], ['鄉', '乡'], ['鄰', '邻'], ['從', '从'], ['眾', '众'],
  ['產', '产'], ['親', '亲'], ['覺', '觉'], ['觀', '观'], ['規', '规'], ['傳', '传'], ['億', '亿'],
  ['價', '价'], ['優', '优'], ['備', '备'], ['創', '创'], ['劃', '划'], ['卻', '却'], ['壓', '压'],
  ['夠', '够'], ['獎', '奖'], ['寶', '宝'], ['尋', '寻'], ['層', '层'], ['屬', '属'], ['島', '岛'],
  ['幣', '币'], ['師', '师'], ['廣', '广'], ['廳', '厅'], ['戰', '战'], ['戶', '户'], ['執', '执'],
  ['數', '数'], ['斷', '断'], ['於', '于'], ['舊', '旧'], ['華', '华'], ['藝', '艺'], ['處', '处'],
  ['號', '号'], ['補', '补'], ['裝', '装'], ['視', '视'], ['調', '调'], ['負', '负'], ['財', '财'],
  ['購', '购'], ['賽', '赛'], ['轉', '转'], ['農', '农'], ['進', '进'], ['閉', '闭'], ['隱', '隐'],
  ['雖', '虽'], ['靈', '灵'], ['順', '顺'], ['預', '预'], ['領', '领'], ['題', '题'], ['顏', '颜'],
  ['願', '愿'], ['類', '类'], ['風', '风'], ['飛', '飞'], ['飯', '饭'], ['館', '馆'], ['驗', '验'],
  ['鬥', '斗'], ['釋', '释'],
];

const TRAD_SET = new Set(ZH_PAIRS.map((p) => p[0]));
const SIMP_SET = new Set(ZH_PAIRS.map((p) => p[1]));

const KANA_RE = /[\u3040-\u309F\u30A0-\u30FF]/g;
const HAN_RE = /[\u4E00-\u9FFF]/g;

function detectLangFromText(text) {
  if (!text) return { lang: '', langClass: '' };

  // 解码失败（非 UTF-8 的老字幕，如 GBK/BIG5）会留下大量 U+FFFD，直接放弃判断
  const broken = (text.match(/\uFFFD/g) || []).length;
  if (broken > text.length * 0.02) return { lang: '', langClass: '', note: '编码非 UTF-8' };

  // 只取对白，跳过样式表等噪音
  const body = text.split('[Events]').pop() || text;
  const sample = body.slice(0, 60000);

  const kana = (sample.match(KANA_RE) || []).length;
  const han = (sample.match(HAN_RE) || []).length;

  let trad = 0, simp = 0;
  for (const ch of sample) {
    if (TRAD_SET.has(ch)) trad++;
    else if (SIMP_SET.has(ch)) simp++;
  }

  // 假名占比高 → 日语（纯汉字日文除外，那种无法与中文区分）
  if (kana > 0 && kana / (kana + Math.max(han, 1)) > 0.15) {
    return { lang: '日语', langClass: 'ja', note: `假名 ${kana}` };
  }
  if (trad + simp < 5) return { lang: '', langClass: '' };
  if (trad > simp * 1.5) return { lang: '繁中', langClass: 'zh-hant', note: `繁${trad}/简${simp}` };
  if (simp > trad) return { lang: '简中', langClass: 'zh-hans', note: `繁${trad}/简${simp}` };
  return { lang: '', langClass: '' };
}

/* 只读文件开头，避免为了判断语言把大文件整个读进来 */
async function readHead(file, bytes = 65536) {
  const fh = await open(file, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await fh.read(buf, 0, bytes, 0);
    let s = buf.subarray(0, bytesRead).toString('utf8');
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1); // 去 BOM
    return s;
  } catch {
    return '';
  } finally {
    await fh.close();
  }
}

/* 压缩包 / 图形字幕没有文字内容，不做正文识别 */
const NO_TEXT_EXTS = new Set(['zip', 'sup', 'idx', 'sub']);

/* ---- 展示用名字清洗 ---- */
function cleanName(base) {
  const n = base
    .replace(/\s*\[[A-Za-z0-9_-]{11}\]\s*$/, '') // 去掉 YouTube 视频 ID，如 [0wuGD-S7QlY]
    .replace(/\s*\([A-Za-z0-9_-]{11}\)\s*$/, '')
    .replace(/#[^\s#]+/g, '')                    // 去掉 #hashtag
    .replace(/\s+/g, ' ')
    .replace(/[\s\-_·]+$/, '')
    .trim();
  return n || base; // 万一全被删光，退回原名
}

/* ----------------------------- 扫描 ----------------------------- */
async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile()) {
      if (IGNORE.test(e.name)) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!SUB_EXTS.has(ext)) continue;
      out.push(full);
    }
  }
  return out;
}

/* ----------------------------- 读取作品元信息 ----------------------------- */
async function readMeta(groupDir) {
  const f = path.join(groupDir, 'meta.json');
  if (!existsSync(f)) return null;
  try {
    const raw = await readFile(f, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn(`  ⚠  meta.json 解析失败，已忽略：${f}\n     ${e.message}`);
    return null;
  }
}

/* ----------------------------- 主流程 ----------------------------- */
async function main() {
  console.log('📂 扫描目录：' + SCAN_ROOT);

  if (!existsSync(SCAN_ROOT)) {
    console.error(
      `\n❌ 目录不存在：${SCAN_ROOT}\n` +
      `   默认扫描的是项目里的 files/subs/。\n` +
      `   如果你的字幕在别处，用：node tools/build-subs-index.mjs --src "你的目录"\n`
    );
    process.exit(1);
  }

  const files = await walk(SCAN_ROOT);
  console.log(`   找到 ${files.length} 个字幕文件`);

  if (!files.length) {
    console.warn('⚠  没找到任何字幕文件。确认一下扩展名在 SUB_EXTS 列表里。');
  }

  /* 可选：先复制到项目里 */
  if (DO_COPY) {
    console.log('📦 复制文件到 ' + COPY_DEST + ' …');
    let copied = 0;
    for (const f of files) {
      const rel = path.relative(SCAN_ROOT, f);
      const dest = path.join(COPY_DEST, rel);
      await mkdir(path.dirname(dest), { recursive: true });
      if (!existsSync(dest)) {
        await copyFile(f, dest);
        copied++;
      }
    }
    console.log(`   新复制 ${copied} 个文件（已存在的跳过）`);
  }

  /* 目标根：如果是 --copy，索引也指向项目内的副本 */
  const indexRoot = DO_COPY ? COPY_DEST : SCAN_ROOT;
  const indexFiles = DO_COPY ? await walk(COPY_DEST) : files;

  const items = [];
  const metaCache = new Map();

  for (const f of indexFiles) {
    const rel = path.relative(indexRoot, f);
    const parts = rel.split(path.sep);
    const group = parts.length > 1 ? parts[0] : '未分类';

    if (!metaCache.has(group)) {
      const gdir = parts.length > 1 ? path.join(indexRoot, parts[0]) : indexRoot;
      metaCache.set(group, await readMeta(gdir));
    }

    const st = await stat(f);
    const file = path.basename(f);
    const ext = path.extname(file).slice(1).toLowerCase();
    const meta = metaCache.get(group) || {};

    /* 语言判定优先级：meta.json 显式指定 > 文件名标记 > 读正文猜 */
    let lang = '';
    let langClass = '';
    let langSource = '';

    if (meta.lang) {
      lang = meta.lang;
      langClass = LANG_CLASS[lang] || '';
      langSource = 'meta';
    } else {
      const byName = detectLang(file);
      if (byName.lang) {
        lang = byName.lang;
        langClass = byName.langClass;
        langSource = 'filename';
      }
    }

    if (!lang && !NO_TEXT_EXTS.has(ext)) {
      const byText = detectLangFromText(await readHead(f));
      if (byText.lang) {
        lang = byText.lang;
        langClass = byText.langClass;
        langSource = 'content';
      }
    }

    // 展示用名字：去掉扩展名、视频 ID、#话题标签，但保留 [简][字幕组] 这类有用标记
    const base = path.basename(file, path.extname(file));
    const name = cleanName(base);

    items.push({
      name,
      file,
      // 注意：必须带开头的 /，否则在 /subs/ 这类子目录页面里会被解析成 /subs/files/... 而 404
      path: '/files/subs/' + rel.split(path.sep).join('/'),
      ext,
      size: st.size,
      mtime: st.mtime.toISOString(),
      lang,
      langClass,
      langSource,
      group,
      groupTitle: meta.title || group,
      tags: meta.tags || [],
      url: meta.url || '',
    });
  }

  // 按时间倒序
  items.sort((a, b) => b.mtime.localeCompare(a.mtime));

  /* 统计 */
  const byLang = {};
  const byExt = {};
  const byGroup = {};
  for (const it of items) {
    const l = it.lang || '未标注';
    byLang[l] = (byLang[l] || 0) + 1;
    byExt[it.ext] = (byExt[it.ext] || 0) + 1;
    byGroup[it.group] = (byGroup[it.group] || 0) + 1;
  }

  const payload = {
    generated: new Date().toISOString(),
    root: 'files/subs',
    count: items.length,
    stats: {
      languages: byLang,
      formats: byExt,
      groups: byGroup,
    },
    items,
  };

  const bySource = {};
  for (const it of items) {
    const s = it.langSource || 'unknown';
    bySource[s] = (bySource[s] || 0) + 1;
  }

  console.log('\n📊 统计');
  console.log('   总计：' + items.length);
  console.log('   语言：' + (Object.entries(byLang).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'));
  console.log('   格式：' + (Object.entries(byExt).map(([k, v]) => `${k} ${v}`).join(' / ') || '—'));
  console.log('   作品：' + Object.keys(byGroup).length + ' 个');
  console.log('   语言判定来源：' + Object.entries(bySource)
    .map(([k, v]) => `${k} ${v}`).join(' / '));

  const unknown = byLang['未标注'] || 0;
  if (unknown) {
    const pct = Math.round((unknown / items.length) * 100);
    console.log(`\n   ⚠  ${unknown} 个（${pct}%）没能判断语言。两种补法：`);
    console.log('      · 文件名里加上标记，如「某某 第01话 [简].ass」');
    console.log('      · 或在作品文件夹里放 meta.json：{ "lang": "简中" }');
  }

  if (STATS_ONLY) {
    console.log('\n（--stats 模式，未写入文件）');
    return;
  }

  await mkdir(path.dirname(OUT_FILE), { recursive: true });
  await writeFile(OUT_FILE, JSON.stringify(payload, null, 2), 'utf8');
  const kb = (JSON.stringify(payload).length / 1024).toFixed(1);
  console.log(`\n✅ 已写入 ${path.relative(ROOT, OUT_FILE)}（${kb} KB）`);

  if (items.length > 2000) {
    console.warn('⚠  条目超过 2000 条，subs.json 会偏大。建议在 subs.js 里改成分块加载（每 500 条一个 json），或改用搜索后端。');
  }
}

main().catch((e) => {
  console.error('❌ 出错了：', e);
  process.exit(1);
});
