/**
 * functions/_middleware.js
 * ---------------------------------------------------------------------------
 * 统计 /files/subs/* 的下载次数，写入 D1（绑定名 COUNTS / DB / bqtj 都能认）。
 *
 * 设计要点：
 *  - 用 waitUntil 异步记录，**不阻塞下载**，统计失败也绝不影响访客。
 *  - 没绑定 D1 时静默跳过，整站照常工作（前端会自动隐藏次数）。
 *  - 按「访客指纹 + 12 小时窗口」去重：同一人重复点同一文件只计一次，
 *    这样统计出来的更接近「有多少人下过」而不是「请求了几次」。
 *  - 只存 IP+UA 的哈希，不存明文 IP。
 *
 * 部署位置：仓库根目录的 functions/ 下。
 * 因为本项目的 Cloudflare Pages「Build output directory」是 /，
 * 所以 functions/ 正好也在输出目录根部，位置是对的。
 * ---------------------------------------------------------------------------
 */

const COUNT_PREFIX = '/files/subs/';
const DEDUPE_WINDOW = 12 * 60 * 60; // 秒，同一访客 12 小时内只算一次
const SALT = 'bqtj-cc-cd-download-counter';

/* 取 D1 绑定：优先 COUNTS，其次 DB / bqtj。
   绑定名对不上时统计会静默失效（本项目的绑定就叫 bqtj），把常见名字都认一遍。 */
const dbOf = (env) => env.COUNTS || env.DB || env.bqtj || null;

/* 表结构只建一次，避免每个请求都跑一遍 DDL */
let schemaReady = false;

async function ensureSchema(db) {
  if (schemaReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS downloads (
         path         TEXT PRIMARY KEY,
         count        INTEGER NOT NULL DEFAULT 0,
         last_visitor TEXT,
         last_ts      INTEGER
       )`
    )
    .run();
  schemaReady = true;
}

async function fingerprint(ip, ua) {
  const data = new TextEncoder().encode(`${ip}|${ua}|${SALT}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

async function recordDownload(env, request, path) {
  try {
    const db = dbOf(env);
    if (!db) return;
    await ensureSchema(db);

    const ip =
      request.headers.get('CF-Connecting-IP') ||
      request.headers.get('x-forwarded-for') ||
      '';
    const ua = request.headers.get('User-Agent') || '';
    const visitor = await fingerprint(ip, ua);
    const now = Math.floor(Date.now() / 1000);

    const row = await db
      .prepare('SELECT count, last_visitor, last_ts FROM downloads WHERE path = ?')
      .bind(path)
      .first();

    // 同一访客在窗口内重复下载 → 不计，也不写库
    if (row && row.last_visitor === visitor && now - (row.last_ts || 0) < DEDUPE_WINDOW) {
      return;
    }

    await db
      .prepare(
        `INSERT INTO downloads (path, count, last_visitor, last_ts)
         VALUES (?1, 1, ?2, ?3)
         ON CONFLICT(path) DO UPDATE SET
           count = count + 1,
           last_visitor = ?2,
           last_ts = ?3`
      )
      .bind(path, visitor, now)
      .run();
  } catch {
    /* 故意吞掉：统计永远不该影响下载 */
  }
}

export async function onRequest(context) {
  const { request, env, next, waitUntil } = context;
  const path = new URL(request.url).pathname;
  const isSubFile = path.startsWith(COUNT_PREFIX) && !path.endsWith('/');

  if (isSubFile && request.method === 'GET' && dbOf(env)) {
    waitUntil(recordDownload(env, request, path));
  }

  return next();
}
