#!/usr/bin/env node
/* ==========================================================================
   serve.mjs — 零依赖本地预览服务器
   用法：node tools/serve.mjs        然后浏览器打开 http://localhost:5173
        node tools/serve.mjs 8080    指定端口

   为什么需要它：用 file:// 直接双击打开 html 时，浏览器不允许网页读取本地 JSON
   （CORS 限制），所以字幕库/游戏列表会加载不出来。跑个本地服务器就没这问题。
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 5173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ass': 'text/plain; charset=utf-8',
  '.ssa': 'text/plain; charset=utf-8',
  '.srt': 'text/plain; charset=utf-8',
  '.vtt': 'text/vtt; charset=utf-8',
  '.zip': 'application/zip',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

async function resolveFile(urlPath) {
  // 去掉查询串，防目录穿越
  let rel = decodeURIComponent(urlPath.split('?')[0]);
  let full = path.join(ROOT, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));

  if (!full.startsWith(ROOT)) return null;

  if (existsSync(full)) {
    const st = await stat(full);
    if (st.isDirectory()) {
      const idx = path.join(full, 'index.html');
      if (existsSync(idx)) return idx;
    } else {
      return full;
    }
  }
  // 允许 /subs 这种不带斜杠的访问
  if (existsSync(full + '.html')) return full + '.html';
  return null;
}

/* 本地模拟 Pages Functions 的下载计数：仅内存，重启清零。
   线上由 functions/_middleware.js + D1 负责，这里只是让本地预览能看到效果。 */
const hits = new Map();

const server = createServer(async (req, res) => {
  const urlPath = req.url || '/';
  const purePath = decodeURIComponent(urlPath.split('?')[0]);

  // GET /api/counts
  if (purePath === '/api/counts') {
    const counts = Object.fromEntries(hits);
    let total = 0;
    for (const v of hits.values()) total += v;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(JSON.stringify({ enabled: true, local: true, total, counts }));
    return;
  }

  // 字幕下载计数
  if (req.method === 'GET' && purePath.startsWith('/files/subs/')) {
    hits.set(purePath, (hits.get(purePath) || 0) + 1);
  }

  let file = await resolveFile(urlPath);
  let status = 200;

  if (!file) {
    const custom404 = path.join(ROOT, '404.html');
    file = existsSync(custom404) ? custom404 : null;
    status = 404;
  }

  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 Not Found');
    return;
  }

  try {
    const buf = await readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(status, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);

    const rel = path.relative(ROOT, file);
    if (status === 404) console.log(`  404  ${urlPath}`);
    else if (!/\.(png|jpg|jpeg|gif|webp|ico|woff2?|ttf)$/i.test(ext)) {
      console.log(`  ${status}  ${rel}`);
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 ' + e.message);
  }
});

server.listen(PORT, () => {
  console.log('\n🚀 本地预览已启动');
  console.log(`   首页      http://localhost:${PORT}/`);
  console.log(`   字幕库    http://localhost:${PORT}/subs/`);
  console.log(`   上传助手  http://localhost:${PORT}/admin/`);
  console.log('\n   注：本地也会模拟下载计数（仅内存，重启清零）；');
  console.log('       线上真实统计由 functions/ + D1 负责。');
  console.log('\n   按 Ctrl+C 停止\n');
});
