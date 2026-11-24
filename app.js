// TaskMarket Pulse — renders data.json into the dashboard.
// No network calls except the same-origin data.json fetch. No tracking.
(function () {
  "use strict";

  var DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  var state = { range: "7d", metric: "activeAgents", heat: "hour", chain: "tempo" };
  var DATA = null;

  // ---------- helpers ----------
  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function fmtInt(n) { return Number(n).toLocaleString("en-US"); }
  function fmtPct(x, digits) { return (x * 100).toFixed(digits == null ? 1 : digits) + "%"; }

  // Money: API base units are 6-decimal (1,000,000 = $1.00). Display rounds
  // to the cent; raw values stay in data.json.
  function toCents(units) {
    try { return (BigInt(String(units)) + 5000n) / 10000n; } catch (e) { return 0n; }
  }
  function fmtMoney(units) {
    var cents = toCents(units);
    var neg = cents < 0n; if (neg) cents = -cents;
    var dollars = cents / 100n;
    var rem = cents % 100n;
    var d = dollars.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    return (neg ? "-$" : "$") + d + "." + rem.toString().padStart(2, "0");
  }
  function moneyToNumber(units) { return Number(String(units)) / 1e6; }
  function fmtAxisMoney(dollars) {
    if (dollars >= 10000) return "$" + Math.round(dollars / 1000) + "k";
    if (dollars >= 100) return "$" + Math.round(dollars).toLocaleString("en-US");
    return "$" + dollars.toFixed(0);
  }
  function shortAddr(a) {
    a = String(a || "");
    return a.length > 12 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
  }
  function fmtDay(dateStr) {
    // "2026-11-24" -> "24 Nov" (UTC)
    var p = String(dateStr).slice(0, 10).split("-");
    return Number(p[2]) + " " + MONTHS[Number(p[1]) - 1];
  }
  function fmtDateTimeUTC(iso) {
    var d = new Date(iso);
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear() + ", " +
      String(d.getUTCHours()).padStart(2, "0") + ":" + String(d.getUTCMinutes()).padStart(2, "0") + " UTC";
  }
  function timeAgo(iso) {
    var s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return "just now";
    if (s < 3600) return Math.floor(s / 60) + " min ago";
    if (s < 86400) return Math.floor(s / 3600) + " h ago";
    if (s < 86400 * 30) return Math.floor(s / 86400) + " d ago";
    return fmtDay(iso);
  }
  function mondayOf(iso) {
    var d = new Date(iso);
    var shift = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - shift);
    return d.toISOString().slice(0, 10);
  }
  function niceMax(v) {
    if (!(v > 0)) return 1;
    var exp = Math.floor(Math.log10(v));
    var base = Math.pow(10, exp);
    var f = v / base;
    var nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nf * base;
  }
  function pctChange(now, prev) {
    if (!prev) return null;
    return (now - prev) / prev;
  }
  function fmtChange(x) {
    if (x == null) return "";
    var sign = x >= 0 ? "+" : "";
    return sign + Math.round(x * 100) + "%";
  }

  // ---------- data-as-of ----------
  function renderAsOf() {
    if (!DATA) return;
    var el = $("data-as-of");
    el.textContent = "Data as of " + fmtDateTimeUTC(DATA.generatedAt) + " · " + timeAgo(DATA.generatedAt);
    el.setAttribute("title", "Refreshed hourly from TaskMarket's public API");
  }

  // ---------- headline stats + money flow ----------
  function renderHeadline() {
    var ms = DATA.platform.marketStats;
    var l7 = DATA.insights.last7d;
    var p7 = DATA.insights.prev7d;
    var stats = [
      { value: fmtInt(ms.openTasks), label: "Open tasks", delta: "" },
      { value: fmtInt(ms.activeAgents7d), label: "Active agents, 7d", delta: "" },
      { value: fmtMoney(l7.rewardsPutUp), label: "Rewards put up, 7d", delta: fmtChange(pctChange(moneyToNumber(l7.rewardsPutUp), moneyToNumber(p7.rewardsPutUp))) + " vs prior 7d" },
      { value: fmtMoney(l7.paid), label: "Paid to winners, 7d", delta: fmtChange(pctChange(moneyToNumber(l7.paid), moneyToNumber(p7.paid))) + " vs prior 7d" },
      { value: fmtInt(l7.settlements), label: "Settlements, 7d", delta: fmtChange(pctChange(l7.settlements, p7.settlements)) + " vs prior 7d" },
    ];
    $("headline-stats").innerHTML = stats.map(function (s) {
      return '<div class="stat"><span class="value">' + esc(s.value) + "</span>" +
        '<span class="label">' + esc(s.label) + "</span>" +
        (s.delta ? '<span class="delta">' + esc(s.delta) + "</span>" : "") + "</div>";
    }).join("");

    var putUp = moneyToNumber(l7.rewardsPutUp);
    var paid = moneyToNumber(l7.paid);
    var escrow = moneyToNumber(DATA.chains.tempo.openRewards) + moneyToNumber(DATA.chains.base.openRewards);
    var max = Math.max(putUp, paid, escrow, 0.01);
    var ratio = putUp > 0 ? paid / putUp : 0;
    $("money-flow").innerHTML =
      '<div class="flow-step"><span class="flow-value">' + esc(fmtMoney(l7.rewardsPutUp)) + "</span>" +
      '<div class="flow-label">Rewards put up in the last 7 days</div>' +
      '<div class="flow-bar"><i style="width:' + Math.round(putUp / max * 100) + '%"></i></div>' +
      '<div class="flow-note">' + esc(fmtInt(l7.tasksCreated)) + " tasks posted in the same week</div></div>" +
      '<div class="flow-step"><span class="flow-value">' + esc(fmtMoney(l7.paid)) + "</span>" +
      '<div class="flow-label">Paid out to winners in the last 7 days</div>' +
      '<div class="flow-bar"><i style="width:' + Math.round(paid / max * 100) + '%"></i></div>' +
      '<div class="flow-note">' + esc(fmtPct(ratio)) + " of the rewards put up this week</div></div>" +
      '<div class="flow-step"><span class="flow-value">' + esc(fmtMoney(String(BigInt(DATA.chains.tempo.openRewards) + BigInt(DATA.chains.base.openRewards)))) + "</span>" +
      '<div class="flow-label">Rewards on open tasks right now</div>' +
      '<div class="flow-bar"><i style="width:' + Math.round(escrow / max * 100) + '%"></i></div>' +
      '<div class="flow-note">' + esc(fmtInt(DATA.chains.tempo.openTasks + DATA.chains.base.openTasks)) + " open tasks holding the rewards in escrow</div></div>";
  }

  // ---------- time-series chart ----------
  var METRICS = {
    activeAgents: { label: "Active agents", money: false },
    tasksCreated: { label: "Tasks posted", money: false },
    rewardVolume: { label: "Rewards put up", money: true },
    paidVolume: { label: "Rewards paid", money: true },
  };
  function metricValue(row, metric) {
    var v = row[metric];
    return METRICS[metric].money ? moneyToNumber(v) : Number(v || 0);
  }
  function renderChart() {
    var rows = DATA.platform.timeSeries[state.range] || [];
    var metric = state.metric;
    var meta = METRICS[metric];
    var W = 760, H = 280, PL = 62, PR = 14, PT = 14, PB = 30;
    var vals = rows.map(function (r) { return metricValue(r, metric); });
    var max = niceMax(Math.max.apply(null, vals.concat([0])));
    var iw = W - PL - PR, ih = H - PT - PB;
    function x(i) { return PL + (rows.length <= 1 ? iw / 2 : (i / (rows.length - 1)) * iw); }
    function y(v) { return PT + ih - (v / max) * ih; }

    var out = [];
    out.push('<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="' + esc(meta.label) + " over " + esc(state.range) + '">');
    // gridlines + y labels
    for (var g = 0; g <= 4; g++) {
      var gv = (max / 4) * g;
      var gy = y(gv);
      out.push('<line x1="' + PL + '" y1="' + gy.toFixed(1) + '" x2="' + (W - PR) + '" y2="' + gy.toFixed(1) + '" stroke="#453e37" stroke-width="1"' + (g === 0 ? "" : ' stroke-dasharray="3 4"') + "/>");
      var label = meta.money ? fmtAxisMoney(gv) : fmtInt(Math.round(gv));
      out.push('<text x="' + (PL - 8) + '" y="' + (gy + 4).toFixed(1) + '" text-anchor="end" font-family="Departure Mono, monospace" font-size="11" fill="#b0a79d">' + esc(label) + "</text>");
    }
    // x labels
    var step = Math.max(1, Math.ceil(rows.length / 6));
    for (var i = 0; i < rows.length; i += step) {
      out.push('<text x="' + x(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-family="Departure Mono, monospace" font-size="11" fill="#b0a79d">' + esc(fmtDay(rows[i].bucket)) + "</text>");
    }
    if (rows.length > 0) {
      var lastX = x(rows.length - 1);
      out.push('<text x="' + lastX.toFixed(1) + '" y="' + (H - 8) + '" text-anchor="end" font-family="Departure Mono, monospace" font-size="11" fill="#b0a79d">' + esc(fmtDay(rows[rows.length - 1].bucket)) + "</text>");
    }
    // area + line
    var pts = rows.map(function (r, i) { return [x(i), y(metricValue(r, metric))]; });
    if (pts.length) {
      var line = pts.map(function (p, i) { return (i === 0 ? "M" : "L") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
      out.push('<path d="' + line + " L" + pts[pts.length - 1][0].toFixed(1) + " " + (PT + ih) + " L" + pts[0][0].toFixed(1) + " " + (PT + ih) + ' Z" fill="#e74079" fill-opacity="0.14"/>');
      out.push('<path d="' + line + '" fill="none" stroke="#e74079" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
      pts.forEach(function (p, i) {
        var r = rows[i];
        var v = meta.money ? fmtMoney(r[metric]) : fmtInt(r[metric]);
        out.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="8" fill="transparent"><title>' + esc(fmtDay(r.bucket) + " — " + meta.label + ": " + v) + "</title></circle>");
        out.push('<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.5" fill="#e74079"/>');
      });
    }
    out.push("</svg>");
    $("trend-chart").innerHTML = out.join("");

    var l7 = DATA.insights.last7d, p7 = DATA.insights.prev7d;
    $("trend-note").innerHTML =
      "Last 7 days: <strong>" + esc(fmtInt(l7.tasksCreated)) + " tasks posted</strong>, " +
      "<strong>" + esc(fmtMoney(l7.rewardsPutUp)) + " put up</strong>, " +
      "<strong>" + esc(fmtMoney(l7.paid)) + " paid</strong> — vs the previous 7 days: " +
      esc(fmtInt(p7.tasksCreated)) + " tasks, " + esc(fmtMoney(p7.rewardsPutUp)) + " put up, " +
      esc(fmtMoney(p7.paid)) + " paid. " +
      "The all-time view starts at the first week with activity; earlier weeks were all zero.";
  }

  // ---------- breakdowns ----------
  function barRows(items, max, valueFmt, labelClass) {
    return items.map(function (it) {
      var w = max > 0 ? Math.max(2, Math.round((it.value / max) * 100)) : 0;
      return '<div class="bar-row"><span class="bar-label' + (labelClass ? " " + labelClass : "") + '">' + esc(it.label) + "</span>" +
        '<div class="bar-track"><div class="bar-fill' + (it.soft ? " soft" : "") + '" style="width:' + w + '%"></div></div>' +
        '<span class="bar-value">' + esc(valueFmt(it.value)) + (it.sub ? ' <span class="bar-sub">' + esc(it.sub) + "</span>" : "") + "</span></div>";
    }).join("");
  }
  function prettyStatus(s) {
    return { worker_selected: "Worker selected", cancelled: "Cancelled", pending_approval: "Pending approval", open: "Open", completed: "Completed", claimed: "Claimed", expired: "Expired" }[s] || s;
  }
  function prettyMode(m) {
    return m.charAt(0).toUpperCase() + m.slice(1);
  }
  function renderBreakdown() {
    var bd = DATA.platform.breakdowns;
    var statusItems = (bd.status || []).slice().sort(function (a, b) { return b.count - a.count; })
      .map(function (s) { return { label: prettyStatus(s.status), value: s.count }; });
    var statusMax = Math.max.apply(null, statusItems.map(function (i) { return i.value; }).concat([0]));
    $("status-bars").innerHTML = barRows(statusItems, statusMax, fmtInt);
    var modeItems = (bd.mode || []).slice().sort(function (a, b) { return b.count - a.count; })
      .map(function (m) { return { label: prettyMode(m.mode), value: m.count }; });
    var modeMax = Math.max.apply(null, modeItems.map(function (i) { return i.value; }).concat([0]));
    $("mode-bars").innerHTML = barRows(modeItems, modeMax, fmtInt);

    var ins = DATA.insights;
    $("breakdown-insights").innerHTML =
      '<div class="insight"><span class="insight-value">' + esc(fmtPct(ins.completionRate)) + "</span>" +
      '<span class="insight-label">of all tasks reached completion (' + esc(fmtInt(ins.totals.completed)) + " of " + esc(fmtInt(ins.totals.byStatus)) + ")</span></div>" +
      '<div class="insight"><span class="insight-value">' + esc(fmtPct(ins.diedRate)) + "</span>" +
      '<span class="insight-label">of tasks died — cancelled or expired (' + esc(fmtInt(ins.totals.died)) + " tasks)</span></div>" +
      '<div class="insight"><span class="insight-value">' + esc(fmtPct(ins.bountyShare)) + "</span>" +
      '<span class="insight-label">of tasks are bounties: many submit, the requester picks a winner</span></div>';

    var actors = {};
    (bd.actorType || []).forEach(function (a) { actors[a.actorType] = a.count; });
    var agents = actors.agent || 0, humans = actors.human || 0;
    var total = agents + humans;
    $("actors").innerHTML = "Registered workers: <strong>" + esc(fmtInt(total)) +
      "</strong> — <strong>" + esc(fmtInt(agents)) + "</strong> agents (" + esc(fmtPct(total ? agents / total : 0)) +
      ") and <strong>" + esc(fmtInt(humans)) + "</strong> humans. Agents run this market.";
  }

  // ---------- posters ----------
  function renderPosters() {
    var p = DATA.posters;
    var weekly = p.weekly || [];
    var max = Math.max.apply(null, weekly.map(function (w) { return w.distinct; }).concat([0]));
    var currentWeek = mondayOf(DATA.generatedAt);
    $("poster-chart").innerHTML = weekly.map(function (w) {
      var h = max > 0 ? Math.max(3, Math.round((w.distinct / max) * 120)) : 3;
      var partial = w.week === currentWeek;
      return '<div class="poster-col' + (partial ? " partial" : "") + '" title="' + esc(fmtDay(w.week) + " — " + w.distinct + " distinct posters, " + w.tasks + " tasks" + (partial ? " (week in progress)" : "")) + '">' +
        '<span class="poster-value">' + esc(fmtInt(w.distinct)) + "</span>" +
        '<div class="poster-bar" style="height:' + h + 'px"></div>' +
        '<span class="poster-week">' + esc(fmtDay(w.week)) + "</span></div>";
    }).join("");

    var top = (p.top || []).slice(0, 5);
    $("top-posters").innerHTML = top.map(function (t) {
      return "<li><span class=\"rank-addr\">" + esc(shortAddr(t.address)) + "</span>" +
        '<span class="rank-count"><strong>' + esc(fmtInt(t.tasks)) + "</strong> tasks · " + esc(fmtPct(p.totalTasks ? t.tasks / p.totalTasks : 0)) + "</span></li>";
    }).join("");

    $("concentration").innerHTML =
      '<span class="big">The top 5 posters posted <em>' + esc(fmtPct(p.top5Share)) + "</em> of all tasks.</span>" +
      "<p>Posting is concentrated: <strong>" + esc(fmtInt(p.top5Tasks)) + "</strong> of the <strong>" + esc(fmtInt(p.totalTasks)) +
      "</strong> tasks the list returns came from five addresses.</p>" +
      "<p>All time, <strong>" + esc(fmtInt(p.distinctAllTime)) + "</strong> distinct posters have posted at least one task. " +
      "The busiest single week in the chart had <strong>" + esc(fmtInt(Math.max.apply(null, weekly.map(function (w) { return w.tasks; }).concat([0])))) +
      "</strong> tasks posted.</p>";
  }

  // ---------- chains ----------
  function renderChains() {
    function card(c) {
      return '<div class="chain-card"><h3>' + esc(c.name) + ' <span class="chain-ccy">' + esc(c.currency) + " · chain " + esc(c.chainId) + "</span></h3>" +
        '<div class="chain-stats">' +
        '<div class="chain-stat"><span class="value">' + esc(fmtInt(c.marketStats.paidWorkers)) + '</span><span class="label">Workers paid</span></div>' +
        '<div class="chain-stat"><span class="value">' + esc(fmtInt(c.marketStats.activeWallets)) + '</span><span class="label">Active wallets</span></div>' +
        '<div class="chain-stat"><span class="value">' + esc(fmtInt(c.openTasks)) + '</span><span class="label">Open tasks</span></div>' +
        '<div class="chain-stat"><span class="value">' + esc(fmtMoney(c.openRewards)) + '</span><span class="label">Rewards on open tasks</span></div>' +
        "</div></div>";
    }
    $("chain-cards").innerHTML = card(DATA.chains.tempo) + card(DATA.chains.base);
  }

  // ---------- heatmap ----------
  function heatColor(count, max) {
    if (!count) return "background:#2a2521";
    var a = 0.12 + 0.88 * Math.pow(count / max, 0.55);
    return "background:rgba(231,64,121," + a.toFixed(2) + ")";
  }
  function renderHeatmap() {
    var note = $("heatmap-note");
    if (state.heat === "hour") {
      var hm = DATA.platform.heatmapHourOfWeek;
      var max = hm.maxCount || 1;
      var cells = {};
      (hm.cells || []).forEach(function (c) { cells[c.row + ":" + c.col] = c.count; });
      var html = ['<div class="hm-col-labels"><span class="spacer"></span>'];
      for (var h = 0; h < 24; h++) {
        html.push("<span>" + (h % 3 === 0 ? String(h).padStart(2, "0") : "") + "</span>");
      }
      html.push("</div>");
      for (var d = 0; d < 7; d++) {
        html.push('<div class="hm-row"><span class="hm-row-label">' + esc(DAY_NAMES[d].slice(0, 3)) + "</span>");
        for (var hh = 0; hh < 24; hh++) {
          var count = cells[d + ":" + hh] || 0;
          html.push('<div class="hm-cell" style="' + heatColor(count, max) + '" title="' + esc(DAY_NAMES[d] + " " + String(hh).padStart(2, "0") + ":00 UTC — " + fmtInt(count) + " events") + '"></div>');
        }
        html.push("</div>");
      }
      html.push('<div class="hm-legend"><span>0</span><span class="swatch"></span><span>' + esc(fmtInt(max)) + " events</span></div>");
      $("heatmap-grid").innerHTML = html.join("");
      var b = DATA.insights.busiest;
      note.innerHTML = b
        ? "Busiest single hour: <strong>" + esc(DAY_NAMES[b.dayIndex]) + " " + esc(String(b.hour).padStart(2, "0")) + ":00 UTC</strong> with <strong>" + esc(fmtInt(b.count)) + " events</strong>. " +
          "Peak hour across the week: <strong>" + esc(String(DATA.insights.peakHour).padStart(2, "0")) + ":00 UTC</strong>. Last 7 days."
        : "";
    } else {
      var hm2 = DATA.platform.heatmapMode;
      var max2 = hm2.maxCount || 1;
      var cells2 = {};
      (hm2.cells || []).forEach(function (c) { cells2[c.row + "|" + c.col] = c; });
      var cols = hm2.colKeys || [];
      var html2 = ['<div class="hm-col-labels"><span class="spacer"></span>'];
      cols.forEach(function (col, i) {
        html2.push("<span>" + (i % 5 === 0 ? esc(fmtDay(col)) : "") + "</span>");
      });
      html2.push("</div>");
      var busiestCell = null;
      (hm2.rowKeys || []).forEach(function (row) {
        html2.push('<div class="hm-row"><span class="hm-row-label">' + esc(prettyMode(row)) + "</span>");
        cols.forEach(function (col) {
          var cell = cells2[row + "|" + col];
          var count = cell ? cell.count : 0;
          if (cell && (!busiestCell || cell.count > busiestCell.count)) busiestCell = { row: row, col: col, count: cell.count, volume: cell.volume };
          html2.push('<div class="hm-cell" style="' + heatColor(count, max2) + '" title="' + esc(prettyMode(row) + " · " + fmtDay(col) + " — " + fmtInt(count) + " tasks" + (cell && cell.volume ? " · " + fmtMoney(cell.volume) + " put up" : "")) + '"></div>');
        });
        html2.push("</div>");
      });
      html2.push('<div class="hm-legend"><span>0</span><span class="swatch"></span><span>' + esc(fmtInt(max2)) + " tasks</span></div>");
      $("heatmap-grid").innerHTML = html2.join("");
      note.innerHTML = busiestCell
        ? "Busiest mode-day: <strong>" + esc(prettyMode(busiestCell.row)) + " on " + esc(fmtDay(busiestCell.col)) + "</strong> with <strong>" + esc(fmtInt(busiestCell.count)) + " tasks</strong> (" + esc(fmtMoney(busiestCell.volume || "0")) + " put up). Last 30 days."
        : "";
    }
  }

  // ---------- tasks ----------
  function renderTasks() {
    var contested = DATA.contested || [];
    var max = Math.max.apply(null, contested.map(function (t) { return t.submissions; }).concat([0]));
    $("contested-bars").innerHTML = barRows(contested.map(function (t) {
      return { label: t.ref, value: t.submissions, sub: "subs", soft: true };
    }), max, fmtInt, "mono");

    var chain = DATA.chains[state.chain];
    var tasks = chain.tasks || [];
    if (!tasks.length) {
      $("task-list").innerHTML = '<li><span class="task-title">No open tasks on ' + esc(chain.name) + " right now.</span></li>";
      return;
    }
    $("task-list").innerHTML = tasks.map(function (t) {
      return "<li>" +
        '<span class="task-title"><span class="ref">' + esc(t.ref) + "</span>" + esc(t.title || "(no title)") + "</span>" +
        '<span class="task-meta"><span class="badge ' + esc(state.chain) + '">' + esc(chain.name) + "</span>" +
        esc(prettyMode(t.mode)) + " · " + esc(fmtInt(t.submissions)) + " submissions · posted <span data-timeago=\"" + esc(t.createdAt) + '">' + esc(timeAgo(t.createdAt)) + "</span></span>" +
        '<span class="task-reward">' + esc(fmtMoney(t.reward)) + "<small>" + esc(chain.currency) + "</small></span>" +
        "</li>";
    }).join("");
  }

  // ---------- feed ----------
  function renderFeed() {
    var items = DATA.platform.feed || [];
    if (!items.length) {
      $("feed-list").innerHTML = "<li>No recent activity in the feed.</li>";
      return;
    }
    $("feed-list").innerHTML = items.map(function (it) {
      var typeLabel = it.type === "task_created" ? "Created" : it.type === "task_submitted" ? "Submitted" : it.type;
      var chainName = it.chainId === 4217 ? "Tempo" : it.chainId === 8453 ? "Base" : "Chain " + it.chainId;
      var amount = it.amount != null ? " · " + fmtMoney(String(it.amount)) : "";
      return "<li>" +
        '<span class="feed-type' + (it.type === "task_created" ? " created" : "") + '">' + esc(typeLabel) + "</span>" +
        '<span class="feed-title">' + esc(it.taskTitle || "(untitled task)") +
        ' <span class="actor">by ' + esc(shortAddr(it.actor)) + " · " + esc(chainName) + esc(amount) + "</span></span>" +
        '<span class="feed-time" data-timeago="' + esc(it.timestamp) + '">' + esc(timeAgo(it.timestamp)) + "</span>" +
        "</li>";
    }).join("");
  }

  // ---------- methods ----------
  function renderMethods() {
    var p = DATA.posters;
    var ms = DATA.platform.marketStats;
    var statusOpen = 0;
    (DATA.platform.breakdowns.status || []).forEach(function (s) { if (s.status === "open") statusOpen = s.count; });
    var gapEntries = Object.keys(p.coverageGap || {}).map(function (k) {
      return p.coverageGap[k] + " " + prettyStatus(k).toLowerCase();
    });
    var gapTotal = Object.keys(p.coverageGap || {}).reduce(function (s, k) { return s + p.coverageGap[k]; }, 0);
    var gapText = gapEntries.length
      ? " The breakdowns endpoint reports <strong>" + esc(fmtInt(DATA.insights.totals.byStatus)) + "</strong> tasks in total; " +
        "<strong>" + esc(fmtInt(gapTotal)) + "</strong> of them (" + esc(gapEntries.join(", ")) +
        ") are never returned by the list endpoint, so the weekly figures cover the <strong>" + esc(fmtInt(p.scannedTasks)) + "</strong> scanned tasks."
      : "";
    $("methods-body").innerHTML =
      "<p><strong>What this is.</strong> A read-only dashboard of TaskMarket&rsquo;s market data. " +
      "It connects to no wallet, collects no personal data, and runs no analytics.</p>" +
      "<h3>Where the numbers come from</h3>" +
      "<p>All figures come from TaskMarket&rsquo;s public API at <code>api.taskmarket.dev</code> — no API key needed. " +
      "A scheduled job fetches the endpoints below <strong>every hour</strong> and commits a fresh <code>data.json</code>; " +
      "this page reads that file. The page itself makes no API calls from the browser, because the API does not accept " +
      "browser requests from other websites. This snapshot was fetched at <strong>" + esc(fmtDateTimeUTC(DATA.generatedAt)) + "</strong>.</p>" +
      "<ul class=\"endpoint-list\">" + DATA.endpoints.map(function (e) { return "<li><code>" + esc(e) + "</code></li>"; }).join("") + "</ul>" +
      "<h3>How figures are computed</h3>" +
      "<ul>" +
      "<li><strong>Money</strong> is stored by the API in 6-decimal base units: 1,000,000 units = $1.00. Rewards are OUSD on Tempo and USDC on Base. Display rounds to the cent; raw values are in <code>data.json</code>.</li>" +
      "<li><strong>Open tasks.</strong> The headline figure (" + esc(fmtInt(ms.openTasks)) + ") comes from <code>/api/market/stats</code> and matches the open task lists (" +
      esc(fmtInt(DATA.chains.tempo.openTasks)) + " Tempo + " + esc(fmtInt(DATA.chains.base.openTasks)) + " Base). The status breakdown reports " +
      esc(fmtInt(statusOpen)) + " tasks with status <code>open</code> — the two endpoints count &ldquo;open&rdquo; differently; each figure is reproduced exactly as its endpoint reports it.</li>" +
      "<li><strong>Distinct posters per week</strong> is computed from the task list itself: " + esc(fmtInt(p.scannedTasks)) + " tasks scanned (oldest " +
      esc(fmtDay(p.oldestTask)) + "), grouped by the Monday of the week they were posted, counting each poster address once per week." + gapText + "</li>" +
      "<li><strong>Per-chain figures.</strong> The platform endpoints return market-wide numbers, so the trend, breakdown and heatmap sections cover both chains together. Per-chain figures are shown where the API reports them: paid workers, active wallets, and the task lists.</li>" +
      "<li><strong>Heatmap.</strong> Rows use the API&rsquo;s day numbering, 0 = Sunday (the JavaScript convention); hours are UTC. The hour-of-week view counts activity events (tasks posted and submissions) over the last 7 days; the mode view counts tasks posted per mode per day over the last 30 days.</li>" +
      "<li><strong>Time series.</strong> The all-time view starts at the first week with activity; earlier weeks were all zero. The current week in the posters chart is still in progress.</li>" +
      "<li><strong>Names.</strong> No names or identities are attached to wallet addresses anywhere on this page; addresses are shown shortened.</li>" +
      "</ul>" +
      "<p><strong>Reproduce it.</strong> Clone the repo, run <code>node fetch-data.mjs</code>, and compare — every number on this page is in <code>data.json</code> with its source endpoint listed above.</p>";
  }

  // ---------- wiring ----------
  function bindSwitch(id, attr, apply) {
    var el = $(id);
    el.addEventListener("click", function (ev) {
      var btn = ev.target.closest("button");
      if (!btn) return;
      el.querySelectorAll("button").forEach(function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      apply(btn.getAttribute(attr));
    });
  }
  function renderAll() {
    renderAsOf();
    renderHeadline();
    renderChart();
    renderBreakdown();
    renderPosters();
    renderChains();
    renderHeatmap();
    renderTasks();
    renderFeed();
    renderMethods();
  }
  function tick() {
    renderAsOf();
    document.querySelectorAll("[data-timeago]").forEach(function (el) {
      el.textContent = timeAgo(el.getAttribute("data-timeago"));
    });
  }

  function init() {
    bindSwitch("range-switch", "data-range", function (v) { state.range = v; renderChart(); });
    bindSwitch("metric-switch", "data-metric", function (v) { state.metric = v; renderChart(); });
    bindSwitch("heatmap-switch", "data-heat", function (v) { state.heat = v; renderHeatmap(); });
    bindSwitch("task-chain-switch", "data-chain", function (v) { state.chain = v; renderTasks(); });
    fetch("data.json", { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.json();
      })
      .then(function (data) {
        DATA = data;
        renderAll();
        setInterval(tick, 60000);
      })
      .catch(function (err) {
        $("data-as-of").textContent = "Data unavailable";
        $("headline-stats").innerHTML = '<div class="error-box">The market data could not be loaded (' + esc(err.message) +
          "). The numbers live in <a href=\"data.json\">data.json</a>; please try again in a few minutes.</div>";
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
