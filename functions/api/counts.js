/**
 * functions/api/counts.js
 * ---------------------------------------------------------------------------
 * GET /api/counts
 *   返回 { enabled, total, counts: { "/files/subs/xxx.ass": 12, ... } }
 *
 *  - 没绑定 D1 时返回 enabled: false，前端据此隐藏次数。
 *  - 绑定名优先看 COUNTS，其次 DB / bqtj —— 名字对不上会让统计静默失效，
 *    这是最容易踩的坑（本项目就踩过：绑定时起了项目名 bqtj）。
 *  - 永不缓存，保证读数及时。
 * ---------------------------------------------------------------------------
 */

/* 取 D1 绑定 */
const dbOf = (env) => env.COUNTS || env.DB || env.bqtj || null;

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

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });

export async function onRequestGet({ env }) {
  const db = dbOf(env);
  if (!db) {
    return json({
      enabled: false,
      reason: 'not-bound',
      hint: '在 Pages 项目的 设置 → 绑定 里添加一个 D1 数据库，变量名填 COUNTS（DB / bqtj 也认），即可开启下载统计。',
      total: 0,
      counts: {},
    });
  }

  try {
    await ensureSchema(db);
    const { results } = await db
      .prepare('SELECT path, count FROM downloads ORDER BY count DESC')
      .all();

    const counts = {};
    let total = 0;
    for (const r of results || []) {
      counts[r.path] = r.count;
      total += r.count;
    }
    return json({ enabled: true, total, counts });
  } catch (e) {
    return json({ enabled: false, reason: 'error', error: String(e && e.message || e), total: 0, counts: {} });
  }
}
