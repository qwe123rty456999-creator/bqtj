/* 临时脚本：比较「远程的 subs.json」和「本地的 subs.json」，
   确认合并时会不会丢掉管理员在 /admin/ 里写的字段（desc/thumb/videoUrl/videoDl）。
   用 Node 调 git show，避免 PowerShell 重定向写成 UTF-16 把 JSON 弄坏。 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const KEEP = ['desc', 'thumb', 'videoUrl', 'videoDl'];

const remote = JSON.parse(execSync('git show origin/main:assets/data/subs.json', { encoding: 'utf8', maxBuffer: 1e8 }));
const local = JSON.parse(readFileSync('assets/data/subs.json', 'utf8'));

const rBy = new Map(remote.items.map((x) => [x.path, x]));
const lBy = new Map(local.items.map((x) => [x.path, x]));

console.log(`远程条数 ${remote.items.length} / 本地条数 ${local.items.length}`);

console.log('\n=== 只有远程有的条目（合并时必须保住）===');
for (const it of remote.items) {
  if (!lBy.has(it.path)) {
    const meta = KEEP.filter((k) => it[k]).map((k) => `${k}=${String(it[k]).slice(0, 60)}`);
    console.log(`  ${it.path}`);
    console.log(`      元数据: ${meta.length ? meta.join(' | ') : '（无）'}`);
  }
}

console.log('\n=== 只有本地有的条目（前 5 条，共 ' + remote.items.filter((i) => !lBy.has(i.path)).length + ' 条远程独有）===');
let n = 0;
for (const it of local.items) {
  if (!rBy.has(it.path)) { if (n++ < 5) console.log('  ' + it.path); }
}
console.log(`  本地独有共 ${local.items.filter((i) => !rBy.has(i.path)).length} 条`);

console.log('\n=== 同一路径下元数据有差异的（远程写了、本地没有的）===');
let diff = 0;
for (const [p, r] of rBy) {
  const l = lBy.get(p);
  if (!l) continue;
  for (const k of KEEP) {
    if (r[k] && !l[k]) { console.log(`  ${k} @ ${p}`); diff++; }
    else if (r[k] && l[k] && r[k] !== l[k]) { console.log(`  ${k} 值不同 @ ${p}\n    远程: ${String(r[k]).slice(0, 80)}\n    本地: ${String(l[k]).slice(0, 80)}`); diff++; }
  }
}
console.log(diff ? `  共 ${diff} 处差异` : '  无差异');
