#!/usr/bin/env node
/* ==========================================================================
   check-subs.mjs — 校验字幕索引与文件是否对得上，并检查重复
   零依赖，用 Node 内置模块即可运行。

   用法：
     node tools/check-subs.mjs
        只检查、只报告，不改任何文件

     node tools/check-subs.mjs --fix
        顺便删掉「与子目录里已有文件同名」的顶层副本

   ---------------------------------------------------------------------------
   为什么要它：批量导入用的是「按文件名复制」——
     node tools/build-subs-index.mjs --src "D:\音乐\字幕" --copy
   如果源目录里有个 A.ass，而站上 files/subs/某文件夹/A.ass 已经存在，
   就会多出一份 files/subs/A.ass，页面上出现两条一模一样的记录。
   这时该删的是**新导入的顶层副本**，不是原有那份 ——
   原有那份上面挂着管理员写的说明 / 缩略图 / 视频链接，
   而且下载统计（D1）是按「路径」记的，换了路径统计就断了。

   检查项：
     1. 索引里的 path 在磁盘上是否真的存在（对不上就是访客点下载 404）
     2. 索引记录的体积和实际文件是否一致
     3. 索引里有没有重复的 path
     4. 顶层有没有和子目录重名的副本（--fix 时删除顶层那份）
   ========================================================================== */

import { readFileSync, readdirSync, existsSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_FILE = path.join(ROOT, 'assets', 'data', 'subs.json');
const SUBS_DIR = path.join(ROOT, 'files', 'subs');

const FIX = process.argv.includes('--fix');

if (!existsSync(JSON_FILE)) {
  console.error(`找不到索引文件：${JSON_FILE}\n先跑一次 node tools/build-subs-index.mjs`);
  process.exit(1);
}

const json = JSON.parse(readFileSync(JSON_FILE, 'utf8'));
const items = json.items || [];

/* ------------------------- 1~3. 索引 vs 磁盘 ------------------------- */
let missing = 0;
let sizeMismatch = 0;
let biggest = { name: '', size: 0 };

for (const it of items) {
  const disk = path.join(ROOT, it.path.replace(/^\//, ''));
  if (!existsSync(disk)) {
    if (missing < 15) console.log(`  缺失    ${it.path}`);
    missing++;
    continue;
  }
  const real = statSync(disk).size;
  if (real !== it.size) {
    if (sizeMismatch < 10) console.log(`  体积不符 ${it.path}  索引 ${it.size} / 实际 ${real}`);
    sizeMismatch++;
  }
  if (real > biggest.size) biggest = { name: it.name, size: real };
}

const dupPaths = items.length - new Set(items.map((i) => i.path)).size;

/* ------------------------- 4. 顶层 vs 子目录重名 ------------------------- */
const entries = readdirSync(SUBS_DIR, { withFileTypes: true });
const topFiles = entries.filter((e) => e.isFile()).map((e) => e.name);
const subDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

const inSubdirs = new Set();
for (const d of subDirs) {
  for (const f of readdirSync(path.join(SUBS_DIR, d), { withFileTypes: true })) {
    if (f.isFile()) inSubdirs.add(f.name);
  }
}
const topDupes = topFiles.filter((n) => inSubdirs.has(n));

/* ------------------------------- 报告 ------------------------------- */
console.log('\n索引条数        : ' + items.length);
console.log('文件缺失        : ' + missing);
console.log('体积不一致      : ' + sizeMismatch);
console.log('重复 path       : ' + dupPaths);
console.log(
  '顶层重名副本    : ' + topDupes.length + (topDupes.length ? '  ← 会造成重复条目' : '')
);
console.log(
  '最大文件        : ' + (biggest.size / 1024).toFixed(1) + ' KB  ' + biggest.name
);

if (topDupes.length) {
  console.log('\n以下文件在 files/subs/ 顶层和某个子目录里同时存在：');
  for (const n of topDupes) console.log('  ' + n);
  if (FIX) {
    for (const n of topDupes) unlinkSync(path.join(SUBS_DIR, n));
    console.log(`\n已删除 ${topDupes.length} 个顶层副本。`);
    console.log('接着重跑一次：node tools/build-subs-index.mjs');
  } else {
    console.log('\n加 --fix 可自动删除顶层副本，然后重跑 index 生成脚本。');
  }
}

// 注意：topDupes 是数组，!topDupes 永远是 false（空数组也是真值）——必须写 .length
const ok = !missing && !sizeMismatch && !dupPaths && !topDupes.length;
console.log(ok ? '\n检查通过。' : '\n存在问题，见上面。');
process.exit(ok ? 0 : 1);
