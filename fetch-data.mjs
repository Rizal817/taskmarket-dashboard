// fetch-data.mjs — pull public TaskMarket market data and write data.json.
//
// Run:  node fetch-data.mjs          (writes data.json next to this file)
// No dependencies, no API key. Node 18+ (global fetch).
//
// The TaskMarket API does not allow browser requests from other websites, so
// this script fetches server-side (locally, or hourly in GitHub Actions) and
// the page reads the cached data.json. Every number in data.json is copied
// from the API or computed from API data; nothing is invented.
//
// Money in the API is 6-decimal base units: 1,000,000 = $1.00 (USDC on Base,
// OUSD on Tempo). Raw base-unit strings are kept in data.json; the page
// formats them for display.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = "https://api.taskmarket.dev";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "data.json");
const TEMPO = 4217;
const BASE_CHAIN = 8453;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, { retries = 3, timeoutMs = 60000 } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json", "user-agent": "taskmarket-dashboard-fetch/1.0" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      console.warn(`fetch ${path} attempt ${attempt} failed: ${err.message}`);
      if (attempt < retries) await sleep(2000 * attempt);
    }
  }
  throw lastErr;
}

function mondayOf(dateStr) {
  // ISO week start (Monday) for a YYYY-MM-DD or ISO timestamp, in UTC.
  const d = new Date(dateStr);
  const day = d.getUTCDay(); // 0 = Sunday
  const shift = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function shortTitle(description, maxLen = 90) {
  if (!description) return "";
  const first = description.split("\n")[0].trim();
  return first.length > maxLen ? first.slice(0, maxLen - 1) + "…" : first;
}

function trimTask(t) {
  return {
    id: t.id,
    ref: t.referenceCode,
    title: shortTitle(t.description),
    reward: String(t.reward ?? "0"),
    mode: t.mode,
    status: t.status,
    chainId: t.chainId,
    submissions: t.submissionCount ?? 0,
    createdAt: t.createdAt,
    requester: t.requester,
  };
}

const STATUSES = ["open", "completed", "claimed", "cancelled", "expired", "pending_approval", "worker_selected"];

async function fetchAllTasks() {
  // Page through the whole task list so the posters-per-week series and the
  // concentration figures are computed from complete data. NOTE: no single
  // list query returns every task — the unfiltered list misses completed /
  // cancelled / expired tasks that per-status lists return, while the
  // per-status lists for open / claimed / worker_selected return fewer than
  // the unfiltered list (they seem to filter by current phase, not by the
  // status field). The union of both covers ~99% of the breakdowns total;
  // the small remainder (tasks the list endpoint never returns) is recorded
  // in the coverage gap below and stated in the methods note.
  const byId = new Map();
  let pages = 0;
  let capped = false;
  const pageThrough = async (query) => {
    let cursor = null;
    do {
      const q = `${query}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = await get(q);
      if (!Array.isArray(page.tasks)) throw new Error(`unexpected /api/tasks shape: ${JSON.stringify(page).slice(0, 200)}`);
      for (const t of page.tasks) byId.set(t.id, t);
      cursor = page.nextCursor || null;
      pages++;
      if (pages > 80) { capped = true; break; }
    } while (cursor);
  };
  await pageThrough("/api/tasks?sort=newest&limit=100");
  if (!capped) {
    for (const status of STATUSES) {
      await pageThrough(`/api/tasks?status=${status}&sort=newest&limit=100`);
      if (capped) break;
    }
  }
  const perStatus = {};
  for (const t of byId.values()) perStatus[t.status] = (perStatus[t.status] || 0) + 1;
  return { tasks: [...byId.values()], pages, capped, perStatus };
}

async function main() {
  const generatedAt = new Date().toISOString();
  console.log(`fetching TaskMarket data at ${generatedAt}`);

  const [
    marketStats,
    marketTempo,
    marketBase,
    breakdowns,
    ts7,
    ts30,
    ts90w,
    tsAllw,
    hmHour,
    hmMode,
    feedRaw,
    openTempo,
    openBase,
  ] = await Promise.all([
    get("/api/market/stats"),
    get(`/api/market/stats?chainId=${TEMPO}`),
    get(`/api/market/stats?chainId=${BASE_CHAIN}`),
    get("/api/stats/breakdowns"),
    get("/api/stats/platform-time-series?range=7d&bucket=day"),
    get("/api/stats/platform-time-series?range=30d&bucket=day"),
    get("/api/stats/platform-time-series?range=90d&bucket=week"),
    get("/api/stats/platform-time-series?range=all&bucket=week"),
    get("/api/stats/activity-heatmap?range=7d&dimension=hourOfWeek"),
    get("/api/stats/activity-heatmap?range=30d&dimension=mode"),
    get("/api/stats/activity-feed?limit=30"),
    get(`/api/tasks?chainId=${TEMPO}&status=open&sort=newest&limit=100`),
    get(`/api/tasks?chainId=${BASE_CHAIN}&status=open&sort=newest&limit=100`),
  ]);

  // --- task list scan (posters per week, concentration) ---
  const { tasks: allTasks, pages, capped, perStatus } = await fetchAllTasks();
  console.log(`scanned ${allTasks.length} tasks in ${pages} pages (capped: ${capped})`);
  const oldestTask = allTasks.reduce((m, t) => (t.createdAt < m ? t.createdAt : m), "9999");
  // Cross-check the scan against the breakdowns endpoint and record the
  // coverage gap per status (tasks the list endpoint never returns).
  const coverageGap = {};
  for (const s of breakdowns.status || []) {
    const gap = s.count - (perStatus[s.status] || 0);
    if (gap > 0) {
      // Tasks the list endpoint never returns. A negative gap is just timing
      // (a task changed status between the breakdowns fetch and the scan),
      // not missing data, so it is logged but not recorded as a gap.
      coverageGap[s.status] = gap;
    }
    if (gap !== 0) {
      console.warn(`status count gap: ${s.status} list=${perStatus[s.status] || 0} breakdowns=${s.count}`);
    }
  }

  const byWeek = new Map(); // monday -> { posters:Set, tasks }
  const posterCounts = new Map(); // lowercase address -> task count
  for (const t of allTasks) {
    const week = mondayOf(t.createdAt);
    if (!byWeek.has(week)) byWeek.set(week, { posters: new Set(), tasks: 0 });
    const w = byWeek.get(week);
    w.tasks++;
    const poster = String(t.requester || "").toLowerCase();
    if (poster) {
      w.posters.add(poster);
      posterCounts.set(poster, (posterCounts.get(poster) || 0) + 1);
    }
  }
  const weekly = [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .slice(-13)
    .map(([week, w]) => ({ week, distinct: w.posters.size, tasks: w.tasks }));
  const top = [...posterCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([address, tasks]) => ({ address, tasks }));
  const totalTasks = allTasks.length;
  const top5Tasks = top.slice(0, 5).reduce((s, p) => s + p.tasks, 0);
  const distinctAllTime = posterCounts.size;

  // --- breakdown totals / rates ---
  const statusCounts = Object.fromEntries((breakdowns.status || []).map((s) => [s.status, s.count]));
  const modeCounts = Object.fromEntries((breakdowns.mode || []).map((m) => [m.mode, m.count]));
  const totalByStatus = Object.values(statusCounts).reduce((a, b) => a + b, 0);
  const completed = statusCounts.completed || 0;
  const died = (statusCounts.cancelled || 0) + (statusCounts.expired || 0);
  const totalByMode = Object.values(modeCounts).reduce((a, b) => a + b, 0);

  // --- 7d / 30d sums from the daily series ---
  const sumField = (rows, field) =>
    rows.reduce((s, r) => s + BigInt(r[field] ?? "0"), 0n).toString();
  const sumNum = (rows, field) => rows.reduce((s, r) => s + (r[field] || 0), 0);
  const last7 = ts30.slice(-7);
  const prev7 = ts30.slice(-14, -7);
  const sumRange = (rows) => ({
    tasksCreated: sumNum(rows, "tasksCreated"),
    rewardsPutUp: sumField(rows, "rewardVolume"),
    paid: sumField(rows, "paidVolume"),
    settlements: sumNum(rows, "settlements"),
    newAgents: sumNum(rows, "newAgents"),
  });
  const last7d = sumRange(last7);
  const prev7d = sumRange(prev7);
  const last30d = sumRange(ts30);

  // --- heatmap peaks (rows use the API's day numbering; see methods note) ---
  let busiest = null;
  const hourTotals = new Array(24).fill(0);
  for (const c of hmHour.cells || []) {
    hourTotals[Number(c.col)] += c.count;
    if (!busiest || c.count > busiest.count) {
      busiest = { dayIndex: Number(c.row), hour: Number(c.col), count: c.count };
    }
  }
  const peakHour = hourTotals.indexOf(Math.max(...hourTotals));

  // --- per-chain open tasks ---
  const chainBlock = (chainId, name, currency, market, openPage) => {
    const tasks = (openPage.tasks || []).map(trimTask);
    const openRewards = tasks.reduce((s, t) => s + BigInt(t.reward), 0n).toString();
    return {
      chainId,
      name,
      currency,
      marketStats: market,
      openTasks: tasks.length,
      openRewards,
      tasks: tasks.slice(0, 12),
    };
  };

  // Most-contested open tasks right now (the swarm converging).
  const contested = [...(openTempo.tasks || []), ...(openBase.tasks || [])]
    .map(trimTask)
    .sort((a, b) => b.submissions - a.submissions)
    .slice(0, 5);

  const data = {
    generatedAt,
    generatedAtUnix: Math.floor(Date.now() / 1000),
    baseUrl: BASE,
    endpoints: [
      "/api/market/stats",
      "/api/market/stats?chainId=4217",
      "/api/market/stats?chainId=8453",
      "/api/stats/breakdowns",
      "/api/stats/platform-time-series?range=7d&bucket=day",
      "/api/stats/platform-time-series?range=30d&bucket=day",
      "/api/stats/platform-time-series?range=90d&bucket=week",
      "/api/stats/platform-time-series?range=all&bucket=week",
      "/api/stats/activity-heatmap?range=7d&dimension=hourOfWeek",
      "/api/stats/activity-heatmap?range=30d&dimension=mode",
      "/api/stats/activity-feed?limit=30",
      "/api/tasks?chainId=4217&status=open&sort=newest&limit=100",
      "/api/tasks?chainId=8453&status=open&sort=newest&limit=100",
      "/api/tasks?status=<each status>&sort=newest&limit=100 (paged, whole list)",
    ],
    platform: {
      marketStats,
      breakdowns,
      timeSeries: {
        "7d": ts7,
        "30d": ts30,
        "90d": ts90w,
        all: tsAllw.filter((r, i, arr) => {
          // Drop leading all-zero weeks so the all-time chart starts at the
          // first week with activity; values themselves are unchanged.
          if (i === 0) return true;
          const firstActive = arr.findIndex(
            (x) => x.tasksCreated > 0 || x.activeAgents > 0 || BigInt(x.paidVolume || "0") > 0n,
          );
          return i >= firstActive;
        }),
      },
      heatmapHourOfWeek: hmHour,
      heatmapMode: hmMode,
      feed: (feedRaw.items || []).map((i) => ({
        type: i.type,
        timestamp: i.timestamp,
        taskId: i.taskId,
        taskTitle: i.taskTitle,
        chainId: i.chainId,
        actor: i.actor,
        actorType: i.actorType,
        amount: i.amount,
      })),
    },
    chains: {
      tempo: chainBlock(TEMPO, "Tempo", "OUSD", marketTempo, openTempo),
      base: chainBlock(BASE_CHAIN, "Base", "USDC", marketBase, openBase),
    },
    posters: {
      weekly,
      top,
      distinctAllTime,
      totalTasks,
      top5Share: totalTasks ? top5Tasks / totalTasks : 0,
      top5Tasks,
      scannedTasks: totalTasks,
      oldestTask,
      perStatus,
      coverageGap,
      scanCapped: capped,
    },
    contested,
    insights: {
      totals: {
        byStatus: totalByStatus,
        byMode: totalByMode,
        completed,
        died,
        open: statusCounts.open || 0,
      },
      completionRate: totalByStatus ? completed / totalByStatus : 0,
      diedRate: totalByStatus ? died / totalByStatus : 0,
      bountyShare: totalByMode ? (modeCounts.bounty || 0) / totalByMode : 0,
      last7d,
      prev7d,
      last30d,
      busiest,
      peakHour,
    },
  };

  writeFileSync(OUT, JSON.stringify(data, null, 1) + "\n");
  console.log(`wrote ${OUT} (${JSON.stringify(data).length} bytes)`);
}

main().catch((err) => {
  console.error("fetch failed:", err);
  process.exit(1);
});
