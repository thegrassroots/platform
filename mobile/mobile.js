/* =============================================================================
 * The Grassroots — Mobile companion (zero-dependency, PWA-ready).
 *
 * A slim, phone-first read surface over the same data model as the desktop
 * platform. It reuses the shared seed (../js/seed.js) and data layer
 * (../js/db.js), and re-derives KPI status with the SAME rules the desktop app
 * uses so every RAG rating, progress figure and roll-up matches exactly:
 *   Progress    = (value − baseline) / (target − baseline)          [ignores time]
 *   Performance = Progress ÷ time-elapsed  → are we on pace by now?  [drives RAG]
 * Performance is the authoritative measure everywhere; progress is shown for
 * visibility only.
 * ========================================================================== */
(function () {
  'use strict';

  /* ---------------------------------------------------------------- shortcuts */
  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  /* --------------------------------------------------------- status + colours */
  var STATUS = {
    blue:   { c: '#2563eb', label: 'Over Track' },
    green:  { c: '#16a34a', label: 'On Track' },
    amber:  { c: '#f59e0b', label: 'At Risk' },
    red:    { c: '#ef4444', label: 'Off Track' },
    maroon: { c: '#9f1239', label: 'Under Track' },
    black:  { c: '#450a0a', label: 'Back Track' },
    nodata: { c: '#94a3b8', label: 'No Data' }
  };
  // Order used for stacked bars / legends (best → worst → none)
  var STATUS_ORDER = ['blue', 'green', 'amber', 'red', 'maroon', 'black', 'nodata'];
  function ratioToCode(ratio) {
    if (ratio == null || isNaN(ratio)) return 'nodata';
    if (ratio > 1) return 'blue';
    if (ratio < 0) return 'black';
    if (ratio >= 0.90) return 'green';
    if (ratio >= 0.75) return 'amber';
    if (ratio >= 0.50) return 'red';
    return 'maroon';
  }
  function statusColor(code) { return (STATUS[code] || STATUS.nodata).c; }
  function statusLabel(code) { return (STATUS[code] || STATUS.nodata).label; }

  var REGION_COLOR = {
    'Africa': '#F2934A', 'Asia': '#5399EA', 'Europe': '#A97FDD',
    'North America': '#EC7BA6', 'South America': '#2CC4A0', 'Oceania': '#6FBF73'
  };

  /* ----------------------------------------------------------------- app state */
  var S = { plan: null, user: null, view: 'home', proj: { q: '', region: '', status: '', page: 1 }, act: { n: 60 } };
  var IDX;                    // DB._idx
  var TODAY;                  // derived "now"
  var INDS = [], INDBYID = {}, PROJECTS = [], PROJBYID = {}, ACTS = [];
  var PILLARS = [];           // active-plan impacts w/ rollups
  var STAT = {};              // portfolio aggregates

  /* ---------------------------------------------------- derivation (mirrors app.js) */
  function lkKey(table, id, legacy) {
    var m = IDX.lookup && IDX.lookup[table]; var r = m ? m[id] : null;
    return r ? r.key : (legacy != null && legacy !== '' ? legacy : null);
  }
  function kpiUnit(ind) { return lkKey('unit', ind.unit_id, ind.unit); }

  function planById(id) { return IDX.planById ? IDX.planById[id] : null; }
  function activePlan() { return planById(S.plan); }
  function allPlans() {
    return (DB.tables.plan || []).slice().sort(function (a, b) {
      return ((a.seq == null ? a.id : a.seq) - (b.seq == null ? b.id : b.seq));
    });
  }
  function currentPlanId() {
    var plans = allPlans(); if (!plans.length) return null;
    var t = TODAY.getTime();
    for (var i = 0; i < plans.length; i++) {
      var s = plans[i].start_date ? Date.parse(plans[i].start_date) : null;
      var e = plans[i].end_date ? Date.parse(plans[i].end_date) : null;
      if (s != null && e != null && t >= s && t <= e) return plans[i].id;
    }
    var latest = plans.slice().sort(function (a, b) { return (Date.parse(b.end_date || 0) || 0) - (Date.parse(a.end_date || 0) || 0); })[0];
    return latest ? latest.id : plans[0].id;
  }
  function indicatorPlanId(ind) {
    if (ind.result_id != null) { var r = IDX.resultById[ind.result_id]; return r ? r.plan_id : null; }
    if (ind.project_id != null) { var p = IDX.projectById[ind.project_id]; return p ? p.plan_id : null; }
    return null;
  }
  function kpiWindowYears(ind) {
    var p = planById(indicatorPlanId(ind || {})) || activePlan();
    var sy = (ind && ind.baseline_year) || (p && p.start_date ? +String(p.start_date).slice(0, 4) : TODAY.getUTCFullYear());
    var ey = (ind && ind.target_year) || (p && p.end_date ? +String(p.end_date).slice(0, 4) : sy + 2);
    if (!(ey >= sy)) ey = sy + 2;
    return { start: sy, end: ey };
  }
  function elapsedFraction(ind, asOf) {
    var when = asOf != null ? new Date(asOf) : TODAY;
    var yrs = kpiWindowYears(ind);
    var start = ind.baseline_date ? new Date(ind.baseline_date) : new Date(yrs.start, 0, 1);
    var end = ind.target_date ? new Date(ind.target_date) : new Date(yrs.end, 11, 31);
    if (!(end > start)) return 1;
    return Math.max(0.02, Math.min(1, (when - start) / (end - start)));
  }
  function indicatorValue(ind, ms) {
    if (!ms.length) return null;
    if (kpiUnit(ind) === 'count') {
      var sum = 0; ms.forEach(function (m) { sum += (+m.value || 0); });
      return (+ind.baseline_value || 0) + sum;
    }
    return ms[ms.length - 1].value;
  }
  function computeStatus(ind) {
    var ms = DB.measurementsFor(ind.id);
    var latest = ms.length ? ms[ms.length - 1] : null;
    var b = ind.baseline_value, t = ind.target_value;
    if (b == null || t == null || +t === +b)
      return { progress: null, performance: null, code: 'nodata', value: null, latest: latest, series: ms };
    if (!latest)
      return { progress: 0, performance: 0, code: ratioToCode(0), value: null, latest: null, series: ms };
    var v = indicatorValue(ind, ms);
    var progress = (v - b) / (t - b);
    var elapsed = elapsedFraction(ind);
    var performance = elapsed > 0 ? progress / elapsed : progress;
    return { progress: progress, performance: performance, code: ratioToCode(performance), value: v, latest: latest, series: ms };
  }
  function deriveToday() {
    var d = new Date();
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var latest = null;
    (DB.tables.measurement || []).forEach(function (m) { if (m.date && (!latest || m.date > latest)) latest = m.date; });
    if (latest) { var lt = new Date(latest); if (lt > t) t = lt; }
    return t;
  }
  function avg(arr) { if (!arr.length) return null; var s = 0; arr.forEach(function (x) { s += x; }); return s / arr.length; }

  /* --------------------------------------------------------------- enrich() */
  function enrich() {
    IDX = DB._idx;
    TODAY = deriveToday();
    if (!(S.plan != null && allPlans().some(function (p) { return p.id === S.plan; }))) S.plan = currentPlanId();

    // 1) indicators scoped to the active plan
    INDS = []; INDBYID = {};
    DB.tables.indicator.forEach(function (raw) {
      if (indicatorPlanId(raw) !== S.plan) return;
      var res = IDX.resultById[raw.result_id];
      var proj = raw.project_id != null ? IDX.projectById[raw.project_id] : null;
      var prog = res ? IDX.programmeById[res.programme_id] : (proj ? IDX.programmeByIso[proj.country_iso3] : null);
      var iso = prog ? prog.country_iso3 : (proj ? proj.country_iso3 : null);
      var st = computeStatus(raw);
      var r = {
        id: raw.id, raw: raw, name: raw.name, code: raw.code, unit: kpiUnit(raw),
        secondary: !!raw.secondary, level: res ? res.level : (raw.secondary ? 'secondary' : 'output'),
        result: res, sdg: res ? res.sdg : null, iso: iso,
        region: prog ? prog.region : (proj ? proj.region : null),
        progress: st.progress, performance: st.performance,
        ratio: st.performance, status: st.code,          // performance is the authoritative RAG
        value: st.value, target: raw.target_value, baseline: raw.baseline_value,
        latest: st.latest, series: st.series,
        updated: st.latest ? st.latest.date : null, updatedMs: st.latest ? Date.parse(st.latest.date) : null
      };
      INDS.push(r); INDBYID[r.id] = r;
    });

    // 2) projects in the active plan, with rolled-up performance
    PROJECTS = []; PROJBYID = {};
    DB.tables.project.forEach(function (p) {
      if (p.plan_id !== S.plan) return;
      var inds = [];
      (IDX.projectKpiByProject[p.id] || []).forEach(function (pk) { var i = INDBYID[pk.indicator_id]; if (i && inds.indexOf(i) < 0) inds.push(i); });
      (IDX.secondaryByProject[p.id] || []).forEach(function (sec) { var i = INDBYID[sec.id]; if (i && inds.indexOf(i) < 0) inds.push(i); });
      var ratios = [], progs = [];
      inds.forEach(function (i) { if (i.ratio != null) { ratios.push(i.ratio); progs.push(i.progress || 0); } });
      var ratio = ratios.length ? avg(ratios) : null;
      var acts = (IDX.measByProject[p.id] || []);
      var pr = {
        raw: p, id: p.id, name: p.name, code: p.code, iso: p.country_iso3, region: p.region,
        country: IDX.countryByIso[p.country_iso3], budget: p.budget_usd,
        donor: p.donor_id != null ? IDX.donorById[p.donor_id] : null,
        partner: p.partner_id != null ? IDX.partnerById[p.partner_id] : null,
        inds: inds, ratio: ratio, status: ratioToCode(ratio),
        progress: progs.length ? avg(progs) : null,
        kpiCount: inds.length, actCount: acts.length,
        start: p.start_date, end: p.end_date, desc: p.description
      };
      PROJECTS.push(pr); PROJBYID[p.id] = pr;
    });
    PROJECTS.sort(function (a, b) { return (b.actCount - a.actCount) || (a.name < b.name ? -1 : 1); });

    // 3) activity feed — one row per measurement whose KPI is in the active plan
    ACTS = [];
    (DB.tables.measurement || []).forEach(function (m) {
      var ind = INDBYID[m.indicator_id]; if (!ind) return;
      var proj = m.project_id != null ? PROJBYID[m.project_id] : null;
      ACTS.push({
        id: m.id, m: m, ind: ind, proj: proj,
        iso: proj ? proj.iso : ind.iso, region: proj ? proj.region : ind.region,
        reporter: m.reported_by_id != null ? IDX.userById[m.reported_by_id] : null,
        dateMs: m.date ? Date.parse(m.date) : 0,
        benes: (IDX.benByMeasurement[m.id] || [])
      });
    });
    ACTS.sort(function (a, b) { return b.dateMs - a.dateMs; });

    // 4) impacts (pillars) roll-up for the active plan
    buildPillars();

    // 5) portfolio aggregates
    computeStats();
  }

  function resultChain(res) {
    var chain = [], n = res;
    while (n) { chain.push(n); n = n.parent_id != null ? IDX.resultById[n.parent_id] : null; }
    return chain;   // [output, outcome, impact]
  }
  // Impacts (pillars) are numbered PER PLAN by their `sdg` field (1..4) and shared
  // across every country programme, so we group by that pillar id — aggregating
  // the KPIs of every impact row carrying it — rather than listing one row per
  // programme. This mirrors the desktop's pillar roll-up.
  function buildPillars() {
    var meta = {};   // sdg -> {name, color, statement}
    DB.tables.result.forEach(function (r) {
      if (r.plan_id !== S.plan || r.level !== 'impact' || r.sdg == null) return;
      var m = meta[r.sdg] = meta[r.sdg] || { name: r.pillar_name, color: r.pillar_color, statement: r.statement };
      if (!m.name && r.pillar_name) m.name = r.pillar_name;
      if (!m.color && r.pillar_color) m.color = r.pillar_color;
    });
    var acc = {};    // sdg -> {ratios, progs, dist}
    INDS.forEach(function (r) {
      if (r.ratio == null || !r.result) return;
      var top = resultChain(r.result).filter(function (n) { return n.level === 'impact'; })[0];
      var sdg = top ? top.sdg : r.sdg;
      if (sdg == null) return;
      var a = acc[sdg] = acc[sdg] || { ratios: [], progs: [], dist: {} };
      a.ratios.push(r.ratio); a.progs.push(r.progress || 0);
      a.dist[r.status] = (a.dist[r.status] || 0) + 1;
    });
    PILLARS = Object.keys(meta).map(function (sdg) {
      var m = meta[sdg], a = acc[sdg];
      var ratio = a ? avg(a.ratios) : null;
      return {
        id: +sdg, sdg: +sdg, name: m.name || ('Impact ' + sdg),
        statement: m.statement, color: m.color || '#5399EA',
        ratio: ratio, status: ratioToCode(ratio),
        progress: a ? avg(a.progs) : null, n: a ? a.ratios.length : 0,
        dist: a ? a.dist : {}
      };
    }).sort(function (a, b) { return (a.sdg || 0) - (b.sdg || 0); });
  }

  function computeStats() {
    var dist = {}; STATUS_ORDER.forEach(function (k) { dist[k] = 0; });
    var ratios = [];
    INDS.forEach(function (r) { dist[r.status] = (dist[r.status] || 0) + 1; if (r.ratio != null) ratios.push(r.ratio); });
    var people = 0;
    ACTS.forEach(function (a) { a.benes.forEach(function (b) { people += (+b.value || 0); }); });
    var budget = 0; PROJECTS.forEach(function (p) { budget += (+p.budget || 0); });
    var countries = {}; PROJECTS.forEach(function (p) { if (p.iso) countries[p.iso] = 1; });
    STAT = {
      projects: PROJECTS.length, activities: ACTS.length, kpis: INDS.length,
      people: people, budget: budget, countries: Object.keys(countries).length,
      dist: dist, meanRatio: avg(ratios), meanCode: ratioToCode(avg(ratios))
    };
  }

  /* -------------------------------------------------------------- formatting */
  function fmtInt(n) { return n == null ? '–' : Math.round(n).toLocaleString('en-US'); }
  function compact(n) {
    if (n == null) return '–';
    var a = Math.abs(n);
    if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
    return String(Math.round(n));
  }
  function money(n) { return n == null ? '–' : '$' + compact(n); }
  function pct(x) { return x == null ? '–' : Math.round(x * 100) + '%'; }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function fmtDate(iso) {
    if (!iso) return '—';
    var d = new Date(iso); if (isNaN(d)) return iso;
    return d.getUTCDate() + ' ' + MON[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }
  function ago(ms) {
    if (!ms) return '';
    var days = Math.round((TODAY.getTime() - ms) / 86400000);
    if (days <= 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30) return days + 'd ago';
    if (days < 365) return Math.round(days / 30) + 'mo ago';
    return Math.round(days / 365) + 'y ago';
  }
  function initials(name) {
    var p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '')[0] || '?').toUpperCase() + (p.length > 1 ? (p[p.length - 1][0] || '').toUpperCase() : '');
  }

  /* ---------------------------------------------------- small UI builders */
  // PROGRESS vs PERFORMANCE, kept visually distinct so readers never confuse them:
  //   • Progress    = cumulative achievement toward the target → a filling BAR.
  //   • Performance = on-pace status right now (a single point in time) → a
  //     categorical PILL / DOT. Performance is NEVER drawn as a bar, because a
  //     bar reads as "how full / how far along", which performance is not.
  // The bar's LENGTH is progress; its COLOUR carries the performance RAG (the
  // authoritative status), so one element shows achievement and pace at a glance.
  function pill(code) { return '<span class="pill" style="--pc:' + statusColor(code) + '">' + esc(statusLabel(code)) + '</span>'; }
  function dot(code) { return '<span class="sdot" style="background:' + statusColor(code) + '"></span>'; }
  function bar(frac, code) {
    var w = frac == null ? 0 : Math.max(0, Math.min(1, frac)) * 100;
    return '<div class="pbar"><span style="width:' + w.toFixed(1) + '%;background:' + statusColor(code || ratioToCode(frac)) + '"></span></div>';
  }
  // An explicitly-labelled progress bar (achievement toward target), coloured by
  // the performance status. Use this anywhere a bar appears in a row.
  function progressLine(frac, code) {
    return '<div class="prow"><span class="prow-l">Progress</span>' + bar(frac, code) + '<span class="prow-v">' + pct(frac) + '</span></div>';
  }
  // stacked distribution bar from a {code:count} map
  function stackBar(dist) {
    var total = 0; STATUS_ORDER.forEach(function (k) { total += (dist[k] || 0); });
    if (!total) return '<div class="stack"></div>';
    var segs = STATUS_ORDER.filter(function (k) { return dist[k]; }).map(function (k) {
      return '<span style="width:' + (dist[k] / total * 100).toFixed(2) + '%;background:' + statusColor(k) + '" title="' + statusLabel(k) + ': ' + dist[k] + '"></span>';
    }).join('');
    return '<div class="stack">' + segs + '</div>';
  }
  // SVG donut for the overall performance figure
  function donut(dist) {
    var total = 0; STATUS_ORDER.forEach(function (k) { total += (dist[k] || 0); });
    var R = 54, C = 2 * Math.PI * R, off = 0, segs = '';
    STATUS_ORDER.forEach(function (k) {
      var v = dist[k] || 0; if (!v) return;
      var len = v / total * C;
      segs += '<circle cx="64" cy="64" r="' + R + '" fill="none" stroke="' + statusColor(k) + '" stroke-width="16" '
        + 'stroke-dasharray="' + len + ' ' + (C - len) + '" stroke-dashoffset="' + (-off) + '"/>';
      off += len;
    });
    return '<svg class="donut" viewBox="0 0 128 128">' + segs + '</svg>';
  }

  /* ============================================================= VIEWS ===== */
  var VIEW_TITLE = { home: 'Home', projects: 'Projects', activity: 'Activity', insights: 'Insights', profile: 'Profile' };

  function render() {
    $('#abTitle').textContent = VIEW_TITLE[S.view] || '';
    var scr = $('#screen'); scr.scrollTop = 0;
    if (S.view === 'home') scr.innerHTML = viewHome();
    else if (S.view === 'projects') { scr.innerHTML = viewProjects(); wireProjects(); }
    else if (S.view === 'activity') { scr.innerHTML = viewActivity(); wireActivity(); }
    else if (S.view === 'insights') scr.innerHTML = viewInsights();
    else if (S.view === 'profile') { scr.innerHTML = viewProfile(); wireProfile(); }
    // tap-through on any element carrying data-proj
    $$('[data-proj]', scr).forEach(function (n) { n.addEventListener('click', function () { openProject(+n.getAttribute('data-proj')); }); });
    $$('[data-kpi]', scr).forEach(function (n) { n.addEventListener('click', function () { openKpi(+n.getAttribute('data-kpi')); }); });
  }

  /* --------------------------------------------------------------- HOME */
  function viewHome() {
    var p = activePlan();
    var hour = new Date().getHours();
    var greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    var name = (S.user && S.user.name || '').split(' ')[0] || 'there';
    var d = STAT.dist, total = STAT.kpis || 1;
    var onTrack = (d.blue || 0) + (d.green || 0);

    var tiles = [
      { k: 'Projects', v: fmtInt(STAT.projects), sub: STAT.countries + ' countries' },
      { k: 'Activities', v: compact(STAT.activities), sub: 'reports logged' },
      { k: 'KPIs tracked', v: fmtInt(STAT.kpis), sub: 'indicators' },
      { k: 'People reached', v: compact(STAT.people), sub: 'beneficiaries' }
    ].map(function (t) {
      return '<div class="tile"><div class="tile-v">' + t.v + '</div><div class="tile-k">' + esc(t.k) + '</div><div class="tile-s">' + esc(t.sub) + '</div></div>';
    }).join('');

    var pillars = PILLARS.map(function (im) {
      return '<div class="row impact">'
        + '<span class="imp-swatch" style="background:' + im.color + '"></span>'
        + '<div class="row-main"><div class="row-t">' + esc(im.name) + '</div>'
        + '<div class="row-s">' + im.n + ' KPIs</div>'
        + progressLine(im.progress, im.status) + '</div>'
        + '<div class="row-end">' + pill(im.status) + '</div></div>';
    }).join('') || '<div class="empty">No impacts in this plan yet.</div>';

    var legend = STATUS_ORDER.filter(function (k) { return d[k]; }).map(function (k) {
      return '<span class="lg"><i style="background:' + statusColor(k) + '"></i>' + statusLabel(k) + ' <b>' + d[k] + '</b></span>';
    }).join('');

    return ''
      + '<div class="hero">'
      +   '<div class="hero-greet">' + esc(greet) + ', ' + esc(name) + '.</div>'
      +   '<div class="hero-plan">' + esc(p ? p.name : '—') + '</div>'
      +   '<div class="hero-win">' + (p ? (fmtDate(p.start_date) + ' → ' + fmtDate(p.end_date)) : '') + '</div>'
      + '</div>'
      + '<div class="tiles">' + tiles + '</div>'
      + '<div class="card perf">'
      +   '<div class="perf-ring">' + donut(d)
      +     '<div class="perf-center"><b style="color:' + statusColor(STAT.meanCode) + '">' + pct(STAT.meanRatio) + '</b><span>performance</span></div>'
      +   '</div>'
      +   '<div class="perf-side">'
      +     '<div class="perf-h">Portfolio performance</div>'
      +     '<div class="perf-lead">' + Math.round(onTrack / total * 100) + '% of KPIs on or over track</div>'
      +     '<div class="legend">' + legend + '</div>'
      +   '</div>'
      + '</div>'
      + '<div class="sec-h">Impacts <span>' + PILLARS.length + '</span></div>'
      + '<div class="card list">' + pillars + '</div>'
      + '<div class="sec-h">Recent activity</div>'
      + '<div class="card list">' + ACTS.slice(0, 5).map(actRow).join('') + '</div>'
      + '<button class="btn ghost block" onclick="__go(\'activity\')">See all activity</button>'
      + '<div class="foot">The Grassroots · v<span id="verNum"></span></div>';
  }

  /* ------------------------------------------------------------ PROJECTS */
  function projectFilters() {
    var regions = {}; PROJECTS.forEach(function (p) { if (p.region) regions[p.region] = 1; });
    var ropts = ['<option value="">All regions</option>'].concat(Object.keys(regions).sort().map(function (r) {
      return '<option value="' + esc(r) + '"' + (S.proj.region === r ? ' selected' : '') + '>' + esc(r) + '</option>';
    })).join('');
    var sopts = ['<option value="">All statuses</option>'].concat(STATUS_ORDER.map(function (k) {
      return '<option value="' + k + '"' + (S.proj.status === k ? ' selected' : '') + '>' + statusLabel(k) + '</option>';
    })).join('');
    return '<div class="filters">'
      + '<div class="search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3-3"/></svg>'
      + '<input id="pq" placeholder="Search projects, donors, countries…" value="' + esc(S.proj.q) + '"></div>'
      + '<div class="selrow"><select id="pRegion">' + ropts + '</select><select id="pStatus">' + sopts + '</select></div>'
      + '</div>';
  }
  function filteredProjects() {
    var q = S.proj.q.trim().toLowerCase();
    return PROJECTS.filter(function (p) {
      if (S.proj.region && p.region !== S.proj.region) return false;
      if (S.proj.status && p.status !== S.proj.status) return false;
      if (q) {
        var hay = (p.name + ' ' + (p.country ? p.country.name : '') + ' ' + (p.donor ? p.donor.name + ' ' + p.donor.short_name : '') + ' ' + (p.code || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function projCard(p) {
    return '<div class="pcard" data-proj="' + p.id + '">'
      + '<div class="pcard-top">'
      +   '<div class="pcard-name">' + esc(stripCountry(p.name, p.country)) + '</div>' + pill(p.status)
      + '</div>'
      + '<div class="pcard-meta">'
      +   '<span class="flagchip">' + esc(p.country ? p.country.name : p.iso || '—') + '</span>'
      +   (p.donor ? '<span class="dchip" style="--dc:' + (p.donor.color || '#888') + '">' + esc(p.donor.short_name || p.donor.name) + '</span>' : '')
      +   '<span class="muted">' + p.kpiCount + ' KPIs · ' + p.actCount + ' activities</span>'
      + '</div>'
      + progressLine(p.progress, p.status)
      + '</div>';
  }
  function stripCountry(name, co) {
    if (!name || !co || !co.name) return name;
    var esc2 = co.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return name.replace(new RegExp('\\s*[\\u2012-\\u2015-]\\s*' + esc2 + '\\s*$', 'i'), '');
  }
  function viewProjects() {
    var list = filteredProjects();
    var per = 20, pages = Math.max(1, Math.ceil(list.length / per));
    if (S.proj.page > pages) S.proj.page = pages;
    var slice = list.slice((S.proj.page - 1) * per, S.proj.page * per);
    var cards = slice.map(projCard).join('') || '<div class="empty">No projects match your filters.</div>';
    var pager = pages > 1 ? '<div class="pager">'
      + '<button id="pgPrev"' + (S.proj.page <= 1 ? ' disabled' : '') + '>‹ Prev</button>'
      + '<span>' + S.proj.page + ' / ' + pages + '</span>'
      + '<button id="pgNext"' + (S.proj.page >= pages ? ' disabled' : '') + '>Next ›</button></div>' : '';
    return projectFilters()
      + '<div class="count">' + list.length + ' project' + (list.length === 1 ? '' : 's') + '</div>'
      + '<div class="pcards">' + cards + '</div>' + pager;
  }
  function wireProjects() {
    var q = $('#pq');
    if (q) q.addEventListener('input', debounce(function () { S.proj.q = q.value; S.proj.page = 1; softRerender(viewProjects, wireProjects, true); }, 180));
    var rg = $('#pRegion'); if (rg) rg.addEventListener('change', function () { S.proj.region = rg.value; S.proj.page = 1; softRerender(viewProjects, wireProjects); });
    var st = $('#pStatus'); if (st) st.addEventListener('change', function () { S.proj.status = st.value; S.proj.page = 1; softRerender(viewProjects, wireProjects); });
    var pv = $('#pgPrev'); if (pv) pv.addEventListener('click', function () { S.proj.page--; softRerender(viewProjects, wireProjects); $('#screen').scrollTop = 0; });
    var nx = $('#pgNext'); if (nx) nx.addEventListener('click', function () { S.proj.page++; softRerender(viewProjects, wireProjects); $('#screen').scrollTop = 0; });
  }
  // re-render only the screen content without touching scroll (keeps input focus when keepFocus)
  function softRerender(viewFn, wireFn, keepFocus) {
    var scr = $('#screen'); var top = scr.scrollTop;
    var active = keepFocus && document.activeElement && document.activeElement.id;
    var selStart = keepFocus && document.activeElement ? document.activeElement.selectionStart : null;
    scr.innerHTML = viewFn(); if (wireFn) wireFn();
    $$('[data-proj]', scr).forEach(function (n) { n.addEventListener('click', function () { openProject(+n.getAttribute('data-proj')); }); });
    $$('[data-kpi]', scr).forEach(function (n) { n.addEventListener('click', function () { openKpi(+n.getAttribute('data-kpi')); }); });
    scr.scrollTop = top;
    if (active) { var e = document.getElementById(active); if (e) { e.focus(); if (selStart != null && e.setSelectionRange) try { e.setSelectionRange(selStart, selStart); } catch (x) {} } }
  }

  /* ------------------------------------------------------------ ACTIVITY */
  function actRow(a) {
    var m = a.m;
    var place = m.place_name ? esc(m.place_name) : (a.proj && a.proj.country ? esc(a.proj.country.name) : '');
    var rep = a.reporter ? esc(a.reporter.name) : 'Field team';
    var val = a.ind.unit === 'percent' ? (Math.round(m.value * 10) / 10 + '%') : compact(m.value);
    return '<div class="arow" data-kpi="' + a.ind.id + '">'
      + '<span class="abadge" style="background:' + statusColor(a.ind.status) + '22;color:' + statusColor(a.ind.status) + '">' + esc(val) + '</span>'
      + '<div class="arow-main">'
      +   '<div class="arow-t">' + esc(a.ind.name) + '</div>'
      +   '<div class="arow-s">' + rep + (place ? ' · ' + place : '') + '</div>'
      + '</div>'
      + '<div class="arow-end"><span class="arow-ago">' + ago(a.dateMs) + '</span>' + dot(a.ind.status) + '</div>'
      + '</div>';
  }
  function viewActivity() {
    var slice = ACTS.slice(0, S.act.n);
    var more = ACTS.length > S.act.n;
    // group by day
    var out = '', lastKey = '';
    slice.forEach(function (a) {
      var d = new Date(a.dateMs);
      var key = a.m.date ? a.m.date.slice(0, 10) : '';
      if (key !== lastKey) { out += '<div class="daydiv">' + fmtDate(a.m.date) + '</div>'; lastKey = key; }
      out += actRow(a);
    });
    return '<div class="count">' + compact(ACTS.length) + ' activities logged</div>'
      + '<div class="card list flush">' + (out || '<div class="empty">No activity yet.</div>') + '</div>'
      + (more ? '<button class="btn ghost block" id="moreAct">Load more</button>' : '<div class="foot">— end of feed —</div>');
  }
  function wireActivity() {
    var b = $('#moreAct'); if (b) b.addEventListener('click', function () { S.act.n += 60; softRerender(viewActivity, wireActivity); });
  }

  /* ------------------------------------------------------------ INSIGHTS */
  function groupAgg(keyFn) {
    var g = {};
    INDS.forEach(function (r) {
      if (r.ratio == null) return; var k = keyFn(r); if (k == null) return;
      var a = g[k] = g[k] || { ratios: [], dist: {} };
      a.ratios.push(r.ratio); a.dist[r.status] = (a.dist[r.status] || 0) + 1;
    });
    return g;
  }
  function insightBlock(title, rows) {
    return '<div class="sec-h">' + esc(title) + '</div><div class="card list">' + (rows || '<div class="empty">No data.</div>') + '</div>';
  }
  function viewInsights() {
    var d = STAT.dist;
    // by region
    var byRegion = groupAgg(function (r) { return r.region; });
    var rrows = Object.keys(byRegion).sort(function (a, b) { return avg(byRegion[b].ratios) - avg(byRegion[a].ratios); }).map(function (k) {
      var a = byRegion[k], ratio = avg(a.ratios);
      return '<div class="row"><span class="imp-swatch" style="background:' + (REGION_COLOR[k] || '#888') + '"></span>'
        + '<div class="row-main"><div class="row-t">' + esc(k) + '</div><div class="row-s">' + a.ratios.length + ' KPIs · performance mix</div>' + stackBar(a.dist) + '</div>'
        + '<div class="row-end">' + pill(ratioToCode(ratio)) + '</div></div>';
    }).join('');
    // by impact — performance breakdown (status distribution), not a progress bar
    var irows = PILLARS.map(function (im) {
      return '<div class="row"><span class="imp-swatch" style="background:' + im.color + '"></span>'
        + '<div class="row-main"><div class="row-t">' + esc(im.name) + '</div><div class="row-s">' + im.n + ' KPIs · performance mix</div>' + stackBar(im.dist) + '</div>'
        + '<div class="row-end">' + pill(im.status) + '</div></div>';
    }).join('');
    // top & bottom projects, ranked by performance; bar shows their PROGRESS
    var ranked = PROJECTS.filter(function (p) { return p.ratio != null; });
    var top = ranked.slice().sort(function (a, b) { return b.ratio - a.ratio; }).slice(0, 5);
    var bottom = ranked.slice().sort(function (a, b) { return a.ratio - b.ratio; }).slice(0, 5);
    function prow(p) {
      return '<div class="row" data-proj="' + p.id + '"><div class="row-main"><div class="row-t">' + esc(stripCountry(p.name, p.country)) + '</div>'
        + '<div class="row-s">' + esc(p.country ? p.country.name : '') + '</div>' + progressLine(p.progress, p.status) + '</div>'
        + '<div class="row-end">' + pill(p.status) + '</div></div>';
    }
    var legend = STATUS_ORDER.filter(function (k) { return d[k]; }).map(function (k) {
      return '<span class="lg"><i style="background:' + statusColor(k) + '"></i>' + statusLabel(k) + ' <b>' + d[k] + '</b></span>';
    }).join('');

    return '<div class="card perf">'
      + '<div class="perf-ring">' + donut(d) + '<div class="perf-center"><b style="color:' + statusColor(STAT.meanCode) + '">' + pct(STAT.meanRatio) + '</b><span>performance</span></div></div>'
      + '<div class="perf-side"><div class="perf-h">' + fmtInt(STAT.kpis) + ' KPIs</div><div class="perf-lead">across ' + STAT.projects + ' projects</div><div class="legend">' + legend + '</div></div>'
      + '</div>'
      + insightBlock('Performance by impact', irows)
      + insightBlock('Performance by region', rrows)
      + insightBlock('Top performing projects', top.map(prow).join(''))
      + insightBlock('Needs attention', bottom.map(prow).join(''));
  }

  /* ------------------------------------------------------------- PROFILE */
  function viewProfile() {
    var u = S.user || {};
    var aff = u.affiliation_id != null && IDX.lookup.affiliation ? IDX.lookup.affiliation[u.affiliation_id] : null;
    var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    return '<div class="prof-card">'
      + '<div class="prof-av">' + esc(initials(u.name)) + '</div>'
      + '<div class="prof-n">' + esc(u.name || '—') + '</div>'
      + '<div class="prof-e">' + esc(u.email || u.username || '') + '</div>'
      + (aff ? '<span class="prof-badge">' + esc(aff.name) + ' Lead</span>' : '')
      + '</div>'
      + '<div class="sec-h">Development plan</div>'
      + '<div class="card list">'
      +   '<button class="setrow" id="setPlan"><span class="setk">Active plan</span><span class="setv">' + esc(activePlan() ? activePlan().name : '—') + ' ▸</span></button>'
      + '</div>'
      + '<div class="sec-h">Preferences</div>'
      + '<div class="card list">'
      +   '<button class="setrow" id="setTheme"><span class="setk">Appearance</span><span class="setv">' + (isDark ? 'Dark' : 'Light') + ' ▸</span></button>'
      +   '<button class="setrow" id="setAbout"><span class="setk">About The Grassroots</span><span class="setv">▸</span></button>'
      + '</div>'
      + '<button class="btn danger block" id="signOut">Sign out</button>'
      + '<div class="foot">The Grassroots · v<span id="verNum2"></span> · Mobile</div>';
  }
  function wireProfile() {
    $('#setPlan').addEventListener('click', openPlanSheet);
    $('#setAbout').addEventListener('click', openAbout);
    $('#setTheme').addEventListener('click', function () { toggleTheme(); softRerender(viewProfile, wireProfile); });
    $('#signOut').addEventListener('click', signOut);
    setVer();
  }

  /* ============================================================ SHEETS ===== */
  function openSheet(title, html) {
    $('#sheetTitle').innerHTML = title;
    $('#sheetBody').innerHTML = html;
    $('#scrim').hidden = false; var s = $('#sheet'); s.hidden = false;
    requestAnimationFrame(function () { $('#scrim').classList.add('show'); s.classList.add('show'); });
    $('#sheetBody').scrollTop = 0;
  }
  function closeSheet() {
    var s = $('#sheet'); s.classList.remove('show'); $('#scrim').classList.remove('show');
    setTimeout(function () { s.hidden = true; $('#scrim').hidden = true; $('#sheetBody').innerHTML = ''; }, 240);
  }

  function openPlanSheet() {
    var rows = allPlans().map(function (p) {
      var on = p.id === S.plan;
      return '<button class="planrow' + (on ? ' on' : '') + '" data-plan="' + p.id + '">'
        + '<div><div class="planrow-n">' + esc(p.name) + '</div><div class="planrow-s">' + fmtDate(p.start_date) + ' → ' + fmtDate(p.end_date) + '</div></div>'
        + (on ? '<span class="planrow-ck">✓</span>' : '') + '</button>';
    }).join('');
    openSheet('Development plan', rows);
    $$('[data-plan]', $('#sheetBody')).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = +b.getAttribute('data-plan');
        if (id !== S.plan) { S.plan = id; enrich(); S.proj.page = 1; }
        setPlanName(); closeSheet(); render();
      });
    });
  }

  function openProject(id) {
    var p = PROJBYID[id]; if (!p) return;
    var primary = p.inds.filter(function (i) { return !i.secondary; });
    var secondary = p.inds.filter(function (i) { return i.secondary; });
    function krow(i) {
      return '<div class="krow" data-kpi="' + i.id + '">'
        + '<div class="krow-main"><div class="krow-t">' + esc(i.name) + '</div>'
        + '<div class="krow-s">' + esc(i.code || '') + ' · ' + (i.value == null ? 'no report' : compact(i.value) + ' / ' + compact(i.target)) + '</div>'
        + progressLine(i.progress, i.status) + '</div>'
        + '<div class="row-end">' + pill(i.status) + '</div></div>';
    }
    var head = '<div class="sheet-hero">'
      + '<div class="sheet-hero-top">' + pill(p.status) + '<span class="muted">' + esc(p.code || '') + '</span></div>'
      + '<div class="sheet-hero-t">' + esc(stripCountry(p.name, p.country)) + '</div>'
      + '<div class="sheet-hero-meta">'
      +   '<span class="flagchip">' + esc(p.country ? p.country.name : p.iso) + '</span>'
      +   (p.donor ? '<span class="dchip" style="--dc:' + (p.donor.color || '#888') + '">' + esc(p.donor.name) + '</span>' : '')
      + '</div></div>'
      + '<div class="minitiles">'
      +   '<div class="mt"><b style="color:' + statusColor(p.status) + '">' + pct(p.ratio) + '</b><span>Performance now</span></div>'
      +   '<div class="mt"><b>' + pct(p.progress) + '</b><span>Progress</span></div>'
      +   '<div class="mt"><b>' + money(p.budget) + '</b><span>Budget</span></div>'
      +   '<div class="mt"><b>' + p.actCount + '</b><span>Activities</span></div>'
      + '</div>';
    if (p.desc) head += '<p class="sheet-desc">' + esc(p.desc) + '</p>';
    if (p.partner) head += '<div class="sheet-line"><span class="setk">Implementing partner</span><span class="setv">' + esc(p.partner.name) + '</span></div>';
    head += '<div class="sheet-line"><span class="setk">Timeframe</span><span class="setv">' + fmtDate(p.start) + ' → ' + fmtDate(p.end) + '</span></div>';

    var body = head
      + '<div class="sec-h">Primary KPIs <span>' + primary.length + '</span></div>'
      + '<div class="card list flush">' + (primary.map(krow).join('') || '<div class="empty">None.</div>') + '</div>'
      + (secondary.length ? '<div class="sec-h">Secondary KPIs <span>' + secondary.length + '</span></div><div class="card list flush">' + secondary.map(krow).join('') + '</div>' : '');
    openSheet('Project', body);
    $$('[data-kpi]', $('#sheetBody')).forEach(function (n) { n.addEventListener('click', function () { openKpi(+n.getAttribute('data-kpi')); }); });
  }

  function openKpi(id) {
    var i = INDBYID[id]; if (!i) return;
    var series = (i.series || []).slice().reverse();   // newest first
    var spark = sparkline(i);
    var chain = i.result ? resultChain(i.result).reverse() : [];
    var chainHtml = chain.map(function (n) { return '<span class="chip">' + esc(cap(n.level)) + '</span>'; }).join('<span class="chsep">›</span>');
    var meas = series.slice(0, 24).map(function (m) {
      var rep = m.reported_by_id != null && IDX.userById[m.reported_by_id] ? IDX.userById[m.reported_by_id].name : 'Field team';
      var val = i.unit === 'percent' ? (Math.round(m.value * 10) / 10 + '%') : compact(m.value);
      return '<div class="mrow"><div class="mrow-l"><b>' + esc(val) + '</b><span>' + fmtDate(m.date) + '</span></div>'
        + '<div class="mrow-r">' + esc(rep) + (m.place_name ? ' · ' + esc(m.place_name) : '') + '</div></div>';
    }).join('') || '<div class="empty">No measurements yet.</div>';

    var body = '<div class="sheet-hero">'
      + '<div class="sheet-hero-top">' + pill(i.status) + '<span class="muted">' + esc(i.code || '') + '</span></div>'
      + '<div class="sheet-hero-t">' + esc(i.name) + '</div>'
      + (chainHtml ? '<div class="chainrow">' + chainHtml + '</div>' : '')
      + '</div>'
      + '<div class="minitiles">'
      +   '<div class="mt"><b>' + (i.value == null ? '–' : compact(i.value)) + '</b><span>Current</span></div>'
      +   '<div class="mt"><b>' + compact(i.target) + '</b><span>Target</span></div>'
      +   '<div class="mt"><b>' + compact(i.baseline) + '</b><span>Baseline</span></div>'
      +   '<div class="mt"><b style="color:' + statusColor(i.status) + '">' + pct(i.ratio) + '</b><span>Performance now</span></div>'
      + '</div>'
      + '<div class="card padrow">' + progressLine(i.progress, i.status) + '</div>'
      + spark
      + '<div class="sec-h">Measurements <span>' + (i.series || []).length + '</span></div>'
      + '<div class="card list flush">' + meas + '</div>';
    openSheet('Indicator', body);
  }
  function cap(s) { return String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1); }

  function sparkline(i) {
    var ms = (i.series || []); if (ms.length < 2) return '';
    var W = 300, H = 64, padX = 6, padY = 8;
    // For count KPIs the plotted value is the running cumulative total (matches the
    // "Current" figure); for others it's the reported value.
    var isCount = i.unit === 'count', base = +i.baseline || 0, run = base;
    var pts = ms.map(function (m) {
      var y = isCount ? (run += (+m.value || 0)) : (+m.value);
      return { x: Date.parse(m.date), y: y };
    });
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    // Scale Y to the DATA (plus baseline) so the trend is legible even when the
    // target is orders of magnitude larger. Draw the target reference line only
    // when it sits close to the data; otherwise the mini-tile already shows it.
    var dMin = Math.min.apply(null, ys.concat([base])), dMax = Math.max.apply(null, ys);
    var target = +i.target;
    var showTarget = isFinite(target) && target <= dMax * 1.35 && target >= dMin;
    var minY = dMin, maxY = showTarget ? Math.max(dMax, target) : dMax;
    var spanPad = (maxY - minY) * 0.12 || 1; minY -= spanPad; maxY += spanPad;
    if (maxX === minX) maxX = minX + 1; if (maxY === minY) maxY = minY + 1;
    function X(v) { return padX + (v - minX) / (maxX - minX) * (W - 2 * padX); }
    function Y(v) { return H - padY - (v - minY) / (maxY - minY) * (H - 2 * padY); }
    var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + X(p.x).toFixed(1) + ' ' + Y(p.y).toFixed(1); }).join(' ');
    var area = d + ' L' + X(maxX).toFixed(1) + ' ' + (H - padY) + ' L' + X(minX).toFixed(1) + ' ' + (H - padY) + ' Z';
    var col = statusColor(i.status);
    var tLine = showTarget ? '<line x1="0" y1="' + Y(target).toFixed(1) + '" x2="' + W + '" y2="' + Y(target).toFixed(1) + '" stroke="var(--ink-3)" stroke-opacity=".5" stroke-dasharray="3 4"/>' : '';
    var cap = showTarget ? 'Dashed line = target · ' : 'Trend since baseline · ';
    return '<div class="card spark"><svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + tLine
      + '<path d="' + area + '" fill="' + col + '18"/>'
      + '<path d="' + d + '" fill="none" stroke="' + col + '" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>'
      + '<circle cx="' + X(pts[pts.length - 1].x).toFixed(1) + '" cy="' + Y(pts[pts.length - 1].y).toFixed(1) + '" r="3.4" fill="' + col + '"/>'
      + '</svg><div class="spark-cap">' + cap + 'newest ' + fmtDate(ms[ms.length - 1].date) + '</div></div>';
  }

  function openAbout() {
    var body = '<div class="about-hero">'
      + '<svg class="about-ic" viewBox="0 0 512 512"><circle cx="256" cy="256" r="178" fill="none" stroke="#0C85C7" stroke-width="36"/><circle cx="382" cy="130" r="58" fill="#0C85C7"/><circle cx="256" cy="256" r="34" fill="#0C85C7" opacity=".55"/></svg>'
      + '</div>'
      + '<p class="about-p"><b>The Grassroots</b> shows whether development work is actually making a difference. Across a portfolio of country programmes it brings the whole picture into one view, aligned to the Sustainable Development Goals.</p>'
      + '<p class="about-p">Everything hangs on one results chain: <b>Plan → Impact → Outcome → Output → Activity</b>. Field teams log activities; every status, total and trend above them is derived, never retyped.</p>'
      + '<p class="about-p">For every KPI the platform reads the baseline, target and latest measurement, then derives <b>Progress</b> and <b>Performance</b> to produce the Red / Amber / Green rating on every card and roll-up.</p>'
      + '<div class="about-foot">Results-Based Monitoring &amp; Evaluation · v<span id="verNum3"></span><br>grassrootstrack@outlook.com</div>';
    openSheet('About', body);
    setVer();
  }

  /* ============================================================ auth ===== */
  var SESSION_KEY = 'gr_mobile_session';
  function signIn(username, password) {
    var u = IDX.userByUsername[String(username).trim().toLowerCase()];
    if (!u) return { ok: false, msg: 'No such user.' };
    if (u.enabled === 0) return { ok: false, msg: 'This account is disabled.' };
    if (String(u.password) !== String(password)) return { ok: false, msg: 'Incorrect password.' };
    S.user = u;
    try { localStorage.setItem(SESSION_KEY, u.username); } catch (e) {}
    return { ok: true };
  }
  function restoreSession() {
    var un = null; try { un = localStorage.getItem(SESSION_KEY); } catch (e) {}
    if (!un) return false;
    var u = IDX.userByUsername[String(un).toLowerCase()];
    if (u && u.enabled !== 0) { S.user = u; return true; }
    return false;
  }
  function signOut() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    S.user = null; showLogin();
  }

  /* ============================================================ chrome ===== */
  function setPlanName() { $('#abPlanName').textContent = activePlan() ? activePlan().name.replace(/^Development Plan\s*/i, 'Plan ') : '—'; }
  function setAvatar() { $('#abAvatar').textContent = initials(S.user ? S.user.name : '?'); }
  function setVer() {
    var v = window.SEED_STAMP ? '' : '';
    // version derived same way as desktop: base-100 working-day count from 2026-07-16
    var epoch = Date.UTC(2026, 6, 16), now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()), n = 0;
    for (var t = epoch; t <= today; t += 86400000) { var dow = new Date(t).getUTCDay(); if (dow >= 1 && dow <= 5) n++; }
    if (n < 1) n = 1;
    var ver = Math.floor(n / 10000) + '.' + (Math.floor(n / 100) % 100) + '.' + (n % 100);
    $$('#verNum, #verNum2, #verNum3').forEach(function (e) { e.textContent = ver; });
  }
  function toggleTheme() {
    var root = document.documentElement;
    var dark = root.getAttribute('data-theme') === 'dark';
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('gr_mobile_theme', dark ? 'light' : 'dark'); } catch (e) {}
  }
  function initTheme() {
    var t = null; try { t = localStorage.getItem('gr_mobile_theme'); } catch (e) {}
    if (!t) t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', t);
  }
  window.__go = function (v) { navTo(v); };
  function navTo(v) {
    S.view = v;
    $$('.tab').forEach(function (t) { t.classList.toggle('on', t.getAttribute('data-view') === v); });
    render();
  }

  function showLogin() {
    $('#boot').hidden = true; $('#app').hidden = true; $('#login').hidden = false;
    setTimeout(function () { var u = $('#lgUser'); if (u && !u.value) u.focus(); }, 60);
  }
  function showApp() {
    $('#boot').hidden = true; $('#login').hidden = true; $('#app').hidden = false;
    setPlanName(); setAvatar(); setVer(); navTo('home');
  }

  function debounce(fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; }

  /* ============================================================ wiring ===== */
  function wireChrome() {
    $('#tabbar').addEventListener('click', function (e) {
      var b = e.target.closest('.tab'); if (b) navTo(b.getAttribute('data-view'));
    });
    $('#abPlan').addEventListener('click', openPlanSheet);
    $('#abUser').addEventListener('click', function () { navTo('profile'); });
    $('#abBrand').addEventListener('click', openAbout);
    $('#sheetX').addEventListener('click', closeSheet);
    $('#scrim').addEventListener('click', closeSheet);
    $('#loginForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var r = signIn($('#lgUser').value, $('#lgPass').value);
      if (!r.ok) { $('#lgMsg').textContent = r.msg; $('#lgMsg').classList.add('show'); return; }
      $('#lgMsg').textContent = ''; $('#lgPass').value = '';
      enrich(); showApp();
    });
    // swipe-down to dismiss the sheet
    var sy0 = null, sh = $('#sheet');
    sh.addEventListener('touchstart', function (e) { if ($('#sheetBody').scrollTop <= 0) sy0 = e.touches[0].clientY; else sy0 = null; }, { passive: true });
    sh.addEventListener('touchmove', function (e) { if (sy0 == null) return; var dy = e.touches[0].clientY - sy0; if (dy > 0) sh.style.transform = 'translateY(' + dy + 'px)'; }, { passive: true });
    sh.addEventListener('touchend', function () { if (sy0 == null) return; var m = /translateY\(([\d.]+)px\)/.exec(sh.style.transform); sh.style.transform = ''; if (m && +m[1] > 90) closeSheet(); sy0 = null; });
  }

  /* ============================================================== boot ===== */
  function boot() {
    initTheme();
    wireChrome();
    var msg = $('#bootMsg');
    if (!window.DB) { msg.textContent = 'Data layer failed to load.'; return; }
    DB.init().then(function () {
      IDX = DB._idx; TODAY = deriveToday();
      S.plan = currentPlanId();
      if (restoreSession()) { enrich(); showApp(); }
      else showLogin();
      registerSW();
    }).catch(function (err) {
      msg.textContent = 'Could not open the database.';
      // last-ditch: try the in-memory copy
      try { IDX = DB._idx; if (IDX && IDX.userByUsername) { if (restoreSession()) { enrich(); showApp(); } else showLogin(); } } catch (e) {}
    });
  }
  function registerSW() {
    if ('serviceWorker' in navigator) {
      try { navigator.serviceWorker.register('sw.js'); } catch (e) {}
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
