/**
 * functions/api/stats.js — 管理页「数据概览」用的统计接口
 * ---------------------------------------------------------------------------
 * GET /api/stats?range=7|30|90|all
 *   {
 *     enabled: true,
 *     range:   '7',
 *     total:   累计下载次数（downloads 表，全时段）,
 *     today:   今日新增,
 *     series:  [{ d: '2026-10-17', n: 12 }, ...]   按天，缺的天补 0,
 *     top:     [['/files/subs/xx.ass', 9], ...]     区间内下载最多的 5 条
 *   }
 *
 * 没有绑 D1 时返回 enabled: false，前端据此显示提示。
 *
 * ⚠️ 数据只能**从建表那天开始**积累：downloads 表只有累计总数，
 *    按天的明细来自 download_daily，它 2026-10-17 才加上，
 *    所以更早的日期不存在，曲线前面是空的 —— 这是事实，不是 bug。
 */

const dbOf = (env) => env.COUNTS || env.DB || env.bqtj || null;

/** 东八区日期字符串 */
const dayOf = (ago = 0) =>
  new Date(Date.now() + 8 * 3600 * 1000 - ago * 86400000).toISOString().slice(0, 10);

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });

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
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS download_daily (
         day  TEXT NOT NULL,
         path TEXT NOT NULL,
         n    INTEGER NOT NULL DEFAULT 0,
         PRIMARY KEY (day, path)
       )`
    )
    .run();
  schemaReady = true;
}

export async function onRequestGet({ request, env }) {
  const db = dbOf(env);
  if (!db) {
    return json({
      enabled: false,
      reason: 'not-bound',
      hint: '在 Pages 项目的 设置 → 绑定 里添加一个 D1 数据库，变量名填 COUNTS（DB / bqtj 也认），即可开启统计。',
    });
  }

  const raw = new URL(request.url).searchParams.get('range') || '7';
  const isAll = raw === 'all';
  const days = isAll ? 0 : Math.max(1, Math.min(365, parseInt(raw, 10) || 7));

  try {
    await ensureSchema(db);

    const totalRow = await db.prepare('SELECT SUM(count) AS n FROM downloads').first();
    const todayRow = await db
      .prepare('SELECT SUM(n) AS n FROM download_daily WHERE day = ?')
      .bind(dayOf())
      .first();

    const from = isAll ? '' : dayOf(days - 1);

    /* 每天一条；没有下载的日子也要出现（否则曲线会把空档连起来） */
    const dayRows = isAll
      ? (await db.prepare('SELECT day, SUM(n) AS n FROM download_daily GROUP BY day ORDER BY day').all()).results
      : (await db
          .prepare('SELECT day, SUM(n) AS n FROM download_daily WHERE day >= ? GROUP BY day')
          .bind(from)
          .all()).results;

    const byDay = new Map((dayRows || []).map((r) => [r.day, r.n]));
    const series = [];
    if (isAll) {
      const keys = [...byDay.keys()].sort();
      if (keys.length) keys.forEach((d) => series.push({ d, n: byDay.get(d) }));
      else series.push({ d: dayOf(), n: 0 });
    } else {
      for (let i = days - 1; i >= 0; i--) {
        const d = dayOf(i);
        series.push({ d, n: byDay.get(d) || 0 });
      }
    }

    const topRows = isAll
      ? (await db
          .prepare('SELECT path, SUM(n) AS n FROM download_daily GROUP BY path ORDER BY n DESC LIMIT 5')
          .all()).results
      : (await db
          .prepare(
            'SELECT path, SUM(n) AS n FROM download_daily WHERE day >= ? GROUP BY path ORDER BY n DESC LIMIT 5'
          )
          .bind(from)
          .all()).results;

    return json({
      enabled: true,
      range: isAll ? 'all' : String(days),
      total: (totalRow && totalRow.n) || 0,
      today: (todayRow && todayRow.n) || 0,
      series,
      top: (topRows || []).map((r) => [r.path, r.n]),
    });
  } catch (e) {
    return json({ enabled: false, reason: 'error', error: String((e && e.message) || e) });
  }
}
