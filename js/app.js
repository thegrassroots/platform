/* =============================================================================
 * app.js - RBM / M&E Monitor UI (zero dependencies, vanilla JS).
 * ========================================================================== */
(function () {
  'use strict';

  // ---- constants -----------------------------------------------------------
  // Single source of truth for the app version. Semantic versioning; bump the
  // patch (or minor) on each change. Stays below 1.0.0 until sign-off - do not
  // release 1.0.0 without explicit approval.
  var APP_VERSION = '0.3.0';
  var TODAY = new Date('2026-07-13');
  // The `sdg` field on results is REPURPOSED to hold the Pillar id (1-4), scoped
  // PER PLAN (each plan numbers its pillars 1-4). These tables therefore key on
  // pillar id and are REBUILT from the ACTIVE plan's impact rows on every enrich()
  // (see hydratePillars), keeping the existing colour/facet plumbing intact while
  // the platform speaks in "Pillars"/"Impacts" per the plan currently in view.
  // Lighter, clear identity hues (avoid dim/dark colours across the system).
  var BASE_PILLAR_COLORS = {1:'#4FA9E8', 2:'#33C2B4', 3:'#9D7BEE', 4:'#F5A04D'};
  var PILLAR_COLORS = {};
  var PILLAR_NAMES = {};
  // Top-level results grouping. Historically called "Pillar"; the platform now
  // presents it as "Impact" (each carries an impact statement as its description).
  function pillarLabel(n){ return n ? ('Impact ' + n) : 'Unaligned'; }
  var NEW_PILLAR_PALETTE = ['#EC7BA6','#5399EA','#2CC4A0','#F2934A','#A97FDD','#E0A93B','#4FA9E8','#33C2B4','#EA8A5B','#6FBF73'];
  // Rebuild the pillar name/colour lookups from the ACTIVE plan's impact rows.
  // Every impact carries pillar_name / pillar_color, so each plan owns its own
  // set of pillars (colours default to the base palette when a row lacks one).
  function hydratePillars(){
    PILLAR_COLORS = {}; PILLAR_NAMES = {};
    Object.keys(BASE_PILLAR_COLORS).forEach(function (k){ PILLAR_COLORS[k] = BASE_PILLAR_COLORS[k]; });
    DB.tables.result.forEach(function (r){
      if (r.level === 'impact' && r.plan_id === S.plan && r.sdg != null){
        if (r.pillar_name) PILLAR_NAMES[r.sdg] = r.pillar_name;
        if (r.pillar_color) PILLAR_COLORS[r.sdg] = r.pillar_color;
      }
    });
  }
  // ---- Plans - the top of the results chain (Plan > Impact > Outcome > Output) ----
  // One plan is "active" at a time (S.plan); the whole app (map, facets, list,
  // insights, framework editor) is scoped to it. Universal data - countries,
  // regions, users, donors, beneficiary types - is shared across every plan.
  function allPlans(){
    return (DB.tables.plan || []).slice().sort(function (a, b){
      return ((a.seq == null ? a.id : a.seq) - (b.seq == null ? b.id : b.seq)); });
  }
  function planById(id){ return (DB._idx.planById && id != null) ? DB._idx.planById[id] : null; }
  function activePlan(){ return planById(S.plan); }
  /** Plans ordered newest first (by start date desc, then id desc) for the pickers. */
  function plansNewestFirst(){
    return allPlans().sort(function (a, b){
      var da = a.start_date ? Date.parse(a.start_date) : -Infinity;
      var db = b.start_date ? Date.parse(b.start_date) : -Infinity;
      return db - da || b.id - a.id;
    });
  }
  /** The plan whose window contains TODAY, else the latest by end date, else first. */
  function currentPlanId(){
    var plans = allPlans(); if (!plans.length) return null;
    var t = TODAY.getTime();
    for (var i = 0; i < plans.length; i++){
      var s = plans[i].start_date ? Date.parse(plans[i].start_date) : null;
      var e = plans[i].end_date ? Date.parse(plans[i].end_date) : null;
      if (s != null && e != null && t >= s && t <= e) return plans[i].id;
    }
    var latest = plans.slice().sort(function (a, b){ return (Date.parse(b.end_date || 0) || 0) - (Date.parse(a.end_date || 0) || 0); })[0];
    return latest ? latest.id : plans[0].id;
  }
  /** The DEFAULT plan the app opens on: the one flagged is_default, else the
   *  current-by-date plan. Exactly one plan should carry the flag. */
  function defaultPlanId(){
    var flagged = allPlans().filter(function (p){ return p.is_default; })[0];
    return flagged ? flagged.id : currentPlanId();
  }
  /** Ensure S.plan points at a real plan (falls back to the default plan). */
  function resolvePlan(){
    var plans = allPlans();
    if (!plans.length){ S.plan = null; return; }
    if (!(S.plan != null && plans.some(function (p){ return p.id === S.plan; }))) S.plan = defaultPlanId();
  }
  /** The plan a raw indicator row belongs to (via its result, or its project). */
  function indicatorPlanId(ind){
    if (ind.result_id != null){ var r = DB._idx.resultById[ind.result_id]; return r ? r.plan_id : null; }
    if (ind.project_id != null){ var p = DB._idx.projectById[ind.project_id]; return p ? p.plan_id : null; }
    return null;
  }
  var STATUS = {
    blue:{c:'#2563eb', label:'Over Track'},
    green:{c:'#16a34a', label:'On Track'},
    amber:{c:'#f59e0b', label:'At Risk'},
    red:{c:'#ef4444', label:'Off Track'},
    maroon:{c:'#9f1239', label:'Under Track'},
    nodata:{c:'#94a3b8', label:'No Data'}
  };
  var LEVELS = {impact:0, outcome:1, output:2, activity:3};

  // ---- Regions + colour identity -------------------------------------------
  // Every filter group carries a visual identity colour; child items get a
  // gradual spectrum (shades) of the parent's colour.
  // Regions are the six geographic continents (UN M49 continental grouping), with
  // the Americas split into North and South. Each carries an identity colour.
  var REGION_ORDER = ['Africa','Asia','Europe','North America','South America','Oceania'];
  var REGION_META = {
    'Africa':        { color:'#F2934A' },
    'Asia':          { color:'#5399EA' },
    'Europe':        { color:'#A97FDD' },
    'North America': { color:'#EC7BA6' },
    'South America': { color:'#2CC4A0' },
    'Oceania':       { color:'#6FBF73' }
  };
  function regionColor(region){ return (REGION_META[region] || {}).color || '#94a3b8'; }
  function regionShort(region){ return region || ''; }
  /** Region display name (the continent). */
  function regionFull(region){ return region || ''; }

  // ---- colour maths (HSL shade helpers) ------------------------------------
  function hexToRgb(h){ h = String(h).replace('#',''); if (h.length===3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)]; }
  function rgbToHex(r,g,b){ function c(x){ x = Math.round(Math.max(0,Math.min(255,x))); return (x<16?'0':'')+x.toString(16); } return '#'+c(r)+c(g)+c(b); }
  function rgbToHsl(r,g,b){ r/=255;g/=255;b/=255; var mx=Math.max(r,g,b),mn=Math.min(r,g,b),h,s,l=(mx+mn)/2;
    if(mx===mn){h=s=0;} else { var d=mx-mn; s=l>0.5?d/(2-mx-mn):d/(mx+mn);
      h = mx===r ? (g-b)/d+(g<b?6:0) : mx===g ? (b-r)/d+2 : (r-g)/d+4; h/=6; } return [h,s,l]; }
  function hslToRgb(h,s,l){ var r,g,b; if(s===0){r=g=b=l;} else {
    function hue(p,q,t){ if(t<0)t+=1; if(t>1)t-=1; if(t<1/6)return p+(q-p)*6*t; if(t<1/2)return q; if(t<2/3)return p+(q-p)*(2/3-t)*6; return p; }
    var q=l<0.5?l*(1+s):l+s-l*s, p=2*l-q; r=hue(p,q,h+1/3); g=hue(p,q,h); b=hue(p,q,h-1/3); }
    return [r*255,g*255,b*255]; }
  /** Lighten (t>0) or darken (t<0) a hex colour by fraction t in [-1,1]. */
  function shade(hex, t){ var c=rgbToHsl.apply(null, hexToRgb(hex)); var l=c[2];
    l = t>=0 ? l + (1-l)*t : l*(1+t); var rgb=hslToRgb(c[0], c[1]*(1-0.15*Math.abs(t)), Math.max(0,Math.min(1,l)));
    return rgbToHex(rgb[0],rgb[1],rgb[2]); }
  function hashKey(s){ var h=0; s=String(s); for(var i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return h; }
  /** Deterministic shade of a base colour keyed by an arbitrary string. */
  function shadeByKey(base, key, spread){ spread = spread==null?0.34:spread;
    var t = ((hashKey(key)%1000)/1000)*2-1; return shade(base, t*spread); }
  // per-country shade of its region colour (spread across region membership)
  var _countryShade = null;
  function countryColor(iso){
    if (!_countryShade){
      _countryShade = {};
      var byReg = {};
      DB.tables.country.forEach(function(c){ (byReg[c.region]=byReg[c.region]||[]).push(c.iso3); });
      Object.keys(byReg).forEach(function(rg){
        var list = byReg[rg].slice().sort(); var n = list.length;
        list.forEach(function(iso3, i){
          var t = n<=1 ? 0 : (i/(n-1))*2-1;   // -1..1 across the region
          _countryShade[iso3] = shade(regionColor(rg), t*0.42);
        });
      });
    }
    return _countryShade[iso] || '#94a3b8';
  }
  // People carry two orthogonal fields: a Section (where they sit: the central
  // Section or a Country Office) and a Status (their permission:
  // Admin / User / Viewer). Legacy rows only had `role`; fall back from it.
  var SECTION_LABEL = { hq:'Section', co:'Country Office' };
  var STATUS_LABEL  = { admin:'Admin', user:'User', viewer:'Viewer' };
  function userSection(u){ return u ? (u.section || 'hq') : null; }
  function userStatus(u){ return u ? (u.status || 'user') : null; }
  // colour identity for a user row (Admin has its own accent; a country office inherits its
  // country/region colour; the central Section otherwise)
  function userColor(u){
    if (!u) return '#aab6c8';
    if (userStatus(u) === 'admin') return '#5B8DEF';
    if (userSection(u) === 'hq') return '#9D7BEE';
    return u.country_iso3 ? countryColor(u.country_iso3) : regionColor(u.region);
  }
  // People are stored by id everywhere; look their name up for display only.
  function userById(id){ return id != null ? DB._idx.userById[id] : null; }
  function userName(id){ var u = userById(id); return u ? u.name : '–'; }
  var PAGE = 50;
  var VB = {W:1000, H:1000};   // Web-Mercator world is square (1000×1000 viewBox units)
  var PANE_PCT = 0.21;   // default pane width = 21% of the screen width
  function defPaneW(){ return Math.round((window.innerWidth || 1200) * PANE_PCT); }

  // ---- derived caches ------------------------------------------------------
  var IND = [];          // enriched indicator records
  var INDBYID = {};      // indicator id -> enriched record (O(1) lookup)
  var ACTS = [];         // enriched ACTIVITIES (one per measurement) for activity-basis counts
  var ACTBYMEAS = {};    // measurement id -> its ACTS twin (measurement-level filtering)
  var PROJECTS = [];     // enriched project records (with rolled-up KPI status)
  var PROJECTSBYID = {}; // project id -> enriched record
  function indById(id){ return INDBYID[id] || null; }
  function projById(id){ return PROJECTSBYID[id] || null; }
  var FRAMEWORK = [];    // waterfall tree: impacts → outcomes → outputs (deduped by statement)
  var SEP = '~|~';       // key separator: "level~|~statement"
  var STATUS_BY_RESULT = {};   // result.id -> rolled-up {code,frac,perf} (Output/Outcome/Pillar)
  var CURRENT_USER = null;     // the logged-in user (reports are attributed to them)
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var el = function (tag, cls, txt) { var e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  // Coalesce bursts of calls (e.g. per-keystroke re-renders) into one trailing
  // call, so typing in a search box doesn't re-cluster the map / rebuild a facet
  // on every character. The <input> shows characters natively regardless.
  function debounce(fn, ms) {
    var t; ms = ms == null ? 140 : ms;
    return function () { var self = this, args = arguments; clearTimeout(t); t = setTimeout(function () { fn.apply(self, args); }, ms); };
  }

  // ---- global UI state -----------------------------------------------------
  var S = {
    tab: 'map',
    plan: null,             // active plan id (top of the results chain); resolved on boot
    range: 'all',
    from: null, to: null,
    selProg: new Set(),     // programme ids
    selRegion: new Set(),   // region names (whole-continent category filter)
    selNodes: new Set(),    // results-framework selections: "levelstatement"
    selSdg: new Set(),      // sdg numbers
    selKpi: new Set(),      // KPI Inventory selections: KPI names
    kpiShown: 10,           // how many KPIs the inventory filter reveals (More/Less)
    userShown: {},          // per-section reveal count for the Reported-By filter (More/Less)
    selUser: new Set(),     // Reported-By selections: user ids
    selStatus: new Set(),   // performance status: blue|green|amber|red|maroon|nodata
    selType: new Set(),     // KPI type: quantitative|qualitative
    selDonor: new Set(),    // donor ids (project funding partner)
    selProject: new Set(),  // project ids (specific projects)
    selBenType: new Set(),  // beneficiary type ids (Project Beneficiaries filter)
    projectShown: 10,       // Projects filter reveal count (More/Less)
    donorShown: 10,         // Donors filter reveal count (More/Less)
    progShown: {},          // per-region reveal count for the Programme Portfolio country sublists
    selCountry: null,       // iso3 (map click)
    qList: '', qProg: '', qSdg: '', qKpi: '', qUser: '', qDonor: '', qProject: '',
    sort: 'name', sortDir: 'asc',
    listMode: 'projects',   // right pane: 'projects' | 'kpis'
    countBasis: 'projects', // facet/map counts: 'projects' (distinct projects) | 'activities' (measurements)
    kpiSort: 'name', kpiSortDir: 'asc',   // sort field/dir when the pane lists KPIs
    page: 0,
    colorMode: 'status',    // status | region | impact | donor | budget
    perfBasis: 'performance', // progress | performance - which metric drives the RAG status
    expandRegion: new Set(),
    expandSdg: new Set(),
    expandImpact: new Set(),
    expandOutcome: new Set(),
    expandKpiPillar: new Set(),
    expandUserRole: new Set(['hq']),
    // left-sidebar filter groups: display order + which are collapsed (drag-and-drop)
    facetOrder: null,        // array of group keys; null = use FACET_ORDER_DEFAULT
    facetCollapsed: {},      // { groupKey: true } for collapsed groups
    // insights dashboard config
    insX: 'sdg', insTopX: 5, insY: 'region', insTopY: 10, insMode: 'bar',
    // Insights measures whatever S.countBasis says (Projects | Activities) - no separate Value setting.
    // resizable pane widths (px); null = use default (15% of screen width)
    leftW: null, rightW: null,
    theme: 'light'
  };

  // =========================================================================
  //  STATUS ENGINE
  // =========================================================================
  // Reports are monthly transactions. Count/number KPIs ACCUMULATE (current value =
  // baseline + Σ increments); %/index/ratio KPIs take the LATEST reported level.
  function indicatorValue(ind, ms) {
    if (!ms.length) return null;
    if (ind.unit === 'count') {
      var sum = 0; ms.forEach(function (m) { sum += (+m.value || 0); });
      return (+ind.baseline_value || 0) + sum;
    }
    return ms[ms.length - 1].value;
  }
  // RAG thresholds on progress = (value − baseline) / (target − baseline), so 0% is the
  // baseline and 100% is the target. Below baseline (negative) is a regression.
  //   Over Track > 100% · On Track 75–100% · At Risk 50–74% · Off Track 0–49% ·
  //   Under Track < 0% (below baseline) · No Data (no report).
  function ratioToCode(ratio) {
    if (ratio == null) return 'nodata';
    if (ratio > 1) return 'blue';
    if (ratio < 0) return 'maroon';
    return ratio >= 0.75 ? 'green' : (ratio >= 0.50 ? 'amber' : 'red');
  }

  /** Fraction of the KPI's timeframe elapsed by `asOf` (default TODAY; day
   *  granularity, so the monthly reporting cadence is respected): from 1 Jan of the
   *  baseline year to 31 Dec of the target year. e.g. a 12-month KPI at end-June ≈ 0.5. */
  function elapsedFraction(ind, asOf) {
    var when = asOf != null ? new Date(asOf) : TODAY;
    // prefer the exact baseline/target dates; fall back to Jan 1 baseline year → 31 Dec target year
    var startY = ind.baseline_year || 2025, endY = ind.target_year || (startY + 2);
    var start = ind.baseline_date ? new Date(ind.baseline_date) : new Date(startY, 0, 1);
    var end = ind.target_date ? new Date(ind.target_date) : new Date(endY, 11, 31);
    if (!(end > start)) return 1;
    return Math.max(0.02, Math.min(1, (when - start) / (end - start)));
  }

  // Progress  = share of the baseline→target gap achieved so far (ignores time).
  // Performance = Progress ÷ time-elapsed  → are we where we should be *by now*?
  //   e.g. target 12 over 12 months, end-June (≈0.5 elapsed): 3 done → 25%/50% = 50%;
  //        6 done → 50%/50% = 100%.
  function computeStatus(ind) {
    var ms = DB.measurementsFor(ind.id);
    var latest = ms.length ? ms[ms.length - 1] : null;
    var b = ind.baseline_value, t = ind.target_value;
    if (!latest || t === b) return {
      progress: null, performance: null, progressCode: 'nodata', perfCode: 'nodata',
      code: 'nodata', frac: null, perf: null, latest: latest, series: ms };
    var v = indicatorValue(ind, ms);
    var progress = (v - b) / (t - b);                    // flat achievement of the gap
    var elapsed = elapsedFraction(ind);
    var performance = elapsed > 0 ? progress / elapsed : progress;  // vs. expected-by-now
    return {
      progress: progress, performance: performance,
      progressCode: ratioToCode(progress), perfCode: ratioToCode(performance),
      // legacy aliases (`code`/`frac`/`perf`) resolved to the active basis in applyBasis()
      code: ratioToCode(performance), frac: progress, perf: performance,
      value: v, latest: latest, series: ms };
  }

  function enrich() {
    resolvePlan();      // make sure S.plan points at a real plan
    hydratePillars();   // rebuild pillar name/colour lookup from the active plan
    var pById = DB._idx.programmeById, rById = DB._idx.resultById;
    // Everything downstream derives from IND / FRAMEWORK / PROJECTS, so scoping the
    // indicator universe to the active plan scopes the whole app to that plan.
    IND = DB.tables.indicator.filter(function (ind) { return indicatorPlanId(ind) === S.plan; }).map(function (ind) {
      var res = rById[ind.result_id];
      // Secondary (project-local) KPIs have no result parent - resolve their
      // country/programme through the project they belong to.
      var proj = ind.project_id != null ? DB._idx.projectById[ind.project_id] : null;
      var prog = res ? pById[res.programme_id] : (proj ? DB._idx.programmeByIso[proj.country_iso3] : null);
      var iso = prog ? prog.country_iso3 : (proj ? proj.country_iso3 : null);
      var st = computeStatus(ind);
      return {
        id: ind.id, raw: ind, name: ind.name, unit: ind.unit, type: ind.type,
        result: res, programme: prog, project: proj, secondary: !!ind.secondary,
        level: res ? res.level : (ind.secondary ? 'secondary' : 'output'),
        sdg: res ? res.sdg : null,
        iso: iso,
        region: prog ? prog.region : (proj ? proj.region : null),
        progress: st.progress, performance: st.performance,
        progressCode: st.progressCode, perfCode: st.perfCode,
        status: st.code, frac: st.frac, perf: st.perf,
        value: st.value, latest: st.latest, series: st.series,
        updated: st.latest ? st.latest.date : null,
        updatedMs: st.latest ? Date.parse(st.latest.date) : null
      };
    });
    INDBYID = {};
    IND.forEach(function (r) { INDBYID[r.id] = r; });
    // per-indicator waterfall keys (sdg / impact / outcome / output nodes above it)
    var pkByInd = DB._idx.projectKpiByIndicator;
    IND.forEach(function (r) {
      r.chainKeys = resultChain(r.result).map(function (n) { return n.level + SEP + n.statement; });
      if (r.sdg) r.chainKeys.push('sdg' + SEP + r.sdg);
      // distinct reporters across this KPI's measurements (drives the Users filter)
      var seen = {}; r.reporterIds = [];
      (r.series || []).forEach(function (m) { var id = m.reported_by_id; if (id != null && !seen[id]) { seen[id] = 1; r.reporterIds.push(+id); } });
      // projects this KPI belongs to (secondary → its own project; primary → via
      // project_kpi links) and the donors funding them - drives the Projects &
      // Donors filters and the Donor/Project insights dimensions.
      var pids = [];
      if (r.secondary && r.raw.project_id != null) pids.push(r.raw.project_id);
      (pkByInd[r.id] || []).forEach(function (pk) { if (pids.indexOf(pk.project_id) < 0) pids.push(pk.project_id); });
      r.projectIds = pids;
      var dset = {}; pids.forEach(function (pid) { var p = DB._idx.projectById[pid]; if (p && p.donor_id != null) dset[p.donor_id] = 1; });
      r.donorIds = Object.keys(dset).map(Number);
      r.projPrimary = pids.length ? DB._idx.projectById[pids[0]] : null;
      r.donorPrimary = (r.projPrimary && r.projPrimary.donor_id != null) ? DB._idx.donorById[r.projPrimary.donor_id] : null;
      // distinct beneficiary types this KPI reaches, across all its measurements'
      // beneficiary entries (drives the Project Beneficiaries filter).
      var bset = {};
      (r.series || []).forEach(function (m) {
        (DB._idx.benByMeasurement[m.id] || []).forEach(function (b) { if (b.type_id != null) bset[b.type_id] = 1; });
      });
      r.benTypeIds = Object.keys(bset).map(Number);
    });
    applyBasis();       // bind each KPI's active status + roll up to ancestors
    buildFramework();
    buildProjects();    // enriched projects with rolled-up KPI status
    buildActivities();  // flat activity list (one per measurement) for activity-basis counts
  }

  /** Flat list of ACTIVITIES - one per measurement row - carrying every dimension
   *  the facets filter on, so counts can report activities as an alternative to
   *  distinct projects (see S.countBasis). Geography/donor/programme come from the
   *  reporting PROJECT; KPI identity + performance from the INDICATOR; reporter and
   *  beneficiary types from the measurement itself. Each measurement is ONE activity
   *  (never double-counted), unlike a shared primary KPI whose reports span projects. */
  function buildActivities() {
    ACTS = []; ACTBYMEAS = {};
    (DB.tables.measurement || []).forEach(function (m) {
      var ind = INDBYID[m.indicator_id]; if (!ind) return;
      var proj = m.project_id != null ? DB._idx.projectById[m.project_id] : null;
      var prog = proj ? DB._idx.programmeByIso[proj.country_iso3] : (ind.programme || null);
      var bset = {};
      (DB._idx.benByMeasurement[m.id] || []).forEach(function (b) { if (b.type_id != null) bset[b.type_id] = 1; });
      ACTS.push({
        id: m.id, m: m,
        pid: proj ? proj.id : null,
        iso: proj ? proj.country_iso3 : ind.iso,
        region: proj ? proj.region : ind.region,
        progId: prog ? prog.id : null,
        donorId: (proj && proj.donor_id != null) ? proj.donor_id : null,
        sdg: ind.sdg, chainKeys: ind.chainKeys || [], name: ind.name,
        status: ind.status, type: ind.type,
        reporterId: m.reported_by_id != null ? +m.reported_by_id : null,
        benTypeIds: Object.keys(bset).map(Number),
        dateMs: m.date ? Date.parse(m.date) : null
      });
    });
    ACTS.forEach(function (a) { ACTBYMEAS[a.id] = a; });
  }

  /** Aggregate a list of enriched KPIs into a rolled-up {frac, ratio, code, n}.
   *  frac = mean achievement (progress); code = RAG of the mean active ratio. */
  function aggKpis(list) {
    var f = 0, ratio = 0, n = 0;
    list.forEach(function (r) { if (r.ratio != null) { f += (r.progress || 0); ratio += r.ratio; n++; } });
    return n ? { frac: f / n, ratio: ratio / n, code: ratioToCode(ratio / n), n: n }
             : { frac: null, ratio: null, code: 'nodata', n: 0 };
  }

  /** Drop a trailing " - <country>" from a project name for display. The
   *  country already has its own column/field everywhere a project is shown, so
   *  repeating it in the title is redundant. Only strips when the suffix matches
   *  the project's own country, leaving every other name untouched. */
  function stripCountry(name, co) {
    if (!name || !co || !co.name) return name;
    var esc = co.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return name.replace(new RegExp('\\s*[\\u2012-\\u2015-]\\s*' + esc + '\\s*$', 'i'), '');
  }

  /** Build the enriched PROJECTS list. Each project carries its PRIMARY KPIs
   *  (inventory indicators linked via project_kpi) and SECONDARY KPIs (its own
   *  project-local indicators), each aggregated separately AND combined. */
  function buildProjects() {
    PROJECTS = DB.tables.project.filter(function (p) { return p.plan_id === S.plan; }).map(function (p) {
      var prim = (DB._idx.projectKpiByProject[p.id] || [])
        .map(function (pk) { return INDBYID[pk.indicator_id]; }).filter(Boolean);
      var secs = (DB._idx.secondaryByProject[p.id] || [])
        .map(function (i) { return INDBYID[i.id]; }).filter(Boolean);
      var all = prim.concat(secs);
      var co = DB._idx.countryByIso[p.country_iso3];
      // distinct beneficiary types reached by THIS project's own activities
      // (measurements logged against it). Built per-project - not off shared KPIs –
      // so the Project Beneficiaries filter matches a project only when one of its
      // OWN activities logged that type. Drives projectPassesFacets' bentype test.
      var acts = DB._idx.measByProject[p.id] || [], bset = {};
      acts.forEach(function (m) {
        (DB._idx.benByMeasurement[m.id] || []).forEach(function (b) { if (b.type_id != null) bset[b.type_id] = 1; });
      });
      return {
        raw: p, id: p.id, code: p.code, name: stripCountry(p.name, co),
        donor: p.donor_id != null ? DB._idx.donorById[p.donor_id] : null,
        iso: p.country_iso3, country: co, region: p.region, budget: p.budget_usd,
        start: p.start_date, end: p.end_date,
        primary: prim, secondary: secs, kpis: all,
        statAll: aggKpis(all), statPrimary: aggKpis(prim), statSecondary: aggKpis(secs),
        benTypeIds: Object.keys(bset).map(Number),
        activityN: acts.length
      };
    });
    PROJECTSBYID = {}; PROJECTS.forEach(function (p) { PROJECTSBYID[p.id] = p; });
  }

  /** Bind the active RAG basis (Progress vs Performance) onto every KPI, then
   *  re-roll it up to each ancestor result. Progress (achievement of target) is
   *  always what the % bars show; `status`/`ratio` follow the chosen basis. */
  function applyBasis() {
    var prog = S.perfBasis === 'progress';
    IND.forEach(function (r) {
      r.status = prog ? r.progressCode : r.perfCode;
      r.ratio = prog ? r.progress : r.performance;   // the metric the RAG judges
      r.frac = r.progress;                           // % bars always show achievement
    });
    // roll the active metric up to every ancestor result (Output → Outcome → Pillar)
    STATUS_BY_RESULT = {};
    var acc = {};
    IND.forEach(function (r) {
      if (r.ratio == null || !r.result) return;
      resultChain(r.result).forEach(function (node) {
        var a = acc[node.id] = acc[node.id] || { ratio: 0, frac: 0, n: 0 };
        a.ratio += r.ratio; a.frac += (r.progress || 0); a.n++;
      });
    });
    Object.keys(acc).forEach(function (id) {
      var a = acc[id], ratio = a.ratio / a.n;
      STATUS_BY_RESULT[id] = { code: ratioToCode(ratio), frac: a.frac / a.n, ratio: ratio, perf: ratio, n: a.n };
    });
  }

  /** Results framework as a tree, where the SDG *is* the impact level and the
   *  impact statement is just its description:
   *    SDG (impact) → Outcome(s) → Output(s).  (indicators live on the right) */
  function buildFramework() {
    var byId = DB._idx.resultById, imap = {};
    DB.tables.result.forEach(function (res) {
      if (res.plan_id !== S.plan) return;   // only the active plan's framework
      if (res.level === 'impact' && !imap[res.statement]) imap[res.statement] = { stmt: res.statement, sdg: res.sdg, outcomes: {} };
    });
    DB.tables.result.forEach(function (res) {
      if (res.plan_id !== S.plan || res.level !== 'outcome') return;
      var p = byId[res.parent_id]; if (!p || !imap[p.statement]) return;
      if (!imap[p.statement].outcomes[res.statement]) imap[p.statement].outcomes[res.statement] = { stmt: res.statement, outputs: {} };
    });
    DB.tables.result.forEach(function (res) {
      if (res.plan_id !== S.plan || res.level !== 'output') return;
      var p = byId[res.parent_id]; if (!p) return; var gp = byId[p.parent_id]; if (!gp || !imap[gp.statement]) return;
      var oc = imap[gp.statement].outcomes[p.statement]; if (oc) oc.outputs[res.statement] = 1;
    });
    // group by SDG; the impact statement(s) become the SDG's description, and
    // the outcomes hang directly under the SDG.
    var groups = {};
    Object.keys(imap).forEach(function (k) {
      var im = imap[k], s = im.sdg || 0, g = groups[s] = groups[s] || { sdg: im.sdg, impacts: [], outcomes: {} };
      g.impacts.push(im.stmt);
      Object.keys(im.outcomes).forEach(function (ok) {
        var oc = g.outcomes[ok] = g.outcomes[ok] || { stmt: ok, outputs: {} };
        Object.keys(im.outcomes[ok].outputs).forEach(function (op) { oc.outputs[op] = 1; });
      });
    });
    FRAMEWORK = Object.keys(groups).map(function (s) {
      var g = groups[s];
      return {
        sdg: g.sdg,
        name: g.sdg ? (pillarLabel(g.sdg) + ' · ' + PILLAR_NAMES[g.sdg]) : 'Unaligned',
        impact: g.impacts.join('  ·  '),   // description of what this SDG is
        outcomes: Object.keys(g.outcomes).map(function (ok) { return { stmt: ok, outputs: Object.keys(g.outcomes[ok].outputs) }; })
      };
    }).sort(function (a, b) { return (a.sdg || 99) - (b.sdg || 99); });
  }

  // =========================================================================
  //  FILTERING
  // =========================================================================
  function rangeStart() {
    if (S.range === 'all') return null;
    var d = new Date(TODAY);
    switch (S.range) {
      case 'today': d.setHours(0,0,0,0); return d;
      case 'yesterday': d.setDate(d.getDate() - 1); return d;
      case '7d': d.setDate(d.getDate() - 7); return d;
      case '30d': d.setDate(d.getDate() - 30); return d;
      case '3m': d.setMonth(d.getMonth() - 3); return d;
      case '6m': d.setMonth(d.getMonth() - 6); return d;
      case '1y': d.setFullYear(d.getFullYear() - 1); return d;
    }
    return null;
  }

  // Active time-window bounds as epoch-ms, memoised on the (range, from, to)
  // tuple. inTimeRange/measInTimeRange run once per indicator per facet pool
  // (thousands of calls per render), so recomputing Dates each call was pure
  // waste - the window only changes when the user picks a new range.
  var _tr = { key: null, start: null, end: null };
  function timeBounds() {
    var key = S.range + '|' + (S.from || '') + '|' + (S.to || '');
    if (_tr.key !== key) {
      var start = S.from ? new Date(S.from) : rangeStart();
      var end = S.to ? new Date(S.to) : null;
      _tr = { key: key, start: start ? start.getTime() : null, end: end ? end.getTime() : null };
    }
    return _tr;
  }
  function inTimeRange(r) {
    var b = timeBounds();
    if (b.start == null && b.end == null) return true;
    if (r.updated == null) return false;
    var d = r.updatedMs != null ? r.updatedMs : Date.parse(r.updated);
    if (b.start != null && d < b.start) return false;
    if (b.end != null && d > b.end) return false;
    return true;
  }

  // Apply every active facet selection except those named in `skip` (so each
  // facet can be computed against the set filtered by the *other* facets –
  // choosing a country then shows only that country's impacts/outcomes/SDGs…).
  function passAll(r, skip) {
    skip = skip || [];
    // Secondary (project-local) KPIs are always aggregated alongside primaries
    // everywhere (map, list, facets, insights).
    if (skip.indexOf('region') < 0 && S.selRegion.size && !S.selRegion.has(r.region)) return false;
    if (skip.indexOf('prog') < 0 && S.selProg.size && !S.selProg.has(r.programme && r.programme.id)) return false;
    if (skip.indexOf('nodes') < 0 && S.selNodes.size) {
      var hit = false;
      for (var i = 0; i < r.chainKeys.length; i++) { if (S.selNodes.has(r.chainKeys[i])) { hit = true; break; } }
      if (!hit) return false;
    }
    if (skip.indexOf('sdg') < 0 && S.selSdg.size && !S.selSdg.has(r.sdg)) return false;
    if (skip.indexOf('kpi') < 0 && S.selKpi.size && !S.selKpi.has(r.name)) return false;
    if (skip.indexOf('user') < 0 && S.selUser.size &&
        !(r.reporterIds || []).some(function (id) { return S.selUser.has(id); })) return false;
    if (skip.indexOf('status') < 0 && S.selStatus.size && !S.selStatus.has(r.status)) return false;
    if (skip.indexOf('type') < 0 && S.selType.size && !S.selType.has(r.type)) return false;
    // donor / project are project-level; a KPI passes if it belongs to a matching project
    if (skip.indexOf('donor') < 0 && S.selDonor.size &&
        !(r.donorIds || []).some(function (id) { return S.selDonor.has(id); })) return false;
    if (skip.indexOf('project') < 0 && S.selProject.size &&
        !(r.projectIds || []).some(function (id) { return S.selProject.has(id); })) return false;
    if (skip.indexOf('bentype') < 0 && S.selBenType.size &&
        !(r.benTypeIds || []).some(function (id) { return S.selBenType.has(id); })) return false;
    if (skip.indexOf('country') < 0 && S.selCountry && r.iso !== S.selCountry) return false;
    return true;
  }
  function passFacets(r) { return passAll(r, []); }
  // cross-filtered pool for a facet (time + all other facets, minus its own dims)
  function facetPool(skip) { return IND.filter(function (r) { return inTimeRange(r) && passAll(r, skip); }); }

  // ---- ACTIVITY-basis counting (S.countBasis === 'activities') --------------
  // An activity = a measurement. The same cross-filter as passAll, evaluated on
  // the flat ACTS list, so counts report activities instead of distinct projects.
  function isActs() { return S.countBasis === 'activities'; }
  function actInTimeRange(a) {
    var b = timeBounds();
    if (b.start == null && b.end == null) return true;
    if (a.dateMs == null) return false;
    if (b.start != null && a.dateMs < b.start) return false;
    if (b.end != null && a.dateMs > b.end) return false;
    return true;
  }
  function passAllAct(a, skip) {
    skip = skip || [];
    if (skip.indexOf('region') < 0 && S.selRegion.size && !S.selRegion.has(a.region)) return false;
    if (skip.indexOf('prog') < 0 && S.selProg.size && !S.selProg.has(a.progId)) return false;
    if (skip.indexOf('nodes') < 0 && S.selNodes.size) {
      var hit = false;
      for (var i = 0; i < a.chainKeys.length; i++) { if (S.selNodes.has(a.chainKeys[i])) { hit = true; break; } }
      if (!hit) return false;
    }
    if (skip.indexOf('sdg') < 0 && S.selSdg.size && !S.selSdg.has(a.sdg)) return false;
    if (skip.indexOf('kpi') < 0 && S.selKpi.size && !S.selKpi.has(a.name)) return false;
    if (skip.indexOf('user') < 0 && S.selUser.size && !(a.reporterId != null && S.selUser.has(a.reporterId))) return false;
    if (skip.indexOf('status') < 0 && S.selStatus.size && !S.selStatus.has(a.status)) return false;
    if (skip.indexOf('type') < 0 && S.selType.size && !S.selType.has(a.type)) return false;
    if (skip.indexOf('donor') < 0 && S.selDonor.size && !(a.donorId != null && S.selDonor.has(a.donorId))) return false;
    if (skip.indexOf('project') < 0 && S.selProject.size && !(a.pid != null && S.selProject.has(a.pid))) return false;
    if (skip.indexOf('bentype') < 0 && S.selBenType.size && !a.benTypeIds.some(function (id) { return S.selBenType.has(id); })) return false;
    if (skip.indexOf('country') < 0 && S.selCountry && a.iso !== S.selCountry) return false;
    return true;
  }
  function actPool(skip) { return ACTS.filter(function (a) { return actInTimeRange(a) && passAllAct(a, skip); }); }
  /** Does one raw measurement survive every active filter? Answered by its ACTS
   *  twin, which already carries each dimension the facets test. A measurement
   *  outside the active plan has no twin and never passes. */
  function measPassesFilters(m) {
    var a = m && ACTBYMEAS[m.id];
    return !!a && actInTimeRange(a) && passAllAct(a, []);
  }
  /** The activities of a set of KPIs, narrowed to the active filters (and to
   *  `extra` when the caller scopes them further, e.g. to one project or one
   *  reporter). This is what every results box lists, so the table on screen is
   *  always the same slice the dashboard behind it is showing. */
  function filteredSeries(inds, extra) {
    var out = [];
    (inds || []).forEach(function (r) {
      (r.series || []).forEach(function (m) {
        if (!measPassesFilters(m)) return;
        if (extra && !extra(m)) return;
        out.push(m);
      });
    });
    return out;
  }
  // bucket the cross-filtered activities by one key (keyFn) or many keys (keysFn)
  function actCountsBy(skip, keyFn) {
    var m = {}; actPool(skip).forEach(function (a) { var k = keyFn(a); if (k != null) m[k] = (m[k] || 0) + 1; }); return m;
  }
  function actCountsByMulti(skip, keysFn) {
    var m = {}; actPool(skip).forEach(function (a) { (keysFn(a) || []).forEach(function (k) { if (k != null) m[k] = (m[k] || 0) + 1; }); }); return m;
  }

  function matchSearch(r, q) {
    if (!q) return true;
    q = q.toLowerCase();
    return (r.name && r.name.toLowerCase().indexOf(q) >= 0)
      || (r.result && r.result.statement.toLowerCase().indexOf(q) >= 0)
      || (r.programme && r.programme.name.toLowerCase().indexOf(q) >= 0);
  }

  // indicators after facet + time + country filters (drives map, metric, list)
  function filtered() {
    return IND.filter(function (r) { return passFacets(r) && inTimeRange(r) && matchSearch(r, S.qList); });
  }

  // Primary KPIs only: inventory indicators attached to at least one project via
  // project_kpi. Excludes project-local (secondary) KPIs and any unattached
  // framework indicators (output/outcome/impact-level). Drives the KPI pane.
  function primaryKpisFor() {
    return IND.filter(function (r) {
      return !r.secondary && (r.projectIds || []).length
        && passAll(r, []) && inTimeRange(r) && matchSearch(r, S.qList);
    });
  }

  // =========================================================================
  //  MAP
  // =========================================================================
  var view = { x: 0, y: 0, w: VB.W, h: VB.H };
  var defaultView = { x: 0, y: 0, w: VB.W, h: VB.H };  // fitted to the project-location extent
  var mapSvg, mapCountriesDrawn = false;
  var _mapLocs = [];   // current project-activity locations shown on the map (cached for zoom re-cluster)

  // Web-Mercator projection into the square [0..VB.W] world (so OpenStreetMap
  // raster tiles overlay correctly). x = longitude; y = mercator latitude.
  function mercY(lat) {
    lat = Math.max(-85.0511, Math.min(85.0511, lat));
    var s = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI));   // 0 = north, 1 = south
  }
  function proj(lng, lat) {
    return [ (lng + 180) / 360 * VB.W, mercY(lat) * VB.W ];
  }
  /** Padded projected bounding box of a set of {lat,lng} points. */
  function extentOf(pts, padFrac, padAbs) {
    var xs = [], ys = [];
    pts.forEach(function (p) { var xy = proj(p.lng, p.lat); xs.push(xy[0]); ys.push(xy[1]); });
    if (!xs.length) return null;
    var minx = Math.min.apply(null, xs), maxx = Math.max.apply(null, xs);
    var miny = Math.min.apply(null, ys), maxy = Math.max.apply(null, ys);
    var pf = padFrac == null ? 0.08 : padFrac, pa = padAbs == null ? 6 : padAbs;
    var padX = (maxx - minx) * pf + pa, padY = (maxy - miny) * pf + pa;
    return { x: minx - padX, y: miny - padY, w: (maxx - minx) + 2 * padX, h: (maxy - miny) + 2 * padY };
  }
  /** All project-activity locations (points) across every project, unfiltered –
   *  used to compute the default framing. */
  function allProjectLocations() {
    var pts = [];
    DB.tables.measurement.forEach(function (m) {
      if (m.project_id != null && m.place_lat != null && m.place_lng != null)
        pts.push({ lat: +m.place_lat, lng: +m.place_lng });
    });
    return pts;
  }

  // Aspect ratio (height/width) of the on-screen map element - the viewBox is
  // kept at this aspect so raster tiles overlay without distortion.
  function mapAspect() { var r = mapSvg && mapSvg.getBoundingClientRect(); return (r && r.width) ? (r.height / r.width) : 0.62; }
  function mapElemW() { var r = mapSvg && mapSvg.getBoundingClientRect(); return (r && r.width) ? r.width : 900; }
  /** Grow a bbox to the container aspect (contains the bbox, no distortion). */
  function aspectFit(bx, minW) {
    var aspect = mapAspect(), cx = bx.x + bx.w / 2, cy = bx.y + bx.h / 2;
    var w = Math.max(bx.w, bx.h / aspect); if (minW != null && w < minW) w = minW;
    var h = w * aspect;
    return { x: cx - w / 2, y: cy - h / 2, w: w, h: h };
  }

  /** Default view = extent of every project-activity location, so the initial
   *  view frames the points and nothing more. */
  function fitToBubbles() {
    var raw = extentOf(allProjectLocations(), 0.06, 18);
    defaultView = raw ? aspectFit(raw) : { x: 0, y: 0, w: VB.W, h: VB.W * mapAspect() };
    view = clone(defaultView);
  }
  function clone(o) { return { x: o.x, y: o.y, w: o.w, h: o.h }; }

  /** Frame a raw bbox at the container aspect, with a minimum zoom. */
  function frameExtent(bx) { return aspectFit(bx, defaultView.w * 0.30); }
  /** Like frameExtent but allows deep (street-level) zoom - used when zooming into
   *  a cluster. minW is an ABSOLUTE world width (default ≈ street level). */
  function aspectBox(bx, minW) { return aspectFit(bx, minW == null ? 0.06 : minW); }

  function clampObj(o) {
    var m = 0;   // no over-pan margin: the view may not cross the world border
    o.x = Math.max(-m, Math.min(VB.W - o.w + m, o.x));
    o.y = Math.max(-m, Math.min(VB.H - o.h + m, o.y));
    return o;
  }

  /** Ease the live view toward a target viewBox (bubbles scale with it). */
  var _viewAnim = null;
  function animateView(target) {
    clampObj(target);
    if (_viewAnim) { cancelAnimationFrame(_viewAnim); _viewAnim = null; }
    // When the page is hidden, rAF is paused - animating would freeze the view
    // mid-transition. Nobody's watching, so jump straight to the target.
    if (document.hidden) { view = target; setView(); redrawClusters(); renderTiles(); return; }
    var from = clone(view), start = performance.now(), dur = 460;
    function step(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;   // easeInOutQuad
      view.x = from.x + (target.x - from.x) * e;
      view.y = from.y + (target.y - from.y) * e;
      view.w = from.w + (target.w - from.w) * e;
      view.h = from.h + (target.h - from.h) * e;
      setView();
      redrawClusters();   // re-cluster as the zoom eases → markers diffuse smoothly
      if (t >= 1) renderTiles();   // refresh tiles to the settled zoom level (they scale during the ease)
      _viewAnim = t < 1 ? requestAnimationFrame(step) : null;
    }
    _viewAnim = requestAnimationFrame(step);
  }

  var _lastFitKey = null;
  /** Frame a set of project-activity locations. animate===false jumps instantly. */
  function fitToLocs(locs, animate) {
    var raw = extentOf(locs, 0.10, 12);
    var target = raw ? frameExtent(raw) : clone(defaultView);
    if (animate === false) { view = clampObj(target); setView(); redrawClusters(); renderTiles(); }
    else animateView(target);
  }
  function svgEl(tag, attrs) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (attrs) for (var k in attrs) e.setAttribute(k, attrs[k]);
    return e;
  }
  // Keep the viewBox at the container's aspect (so square tiles stay square),
  // holding the vertical centre, then write it out.
  function setView() {
    if (!mapSvg) return;
    var cy = view.y + view.h / 2;
    view.h = view.w * mapAspect();
    view.y = cy - view.h / 2;
    mapSvg.setAttribute('viewBox', view.x + ' ' + view.y + ' ' + view.w + ' ' + view.h);
    syncCamera();
  }

  // ---- Vector basemap (MapLibre GL) ----------------------------------------
  // The basemap is a MapLibre vector map rendered BEHIND the transparent SVG.
  // The app still owns pan/zoom through `view`; syncCamera() mirrors that world
  // rectangle onto the MapLibre camera each frame, so bubbles stay pixel-aligned.
  // Using a vector style (not raster tiles) lets us restyle the country-border
  // layer to gray - the raster tiles had the reddish border baked in.
  var mlMap = null, _mlTheme = null;
  function basemapStyleUrl(dark) {
    return dark ? 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json'
                : 'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';
  }
  // Recolour every administrative-boundary line to a thin gray, and hide the
  // basemap's continent name labels (Africa, Asia, …) so the map stays clean.
  function recolorBoundaries() {
    if (!mlMap) return;
    // Cheap guard: once the continent labels are hidden the style is already
    // tweaked, so bail out. Lets this run on every `styledata` tick for free.
    try {
      if (mlMap.getLayer('place_continent') &&
          mlMap.getLayoutProperty('place_continent', 'visibility') === 'none') return;
    } catch (e) {}
    var style = mlMap.getStyle(); var layers = (style && style.layers) || [];
    layers.forEach(function (l) {
      if (l.type === 'line' && /boundary|admin/i.test(l.id)) {
        try {
          mlMap.setPaintProperty(l.id, 'line-color', '#8b929c');
          mlMap.setPaintProperty(l.id, 'line-width', 0.2);
          mlMap.setPaintProperty(l.id, 'line-opacity', 1);
        } catch (e) {}
      }
      if (l.type === 'symbol' && /continent/i.test(l.id)) {
        try { mlMap.setLayoutProperty(l.id, 'visibility', 'none'); } catch (e) {}
      }
    });
  }
  // Keep the attribution collapsed to its "i" disclosure. MapLibre opens the
  // compact control on first paint (`open` + `maplibregl-compact-show`); the
  // credit only needs to be *reachable*, not permanently expanded over the map.
  // Runs on every `styledata` tick, so a theme swap cannot leave it open.
  function collapseAttribution() {
    var el = document.querySelector('#basemap .maplibregl-ctrl-attrib');
    if (!el) return;
    el.classList.remove('maplibregl-compact-show');
    if (el.tagName === 'DETAILS') { el.open = false; }
  }
  function ensureBasemap() {
    if (mlMap || typeof maplibregl === 'undefined') return;
    _mlTheme = (S.theme === 'dark');
    mlMap = new maplibregl.Map({
      container: 'basemap',
      style: basemapStyleUrl(_mlTheme),
      interactive: false,            // the SVG overlay owns all pan/zoom
      // ODbL requires the OSM credit to stay reachable, and the CARTO style
      // already carries it ("© CARTO, © OpenStreetMap contributors", both
      // linked) on its source - so inherit it. Do NOT add a customAttribution:
      // MapLibre would render it *alongside* the source's, and clearing the
      // source's afterwards is a race the control usually wins, which is how
      // the credit ended up printed twice. Compact = an "i" disclosure, kept
      // collapsed by collapseAttribution().
      attributionControl: { compact: true },
      renderWorldCopies: true,
      minZoom: 0, maxZoom: 24, fadeDuration: 0
    });
    mlMap.on('style.load', function () { recolorBoundaries(); collapseAttribution(); syncCamera(); });
    // `style.load` does NOT re-fire after setStyle() (theme switch), so the
    // continent-label hide was lost when swapping Voyager<->Dark Matter. `styledata`
    // fires on every restyle; the guard in recolorBoundaries keeps it cheap.
    mlMap.on('styledata', function () { recolorBoundaries(); collapseAttribution(); });
    window._mlMap = mlMap;   // debug handle
  }
  // Convert the app's world-mercator `view` rect → MapLibre center/zoom.
  function syncCamera() {
    if (!mlMap || !mapSvg || !view.w) return;
    var r = mapSvg.getBoundingClientRect(); var elemW = r.width || 900;
    var z = Math.log(1000 * elemW / (512 * view.w)) / Math.LN2;
    z = Math.max(0, Math.min(24, z));
    var cxW = view.x + view.w / 2, cyW = view.y + view.h / 2;
    var lng = cxW / 1000 * 360 - 180;
    var normY = cyW / 1000;
    var lat = (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * normY))) - Math.PI / 2) * 180 / Math.PI;
    if (!isFinite(lng) || !isFinite(lat) || !isFinite(z)) return;
    mlMap.jumpTo({ center: [lng, lat], zoom: z });
  }

  function drawBase() {
    mapSvg = $('#map');
    mapSvg.innerHTML = '';
    fitToBubbles();          // default zoom = bubble extent
    ensureBasemap();         // MapLibre vector basemap (land, ocean, gray borders, labels)
    // The SVG is now a transparent overlay carrying only the project-location
    // markers; the basemap underneath supplies land/ocean/borders/place-names.
    mapSvg.appendChild(svgEl('g', { id: 'bubbles' }));
    setView();
    renderTiles();
    mapCountriesDrawn = true;
  }

  // ---- OpenStreetMap raster tiles ------------------------------------------
  // Tiles are placed in world (viewBox) units, so they zoom/pan smoothly with the
  // SVG; on settle we swap to the tile-zoom level that best matches the scale.
  var _tileEls = {};
  var _labelEls = {};
  // Below this tile-zoom the labels overlay stays hidden - so the world/continent
  // view is clean (no continent names) and country names only appear once you've
  // zoomed into a country; regions and city names follow as you zoom further.
  var LABEL_MIN_ZOOM = 4;
  // One tile layer. `variant` picks the CARTO raster set; `store` caches its <image>
  // elements; `cls` styles them. Returns the tile-zoom used so the caller can gate.
  // Refresh the basemap: create it if needed, swap style on theme change, keep the
  // canvas sized to its container, and re-sync the camera. (Live pan/zoom follow is
  // handled continuously by syncCamera() inside setView(); this covers settle/resize
  // and theme switches - the raster tile pipeline it replaced is gone.)
  function renderTiles() {
    ensureBasemap();
    if (!mlMap) return;
    var dark = (S.theme === 'dark');
    if (dark !== _mlTheme) {
      _mlTheme = dark;
      mlMap.setStyle(basemapStyleUrl(dark));   // 'style.load' re-applies gray borders + re-syncs
    }
    mlMap.resize();
    syncCamera();
  }

  // Worst-first dominant status among a list carrying a `.status` code.
  var _STORDER = ['maroon','red','amber','green','blue','nodata'];
  function domStatus(list, keyFn) {
    var sc = {};
    list.forEach(function (x) { var c = keyFn(x); sc[c] = (sc[c] || 0) + 1; });
    return _STORDER.filter(function (k) { return sc[k]; })
      .sort(function (a, b) { return (sc[b] - sc[a]) || (_STORDER.indexOf(a) - _STORDER.indexOf(b)); })[0] || 'nodata';
  }

  /** Build the distinct project-activity LOCATIONS for the currently-filtered
   *  projects: one node per (lat,lng) with the projects + activity count there.
   *  Each activity is tested against the filters too, not just its project - a
   *  status or reporter filter must thin the bubbles, not only drop whole
   *  projects. activitiesAtCluster applies the same test, so a bubble's count and
   *  the rows in its results box always agree. */
  function buildLocations(projs) {
    var projById = {}; projs.forEach(function (p) { projById[p.id] = p; });
    var locs = {};
    projs.forEach(function (p) {
      (DB._idx.measByProject[p.id] || []).forEach(function (m) {
        if (m.place_lat == null || m.place_lng == null) return;
        if (!measPassesFilters(m)) return;
        var key = (+m.place_lat).toFixed(3) + ',' + (+m.place_lng).toFixed(3);
        var loc = locs[key] || (locs[key] = { lat: +m.place_lat, lng: +m.place_lng, name: m.place_name, acts: 0, projIds: {}, actsByProj: {} });
        loc.acts++; loc.projIds[p.id] = 1;
        loc.actsByProj[p.id] = (loc.actsByProj[p.id] || 0) + 1;
        if (!loc.name && m.place_name) loc.name = m.place_name;
      });
    });
    return Object.keys(locs).map(function (k) {
      var l = locs[k];
      l.projList = Object.keys(l.projIds).map(function (id) { return projById[+id]; }).filter(Boolean);
      l.status = domStatus(l.projList, function (p) { return projStat(p).code; });
      l.region = l.projList[0] ? l.projList[0].region : null;
      l.iso = l.projList[0] ? l.projList[0].iso : null;
      // dominant donor & pillar/impact across the projects at this location - these
      // drive the alternative legend colourings (by Donor / by Impact).
      l.donorId = domFreq(l.projList, function (p) { return p.donor ? p.donor.id : null; });
      if (l.donorId != null) l.donorId = +l.donorId;
      l.pillar = domFreq(l.projList, function (p) { return projPillar(p); });
      if (l.pillar != null) l.pillar = +l.pillar;
      // total budget of the (distinct) projects at this location - bands the "by Budget" legend
      l.budget = l.projList.reduce(function (s, p) { return s + (p.budget || 0); }, 0);
      return l;
    });
  }

  /** A project's dominant Impact/Pillar id - the most frequent `sdg` (repurposed
   *  as the pillar id) across the KPIs rolled up to it. null when unaligned. */
  function projPillar(p) {
    return domFreq(p.kpis || [], function (k) { return k.sdg != null ? k.sdg : null; });
  }

  /** Grid-cluster locations. Cell size shrinks with the zoom (view.w), so nearby
   *  markers merge when zoomed out and diffuse (split apart) as you zoom in. */
  function clusterLocs(locs) {
    var cell = view.w / 17;   // ~17 clusters across the view; coarser → less overlap, shrinks with zoom → diffuse
    var cells = {};
    locs.forEach(function (l) {
      var xy = proj(l.lng, l.lat);
      var k = Math.floor(xy[0] / cell) + '_' + Math.floor(xy[1] / cell);
      var c = cells[k] || (cells[k] = { sx: 0, sy: 0, acts: 0, locs: [], projIds: {}, actsByProj: {} });
      c.sx += xy[0]; c.sy += xy[1]; c.acts += l.acts; c.locs.push(l);
      Object.keys(l.projIds).forEach(function (id) { c.projIds[id] = 1; });
      Object.keys(l.actsByProj).forEach(function (id) { c.actsByProj[id] = (c.actsByProj[id] || 0) + l.actsByProj[id]; });
    });
    return Object.keys(cells).map(function (k) {
      var c = cells[k];
      c.x = c.sx / c.locs.length; c.y = c.sy / c.locs.length;
      c.nProj = Object.keys(c.projIds).length;
      c.status = domStatus(c.locs, function (l) { return l.status; });
      return c;
    });
  }

  // ---- "by Budget" banding -------------------------------------------------
  // A sequential (light→dark) ramp; locations are split into quartile bands over
  // the CURRENT filtered set, so the four bands stay balanced whatever the scale.
  var BUDGET_RAMP = ['#A7E0C8', '#5CC4A0', '#2F9E78', '#166B52'];
  var _budgetCut = null;   // [q25, q50, q75] thresholds
  function computeBudgetBands(locs) {
    var vals = locs.map(function (l) { return l.budget || 0; }).sort(function (a, b) { return a - b; });
    if (!vals.length) { _budgetCut = [0, 0, 0]; return; }
    function q(p) { return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))]; }
    _budgetCut = [q(0.25), q(0.5), q(0.75)];
  }
  function budgetBand(v) {
    var c = _budgetCut || [0, 0, 0]; v = v || 0;
    return v < c[0] ? 0 : v < c[1] ? 1 : v < c[2] ? 2 : 3;
  }
  function fmtCompact(v) {
    v = +v || 0;
    if (v >= 1e9) return (v / 1e9).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'B';
    if (v >= 1e6) return (v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (v >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(Math.round(v));
  }
  function budgetLabel(i) {
    var c = _budgetCut || [0, 0, 0];
    if (i === 0) return '< $' + fmtCompact(c[0]);
    if (i === 1) return '$' + fmtCompact(c[0]) + ' – $' + fmtCompact(c[1]);
    if (i === 2) return '$' + fmtCompact(c[1]) + ' – $' + fmtCompact(c[2]);
    return '≥ $' + fmtCompact(c[2]);
  }

  // Blend a hex colour toward white by `amt` (0..1) so bubbles read a touch lighter.
  function lighten(hex, amt) {
    var m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '')); if (!m) return hex;
    var n = parseInt(m[1], 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    r = Math.round(r + (255 - r) * amt); g = Math.round(g + (255 - g) * amt); b = Math.round(b + (255 - b) * amt);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }
  function clusterColor(c) {
    if (S.colorMode === 'region') {
      var dom = domFreq(c.locs, function (l) { return l.region; });
      return dom ? regionColor(dom) : '#94a3b8';
    }
    if (S.colorMode === 'impact') {
      var pil = domFreq(c.locs, function (l) { return l.pillar; });
      return pil != null ? (PILLAR_COLORS[pil] || '#94a3b8') : '#94a3b8';
    }
    if (S.colorMode === 'donor') {
      var did = domFreq(c.locs, function (l) { return l.donorId; });
      var d = did != null ? DB._idx.donorById[+did] : null;
      return d && d.color ? d.color : '#94a3b8';
    }
    if (S.colorMode === 'budget') {
      var bnd = domFreq(c.locs, function (l) { return budgetBand(l.budget || 0); });
      return BUDGET_RAMP[bnd != null ? +bnd : 0];
    }
    return STATUS[c.status].c;   // status is the meaningful colouring for project locations
  }
  function domFreq(list, keyFn) {
    var m = {}; list.forEach(function (x) { var k = keyFn(x); if (k != null) m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; })[0];
  }

  /** Redraw the cluster markers for the CURRENT view (no re-filter, no re-fit) –
   *  called on every zoom frame so markers diffuse smoothly. */
  function redrawClusters() {
    var layer = $('#bubbles'); if (!layer) return; layer.innerHTML = '';
    var clusters = clusterLocs(_mapLocs);
    // size markers in SCREEN px (converted to world units) so they stay a constant
    // on-screen size at ANY zoom - never ballooning or overlapping.
    var w2px = view.w / mapElemW();   // world units per screen pixel
    // A cluster reports its PROJECTS or its ACTIVITIES depending on S.countBasis –
    // the same choice that drives the facet counts. `single` stays geographic (one
    // point on the map = a small pin) so the metric only affects size + badge.
    var acts = isActs();
    // biggest clusters first so smaller ones (and single pins) sit on top
    clusters.sort(function (a, b) { return (acts ? b.acts - a.acts : b.nProj - a.nProj) || (b.locs.length - a.locs.length); }).forEach(function (c) {
      var metric = acts ? c.acts : c.nProj, single = c.locs.length === 1, col = lighten(clusterColor(c), 0.22);
      // Splittable only if the grouped locations sit at ≥2 distinct coordinates –
      // otherwise zooming can't diffuse them, so it's effectively one pin.
      var ck = {}; c.locs.forEach(function (l){ ck[l.lng.toFixed(4) + ',' + l.lat.toFixed(4)] = 1; });
      var splittable = Object.keys(ck).length > 1;
      var rPx = single ? 4 : Math.min(13, 7 + Math.log(Math.max(1, metric)) / Math.LN10 * 4.5);   // smaller, proportionate cluster badge
      var g = svgEl('g', { class: 'bubg' });
      var circle = svgEl('circle', { cx: c.x.toFixed(2), cy: c.y.toFixed(2), r: (rPx * w2px).toFixed(3),
        class: 'bub' + (single ? ' single' : ' cluster'), fill: col, 'fill-opacity': single ? 1 : 0.92,
        stroke: '#000', 'stroke-width': ((single ? 0.35 : 0.5) * w2px).toFixed(3) });
      circle.__cluster = c; circle.__single = single;
      g.appendChild(circle);
      // Show the count only on clusters that can still be split apart by zooming.
      if (!single && splittable) {
        var fpx = Math.min(rPx * 0.95, 5 + Math.log(Math.max(1, metric)) / Math.LN10 * 2);
        var txt = svgEl('text', { x: c.x.toFixed(2), y: c.y.toFixed(2), dy: '0.34em', class: 'bubcount', 'font-size': (fpx * w2px).toFixed(3) });
        txt.textContent = fmt(metric);
        g.appendChild(txt);
      }
      layer.appendChild(g);
    });
  }


  function renderBubbles() {
    if (!mapCountriesDrawn) drawBase();
    var projs = projectsFor();
    _mapLocs = buildLocations(projs);
    var nProj = projs.length;
    var nAct = _mapLocs.reduce(function (s, l) { return s + l.acts; }, 0);
    $('#countryCount').textContent = fmt(_mapLocs.length) + ' location' + (_mapLocs.length === 1 ? '' : 's')
      + ' · ' + fmt(nProj) + ' project' + (nProj === 1 ? '' : 's')
      + ' · ' + fmt(nAct) + ' activit' + (nAct === 1 ? 'y' : 'ies');
    renderLegendRows(_mapLocs);
    // re-fit only when the filtered project set changes (don't fight manual pan/zoom)
    var fitKey = projs.map(function (p) { return p.id; }).sort(function (a, b) { return a - b; }).join(',');
    if (fitKey !== _lastFitKey) {
      var first = _lastFitKey === null;
      _lastFitKey = fitKey;
      fitToLocs(_mapLocs, !first);
    }
    redrawClusters();
  }

  // ---- cluster / location interactions -------------------------------------
  function zoomToLocs(locs) {
    var raw = extentOf(locs, 0.45, 4); if (!raw) return;
    animateView(aspectBox(raw, 0.06));
  }
  // Clicking any bubble shows the list of projects there. Multi-location clusters
  // also offer a "Zoom in" control to diffuse into their constituent points.
  function clusterClick(c, e) { openClusterPopup(c, e); }

  // Floating popup listing the projects at a clicked bubble (with deep links).
  function ensureLocPop() {
    var pop = $('#locPop'); if (pop) return pop;
    pop = el('div', 'locpop'); pop.id = 'locPop'; $('#mapView').appendChild(pop); return pop;
  }
  function closeLocPop() { var p = $('#locPop'); if (p) p.classList.remove('on'); }
  function openClusterPopup(c, e) {
    var pop = ensureLocPop();
    var multi = c.locs.length > 1;
    // A cluster is only splittable if its locations sit at ≥2 distinct coordinates –
    // otherwise zooming in leaves them stacked, so don't offer the split control.
    var coordKeys = {}; c.locs.forEach(function (l){ coordKeys[l.lng.toFixed(4) + ',' + l.lat.toFixed(4)] = 1; });
    var splittable = Object.keys(coordKeys).length > 1;
    var projs = Object.keys(c.projIds).map(function (id) { return PROJECTSBYID[+id]; }).filter(Boolean)
      .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
    var title = multi ? (fmt(c.locs.length) + ' locations') : (c.locs[0].name || 'Location');
    var html = '<div class="lp-head"><div><b>' + esc(title) + '</b>'
      + '<div class="lp-sub">' + fmt(projs.length) + ' project' + (projs.length === 1 ? '' : 's') + ' · ' + fmt(c.acts) + ' activit' + (c.acts === 1 ? 'y' : 'ies') + '</div></div>'
      + '<button class="lp-x" title="Close">×</button></div>';
    html += '<button class="lp-open" type="button">▤ Activity results - ' + fmt(c.acts) + ' activit' + (c.acts === 1 ? 'y' : 'ies') + '</button>';
    if (multi && splittable) html += '<button class="lp-zoom" type="button">⌕ Zoom in to these locations</button>';
    html += '<div class="lp-list">';
    projs.forEach(function (p) {
      var st = projStat(p);
      var pa = c.actsByProj[p.id] || 0;
      html += '<a class="lp-proj" href="#project/' + p.id + '" data-pid="' + p.id + '">'
        + '<span class="lp-dot" style="background:' + STATUS[st.code].c + '"></span>'
        + '<span class="lp-nm">' + esc((p.code ? p.code + ' · ' : '') + p.name) + '</span>'
        + '<span class="lp-ac" title="Activities at this location">' + fmt(pa) + ' activit' + (pa === 1 ? 'y' : 'ies') + '</span>'
        + '<span class="lp-pc" style="color:' + STATUS[st.code].c + '">' + (st.frac != null ? Math.round(st.frac * 100) + '%' : '–') + '</span></a>';
    });
    pop.innerHTML = html + '</div>';
    pop.classList.add('on');
    var wrap = $('#mapView').getBoundingClientRect();
    var x = (e ? e.clientX : wrap.left + wrap.width / 2) - wrap.left + 14;
    var y = (e ? e.clientY : wrap.top + wrap.height / 2) - wrap.top + 14;
    if (x + 280 > wrap.width) x = Math.max(8, x - 300);
    if (y + 260 > wrap.height) y = Math.max(8, wrap.height - 270);
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
    pop.querySelector('.lp-x').onclick = closeLocPop;
    var ob = pop.querySelector('.lp-open');
    if (ob) ob.onclick = function (){ openLocationSummary(c, false); };
    var zb = pop.querySelector('.lp-zoom');
    if (zb) zb.onclick = function (){ closeLocPop(); zoomToLocs(c.locs); };
    pop.querySelectorAll('.lp-proj').forEach(function (a) {
      a.onclick = function (ev) { ev.preventDefault(); closeLocPop(); openProjectById(+a.dataset.pid); };
    });
  }

  // Deep-link a project's results popup via the URL hash (#project/ID), so links are
  // shareable. Settings (edit) are reached only from the right-pane project cards.
  function openProjectById(pid) {
    var p = DB._idx.projectById[pid]; if (!p) return;
    if (p.plan_id != null && p.plan_id !== S.plan) setActivePlan(p.plan_id);   // a project belongs to a plan
    try { history.replaceState(null, '', location.pathname + location.search + '#project/' + pid); }
    catch (e) { try { location.hash = 'project/' + pid; } catch (e2) {} }
    openEntitySummary('project', pid);
  }
  function handleProjectHash() {
    var m = /#project\/(\d+)/.exec(location.hash || ''); if (!m) return;
    // Consume the deep-link hash immediately: a shared #project/<id> link still
    // opens the popup once, but the URL is then cleaned so a later refresh returns
    // to the dashboard instead of re-opening the same project every time.
    clearProjectHash();
    var p = DB._idx.projectById[+m[1]]; if (!p) return;
    if (p.plan_id != null && p.plan_id !== S.plan) setActivePlan(p.plan_id);   // deep link may target another plan
    openEntitySummary('project', +m[1]);
  }
  function clearProjectHash() {
    if (!/#project\//.test(location.hash || '')) return;
    try { history.replaceState(null, '', location.pathname + location.search); }
    catch (e) { try { location.hash = ''; } catch (e2) {} }
  }

  var _centroidCache = {};
  function worldCentroid(iso) {
    if (iso in _centroidCache) return _centroidCache[iso];
    var found = (window.WORLD.countries || []).filter(function (c) { return c.iso === iso; })[0];
    var v = found ? found.c : null;
    _centroidCache[iso] = v; return v;
  }
  // Bounding box [minLon, minLat, maxLon, maxLat] of a country's polygon, used to
  // constrain the place-search geocoder to the country so partial queries surface
  // in-country matches instead of globally-prominent places elsewhere.
  var _bboxCache = {};
  function worldBBox(iso) {
    if (iso in _bboxCache) return _bboxCache[iso];
    var found = (window.WORLD.countries || []).filter(function (c) { return c.iso === iso; })[0];
    var v = null;
    if (found && found.p) {
      var minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
      found.p.forEach(function (ring) { ring.forEach(function (pt) {
        if (pt[0] < minLon) minLon = pt[0];
        if (pt[0] > maxLon) maxLon = pt[0];
        if (pt[1] < minLat) minLat = pt[1];
        if (pt[1] > maxLat) maxLat = pt[1];
      }); });
      // Skip antimeridian-spanning boxes (e.g. Fiji, Russia) - a globe-wide box is
      // no filter at all, so fall back to the in-country result filter instead.
      if (minLon <= maxLon && minLat <= maxLat && (maxLon - minLon) < 180) v = [minLon, minLat, maxLon, maxLat];
    }
    _bboxCache[iso] = v; return v;
  }

  // Legend now describes the project LOCATIONS on the map (each `l` is a location
  // with a rolled-up project `.status` and a `.region`).
  function renderLegendRows(locs) {
    var box = $('#legendRows'); box.innerHTML = '';
    computeBudgetBands(locs);   // refresh the quartile thresholds for the current set
    if (S.colorMode === 'region') {
      $('#colorNote').textContent = 'region';
      var rc = {}; locs.forEach(function (l) { if (l.region) rc[l.region] = (rc[l.region] || 0) + 1; });
      REGION_ORDER.forEach(function (rg) { if (rc[rg]) box.appendChild(legRow(regionColor(rg), regionFull(rg), rc[rg], true)); });
      return;
    }
    if (S.colorMode === 'impact') {
      $('#colorNote').textContent = 'impact';
      var pc = {}; locs.forEach(function (l) { var k = l.pillar != null ? l.pillar : 0; pc[k] = (pc[k] || 0) + 1; });
      // one row per pillar present, in framework order, "Unaligned" last
      (FRAMEWORK || []).forEach(function (sg) {
        var key = sg.sdg || 0; if (!pc[key]) return;
        var col = sg.sdg ? (PILLAR_COLORS[sg.sdg] || '#94a3b8') : '#94a3b8';
        var label = sg.sdg ? (pillarLabel(sg.sdg) + ' · ' + (PILLAR_NAMES[sg.sdg] || '')) : 'Unaligned';
        box.appendChild(legRow(col, label, pc[key], true));
      });
      return;
    }
    if (S.colorMode === 'donor') {
      $('#colorNote').textContent = 'donor';
      var dcnt = {}, dref = {};
      locs.forEach(function (l) {
        var d = l.donorId != null ? DB._idx.donorById[l.donorId] : null;
        var key = d ? d.id : 0; dcnt[key] = (dcnt[key] || 0) + 1; if (d) dref[key] = d;
      });
      var order = Object.keys(dcnt).sort(function (a, b) { return dcnt[b] - dcnt[a]; });
      // keep the legend within the map: show the top donors, roll the rest into "Other"
      var CAP = 10, shown = order.slice(0, CAP), rest = order.slice(CAP);
      shown.forEach(function (key) {
        var d = dref[key];
        var col = d && d.color ? d.color : '#94a3b8';
        var label = d ? d.name : 'No donor';   // full donor name
        box.appendChild(legRow(col, label, dcnt[key], true));
      });
      if (rest.length) {
        var other = rest.reduce(function (s, k) { return s + dcnt[k]; }, 0);
        box.appendChild(legRow('#94a3b8', 'Other donors (' + rest.length + ')', other, true));
      }
      return;
    }
    if (S.colorMode === 'budget') {
      $('#colorNote').textContent = 'total budget (quartiles)';
      var bc = [0, 0, 0, 0];
      locs.forEach(function (l) { bc[budgetBand(l.budget || 0)]++; });
      [0, 1, 2, 3].forEach(function (i) { if (bc[i]) box.appendChild(legRow(BUDGET_RAMP[i], budgetLabel(i), bc[i], false)); });
      return;
    }
    $('#colorNote').textContent = 'project status · by ' + (S.perfBasis === 'progress' ? 'Progress' : 'Performance');
    var sc = { blue:0, green:0, amber:0, red:0, maroon:0, nodata:0 };
    locs.forEach(function (l) { sc[l.status]++; });
    ['blue','green','amber','red','maroon','nodata'].forEach(function (k) { box.appendChild(legRow(STATUS[k].c, STATUS[k].label, sc[k], true)); });
  }
  function legRow(color, text, val, round) {
    var row = el('div', 'lrow');
    var sq = el('span', 'sq'); sq.style.background = color; if (!round) sq.style.borderRadius = '3px';
    row.appendChild(sq);
    row.appendChild(el('span', 't', text));
    row.appendChild(el('span', 'v', fmt(val)));
    return row;
  }

  // ---- map interactions ----------------------------------------------------
  function initMapInteractions() {
    var svg = $('#map'), tip = $('#tip'), wrap = $('#mapView');
    var dragging = false, sx = 0, sy = 0, vx0 = 0, vy0 = 0;
    svg.addEventListener('mousedown', function (e) {
      dragging = true; svg.classList.add('drag'); sx = e.clientX; sy = e.clientY; vx0 = view.x; vy0 = view.y;
    });
    window.addEventListener('mouseup', function () { if (dragging) { dragging = false; svg.classList.remove('drag'); renderTiles(); } });
    window.addEventListener('mousemove', function (e) {
      if (!dragging) return;
      var rect = svg.getBoundingClientRect();
      view.x = vx0 - (e.clientX - sx) * (view.w / rect.width);
      view.y = vy0 - (e.clientY - sy) * (view.h / rect.height);
      clampView(); setView();
    });
    svg.addEventListener('wheel', function (e) {
      e.preventDefault(); zoomAt(e.deltaY < 0 ? 0.85 : 1.18, e);
    }, { passive: false });
    // Clicking a marker lists the projects there (and, for a single location, its
    // place name) - see openClusterPopup. No hover tooltips: the basemap already
    // carries place names, and details appear on click.
    svg.addEventListener('click', function (e) {
      var t = e.target;
      if (t.classList && t.classList.contains('bub') && t.__cluster) clusterClick(t.__cluster, e);
      else if (!(e.target.closest && e.target.closest('#locPop'))) closeLocPop();
    });
    $('#zIn').onclick = function () { zoomAt(0.8); };
    $('#zOut').onclick = function () { zoomAt(1.25); };
    $('#zReset').onclick = function () { closeLocPop(); animateView(clone(defaultView)); };
  }
  // Allow panning/zooming across the whole world (it's the background), with a
  // small margin; the default view still frames the bubble extent.
  function clampView() {
    var m = 0;   // no over-pan margin: the view may not cross the world border
    view.x = Math.max(-m, Math.min(VB.W - view.w + m, view.x));
    view.y = Math.max(-m, Math.min(VB.H - view.h + m, view.y));
  }
  var _tileTimer = null;
  function zoomAt(factor, e) {
    // No artificial zoom-in stop - keep zooming as deep as the basemap allows (well
    // past the tiles' native max zoom). The tiny floor only guards against view.w→0.
    var nw = Math.max(0.0004, Math.min(VB.W, view.w * factor));
    var nh = nw * mapAspect();                        // keep the container aspect
    var cx = view.x + view.w / 2, cy = view.y + view.h / 2;
    if (e) {
      var rect = mapSvg.getBoundingClientRect();
      cx = view.x + (e.clientX - rect.left) / rect.width * view.w;
      cy = view.y + (e.clientY - rect.top) / rect.height * view.h;
    }
    view.x = cx - (cx - view.x) * (nw / view.w);
    view.y = cy - (cy - view.y) * (nh / view.h);
    view.w = nw; view.h = nh; clampView(); setView(); redrawClusters();
    // debounce tile refresh so rapid wheel zoom doesn't thrash the tile layer
    clearTimeout(_tileTimer); _tileTimer = setTimeout(renderTiles, 140);
  }
  // =========================================================================
  //  FACETS (left sidebar)
  // =========================================================================
  function renderFacets() {
    renderProgFacet();
    renderDonorFacet();
    renderProjectFacet();
    renderStatusFacet();
    renderFrameworkFacet();
    renderBenTypeFacet();
    renderKpiFacet();
    renderUserFacet();
  }

  // ---- filter-group layout: drag-to-reorder + collapse, persisted in prefs ----
  var FACET_ORDER_DEFAULT = ['prog', 'level', 'donor', 'project', 'status', 'bentype', 'kpi', 'user'];

  function facetGroupEls() {
    var scroll = $('#facetGroups');
    return scroll ? Array.prototype.slice.call(scroll.querySelectorAll(':scope > .fgroup')) : [];
  }
  function readFacetOrder() {
    return facetGroupEls().map(function (g) { return g.getAttribute('data-group'); });
  }
  /** Reorder the group DOM to match S.facetOrder and apply collapsed state. */
  function applyFacetLayout() {
    var scroll = $('#facetGroups'); if (!scroll) return;
    var byKey = {};
    facetGroupEls().forEach(function (g) { byKey[g.getAttribute('data-group')] = g; });
    var order = (S.facetOrder || FACET_ORDER_DEFAULT).filter(function (k) { return byKey[k]; });
    Object.keys(byKey).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });   // append any new/unknown groups
    order.forEach(function (k) { scroll.appendChild(byKey[k]); });   // re-append in order
    Object.keys(byKey).forEach(function (k) {
      byKey[k].classList.toggle('collapsed', !!(S.facetCollapsed && S.facetCollapsed[k]));
    });
  }
  /** Wire drag-and-drop reordering + click-to-collapse on the group headers. */
  function initFacetGroups() {
    var scroll = $('#facetGroups'); if (!scroll) return;
    var dragged = null, moved = false;
    facetGroupEls().forEach(function (g) {
      var head = g.querySelector('.fg-head'); if (!head) return;
      head.setAttribute('draggable', 'true');
      head.addEventListener('mousedown', function () { moved = false; });
      head.addEventListener('dragstart', function (e) {
        dragged = g; moved = false; g.classList.add('dragging'); scroll.classList.add('dragging-active');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', g.getAttribute('data-group')); } catch (err) {}
      });
      head.addEventListener('dragend', function () {
        g.classList.remove('dragging'); scroll.classList.remove('dragging-active');
        if (dragged) { S.facetOrder = readFacetOrder(); persist(); }
        dragged = null;
      });
      head.addEventListener('click', function () {
        if (moved) { moved = false; return; }   // this was a drag, not a click
        var key = g.getAttribute('data-group');
        g.classList.toggle('collapsed');
        S.facetCollapsed = S.facetCollapsed || {};
        if (g.classList.contains('collapsed')) S.facetCollapsed[key] = true; else delete S.facetCollapsed[key];
        persist();
      });
    });
    scroll.addEventListener('dragover', function (e) {
      if (!dragged) return;
      e.preventDefault(); moved = true;
      try { e.dataTransfer.dropEffect = 'move'; } catch (err) {}
      var after = facetDragAfter(scroll, e.clientY);
      if (after == null) scroll.appendChild(dragged);
      else if (after !== dragged) scroll.insertBefore(dragged, after);
    });
  }
  function facetDragAfter(container, y) {
    var els = Array.prototype.slice.call(container.querySelectorAll(':scope > .fgroup:not(.dragging)'));
    var best = { offset: -Infinity, el: null };
    els.forEach(function (child) {
      var box = child.getBoundingClientRect();
      var offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > best.offset) best = { offset: offset, el: child };
    });
    return best.el;
  }

  /** DONORS facet - one row per funding partner, counting the projects it funds
   *  under the other active filters. Selecting donors narrows the project list. */
  function renderDonorFacet() {
    var host = $('#facetDonor'); if (!host) return; host.innerHTML = '';
    var q = (S.qDonor || '').toLowerCase(), progIso = progIsoSet();
    var counts;
    if (isActs()) {
      counts = actCountsBy(['donor'], function (a) { return a.donorId != null ? a.donorId : 0; });
    } else {
      counts = {};
      PROJECTS.forEach(function (p) {
        if (!projectPassesFacets(p, true, progIso)) return;   // ignore donor selection for counts
        var id = p.donor ? p.donor.id : 0;
        counts[id] = (counts[id] || 0) + 1;
      });
    }
    var maxN = 1; Object.keys(counts).forEach(function (k) { if (counts[k] > maxN) maxN = counts[k]; });
    var all = DB.tables.donor.slice()
      .filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0 || (d.short_name || '').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0) || (a.name < b.name ? -1 : 1); });
    var total = all.length, win = q ? total : Math.min(S.donorShown, total);
    var shown = all.slice(0, win);
    all.forEach(function (d) { if (S.selDonor.has(d.id) && shown.indexOf(d) < 0) shown.push(d); });   // keep selected visible
    shown.forEach(function (d) {
      var col = d.color || '#7c8aa5';
      host.appendChild(facetRow({
        checkbox: true, checked: S.selDonor.has(d.id), color: col,
        name: d.name, title: d.type + ' donor', count: counts[d.id] || 0,
        barPct: (counts[d.id] || 0) / maxN, barColor: col, selected: S.selDonor.has(d.id),
        onCheck: function () { toggle(S.selDonor, d.id); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('donor', d.id); }
      }));
    });
    if (!q) facetMoreLess(host, win, total,
      function () { return S.donorShown; }, function (v) { S.donorShown = v; }, renderDonorFacet);
  }

  /** PROJECTS facet - one checkable row per project, cross-filtered by the other
   *  active facets (its own selection skipped). Selecting projects narrows the
   *  portfolio to exactly those. Like every facet the count follows S.countBasis:
   *  projects basis shows 1 per row (each row IS one project), activities basis
   *  shows the activities logged against it (sorted by that volume). Colour = status. */
  function renderProjectFacet() {
    var host = $('#facetProject'); if (!host) return; host.innerHTML = '';
    var q = (S.qProject || '').toLowerCase(), progIso = progIsoSet();
    var acts = isActs();
    var counts = acts ? actCountsBy(['project'], function (a) { return a.pid; }) : null;   // activities per project
    var all = PROJECTS
      .filter(function (p) { return projectPassesFacets(p, false, progIso, true); })   // skip own project selection
      .filter(function (p) {
        if (!q) return true;
        var co = p.country ? p.country.name : '';
        return ((p.code || '') + ' ' + p.name + ' ' + (p.donor ? p.donor.name : '') + ' ' + co).toLowerCase().indexOf(q) >= 0;
      });
    if (acts) all.sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0) || ((a.name || '') < (b.name || '') ? -1 : 1); });
    else all.sort(function (a, b) { var an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase(); return an < bn ? -1 : (an > bn ? 1 : 0); });
    var maxN = 1; if (acts) all.forEach(function (p) { if ((counts[p.id] || 0) > maxN) maxN = counts[p.id] || 0; });
    var total = all.length, win = q ? total : Math.min(S.projectShown, total);
    var shown = all.slice(0, win);
    PROJECTS.forEach(function (p) { if (S.selProject.has(p.id) && shown.indexOf(p) < 0) shown.push(p); });   // keep selected visible
    shown.forEach(function (p) {
      var col = STATUS[projStat(p).code].c, n = acts ? (counts[p.id] || 0) : 1;
      host.appendChild(facetRow({
        checkbox: true, checked: S.selProject.has(p.id), color: col,
        count: n, barPct: acts ? n / maxN : 1, barColor: col,
        name: (p.code ? p.code + ' · ' : '') + p.name,
        title: acts ? (p.name + ' - ' + fmt(n) + ' activit' + (n === 1 ? 'y' : 'ies')) : p.name,
        selected: S.selProject.has(p.id),
        onCheck: function () { toggle(S.selProject, p.id); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('project', p.id); }
      }));
    });
    if (!q) facetMoreLess(host, win, total,
      function () { return S.projectShown; }, function (v) { S.projectShown = v; }, renderProjectFacet);
  }

  /** PROJECT BENEFICIARIES facet - one row per beneficiary type (Women, Youth,
   *  PWD, …). The count is the number of PROJECTS whose own activities logged that
   *  type, cross-filtered by the other active facets (its own selection skipped).
   *  Clicking a name opens the beneficiary-type results summary. */
  function renderBenTypeFacet() {
    var host = $('#facetBenType'); if (!host) return; host.innerHTML = '';
    var progIso = progIsoSet();
    var counts;
    if (isActs()) {
      counts = actCountsByMulti(['bentype'], function (a) { return a.benTypeIds; });
    } else {
      var pool = PROJECTS.filter(function (p) { return projectPassesFacets(p, false, progIso, false, true); });   // skip own bentype selection
      counts = {};
      pool.forEach(function (p) { (p.benTypeIds || []).forEach(function (id) { counts[id] = (counts[id] || 0) + 1; }); });
    }
    var types = benTypes();
    if (!types.length) { host.appendChild(el('div', 'empty', 'No beneficiary measures defined yet.')); return; }
    var maxN = 1; types.forEach(function (t) { if ((counts[t.id] || 0) > maxN) maxN = counts[t.id] || 0; });
    types.forEach(function (t) {
      var col = benColor(t.id);   // shared beneficiary colour identity (see benColor)
      host.appendChild(facetRow({
        checkbox: true, checked: S.selBenType.has(t.id), color: col, name: t.name,
        count: counts[t.id] || 0, barPct: (counts[t.id] || 0) / maxN, barColor: col, selected: S.selBenType.has(t.id),
        onCheck: function () { toggle(S.selBenType, t.id); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('bentype', t.id); }
      }));
    });
  }

  /** Generic flat checklist facet (status / level / type). Zero-count items stay
   *  visible (shown as 0) - only search would narrow, and these have no search. */
  function renderSimpleFacet(hostId, sel, skipDim, keyOf, items, openKind, actKeyFn) {
    var host = $('#' + hostId); if (!host) return; host.innerHTML = '';
    // counts = DISTINCT projects per option (or activities when S.countBasis says so).
    var counts;
    if (isActs() && actKeyFn) {
      counts = actCountsBy([skipDim], actKeyFn);
    } else {
      var sets = {};
      facetPool([skipDim]).forEach(function (r) { accProjects(sets, keyOf(r), r.projectIds); });
      counts = finalizeCounts(sets);
    }
    var maxN = 1; items.forEach(function (it) { if ((counts[it.key] || 0) > maxN) maxN = counts[it.key] || 0; });
    items.forEach(function (it) {
      host.appendChild(facetRow({
        checkbox: true, checked: sel.has(it.key), color: it.color, name: it.label,
        count: counts[it.key] || 0, barPct: (counts[it.key] || 0) / maxN, barColor: it.color, selected: sel.has(it.key),
        onCheck: function () { toggle(sel, it.key); S.page = 0; renderAll(); },
        onOpen: openKind ? function () { openEntitySummary(openKind, it.key); } : null
      }));
    });
  }
  function renderStatusFacet() {
    renderSimpleFacet('facetStatus', S.selStatus, 'status', function (r) { return r.status; },
      ['blue','green','amber','red','maroon','nodata'].map(function (k) { return { key: k, label: STATUS[k].label, color: STATUS[k].c }; }), 'status',
      function (a) { return a.status; });
  }
  /** Filter tree: SDG (= impact) → (expand) Outcome → Output. The impact
   *  statement is the SDG's description (shown on hover). Every node is a
   *  checkbox that filters indicators in its subtree. */
  function renderFrameworkFacet() {
    var host = $('#facetLevel'); host.innerHTML = '';
    // node counts = DISTINCT projects rolling up under each framework node (or
    // activities when S.countBasis says so).
    var kc;
    if (isActs()) {
      kc = actCountsByMulti(['nodes'], function (a) { return a.chainKeys; });
    } else {
      var pool = facetPool(['nodes']);   // cross-filtered by the other facets
      var kcSets = {}; pool.forEach(function (r) { r.chainKeys.forEach(function (k) { accProjects(kcSets, k, r.projectIds); }); });
      kc = finalizeCounts(kcSets);
    }
    var q = (S.qSdg || '').toLowerCase();
    var hit = function (txt) { return !q || String(txt).toLowerCase().indexOf(q) >= 0; };

    var maxS = 1; FRAMEWORK.forEach(function (sg) { var c = kc['sdg' + SEP + sg.sdg] || 0; if (c > maxS) maxS = c; });
    FRAMEWORK.forEach(function (sg) {
      var sk = 'sdg' + SEP + sg.sdg, sc = kc[sk] || 0, col = sg.sdg ? PILLAR_COLORS[sg.sdg] : '#94a3b8';
      // zero-count items are NOT hidden - they show a value of 0 (only search narrows)
      var matchDesc = hit(sg.name) || hit(sg.impact) || sg.outcomes.some(function (oc) { return hit(oc.stmt) || oc.outputs.some(hit); });
      if (!matchDesc) return;
      var sopen = S.expandSdg.has(String(sg.sdg)) || (!!q);
      host.appendChild(facetRow({
        cat: true,
        expandable: true, open: sopen, checkbox: true, checked: S.selNodes.has(sk),
        // Pillar label only (single line); impact statement kept in the tooltip
        color: col, name: sg.name, title: sg.name + (sg.impact ? '\n' + sg.impact : ''),
        count: sc, barPct: sc / maxS, barColor: col,
        selected: S.selNodes.has(sk),
        onExpand: function () { toggle(S.expandSdg, String(sg.sdg)); renderFrameworkFacet(); persist(); },
        onCheck: function () { toggle(S.selNodes, sk); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('node', sk); }
      }));
      if (!sopen) return;
      var subO = el('div', 'subrow');
      var maxO = 1; sg.outcomes.forEach(function (oc) { var c = kc['outcome' + SEP + oc.stmt] || 0; if (c > maxO) maxO = c; });
      sg.outcomes.forEach(function (oc) {
        var ok = 'outcome' + SEP + oc.stmt, occ = kc[ok] || 0;
        var oopen = S.expandOutcome.has(oc.stmt) || (!!q);
        var ocol = shadeByKey(col, oc.stmt, 0.28);
        subO.appendChild(facetRow({
          expandable: true, open: oopen, checkbox: true, checked: S.selNodes.has(ok),
          color: ocol, name: oc.stmt, title: oc.stmt, count: occ, barPct: occ / maxO, barColor: ocol,
          selected: S.selNodes.has(ok),
          onExpand: function () { toggle(S.expandOutcome, oc.stmt); renderFrameworkFacet(); persist(); },
          onCheck: function () { toggle(S.selNodes, ok); S.page = 0; renderAll(); },
          onOpen: function () { openEntitySummary('node', ok); }
        }));
        if (!oopen) return;
        var subP = el('div', 'subrow');
        var maxP = 1; oc.outputs.forEach(function (op) { var c = kc['output' + SEP + op] || 0; if (c > maxP) maxP = c; });
        oc.outputs.forEach(function (op) {
          var pk = 'output' + SEP + op, pc = kc[pk] || 0;
          var pcol = shadeByKey(col, op, 0.5);
          subP.appendChild(facetRow({
            checkbox: true, checked: S.selNodes.has(pk),
            color: pcol, name: op, title: op, count: pc, barPct: pc / maxP, barColor: pcol,
            selected: S.selNodes.has(pk),
            onCheck: function () { toggle(S.selNodes, pk); S.page = 0; renderAll(); },
            onOpen: function () { openEntitySummary('node', pk); }
          }));
        });
        subO.appendChild(subP);
      });
      host.appendChild(subO);
    });
  }

  function renderProgFacet() {
    var host = $('#facetProg'); host.innerHTML = '';
    var q = S.qProg.toLowerCase();
    // group by region
    var regions = {};
    DB.tables.programme.forEach(function (p) {
      (regions[p.region] = regions[p.region] || []).push(p);
    });
    var regionOrder = REGION_ORDER;
    // counts = DISTINCT projects per programme; region totals = distinct projects
    // in the region (counted directly, not summed from programmes, so a project
    // spanning programmes isn't double-counted). In activities basis both count
    // measurements instead - a measurement belongs to one programme/region, so
    // summing never double-counts.
    var counts, regTotals;
    if (isActs()) {
      counts = actCountsBy(['prog','region','country'], function (a) { return a.progId; });
      regTotals = actCountsBy(['prog','region','country'], function (a) { return a.region; });
    } else {
      var progSets = {}, regSets = {};
      facetPool(['prog','region','country']).forEach(function (r) {
        accProjects(progSets, r.programme && r.programme.id, r.projectIds);
        accProjects(regSets, r.region, r.projectIds);
      });
      counts = finalizeCounts(progSets);
      regTotals = finalizeCounts(regSets);
    }
    var maxRegion = 1;
    regionOrder.forEach(function (rg) { regTotals[rg] = regTotals[rg] || 0; if (regTotals[rg] > maxRegion) maxRegion = regTotals[rg]; });
    regionOrder.forEach(function (rg) {
      // zero-count regions/programmes are NOT hidden - they show a value of 0 (only search narrows)
      var progs = (regions[rg] || []).filter(function (p) {
        return !q || p.name.toLowerCase().indexOf(q) >= 0 || rg.toLowerCase().indexOf(q) >= 0;
      });
      // when searching, drop regions that neither match nor contain a match
      if (q && !progs.length && rg.toLowerCase().indexOf(q) < 0 && !S.selRegion.has(rg)) return;
      var open = S.expandRegion.has(rg) || !!q;
      var domColor = regionColor(rg);
      var row = facetRow({
        cat: true, expandable: true, open: open,
        checkbox: true, checked: S.selRegion.has(rg),
        color: domColor, name: regionFull(rg), title: regionFull(rg), count: regTotals[rg],
        barPct: regTotals[rg] / maxRegion, barColor: domColor,
        selected: S.selRegion.has(rg),
        onExpand: function () { if (S.expandRegion.has(rg)) S.expandRegion.delete(rg); else S.expandRegion.add(rg); renderProgFacet(); persist(); },
        onCheck: function () { toggle(S.selRegion, rg); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('region', rg); }
      });
      host.appendChild(row);
      if (open) {
        var sub = el('div', 'subrow');
        var maxP = 1; progs.forEach(function (p) { if ((counts[p.id]||0) > maxP) maxP = counts[p.id]||0; });
        // More/Less within a region whose country list exceeds the reveal window
        var pTotal = progs.length, pWin = q ? pTotal : Math.min(S.progShown[rg] || FACET_PAGE, pTotal);
        var pShown = progs.slice(0, pWin);
        progs.forEach(function (p) { if (S.selProg.has(p.id) && pShown.indexOf(p) < 0) pShown.push(p); });   // keep selected visible
        pShown.forEach(function (p) {
          var col = p.country_iso3 ? countryColor(p.country_iso3) : regionColor(rg);
          // under a region, list only the country name (no suffix)
          var co = p.country_iso3 ? DB._idx.countryByIso[p.country_iso3] : null;
          var cname = co ? co.name : p.name.replace(/\s*Country Programme\s*$/i, '');
          sub.appendChild(facetRow({
            checkbox: true, checked: S.selProg.has(p.id),
            color: col, name: cname, title: cname, count: counts[p.id] || 0,
            barPct: (counts[p.id]||0)/maxP, barColor: col,
            selected: S.selProg.has(p.id),
            onCheck: function () { toggle(S.selProg, p.id); S.page = 0; renderAll(); },
            onOpen: function () { openEntitySummary('programme', p.id); }
          }));
        });
        host.appendChild(sub);
        if (!q) facetMoreLess(host, pWin, pTotal,
          function () { return S.progShown[rg] || FACET_PAGE; }, function (v) { S.progShown[rg] = v; }, renderProgFacet);
      }
    });
  }

  function facetRow(o) {
    var row = el('div', 'facet' + (o.cat ? ' cat' : '') + (o.selected ? ' sel' : ''));
    // expander (or an equal-width spacer so items line up across levels)
    if (o.expandable) {
      var ex = el('button', 'exp', o.open ? '–' : '+');
      ex.title = o.open ? 'Collapse' : 'Expand';
      ex.onclick = function (e) { e.stopPropagation(); o.onExpand(); };
      row.appendChild(ex);
    } else {
      row.appendChild(el('span', 'exp-sp'));
    }
    if (o.checkbox) {
      var cb = el('input'); cb.type = 'checkbox'; cb.checked = o.checked; cb.tabIndex = -1;
      cb.title = 'Check to filter by this';
      // the checkbox is the FILTER control; clicking it must not also open the summary
      cb.onclick = function (e) { e.stopPropagation(); if (o.onCheck) o.onCheck(); };
      row.appendChild(cb);
    }
    var sq = el('span', 'sq'); sq.style.background = o.color; row.appendChild(sq);
    if (o.desc) {
      var wrap = el('span', 'nmwrap');
      var nm = el('span', 'nm', o.name); wrap.appendChild(nm);
      wrap.appendChild(el('span', 'nmdesc', o.desc));
      wrap.title = o.title || o.name; row.appendChild(wrap);
    } else {
      var nm2 = el('span', 'nm', o.name); nm2.title = o.title || o.name; row.appendChild(nm2);
    }
    row.appendChild(el('span', 'ct', fmt(o.count)));
    var bar = el('span', 'bar'); var i = el('i');
    i.style.width = Math.max(3, Math.round((o.barPct||0) * 100)) + '%'; i.style.background = o.barColor;
    bar.appendChild(i); row.appendChild(bar);
    // clicking the checkbox filters; clicking the row body opens the item's
    // results summary. Rows without a summary (e.g. group headers) fall back to
    // toggling the filter, then to expand/collapse.
    if (o.onOpen) { row.classList.add('openable'); row.onclick = function () { o.onOpen(); }; }
    else if (o.onCheck) row.onclick = function () { o.onCheck(); };
    else if (o.onExpand) row.onclick = function () { o.onExpand(); };
    return row;
  }

  var FACET_PAGE = 10;   // reveal window step for the More/Less controls
  /** Append a "＋ N more / − less" control to a truncated facet list.
   *  window = items currently revealed; total = items available. `get`/`set`
   *  read & write the persisted reveal count; the facet re-renders on change. */
  function facetMoreLess(host, window, total, get, set, rerender) {
    if (total <= FACET_PAGE) return;
    var ctr = el('div', 'facet-more');
    if (window < total) {
      var n = Math.min(FACET_PAGE, total - window);
      var more = el('button', 'moreless', '＋ ' + n + ' more');
      more.title = (total - window) + ' more';
      more.onclick = function () { set(Math.min(total, get() + FACET_PAGE)); rerender(); persist(); };
      ctr.appendChild(more);
    }
    if (window > FACET_PAGE) {
      var less = el('button', 'moreless', '− less');
      less.onclick = function () { set(Math.max(FACET_PAGE, get() - FACET_PAGE)); rerender(); persist(); };
      ctr.appendChild(less);
    }
    host.appendChild(ctr);
  }

  /** KPI Inventory - a FLAT list of KPIs (no pillar grouping); filters by name.
   *  Shows the top N (most-reported) with More/Less; search reveals all matches. */
  function renderKpiFacet() {
    var host = $('#facetKpi'); if (!host) return; host.innerHTML = '';
    // count per KPI name = DISTINCT projects using that KPI (or activities reported
    // against it when S.countBasis says so).
    var poolCounts;
    if (isActs()) {
      poolCounts = actCountsBy(['kpi'], function (a) { return a.name; });
    } else {
      var poolSets = {};
      facetPool(['kpi']).forEach(function (r) { accProjects(poolSets, r.name, r.projectIds); });
      poolCounts = finalizeCounts(poolSets);
    }
    var pillarOf = {};   // full KPI universe → its pillar (for the identity shade)
    IND.forEach(function (r) { if (pillarOf[r.name] == null) pillarOf[r.name] = r.sdg || 0; });
    var q = (S.qKpi || '').toLowerCase();
    var names = Object.keys(pillarOf).filter(function (n) { return !q || n.toLowerCase().indexOf(q) >= 0; });
    names.sort(function (a, b) { return (poolCounts[b] || 0) - (poolCounts[a] || 0) || (a < b ? -1 : 1); });   // top = most reported
    var total = names.length;
    var window = q ? total : Math.min(S.kpiShown, total);   // items revealed by the More/Less window
    var shown = names.slice(0, window);
    names.forEach(function (n) { if (S.selKpi.has(n) && shown.indexOf(n) < 0) shown.push(n); });   // keep selected visible
    var maxN = 1; shown.forEach(function (n) { if ((poolCounts[n] || 0) > maxN) maxN = poolCounts[n] || 0; });
    shown.forEach(function (n) {
      var s = pillarOf[n], col = s ? shadeByKey(PILLAR_COLORS[s], n, 0.5) : '#94a3b8';
      host.appendChild(facetRow({
        checkbox: true, checked: S.selKpi.has(n), color: col, name: n, title: n,
        count: poolCounts[n] || 0, barPct: (poolCounts[n] || 0) / maxN, barColor: col, selected: S.selKpi.has(n),
        onCheck: function () { toggle(S.selKpi, n); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('kpi', n); }
      }));
    });
    // More / Less (hidden while searching - search already reveals every match)
    if (!q) facetMoreLess(host, window, total,
      function () { return S.kpiShown; }, function (v) { S.kpiShown = v; }, renderKpiFacet);
  }

  /** Reported By - users grouped by Section; selecting filters by reporter. */
  function renderUserFacet() {
    var host = $('#facetUser'); if (!host) return; host.innerHTML = '';
    // per-user count = DISTINCT projects the user reported on (or activities the
    // user logged when S.countBasis says so). In projects basis userSets is kept
    // (not just finalized) so a section header can union its members' projects.
    var acts = isActs(), userSets = {}, counts;
    if (acts) {
      counts = actCountsBy(['user'], function (a) { return a.reporterId; });
    } else {
      var pool = IND.filter(function (r) { return passAll(r, ['user']); });
      pool.forEach(function (r) {
        var reporters = {};
        (r.series || []).forEach(function (m) { if (!measInTimeRange(m)) return; if (m.reported_by_id != null) reporters[m.reported_by_id] = 1; });
        Object.keys(reporters).forEach(function (id) { accProjects(userSets, id, r.projectIds); });
      });
      counts = finalizeCounts(userSets);
    }
    var q = (S.qUser || '').toLowerCase();
    var sections = [['hq', 'Section'], ['co', 'Country Offices']];
    sections.forEach(function (rl) {
      var section = rl[0];
      var us = DB.tables.user.filter(function (u) {
        if (userSection(u) !== section) return false;
        // zero-count users are NOT hidden - they show a value of 0 (only search narrows)
        return !q || u.name.toLowerCase().indexOf(q) >= 0 || (u.country_iso3 || '').toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return (counts[b.id] || 0) - (counts[a.id] || 0) || (a.name < b.name ? -1 : 1); });
      if (!us.length) return;
      // section total: activities basis sums per-user counts (each activity has ONE
      // reporter, so no double-count); projects basis unions the members' project
      // sets (a sum would double-count a project two members both reported on).
      var total;
      if (acts) { total = us.reduce(function (s, u) { return s + (counts[u.id] || 0); }, 0); }
      else {
        var stot = {};
        us.forEach(function (u) { var s = userSets[u.id]; if (s) Object.keys(s).forEach(function (pid) { stot[pid] = 1; }); });
        total = Object.keys(stot).length;
      }
      var base = section === 'hq' ? '#9D7BEE' : '#8FA3C4';
      var open = S.expandUserRole.has(section) || !!q;
      host.appendChild(facetRow({
        cat: true, expandable: true, open: open, color: base, name: rl[1], count: total, barPct: 1, barColor: base,
        onExpand: function () { toggle(S.expandUserRole, section); renderUserFacet(); persist(); }
      }));
      if (!open) return;
      var sub = el('div', 'subrow');
      var maxN = 1; us.forEach(function (u) { if ((counts[u.id] || 0) > maxN) maxN = counts[u.id] || 0; });
      // reveal window (per section) - long sections (e.g. 56 country offices) page 10 at a time
      var window = q ? us.length : Math.min(S.userShown[section] || FACET_PAGE, us.length);
      var shown = us.slice(0, window);
      us.forEach(function (u) { if (S.selUser.has(u.id) && shown.indexOf(u) < 0) shown.push(u); });   // keep selected visible
      shown.forEach(function (u) {
        var col = userColor(u);
        sub.appendChild(facetRow({
          checkbox: true, checked: S.selUser.has(u.id), color: col,
          name: u.name + (u.country_iso3 ? ' · ' + u.country_iso3 : ''), title: u.name,
          count: counts[u.id] || 0, barPct: (counts[u.id] || 0) / maxN, barColor: col, selected: S.selUser.has(u.id),
          onCheck: function () { toggle(S.selUser, u.id); S.page = 0; renderAll(); },
          onOpen: function () { openEntitySummary('user', u.id); }
        }));
      });
      host.appendChild(sub);
      if (!q) facetMoreLess(host, window, us.length,
        function () { return S.userShown[section] || FACET_PAGE; },
        function (v) { S.userShown[section] = v; }, renderUserFacet);
    });
  }

  // =========================================================================
  //  RIGHT PANE - Progress / Results (user report transactions)
  // =========================================================================
  function measInTimeRange(m) {
    var b = timeBounds();
    if (b.start == null && b.end == null) return true;
    if (!m.date) return false;
    var d = Date.parse(m.date);
    if (b.start != null && d < b.start) return false;
    if (b.end != null && d > b.end) return false;
    return true;
  }

  // soft, low-intensity pill: light tint background + readable coloured ink
  function softTag(elm, color){ elm.style.background = shade(color, 0.74); elm.style.color = shade(color, -0.32); }

  // set of ISO3 for the currently-selected programmes (selProg holds programme ids)
  function progIsoSet() {
    var s = {};
    S.selProg.forEach(function (pid) { var p = DB._idx.programmeById[pid]; if (p && p.country_iso3) s[p.country_iso3] = 1; });
    return s;
  }

  /** Does a project pass the active facets? Country/region/donor are matched on
   *  the project itself; KPI-level facets (framework node / impact / KPI / status /
   *  type / reporter) require the project to own at least one KPI that passes. */
  function projectPassesFacets(p, skipDonor, progIso, skipProject, skipBenType) {
    if (S.selRegion.size && !S.selRegion.has(p.region)) return false;
    if (S.selCountry && p.iso !== S.selCountry) return false;
    if (S.selProg.size && !(progIso || progIsoSet())[p.iso]) return false;
    if (!skipDonor && S.selDonor.size && !(p.donor && S.selDonor.has(p.donor.id))) return false;
    if (!skipProject && S.selProject.size && !S.selProject.has(p.id)) return false;
    // Project Beneficiaries: keep a project only when one of its OWN activities
    // logged a selected beneficiary type (see p.benTypeIds in buildProjects). This
    // is a project-level test, NOT a KPI-level one - a shared primary KPI's types
    // may come from another project's activities, so it can't answer this.
    if (!skipBenType && S.selBenType.size && !(p.benTypeIds || []).some(function (id) { return S.selBenType.has(id); })) return false;
    var kpiFacets = S.selNodes.size || S.selSdg.size || S.selKpi.size || S.selUser.size || S.selStatus.size || S.selType.size;
    if (kpiFacets) {
      // Skip the project-level dims here (already handled above) to avoid
      // double-filtering.
      var pool = p.kpis;
      var hit = pool.some(function (r) { return inTimeRange(r) && passAll(r, ['region', 'prog', 'country', 'donor', 'project', 'bentype']); });
      if (!hit) return false;
    }
    return true;
  }

  /** Filtered + searched list of enriched projects for the right pane. */
  function projectsFor() {
    var q = (S.qList || '').toLowerCase(), progIso = progIsoSet();
    return PROJECTS.filter(function (p) {
      if (!projectPassesFacets(p, false, progIso)) return false;
      if (q) {
        var co = p.country ? p.country.name : '';
        var hay = (p.code + ' ' + p.name + ' ' + (p.donor ? p.donor.name : '') + ' ' + co + ' ' + (p.raw.lead || '')).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function projStat(p) { return p.statAll; }
  function sortProjects(list) {
    var s = S.sort, dir = S.sortDir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (s === 'budget') { av = a.budget || 0; bv = b.budget || 0; }
      else if (s === 'progress') { av = projStat(a).frac == null ? -1 : projStat(a).frac; bv = projStat(b).frac == null ? -1 : projStat(b).frac; }
      else if (s === 'kpis') { av = a.kpis.length; bv = b.kpis.length; }
      else { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }   // name
      return av < bv ? -dir : (av > bv ? dir : 0);
    });
  }
  function defaultSortDir(s) { return s === 'name' ? 'asc' : 'desc'; }

  // sort fields per pane mode - rebuilt into #sorts whenever the mode changes
  var PROJECT_SORTS = [['name','Name'],['budget','Budget'],['progress','Progress'],['kpis','KPIs']];
  var KPI_SORTS = [['name','Name'],['progress','Progress'],['performance','Performance'],['activities','Activities']];
  function curSortSpec() {
    return S.listMode === 'kpis'
      ? { specs: KPI_SORTS, sort: S.kpiSort, dir: S.kpiSortDir }
      : { specs: PROJECT_SORTS, sort: S.sort, dir: S.sortDir };
  }
  function renderSortButtons() {
    var host = $('#sorts'); if (!host) return;
    Array.prototype.slice.call(host.querySelectorAll('button')).forEach(function (b) { b.remove(); });
    var cs = curSortSpec();
    cs.specs.forEach(function (sp) {
      var on = sp[0] === cs.sort;
      var b = el('button', on ? 'on' : null, sp[1] + (on ? (cs.dir === 'asc' ? ' ↑' : ' ↓') : ''));
      b.dataset.sort = sp[0]; b.dataset.label = sp[1];
      host.appendChild(b);
    });
  }

  function renderList() {
    var host = $('#list'); host.innerHTML = '';
    var cf = $('#clearFilters'); if (cf) cf.classList.toggle('on', hasFilters());
    // portfolio metric in the sub-bar follows the count basis (projects | activities)
    var ml = $('#metricLabel');
    if (isActs()) {
      $('#metricN').textContent = fmt(actPool([]).length);
      if (ml) ml.textContent = 'ACTIVITIES';
    } else {
      $('#metricN').textContent = fmt(projectsFor().length);
      if (ml) ml.textContent = 'PROJECTS';
    }
    if (S.listMode === 'kpis') { renderKpiList(host); return; }
    var pt = $('#paneTitle'); if (pt) pt.textContent = 'Projects';
    var projects = sortProjects(projectsFor());
    var total = projects.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (S.page >= pages) S.page = pages - 1;
    if (S.page < 0) S.page = 0;
    var slice = projects.slice(S.page * PAGE, S.page * PAGE + PAGE);
    if (!slice.length) { host.appendChild(el('div', 'empty', 'No projects match the current filters.')); }
    slice.forEach(function (p) { host.appendChild(projectCard(p)); });
    $('#pgInfo').textContent = (S.page + 1) + ' / ' + pages;
    var rc = $('#reportCount'); if (rc) rc.textContent = fmt(total) + ' project' + (total === 1 ? '' : 's');
  }

  // ---- KPI pane: same page/sort machinery, KPI cards instead of project cards --
  function sortKpis(list) {
    var s = S.kpiSort, dir = S.kpiSortDir === 'asc' ? 1 : -1;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (s === 'progress') { av = a.progress == null ? -1 : a.progress; bv = b.progress == null ? -1 : b.progress; }
      else if (s === 'performance') { av = a.performance == null ? -1 : a.performance; bv = b.performance == null ? -1 : b.performance; }
      else if (s === 'activities') { av = (a.series || []).length; bv = (b.series || []).length; }
      else { av = (a.name || '').toLowerCase(); bv = (b.name || '').toLowerCase(); }
      return av < bv ? -dir : (av > bv ? dir : 0);
    });
  }
  function renderKpiList(host) {
    var pt = $('#paneTitle'); if (pt) pt.textContent = 'Primary KPIs';
    var kpis = sortKpis(primaryKpisFor());
    var total = kpis.length;
    var pages = Math.max(1, Math.ceil(total / PAGE));
    if (S.page >= pages) S.page = pages - 1;
    if (S.page < 0) S.page = 0;
    var slice = kpis.slice(S.page * PAGE, S.page * PAGE + PAGE);
    if (!slice.length) { host.appendChild(el('div', 'empty', 'No primary KPIs match the current filters.')); }
    slice.forEach(function (r) { host.appendChild(kpiCard(r, cap(r.type))); });
    $('#pgInfo').textContent = (S.page + 1) + ' / ' + pages;
    var rc = $('#reportCount'); if (rc) rc.textContent = fmt(total) + ' primary KPI' + (total === 1 ? '' : 's');
  }
  // small "Progress/Perf. - P%" chip with a status dot (mirrors aggChip)
  function kpiChip(label, frac, code) {
    var chip = el('span', 'pagg-chip');
    var d = el('span', 'pagg-dot'); d.style.background = STATUS[code || 'nodata'].c; chip.appendChild(d);
    chip.appendChild(el('b', null, label));
    chip.appendChild(document.createTextNode(' ' + (frac != null ? Math.round(frac * 100) + '%' : '–')));
    return chip;
  }
  function kpiCard(r, tagOverride) {
    var c = el('div', 'card pcard kcard');
    c.style.setProperty('--sc', STATUS[r.status].c);

    // header: code · name + a small context tag (defaults to level / secondary)
    var ch = el('div', 'ch');
    ch.appendChild(el('div', 'tt', (r.raw.code ? r.raw.code + ' · ' : '') + r.name));
    var tag = tagOverride != null ? tagOverride : (r.secondary ? 'secondary' : (r.level || ''));
    ch.appendChild(el('span', 'dt', tag));
    c.appendChild(ch);

    // country + project count (or programme)
    var co = r.iso ? DB._idx.countryByIso[r.iso] : null;
    var meta = el('div', 'rmeta');
    var who = el('span', 'rby');
    var dot = el('span', 'rdot'); dot.style.background = r.sdg ? PILLAR_COLORS[r.sdg] : '#94a3b8'; who.appendChild(dot);
    who.appendChild(document.createTextNode(co ? co.name : (r.iso || '–')));
    meta.appendChild(who);
    var np = (r.projectIds || []).length;
    meta.appendChild(el('span', 'rval', np ? (fmt(np) + ' project' + (np === 1 ? '' : 's')) : (r.programme ? r.programme.name : '')));
    c.appendChild(meta);

    // progress bar (achievement)
    if (r.progress != null) {
      var pct = Math.max(0, Math.min(100, Math.round(r.progress * 100)));
      var pw = el('div', 'pwrap');
      var pr = el('div', 'progress'); var pi = el('i');
      pi.style.width = Math.max(2, pct) + '%'; pi.style.background = STATUS[r.status].c;
      pr.appendChild(pi); pw.appendChild(pr);
      var pn = el('span', 'pct', pct + '%'); pn.style.color = STATUS[r.status].c; pw.appendChild(pn);
      c.appendChild(pw);
    }

    // progress + performance chips
    var agg = el('div', 'pagg');
    agg.appendChild(kpiChip('Progress', r.progress, r.progressCode));
    agg.appendChild(kpiChip('Perf.', r.performance, r.perfCode));
    c.appendChild(agg);

    // tags: latest date · activities · status
    var tags = el('div', 'tags');
    var n = (r.series || []).length;
    if (r.updated) { var dt2 = el('span', 'tag geo2', shortDate(r.updated)); softTag(dt2, '#7c8aa5'); tags.appendChild(dt2); }
    var ac = el('span', 'tag', fmt(n) + ' activit' + (n === 1 ? 'y' : 'ies')); softTag(ac, '#33C2B4'); tags.appendChild(ac);
    var stt = el('span', 'tag st', STATUS[r.status].label); softTag(stt, STATUS[r.status].c); tags.appendChild(stt);
    c.appendChild(tags);

    c.onclick = function () { openDetail(r); };
    return c;
  }

  function projectCard(p, onClick) {
    var st = projStat(p);
    var c = el('div', 'card pcard');

    // header: code · name + budget
    var ch = el('div', 'ch');
    ch.appendChild(el('div', 'tt', (p.code ? p.code + ' · ' : '') + p.name));
    ch.appendChild(el('span', 'dt', p.budget != null ? '$' + fmtBudget(p.budget) : '–'));
    c.appendChild(ch);

    // country + donor
    var meta = el('div', 'rmeta');
    var who = el('span', 'rby');
    var dot = el('span', 'rdot'); dot.style.background = countryColor(p.iso); who.appendChild(dot);
    who.appendChild(document.createTextNode(p.country ? p.country.name : p.iso));
    meta.appendChild(who);
    if (p.donor) meta.appendChild(el('span', 'rval', p.donor.short_name || p.donor.name));
    c.appendChild(meta);

    // combined progress bar (primary + secondary when included)
    if (st.frac != null) {
      var pct = Math.max(0, Math.min(100, Math.round(st.frac * 100)));
      var pw = el('div', 'pwrap');
      var pr = el('div', 'progress'); var pi = el('i');
      pi.style.width = Math.max(2, pct) + '%'; pi.style.background = STATUS[st.code].c;
      pr.appendChild(pi); pw.appendChild(pr);
      var pn = el('span', 'pct', pct + '%'); pn.style.color = STATUS[st.code].c; pw.appendChild(pn);
      c.appendChild(pw);
    }

    // separate primary / secondary aggregation line
    var agg = el('div', 'pagg');
    agg.appendChild(aggChip('Primary', p.primary.length, p.statPrimary));
    if (p.secondary.length) agg.appendChild(aggChip('Secondary', p.secondary.length, p.statSecondary));
    c.appendChild(agg);

    // tags: dates · activities · status
    var tags = el('div', 'tags');
    if (p.start || p.end) { var dt = el('span', 'tag geo2', shortDate(p.start) + ' → ' + shortDate(p.end)); softTag(dt, '#7c8aa5'); tags.appendChild(dt); }
    var ac = el('span', 'tag', fmt(p.activityN) + ' activit' + (p.activityN === 1 ? 'y' : 'ies')); softTag(ac, '#33C2B4'); tags.appendChild(ac);
    var stt = el('span', 'tag st', STATUS[st.code].label); softTag(stt, STATUS[st.code].c); tags.appendChild(stt);
    c.appendChild(tags);

    // Right-pane cards open the editable project settings; everywhere else a card
    // opens the read-only project results (openEntitySummary) via a passed handler.
    c.onclick = onClick || function () { openProject(p.raw); };
    return c;
  }
  // small "Primary/Secondary - N KPIs · P%" chip with a status dot
  function aggChip(label, n, st) {
    var chip = el('span', 'pagg-chip' + (label === 'Secondary' ? ' sec' : ''));
    var d = el('span', 'pagg-dot'); d.style.background = STATUS[st.code].c; chip.appendChild(d);
    chip.appendChild(el('b', null, label));
    chip.appendChild(document.createTextNode(' ' + fmt(n) + ' KPI' + (n === 1 ? '' : 's') + (st.frac != null ? ' · ' + Math.round(st.frac * 100) + '%' : '')));
    return chip;
  }
  // Compact budget: $5M, $3.3M, $450K (K / M / B), full digits only under 1,000.
  // Callers prepend the "$", so this returns just the magnitude string.
  function fmtBudget(v) {
    if (v == null || isNaN(+v)) return '–';
    var n = +v, neg = n < 0 ? '-' : ''; n = Math.abs(n);
    function t(x){ var r = Math.round(x * 10) / 10; return (r % 1 === 0) ? String(r) : r.toFixed(1); }
    if (n >= 1e9) return neg + t(n / 1e9) + 'B';
    if (n >= 1e6) return neg + t(n / 1e6) + 'M';
    if (n >= 1e3) return neg + t(n / 1e3) + 'K';
    return neg + fmt(Math.round(n));
  }

  // =========================================================================
  //  DETAIL MODAL
  // =========================================================================
  function levelColor(lvl){ return ({impact:'#00689D',outcome:'#2563eb',output:'#26BDE2',activity:'#93a0b5'})[lvl] || '#93a0b5'; }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function cap(s){ s = s || ''; return s.charAt(0).toUpperCase()+s.slice(1); }
  function resultChain(result){ var chain=[], cur=result; while(cur){ chain.unshift(cur); cur = cur.parent_id ? DB._idx.resultById[cur.parent_id] : null; } return chain; }

  var curDetail = null;   // indicator record currently shown in the modal
  var lastResultsExport = null;   // structured payload of the results box on screen → PDF export

  // The scope-banner "Export PDF" button, shared by every results box. Placed at
  // the end of the .chain row (pushed right by margin-left:auto) so the badge +
  // title and the ↳ summary sit on ONE line with the export control beside them.
  function chainExportBtn(){
    return '<button type="button" class="rc-export" data-export="1" title="Export this results box to a PDF file">'
      + '<span class="ic">⤓</span>Export PDF</button>';
  }
  // Attach the handler after a results box has been written into #mBody.
  function wireExportBtn(){
    var b = $('#mBody .rc-export'); if (!b) return;
    b.onclick = function (){ try { exportResultsPDF(lastResultsExport); } catch (e){ console.error(e); alert('Could not build the PDF: ' + (e && e.message || e)); } };
  }
  // Drill-down history for the detail popup: opening a project/KPI from inside a
  // results box pushes the current view, so Close / Esc / ‹ steps back to it
  // instead of dismissing the whole popup.
  var detailStack = [], curView = null, _navRestoring = false;
  function updateBackBtn(){ var b = $('#mBack'); if (b) b.style.display = detailStack.length ? '' : 'none'; }
  function navEnter(view, push){
    if (!_navRestoring){ if (push && curView) detailStack.push(curView); else if (!push) detailStack = []; }
    curView = view; updateBackBtn();
  }
  // Re-derive a KPI's figures from ONLY one project's measurements, so a primary
  // KPI opened via a specific project shows that project's results - not the
  // portfolio-wide roll-up across every project using the KPI. Returns a shallow
  // copy (inherits the unchanged fields); the enriched record is left untouched.
  function indicatorScopedToProject(r, projectId){
    if (projectId == null) return r;
    var ind = r.raw;
    var ms = DB.measurementsFor(ind.id).filter(function (m){ return m.project_id === projectId; });
    var s = Object.create(r);
    s.series = ms;
    var latest = ms.length ? ms[ms.length - 1] : null, b = ind.baseline_value, t = ind.target_value;
    if (!latest || t === b){
      s.value = null; s.updated = null; s.progress = null; s.performance = null;
      s.progressCode = 'nodata'; s.perfCode = 'nodata'; s.status = 'nodata';
      return s;
    }
    var v = indicatorValue(ind, ms);
    var progress = (v - b) / (t - b), elapsed = elapsedFraction(ind);
    var performance = elapsed > 0 ? progress / elapsed : progress;
    s.value = v; s.updated = latest.date;
    s.progress = progress; s.performance = performance;
    s.progressCode = ratioToCode(progress); s.perfCode = ratioToCode(performance);
    s.status = ratioToCode(S.perfBasis === 'progress' ? progress : performance);
    return s;
  }
  function openDetail(r, push, projectId){
    navEnter({ t: 'kpi', id: r.id, projectId: projectId }, push);
    curDetail = r;                                  // tabs (Projects / Activities) use the full indicator
    r = indicatorScopedToProject(r, projectId);     // the body shows this project's results only
    var _tabs = $('#mTabs'); if (_tabs) _tabs.style.display = 'none';   // match the generic results box - no tabs
    $('#mProjects').classList.add('hide'); $('#mResults').classList.add('hide');
    $('#mBody').classList.remove('hide');
    var ind = r.raw;
    var co = r.iso ? DB._idx.countryByIso[r.iso] : null;
    var scopeProj = projectId != null ? PROJECTSBYID[projectId] : null;
    var titleTxt = (ind.code ? ind.code + ' · ' : '') + r.name;
    $('#mTitle').textContent = titleTxt;
    $('#mSub').textContent = scopeProj
      ? (scopeProj.code ? scopeProj.code + ' · ' + scopeProj.name : scopeProj.name)
      : (co ? co.name : '');
    $('#mImpact').textContent = '';

    var html = '';

    // single-line scope banner - identical shape to the location box.
    var badgeTxt = r.secondary ? 'Secondary' : 'Primary';
    var badgeBg = r.secondary ? 'var(--kpi-sec-bg)' : 'var(--kpi-pri-bg)';
    var badgeFg = r.secondary ? 'var(--kpi-sec)' : 'var(--kpi-pri)';
    // The activities shown are this KPI's, narrowed to whatever the sidebar is
    // filtering - the box is a window onto the current slice, not the whole plan.
    var actsAllN = (r.series || []).length;
    var acts = filteredSeries([r]).sort(function (a, b){ return (a.date < b.date) ? 1 : -1; });
    var actN = acts.length;
    var kidsTxt = ofTotal(actN, actsAllN, 'activity', 'activities')
      + (scopeProj ? '  ·  ' + (scopeProj.code || scopeProj.name) : '');
    html += '<div class="chain"><div class="lnk here">'
      + '<span class="badge" style="background:' + badgeBg + ';color:' + badgeFg + '">' + badgeTxt + '</span>'
      + '<span class="txt">' + esc(titleTxt) + '</span></div>'
      + '<div class="kids">↳ ' + esc(kidsTxt) + '</div>'
      + chainExportBtn() + '</div>'
      + filterStripHTML();

    // activities logged against this KPI - the EXACT same page as the location box:
    // scope banner then the shared activities block (#/Location/Activity/Value/Date/
    // Project/KPI + beneficiary heat-map), scoped here to THIS KPI instead of a
    // location. No stat cards - the KPI's baseline/target/trend live in Details/edit.
    var actHead = 'Activities - ' + ofTotal(actN, actsAllN, 'activity', 'activities').replace(/ activit(y|ies)$/, '');
    var block = activitiesResultBlock(acts, {
      head: actHead,
      emptyMsg: actsAllN ? 'No activities for this KPI match the active filters.'
                         : 'No activities logged for this KPI yet.'
    });
    html += block.html;

    lastResultsExport = {
      badge: badgeTxt, badgeColor: (r.secondary ? '#27500a' : '#0c447c'),
      title: titleTxt, sub: (scopeProj ? (scopeProj.code ? scopeProj.code + ' · ' + scopeProj.name : scopeProj.name) : (co ? co.name : '')),
      summary: kidsTxt, filters: activeFilterSummary(), stats: [], section: actHead,
      columns: block.columns, rows: block.rows, note: block.note, table2: block.benTable, grid: true
    };

    $('#mBody').innerHTML = html;
    wireExportBtn();
    // Copy the ACTUAL rendered column widths onto the export spec so the PDF keeps
    // the on-screen proportions for both the activities table and the heat-map.
    captureColWidths($('#mBody .esum-static'), lastResultsExport.columns);
    if (lastResultsExport.table2) captureColWidths($('#mBody .ben-heat'), lastResultsExport.table2.columns);
    $('#mBody').scrollTop = 0;
    $('#modal').classList.add('on');
  }
  // ‹ Back - step back one drill-down level (restore the previous view).
  function navBack(){
    if (!detailStack.length){ closeDetail(); return; }
    var prev = detailStack.pop();
    _navRestoring = true;
    if (prev.t === 'entity') openEntitySummary(prev.kind, prev.key);
    else if (prev.t === 'location') openLocationSummary(prev.cluster, false);
    else { var r = INDBYID[prev.id]; if (r) openDetail(r, false, prev.projectId); }
    _navRestoring = false;
    curView = prev; updateBackBtn();
  }
  // × Close - always dismiss the whole popup, whatever the drill-down depth.
  function closeDetail(){
    detailStack = []; curView = null; updateBackBtn();
    $('#modal').classList.remove('on');
    clearProjectHash();   // drop any #project/<id> so a refresh won't re-open it
  }

  // =========================================================================
  //  ENTITY SUMMARY - clicking a filter-pane item name (not its checkbox)
  //  opens a read-only "results" summary in the detail popup, using the same
  //  visual template as the KPI / output detail. Every facet kind resolves to
  //  a set of KPIs + projects, then shares one renderer.
  // =========================================================================
  function aggMetric(list, field){
    var s = 0, n = 0;
    list.forEach(function (r){ if (r[field] != null){ s += r[field]; n++; } });
    return n ? s / n : null;
  }
  // Resolve a facet item → { title, sub, color, badge, inds, projs, activities? }
  function entityScope(kind, key){
    var inds = [], projs = [], title = '', sub = '', color = '#7c8aa5', badge = kind, activities = null;
    var projsOfInds = function (list){
      var seen = {}; list.forEach(function (r){ (r.projectIds || []).forEach(function (id){ seen[id] = 1; }); });
      return PROJECTS.filter(function (p){ return seen[p.id]; });
    };
    // Kinds whose project list is DERIVED from their KPIs must re-derive it after
    // the filters thin those KPIs out; the rest own an independent project list.
    var projsFromInds = false;
    // Scopes the entity's activities further than the global filters do - a user
    // box counts only what that user logged, a beneficiary box only what recorded
    // that type, a project box only that project's own reports.
    var actScope = null;
    if (kind === 'region'){
      inds = IND.filter(function (r){ return r.region === key; });
      projs = PROJECTS.filter(function (p){ return p.region === key; });
      title = regionFull(key); sub = 'Region'; color = regionColor(key); badge = 'region';
    } else if (kind === 'programme'){
      var pg = DB._idx.programmeById[key], iso = pg ? pg.country_iso3 : null;
      inds = IND.filter(function (r){ return r.programme && r.programme.id === key; });
      projs = PROJECTS.filter(function (p){ return iso && p.iso === iso; });
      var co = iso ? DB._idx.countryByIso[iso] : null;
      title = co ? co.name : (pg ? pg.name : 'Programme');
      sub = 'Country programme' + (pg && pg.region ? '  ·  ' + regionFull(pg.region) : '');
      color = iso ? countryColor(iso) : color; badge = 'country';
    } else if (kind === 'donor'){
      var d = DB._idx.donorById[key];
      projs = PROJECTS.filter(function (p){ return p.donor && p.donor.id === key; });
      inds = IND.filter(function (r){ return (r.donorIds || []).indexOf(key) >= 0; });
      title = d ? d.name : 'Donor'; sub = d ? (cap(d.type || '') + ' donor') : 'Donor';
      color = (d && d.color) || color; badge = 'donor';
    } else if (kind === 'status'){
      inds = IND.filter(function (r){ return r.status === key; });
      projsFromInds = true;
      title = STATUS[key] ? STATUS[key].label : key; sub = 'Performance status';
      color = STATUS[key] ? STATUS[key].c : color; badge = 'status';
    } else if (kind === 'node'){
      inds = IND.filter(function (r){ return (r.chainKeys || []).indexOf(key) >= 0; });
      projsFromInds = true;
      var parts = key.split(SEP), lvl = parts[0], val = parts.slice(1).join(SEP);
      if (lvl === 'sdg'){ title = PILLAR_NAMES[val] || ('Pillar ' + val); sub = 'Impact · Pillar'; color = PILLAR_COLORS[val] || color; badge = 'impact'; }
      else { title = val; sub = cap(lvl); color = levelColor(lvl); badge = lvl; }
    } else if (kind === 'project'){
      var p = PROJECTSBYID[key];
      projs = p ? [p] : []; inds = p ? p.kpis.slice() : [];
      title = p ? ((p.code ? p.code + ' · ' : '') + p.name) : 'Project';
      sub = p && p.country ? p.country.name : ''; badge = 'project';
      color = p ? ((p.donor && p.donor.color) || countryColor(p.iso)) : color;
      // A shared primary KPI carries reports from other projects too - count only
      // the ones this project logged.
      actScope = function (m){ return m.project_id === key; };
    } else if (kind === 'kpi'){
      inds = IND.filter(function (r){ return r.name === key; });
      projsFromInds = true;
      title = key; sub = 'KPI'; badge = 'kpi';
      var s0 = inds[0]; color = (s0 && s0.sdg) ? PILLAR_COLORS[s0.sdg] : color;
    } else if (kind === 'user'){
      var u = userById(key);
      inds = IND.filter(function (r){ return (r.reporterIds || []).indexOf(key) >= 0; });
      projsFromInds = true;
      actScope = function (m){ return m.reported_by_id === key; };
      title = u ? u.name : 'User'; color = u ? userColor(u) : color; badge = 'person';
      sub = u ? ((userSection(u) === 'hq' ? 'Section' : 'Country Office') + (u.country_iso3 ? '  ·  ' + u.country_iso3 : '')) : '';
    } else if (kind === 'bentype'){
      // Beneficiary type: the projects whose OWN activities logged it (p.benTypeIds),
      // the KPIs that reach it, and a count of the activities that recorded it.
      var bt = DB._idx.benTypeById[key];
      projs = PROJECTS.filter(function (p){ return (p.benTypeIds || []).indexOf(key) >= 0; });
      inds = IND.filter(function (r){ return (r.benTypeIds || []).indexOf(key) >= 0; });
      actScope = function (m){
        return (DB._idx.benByMeasurement[m.id] || []).some(function (b){ return b.type_id === key; });
      };
      title = bt ? bt.name : 'Beneficiary type'; sub = 'Project beneficiaries';
      color = benColor(key); badge = 'beneficiary';
    } else { return null; }

    // ---- narrow the scope to the active filters -------------------------------
    // Everything above resolves the entity against the WHOLE plan. A results box is
    // a window onto the dashboard, though, not onto the database: if the sidebar is
    // showing 7 of 50 projects, so must this box. The pre-filter totals ride along
    // as indsAll/projsAll/activitiesAll so the box can report "7 of 50".
    // projsFromInds kinds have not built a project list yet - derive their total
    // from the unfiltered KPIs, or "of N" would compare against an empty list.
    var indsAll = inds, projsAll = projsFromInds ? projsOfInds(inds) : projs;
    var actsAll = filteredSeriesRaw(indsAll, actScope);
    inds = inds.filter(function (r){ return inTimeRange(r) && passFacets(r); });
    if (kind === 'project'){
      // The project IS the subject of its own box - it stays even if the filters
      // would hide it (a deep link can land here from outside the current slice).
    } else {
      var progIso = progIsoSet();
      projs = (projsFromInds ? projsOfInds(inds) : projs)
        .filter(function (pr){ return projectPassesFacets(pr, false, progIso); });
    }
    var acts = filteredSeries(inds, actScope);
    activities = acts.length;

    return { title: title, sub: sub, color: color, badge: badge,
      inds: inds, projs: projs, acts: acts, activities: activities,
      indsAll: indsAll, projsAll: projsAll, activitiesAll: actsAll.length };
  }
  /** filteredSeries' unfiltered twin - the entity's activities before the facets
   *  touch them, for the "of 50" half of the count. */
  function filteredSeriesRaw(inds, extra){
    var out = [];
    (inds || []).forEach(function (r){
      (r.series || []).forEach(function (m){ if (!extra || extra(m)) out.push(m); });
    });
    return out;
  }
  // Render the resolved scope into the detail popup (tab bar hidden; single body).
  /** Body of a KPI results box: the scope banner + the shared Activities /
   *  Beneficiaries block, over the activities of EVERY project reporting this KPI.
   *  Same page openDetail renders for one project's copy of a KPI, just pooled -
   *  so the KPI Inventory lands on results rather than on a list of projects.
   *  The caller has already run navEnter/entityScope and set the modal title. */
  function renderKpiActivities(sc){
    var inds = sc.inds, projs = sc.projs;
    // Primary/Secondary is per project-copy: only claim it when every copy agrees.
    var allSec = inds.length && inds.every(function (r){ return r.secondary; });
    var allPri = inds.length && inds.every(function (r){ return !r.secondary; });
    var badgeTxt = allSec ? 'Secondary' : (allPri ? 'Primary' : 'KPI');
    var badgeBg = allSec ? 'var(--kpi-sec-bg)' : (allPri ? 'var(--kpi-pri-bg)' : sc.color);
    var badgeFg = allSec ? 'var(--kpi-sec)' : (allPri ? 'var(--kpi-pri)' : '#fff');

    var acts = sc.acts.slice().sort(function (a, b){ return (a.date < b.date) ? 1 : -1; });

    var kidsTxt = ofTotal(acts.length, sc.activitiesAll, 'activity', 'activities')
      + '  ·  ' + ofTotal(projs.length, sc.projsAll.length, 'project', 'projects');
    var html = '<div class="chain"><div class="lnk here">'
      + '<span class="badge" style="background:' + badgeBg + ';color:' + badgeFg + '">' + esc(badgeTxt) + '</span>'
      + '<span class="txt">' + esc(sc.title) + '</span></div>'
      + '<div class="kids">↳ ' + esc(kidsTxt) + '</div>'
      + chainExportBtn() + '</div>'
      + filterStripHTML();

    var actHead = 'Activities - ' + ofTotal(acts.length, sc.activitiesAll, 'activity', 'activities')
      .replace(/ activit(y|ies)$/, '');
    var block = activitiesResultBlock(acts, {
      head: actHead,
      emptyMsg: sc.activitiesAll ? 'No activities for this KPI match the active filters.'
                                 : 'No activities logged for this KPI yet.'
    });
    html += block.html;

    lastResultsExport = {
      badge: badgeTxt, badgeColor: (allSec ? '#27500a' : '#0c447c'),
      title: sc.title, sub: sc.sub || '', summary: kidsTxt, filters: activeFilterSummary(), stats: [],
      section: actHead,
      columns: block.columns, rows: block.rows, note: block.note, table2: block.benTable, grid: true
    };

    $('#mBody').innerHTML = html;
    wireExportBtn();
    captureColWidths($('#mBody .esum-static'), lastResultsExport.columns);
    if (lastResultsExport.table2) captureColWidths($('#mBody .ben-heat'), lastResultsExport.table2.columns);
    $('#mBody').scrollTop = 0;
    $('#modal').classList.add('on');
  }

  function openEntitySummary(kind, key, push){
    var sc = entityScope(kind, key); if (!sc) return;
    navEnter({ t: 'entity', kind: kind, key: key }, push);
    curDetail = null;
    var tabs = $('#mTabs'); if (tabs) tabs.style.display = 'none';
    $('#mProjects').classList.add('hide'); $('#mResults').classList.add('hide');
    $('#mBody').classList.remove('hide');
    $('#mTitle').textContent = sc.title;
    $('#mSub').textContent = sc.sub || '';
    $('#mImpact').textContent = '';

    // A KPI is a leaf: its results ARE its activities. Listing the projects that
    // carry it would send the reader back up the tree, so a KPI opens straight
    // onto the Activities + Beneficiaries page, pooled across every project
    // reporting it. (A single project's copy of a KPI still goes via openDetail.)
    if (kind === 'kpi'){ renderKpiActivities(sc); return; }

    var isProject = (kind === 'project');
    var inds = sc.inds, projs = sc.projs;
    var theProject = isProject ? projs[0] : null;
    var activities = sc.activities;
    var budget = 0, hasBudget = false;
    projs.forEach(function (p){ if (p.budget != null){ budget += +p.budget; hasBudget = true; } });
    var progAvg = aggMetric(inds, 'progress'), perfAvg = aggMetric(inds, 'performance');
    var progCode = ratioToCode(progAvg), perfCode = ratioToCode(perfAvg);
    function ragPill(code){ return '<span class="pill" style="background:' + STATUS[code].c + '">' + STATUS[code].label + '</span>'; }
    function pctStat(label, avg, code){
      return '<div class="stat"><div class="sl">' + label + '</div><div class="sv">'
        + (avg != null ? Math.round(avg * 100) + '%' : '–') + '</div><div class="ss">'
        + (avg != null ? ragPill(code) : '') + '</div></div>';
    }

    // ---- scope banner + one-line summary --------------------------------------
    // Counts read "7 of 50" whenever the filters are hiding some of the entity.
    var kidsTxt = (isProject ? ofTotal(inds.length, sc.indsAll.length, 'KPI', 'KPIs')
                             : ofTotal(projs.length, sc.projsAll.length, 'project', 'projects'))
      + '  ·  ' + ofTotal(activities, sc.activitiesAll, 'activity', 'activities')
      + (theProject && theProject.donor ? '  ·  ' + (theProject.donor.short_name || theProject.donor.name) : '');
    var html = '<div class="chain"><div class="lnk here">'
      + '<span class="badge" style="background:' + sc.color + '">' + esc(sc.badge) + '</span>'
      + '<span class="txt">' + esc(sc.title) + '</span></div>'
      + '<div class="kids">↳ ' + esc(kidsTxt) + '</div>'
      + chainExportBtn() + '</div>'
      + filterStripHTML();

    // ---- stat cards -----------------------------------------------------------
    // Hard cap: never more than five cards. Activities ride along under the
    // KPI/project count, and start+end collapse into one Timeline card.
    var countLbl = isProject ? 'KPIs' : 'Projects';
    var countN = isProject ? inds.length : projs.length;
    var countTot = isProject ? sc.indsAll.length : sc.projsAll.length;
    var countVal = fmt(countN) + (countTot > countN ? ' <small>of ' + fmt(countTot) + '</small>' : '');
    var actSub = ofTotal(activities, sc.activitiesAll, 'activity', 'activities');
    var tlVal = theProject
      ? (theProject.start ? shortDate(theProject.start) : '–') + ' <small>→ ' + (theProject.end ? shortDate(theProject.end) : '–') + '</small>'
      : null;

    // stats captured for the PDF export as we build the on-screen grid. The PDF
    // draws values as plain text, so it takes the unmarked-up counts.
    var expStats = [
      { label: countLbl, value: fmt(countN) + (countTot > countN ? ' of ' + fmt(countTot) : ''), sub: actSub },
      { label: 'Budget', value: hasBudget ? '$' + fmtBudget(budget) : '–' }
    ];
    if (theProject){
      expStats.push({ label: 'Timeline', value: (theProject.start ? shortDate(theProject.start) : '–') + ' → ' + (theProject.end ? shortDate(theProject.end) : '–') });
    }
    expStats.push({ label: 'Progress', value: progAvg != null ? Math.round(progAvg * 100) + '%' : '–', sub: progAvg != null ? STATUS[progCode].label : '', color: progAvg != null ? STATUS[progCode].c : null });
    expStats.push({ label: 'Performance', value: perfAvg != null ? Math.round(perfAvg * 100) + '%' : '–', sub: perfAvg != null ? STATUS[perfCode].label : '', color: perfAvg != null ? STATUS[perfCode].c : null });

    html += '<div class="esum-grid">'
      + stat(countLbl, countVal, actSub)
      + stat('Budget', hasBudget ? '$' + fmtBudget(budget) : '–')
      + (tlVal ? stat('Timeline', tlVal) : '')
      + pctStat('Progress', progAvg, progCode)
      + pctStat('Performance', perfAvg, perfCode)
      + '</div>';

    // ---- results table --------------------------------------------------------
    // A single project shows its KPIs; every other item shows its projects. KPIs
    // are never listed on a non-project results box. The same rows are pushed into
    // expCols/expRows so the PDF export mirrors exactly what is on screen.
    var CAP = 60, expCols = [], expRows = [], expSection = '', expNote = '';
    var indsHead = 'KPIs - ' + ofTotal(inds.length, sc.indsAll.length, 'KPI', 'KPIs').replace(/ KPIs?$/, '');
    var projsHead = 'Projects - ' + ofTotal(projs.length, sc.projsAll.length, 'project', 'projects').replace(/ projects?$/, '');
    if (isProject){
      expSection = indsHead;
      expCols = [{ t: 'KPI' }, { t: 'Type' }, { t: 'Baseline', align: 'right' }, { t: 'Target', align: 'right' },
                 { t: 'Latest', align: 'right' }, { t: 'Activities', align: 'right' }, { t: 'Progress', align: 'right' }, { t: 'Performance', align: 'right' }];
      html += '<div class="msec"><h4>' + esc(indsHead) + '</h4>';
      if (!inds.length) html += '<div class="empty">' + (sc.indsAll.length ? 'No KPIs on this project match the active filters.' : 'No KPIs attached to this project.') + '</div>';
      else {
        html += '<table class="esum-tbl esum-kpi"><thead><tr><th>KPI</th><th class="tcol">Type</th><th class="num">Baseline</th><th class="num">Target</th><th class="num">Latest</th><th class="num">Activities</th><th class="num">Progress</th><th class="num">Performance</th></tr></thead><tbody>';
        inds.slice().sort(function (a, b){ return (b.updated || '') < (a.updated || '') ? -1 : 1; }).slice(0, CAP).forEach(function (r){
          var u = r.unit === '%' ? '%' : '', col = r.sdg ? PILLAR_COLORS[r.sdg] : '#94a3b8', ind = r.raw;
          // this project's own reports against the KPI, under the active filters
          var kActs = filteredSeries([r], function (m){ return m.project_id === key; }).length;
          var pro = r.progress != null ? Math.round(r.progress * 100) + '%' : '–';
          var per = r.performance != null ? Math.round(r.performance * 100) + '%' : '–';
          html += '<tr class="esum-trow" data-ind="' + r.id + '">'
            + '<td class="esum-nm"><span class="esum-dot" style="background:' + col + '"></span>' + esc(r.name) + '</td>'
            + '<td class="tcol"><span class="kpi-type ' + (r.secondary ? 'secondary' : 'primary') + '">' + (r.secondary ? 'Secondary' : 'Primary') + '</span></td>'
            + '<td class="num">' + (ind.baseline_value != null ? fmtNum(ind.baseline_value) + u : '–') + '</td>'
            + '<td class="num">' + (ind.target_value != null ? fmtNum(ind.target_value) + u : '–') + '</td>'
            + '<td class="num">' + (r.value != null ? fmtNum(r.value) + u : '–') + '</td>'
            + '<td class="num">' + fmt(kActs) + '</td>'
            + '<td class="num"><b style="color:' + STATUS[r.progressCode].c + '">' + pro + '</b></td>'
            + '<td class="num"><b style="color:' + STATUS[r.perfCode].c + '">' + per + '</b></td></tr>';
          expRows.push([
            { t: (r.code ? r.code + ' · ' : '') + r.name, dot: col },
            { t: r.secondary ? 'Secondary' : 'Primary' },
            { t: ind.baseline_value != null ? fmtNum(ind.baseline_value) + u : '–' },
            { t: ind.target_value != null ? fmtNum(ind.target_value) + u : '–' },
            { t: r.value != null ? fmtNum(r.value) + u : '–' },
            { t: fmt(kActs) },
            { t: pro, color: STATUS[r.progressCode].c },
            { t: per, color: STATUS[r.perfCode].c }
          ]);
        });
        html += '</tbody></table>';
        if (inds.length > CAP){ expNote = 'Showing ' + CAP + ' of ' + fmt(inds.length) + ' KPIs.'; html += '<div class="cp-note">' + expNote + '</div>'; }
      }
      html += '</div>';
    } else {
      expSection = projsHead;
      expCols = [{ t: 'Project' }, { t: 'Country' }, { t: 'Donor' }, { t: 'Budget', align: 'right' },
                 { t: 'Activities', align: 'right' }, { t: 'Progress', align: 'right' }, { t: 'Performance', align: 'right' }];
      html += '<div class="msec"><h4>' + esc(projsHead) + '</h4>';
      if (!projs.length) html += '<div class="empty">No projects match this item under the current filters.</div>';
      else {
        // Activities per project follow the filters too, so the column adds up to the
        // Activities stat above it rather than to the project's lifetime total.
        var actByProj = countBy(actPool([]), function (a){ return a.pid; });
        html += '<table class="esum-tbl esum-proj"><thead><tr><th>Project</th><th>Country</th><th>Donor</th><th class="num">Budget</th><th class="num">Activities</th><th class="num">Progress</th><th class="num">Performance</th></tr></thead><tbody>';
        projs.slice().sort(function (a, b){ return (actByProj[b.id] || 0) - (actByProj[a.id] || 0); }).slice(0, CAP).forEach(function (p){
          var pActs = actByProj[p.id] || 0;
          var proV = aggMetric(p.kpis, 'progress'), perV = aggMetric(p.kpis, 'performance');
          var pro = proV != null ? Math.round(proV * 100) + '%' : '–';
          var per = perV != null ? Math.round(perV * 100) + '%' : '–';
          var col = (p.donor && p.donor.color) || countryColor(p.iso);
          html += '<tr class="esum-trow" data-proj="' + p.id + '">'
            + '<td class="esum-nm"><span class="esum-dot" style="background:' + col + '"></span>' + esc((p.code ? p.code + ' · ' : '') + p.name) + '</td>'
            + '<td>' + esc(p.country ? p.country.name : p.iso) + '</td>'
            + '<td>' + esc(p.donor ? (p.donor.short_name || p.donor.name) : '–') + '</td>'
            + '<td class="num">' + (p.budget != null ? '$' + fmtBudget(p.budget) : '–') + '</td>'
            + '<td class="num">' + fmt(pActs) + '</td>'
            + '<td class="num"><b style="color:' + STATUS[ratioToCode(proV)].c + '">' + pro + '</b></td>'
            + '<td class="num"><b style="color:' + STATUS[ratioToCode(perV)].c + '">' + per + '</b></td></tr>';
          expRows.push([
            { t: (p.code ? p.code + ' · ' : '') + p.name, dot: col },
            { t: p.country ? p.country.name : p.iso },
            { t: p.donor ? (p.donor.short_name || p.donor.name) : '–' },
            { t: p.budget != null ? '$' + fmtBudget(p.budget) : '–' },
            { t: fmt(pActs) },
            { t: pro, color: STATUS[ratioToCode(proV)].c },
            { t: per, color: STATUS[ratioToCode(perV)].c }
          ]);
        });
        html += '</tbody></table>';
        if (projs.length > CAP){ expNote = 'Showing ' + CAP + ' of ' + fmt(projs.length) + ' projects.'; html += '<div class="cp-note">' + expNote + '</div>'; }
      }
      html += '</div>';
    }

    lastResultsExport = { badge: sc.badge, badgeColor: sc.color, title: sc.title, sub: sc.sub || '',
      summary: kidsTxt, filters: activeFilterSummary(), stats: expStats, section: expSection,
      columns: expCols, rows: expRows, note: expNote };

    $('#mBody').innerHTML = html;
    wireExportBtn();

    // row navigation: project row → its KPI summary; KPI row → KPI detail.
    // push=true so Close/‹ returns to this results box instead of dismissing it.
    $('#mBody').querySelectorAll('.esum-trow[data-proj]').forEach(function (row){
      row.onclick = function (){ openEntitySummary('project', +row.dataset.proj, true); };
    });
    $('#mBody').querySelectorAll('.esum-trow[data-ind]').forEach(function (row){
      // data-ind rows appear only in a project box, so scope the KPI to this project
      row.onclick = function (){ var r = INDBYID[+row.dataset.ind]; if (r) openDetail(r, true, theProject ? theProject.id : null); };
    });

    $('#mBody').scrollTop = 0;
    $('#modal').classList.add('on');
  }

  // =========================================================================
  //  LOCATION / ACTIVITY RESULTS BOX - clicking a map bubble (a location or a
  //  cluster of them) opens this read-only summary of the ACTIVITIES logged at
  //  that spot. Same visual template as the donor / project / KPI results box:
  //  scope banner + stat cards + a single results table (the activities here).
  // =========================================================================
  // Every measurement logged at the cluster's location(s) that survives the active
  // filters - reproduces exactly the count the bubble shows (c.acts), because
  // buildLocations counts with the same test. Pass raw:true for the pre-filter
  // total, so the box can say "7 of 50".
  function activitiesAtCluster(c, raw){
    var keys = {}; c.locs.forEach(function (l){ keys[(+l.lat).toFixed(3) + ',' + (+l.lng).toFixed(3)] = 1; });
    var out = [];
    Object.keys(c.projIds).forEach(function (pid){
      (DB._idx.measByProject[+pid] || []).forEach(function (m){
        if (m.place_lat == null || m.place_lng == null) return;
        if (!raw && !measPassesFilters(m)) return;
        if (keys[(+m.place_lat).toFixed(3) + ',' + (+m.place_lng).toFixed(3)]) out.push(m);
      });
    });
    return out;
  }

  function openLocationSummary(c, push){
    if (!c || !c.locs || !c.locs.length) return;
    closeLocPop();
    navEnter({ t: 'location', cluster: c }, push);
    curDetail = null;
    var tabs = $('#mTabs'); if (tabs) tabs.style.display = 'none';
    $('#mProjects').classList.add('hide'); $('#mResults').classList.add('hide');
    $('#mBody').classList.remove('hide');

    var multi = c.locs.length > 1, loc0 = c.locs[0];
    var co = loc0 && loc0.iso ? DB._idx.countryByIso[loc0.iso] : null;
    var projs = Object.keys(c.projIds).map(function (id){ return PROJECTSBYID[+id]; }).filter(Boolean);
    var acts = activitiesAtCluster(c).sort(function (a, b){ return (a.date < b.date) ? 1 : -1; });
    var actsAllN = activitiesAtCluster(c, true).length;
    var color = STATUS[c.status] ? STATUS[c.status].c : '#7c8aa5';
    var badge = multi ? 'Locations' : 'Location';

    var title = multi ? (fmt(c.locs.length) + ' activity locations') : ((loc0 && loc0.name) ? loc0.name : 'Location');
    var sub = multi
      ? (fmt(projs.length) + ' project' + (projs.length === 1 ? '' : 's') + ' across these locations')
      : ((co ? co.name + '  ·  ' : '') + (loc0 ? (+loc0.lat).toFixed(3) + ', ' + (+loc0.lng).toFixed(3) : ''));
    $('#mTitle').textContent = title;
    $('#mSub').textContent = sub;
    $('#mImpact').textContent = '';

    var kidsTxt = ofTotal(acts.length, actsAllN, 'activity', 'activities')
      + '  ·  ' + fmt(projs.length) + ' project' + (projs.length === 1 ? '' : 's')
      + (multi ? '  ·  ' + fmt(c.locs.length) + ' locations' : '');

    var html = '<div class="chain"><div class="lnk here">'
      + '<span class="badge" style="background:' + color + '">' + esc(badge) + '</span>'
      + '<span class="txt">' + esc(title) + '</span></div>'
      + '<div class="kids">↳ ' + esc(kidsTxt) + '</div>'
      + chainExportBtn() + '</div>'
      + filterStripHTML();

    // ---- activities table + beneficiary heat-map ------------------------------
    // The EXACT same block the KPI detail uses (openDetail) - one activities form,
    // rendered here per location and there per KPI. Location leads, then the
    // activity; Project/KPI show their short CODE with the full name on hover, and
    // the KPI cell drills into that KPI scoped to the row's project.
    var actHead = 'Activities - ' + ofTotal(acts.length, actsAllN, 'activity', 'activities').replace(/ activit(y|ies)$/, '');
    var block = activitiesResultBlock(acts, {
      head: actHead,
      emptyMsg: 'No activities logged at this location under the current filters.'
    });
    html += block.html;

    lastResultsExport = { badge: badge, badgeColor: color, title: title, sub: sub,
      summary: kidsTxt, filters: activeFilterSummary(), stats: [], section: actHead,
      columns: block.columns, rows: block.rows, note: block.note, table2: block.benTable, grid: true };

    $('#mBody').innerHTML = html;
    wireExportBtn();
    // Copy the ACTUAL rendered column widths onto the export spec so the PDF reproduces
    // the on-screen column proportions exactly (only the ratios matter to pdfTable).
    captureColWidths($('#mBody .esum-static'), lastResultsExport.columns);
    if (lastResultsExport.table2) captureColWidths($('#mBody .ben-heat'), lastResultsExport.table2.columns);

    $('#mBody').scrollTop = 0;
    $('#modal').classList.add('on');
  }
  function captureColWidths(table, cols){
    if (!table || !cols) return;
    var ths = table.querySelectorAll('thead th');
    for (var k = 0; k < ths.length && k < cols.length; k++){
      var w = ths[k].getBoundingClientRect().width;
      if (w > 0) cols[k].w = w;
    }
  }

  // Beneficiary heat-map for a set of activities: one row per activity, one column
  // per beneficiary type that actually carries a count, plus a per-row Total. Cell
  // shading is a blue ramp (darker = more beneficiaries), scaled to the
  // single largest cell in the grid so the busiest cell is the deepest blue.
  var HEAT_BLUE = '#1CABE2';
  // Linear blend between two #rrggbb colours (t in 0..1).
  function mixHex(a, b, t){
    var pa = /^#?([0-9a-f]{6})$/i.exec(a), pb = /^#?([0-9a-f]{6})$/i.exec(b);
    if (!pa || !pb) return a;
    var na = parseInt(pa[1], 16), nb = parseInt(pb[1], 16);
    t = Math.max(0, Math.min(1, t));
    var r = Math.round((na >> 16) + ((nb >> 16) - (na >> 16)) * t);
    var g = Math.round(((na >> 8) & 255) + (((nb >> 8) & 255) - ((na >> 8) & 255)) * t);
    var bl = Math.round((na & 255) + ((nb & 255) - (na & 255)) * t);
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + bl).toString(16).slice(1);
  }
  function benHeatColor(t){                // t in 0..1 → light→bright blue
    if (t <= 0) return { bg: 'var(--bg-sunk)', fg: 'var(--muted)' };   // empty cell: light gray
    // light tint (#EAF7FC) → bright blue (#1CABE2); dark navy text stays legible
    // across the whole (brighter) ramp, so no white-on-blue flip is needed.
    var e = Math.pow(t, 0.7);
    var bg = mixHex('#EAF7FC', '#1CABE2', e);
    return { bg: bg, fg: '#0b3a52' };
  }
  // A compact 3-letter code for a beneficiary type, shown where a full name would
  // not fit (e.g. heat-map headers); the full name is offered on hover. Known UN
  // demographic types get a hand-picked code; anything else is derived from the
  // significant words of its name, so custom types still get a stable code.
  var BEN_CODE_MAP = { 'men':'MEN','women':'WMN','boys':'BOY','girls':'GRL','children':'CHD',
    'persons with disabilities':'PWD','people with disabilities':'PWD',
    'refugees':'REF','idps':'IDP','internally displaced persons':'IDP',
    'host community':'HST','host communities':'HST','youth':'YTH','elderly':'ELD' };
  function benAutoCode(name){
    var stop = { with:1, of:1, and:1, the:1, a:1, an:1, for:1, to:1, in:1, on:1 };
    var words = String(name || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter(function (w){ return w && !stop[w]; });
    if (!words.length) return String(name || '?').slice(0, 3).toUpperCase() || '?';
    if (words.length >= 3) return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
    if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).toUpperCase();
    return words[0].slice(0, 3).toUpperCase();
  }
  function benCode(id){
    var name = benTypeName(id) || '';
    var key = name.trim().toLowerCase();
    return BEN_CODE_MAP[key] || benAutoCode(name);
  }
  // Concrete (non-CSS-var) heat colours for the PDF export, matching the screen ramp.
  function benHeatColorPDF(t){
    if (t <= 0) return { bg: '#eef1f5', fg: null };            // empty cell: light gray, no text
    return { bg: mixHex('#EAF7FC', '#1CABE2', Math.pow(t, 0.7)), fg: '#0b3a52' };
  }
  // Returns { html, table } - `table` is the PDF export spec (columns/rows) so the
  // exported PDF carries the same beneficiaries heat-map shown on screen.
  function beneficiaryHeatmap(acts){
    if (!acts || !acts.length) return { html: '', table: null };
    var types = benTypes();
    // keep only types with at least one non-zero count across these activities
    var totalByType = {}, grid = [], maxCell = 0, grand = 0;
    acts.forEach(function (m){
      var row = { m: m, vals: {}, total: 0 };
      (DB._idx.benByMeasurement[m.id] || []).forEach(function (b){
        var v = +b.value || 0; if (!v) return;
        row.vals[b.type_id] = (row.vals[b.type_id] || 0) + v;
        row.total += v; totalByType[b.type_id] = (totalByType[b.type_id] || 0) + v;
      });
      grid.push(row);
    });
    var cols = types.filter(function (t){ return totalByType[t.id]; });
    if (!cols.length) return { html: '<div class="msec"><h4>Beneficiaries</h4>'
      + '<div class="empty">No beneficiaries recorded against these activities.</div></div>', table: null };
    grid.forEach(function (row){ cols.forEach(function (t){ var v = row.vals[t.id] || 0; if (v > maxCell) maxCell = v; }); grand += row.total; });

    // uniform pill width: the longest number anywhere in the grid drives it, so every
    // pill (values + totals) renders at one width. `--pill-w` (in ch) feeds the CSS.
    var maxLen = fmtC(grand).length;
    grid.forEach(function (row){ if (fmtC(row.total).length > maxLen) maxLen = fmtC(row.total).length;
      cols.forEach(function (t){ var v = row.vals[t.id] || 0; if (v && fmtC(v).length > maxLen) maxLen = fmtC(v).length; }); });
    cols.forEach(function (t){ if (fmtC(totalByType[t.id] || 0).length > maxLen) maxLen = fmtC(totalByType[t.id] || 0).length; });

    var h = '<div class="msec"><h4>Beneficiaries - ' + fmt(grand) + '</h4>'
      + '<div class="cp-note">Reach by beneficiary type per activity. Darker pills = more beneficiaries; totals are hollow.</div>'
      + '<table class="esum-tbl ben-heat loc-tbl" style="--pill-w:' + maxLen + 'ch"><thead><tr><th class="rn-col">#</th><th class="act-col">Activity</th>';
    cols.forEach(function (t){ h += '<th class="num" title="' + esc(t.name) + '">' + esc(benCode(t.id)) + '</th>'; });
    h += '<th class="num ben-tot">Total</th></tr></thead><tbody>';

    // PDF export spec, built alongside the on-screen rows so the two stay in step.
    // Number columns are centred; values are filled pills, totals hollow-bordered pills.
    // `w` weights mirror the on-screen widths (rn 42 / act 190, then the type columns +
    // Total split the remainder equally) so the PDF keeps the same proportions.
    var eqW = (878 - 42 - 190) / (cols.length + 1);
    var expCols = [{ t: '#', align: 'center', w: 42 }, { t: 'Activity', w: 190 }];
    cols.forEach(function (t){ expCols.push({ t: benCode(t.id), align: 'center', w: eqW }); });
    expCols.push({ t: 'Total', align: 'center', w: eqW });
    var expRows = [];

    grid.forEach(function (row, i){
      var pr = PROJECTSBYID[row.m.project_id];
      var dot = pr ? ((pr.donor && pr.donor.color) || countryColor(pr.iso)) : '#94a3b8';
      h += '<tr><td class="rn-col">' + (i + 1) + '</td>'
        + '<td class="act-col esum-nm"><span class="esum-dot" style="background:' + dot + '"></span>' + esc(row.m.narrative || '–') + '</td>';
      var er = [{ t: String(i + 1) }, { t: row.m.narrative || '–', dot: dot }];
      cols.forEach(function (t){
        var v = row.vals[t.id] || 0, ratio = maxCell ? v / maxCell : 0;
        var hc = benHeatColor(ratio), pc = benHeatColorPDF(ratio);
        h += '<td class="num ben-cell">'
          + (v ? '<span class="ben-pill" title="' + fmt(v) + '" style="background:' + hc.bg + ';color:' + hc.fg + '">' + fmtC(v) + '</span>'
               : '<span class="ben-pill empty"></span>')
          + '</td>';
        er.push({ t: v ? fmtC(v) : '', pill: v ? pc.bg : null, pillEmpty: !v, color: v ? pc.fg : null });
      });
      h += '<td class="num ben-tot"><span class="ben-pill hollow" title="' + fmt(row.total) + '">' + fmtC(row.total) + '</span></td></tr>';
      er.push({ t: fmtC(row.total), pillHollow: true, color: '#1a2233' });
      expRows.push(er);
    });
    // column totals footer (on screen) + matching totals row (PDF) - hollow pills
    h += '</tbody><tfoot><tr><td class="ben-tot ben-lbl" colspan="2">Total</td>';
    var totalRow = [{ t: '' }, { t: 'Total', color: '#1a2233' }];
    cols.forEach(function (t){
      h += '<td class="num ben-tot"><span class="ben-pill hollow" title="' + fmt(totalByType[t.id] || 0) + '">' + fmtC(totalByType[t.id] || 0) + '</span></td>';
      totalRow.push({ t: fmtC(totalByType[t.id] || 0), pillHollow: true, color: '#1a2233' });
    });
    h += '<td class="num ben-tot"><span class="ben-pill hollow" title="' + fmt(grand) + '">' + fmtC(grand) + '</span></td></tr></tfoot></table></div>';
    totalRow.push({ t: fmtC(grand), pillHollow: true, color: '#1a2233' });
    expRows.push(totalRow);

    return { html: h, table: { section: 'Beneficiaries - ' + fmt(grand), columns: expCols, rows: expRows } };
  }

  // ---- shared activities result block (location popup AND KPI detail) --------
  // One #/Activity/Location/Value/Date/Project/KPI table followed by the
  // beneficiary heat-map, both scoped to the SAME set of activities. The heat-map
  // drops Location - it repeats the activities table row-for-row - but keeps the
  // same #/Activity widths so the two tables still line up 1:1. This is the
  // "attached" layout from the location box, factored out so the KPI detail reuses
  // it verbatim: activities read identically whether the entry point is a map
  // location (Location constant-ish, Project/KPI vary per row) or a KPI (KPI
  // constant, Location/Project vary). `acts` must already be time-filtered and
  // ordered by the caller. Returns the on-screen HTML plus the PDF export specs
  // (activities columns/rows/note + the beneficiary table2) so both entry points
  // export the same way. The caller runs captureColWidths after injecting the
  // HTML (column widths are read from the live DOM).
  function activitiesResultBlock(acts, opts){
    opts = opts || {};
    var expCols = [{ t: '#', align: 'center', w: 42 }, { t: 'Activity', w: 190 }, { t: 'Location', w: 118 },
                   { t: 'Value', align: 'center', w: 135 }, { t: 'Date', align: 'center', w: 135 },
                   { t: 'Project', align: 'right', w: 135 }, { t: 'KPI', align: 'right', w: 135 }];
    var expRows = [], expNote = '';
    // opts.head lets the caller say "7 of 50" when filters are hiding activities.
    var head = opts.head || ('Activities - ' + fmt(acts.length));
    var html = '<div class="msec"><h4>' + esc(head) + '</h4>';
    if (!acts.length) html += '<div class="empty">' + esc(opts.emptyMsg || 'No activities logged under the current filters.') + '</div>';
    else {
      html += '<table class="esum-tbl esum-static loc-tbl"><thead><tr><th class="rn-col">#</th><th class="act-col">Activity</th><th class="loc-col">Location</th><th class="col-eq col-c">Value</th><th class="col-eq col-c">Date</th><th class="col-eq col-r">Project</th><th class="col-eq col-r">KPI</th></tr></thead><tbody>';
      acts.forEach(function (m, i){
        var p = PROJECTSBYID[m.project_id], r = INDBYID[m.indicator_id];
        var u = (r && r.unit === '%') ? '%' : '';
        var dot = p ? ((p.donor && p.donor.color) || countryColor(p.iso)) : '#94a3b8';
        var projCode = p ? (p.code || p.name) : '–', projFull = p ? ((p.code ? p.code + ' · ' : '') + p.name) : '–';
        var kpiCode = r ? ((r.raw && r.raw.code) ? r.raw.code : r.name) : '–';
        var kpiFull = r ? (((r.raw && r.raw.code) ? r.raw.code + ' · ' : '') + r.name) : '–';
        // Project and KPI are plain read-only text (short CODE, full name on hover).
        html += '<tr>'
          + '<td class="rn-col">' + (i + 1) + '</td>'
          + '<td class="act-col esum-nm"><span class="esum-dot" style="background:' + dot + '"></span>' + esc(m.narrative || '–') + '</td>'
          + '<td class="loc-col">' + esc(m.place_name || '–') + '</td>'
          + '<td class="col-eq col-c">' + fmtNum(m.value) + u + '</td>'
          + '<td class="col-eq col-c">' + (m.date ? shortDate(m.date) : '–') + '</td>'
          + '<td class="col-eq col-r" title="' + esc(projFull) + '">' + esc(projCode) + '</td>'
          + '<td class="col-eq col-r" title="' + esc(kpiFull) + '">' + esc(kpiCode) + '</td></tr>';
        expRows.push([
          { t: String(i + 1) },
          { t: m.narrative || '–', dot: dot },
          { t: m.place_name || '–' },
          { t: fmtNum(m.value) + u },
          { t: m.date ? shortDate(m.date) : '–' },
          { t: projCode }, { t: kpiCode }
        ]);
      });
      html += '</tbody></table>';
    }
    html += '</div>';

    var benBox = beneficiaryHeatmap(acts);
    html += benBox.html;

    return { html: html, columns: expCols, rows: expRows, note: expNote, benTable: benBox.table };
  }

  // ---- modal tabs: Details / Activities -----------------------------------
  function setModalTab(tab){
    tab = tab || 'details';
    Array.prototype.forEach.call($('#mTabs').children, function (b){ b.classList.toggle('on', b.dataset.mtab === tab); });
    $('#mBody').classList.toggle('hide', tab !== 'details');
    $('#mProjects').classList.toggle('hide', tab !== 'projects');
    $('#mResults').classList.toggle('hide', tab !== 'results');
    if (tab === 'projects') renderKpiProjects(curDetail);
    if (tab === 'results') renderResultsEditor(curDetail);
  }

  // ---- Projects tab: the project(s) this KPI belongs to (clickable cards) -----
  function renderKpiProjects(r){
    if (!r) return;
    var host = $('#mProjects'); host.innerHTML = '';
    var projs = (r.projectIds || []).map(function (id){ return PROJECTSBYID[id]; }).filter(Boolean);
    var sec = el('div', 'msec');
    sec.innerHTML = '<h4>Projects using this KPI - ' + fmt(projs.length) + '</h4>'
      + '<div class="cp-note">This is a <b>' + (r.secondary ? 'secondary (project-local)' : 'primary') + '</b> KPI. '
      + (r.secondary
          ? 'A secondary KPI belongs to a single project.'
          : 'Primary KPIs are drawn from the inventory and can be attached to several projects.')
      + ' Click a project to open its summary.</div>';
    host.appendChild(sec);
    if (!projs.length) { host.appendChild(el('div', 'empty', 'This KPI is not attached to any project yet.')); return; }
    var wrap = el('div', 'mprojlist');
    projs.forEach(function (p){ wrap.appendChild(projectCard(p, function (){ openEntitySummary('project', p.id, true); })); });
    host.appendChild(wrap);
    host.scrollTop = 0;
  }

  // Live preview shown while a value is typed: the progress achieved BEFORE this
  // report, and the new total/level (and progress) this report would produce.
  // `valId` is the id of the value <input> to read (differs per form).
  function fillReportPreview(hostId, r, valId){
    var host = document.getElementById(hostId); if (!host) return;
    if (!r){ host.innerHTML = ''; return; }
    var vEl = document.getElementById(valId || 'afValue'), raw = vEl ? vEl.value : '';
    var ind = r.raw, b = +ind.baseline_value, t = +ind.target_value;
    var beforeVal = indicatorValue(ind, DB.measurementsFor(r.id));
    if (beforeVal == null) beforeVal = b;
    var isCount = ind.unit === 'count';
    var hasVal = raw !== '' && !isNaN(+raw);
    var newVal = isCount ? (beforeVal + (hasVal ? +raw : 0)) : (hasVal ? +raw : beforeVal);
    var uu = ind.unit === '%' ? '%' : '';
    function progChip(v){
      if (t === b) return '<span class="rp-chip" style="background:' + STATUS.nodata.c + '">–</span>';
      var p = (v - b) / (t - b), c = ratioToCode(p);
      return '<span class="rp-chip" style="background:' + STATUS[c].c + '">' + Math.round(p * 100) + '%</span>';
    }
    host.innerHTML =
      '<div class="rp-row"><span class="rp-k">Progress before</span>'
        + '<span class="rp-v">' + fmtNum(beforeVal) + uu + ' ' + progChip(beforeVal) + '</span></div>'
      + '<div class="rp-row rp-after"><span class="rp-k">' + (isCount ? 'New total after this activity' : 'New level after this activity') + '</span>'
        + '<span class="rp-v">' + fmtNum(newVal) + uu + ' ' + progChip(newVal) + '</span></div>'
      + '<div class="rp-tgt">Target ' + fmtNum(t) + uu + (isCount ? ' · this activity adds an increment on top of the current total' : ' · this activity sets the current level') + '</div>';
  }

  // ---- Activity edit form (reached from a KPI's / project's Activities list) --
  // New activities are logged from a Project → Activities tab (see the project
  // module); this popup only edits an existing activity (measurement).
  // Dynamic value label - same wording used wherever a KPI value is entered.
  function activityValLabel(r){
    var unit = r ? (r.raw.unit || 'value') : 'value';
    return (r && r.raw.unit === 'count')
      ? ('Value this month - increment (' + unit + ')')
      : ('Value - current level (' + unit + ')');
  }
  // Shared field block used by BOTH Add and Edit: value (+ live before/after
  // preview), date, logged-by and narrative. `o` carries the mode's values.
  function activityFieldsHtml(o){
    return ''
      + '  <label class="af"><span id="naValLbl">' + esc(o.valLabel) + '</span>'
      +     '<input id="naValue" type="number" step="any" autocomplete="off"'
      +       (o.value != null ? ' value="' + esc(o.value) + '"' : ' placeholder="0"') + '></label>'
      + '  <div class="afprev full" id="naPreview"></div>'
      + '  <label class="af"><span>Activity date</span>'
      +     '<input id="naDate" type="date" value="' + esc(o.date) + '"></label>'
      + '  <label class="af"><span>Logged by</span>'
      +     '<input class="af-ro" type="text" value="' + esc(o.loggedBy) + '" readonly title="' + esc(o.loggedByTip) + '"></label>'
      + '  <label class="af full"><span>' + esc(o.noteLabel) + '</span>'
      +     '<textarea id="naNote" rows="2" placeholder="What was done, evidence, next steps…">' + esc(o.note || '') + '</textarea></label>';
  }
  // Edit an existing activity (measurement). `edit` = {r, m}. Reached from a KPI's
  // Activities list (detail modal) and from a Project → Activities tab.
  function openActivity(edit){
    if (!CURRENT_USER) return;
    if (edit && edit.r && edit.m) openActivityEdit(edit.r, edit.m);
  }
  function closeNewActivity(){ var o = $('#newActivityOverlay'); if (o) o.classList.remove('on'); }

  // Edit an existing activity (measurement) in the same popup - KPI is fixed, so
  // the country/KPI selectors become a read-only context header; every other field
  // (value + live preview, date, logged-by, narrative) is shared with Add mode.
  function openActivityEdit(r, m){
    var host = $('#naBody'); host.innerHTML = '';
    $('#naHead').textContent = 'Edit activity';
    _actBens = (DB._idx.benByMeasurement[m.id] || []).map(function (b){ return { id: b.id, type_id: b.type_id, value: b.value }; });
    var co = r.iso ? DB._idx.countryByIso[r.iso] : null;
    var details = '<div class="aform">'
      + '<div class="na-ctx"><span>KPI</span><b>' + esc(r.name) + '</b>'
      + '<div class="na-ctx-sub">' + esc((co ? co.name : r.iso || '') + ' · ' + pillarLabel(r.sdg)) + '</div></div>'
      + '<div class="afgrid">'
      + activityFieldsHtml({
          valLabel: activityValLabel(r), value: m.value, date: (m.date || '').slice(0,10),
          loggedBy: userName(m.reported_by_id), loggedByTip: 'Original author',
          noteLabel: 'Narrative / what was done', note: m.narrative || ''
        })
      + '</div>'
      + '<div class="cp-note">Editing updates this activity. The KPI value, status and the Output → Outcome → Impact roll-up re-derive immediately.</div></div>';
    var footer = '<div class="afbtns"><span class="afmsg" id="naMsg"></span>'
      + '<button class="hbtn" id="naCancel" type="button">Cancel</button>'
      + '<button class="hbtn primary" id="naSave" type="button">Save changes</button></div>';
    host.innerHTML = naTabbedBody(details, footer);
    wireNaTabs();
    fillReportPreview('naPreview', r, 'naValue');   // before/after preview, as in Add mode
    $('#naValue').addEventListener('input', function (){ fillReportPreview('naPreview', r, 'naValue'); });
    $('#naCancel').onclick = closeNewActivity;
    $('#naSave').onclick = function (){ submitActivityEdit(r, m); };
    $('#newActivityOverlay').classList.add('on');
    setTimeout(function (){ var f = $('#naValue'); if (f) f.focus(); }, 0);
  }
  function submitActivityEdit(r, m){
    var valRaw = $('#naValue').value;
    if (valRaw !== '' && isNaN(+valRaw)) { $('#naMsg').textContent = 'Value must be a number.'; return; }
    var date = $('#naDate').value || m.date;
    m.date = date;
    if (valRaw !== '' && !isNaN(+valRaw)) m.value = +valRaw;
    m.narrative = ($('#naNote').value || '').trim();
    var fromProject = $('#projectModal').classList.contains('on');
    $('#naMsg').textContent = 'Saving…';
    Promise.resolve(DB.persist('measurement', [m]))
      .then(function (){ return saveBeneficiaries(m.id); })
      .then(function (){
        enrich(); renderTicker(); renderAll();
        closeNewActivity();
        if (fromProject) setProjectTab('activities');
        else { var nr = indById(r.id) || r; openDetail(nr); setModalTab('results'); }
      });
  }

  // ---- Activities tab: read-only history with per-row Edit / Delete --------
  function renderResultsEditor(r){
    if (!r) return;
    var host = $('#mResults'); host.innerHTML = '';
    var editable = canReport(r);
    var isCount = r.raw.unit === 'count';
    var unit = r.raw.unit || '';
    var ms = DB.measurementsFor(r.id).slice().reverse();   // newest first

    var sec = el('div', 'msec');
    var head = '<h4>Activity history - ' + fmt(ms.length) + ' activit' + (ms.length === 1 ? 'y' : 'ies') + '</h4>';
    head += '<div class="cp-note">' + (editable
      ? 'Use <b>Edit</b> to change an activity, or the bin to delete it. Add new activities from a <b>Project → Activities</b> tab. The KPI value, status and the Output → Outcome → Impact roll-up update immediately.'
      : 'Viewing the activity history. Editing is limited to users who can log activities on this KPI.') + '</div>';
    if (isCount) head += '<div class="cp-note">This is a <b>count</b> KPI - each row is a monthly increment; the current value is the baseline plus the sum of all rows.</div>';

    var rows = ms.map(function (m){
      return '<tr data-mid="' + m.id + '">'
        + '<td class="re-datecell">' + (m.date ? shortDate(m.date) : '–') + '</td>'
        + '<td class="re-valcell">' + fmtNum(m.value) + '</td>'
        + '<td class="re-by">' + esc(userName(m.reported_by_id)) + '</td>'
        + '<td class="re-narr" title="' + esc(m.narrative || '') + '">' + esc(m.narrative || '') + '</td>'
        + (editable ? '<td class="re-actcell"><button class="re-edit" title="Edit this activity">Edit</button>'
            + '<button class="re-del" title="Delete this activity">🗑</button></td>' : '')
        + '</tr>';
    }).join('');
    if (!ms.length) rows = '<tr><td colspan="' + (editable ? 5 : 4) + '" class="re-empty">No activities yet - add one from a Project → Activities tab.</td></tr>';

    sec.innerHTML = head
      + '<div class="retbl-wrap"><table class="retbl retbl-ro"><thead><tr>'
      + '<th>Date</th><th>Value (' + esc(unit) + ')</th><th>Logged by</th><th>Narrative</th>'
      + (editable ? '<th></th>' : '') + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    host.appendChild(sec);

    if (editable) {
      host.querySelectorAll('tr[data-mid]').forEach(function (tr){
        var m = DB._idx.measById[+tr.getAttribute('data-mid')]; if (!m) return;
        var ed = tr.querySelector('.re-edit');
        if (ed) ed.onclick = function (){ openActivity({ r: r, m: m }); };
        var del = tr.querySelector('.re-del');
        if (del) del.onclick = function (){
          if (!confirm('Delete this activity? This cannot be undone.')) return;
          Promise.resolve(DB.remove('measurement', [m.id])).then(function (){
            enrich(); renderTicker(); renderAll();
            var nr = indById(r.id) || r; openDetail(nr); setModalTab('results');
          });
        };
      });
    }
  }

  // =========================================================================
  //  PROJECT MODAL - details · primary KPIs · secondary KPIs · activities
  // =========================================================================
  var curProject = null;   // DB project row being edited (null = brand-new, unsaved)

  function canEditProjects(){ return CURRENT_USER && curStatus() !== 'viewer'; }
  // Country-office users are scoped to their own country; Section/Admin to any.
  function projectCountryLock(){ return (curSection() === 'co' && CURRENT_USER) ? CURRENT_USER.country_iso3 : null; }
  function canEditThisProject(p){
    if (!canEditProjects()) return false;
    var lock = projectCountryLock();
    return !lock || !p || p.country_iso3 === lock;
  }

  function openProject(row){
    curProject = row || null;
    $('#prTitle').textContent = curProject ? ((curProject.code ? curProject.code + ' · ' : '') + curProject.name) : '＋ New project';
    var co = curProject ? DB._idx.countryByIso[curProject.country_iso3] : null;
    var don = curProject && curProject.donor_id != null ? DB._idx.donorById[curProject.donor_id] : null;
    $('#prSub').textContent = curProject
      ? [co ? co.name : '', don ? don.name : '', curProject.budget_usd != null ? '$' + fmtBudget(curProject.budget_usd) : ''].filter(Boolean).join('  ·  ')
      : 'Create a country programme project - donor, budget, KPIs and activities';
    setProjectTab('details');
    $('#projectModal').classList.add('on');
  }
  function closeProject(){
    $('#projectModal').classList.remove('on');
    if (/#project\//.test(location.hash || '')) {
      try { history.replaceState(null, '', location.pathname + location.search); }
      catch (e) { try { location.hash = ''; } catch (e2) {} }
    }
  }

  function setProjectTab(tab){
    tab = tab || 'details';
    Array.prototype.forEach.call($('#prTabs').children, function (b){ b.classList.toggle('on', b.dataset.prtab === tab); });
    var body = $('#prBody'); body.innerHTML = ''; body.scrollTop = 0;
    var node = null;
    if (tab === 'details') node = projectDetailsForm();
    else if (!curProject) node = projectNeedsSaveNote();
    else if (tab === 'primary') node = projectPrimaryEditor();
    else if (tab === 'secondary') node = projectSecondaryEditor();
    else if (tab === 'activities') node = projectActivitiesEditor();
    if (node) { body.appendChild(node); if (node.__init) node.__init(); }
  }
  function projectNeedsSaveNote(){
    var d = el('div', 'cp-note'); d.style.margin = '18px';
    d.textContent = 'Save the project details first - then you can attach primary KPIs, define secondary KPIs, and log activities.';
    return d;
  }

  // ---- option lists shared by the project forms ----------------------------
  function donorOptions(cur){
    return '<option value="">– select donor –</option>' + DB.tables.donor.slice()
      .sort(function (a, b){ return a.name < b.name ? -1 : 1; })
      .map(function (d){ return '<option value="' + d.id + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name) + '</option>'; }).join('');
  }
  function countryOptionsGrouped(cur, restrictIso){
    var byReg = {}; DB.tables.country.forEach(function (c){ (byReg[c.region] = byReg[c.region] || []).push(c); });
    return '<option value="">– select country –</option>' + REGION_ORDER.map(function (rg){
      var cs = (byReg[rg] || []).filter(function (c){ return !restrictIso || c.iso3 === restrictIso; })
        .sort(function (a, b){ return a.name < b.name ? -1 : 1; });
      if (!cs.length) return '';
      return '<optgroup label="' + esc(regionFull(rg)) + '">' + cs.map(function (c){
        return '<option value="' + c.iso3 + '"' + (c.iso3 === cur ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + '</optgroup>';
    }).join('');
  }

  // ---- TAB 1 · details ------------------------------------------------------
  function projectDetailsForm(){
    var p = curProject, lock = projectCountryLock(), ro = !canEditThisProject(p);
    var f = el('div', 'uform prform');
    var iso = p ? p.country_iso3 : (lock || '');
    f.innerHTML =
      '<div class="ufgrid prgrid">' +
      '  <label><span>Project code</span><input class="pf-code" type="text" value="' + esc(p ? (p.code || '') : '') + '" placeholder="e.g. PRJ-KEN-01"></label>' +
      '  <label class="pf-wide"><span>Project name *</span><input class="pf-name" type="text" value="' + esc(p ? p.name : '') + '" placeholder="What this project delivers"></label>' +
      '  <label><span>Donor</span><select class="pf-donor">' + donorOptions(p ? p.donor_id : null) + '</select></label>' +
      '  <label><span>Country *</span><select class="pf-country"' + (lock ? ' disabled' : '') + '>' + countryOptionsGrouped(iso, lock) + '</select></label>' +
      '  <label><span>Budget (USD)</span><input class="pf-budget" type="text" inputmode="numeric" value="' + esc(p && p.budget_usd != null ? fmt(p.budget_usd) : '') + '" placeholder="0"></label>' +
      '  <label><span>Lead</span><select class="pf-lead">' + leadOptions(p ? (p.lead || '') : '') + '</select></label>' +
      '  <label><span>Start date</span><input class="pf-start" type="date" value="' + esc(p ? (p.start_date || '') : '') + '"></label>' +
      '  <label><span>End date</span><input class="pf-end" type="date" value="' + esc(p ? (p.end_date || '') : '') + '"></label>' +
      '  <label class="pf-wide"><span>Description</span><textarea class="pf-desc" rows="3" placeholder="Objectives, scope, partners…">' + esc(p ? (p.description || '') : '') + '</textarea></label>' +
      '</div>' +
      (ro ? '<div class="cp-note">Read-only - you do not have permission to edit this project.</div>'
          : '<div class="cp-note">A project belongs to a <b>country</b>, is funded by a <b>donor</b>, and carries <b>primary</b> KPIs (from the inventory) and <b>secondary</b> KPIs (project-local). Save details to unlock the other tabs.</div>') +
      '<div class="ufbtns"><span class="ufmsg pf-msg"></span>' +
        (ro ? '' :
        '<button class="hbtn pf-cancel" type="button">Close</button>' +
        '<button class="hbtn primary pf-save" type="button">' + (p ? 'Save changes' : 'Create project') + '</button>') +
      '</div>';
    if (ro) { f.querySelectorAll('input,select,textarea').forEach(function (x){ x.disabled = true; }); return f; }
    f.querySelector('.pf-cancel').onclick = closeProject;
    f.querySelector('.pf-save').onclick = function (){ saveProjectDetails(f); };
    // Budget: re-insert thousands separators as the user types (keeps caret at end).
    var bud = f.querySelector('.pf-budget');
    if (bud) bud.addEventListener('input', function (){
      var digits = bud.value.replace(/[^\d]/g, '');
      bud.value = digits ? (+digits).toLocaleString('en-US') : '';
    });
    return f;
  }
  function saveProjectDetails(f){
    var v = function (c){ var e = f.querySelector(c); return e ? e.value : ''; };
    var name = v('.pf-name').trim(), iso = v('.pf-country') || projectCountryLock();
    var msg = f.querySelector('.pf-msg');
    if (msg) msg.classList.remove('ok');   // reset to error/neutral colour before revalidating
    if (!name){ msg.textContent = 'Project name is required.'; return; }
    if (!iso){ msg.textContent = 'Select a country.'; return; }
    var co = DB._idx.countryByIso[iso];
    var num = function (x){ return x === '' || isNaN(+x) ? null : +x; };
    var fields = {
      code: v('.pf-code').trim(), name: name,
      donor_id: v('.pf-donor') ? +v('.pf-donor') : null,
      country_iso3: iso, region: co ? co.region : null,
      budget_usd: num(v('.pf-budget').replace(/,/g, '')), lead: v('.pf-lead').trim(),
      start_date: v('.pf-start') || null, end_date: v('.pf-end') || null,
      description: v('.pf-desc').trim()
    };
    msg.textContent = 'Saving…';
    var done = function (){
      enrich(); renderTicker(); renderAll();
      openProject(curProject);   // refresh header + tabs against the saved row
      var m2 = $('#prBody .pf-msg'); if (m2) { m2.textContent = 'Saved.'; m2.classList.add('ok'); }
    };
    if (curProject){
      Object.keys(fields).forEach(function (k){ curProject[k] = fields[k]; });
      Promise.resolve(DB.persist('project', [curProject])).then(done);
    } else {
      if (!fields.code) fields.code = 'PRJ-' + iso + '-' + String((DB._idx.projectByCountry[iso] || []).length + 1).padStart(2, '0');
      fields.plan_id = S.plan;   // new projects belong to the plan currently in view
      Promise.resolve(DB.insert('project', fields)).then(function (rows){ curProject = rows[0]; done(); });
    }
  }

  // ---- TAB 2 · primary KPIs (from the inventory) ---------------------------
  function projectPrimaryEditor(){
    var p = curProject, ro = !canEditThisProject(p);
    var linked = {}; (DB._idx.projectKpiByProject[p.id] || []).forEach(function (pk){ linked[pk.indicator_id] = 1; });
    // candidate KPIs = the country's inventory (framework) KPIs
    var cands = IND.filter(function (r){ return !r.secondary && r.iso === p.country_iso3; })
      .sort(function (a, b){ return (a.sdg || 99) - (b.sdg || 99) || (a.raw.code < b.raw.code ? -1 : 1); });
    var box = el('div', 'prtab');
    box.appendChild(el('div', 'cp-note', 'Primary KPIs are drawn from the <b>KPI inventory</b> for ' + esc((DB._idx.countryByIso[p.country_iso3] || {}).name || p.country_iso3) + '. Tick the KPIs this project reports against; their activities aggregate into the project. Secondary (project-local) KPIs are managed on the next tab.'));
    if (!cands.length) box.appendChild(el('div', 'empty', 'No inventory KPIs for this country yet.'));
    var list = el('div', 'prkpi-list');
    // group by impact
    var byImpact = {};
    cands.forEach(function (r){ (byImpact[r.sdg || 0] = byImpact[r.sdg || 0] || []).push(r); });
    Object.keys(byImpact).sort(function (a, b){ return (+a || 99) - (+b || 99); }).forEach(function (sdg){
      var h = el('div', 'prkpi-grp'); var col = (+sdg) ? PILLAR_COLORS[+sdg] : '#94a3b8';
      var dot = el('span', 'cp-dot'); dot.style.background = col; h.appendChild(dot);
      h.appendChild(el('span', 'cp-pt', (+sdg) ? (pillarLabel(+sdg) + ' · ' + (PILLAR_NAMES[+sdg] || '')) : 'Unaligned'));
      list.appendChild(h);
      byImpact[sdg].forEach(function (r){
        var row = el('label', 'prkpi-row');
        var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!linked[r.id]; cb.disabled = ro; cb.dataset.iid = r.id;
        row.appendChild(cb);
        var txt = el('span', 'prkpi-txt');
        txt.innerHTML = '<b>' + esc(r.raw.code || '') + '</b> · ' + esc(r.name) + ' <span class="prkpi-st" style="color:' + STATUS[r.status].c + '">' + (r.frac != null ? Math.round(r.frac * 100) + '%' : 'no data') + '</span>';
        row.appendChild(txt);
        list.appendChild(row);
      });
    });
    box.appendChild(list);
    if (!ro) {
      var bar = el('div', 'ufbtns'); bar.innerHTML = '<span class="ufmsg pk-msg"></span>';
      var save = el('button', 'hbtn primary', 'Save primary KPIs');
      save.onclick = function (){ savePrimaryKpis(box, linked); };
      bar.appendChild(save); box.appendChild(bar);
    }
    return box;
  }
  function savePrimaryKpis(box, linked){
    var pid = curProject.id, checked = {};
    box.querySelectorAll('input[data-iid]').forEach(function (cb){ if (cb.checked) checked[+cb.dataset.iid] = 1; });
    var adds = [], delIds = [];
    Object.keys(checked).forEach(function (iid){ if (!linked[iid]) adds.push(+iid); });
    (DB._idx.projectKpiByProject[pid] || []).forEach(function (pk){ if (!checked[pk.indicator_id]) delIds.push(pk.id); });
    var jobs = [];
    if (adds.length) jobs.push(DB.insert('project_kpi', adds.map(function (iid){ return { project_id: pid, indicator_id: iid }; })));
    if (delIds.length) jobs.push(DB.remove('project_kpi', delIds));
    // keep the project's activity attribution roughly in sync with its KPI set
    var mChanged = [];
    adds.forEach(function (iid){ (DB._idx.measByIndicator[iid] || []).forEach(function (m){ if (m.project_id == null){ m.project_id = pid; mChanged.push(m); } }); });
    box.querySelectorAll('input[data-iid]').forEach(function (cb){ if (!cb.checked){ (DB._idx.measByIndicator[+cb.dataset.iid] || []).forEach(function (m){ if (m.project_id === pid){ m.project_id = null; mChanged.push(m); } }); } });
    if (mChanged.length) jobs.push(DB.persist('measurement', mChanged));
    var msg = box.querySelector('.pk-msg'); if (msg) msg.textContent = 'Saving…';
    Promise.all(jobs).then(function (){ enrich(); renderTicker(); renderAll(); setProjectTab('primary'); });
  }

  // ---- TAB 3 · secondary KPIs (project-local) ------------------------------
  function projectSecondaryEditor(){
    var p = curProject, ro = !canEditThisProject(p);
    var secs = (DB._idx.secondaryByProject[p.id] || []).slice().sort(function (a, b){ return (a.code < b.code ? -1 : 1); });
    var box = el('div', 'prtab');
    box.appendChild(el('div', 'cp-note', 'Secondary KPIs are <b>defined and used within this project only</b>. They are structured like primary KPIs and are <b>aggregated separately and together with primaries</b>. A global toggle (top bar) can exclude all secondary KPIs from every view when needed.'));
    if (!ro) { var add = el('button', 'hbtn primary', '＋ Add secondary KPI'); add.onclick = function (){ openSecEdit(null); }; box.appendChild(add); }
    var tbl = el('table', 'utbl');
    tbl.innerHTML = '<thead><tr><th>Code</th><th>KPI</th><th>Unit</th><th>Baseline</th><th>Target</th><th>Progress</th><th></th></tr></thead>';
    var tb = el('tbody');
    if (!secs.length) tb.innerHTML = '<tr><td colspan="7" class="re-empty">No secondary KPIs yet.</td></tr>';
    secs.forEach(function (ind){
      var r = INDBYID[ind.id]; var u = ind.unit === '%' ? '%' : '';
      var tr = el('tr');
      tr.innerHTML = '<td class="umono">' + esc(ind.code || '') + '</td>'
        + '<td><span class="udot" style="background:#33C2B4"></span>' + esc(ind.name) + '</td>'
        + '<td class="umono">' + esc(ind.unit || '') + '</td>'
        + '<td class="umono">' + fmtNum(ind.baseline_value) + u + '</td>'
        + '<td class="umono">' + fmtNum(ind.target_value) + u + '</td>'
        + '<td class="umono" style="color:' + STATUS[r ? r.status : 'nodata'].c + '">' + (r && r.frac != null ? Math.round(r.frac * 100) + '%' : '–') + '</td>';
      var act = el('td', 'uact');
      if (!ro) {
        var ed = el('button', 'cp-mini', 'Edit'); ed.onclick = function (){ openSecEdit(ind); };
        var del = el('button', 'cp-del', '🗑'); del.title = 'Delete secondary KPI + its activities';
        del.onclick = function (){ if (confirm('Delete this secondary KPI and its activities?')) deleteSecondary(ind); };
        act.appendChild(ed); act.appendChild(del);
      }
      tr.appendChild(act); tb.appendChild(tr);
    });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }
  function openSecEdit(ind){
    var body = $('#secEditBody'); body.innerHTML = '';
    $('#secEditTitle').textContent = ind ? ('Edit secondary KPI · ' + (ind.code || '')) : '＋ Add secondary KPI';
    var f = el('div', 'uform');
    var bd = ind ? (ind.baseline_date || (BASE_YEAR + '-01-01')) : '2025-01-01';
    var td = ind ? (ind.target_date || (TARGET_YEAR + '-12-31')) : '2027-12-31';
    f.innerHTML =
      '<div class="ufgrid kpigrid">' +
      '  <label class="kf-wide"><span>KPI name *</span><input class="sf-name" type="text" value="' + esc(ind ? ind.name : '') + '"></label>' +
      '  <label><span>Unit</span><select class="sf-unit">' + optionList(UNIT_OPTS, ind ? ind.unit : 'count') + '</select></label>' +
      '  <label><span>Direction</span><select class="sf-dir"><option value="increase"' + (!ind || ind.direction === 'increase' ? ' selected' : '') + '>Higher is better</option><option value="decrease"' + (ind && ind.direction === 'decrease' ? ' selected' : '') + '>Lower is better</option></select></label>' +
      '  <label><span>Baseline value</span><input class="sf-base" type="number" step="any" value="' + esc(ind ? ind.baseline_value : 0) + '"></label>' +
      '  <label><span>Target value</span><input class="sf-tgt" type="number" step="any" value="' + esc(ind ? ind.target_value : '') + '"></label>' +
      '  <label><span>Baseline date</span><input class="sf-basedate" type="date" value="' + esc(bd) + '"></label>' +
      '  <label><span>Target date</span><input class="sf-tgtdate" type="date" value="' + esc(td) + '"></label>' +
      '  <label><span>Frequency</span><select class="sf-freq">' + optionList(FREQ_OPTS, ind ? ind.frequency : 'quarterly') + '</select></label>' +
      '  <label class="kf-wide"><span>Means of verification</span><input class="sf-mov" type="text" value="' + esc(ind ? (ind.means_of_verification || '') : 'Project monitoring records') + '"></label>' +
      '</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn sf-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary sf-save" type="button">' + (ind ? 'Save changes' : 'Add KPI') + '</button></div>';
    f.querySelector('.sf-cancel').onclick = closeSecEdit;
    f.querySelector('.sf-save').onclick = function (){ saveSecondary(ind, f); };
    body.appendChild(f);
    $('#secEditOverlay').classList.add('on');
    var fn = f.querySelector('.sf-name'); if (fn) fn.focus();
  }
  function closeSecEdit(){ var o = $('#secEditOverlay'); if (o) o.classList.remove('on'); }
  function saveSecondary(ind, f){
    var v = function (c){ return f.querySelector(c).value; };
    var name = v('.sf-name').trim(); var msg = f.querySelector('.ufmsg');
    if (!name){ msg.textContent = 'KPI name is required.'; return; }
    var num = function (x){ return x === '' || isNaN(+x) ? null : +x; };
    var bd = v('.sf-basedate'), td = v('.sf-tgtdate');
    msg.textContent = 'Saving…';
    var apply = function (p){ Promise.resolve(p).then(function (){ closeSecEdit(); enrich(); renderTicker(); renderAll(); setProjectTab('secondary'); }); };
    if (ind){
      ind.name = name; ind.unit = v('.sf-unit'); ind.direction = v('.sf-dir');
      var b = num(v('.sf-base')); if (b != null) ind.baseline_value = b;
      var t = num(v('.sf-tgt')); if (t != null) ind.target_value = t;
      if (bd){ ind.baseline_date = bd; ind.baseline_year = +bd.slice(0, 4); }
      if (td){ ind.target_date = td; ind.target_year = +td.slice(0, 4); }
      ind.frequency = v('.sf-freq'); ind.means_of_verification = v('.sf-mov').trim();
      apply(DB.persist('indicator', [ind]));
    } else {
      var n = (DB._idx.secondaryByProject[curProject.id] || []).length + 1;
      var code = 'SEC-' + (curProject.code ? curProject.code.replace(/^PRJ-/, '') : ('P' + curProject.id)) + '.' + n;
      apply(DB.insert('indicator', {
        result_id: null, project_id: curProject.id, secondary: 1, sdg: null, code: code,
        name: name, type: 'quantitative', unit: v('.sf-unit'), direction: v('.sf-dir'),
        baseline_value: num(v('.sf-base')) || 0, baseline_year: bd ? +bd.slice(0, 4) : BASE_YEAR, baseline_date: bd || (BASE_YEAR + '-01-01'),
        target_value: num(v('.sf-tgt')), target_year: td ? +td.slice(0, 4) : TARGET_YEAR, target_date: td || (TARGET_YEAR + '-12-31'),
        means_of_verification: v('.sf-mov').trim(), collection_method: 'Self-reporting',
        frequency: v('.sf-freq'), responsible_id: null, disaggregation: 'none'
      }));
    }
  }
  function deleteSecondary(ind){
    var measIds = (DB._idx.measByIndicator[ind.id] || []).map(function (m){ return m.id; });
    Promise.all([ DB.remove('measurement', measIds), DB.remove('indicator', [ind.id]) ]).then(function (){
      enrich(); renderTicker(); renderAll(); setProjectTab('secondary');
    });
  }

  // ---- TAB 4 · activities (moved from the main screen) ---------------------
  var BASE_YEAR = 2025, TARGET_YEAR = 2027;   // default KPI horizon for new secondary KPIs
  function projectKpiOptions(p){
    var prim = (DB._idx.projectKpiByProject[p.id] || []).map(function (pk){ return INDBYID[pk.indicator_id]; }).filter(Boolean);
    var secs = (DB._idx.secondaryByProject[p.id] || []).map(function (i){ return INDBYID[i.id]; }).filter(Boolean);
    function opt(r, tag){ return '<option value="' + r.id + '">' + (r.raw.code ? esc(r.raw.code) + ' · ' : '') + esc(r.name) + ' [' + tag + ']</option>'; }
    var html = '';
    if (prim.length) html += '<optgroup label="Primary KPIs">' + prim.map(function (r){ return opt(r, 'primary'); }).join('') + '</optgroup>';
    if (secs.length) html += '<optgroup label="Secondary KPIs">' + secs.map(function (r){ return opt(r, 'secondary'); }).join('') + '</optgroup>';
    return html;
  }
  // ---- Real settlement search (OpenStreetMap / Nominatim) ------------------
  // Activities are pinned to a REAL city/village with real coordinates, looked up
  // live from the OpenStreetMap database as the user types. ISO3→ISO2 lets us
  // scope the search to the project's country.
  var ISO3_TO_ISO2 = {
    KEN:'ke',ETH:'et',NGA:'ng',GHA:'gh',UGA:'ug',TZA:'tz',RWA:'rw',ZMB:'zm',MOZ:'mz',SEN:'sn',
    MWI:'mw',COD:'cd',CIV:'ci',CMR:'cm',ZWE:'zw',EGY:'eg',MAR:'ma',JOR:'jo',TUN:'tn',YEM:'ye',
    SDN:'sd',IRQ:'iq',LBN:'lb',BGD:'bd',NPL:'np',PAK:'pk',IDN:'id',PHL:'ph',VNM:'vn',KHM:'kh',
    LKA:'lk',MMR:'mm',PNG:'pg',MNG:'mn',LAO:'la',ALB:'al',GEO:'ge',MDA:'md',KGZ:'kg',TJK:'tj',
    UKR:'ua',ARM:'am',UZB:'uz',SRB:'rs',BOL:'bo',GTM:'gt',PER:'pe',COL:'co',HTI:'ht',HND:'hn',
    ECU:'ec',PRY:'py',SLV:'sv',JAM:'jm',DOM:'do',MEX:'mx'
  };
  function countryIso2(iso3){ return ISO3_TO_ISO2[iso3] || ''; }

  // Photon (photon.komoot.io) is an OpenStreetMap-backed geocoder built for
  // search-as-you-type: it does prefix matching (Nominatim's /search does not).
  // We bias by the country centroid and filter results to the country + settlement
  // place types, so villages/towns/cities in-country rank first.
  var _placeAbort = null;
  var _NON_SETTLEMENT = { country:1, state:1, region:1, continent:1, archipelago:1, island:1, islet:1, sea:1, ocean:1 };
  var _CONTINENTS = { 'africa':1, 'asia':1, 'europe':1, 'north america':1, 'south america':1, 'antarctica':1, 'oceania':1, 'australia':1, 'americas':1 };
  function normPhoton(f){
    var pr = f.properties || {}, c = (f.geometry || {}).coordinates || [];
    return {
      name: pr.name || pr.city || pr.county || '',
      lat: c[1], lon: c[0],
      addresstype: pr.osm_value || pr.type || 'place',
      address: { state: pr.state || pr.county || pr.district || pr.region || '' },
      display_name: [pr.name, pr.state, pr.country].filter(Boolean).join(', ')
    };
  }
  /** Query OpenStreetMap (via Photon) for settlements matching `query`, scoped to
   *  a country (ISO3). Aborts any in-flight request; `cb(err, list)`. */
  function searchPlaces(query, iso3, cb){
    if (_placeAbort) { try { _placeAbort.abort(); } catch (e) {} }
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    _placeAbort = ctrl;
    var iso2 = countryIso2(iso3).toUpperCase();
    var c = worldCentroid(iso3);   // [lng, lat] - bias results toward the country
    var bb = worldBBox(iso3);      // [minLon, minLat, maxLon, maxLat] - hard-constrain to the country
    var url = 'https://photon.komoot.io/api/?limit=25&lang=en&osm_tag=place&q=' + encodeURIComponent(query)
      + (c ? '&lat=' + c[1] + '&lon=' + c[0] : '')
      + (bb ? '&bbox=' + bb[0] + ',' + bb[1] + ',' + bb[2] + ',' + bb[3] : '');
    fetch(url, { headers: { 'Accept': 'application/json' }, signal: ctrl ? ctrl.signal : undefined })
      .then(function (r){ return r.ok ? r.json() : { features: [] }; })
      .then(function (fc){
        var feats = (fc && fc.features) || [], out = [];
        feats.forEach(function (f){
          var pr = f.properties || {};
          if (iso2 && String(pr.countrycode || '').toUpperCase() !== iso2) return;   // in-country only
          if (_NON_SETTLEMENT[pr.osm_value] || _NON_SETTLEMENT[pr.type]) return;      // settlements only
          if (_CONTINENTS[String(pr.name || '').toLowerCase()]) return;               // never list continents
          if (!f.geometry || !f.geometry.coordinates) return;
          out.push(normPhoton(f));
        });
        cb(null, out.slice(0, 8));
      })
      .catch(function (err){ if (err && err.name === 'AbortError') return; cb(err, null); });
  }
  /** Wire a live search dropdown onto an input. The chosen place (name + real
   *  lat/lng) is stored on input.__place; typing again clears it (a real result
   *  must be picked before saving). */
  function mountPlaceSearch(input, results, chosen, iso3){
    var timer = null;
    function clearChosen(){ input.__place = null; chosen.textContent = ''; chosen.classList.remove('on'); }
    function ctxOf(p){ var a = p.address || {}; return a.state || a.region || a.county || a.state_district || a.province || ''; }
    function render(list){
      results.innerHTML = '';
      if (!list.length){ results.innerHTML = '<div class="place-loading">No settlements found - try another spelling.</div>'; results.classList.add('on'); return; }
      list.forEach(function (p){
        var name = p.name || (p.display_name || '').split(',')[0];
        var row = el('div', 'place-row');
        row.innerHTML = '<span class="place-nm">' + esc(name) + '</span>'
          + '<span class="place-ty">' + esc(p.addresstype || p.type || 'place') + '</span>'
          + '<span class="place-ctx">' + esc(ctxOf(p)) + '</span>';
        row.onmousedown = function (e){ e.preventDefault(); };   // keep focus, fire before blur
        row.onclick = function (){
          input.value = name;
          input.__place = { name: name, lat: +p.lat, lng: +p.lon };
          results.innerHTML = ''; results.classList.remove('on');
          chosen.textContent = '✓ ' + name + '  ·  ' + (+p.lat).toFixed(4) + ', ' + (+p.lon).toFixed(4);
          chosen.classList.add('on');
        };
        results.appendChild(row);
      });
      results.classList.add('on');
    }
    input.addEventListener('input', function (){
      clearChosen();
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (q.length < 1){ results.innerHTML = ''; results.classList.remove('on'); return; }
      results.innerHTML = '<div class="place-loading">Searching OpenStreetMap…</div>'; results.classList.add('on');
      timer = setTimeout(function (){
        searchPlaces(q, iso3, function (err, list){
          if (err){ results.innerHTML = '<div class="place-loading">Couldn’t reach OpenStreetMap - check the connection.</div>'; return; }
          render(list);
        });
      }, 220);   // debounce - Photon (Komoot) has no strict rate limit, so keep it snappy
    });
    input.addEventListener('focus', function (){ if (results.children.length) results.classList.add('on'); });
    input.addEventListener('blur', function (){ setTimeout(function (){ results.classList.remove('on'); }, 150); });
  }
  // Activities tab = the LIST of this project's activities. New ones are added
  // through the activity popup (＋ Add activity).
  function projectActivitiesEditor(){
    var p = curProject, ro = !canEditThisProject(p);
    var editable = !ro;
    var kpiOpts = projectKpiOptions(p);
    var all = (DB._idx.measByProject[p.id] || []).slice().sort(function (a, b){ return (a.date < b.date) ? 1 : -1; });
    var box = el('div', 'prtab');

    var head = el('div', 'pr-acthead');
    head.appendChild(el('div', 'sec-h2', fmt(all.length) + ' activit' + (all.length === 1 ? 'y' : 'ies')));
    if (editable) {
      if (kpiOpts) {
        var add = el('button', 'hbtn primary', '＋ Add activity');
        add.onclick = function (){ openProjectActivityAdd(p); };
        head.appendChild(add);
      } else {
        head.appendChild(el('span', 'pr-actnote', 'Attach a primary or secondary KPI first, then you can log activities.'));
      }
    }
    box.appendChild(head);

    var ms = all;
    var tbl = el('table', 'utbl retbl');
    tbl.innerHTML = '<thead><tr><th>Date</th><th>KPI</th><th>Value</th><th>Location</th><th>Beneficiaries</th><th>Logged by</th>' + (editable ? '<th></th>' : '') + '</tr></thead>';
    var tb = el('tbody');
    if (!ms.length) tb.innerHTML = '<tr><td colspan="' + (editable ? 7 : 6) + '" class="re-empty">No activities logged for this project yet.</td></tr>';
    ms.forEach(function (m){
      var r = INDBYID[m.indicator_id];
      var tr = el('tr'); tr.dataset.mid = m.id;
      tr.innerHTML = '<td class="re-datecell">' + (m.date ? shortDate(m.date) : '–') + '</td>'
        + '<td>' + esc(r ? r.name : ('#' + m.indicator_id)) + (r && r.secondary ? ' <span class="sec-badge">sec</span>' : '') + '</td>'
        + '<td class="umono">' + fmtNum(m.value) + '</td>'
        + '<td>' + esc(m.place_name || '–') + '</td>'
        + '<td class="umono">' + (benTotalFor(m.id) ? fmt(benTotalFor(m.id)) : '–') + '</td>'
        + '<td>' + esc(userName(m.reported_by_id)) + '</td>'
        + (editable ? '<td class="re-actcell"><button class="re-edit">Edit</button><button class="re-del">🗑</button></td>' : '');
      tb.appendChild(tr);
    });
    tbl.appendChild(tb); box.appendChild(tbl);
    if (editable) {
      box.querySelectorAll('tr[data-mid]').forEach(function (tr){
        var m = DB._idx.measById[+tr.dataset.mid]; if (!m) return;
        var r = INDBYID[m.indicator_id];
        var ed = tr.querySelector('.re-edit'); if (ed) ed.onclick = function (){ if (r) openActivity({ r: r, m: m }); };
        var del = tr.querySelector('.re-del'); if (del) del.onclick = function (){
          if (!confirm('Delete this activity?')) return;
          Promise.resolve(DB.remove('measurement', [m.id])).then(function (){ enrich(); renderTicker(); renderAll(); setProjectTab('activities'); });
        };
      });
    }
    return box;
  }
  // ---- Activity popup shared shell: two tabs (Activity details · Beneficiaries) ----
  var _actBens = [];   // beneficiaries being edited in the activity popup [{id?, type_id, value}]
  function naTabbedBody(detailsInner, footerInner){
    return '<div class="modal-tabs na-tabs" id="naTabs">'
      + '<button data-natab="details" class="on">Activity details</button>'
      + '<button data-natab="beneficiaries">Beneficiaries</button></div>'
      + '<div id="naDetailsPanel">' + detailsInner + '</div>'
      + '<div id="naBenPanel" class="prtab hide"></div>'
      + footerInner;
  }
  function wireNaTabs(){
    var tabs = $('#naTabs'); if (!tabs) return;
    tabs.addEventListener('click', function (e){
      var b = e.target.closest('button'); if (!b) return; var t = b.dataset.natab;
      Array.prototype.forEach.call(tabs.children, function (x){ x.classList.toggle('on', x === b); });
      $('#naDetailsPanel').classList.toggle('hide', t !== 'details');
      $('#naBenPanel').classList.toggle('hide', t !== 'beneficiaries');
      if (t === 'beneficiaries') renderBenPanel();
    });
  }
  // Beneficiaries tab - table of {measure, value}; add/edit via a popup (mirrors
  // the project's Add-activity flow), all held in _actBens until the activity saves.
  function renderBenPanel(){
    var host = $('#naBenPanel'); if (!host) return; host.innerHTML = '';
    host.appendChild(el('div', 'cp-note', 'Record who benefits from this activity, broken down by measure (Men, Women, Children, PWD, Refugees, IDPs, …).'));
    if (!benTypes().length){ host.appendChild(el('div', 'empty', 'No beneficiary measures defined yet - add them in Global Items → Beneficiaries.')); return; }
    var head = el('div', 'pr-acthead');
    head.appendChild(el('div', 'sec-h2', fmt(_actBens.length) + ' beneficiary group' + (_actBens.length === 1 ? '' : 's')));
    var add = el('button', 'hbtn primary', '＋ Add beneficiary'); add.onclick = function (){ openBenEdit(null); };
    head.appendChild(add); host.appendChild(head);
    var tbl = el('table', 'utbl retbl'); tbl.innerHTML = '<thead><tr><th>Measure</th><th>Value</th><th></th></tr></thead>';
    var tb = el('tbody'), total = 0;
    if (!_actBens.length) tb.innerHTML = '<tr><td colspan="3" class="re-empty">No beneficiaries recorded yet.</td></tr>';
    _actBens.forEach(function (b, idx){
      total += (+b.value || 0);
      var tr = el('tr');
      tr.innerHTML = '<td><span class="udot" style="background:' + benColor(b.type_id) + '"></span>' + esc(benTypeName(b.type_id)) + '</td><td class="umono">' + fmtNum(b.value) + '</td>';
      var act = el('td', 're-actcell');
      var ed = el('button', 're-edit', 'Edit'); ed.onclick = function (){ openBenEdit(idx); };
      var del = el('button', 're-del', '🗑'); del.onclick = function (){ _actBens.splice(idx, 1); renderBenPanel(); };
      act.appendChild(ed); act.appendChild(del); tr.appendChild(act); tb.appendChild(tr);
    });
    tbl.appendChild(tb); host.appendChild(tbl);
    if (_actBens.length) host.appendChild(el('div', 'ben-total', 'Total beneficiaries: ' + fmt(total)));
  }
  function openBenEdit(idx){
    var body = $('#benEditBody'); body.innerHTML = '';
    var cur = idx != null ? _actBens[idx] : null;
    $('#benEditTitle').textContent = cur ? 'Edit beneficiary' : '＋ Add beneficiary';
    var opts = benTypes().map(function (t){ return '<option value="' + t.id + '"' + (cur && cur.type_id === t.id ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('');
    var f = el('div', 'uform');
    f.innerHTML = '<div class="ufgrid" style="grid-template-columns:1fr 1fr">' +
      '<label><span>Measure *</span><select class="be-type">' + opts + '</select></label>' +
      '<label><span>Value *</span><input class="be-val" type="number" step="any" value="' + (cur && cur.value != null ? esc(cur.value) : '') + '" placeholder="0"></label>' +
      '</div><div class="ufbtns"><span class="ufmsg"></span>' +
      '<button class="hbtn be-cancel" type="button">Cancel</button>' +
      '<button class="hbtn primary be-save" type="button">' + (cur ? 'Save' : 'Add') + '</button></div>';
    f.querySelector('.be-cancel').onclick = closeBenEdit;
    f.querySelector('.be-save').onclick = function (){
      var tid = +f.querySelector('.be-type').value, val = f.querySelector('.be-val').value, msg = f.querySelector('.ufmsg');
      if (!tid){ msg.textContent = 'Select a measure.'; return; }
      if (val === '' || isNaN(+val)){ msg.textContent = 'Enter a numeric value.'; return; }
      if (cur){ cur.type_id = tid; cur.value = +val; } else { _actBens.push({ type_id: tid, value: +val }); }
      closeBenEdit(); renderBenPanel();
    };
    body.appendChild(f);
    $('#benEditOverlay').classList.add('on');
    var fn = f.querySelector('.be-type'); if (fn) fn.focus();
  }
  function closeBenEdit(){ var o = $('#benEditOverlay'); if (o) o.classList.remove('on'); }
  // Persist _actBens for a measurement: replace all existing rows with the current set.
  function saveBeneficiaries(measurementId){
    var existing = (DB._idx.benByMeasurement[measurementId] || []).map(function (b){ return b.id; });
    var rows = _actBens.filter(function (b){ return b.type_id != null; })
      .map(function (b){ return { measurement_id: measurementId, type_id: b.type_id, value: (b.value == null || isNaN(+b.value)) ? null : +b.value }; });
    var jobs = [];
    if (existing.length) jobs.push(DB.remove('beneficiary', existing));
    if (rows.length) jobs.push(DB.insert('beneficiary', rows));
    return Promise.all(jobs);
  }

  // Add-activity popup (over the project modal). Reuses the New Activity overlay.
  function openProjectActivityAdd(p){
    var host = $('#naBody'); host.innerHTML = '';
    $('#naHead').textContent = 'Log activity - ' + (p.code || p.name);
    _actBens = [];
    var kpiOpts = projectKpiOptions(p);
    var today = new Date(TODAY).toISOString().slice(0, 10);
    var countryName = (DB._idx.countryByIso[p.country_iso3] || {}).name || p.country_iso3;
    var details = '<div class="aform"><div class="afgrid">' +
      '  <label class="af full"><span>KPI <em>*</em></span><select id="paKpi">' + kpiOpts + '</select></label>' +
      '  <label class="af full"><span>Activity / what was done <em>*</em></span><input id="paTitle" type="text" placeholder="e.g. District data-governance workshop delivered"></label>' +
      '  <label class="af"><span id="paValLbl">Value <em>*</em></span><input id="paValue" type="number" step="any" placeholder="0"></label>' +
      '  <label class="af"><span>Activity date</span><input id="paDate" type="date" value="' + today + '"></label>' +
      '  <label class="af full"><span>Location - search a real city / village in ' + esc(countryName) + ' <em>*</em></span>' +
      '     <div class="place-search"><input id="paPlace" type="text" autocomplete="off" placeholder="Start typing a settlement name…">' +
      '       <div class="place-results" id="paPlaceResults"></div></div>' +
      '     <div class="place-chosen" id="paPlaceChosen"></div></label>' +
      '  <div class="afprev full" id="paPreview"></div>' +
      '  <label class="af full"><span>Narrative / notes</span><textarea id="paNote" rows="2" placeholder="What was done, evidence, next steps…"></textarea></label>' +
      '</div><div class="cp-note">Locations are searched live from the <b>OpenStreetMap</b> database and pinned to their real coordinates, then plotted on the map.</div></div>';
    var footer = '<div class="afbtns"><span class="afmsg" id="paMsg"></span>' +
      '<button class="hbtn" id="paCancel" type="button">Cancel</button>' +
      '<button class="hbtn primary" id="paSave" type="button">Log activity</button></div>';
    host.innerHTML = naTabbedBody(details, footer);
    wireNaTabs();
    var syncVal = function (){ var r = indById(+$('#paKpi').value); $('#paValLbl').textContent = activityValLabel(r); fillReportPreview('paPreview', r, 'paValue'); };
    $('#paKpi').onchange = syncVal;
    $('#paValue').addEventListener('input', function (){ fillReportPreview('paPreview', indById(+$('#paKpi').value), 'paValue'); });
    $('#paCancel').onclick = closeNewActivity;
    $('#paSave').onclick = function (){ submitProjectActivity(p); };
    mountPlaceSearch($('#paPlace'), $('#paPlaceResults'), $('#paPlaceChosen'), p.country_iso3);
    syncVal();
    $('#newActivityOverlay').classList.add('on');
    setTimeout(function (){ var f = $('#paKpi'); if (f) f.focus(); }, 0);
  }
  function submitProjectActivity(p){
    var r = indById(+$('#paKpi').value); var msg = $('#paMsg');
    if (!r){ msg.textContent = 'Select a KPI.'; return; }
    var title = ($('#paTitle').value || '').trim();
    if (!title){ msg.textContent = 'Activity description is required.'; $('#paTitle').focus(); return; }
    var valRaw = $('#paValue').value;
    if (valRaw === '' || isNaN(+valRaw)){ msg.textContent = 'Enter the value for this activity.'; $('#paValue').focus(); return; }
    var placeEl = $('#paPlace'), place = placeEl ? placeEl.__place : null;
    if (!place || place.lat == null){ msg.textContent = 'Search and pick a real location from the list.'; if (placeEl) placeEl.focus(); return; }
    var date = $('#paDate').value || new Date(TODAY).toISOString().slice(0, 10);
    msg.textContent = 'Saving…';
    insertProjectActivity(r, p.id, title, valRaw, date, ($('#paNote').value || '').trim(), place)
      .then(function (measRow){ return saveBeneficiaries(measRow.id); })
      .then(function (){ enrich(); renderTicker(); renderAll(); closeNewActivity(); setProjectTab('activities'); });
  }
  // Log an activity attributed to a project + a geographic point. An Activity lives
  // in the DELIVERY chain (Donor → Project → Activity), NOT in the results chain:
  // it IS the measurement - one logged report of progress against an assigned KPI.
  // The measurement carries the project attribution (project_id) and the KPI it
  // reports (indicator_id); beneficiaries hang off it. Returns the measurement row
  // (id assigned) so beneficiaries can be attached.
  function insertProjectActivity(r, projectId, title, valRaw, date, note, place){
    var byId = CURRENT_USER ? CURRENT_USER.id : null;
    var measRow = {
      indicator_id: r.id, date: date, value: +valRaw,
      narrative: note || title, reported_by_id: byId, project_id: projectId,
      place_name: place ? place.name : null, place_lat: place ? place.lat : null, place_lng: place ? place.lng : null
    };
    return DB.insert('measurement', measRow).then(function (){ return measRow; });   // measRow.id assigned by insert
  }

  function stat(label, val, sub){
    var badge = (sub == null || sub === '') ? '' : '<span class="sbadge">' + esc(sub) + '</span>';
    return '<div class="stat"><div class="sl">' + esc(label) + '</div><div class="sv">' + val
      + '</div><div class="ss">' + badge + '</div></div>';
  }

  // =========================================================================
  //  CONTROL PANEL - Results Framework editing
  // =========================================================================
  function openControl(){
    // Users tab is Owner-only; Donors + Beneficiary Types are Admin - toggle before opening
    var ut = $('#cpTabs').querySelector('[data-cptab="users"]');
    if (ut) ut.classList.toggle('hide', !canManageUsers());
    var dt = $('#cpTabs').querySelector('[data-cptab="donors"]');
    if (dt) dt.classList.toggle('hide', !canEditFramework());
    var bt = $('#cpTabs').querySelector('[data-cptab="beneficiaries"]');
    if (bt) bt.classList.toggle('hide', !canEditFramework());
    renderControl('donors'); $('#cpModal').classList.add('on');
  }
  function closeControl(){ $('#cpModal').classList.remove('on'); }

  // Results Management modal - Results Framework + KPI Inventory
  function openResults(){ renderResults('framework'); $('#rmModal').classList.add('on'); }
  function closeResults(){ $('#rmModal').classList.remove('on'); }

  function openAbout(){ $('#aboutModal').classList.add('on'); }
  function closeAbout(){ $('#aboutModal').classList.remove('on'); }

  function renderControl(tab){
    tab = tab || 'donors';
    if (tab === 'users' && !canManageUsers()) tab = 'donors';
    if ((tab === 'donors' || tab === 'beneficiaries') && !canEditFramework()) tab = 'donors';
    Array.prototype.forEach.call($('#cpTabs').children, function (x){ x.classList.toggle('on', x.dataset.cptab === tab); });
    var body = $('#cpBody'); body.innerHTML = '';
    if (tab === 'users') body.appendChild(usersEditor());
    else if (tab === 'beneficiaries') body.appendChild(beneficiaryTypesEditor());
    else body.appendChild(donorsEditor());
  }

  function renderResults(tab){
    tab = tab || 'framework';
    if ((tab === 'kpis' || tab === 'framework') && !canEditFramework()) tab = 'framework';
    Array.prototype.forEach.call($('#rmTabs').children, function (x){ x.classList.toggle('on', x.dataset.rmtab === tab); });
    var body = $('#rmBody'); body.innerHTML = '';
    if (tab === 'kpis') body.appendChild(kpiInventoryEditor());
    else body.appendChild(frameworkEditor());
  }

  // =========================================================================
  //  CONTROL PANEL - Donors (funding partners; editable lookup; Admin only)
  // =========================================================================
  var DONOR_TYPES = ['Bilateral', 'Multilateral', 'Foundation'];
  var DONOR_PALETTE = ['#4FA9E8','#33C2B4','#9D7BEE','#F5A04D','#EC7BA6','#5399EA','#2CC4A0','#E0A93B',
    '#6FBF73','#EA8A5B','#C58BE0','#48B0C4','#D98CA0','#8FB84E','#E2B54A','#7E9BEA'];
  function donors(){ return DB.tables.donor.slice().sort(function (a, b){ return a.name < b.name ? -1 : 1; }); }
  // First palette colour not already taken by an existing donor (falls back to a
  // deterministic palette slot once every colour is in use).
  function nextDonorColor(){
    var used = {}; DB.tables.donor.forEach(function (d){ if (d.color) used[d.color.toUpperCase()] = 1; });
    for (var i = 0; i < DONOR_PALETTE.length; i++){ if (!used[DONOR_PALETTE[i].toUpperCase()]) return DONOR_PALETTE[i]; }
    return DONOR_PALETTE[DB.tables.donor.length % DONOR_PALETTE.length];
  }
  function donorProjectCount(id){ return DB.tables.project.reduce(function (n, p){ return n + (p.donor_id === id ? 1 : 0); }, 0); }
  function applyDonorMutation(p){
    return Promise.resolve(p).then(function (){ closeDonorEdit(); enrich(); renderTicker(); renderAll(); renderControl('donors'); });
  }
  function donorsEditor(){
    var box = el('div', 'cp-users');
    var note = el('div', 'cp-note');
    note.innerHTML = 'Donors are the <b>funding partners</b> behind projects. Add, edit or delete them here - they populate the Donor drop-down on every project, the Donors filter and the map’s Donor colouring. Type is one of <b>Bilateral</b>, <b>Multilateral</b> or <b>Foundation</b>.';
    box.appendChild(note);
    var add = el('button', 'hbtn primary', '＋ Add donor'); add.onclick = function (){ openDonorEdit(null); };
    box.appendChild(add);
    var tbl = el('table', 'utbl');
    tbl.innerHTML = '<thead><tr><th>Donor</th><th>Short</th><th>Type</th><th>Projects</th><th></th></tr></thead>';
    var tb = el('tbody');
    var list = donors();
    if (!list.length) tb.innerHTML = '<tr><td colspan="5" class="re-empty">No donors yet.</td></tr>';
    list.forEach(function (d){
      var used = donorProjectCount(d.id);
      var tr = el('tr');
      tr.innerHTML =
        '<td><span class="udot" style="background:' + (d.color || '#94a3b8') + '"></span>' + esc(d.name) + '</td>' +
        '<td class="umono">' + esc(d.short_name || '') + '</td>' +
        '<td>' + esc(d.type || '') + '</td>' +
        '<td class="umono">' + fmt(used) + '</td>';
      var act = el('td', 'uact');
      var ed = el('button', 'cp-mini', 'Edit'); ed.onclick = function (){ openDonorEdit(d); };
      var del = el('button', 'cp-del', '🗑'); del.title = used ? 'In use by ' + used + ' project(s) - cannot delete' : 'Delete donor';
      del.disabled = !!used;
      del.onclick = function (){ if (used) return; if (confirm('Delete donor "' + d.name + '"?')) deleteDonor(d); };
      act.appendChild(ed); act.appendChild(del); tr.appendChild(act); tb.appendChild(tr);
    });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }
  function openDonorEdit(d){
    var body = $('#donorEditBody'); body.innerHTML = '';
    $('#donorEditTitle').textContent = d ? ('Edit donor · ' + d.name) : '＋ Add donor';
    var color = d && d.color ? d.color : nextDonorColor();
    var typeOpts = DONOR_TYPES.map(function (t){ return '<option value="' + t + '"' + (d && d.type === t ? ' selected' : '') + '>' + t + '</option>'; }).join('');
    var f = el('div', 'uform');
    f.innerHTML =
      '<div class="ufgrid" style="grid-template-columns:2fr 1fr">' +
      '  <label><span>Donor name *</span><input class="dn-name" type="text" value="' + esc(d ? d.name : '') + '" placeholder="e.g. European Union"></label>' +
      '  <label><span>Short name</span><input class="dn-short" type="text" value="' + esc(d && d.short_name ? d.short_name : '') + '" placeholder="e.g. EU"></label>' +
      '</div>' +
      '<div class="ufgrid" style="grid-template-columns:2fr 1fr">' +
      '  <label><span>Type *</span><select class="dn-type">' + typeOpts + '</select></label>' +
      '  <label><span>Identity colour</span><input class="dn-color" type="color" value="' + esc(color) + '"></label>' +
      '</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn dn-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary dn-save" type="button">' + (d ? 'Save changes' : 'Add donor') + '</button></div>';
    f.querySelector('.dn-cancel').onclick = closeDonorEdit;
    f.querySelector('.dn-save').onclick = function (){
      var name = f.querySelector('.dn-name').value.trim(), msg = f.querySelector('.ufmsg');
      var short_name = f.querySelector('.dn-short').value.trim();
      var type = f.querySelector('.dn-type').value;
      var col = f.querySelector('.dn-color').value;
      if (!name){ msg.textContent = 'Donor name is required.'; return; }
      msg.textContent = 'Saving…';
      if (d){ d.name = name; d.short_name = short_name; d.type = type; d.color = col; applyDonorMutation(DB.persist('donor', [d])); }
      else { applyDonorMutation(DB.insert('donor', { name: name, short_name: short_name, type: type, color: col })); }
    };
    body.appendChild(f);
    $('#donorEditOverlay').classList.add('on');
    var fn = f.querySelector('.dn-name'); if (fn) fn.focus();
  }
  function closeDonorEdit(){ var o = $('#donorEditOverlay'); if (o) o.classList.remove('on'); }
  function deleteDonor(d){
    if (donorProjectCount(d.id)) return;   // guarded in the UI too
    Promise.resolve(DB.remove('donor', [d.id])).then(function (){ enrich(); renderTicker(); renderAll(); renderControl('donors'); });
  }

  // =========================================================================
  //  CONTROL PANEL - Beneficiary measures (editable lookup; Admin only)
  // =========================================================================
  function benTypes(){ return DB.tables.beneficiary_type.slice().sort(function (a, b){ return (a.seq || 0) - (b.seq || 0) || (a.name < b.name ? -1 : 1); }); }
  function benTypeName(id){ var t = DB._idx.benTypeById[id]; return t ? t.name : '(removed)'; }
  function benTotalFor(mid){ var t = 0; (DB._idx.benByMeasurement[mid] || []).forEach(function (b){ t += (+b.value || 0); }); return t; }
  function applyBenTypeMutation(p){
    return Promise.resolve(p).then(function (){ closeBenTypeEdit(); enrich(); renderTicker(); renderAll(); renderControl('beneficiaries'); });
  }
  function beneficiaryTypesEditor(){
    var box = el('div', 'cp-users');
    box.appendChild(el('div', 'cp-note', 'Beneficiary <b>measures / units</b> record who benefits from an activity (e.g. Men, Women, Children, Persons with Disabilities, Refugees, IDPs). Add, rename or delete them here - they populate the Beneficiaries tab of the activity form.'));
    var add = el('button', 'hbtn primary', '＋ Add measure'); add.onclick = function (){ openBenTypeEdit(null); };
    box.appendChild(add);
    var usage = {}; DB.tables.beneficiary.forEach(function (b){ usage[b.type_id] = (usage[b.type_id] || 0) + 1; });
    var tbl = el('table', 'utbl bttbl');
    tbl.innerHTML = '<thead><tr><th>Code</th><th>Measure / unit</th><th>Description</th><th>Entries</th><th></th></tr></thead>';
    var tb = el('tbody');
    var types = benTypes();
    if (!types.length) tb.innerHTML = '<tr><td colspan="5" class="re-empty">No beneficiary measures yet.</td></tr>';
    types.forEach(function (t){
      var tr = el('tr');
      tr.innerHTML = '<td class="bt-code-cell">' + (t.code ? '<span class="bt-code">' + esc(t.code) + '</span>' : '') + '</td>'
        + '<td class="bt-name-cell"><span class="udot" style="background:' + benColor(t.id) + '"></span>'
        + '<span class="bt-name-txt">' + esc(t.name) + '</span></td>'
        + '<td class="bt-desc-cell">' + (t.description ? esc(t.description) : '') + '</td>'
        + '<td class="umono">' + fmt(usage[t.id] || 0) + '</td>';
      var act = el('td', 'uact');
      var ed = el('button', 'cp-mini', 'Edit'); ed.onclick = function (){ openBenTypeEdit(t); };
      var del = el('button', 'cp-del', '🗑'); del.title = 'Delete measure';
      del.onclick = function (){ if (confirm('Delete "' + t.name + '"? Any beneficiary entries using it will also be removed.')) deleteBenType(t); };
      act.appendChild(ed); act.appendChild(del); tr.appendChild(act); tb.appendChild(tr);
    });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }
  function openBenTypeEdit(t){
    var body = $('#benTypeBody'); body.innerHTML = '';
    $('#benTypeTitle').textContent = t ? ('Edit measure · ' + t.name) : '＋ Add beneficiary measure';
    var f = el('div', 'uform');
    f.innerHTML =
      '<div class="ufgrid" style="grid-template-columns:1fr 2fr"><label><span>Code</span>' +
      '<input class="bt-code" type="text" maxlength="3" style="text-transform:uppercase" value="' + esc(t && t.code ? t.code : '') + '" placeholder="e.g. PWD"></label>' +
      '<label><span>Measure / unit name *</span>' +
      '<input class="bt-name" type="text" value="' + esc(t ? t.name : '') + '" placeholder="e.g. Women, Persons with Disabilities"></label></div>' +
      '<div class="ufgrid" style="grid-template-columns:1fr"><label><span>Description</span>' +
      '<textarea class="bt-desc-in" rows="2" placeholder="Short definition of who this measure counts">' + esc(t && t.description ? t.description : '') + '</textarea></label></div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn bt-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary bt-save" type="button">' + (t ? 'Save changes' : 'Add measure') + '</button></div>';
    f.querySelector('.bt-cancel').onclick = closeBenTypeEdit;
    // Code is a 3-character alphanumeric symbol: force uppercase and strip
    // anything else as the user types, capping the length at 3.
    var codeEl = f.querySelector('.bt-code');
    codeEl.oninput = function (){
      var cleaned = this.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      if (cleaned !== this.value) this.value = cleaned;
    };
    f.querySelector('.bt-save').onclick = function (){
      var name = f.querySelector('.bt-name').value.trim(), msg = f.querySelector('.ufmsg');
      var code = f.querySelector('.bt-code').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
      var description = f.querySelector('.bt-desc-in').value.trim();
      if (!name){ msg.textContent = 'Name is required.'; return; }
      if (code && code.length !== 3){ msg.textContent = 'Code must be exactly 3 letters or numbers.'; return; }
      msg.textContent = 'Saving…';
      if (t){ t.name = name; t.code = code; t.description = description; applyBenTypeMutation(DB.persist('beneficiary_type', [t])); }
      else {
        var seq = DB.tables.beneficiary_type.reduce(function (m, x){ return Math.max(m, x.seq || 0); }, 0) + 1;
        applyBenTypeMutation(DB.insert('beneficiary_type', { name: name, code: code, description: description, seq: seq }));
      }
    };
    body.appendChild(f);
    $('#benTypeOverlay').classList.add('on');
    var fn = f.querySelector('.bt-name'); if (fn) fn.focus();
  }
  function closeBenTypeEdit(){ var o = $('#benTypeOverlay'); if (o) o.classList.remove('on'); }
  function deleteBenType(t){
    var delIds = DB.tables.beneficiary.filter(function (b){ return b.type_id === t.id; }).map(function (b){ return b.id; });
    Promise.all([ DB.remove('beneficiary', delIds), DB.remove('beneficiary_type', [t.id]) ])
      .then(function (){ enrich(); renderTicker(); renderAll(); renderControl('beneficiaries'); });
  }

  // apply a DB mutation, then rebuild everything and refresh the editor
  function applyMutation(p){
    return Promise.resolve(p).then(function (){
      closeFwEdit(); enrich(); renderTicker(); renderAll(); renderResults('framework');
    });
  }
  // ---- Results Framework child popups (mirror the KPI Inventory edit dialog) --
  function openFwPopup(title, buildForm){
    var body = $('#fwEditBody'); body.innerHTML = '';
    $('#fwEditTitle').textContent = title;
    body.appendChild(buildForm());
    $('#fwEditOverlay').classList.add('on');
    var first = body.querySelector('input, select, textarea'); if (first) first.focus();
  }
  function closeFwEdit(){ var o = $('#fwEditOverlay'); if (o) o.classList.remove('on'); }
  function fwButtons(saveLabel){
    return '<div class="ufbtns"><span class="ufmsg"></span>' +
      '<button class="hbtn fw-cancel" type="button">Cancel</button>' +
      '<button class="hbtn primary fw-save" type="button">' + saveLabel + '</button></div>';
  }
  // Rename any Impact / Outcome / Output statement across every country instance.
  function openFwRename(labelText, level, stmt, pillar){
    openFwPopup('Edit ' + labelText, function (){
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>' + esc(labelText) + ' statement</span><input class="fw-stmt" type="text"></label>' +
        '</div>' + fwButtons('Save changes');
      f.querySelector('.fw-stmt').value = stmt;
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var v = f.querySelector('.fw-stmt').value.trim();
        if (!v){ f.querySelector('.ufmsg').textContent = 'Statement is required.'; return; }
        if (v === stmt){ closeFwEdit(); return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(renameResults(level, stmt, v, pillar));
      };
      return f;
    });
  }
  function openFwAddOutcome(pillar){
    openFwPopup('Add outcome', function (){
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>New outcome statement</span><input class="fw-ostmt" type="text" placeholder="What this outcome will achieve"></label>' +
        '</div>' + fwButtons('Add outcome');
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var stmt = f.querySelector('.fw-ostmt').value.trim();
        if (!stmt){ f.querySelector('.ufmsg').textContent = 'Outcome statement is required.'; return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(addOutcome(pillar, stmt));
      };
      return f;
    });
  }
  function openFwAddPillar(){
    openFwPopup('Add impact', function (){
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>Impact name</span><input class="fw-pname" type="text" placeholder="e.g. Foresight & Strategy"></label>' +
        '  <label><span>Impact statement / description</span><input class="fw-pimpact" type="text" placeholder="What long-term change this impact describes"></label>' +
        '</div>' + fwButtons('Add impact');
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var name = f.querySelector('.fw-pname').value.trim(), impact = f.querySelector('.fw-pimpact').value.trim();
        if (!name || !impact){ f.querySelector('.ufmsg').textContent = 'Impact name and statement are required.'; return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(addPillar(name, impact));
      };
      return f;
    });
  }
  // The Output code the next output added under this outcome will receive.
  function nextOutputCode(pillar, outcomeStmt){
    var oc = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'outcome' && x.statement === outcomeStmt && x.sdg === pillar; })[0];
    if (!oc) return '';
    var base = String(oc.code || '').replace(/^\s*[A-Za-z]+\s+/, '');   // 'Outcome 1.1' -> '1.1'
    var n = DB.tables.result.filter(function (x){ return x.level === 'output' && x.parent_id === oc.id; }).length;
    return 'Output ' + base + '.' + (n + 1);
  }
  // The parent outcome statement of an existing output (any country instance).
  function outcomeOfOutput(pillar, outStmt){
    var o = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'output' && x.statement === outStmt && x.sdg === pillar; })[0];
    var p = o && DB._idx.resultById[o.parent_id];
    return p ? p.statement : '';
  }
  // One dialog for BOTH adding and editing an Output. The Pillar / Outcome /
  // Output codes are shown read-only for context; only the Output statement is
  // editable. KPIs are added and re-parented separately in the KPI Inventory.
  //   mode 'add'  → outcomeStmt is the parent outcome; curStmt unused
  //   mode 'edit' → outcomeStmt is the parent outcome; curStmt is the output
  function openFwOutput(mode, pillar, outcomeStmt, curStmt){
    var isEdit = mode === 'edit';
    openFwPopup(isEdit ? 'Edit output' : 'Add output', function (){
      var pillarTxt = pillarLabel(pillar) + (pillar ? ' · ' + (PILLAR_NAMES[pillar] || '') : '');
      var ocCode = frameworkCode('outcome', outcomeStmt, pillar);
      var outcomeTxt = (ocCode ? ocCode + ' · ' : '') + outcomeStmt;
      var outCode = isEdit ? frameworkCode('output', curStmt, pillar) : (nextOutputCode(pillar, outcomeStmt) + ' (new)');
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>Impact</span><input type="text" value="' + esc(pillarTxt) + '" readonly></label>' +
        '  <label><span>Outcome</span><input type="text" value="' + esc(outcomeTxt) + '" readonly></label>' +
        '  <label><span>Output code</span><input type="text" value="' + esc(outCode) + '" readonly></label>' +
        '  <label><span>Output statement</span><input class="fw-stmt" type="text" placeholder="What this output delivers"></label>' +
        '</div>' + fwButtons(isEdit ? 'Save changes' : 'Add output');
      if (isEdit) f.querySelector('.fw-stmt').value = curStmt;
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var v = f.querySelector('.fw-stmt').value.trim();
        if (!v){ f.querySelector('.ufmsg').textContent = 'Output statement is required.'; return; }
        if (isEdit && v === curStmt){ closeFwEdit(); return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(isEdit ? renameResults('output', curStmt, v, pillar) : addOutput(pillar, outcomeStmt, v));
      };
      return f;
    });
  }

  // =========================================================================
  //  CONTROL PANEL - KPI Inventory (fine-tune KPI definitions; Admin only)
  // =========================================================================
  var FREQ_OPTS = ['annual','semi-annual','quarterly','monthly'];
  var METHOD_OPTS = ['Administrative records','Platform analytics','Survey','Self-reporting','Regional review','Independent assessment'];
  var UNIT_OPTS = ['count','%','index','ratio','score','days','USD'];
  var DISAGG_OPTS = ['none','region','region, agency','region, country','sex','age'];
  function applyKpiMutation(p){
    return Promise.resolve(p).then(function (){
      closeKpiEdit(); enrich(); renderTicker(); renderAll(); renderResults('kpis');
    });
  }
  // group indicator instances by KPI name (edits apply to every instance). Only
  // framework KPIs - secondary (project-local) KPIs are managed inside their project.
  function kpiGroups(){
    var byName = {};
    IND.forEach(function (r){
      if (r.secondary) return;
      var g = byName[r.name] = byName[r.name] || { name: r.name, rep: r.raw, sdg: r.sdg, level: 'output', insts: [] };
      g.insts.push(r);
    });
    return Object.keys(byName).sort().map(function (k){ return byName[k]; });
  }

  function kpiInventoryEditor(){
    var box = el('div', 'cp-kpis');
    box.appendChild(el('div', 'cp-note', 'Fine-tune KPI definitions - name, type, unit, direction, baseline/target, means & method of measurement, frequency, responsible and <b>parent Output</b>. Every KPI belongs to an Output; use <b>＋ Add KPI</b> to create one under an Output, or Edit to change it (applies to every country instance and re-derives status & roll-up).'));
    var addBtn = el('button', 'hbtn primary cp-adduser', '＋ Add KPI');
    addBtn.onclick = function (){ openKpiAdd(); };
    box.appendChild(addBtn);
    var groups = kpiGroups();
    var tbl = el('table', 'utbl kpitbl');
    tbl.innerHTML = '<thead><tr><th>Code</th><th>KPI</th><th>Impact</th><th>Unit</th><th>Target</th><th>Instances</th><th></th></tr></thead>';
    var tb = el('tbody');
    groups.forEach(function (g){ tb.appendChild(kpiRow(g)); });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }
  function kpiRow(g){
    var tr = el('tr');
    var col = g.sdg ? PILLAR_COLORS[g.sdg] : '#94a3b8';
    var u = g.rep.unit === '%' ? '%' : '';
    tr.innerHTML = '<td class="umono">' + esc(g.rep.code || '') + '</td>'
      + '<td><span class="udot" style="background:' + col + '"></span>' + esc(g.name) + '</td>'
      + '<td><span class="kpi-pill" style="background:' + shade(col, 0.74) + ';color:' + shade(col, -0.32) + '">' + esc(pillarLabel(g.sdg)) + '</span></td>'
      + '<td class="umono">' + esc(g.rep.unit || '') + '</td>'
      + '<td class="umono">' + fmtNum(g.rep.target_value) + u + '</td><td>' + g.insts.length + '</td>';
    var act = el('td', 'uact');
    var edit = el('button', 'cp-mini', 'Edit'); edit.onclick = function (){ openKpiEdit(g); };
    act.appendChild(edit); tr.appendChild(act);
    return tr;
  }
  // focused child popup over a dimmed backdrop
  function openKpiEdit(g){
    var body = $('#kpiEditBody'); body.innerHTML = '';
    $('#kpiEditTitle').textContent = 'Edit KPI · ' + (g.rep.code ? g.rep.code + ' · ' : '') + g.insts.length + ' country instance' + (g.insts.length === 1 ? '' : 's');
    body.appendChild(kpiForm(g));
    $('#kpiEditOverlay').classList.add('on');
    var fn = body.querySelector('.kf-name'); if (fn) fn.focus();
  }
  function closeKpiEdit(){ var o = $('#kpiEditOverlay'); if (o) o.classList.remove('on'); }
  // build <option>s; if the current value isn't in the list it is prepended so an
  // existing (custom) value is never silently dropped on save
  function optionList(opts, cur){
    var list = opts.slice();
    if (cur != null && cur !== '' && list.indexOf(cur) < 0) list = [cur].concat(list);
    return list.map(function (o){ return '<option value="' + esc(o) + '"' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('');
  }
  // Project Lead - chosen from the user list, never free-typed. Stored as the
  // user's display name (lead is a TEXT column); a legacy/unmatched value is kept
  // as an option so it stays visible and selected until reassigned.
  function leadOptions(cur){
    var seen = {}, names = [];
    DB.tables.user.filter(function (u){ return u.enabled; })
      .sort(function (a, b){ return a.name < b.name ? -1 : 1; })
      .forEach(function (u){ if (!seen[u.name]) { seen[u.name] = 1; names.push(u.name); } });
    if (cur && names.indexOf(cur) < 0) names = [cur].concat(names);
    return '<option value=""' + (cur ? '' : ' selected') + '>–</option>'
      + names.map(function (n){ return '<option value="' + esc(n) + '"' + (n === cur ? ' selected' : '') + '>' + esc(n) + '</option>'; }).join('');
  }
  // dropdown of EXISTING users (by id) for person references - users are never
  // created/renamed outside Users Management, only selected here
  function userOptions(curId, sections){
    var us = DB.tables.user.filter(function (u){ return sections.indexOf(userSection(u)) >= 0 && u.enabled; })
      .sort(function (a, b){ return a.name < b.name ? -1 : 1; });
    return '<option value=""' + (curId == null ? ' selected' : '') + '>–</option>'
      + us.map(function (u){ return '<option value="' + u.id + '"' + (u.id === curId ? ' selected' : '') + '>' + esc(u.name) + ' (' + STATUS_LABEL[userStatus(u)] + ')</option>'; }).join('');
  }
  // Every distinct result statement AT THE KPI'S OWN LEVEL, grouped by pillar via
  // <optgroup>, so a KPI can be re-parented to ANY sibling result (an output KPI
  // to any output, an outcome KPI to any outcome, etc.) - not just its own pillar.
  function parentResultOptions(level, curParent){
    var byPillar = {};
    DB.tables.result.forEach(function (x){ if (x.plan_id === S.plan && x.level === level) { var k = x.sdg == null ? 0 : x.sdg; (byPillar[k] = byPillar[k] || {})[x.statement] = 1; } });
    var pillars = Object.keys(byPillar).sort(function (a, b){ return (+a) - (+b); });
    var seen = false;
    var html = pillars.map(function (p){
      var label = (+p) ? (pillarLabel(+p) + ' · ' + (PILLAR_NAMES[+p] || '')) : 'Unaligned';
      var opts = Object.keys(byPillar[p]).sort().map(function (st){
        if (st === curParent) seen = true;
        return '<option value="' + esc(st) + '"' + (st === curParent ? ' selected' : '') + '>' + esc(st) + '</option>';
      }).join('');
      return '<optgroup label="' + esc(label) + '">' + opts + '</optgroup>';
    }).join('');
    // guarantee the current parent is present/selected even if data is odd
    if (!seen && curParent) html = '<option value="' + esc(curParent) + '" selected>' + esc(curParent) + '</option>' + html;
    return html;
  }
  function kpiForm(g){
    var ind = g.rep;
    var curParent = (DB._idx.resultById[ind.result_id] || {}).statement || '';
    var baseDate = ind.baseline_date || ((ind.baseline_year || 2025) + '-01-01');
    var tgtDate  = ind.target_date  || ((ind.target_year  || 2027) + '-12-31');
    var f = el('div', 'uform kpiuform');
    f.innerHTML =
      '<div class="uform-h">Edit KPI - applies to all ' + g.insts.length + ' instance' + (g.insts.length === 1 ? '' : 's') + '</div>' +
      '<div class="ufgrid kpigrid">' +
      '  <label class="kf-wide"><span>KPI name *</span><input class="kf-name" type="text" value="' + esc(ind.name) + '"></label>' +
      '  <label><span>Type</span><select class="kf-type"><option value="quantitative"' + (ind.type === 'quantitative' ? ' selected' : '') + '>Quantitative</option><option value="qualitative"' + (ind.type === 'qualitative' ? ' selected' : '') + '>Qualitative</option></select></label>' +
      '  <label><span>Unit</span><select class="kf-unit">' + optionList(UNIT_OPTS, ind.unit || 'count') + '</select></label>' +
      '  <label><span>Direction</span><select class="kf-dir"><option value="increase"' + (ind.direction === 'increase' ? ' selected' : '') + '>Higher is better</option><option value="decrease"' + (ind.direction === 'decrease' ? ' selected' : '') + '>Lower is better</option></select></label>' +
      '  <label><span>Baseline value</span><input class="kf-base" type="number" step="any" value="' + esc(ind.baseline_value) + '"></label>' +
      '  <label><span>Baseline date</span><input class="kf-basedate" type="date" value="' + esc(baseDate) + '"></label>' +
      '  <label><span>Target value</span><input class="kf-tgt" type="number" step="any" value="' + esc(ind.target_value) + '"></label>' +
      '  <label><span>Target date</span><input class="kf-tgtdate" type="date" value="' + esc(tgtDate) + '"></label>' +
      '  <label><span>Frequency</span><select class="kf-freq">' + optionList(FREQ_OPTS, ind.frequency) + '</select></label>' +
      '  <label><span>Collection method</span><select class="kf-method">' + optionList(METHOD_OPTS, ind.collection_method) + '</select></label>' +
      '  <label class="kf-wide"><span>Means of verification</span><input class="kf-mov" type="text" value="' + esc(ind.means_of_verification || '') + '"></label>' +
      '  <label><span>Responsible</span><select class="kf-resp">' + userOptions(ind.responsible_id, ['hq']) + '</select></label>' +
      '  <label><span>Disaggregation</span><select class="kf-disag">' + optionList(DISAGG_OPTS, ind.disaggregation || 'none') + '</select></label>' +
      '  <label class="kf-wide"><span>Parent Output *</span><select class="kf-parent">' + parentResultOptions('output', curParent) + '</select></label>' +
      '  <label><span>Code (auto)</span><input class="kf-code" type="text" value="' + esc(ind.code || '') + '" readonly title="System-generated from the parent Output - not editable. It updates automatically if the KPI is moved to another Output."></label>' +
      '</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn kf-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary kf-save" type="button">Save changes</button></div>';
    f.querySelector('.kf-cancel').onclick = function (){ closeKpiEdit(); };
    f.querySelector('.kf-save').onclick = function (){ saveKpiEdits(g, f, curParent); };
    return f;
  }
  function saveKpiEdits(g, f, curParent){
    var v = function (c){ return f.querySelector(c).value; };
    var newName = v('.kf-name').trim();
    if (!newName){ f.querySelector('.ufmsg').textContent = 'KPI name is required.'; return; }
    var newParent = v('.kf-parent');
    var num = function (x){ return x === '' || isNaN(+x) ? null : +x; };
    var changed = [];
    g.insts.forEach(function (r){
      var ind = r.raw;
      ind.name = newName; ind.type = v('.kf-type'); ind.unit = v('.kf-unit');
      ind.direction = v('.kf-dir');
      var b = num(v('.kf-base')); if (b != null) ind.baseline_value = b;
      var bd = v('.kf-basedate'); if (bd){ ind.baseline_date = bd; ind.baseline_year = +bd.slice(0,4); }
      var t = num(v('.kf-tgt')); if (t != null) ind.target_value = t;
      var td = v('.kf-tgtdate'); if (td){ ind.target_date = td; ind.target_year = +td.slice(0,4); }
      ind.frequency = v('.kf-freq'); ind.collection_method = v('.kf-method');
      ind.means_of_verification = v('.kf-mov').trim();
      ind.responsible_id = v('.kf-resp') ? +v('.kf-resp') : null;   // user reference by id
      ind.disaggregation = v('.kf-disag');
      // re-parent to ANY sibling result (same level): find the chosen statement's
      // result in this same programme (the KPI adopts its pillar via the chain).
      if (newParent && newParent !== curParent){
        var prog = r.programme && r.programme.id;
        var nr = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === g.level && x.statement === newParent && x.programme_id === prog; })[0];
        if (nr){ ind.result_id = nr.id; ind.code = DB._codeForIndicator(ind); }   // code follows the new parent Output
      }
      changed.push(ind);
    });
    if (newName !== g.name && S.selKpi.has(g.name)){ S.selKpi.delete(g.name); S.selKpi.add(newName); }
    f.querySelector('.ufmsg').textContent = 'Saving…';
    applyKpiMutation(DB.persist('indicator', changed));
  }

  // Add a brand-new KPI, assigned to a parent Output (created under every country
  // instance of that Output, so it behaves like the rest of the framework).
  function openKpiAdd(){
    var body = $('#kpiEditBody'); body.innerHTML = '';
    $('#kpiEditTitle').textContent = '＋ Add KPI';
    body.appendChild(kpiAddForm());
    $('#kpiEditOverlay').classList.add('on');
    var fn = body.querySelector('.kf-name'); if (fn) fn.focus();
  }
  function kpiAddForm(){
    var f = el('div', 'uform kpiuform');
    f.innerHTML =
      '<div class="uform-h">New KPI - added under the chosen Output across all its country instances</div>' +
      '<div class="ufgrid kpigrid">' +
      '  <label class="kf-wide"><span>KPI name *</span><input class="kf-name" type="text" placeholder="What this KPI measures"></label>' +
      '  <label><span>Type</span><select class="kf-type"><option value="quantitative" selected>Quantitative</option><option value="qualitative">Qualitative</option></select></label>' +
      '  <label><span>Unit</span><select class="kf-unit">' + optionList(UNIT_OPTS, 'count') + '</select></label>' +
      '  <label><span>Direction</span><select class="kf-dir"><option value="increase" selected>Higher is better</option><option value="decrease">Lower is better</option></select></label>' +
      '  <label><span>Baseline value</span><input class="kf-base" type="number" step="any" value="0"></label>' +
      '  <label><span>Baseline date</span><input class="kf-basedate" type="date" value="2025-01-01"></label>' +
      '  <label><span>Target value</span><input class="kf-tgt" type="number" step="any" placeholder="0"></label>' +
      '  <label><span>Target date</span><input class="kf-tgtdate" type="date" value="2027-12-31"></label>' +
      '  <label><span>Frequency</span><select class="kf-freq">' + optionList(FREQ_OPTS, 'quarterly') + '</select></label>' +
      '  <label><span>Collection method</span><select class="kf-method">' + optionList(METHOD_OPTS, 'Administrative records') + '</select></label>' +
      '  <label class="kf-wide"><span>Means of verification</span><input class="kf-mov" type="text" placeholder="Data source"></label>' +
      '  <label><span>Responsible</span><select class="kf-resp">' + userOptions(null, ['hq']) + '</select></label>' +
      '  <label><span>Disaggregation</span><select class="kf-disag">' + optionList(DISAGG_OPTS, 'none') + '</select></label>' +
      '  <label class="kf-wide"><span>Parent Output *</span><select class="kf-parent">' + parentResultOptions('output', '') + '</select></label>' +
      '</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn kf-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary kf-save" type="button">Add KPI</button></div>';
    f.querySelector('.kf-cancel').onclick = function (){ closeKpiEdit(); };
    f.querySelector('.kf-save').onclick = function (){ saveNewKpi(f); };
    return f;
  }
  function saveNewKpi(f){
    var v = function (c){ return f.querySelector(c).value; };
    var msg = f.querySelector('.ufmsg');
    var name = v('.kf-name').trim();
    if (!name){ msg.textContent = 'KPI name is required.'; return; }
    var outStmt = v('.kf-parent');
    if (!outStmt){ msg.textContent = 'Select a parent Output.'; return; }
    var outputs = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'output' && x.statement === outStmt; });
    if (!outputs.length){ msg.textContent = 'That Output no longer exists.'; return; }
    var num = function (x){ return x === '' || isNaN(+x) ? null : +x; };
    var bd = v('.kf-basedate'), td = v('.kf-tgtdate');
    var base = {
      secondary: 0, project_id: null,
      name: name, type: v('.kf-type'), unit: v('.kf-unit'), direction: v('.kf-dir'),
      baseline_value: num(v('.kf-base')) || 0, baseline_year: bd ? +bd.slice(0, 4) : 2025, baseline_date: bd || '2025-01-01',
      target_value: num(v('.kf-tgt')), target_year: td ? +td.slice(0, 4) : 2027, target_date: td || '2027-12-31',
      means_of_verification: v('.kf-mov').trim(), collection_method: v('.kf-method'),
      frequency: v('.kf-freq'), responsible_id: v('.kf-resp') ? +v('.kf-resp') : null, disaggregation: v('.kf-disag')
    };
    // one indicator per country instance of the chosen Output (code auto-generated)
    var rows = outputs.map(function (out){ var r = {}; for (var k in base) r[k] = base[k]; r.result_id = out.id; return r; });
    msg.textContent = 'Saving…';
    applyKpiMutation(DB.insert('indicator', rows));
  }

  // =========================================================================
  //  CONTROL PANEL - Users Management (Owner only)
  // =========================================================================
  function applyUserMutation(p){
    return Promise.resolve(p).then(function (){
      closeUserEdit(); enrich(); renderTicker(); renderAll(); renderControl('users');
    });
  }
  // focused child popup over a dimmed backdrop (mirrors the KPI edit dialog)
  function openUserEdit(u){
    var body = $('#userEditBody'); body.innerHTML = '';
    $('#userEditTitle').textContent = u ? ('Edit user · ' + u.name) : '＋ Add user';
    body.appendChild(userForm(u));
    $('#userEditOverlay').classList.add('on');
    var fn = body.querySelector('.uf-name'); if (fn) fn.focus();
  }
  function closeUserEdit(){ var o = $('#userEditOverlay'); if (o) o.classList.remove('on'); }
  function usernameTaken(name, exceptId){
    name = String(name||'').toLowerCase();
    return DB.tables.user.some(function (u){ return u.username.toLowerCase() === name && u.id !== exceptId; });
  }
  function userScopeText(u){
    if (userSection(u) === 'co') return (u.country_iso3 || '') + (u.region ? ' · ' + regionShort(u.region) : '');
    return 'Section';
  }

  function usersEditor(){
    var box = el('div', 'cp-users');
    box.appendChild(el('div', 'cp-note', 'Create users, set their Section and Status, reset passwords, and enable/disable access. Adding or editing a user opens a focused dialog. Status sets permissions - Admin: full control · User: log activities within scope · Viewer: read-only. Disabled users cannot log in. (Demo passwords are stored locally - not real security.)'));
    var addBtn = el('button', 'hbtn primary cp-adduser', '＋ Add user');
    addBtn.onclick = function (){ openUserEdit(null); };
    box.appendChild(addBtn);
    var tbl = el('table', 'utbl');
    tbl.innerHTML = '<thead><tr><th>Name</th><th>Username</th><th>Section</th><th>Status</th><th>Scope</th><th>Access</th><th></th></tr></thead>';
    var tb = el('tbody');
    var order = { admin:0, user:1, viewer:2 };
    DB.tables.user.slice().sort(function (a,b){
      return (order[userStatus(a)]-order[userStatus(b)]) || (userSection(a) < userSection(b) ? -1 : userSection(a) > userSection(b) ? 1 : (a.name < b.name ? -1 : 1));
    }).forEach(function (u){ tb.appendChild(userRow(u)); });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }

  function userRow(u){
    var tr = el('tr');
    var dot = '<span class="udot" style="background:' + userColor(u) + '"></span>';
    tr.innerHTML =
      '<td>' + dot + esc(u.name) + '</td>' +
      '<td class="umono">' + esc(u.username) + '</td>' +
      '<td>' + esc(SECTION_LABEL[userSection(u)] || '') + '</td>' +
      '<td><span class="ustatus ' + userStatus(u) + '">' + esc(STATUS_LABEL[userStatus(u)] || '') + '</span></td>' +
      '<td class="umono">' + esc(userScopeText(u)) + '</td>' +
      '<td><span class="ustat ' + (u.enabled ? 'on' : 'off') + '">' + (u.enabled ? 'Enabled' : 'Disabled') + '</span></td>';
    var act = el('td', 'uact');
    var edit = el('button', 'cp-mini', 'Edit'); edit.onclick = function (){ openUserEdit(u); };
    var self = CURRENT_USER && CURRENT_USER.id === u.id;
    var tog = el('button', 'cp-mini', u.enabled ? 'Disable' : 'Enable');
    tog.disabled = self && u.enabled;   // don't let admins lock themselves out
    tog.title = tog.disabled ? 'You cannot disable your own account' : '';
    tog.onclick = function (){ if (tog.disabled) return; u.enabled = u.enabled ? 0 : 1; applyUserMutation(DB.persist('user', [u])); };
    act.appendChild(edit); act.appendChild(tog); tr.appendChild(act);
    return tr;
  }

  function userForm(u){
    var isNew = !u;
    var f = el('div', 'uform');
    var regionOpts = REGION_ORDER.map(function (rg){ return '<option value="' + esc(rg) + '"' + (u && u.region === rg ? ' selected' : '') + '>' + esc(regionFull(rg)) + '</option>'; }).join('');
    f.innerHTML =
      '<div class="uform-h">' + (isNew ? '＋ Add user' : 'Edit user') + '</div>' +
      '<div class="ufgrid">' +
      '  <label><span>Full name *</span><input class="uf-name" type="text" value="' + esc(u ? u.name : '') + '"></label>' +
      '  <label><span>Username *</span><input class="uf-user" type="text" value="' + esc(u ? u.username : '') + '"></label>' +
      '  <label><span>' + (isNew ? 'Password *' : 'Reset password') + '</span><input class="uf-pass" type="text" placeholder="' + (isNew ? '' : 'leave blank to keep') + '" value=""></label>' +
      '  <label><span>Section *</span><select class="uf-section">' +
          [['hq', SECTION_LABEL.hq], ['co', SECTION_LABEL.co]].map(function (rl){ var cur = u ? userSection(u) : 'co'; return '<option value="' + rl[0] + '"' + (cur === rl[0] ? ' selected' : '') + '>' + rl[1] + '</option>'; }).join('') +
        '</select></label>' +
      '  <label><span>Status *</span><select class="uf-status">' +
          [['admin', STATUS_LABEL.admin], ['user', STATUS_LABEL.user], ['viewer', STATUS_LABEL.viewer]].map(function (rl){ var cur = u ? userStatus(u) : 'user'; return '<option value="' + rl[0] + '"' + (cur === rl[0] ? ' selected' : '') + '>' + rl[1] + '</option>'; }).join('') +
        '</select></label>' +
      '  <label class="uf-reg-wrap"><span>Region</span><select class="uf-region">' + regionOpts + '</select></label>' +
      '  <label class="uf-cty-wrap"><span>Country</span><select class="uf-country"></select></label>' +
      '  <label class="uf-en"><span>Access</span><select class="uf-enabled"><option value="1"' + ((!u || u.enabled) ? ' selected' : '') + '>Enabled</option><option value="0"' + (u && !u.enabled ? ' selected' : '') + '>Disabled</option></select></label>' +
      '</div>' +
      '<div class="cp-note uf-statusnote"></div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn uf-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary uf-save" type="button">' + (isNew ? 'Create user' : 'Save changes') + '</button></div>';

    var sectionSel = f.querySelector('.uf-section'), statusSel = f.querySelector('.uf-status');
    var regionSel = f.querySelector('.uf-region'), countrySel = f.querySelector('.uf-country');
    function fillCountries(){
      var rg = regionSel.value;
      countrySel.innerHTML = '<option value="">–</option>' + DB.tables.country
        .filter(function (c){ return c.region === rg; }).sort(function (a,b){ return a.name < b.name ? -1 : 1; })
        .map(function (c){ return '<option value="' + c.iso3 + '"' + (u && u.country_iso3 === c.iso3 ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('');
    }
    // Region/Country apply only to a Country Office section.
    function syncScope(){ var isCO = sectionSel.value === 'co'; f.querySelector('.uf-reg-wrap').style.display = isCO ? '' : 'none'; f.querySelector('.uf-cty-wrap').style.display = isCO ? '' : 'none'; }
    var STATUS_NOTE = {
      admin:'Admin - full control: manage users, edit the framework & KPIs, and log activities for any country.',
      user:'User - can log activities within scope (Section: all countries; Country Office: its own country). No user or framework administration.',
      viewer:'Viewer - read-only. Cannot log activities or edit anything.'
    };
    function syncStatusNote(){ f.querySelector('.uf-statusnote').textContent = STATUS_NOTE[statusSel.value] || ''; }
    regionSel.onchange = fillCountries; sectionSel.onchange = syncScope; statusSel.onchange = syncStatusNote;
    fillCountries(); syncScope(); syncStatusNote();

    f.querySelector('.uf-cancel').onclick = function (){ closeUserEdit(); };
    f.querySelector('.uf-save').onclick = function (){
      var name = f.querySelector('.uf-name').value.trim(), uname = f.querySelector('.uf-user').value.trim();
      var pass = f.querySelector('.uf-pass').value, section = sectionSel.value, status = statusSel.value;
      var msg = f.querySelector('.ufmsg');
      if (!name || !uname) { msg.textContent = 'Name and username are required.'; return; }
      if (usernameTaken(uname, u ? u.id : -1)) { msg.textContent = 'That username is already taken.'; return; }
      if (isNew && !pass) { msg.textContent = 'Set an initial password.'; return; }
      var region = section === 'co' ? regionSel.value : null;
      var iso = section === 'co' ? (countrySel.value || null) : null;
      var enabled = +f.querySelector('.uf-enabled').value;
      if (isNew) {
        applyUserMutation(DB.insert('user', { username: uname, name: name, password: pass, section: section, status: status,
          region: region, country_iso3: iso, enabled: enabled, created: new Date(TODAY).toISOString().slice(0,10) }));
      } else {
        u.name = name; u.username = uname; u.section = section; u.status = status; u.region = region; u.country_iso3 = iso; u.enabled = enabled;
        if (pass) u.password = pass;
        applyUserMutation(DB.persist('user', [u]));
      }
    };
    return f;
  }

  // =========================================================================
  //  PLANS - switch the active plan; create / edit / delete plans
  // =========================================================================
  /** Switch the whole app to another plan. Plan-specific selections (framework
   *  nodes, KPIs, projects) don't carry across plans, so they're cleared. */
  function setActivePlan(id){
    if (id == null || id === S.plan) return;
    if (!allPlans().some(function (p){ return p.id === id; })) return;
    S.plan = id;
    S.selNodes.clear(); S.selSdg.clear(); S.selKpi.clear(); S.selProject.clear();
    S.expandSdg.clear(); S.expandOutcome.clear(); S.expandImpact.clear();
    S.page = 0;
    enrich(); renderTicker(); renderAll(); renderPlanChip(); persist();
  }
  function nextPlanSeq(){ var m = 0; allPlans().forEach(function (p){ if ((p.seq || 0) > m) m = p.seq || 0; }); return m + 1; }
  function addPlan(name, desc, start, end){
    return DB.insert('plan', { name: name, description: desc || '', start_date: start || null, end_date: end || null, seq: nextPlanSeq(), is_default: 0 });
  }
  function editPlan(p, name, desc, start, end){
    p.name = name; p.description = desc || ''; p.start_date = start || null; p.end_date = end || null;
    return DB.persist('plan', [p]);
  }
  /** Make one plan the default (the plan the app opens on). Exactly one carries
   *  the flag; setting a default also switches the current view to it. */
  function setDefaultPlan(id){
    var changed = [];
    allPlans().forEach(function (p){
      var want = p.id === id ? 1 : 0;
      if ((p.is_default ? 1 : 0) !== want){ p.is_default = want; changed.push(p); }
    });
    return (changed.length ? DB.persist('plan', changed) : Promise.resolve());
  }
  /** Delete a plan and everything scoped to it (results, KPIs, projects, their
   *  activities and beneficiaries). Universal data is untouched. */
  function deletePlan(id){
    var resSet = {}; DB.tables.result.forEach(function (r){ if (r.plan_id === id) resSet[r.id] = 1; });
    var projSet = {}; DB.tables.project.forEach(function (p){ if (p.plan_id === id) projSet[p.id] = 1; });
    var indSet = {};
    DB.tables.indicator.forEach(function (i){
      if ((i.result_id != null && resSet[i.result_id]) || (i.project_id != null && projSet[i.project_id])) indSet[i.id] = 1;
    });
    var measSet = {};
    DB.tables.measurement.forEach(function (m){
      if (indSet[m.indicator_id] || (m.project_id != null && projSet[m.project_id])) measSet[m.id] = 1;
    });
    var benIds = DB.tables.beneficiary.filter(function (b){ return measSet[b.measurement_id]; }).map(function (b){ return b.id; });
    var pkIds = DB.tables.project_kpi.filter(function (pk){ return projSet[pk.project_id] || indSet[pk.indicator_id]; }).map(function (pk){ return pk.id; });
    var keys = function (o){ return Object.keys(o).map(Number); };
    return Promise.all([
      DB.remove('beneficiary', benIds),
      DB.remove('measurement', keys(measSet)),
      DB.remove('project_kpi', pkIds),
      DB.remove('indicator', keys(indSet)),
      DB.remove('project', keys(projSet)),
      DB.remove('result', keys(resSet)),
      DB.remove('plan', [id])
    ]);
  }

  // rename every result row (across country instances) matching level+statement(+pillar)
  // WITHIN THE ACTIVE PLAN - a statement/pillar pair can recur in another plan.
  function renameResults(level, oldStmt, newStmt, pillar){
    var changed = [];
    DB.tables.result.forEach(function (x){
      if (x.plan_id === S.plan && x.level === level && x.statement === oldStmt && (pillar == null || x.sdg === pillar)) { x.statement = newStmt; changed.push(x); }
    });
    return changed.length ? DB.persist('result', changed) : Promise.resolve();
  }

  // add a new output under every instance of the parent outcome (active plan).
  // KPIs are NOT created here - they are added and attached in the KPI Inventory.
  function addOutput(pillar, outcomeStmt, outStmt){
    var outcomes = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'outcome' && x.statement === outcomeStmt && x.sdg === pillar; });
    if (!outcomes.length) return Promise.resolve();
    var newOuts = outcomes.map(function (oc){
      // `code` is system-generated in DB.insert (Output #.#.#) - never set here.
      return { plan_id: oc.plan_id, programme_id: oc.programme_id, parent_id: oc.id, level: 'output',
        statement: outStmt, sdg: pillar, owner_id: null, assumptions: 'Delivery timelines are met; country offices and partners participate.',
        risks: '', risk_level: 'medium' };
    });
    return DB.insert('result', newOuts);
  }

  // add a brand-new Pillar (impact) - adopted across every country, in the active plan
  function nextPillarId(){
    var mx = 0;
    DB.tables.result.forEach(function (r){ if (r.plan_id === S.plan && r.sdg != null && r.sdg > mx) mx = r.sdg; });
    return mx + 1;
  }
  function addPillar(name, impactStmt){
    var id = nextPillarId();
    var color = NEW_PILLAR_PALETTE[(id - 1) % NEW_PILLAR_PALETTE.length];
    PILLAR_NAMES[id] = name; PILLAR_COLORS[id] = color;
    var rows = DB.tables.programme.map(function (p){
      // `code` is system-generated in DB.insert (Impact #) - never set here.
      return { plan_id: S.plan, programme_id: p.id, parent_id: null, level: 'impact',
        statement: impactStmt, sdg: id, pillar_name: name, pillar_color: color,
        assumptions: '', risks: '', risk_level: 'low' };
    });
    return DB.insert('result', rows);
  }
  // add a new Outcome under every country instance of the pillar's impact (active plan)
  function addOutcome(pillar, outcomeStmt){
    var impacts = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'impact' && x.sdg === pillar; });
    if (!impacts.length) return Promise.resolve();
    var rows = impacts.map(function (im){
      // `code` is system-generated in DB.insert (Outcome #.#) - never set here.
      return { plan_id: im.plan_id, programme_id: im.programme_id, parent_id: im.id, level: 'outcome',
        statement: outcomeStmt, sdg: pillar, assumptions: '', risks: '', risk_level: 'low' };
    });
    return DB.insert('result', rows);
  }

  // delete an output everywhere: its result rows + its KPIs + those KPIs' activities
  // (measurements). Also sweeps any legacy 'activity' result rows parented to the
  // output (older data models put activities in the results chain; they no longer
  // are - an Activity is a measurement in the Donor → Project delivery chain).
  function deleteOutput(pillar, outStmt){
    var outs = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'output' && x.statement === outStmt && x.sdg === pillar; });
    var outIds = outs.map(function (o){ return o.id; });
    var inChild = function (pid){ return outIds.indexOf(pid) >= 0; };
    var acts = DB.tables.result.filter(function (x){ return x.level === 'activity' && inChild(x.parent_id); });
    var resIds = outIds.concat(acts.map(function (a){ return a.id; }));
    var inds = DB.tables.indicator.filter(function (i){ return inChild(i.result_id); });
    var indIds = inds.map(function (i){ return i.id; });
    var indSet = {}; indIds.forEach(function (i){ indSet[i] = 1; });
    var measIds = DB.tables.measurement.filter(function (m){ return indSet[m.indicator_id]; }).map(function (m){ return m.id; });
    return Promise.all([
      DB.remove('measurement', measIds),
      DB.remove('indicator', indIds),
      DB.remove('result', resIds)
    ]);
  }

  // =========================================================================
  //  PLANS - header chip + dropdown (switch active plan · set default · edit ·
  //  delete · new). This dropdown is the single home for plan management.
  // =========================================================================
  function planPeriod(p){ return (p && (p.start_date || p.end_date)) ? ((p.start_date || '?') + ' → ' + (p.end_date || '?')) : ''; }
  /** A plan's lifecycle relative to TODAY: Completed / Current / Upcoming. */
  function planPhase(p){
    if (!p) return '';
    var t = TODAY.getTime();
    var s = p.start_date ? Date.parse(p.start_date) : null, e = p.end_date ? Date.parse(p.end_date) : null;
    if (e != null && t > e) return 'Completed';
    if (s != null && t < s) return 'Upcoming';
    return 'Current';
  }
  function refreshAfterPlan(){
    enrich(); renderTicker(); renderAll(); renderPlanChip();
    if (!$('#planMenu').hidden) renderPlanMenu();
  }

  // ---- Header chip: one line, the active plan's title ----------------------
  function renderPlanChip(){
    var nm = $('#planChipName'); if (!nm) return;
    var ap = activePlan();
    nm.textContent = ap ? ap.name : 'No plan';
    var chip = $('#planChip');
    if (chip) chip.title = ap ? (ap.name + (planPeriod(ap) ? '  ·  ' + planPeriod(ap) : '') + ' - click to switch or manage plans') : 'No plan';
  }
  function closePlanMenu(){ var m = $('#planMenu'); if (m){ m.hidden = true; m.innerHTML = ''; } var c = $('#planChip'); if (c) c.setAttribute('aria-expanded', 'false'); }
  function togglePlanMenu(){
    var m = $('#planMenu'); if (!m) return;
    if (!m.hidden){ closePlanMenu(); return; }
    m.hidden = false;
    var c = $('#planChip'); if (c) c.setAttribute('aria-expanded', 'true');
    renderPlanMenu();
  }
  /** Fill the dropdown: every plan (newest → oldest) with a ★ default toggle,
   *  a click-to-switch title, and (Admin) edit / delete; a ＋ New plan footer. */
  function renderPlanMenu(){
    var m = $('#planMenu'); if (!m || m.hidden) return;
    m.innerHTML = '';
    var admin = canEditFramework();
    var plans = plansNewestFirst();
    plans.forEach(function (p){
      var isActive = p.id === S.plan, isDef = !!p.is_default;
      var row = el('div', 'plan-mi' + (isActive ? ' on' : ''));
      // default (✓) - the check marks the default plan; Admin can click to set it
      if (admin){
        var def = el('button', 'plan-mi-def' + (isDef ? ' on' : ''), '✓');
        def.title = isDef ? 'Default plan (opens on load)' : 'Set as default';
        def.onclick = function (e){ e.stopPropagation(); if (!isDef) Promise.resolve(setDefaultPlan(p.id)).then(function (){ renderPlanMenu(); }); };
        row.appendChild(def);
      } else {
        row.appendChild(el('span', 'plan-mi-def' + (isDef ? ' on' : ' ghost'), '✓'));
      }
      // title + period/phase - click switches the active plan AND (Admin) makes
      // it the default, so the checked plan is also the one loaded next visit
      var main = el('button', 'plan-mi-main');
      main.appendChild(el('span', 'plan-mi-nm', p.name));
      main.appendChild(el('span', 'plan-mi-sub', planPeriod(p) + (planPhase(p) ? '  ·  ' + planPhase(p) : '')));
      main.onclick = function (){
        setActivePlan(p.id);                    // switch view immediately
        if (admin && !isDef) setDefaultPlan(p.id); // and make it default for next visits
        renderPlanMenu();                       // re-render so the check moves onto it
      };
      row.appendChild(main);
      if (admin){
        var edit = el('button', 'plan-mi-act', '✎'); edit.title = 'Edit plan name & dates';
        edit.onclick = function (e){ e.stopPropagation(); closePlanMenu(); openPlanEdit(p); };
        row.appendChild(edit);
        var del = el('button', 'plan-mi-act plan-mi-del', '🗑'); del.title = 'Delete plan and all its data';
        if (plans.length <= 1) del.disabled = true;
        del.onclick = function (e){ e.stopPropagation(); deletePlanFlow(p); };
        row.appendChild(del);
      }
      m.appendChild(row);
    });
    if (admin){
      var foot = el('button', 'plan-mi plan-mi-foot', '＋  New plan');
      foot.onclick = function (){ closePlanMenu(); openPlanEdit(null); };
      m.appendChild(foot);
    }
  }
  function deletePlanFlow(pl){
    var plans = allPlans();
    if (plans.length <= 1){ alert('At least one plan must remain.'); return; }
    if (!confirm('Delete "' + pl.name + '" and ALL its impacts, KPIs, projects and activities? This cannot be undone.')) return;
    var wasActive = pl.id === S.plan;
    var fallback = plansNewestFirst().filter(function (p){ return p.id !== pl.id; })[0];
    Promise.resolve(deletePlan(pl.id)).then(function (){
      if (wasActive){
        S.plan = fallback ? fallback.id : null;
        S.selNodes.clear(); S.selSdg.clear(); S.selKpi.clear(); S.selProject.clear();
      }
      // if the deleted plan was the default, promote the fallback
      if (fallback && !allPlans().some(function (p){ return p.is_default; })){
        Promise.resolve(setDefaultPlan(fallback.id)).then(function (){ resolvePlan(); refreshAfterPlan(); persist(); });
      } else { resolvePlan(); refreshAfterPlan(); persist(); }
    });
  }
  // Create / edit a plan - name, start/end dates, description (a focused popup).
  // A new plan starts empty; build its Impacts / Outcomes / Outputs in Control
  // Panel → Results Framework once it is the active plan.
  function openPlanEdit(plan){
    var isEdit = !!plan;
    openFwPopup(isEdit ? 'Edit plan' : '＋ New plan', function (){
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>Plan name *</span><input class="pl-name" type="text" placeholder="e.g. Development Plan (2026-2030)"></label>' +
        '</div>' +
        '<div class="ufgrid" style="grid-template-columns:1fr 1fr">' +
        '  <label><span>Start date</span><input class="pl-start" type="date"></label>' +
        '  <label><span>End date</span><input class="pl-end" type="date"></label>' +
        '</div>' +
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>Description</span><textarea class="pl-desc" rows="3" placeholder="What this plan covers"></textarea></label>' +
        '</div>' + fwButtons(isEdit ? 'Save changes' : 'Create plan');
      if (isEdit){
        f.querySelector('.pl-name').value = plan.name || '';
        f.querySelector('.pl-start').value = plan.start_date || '';
        f.querySelector('.pl-end').value = plan.end_date || '';
        f.querySelector('.pl-desc').value = plan.description || '';
      }
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var name = f.querySelector('.pl-name').value.trim();
        var start = f.querySelector('.pl-start').value || null;
        var end = f.querySelector('.pl-end').value || null;
        var desc = f.querySelector('.pl-desc').value.trim();
        var msg = f.querySelector('.ufmsg');
        if (!name){ msg.textContent = 'Plan name is required.'; return; }
        if (start && end && end < start){ msg.textContent = 'End date must be on or after the start date.'; return; }
        msg.textContent = 'Saving…';
        if (isEdit){
          Promise.resolve(editPlan(plan, name, desc, start, end)).then(function (){
            closeFwEdit(); refreshAfterPlan(); persist();
          });
        } else {
          Promise.resolve(addPlan(name, desc, start, end)).then(function (rows){
            var np = Array.isArray(rows) ? rows[0] : rows;
            closeFwEdit();
            S.plan = np ? np.id : S.plan;   // land on the new (empty) plan
            S.selNodes.clear(); S.selSdg.clear(); S.selKpi.clear(); S.selProject.clear();
            resolvePlan(); refreshAfterPlan(); persist();
          });
        }
      };
      return f;
    });
  }

  function frameworkEditor(){
    var ro = !canEditFramework();
    var box = el('div', 'cp-fw' + (ro ? ' ro' : ''));
    // Which plan is being edited (read-only banner; switch/manage plans via the
    // header chip and 🗂 Plan Management).
    var ap = activePlan();
    var banner = el('div', 'cp-fwplan');
    banner.appendChild(el('span', 'cp-fwplan-lbl', 'Plan'));
    banner.appendChild(el('span', 'cp-fwplan-nm', ap ? ap.name : '–'));
    if (ap && planPeriod(ap)) banner.appendChild(el('span', 'cp-fwplan-dates', planPeriod(ap)));
    box.appendChild(banner);
    box.appendChild(el('div', 'cp-note', ro
      ? 'Read-only view of this plan’s Results Framework. Editing is limited to Admin status.'
      : 'This is the Results Framework of the plan shown above (switch or manage plans from 🗂 Plan Management in the header). Use the Edit buttons to rename a statement and the ＋ controls to add Impacts, Outcomes and Outputs. Every change propagates across all country instances of this plan and is saved locally.'));

    if (!FRAMEWORK.length){
      box.appendChild(el('div', 'cp-empty', 'This plan has no impacts yet. Use ＋ Add impact below to start building its results framework.'));
    }
    FRAMEWORK.forEach(function (sg){
      var pill = el('div', 'cp-pillar');
      var hd = el('div', 'cp-ph');
      var dot = el('span', 'cp-dot'); dot.style.background = sg.sdg ? PILLAR_COLORS[sg.sdg] : '#94a3b8'; hd.appendChild(dot);
      hd.appendChild(el('span', 'cp-pt', pillarLabel(sg.sdg) + ' · ' + (sg.sdg ? (PILLAR_NAMES[sg.sdg] || '') : '')));
      pill.appendChild(hd);
      pill.appendChild(stmtRow('Impact', 'impact', sg.impact, sg.sdg));
      sg.outcomes.forEach(function (oc){
        pill.appendChild(stmtRow('Outcome', 'outcome', oc.stmt, sg.sdg));
        var outWrap = el('div', 'cp-outs');
        oc.outputs.forEach(function (op){ outWrap.appendChild(outputRow(sg.sdg, op)); });
        if (!ro) outWrap.appendChild(addOutputRow(sg.sdg, oc.stmt));
        pill.appendChild(outWrap);
      });
      if (!ro) pill.appendChild(addOutcomeRow(sg.sdg));
      box.appendChild(pill);
    });
    if (!ro) box.appendChild(addPillarRow());
    return box;
  }

  function addOutcomeRow(pillar){
    var wrap = el('div', 'cp-addwrap cp-add-outcome');
    var btn = el('button', 'cp-addbtn', '＋ Add outcome');
    btn.onclick = function (){ openFwAddOutcome(pillar); };
    wrap.appendChild(btn);
    return wrap;
  }

  function addPillarRow(){
    var wrap = el('div', 'cp-addwrap cp-add-pillar');
    var btn = el('button', 'cp-addbtn cp-addpillar', '＋ Add impact');
    btn.onclick = function (){ openFwAddPillar(); };
    wrap.appendChild(btn);
    return wrap;
  }

  // The system-generated code of a framework node (any country instance carries the
  // same code), used to prefix statements in the framework tree.
  function frameworkCode(level, stmt, pillar){
    var m = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === level && x.statement === stmt && x.sdg === pillar; })[0];
    return m ? (m.code || '') : '';
  }
  // Read-only statement row + an Edit button that opens the rename child popup –
  // no editing happens on the framework screen itself.
  function stmtRow(labelText, level, stmt, pillar){
    var row = el('div', 'cp-row cp-' + level);
    row.appendChild(el('span', 'cp-lab', labelText));
    var code = frameworkCode(level, stmt, pillar);
    var txt = el('span', 'cp-stmt', (code ? code + ' · ' : '') + stmt); txt.title = stmt; row.appendChild(txt);
    if (canEditFramework()){
      var edit = el('button', 'cp-mini', 'Edit');
      edit.onclick = function (){ openFwRename(labelText, level, stmt, pillar); };
      row.appendChild(edit);
    }
    return row;
  }

  function outputRow(pillar, op){
    var row = el('div', 'cp-row cp-output');
    row.appendChild(el('span', 'cp-lab', 'Output'));
    var code = frameworkCode('output', op, pillar);
    var txt = el('span', 'cp-stmt', (code ? code + ' · ' : '') + op); txt.title = op; row.appendChild(txt);
    if (canEditFramework()){
      var edit = el('button', 'cp-mini', 'Edit');
      edit.onclick = function (){ openFwOutput('edit', pillar, outcomeOfOutput(pillar, op), op); };
      row.appendChild(edit);
      var del = el('button', 'cp-del', '🗑'); del.title = 'Delete output across all countries';
      del.onclick = function (){ if (confirm('Delete this output and its indicators & measurements across all countries?')) applyMutation(deleteOutput(pillar, op)); };
      row.appendChild(del);
    }
    return row;
  }

  function addOutputRow(pillar, outcomeStmt){
    var wrap = el('div', 'cp-addwrap');
    var btn = el('button', 'cp-addbtn', '＋ Add output');
    btn.onclick = function (){ openFwOutput('add', pillar, outcomeStmt); };
    wrap.appendChild(btn);
    return wrap;
  }

  // =========================================================================
  //  INSIGHTS - configurable stacked-bar dashboard
  // =========================================================================
  var CATPAL = ['#2563eb','#0891b2','#7c3aed','#db2777','#ea580c','#16a34a','#ca8a04',
    '#0d9488','#9333ea','#dc2626','#4f46e5','#65a30d','#e11d48','#0ea5e9','#f59e0b','#14b8a6'];
  function catColor(key){ var h = 0, s = String(key); for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return CATPAL[h % CATPAL.length]; }
  // Canonical beneficiary-type colour identity - stable per measure name, reused
  // everywhere a beneficiary type appears (filter facet, activity table, Control
  // Panel editor) so a given measure reads as the same colour across the app.
  function benColor(id){ return catColor(benTypeName(id)); }
  // Latest-update month of a KPI as "MM-YYYY" (chronological sort via mmKey).
  function mmYYYY(d){ var dt = new Date(d); if (isNaN(dt)) return null; var m = dt.getMonth() + 1; return (m < 10 ? '0' + m : m) + '-' + dt.getFullYear(); }
  function mmKey(s){ var p = String(s).split('-'); return (+p[1]) * 100 + (+p[0]); }   // "MM-YYYY" -> YYYYMM
  // ---- Budget levels (insights dimension) ---------------------------------
  // A KPI's budget is its primary project's funding. We quartile the DISTINCT
  // project budgets within the CURRENT insights row set (mirroring the map's
  // "by Budget" banding) so the four levels stay balanced whatever the scale,
  // and reuse BUDGET_RAMP so a level reads as the same green as the map legend.
  var _insBudgetCut = null;   // [q25, q50, q75] over the current insights rows
  function insBudgetVal(r){ var p = r.projPrimary; return p && p.budget_usd != null ? +p.budget_usd : null; }
  function computeInsBudgetBands(rows){
    var seen = {}, vals = [];
    rows.forEach(function (r){ var p = r.projPrimary; if (p && p.budget_usd != null && !seen[p.id]) { seen[p.id] = 1; vals.push(+p.budget_usd); } });
    vals.sort(function (a, b){ return a - b; });
    if (!vals.length) { _insBudgetCut = [0, 0, 0]; return; }
    function q(p){ return vals[Math.min(vals.length - 1, Math.floor(vals.length * p))]; }
    _insBudgetCut = [q(0.25), q(0.5), q(0.75)];
  }
  function insBudgetBand(v){ var c = _insBudgetCut || [0, 0, 0]; v = v || 0; return v < c[0] ? 0 : v < c[1] ? 1 : v < c[2] ? 2 : 3; }
  function insBudgetLevel(i){ var c = _insBudgetCut || [0, 0, 0];
    if (i === 0) return '< $' + fmtCompact(c[0]);
    if (i === 1) return '$' + fmtCompact(c[0]) + ' – $' + fmtCompact(c[1]);
    if (i === 2) return '$' + fmtCompact(c[1]) + ' – $' + fmtCompact(c[2]);
    return '≥ $' + fmtCompact(c[2]);
  }
  function insBudgetIdx(k){ for (var i = 0; i < 4; i++) if (insBudgetLevel(i) === k) return i; return 99; }
  var DIMS = {
    sdg:       { label:'Impact',       val:function(r){ return r.sdg ? pillarLabel(r.sdg) : null; }, color:function(k){ return PILLAR_COLORS[+String(k).replace('Impact ','')] || '#999'; } },
    region:    { label:'Region',       val:function(r){ return r.region || null; }, color:function(k){ return regionColor(k); } },
    country:   { label:'Country',      val:function(r){ return r.iso ? (DB._idx.countryByIso[r.iso]||{}).name : null; }, color:function(k){ var c=DB.tables.country.filter(function(x){return x.name===k;})[0]; return c?countryColor(c.iso3):catColor(k); } },
    donor:     { label:'Donor',        val:function(r){ return r.donorPrimary ? r.donorPrimary.name : null; },
                 color:function(k){ var d=DB.tables.donor.filter(function(x){return x.name===k;})[0]; return d && d.color ? d.color : catColor(k); } },
    project:   { label:'Project',      val:function(r){ return r.projPrimary ? (r.projPrimary.code || r.projPrimary.name) : null; }, color:catColor },
    budget:    { label:'Budget',       val:function(r){ var v = insBudgetVal(r); return v == null ? null : insBudgetLevel(insBudgetBand(v)); },
                 color:function(k){ var i = insBudgetIdx(k); return i < 4 ? BUDGET_RAMP[i] : catColor(k); },
                 ord:true, cmp:function(a,b){ return insBudgetIdx(a) - insBudgetIdx(b); } },
    programme: { label:'Programme',    val:function(r){ return r.programme ? r.programme.short_name : null; }, color:catColor },
    kpi:       { label:'KPI',          val:function(r){ return r.name || null; }, color:catColor },
    user:      { label:'User',         val:function(r){ return r.latest && r.latest.reported_by_id != null ? userName(+r.latest.reported_by_id) : null; },
                 color:function(k){ var u = DB.tables.user.filter(function(x){ return x.name === k; })[0]; return u ? userColor(u) : catColor(k); } },
    date:      { label:'Date',         val:function(r){ return r.updated ? mmYYYY(r.updated) : null; }, color:catColor,
                 chrono:true, cmp:function(a,b){ return mmKey(a) - mmKey(b); } },
    type:      { label:'KPI type',     val:function(r){ return r.type ? cap(r.type) : null; }, color:function(k){ return k === 'Qualitative' ? '#9D7BEE' : '#4FA9E8'; } },
    status:    { label:'Status',       val:function(r){ return STATUS[r.status].label; }, color:function(k){ for (var s in STATUS) if (STATUS[s].label === k) return STATUS[s].c; return '#999'; } }
  };
  var DIM_LIST = ['sdg','region','country','donor','project','budget','programme','kpi','user','date','status'];
  var TOPN = [5,10,15,20,25,50,9999];
  function firstOtherDim(v){ for (var i = 0; i < DIM_LIST.length; i++) if (DIM_LIST[i] !== v) return DIM_LIST[i]; }
  function niceMax(v){ if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }

  function renderInsights() {
    var host = $('#insightsView'); host.innerHTML = '';
    host.appendChild(insightsControls());
    var chart = el('div', 'ins-chart'); chart.id = 'insChart'; host.appendChild(chart);
    var legend = el('div', 'ins-legend'); legend.id = 'insLegend'; host.appendChild(legend);
    drawInsightsChart();
  }

  function insightsControls() {
    var bar = el('div', 'ins-ctrl');
    bar.appendChild(el('span', 'ax', 'X'));
    bar.appendChild(dimSelect(S.insX, function (v) { if (v === S.insY) S.insY = firstOtherDim(v); S.insX = v; renderInsights(); persist(); }));
    bar.appendChild(topSelect(S.insTopX, function (v) { S.insTopX = v; drawInsightsChart(); persist(); }));
    var swap = el('button', 'swap', '⇄'); swap.title = 'Swap X and series';
    swap.onclick = function () { var a = S.insX; S.insX = S.insY; S.insY = a; var t = S.insTopX; S.insTopX = S.insTopY; S.insTopY = t; renderInsights(); persist(); };
    bar.appendChild(swap);
    bar.appendChild(el('span', 'ax', 'Series'));
    bar.appendChild(dimSelect(S.insY, function (v) { if (v === S.insX) S.insX = firstOtherDim(v); S.insY = v; renderInsights(); persist(); }));
    bar.appendChild(topSelect(S.insTopY, function (v) { S.insTopY = v; renderInsights(); persist(); }));
    // Value is not a control: the chart measures whatever the count toggle says
    // (Projects or Activities). See drawInsightsChart / S.countBasis.
    var modes = el('span', 'ins-modes');
    [['bar','Bar'],['pct','% Bar'],['line','Line'],['area','Area']].forEach(function (m) {
      var b = el('button', S.insMode === m[0] ? 'on' : null, m[1]);
      b.onclick = function () { S.insMode = m[0]; renderInsights(); persist(); }; modes.appendChild(b);
    });
    bar.appendChild(modes);
    return bar;
  }
  function dimSelect(cur, cb){
    var s = el('select');
    DIM_LIST.forEach(function (k) { var o = el('option', null, DIMS[k].label); o.value = k; if (k === cur) o.selected = true; s.appendChild(o); });
    s.onchange = function () { cb(s.value); }; return s;
  }
  function topSelect(cur, cb){
    var s = el('select');
    TOPN.forEach(function (n) { var o = el('option', null, n === 9999 ? 'All' : ('Top ' + n)); o.value = n; if (n === cur) o.selected = true; s.appendChild(o); });
    s.onchange = function () { cb(+s.value); }; return s;
  }
  function drawInsightsChart() {
    var chart = $('#insChart'), legendEl = $('#insLegend');
    if (!chart) return;
    chart.innerHTML = ''; legendEl.innerHTML = '';
    var rows = filtered(), xd = DIMS[S.insX], yd = DIMS[S.insY];
    if (S.insX === 'budget' || S.insY === 'budget') computeInsBudgetBands(rows);   // quartile the current set into levels
    // The measure is driven entirely by the count toggle: Projects (distinct projects
    // per cell) or Activities (measurement count). There is no Value control.
    var measureProj = S.countBasis === 'projects';
    var xIsDate = S.insX === 'date', yIsDate = S.insY === 'date', temporal = xIsDate || yIsDate;
    // cell[x][y] = { sum, pset }: Activities accumulate into sum, Projects into a
    // project-id set (pset). xCnt/yCnt are point counts for Top-N ordering.
    var cell = {}, xCnt = {}, yCnt = {};
    function cellAt(xk, yk) {
      xCnt[xk] = (xCnt[xk] || 0) + 1; yCnt[yk] = (yCnt[yk] || 0) + 1;
      return ((cell[xk] = cell[xk] || {})[yk] = cell[xk][yk] || { sum: 0, pset: null });
    }
    // Projects union project ids (distinct per cell); Activities sum a measurement weight.
    function addPoint(xk, yk, o) {
      if (xk == null || yk == null) return;
      if (measureProj) { if (!o.pids || !o.pids.length) return; var cp = cellAt(xk, yk); cp.pset = cp.pset || {}; o.pids.forEach(function (id) { if (id != null) cp.pset[id] = 1; }); return; }
      var w = o.weight || 0; if (w <= 0) return; cellAt(xk, yk).sum += w;   // Activities
    }
    rows.forEach(function (r) {
      if (temporal) {
        // one data point per MEASUREMENT, so every reported month appears (not just the KPI's latest).
        var catDim = xIsDate ? yd : xd, cat = catDim.val(r);
        if (cat == null) return;
        (r.series || []).forEach(function (m) {
          var mo = mmYYYY(m.date); if (mo == null) return;
          var o = measureProj ? { pids: m.project_id != null ? [m.project_id] : [] } : { weight: 1 };   // one measurement per point
          if (xIsDate) addPoint(mo, cat, o); else addPoint(cat, mo, o);
        });
      } else {
        var o = measureProj ? { pids: r.projectIds }
              : { weight: (r.series || []).reduce(function (s, m) { return s + (measInTimeRange(m) ? 1 : 0); }, 0) };   // Activities in range
        addPoint(xd.val(r), yd.val(r), o);
      }
    });
    var xs;
    if (xd.chrono) {                                    // time axis: chronological, keep the most recent N
      xs = Object.keys(xCnt).sort(xd.cmp);
      if (S.insTopX < xs.length) xs = xs.slice(xs.length - S.insTopX);
    } else {
      xs = Object.keys(xCnt).sort(function (a, b) { return xCnt[b] - xCnt[a]; });
      if (S.insTopX < xs.length) xs = xs.slice(0, S.insTopX);
      if (xd.ord) xs.sort(xd.cmp);                      // ordinal dims (Budget) read low→high, not by frequency
    }
    if (!xs.length) { chart.innerHTML = '<div class="empty">No data for the current filters.</div>'; return; }
    var ysAll = Object.keys(yCnt).sort(function (a, b) { return yCnt[b] - yCnt[a]; });
    var topYs = S.insTopY < ysAll.length ? ysAll.slice(0, S.insTopY) : ysAll;
    var hasOther = ysAll.length > topYs.length;
    var series = topYs.slice();
    if (yd.ord) series.sort(yd.cmp);                    // ordinal series (Budget) stack/legend low→high
    if (hasOther) series.push('__other__');
    // Dim series colours so the chart reads as softly as the filter swatches
    // (lightened + slightly desaturated) instead of full-saturation blocks.
    function segColor(y){ return y === '__other__' ? '#d3dae3' : shade(yd.color(y), 0.34); }
    function segLabel(y){ return y === '__other__' ? 'Other' : y; }

    var lineMode = S.insMode === 'line', pctMode = S.insMode === 'pct';
    var areaMode = S.insMode === 'area', barMode = S.insMode === 'bar';
    var unitPct = pctMode;
    // value for series y at x: Activities = summed count; Projects = distinct projects
    // in the cell ("Other" = union of the non-top series).
    function rawAt(x, y){
      var xc = cell[x] || {};
      if (measureProj) {
        var u = {};
        if (y === '__other__') { Object.keys(xc).forEach(function (k){ if (topYs.indexOf(k) < 0 && xc[k].pset) Object.keys(xc[k].pset).forEach(function (id){ u[id] = 1; }); }); }
        else if (xc[y] && xc[y].pset) Object.keys(xc[y].pset).forEach(function (id){ u[id] = 1; });
        return Object.keys(u).length;
      }
      var sum = 0;
      if (y === '__other__') { Object.keys(xc).forEach(function (k){ if (topYs.indexOf(k) < 0) sum += xc[k].sum; }); }
      else if (xc[y]) sum = xc[y].sum;
      return sum;
    }
    // Rollup across series at x = SUM of the per-cell values.
    function totAt(x){ var sum = 0; series.forEach(function (y){ var v = rawAt(x, y); if (v > 0) sum += v; }); return sum; }

    // Projects/Activities stack (bars and area); Line uses per-series scaling.
    var perSeriesScale = lineMode;
    var maxSeries = 0; if (perSeriesScale) xs.forEach(function (x) { series.forEach(function (y) { var v = rawAt(x, y); if (v > maxSeries) maxSeries = v; }); });
    var maxTot = 0; xs.forEach(function (x) { var tt = totAt(x); if (tt > maxTot) maxTot = tt; });
    var topVal = pctMode ? 100 : niceMax(perSeriesScale ? maxSeries : maxTot);

    var W = 900, H = 460, padL = 46, padR = 14, padT = 18, padB = 42;
    var plotW = W - padL - padR, plotH = H - padT - padB, n = xs.length;
    var bw = Math.max(8, Math.min(92, (plotW / n) * 0.62));
    function Y(u){ return padT + plotH - (u / topVal) * plotH; }
    function cxAt(i){ return padL + (i + 0.5) * (plotW / n); }

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
    var ticks = 5;
    for (var t = 0; t <= ticks; t++) {
      var yy = padT + plotH - (t / ticks) * plotH, yv = (t / ticks) * topVal;
      svg += '<line class="gridline" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + yy.toFixed(1) + '" y2="' + yy.toFixed(1) + '"/>';
      svg += '<text class="axlabel" x="' + (padL - 7) + '" y="' + (yy + 3).toFixed(1) + '" text-anchor="end">' + (unitPct ? Math.round(yv) + '%' : fmt(Math.round(yv))) + '</text>';
    }
    if (lineMode) {
      // one line per series (series identity colour)
      series.forEach(function (y) {
        var pts = xs.map(function (x, i) { return cxAt(i).toFixed(1) + ',' + Y(rawAt(x, y)).toFixed(1); });
        svg += '<polyline class="ln" points="' + pts.join(' ') + '" fill="none" stroke="' + segColor(y) + '" stroke-width="2.2" stroke-linejoin="round"/>';
        xs.forEach(function (x, i) { var v = rawAt(x, y);
          svg += '<circle class="pt" cx="' + cxAt(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="2.8" fill="' + segColor(y) + '"><title>' + esc(segLabel(y)) + ' · ' + esc(x) + ': ' + fmt(v) + '</title></circle>'; });
      });
      xs.forEach(function (x, i) {
        svg += '<text class="xlab" x="' + cxAt(i).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + esc(truncTxt(x, 16)) + '<title>' + esc(x) + '</title></text>';
      });
    } else if (areaMode) {
      // cumulative stacked bands (bottom → top)
      var cum = xs.map(function () { return 0; });
      series.forEach(function (y) {
        var top = [], bot = [];
        xs.forEach(function (x, i) { var raw = rawAt(x, y); bot.push(cxAt(i).toFixed(1) + ',' + Y(cum[i]).toFixed(1)); top.push(cxAt(i).toFixed(1) + ',' + Y(cum[i] + raw).toFixed(1)); });
        svg += '<polygon class="ar" points="' + top.concat(bot.reverse()).join(' ') + '" fill="' + segColor(y) + '" fill-opacity="0.85" stroke="' + segColor(y) + '" stroke-width="0.6"><title>' + esc(segLabel(y)) + '</title></polygon>';
        xs.forEach(function (x, i) { cum[i] += rawAt(x, y); });
      });
      xs.forEach(function (x, i) {
        svg += '<text class="xlab" x="' + cxAt(i).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + esc(truncTxt(x, 16)) + '<title>' + esc(x) + '</title></text>';
      });
    } else {
      // Bar / % Bar: stacked segments per x
      xs.forEach(function (x, i) {
        var cx = cxAt(i), x0 = cx - bw / 2, total = totAt(x), cum = 0;
        series.forEach(function (y) {
          var raw = rawAt(x, y);
          if (raw <= 0) return;
          var disp = pctMode ? (total > 0 ? raw / total * 100 : 0) : raw;
          var y1 = Y(cum), y2 = Y(cum + disp);
          svg += '<rect class="seg" x="' + x0.toFixed(1) + '" y="' + y2.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y1 - y2).toFixed(1) + '" fill="' + segColor(y) + '"><title>' + esc(segLabel(y)) + ': ' + fmt(raw) + '</title></rect>';
          cum += disp;
        });
        // total label above bar
        svg += '<text class="total" x="' + cx.toFixed(1) + '" y="' + (Y(cum) - 5).toFixed(1) + '" text-anchor="middle">' + fmt(total) + '</text>';
        // x label
        svg += '<text class="xlab" x="' + cx.toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + esc(truncTxt(x, 16)) + '<title>' + esc(x) + '</title></text>';
      });
    }
    svg += '</svg>';
    chart.innerHTML = svg;

    // legend - series identities
    series.forEach(function (y) {
      var li = el('div', 'li'); var sq = el('span', 'sq'); sq.style.background = segColor(y);
      li.appendChild(sq); li.appendChild(document.createTextNode(segLabel(y))); li.title = segLabel(y);
      legendEl.appendChild(li);
    });
  }
  function truncTxt(s, n){ s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

  // =========================================================================
  //  TICKER
  // =========================================================================
  function renderTicker() {
    var host = $('#ticker'); if (!host) return;   // ticker/marquee removed from the layout
    host.innerHTML = '';
    var frag = document.createDocumentFragment();

    // ---- small builders --------------------------------------------------
    function mkItem(kind, kindLabel, dotColor, onclick) {
      var ti = el('span', 'ti k-' + kind);
      if (kindLabel) ti.appendChild(el('b', 'kd', kindLabel));
      if (dotColor) { var sd = el('span', 'sd'); sd.style.background = dotColor; ti.appendChild(sd); }
      if (onclick) { ti.classList.add('clk'); ti.onclick = onclick; }
      return ti;
    }
    function add(ti, cls, s) { if (s != null && s !== '') ti.appendChild(el('span', cls, s)); return ti; }
    function addPct(ti, frac, code) {
      var p = el('span', 'tp', frac == null ? '–' : Math.round(frac * 100) + '%');
      p.style.color = (STATUS[code] || STATUS.nodata).c; ti.appendChild(p); return ti;
    }
    function unitOf(r) { return r.unit === '%' ? '%' : (r.unit ? ' ' + r.unit : ''); }

    // ---- 1. PORTFOLIO PULSE (lead summary) ------------------------------
    var withData = IND.filter(function (r) { return r.ratio != null; });
    var onTrack  = withData.filter(function (r) { return r.status === 'green' || r.status === 'blue'; }).length;
    var atRisk   = withData.filter(function (r) { return r.status === 'amber'; }).length;
    var offTrack = withData.filter(function (r) { return r.status === 'red' || r.status === 'maroon'; }).length;
    var budget   = PROJECTS.reduce(function (s, p) { return s + (+p.budget || 0); }, 0);
    var onPct    = withData.length ? Math.round(onTrack / withData.length * 100) : 0;
    var countries = {}; PROJECTS.forEach(function (p) { if (p.iso) countries[p.iso] = 1; });

    var lead = mkItem('sum', 'PORTFOLIO', null, null); lead.classList.add('lead');
    add(lead, 'tv', PROJECTS.length + ' projects');
    add(lead, 'sep', '·'); add(lead, 'tv', Object.keys(countries).length + ' countries');
    add(lead, 'sep', '·'); add(lead, 'tv', IND.length + ' KPIs');
    add(lead, 'sep', '·'); addPct(lead, withData.length ? onTrack / withData.length : null, 'green');
    add(lead, 'tv', 'on track');
    if (atRisk)   { add(lead, 'sep', '·'); add(lead, 'tv', atRisk + ' at risk'); }
    if (offTrack) { add(lead, 'sep', '·'); add(lead, 'tv', offTrack + ' off track'); }
    if (budget)   { add(lead, 'sep', '·'); add(lead, 'tv', '$' + fmtCompact(budget) + ' portfolio'); }
    frag.appendChild(lead);

    // ---- 2. KPI updates (most recently reported) ------------------------
    var kpiItems = IND.filter(function (r) { return r.updated; })
      .sort(function (a, b) { return a.updated < b.updated ? 1 : -1; }).slice(0, 30)
      .map(function (r) {
        var ti = mkItem('kpi', r.sdg ? pillarLabel(r.sdg) : 'General',
          r.sdg ? PILLAR_COLORS[r.sdg] : '#94a3b8', function () { openDetail(r); });
        add(ti, 'tx', r.name);
        var u = unitOf(r);
        if (r.value != null && r.raw.target_value != null)
          add(ti, 'tv', fmtNum(r.value) + u + ' / ' + fmtNum(r.raw.target_value) + u);
        // direction of the latest measurement vs the one before it
        var s = r.series || [];
        if (s.length >= 2 && s[s.length - 1].value != null && s[s.length - 2].value != null) {
          var d = s[s.length - 1].value - s[s.length - 2].value;
          if (d !== 0) { var dl = el('span', 'td', d > 0 ? '▲' : '▼');
            dl.style.color = d > 0 ? STATUS.green.c : STATUS.red.c; ti.appendChild(dl); }
        }
        addPct(ti, r.frac, r.status);
        return ti;
      });

    // ---- 3. PROJECT spotlights (most active first) ----------------------
    var projItems = PROJECTS.slice()
      .sort(function (a, b) { return (b.activityN || 0) - (a.activityN || 0); }).slice(0, 20)
      .map(function (p) {
        var st = projStat(p);
        var ti = mkItem('prj', 'PROJECT', regionColor(p.region), function () { openEntitySummary('project', p.id); });
        add(ti, 'tx', p.name);
        var bits = [];
        if (p.country) bits.push(p.country.name);
        bits.push(p.kpis.length + ' KPIs');
        if (p.activityN) bits.push(p.activityN + ' updates');
        if (p.budget) bits.push('$' + fmtCompact(p.budget));
        add(ti, 'tv', bits.join(' · '));
        addPct(ti, st.frac, st.code);
        return ti;
      });

    // ---- 4. RESULT rollups (per impact pillar) --------------------------
    var byPillar = {};
    IND.forEach(function (r) { if (r.ratio == null) return; var k = r.sdg || 0; (byPillar[k] = byPillar[k] || []).push(r); });
    var resItems = Object.keys(byPillar).map(function (k) {
      var ag = aggKpis(byPillar[k]), sdg = +k;
      var ti = mkItem('res', 'RESULT', sdg ? PILLAR_COLORS[sdg] : '#94a3b8', null);
      add(ti, 'tx', sdg ? (pillarLabel(sdg) + ' · ' + (PILLAR_NAMES[sdg] || '')) : 'Unaligned');
      add(ti, 'tv', ag.n + ' indicators');
      addPct(ti, ag.frac, ag.code);
      return ti;
    });

    // ---- interleave the pools so the marquee keeps changing register -----
    var qi = 0, qp = 0, qr = 0;
    while (qi < kpiItems.length || qp < projItems.length || qr < resItems.length) {
      if (qi < kpiItems.length) frag.appendChild(kpiItems[qi++]);
      if (qi < kpiItems.length) frag.appendChild(kpiItems[qi++]);
      if (qp < projItems.length) frag.appendChild(projItems[qp++]);
      if (qi < kpiItems.length) frag.appendChild(kpiItems[qi++]);
      if (qr < resItems.length) frag.appendChild(resItems[qr++]);
    }
    host.appendChild(frag);
  }

  // =========================================================================
  //  RENDER ORCHESTRATION
  // =========================================================================
  function renderAll() {
    if (S.tab === 'map') { renderBubbles(); renderList(); }
    else { renderInsights(); renderList(); }
    renderFacets();
    persist();
  }

  // =========================================================================
  //  WIRING
  // =========================================================================
  var RANGES = [['today','Today'],['yesterday','Yesterday'],['7d','7 Days'],['30d','30 Days'],
    ['3m','3 Months'],['6m','6 Months'],['1y','1 Year'],['all','All Time']];

  function wire() {
    initFacetGroups();   // drag-to-reorder + collapse on the left filter groups
    // ranges
    var rc = $('#ranges');
    RANGES.forEach(function (r) {
      var b = el('button','range'+(r[0]===S.range?' on':''), r[1]); b.dataset.r = r[0];
      b.onclick = function () { S.range = r[0]; S.from = S.to = null; $('#dFrom').value=''; $('#dTo').value='';
        Array.prototype.forEach.call(rc.children,function(x){x.classList.toggle('on',x.dataset.r===r[0]);});
        S.page = 0; renderAll(); };
      rc.appendChild(b);
    });
    $('#dFrom').onchange = function (e){ S.from = e.target.value||null; clearRangeButtons(); S.page=0; renderAll(); };
    $('#dTo').onchange = function (e){ S.to = e.target.value||null; clearRangeButtons(); S.page=0; renderAll(); };

    // count basis toggle - single cycling button: projects ↔ activities (drives facet counts + map bubbles)
    var cb = $('#countBasis');
    if (cb) cb.onclick = function () {
      S.countBasis = S.countBasis === 'projects' ? 'activities' : 'projects';
      syncBasisToggles();
      renderAll(); persist();
    };

    // tabs
    $('#tabs').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      S.tab = b.dataset.tab;
      Array.prototype.forEach.call($('#tabs').children,function(x){x.classList.toggle('on',x===b);});
      $('#mapView').classList.toggle('hide', S.tab!=='map');
      $('#insightsView').classList.toggle('hide', S.tab!=='insights');
      renderAll();
    });

    // searches - the query state updates immediately (cheap); the re-render is
    // debounced so typing doesn't re-cluster the map / rebuild a facet per keystroke
    var renderListBounced = debounce(function (){ renderList(); if (S.tab === 'map') renderBubbles(); persist(); });
    $('#qList').addEventListener('input', function (e){ S.qList = e.target.value; S.page=0; renderListBounced(); });
    var progBounced = debounce(function (){ renderProgFacet(); persist(); });
    $('#qProg').addEventListener('input', function (e){ S.qProg = e.target.value; progBounced(); });
    var sdgBounced = debounce(function (){ renderFrameworkFacet(); persist(); });
    $('#qSdg').addEventListener('input', function (e){ S.qSdg = e.target.value; sdgBounced(); });
    var qk = $('#qKpi'); if (qk) { var kpiBounced = debounce(function (){ renderKpiFacet(); persist(); }); qk.addEventListener('input', function (e){ S.qKpi = e.target.value; kpiBounced(); }); }
    var qu = $('#qUser'); if (qu) { var userBounced = debounce(function (){ renderUserFacet(); persist(); }); qu.addEventListener('input', function (e){ S.qUser = e.target.value; userBounced(); }); }
    var qd = $('#qDonor'); if (qd) { var donorBounced = debounce(function (){ renderDonorFacet(); persist(); }); qd.addEventListener('input', function (e){ S.qDonor = e.target.value; donorBounced(); }); }
    var qpr = $('#qProject'); if (qpr) { var projectBounced = debounce(function (){ renderProjectFacet(); persist(); }); qpr.addEventListener('input', function (e){ S.qProject = e.target.value; projectBounced(); }); }

    // pane mode - Projects ↔ KPIs (KPIs mode toggle removed; guard kept for safety)
    var listModeEl = $('#listMode');
    if (listModeEl) listModeEl.addEventListener('click', function (e){
      var b = e.target.closest('button'); if (!b) return;
      var mode = b.dataset.lmode; if (!mode || mode === S.listMode) return;
      S.listMode = mode; S.page = 0;
      Array.prototype.forEach.call(listModeEl.children, function (x){ x.classList.toggle('on', x === b); });
      $('#qList').placeholder = mode === 'kpis' ? 'Search primary KPIs…' : 'Search projects, donors, countries…';
      renderSortButtons(); renderList(); persist();
    });

    // sorts - click toggles direction when already active, else switches field
    $('#sorts').addEventListener('click', function (e){
      var b = e.target.closest('button'); if(!b || !b.dataset.sort)return;
      if (S.listMode === 'kpis') {
        if (S.kpiSort === b.dataset.sort) S.kpiSortDir = S.kpiSortDir === 'asc' ? 'desc' : 'asc';
        else { S.kpiSort = b.dataset.sort; S.kpiSortDir = defaultSortDir(S.kpiSort); }
      } else {
        if (S.sort === b.dataset.sort) S.sortDir = S.sortDir === 'asc' ? 'desc' : 'asc';
        else { S.sort = b.dataset.sort; S.sortDir = defaultSortDir(S.sort); }
      }
      renderSortButtons(); renderList(); persist();
    });

    // pager
    $('#pFirst').onclick=function(){S.page=0;renderList();persist();};
    $('#pPrev').onclick=function(){if(S.page>0){S.page--;renderList();persist();}};
    $('#pNext').onclick=function(){S.page++;renderList();persist();};
    $('#pLast').onclick=function(){S.page=1e9;renderList();persist();};

    // clear filters
    $('#clearFilters').onclick=function(){ S.selProg.clear(); S.selRegion.clear(); S.selNodes.clear(); S.selSdg.clear(); S.selKpi.clear(); S.selUser.clear(); S.selStatus.clear(); S.selType.clear(); S.selDonor.clear(); S.selProject.clear(); S.selBenType.clear(); S.selCountry=null; S.qList=''; $('#qList').value=''; S.qKpi=''; S.qUser=''; S.qDonor=''; S.qProject=''; if($('#qProject'))$('#qProject').value=''; S.page=0; renderAll(); };

    // legend / map controls
    $('#colorMode').onchange=function(e){ S.colorMode=e.target.value; renderBubbles(); persist(); };
    $('#legMin').onclick=function(){ $('#legend').classList.toggle('min'); $('#legMin').textContent = $('#legend').classList.contains('min')?'+':'–'; persist(); };
    // status basis toggle - single cycling button: progress ↔ performance
    $('#mapmode').onclick = function (){
      S.perfBasis = S.perfBasis === 'progress' ? 'performance' : 'progress';
      syncBasisToggles();
      applyBasis();          // rebind KPI + result status to the new basis
      buildProjects();       // re-roll project status too - the map colours bubbles from projStat()
      renderAll();           // bubbles, list, facets, ticker all follow the basis
      persist();             // remember the chosen basis
    };

    // collapse panels
    $('#colLeft').onclick=function(){ toggleCol('no-left','#colLeft','‹','›'); };
    $('#colRight').onclick=function(){ toggleCol('no-right','#colRight','›','‹'); };

    // bottom bar buttons
    $('#btnTheme').onclick=toggleTheme;
    $('#btnControl').onclick=openControl;
    $('#btnResults').onclick=openResults;

    // Plan header chip - switch active plan + manage plans (default/edit/delete/new)
    var pChip=$('#planChip'); if(pChip) pChip.onclick=function(e){ e.stopPropagation(); togglePlanMenu(); };
    var pMenu=$('#planMenu'); if(pMenu) pMenu.addEventListener('click',function(e){ e.stopPropagation(); });
    document.addEventListener('click',function(e){ if(!$('#planMenu').hidden && !$('#planbox').contains(e.target)) closePlanMenu(); });

    // Account chip (avatar + name) + dropdown: edit profile / log out
    var uChip=$('#userChip'); if(uChip) uChip.onclick=function(e){ e.stopPropagation(); toggleUserMenu(); };
    var uMenu=$('#userMenu'); if(uMenu) uMenu.addEventListener('click',function(e){ e.stopPropagation(); });
    document.addEventListener('click',function(e){ if($('#userMenu') && !$('#userMenu').hidden && !$('#userBox').contains(e.target)) closeUserMenu(); });

    // About modal (open by clicking the wordmark)
    $('#brandBtn').onclick=openAbout;
    $('#brandBtn').addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); openAbout(); } });
    $('#aboutClose').onclick=closeAbout;
    $('#aboutModal').addEventListener('click',function(e){ if(e.target===$('#aboutModal')) closeAbout(); });
    var avEl=$('#appVersion'); if(avEl) avEl.textContent=APP_VERSION;   // render the app version from its single source of truth
    var bNP=$('#btnNewProject'); if(bNP) bNP.onclick=function(){ openProject(null); };
    var bNPSide=$('#btnNewProjectSide'); if(bNPSide) bNPSide.onclick=function(){ openProject(null); };

    // New Activity child popup
    $('#naClose').onclick = closeNewActivity;
    $('#newActivityOverlay').addEventListener('click', function (e){ if (e.target === $('#newActivityOverlay')) closeNewActivity(); });

    // Project modal + its tabs
    $('#prClose').onclick = closeProject;
    $('#projectModal').addEventListener('click', function (e){ if (e.target === $('#projectModal')) closeProject(); });
    $('#prTabs').addEventListener('click', function (e){ var b = e.target.closest('button'); if (!b) return; setProjectTab(b.dataset.prtab); });
    // deep links: #project/<id> opens that project popup
    window.addEventListener('hashchange', handleProjectHash);

    // Secondary KPI child popup (over the project modal)
    $('#secEditClose').onclick = closeSecEdit;
    $('#secEditOverlay').addEventListener('click', function (e){ if (e.target === $('#secEditOverlay')) closeSecEdit(); });

    // Donor add/edit child popup (Control Panel)
    $('#donorEditClose').onclick = closeDonorEdit;
    $('#donorEditOverlay').addEventListener('click', function (e){ if (e.target === $('#donorEditOverlay')) closeDonorEdit(); });

    // Beneficiary measure (Control Panel) + beneficiary entry (activity form) popups
    $('#benTypeClose').onclick = closeBenTypeEdit;
    $('#benTypeOverlay').addEventListener('click', function (e){ if (e.target === $('#benTypeOverlay')) closeBenTypeEdit(); });
    $('#benEditClose').onclick = closeBenEdit;
    $('#benEditOverlay').addEventListener('click', function (e){ if (e.target === $('#benEditOverlay')) closeBenEdit(); });

    // detail modal + its Details / Add activity tabs
    $('#mClose').onclick=closeDetail;
    var _mBack = $('#mBack'); if (_mBack) _mBack.onclick = navBack;   // ‹ steps back one drill-down level
    $('#modal').addEventListener('click',function(e){ if(e.target===$('#modal')) closeDetail(); });
    $('#mTabs').addEventListener('click', function (e){
      var b = e.target.closest('button'); if(!b) return; setModalTab(b.dataset.mtab);
    });

    // global items
    $('#cpClose').onclick=closeControl;
    $('#cpModal').addEventListener('click',function(e){ if(e.target===$('#cpModal')) closeControl(); });
    $('#cpTabs').addEventListener('click', function (e){
      var b = e.target.closest('button'); if(!b) return;
      Array.prototype.forEach.call($('#cpTabs').children,function(x){x.classList.toggle('on',x===b);});
      renderControl(b.dataset.cptab);
    });

    // results management
    $('#rmClose').onclick=closeResults;
    $('#rmModal').addEventListener('click',function(e){ if(e.target===$('#rmModal')) closeResults(); });
    $('#rmTabs').addEventListener('click', function (e){
      var b = e.target.closest('button'); if(!b) return;
      Array.prototype.forEach.call($('#rmTabs').children,function(x){x.classList.toggle('on',x===b);});
      renderResults(b.dataset.rmtab);
    });

    // KPI edit child popup
    $('#kpiEditClose').onclick = closeKpiEdit;
    $('#kpiEditOverlay').addEventListener('click', function (e){ if (e.target === $('#kpiEditOverlay')) closeKpiEdit(); });

    // User add/edit child popup
    $('#userEditClose').onclick = closeUserEdit;
    $('#userEditOverlay').addEventListener('click', function (e){ if (e.target === $('#userEditOverlay')) closeUserEdit(); });

    // Results Framework edit/add child popup
    $('#fwEditClose').onclick = closeFwEdit;
    $('#fwEditOverlay').addEventListener('click', function (e){ if (e.target === $('#fwEditOverlay')) closeFwEdit(); });

    document.addEventListener('keydown',function(e){
      if(e.key==='Escape'){
        // close the top-most layer first
        if ($('#userMenu') && !$('#userMenu').hidden) { closeUserMenu(); return; }
        if ($('#planMenu') && !$('#planMenu').hidden) { closePlanMenu(); return; }
        if ($('#benEditOverlay').classList.contains('on')) { closeBenEdit(); return; }
        if ($('#benTypeOverlay').classList.contains('on')) { closeBenTypeEdit(); return; }
        if ($('#donorEditOverlay').classList.contains('on')) { closeDonorEdit(); return; }
        if ($('#secEditOverlay').classList.contains('on')) { closeSecEdit(); return; }
        if ($('#kpiEditOverlay').classList.contains('on')) { closeKpiEdit(); return; }
        if ($('#userEditOverlay').classList.contains('on')) { closeUserEdit(); return; }
        if ($('#fwEditOverlay').classList.contains('on')) { closeFwEdit(); return; }
        if ($('#newActivityOverlay').classList.contains('on')) { closeNewActivity(); return; }
        if ($('#aboutModal').classList.contains('on')) { closeAbout(); return; }
        if ($('#projectModal').classList.contains('on')) { closeProject(); return; }
        if ($('#rmModal').classList.contains('on')) { closeResults(); return; }
        closeDetail(); closeControl();
      }
    });
  }
  function clearRangeButtons(){ S.range=''; Array.prototype.forEach.call($('#ranges').children,function(x){x.classList.remove('on');}); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function setGrid(){
    var m=$('#main');
    var L = m.classList.contains('no-left')  ? 0 : (S.leftW  != null ? S.leftW  : defPaneW());
    var R = m.classList.contains('no-right') ? 0 : (S.rightW != null ? S.rightW : defPaneW());
    m.style.gridTemplateColumns = L + 'px 1fr ' + R + 'px';
  }
  function initResizers(){
    wireResizer($('#rzLeft'), 'left');
    wireResizer($('#rzRight'), 'right');
    var t;
    window.addEventListener('resize', function () {
      setGrid();                       // default panes recompute to 15% of the new width
      if (mapCountriesDrawn) { setView(); }   // keep the viewBox aspect matched to the new size
      clearTimeout(t); t = setTimeout(function () { renderBubbles(); renderTiles(); }, 120);
    });
  }
  function wireResizer(handle, side){
    if (!handle) return;
    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      var rect = $('#main').getBoundingClientRect();
      handle.classList.add('drag'); document.body.style.userSelect = 'none';
      function move(ev){
        if (side === 'left') S.leftW = clamp(Math.round(ev.clientX - rect.left), 150, Math.min(460, rect.width - S.rightW - 220));
        else S.rightW = clamp(Math.round(rect.right - ev.clientX), 170, Math.min(560, rect.width - S.leftW - 220));
        setGrid();
      }
      function up(){ document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
        handle.classList.remove('drag'); document.body.style.userSelect = ''; renderBubbles(); persist(); }
      document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
    });
  }
  function toggleCol(cls, sel, a, b){
    var m=$('#main'); m.classList.toggle(cls);
    var collapsed = m.classList.contains(cls);
    // expanding a pane restores the default width (15% of screen; discards any resize)
    if (!collapsed) { if (cls === 'no-left') S.leftW = null; else S.rightW = null; }
    $(sel).textContent = collapsed ? b : a;
    setGrid();
    setTimeout(function () { if (mapCountriesDrawn) setView(); renderBubbles(); renderTiles(); }, 60);
    persist();
  }
  // The two filter-pane toggles are single cycling buttons (like the theme button):
  // they show only the current value; clicking flips it. This keeps their labels in sync.
  function syncBasisToggles(){
    var c = $('#countBasis'); if (c) c.textContent = '⇄ ' + (S.countBasis === 'activities' ? 'Activities' : 'Projects');
    var p = $('#mapmode');    if (p) p.textContent = '⇄ ' + (S.perfBasis === 'progress' ? 'Progress' : 'Performance');
  }
  function toggleTheme(){
    S.theme = S.theme==='light'?'dark':'light';
    document.documentElement.setAttribute('data-theme', S.theme);
    $('#btnTheme').textContent = S.theme==='light'?'☀ Light':'☾ Dark';
    renderTiles();     // swap the basemap between light (Voyager) and dark (Dark Matter)
    renderBubbles();
    persist();
  }

  // =========================================================================
  //  UTILITIES
  // =========================================================================
  function toggle(set, v){ if(set.has(v))set.delete(v); else set.add(v); }
  function hasFilters(){ return S.selProg.size||S.selRegion.size||S.selNodes.size||S.selSdg.size||S.selKpi.size||S.selUser.size||S.selStatus.size||S.selType.size||S.selDonor.size||S.selProject.size||S.selBenType.size||S.selCountry||S.qList; }
  /** Every active filter, one entry per GROUP: { label, values:[...] }, in sidebar
   *  order. A results box is only ever a slice of the dashboard, so it says which
   *  slice - on screen and in the exported PDF, which otherwise leaves the room
   *  with no way to tell "7 projects" from "7 of 50". Empty groups are omitted, so
   *  an empty array means the box is showing everything. */
  function activeFilterSummary(){
    var out = [];
    function add(label, vals){
      vals = (vals || []).filter(function (v){ return v != null && v !== ''; });
      if (vals.length) out.push({ label: label, values: vals });
    }
    function names(set, fn){
      return Array.from(set).map(fn).filter(Boolean)
        .sort(function (a, b){ return a < b ? -1 : (a > b ? 1 : 0); });
    }
    // Period: an explicit from/to overrides the preset range buttons.
    if (S.from || S.to){
      add('Period', [(S.from ? shortDate(S.from) : 'start') + ' → ' + (S.to ? shortDate(S.to) : 'today')]);
    } else if (S.range && S.range !== 'all'){
      var rl = null; RANGES.forEach(function (r){ if (r[0] === S.range) rl = r[1]; });
      add('Period', [rl || S.range]);
    }
    add('Region', names(S.selRegion, function (k){ return regionFull(k); }));
    if (S.selCountry){
      var co = DB._idx.countryByIso[S.selCountry];
      add('Country', [co ? co.name : S.selCountry]);
    }
    add('Programme portfolio', names(S.selProg, function (id){
      var pg = DB._idx.programmeById[id];
      var c = pg ? DB._idx.countryByIso[pg.country_iso3] : null;
      return c ? c.name : (pg ? pg.name : null);
    }));
    add('Results framework', names(S.selNodes, function (k){
      var parts = String(k).split(SEP), lvl = parts[0], val = parts.slice(1).join(SEP);
      return lvl === 'sdg' ? (PILLAR_NAMES[val] || ('Pillar ' + val)) : (cap(lvl) + ' · ' + val);
    }));
    add('Pillar', names(S.selSdg, function (s){ return PILLAR_NAMES[s] || ('Pillar ' + s); }));
    add('Donors', names(S.selDonor, function (id){
      var d = DB._idx.donorById[id]; return d ? (d.short_name || d.name) : null;
    }));
    add('Projects', names(S.selProject, function (id){
      var p = PROJECTSBYID[id]; return p ? (p.code || p.name) : null;
    }));
    add('Performance status', names(S.selStatus, function (k){ return STATUS[k] ? STATUS[k].label : k; }));
    add('KPI type', names(S.selType, function (t){ return cap(t); }));
    add('Project beneficiaries', names(S.selBenType, function (id){ return benTypeName(id); }));
    add('KPI inventory', names(S.selKpi, function (n){ return n; }));
    add('Logged by', names(S.selUser, function (id){ var u = userById(id); return u ? u.name : null; }));
    if (S.qList) add('Search', ['"' + S.qList + '"']);
    return out;
  }
  /** The filter strip shown at the top of every results box (empty when nothing
   *  is filtered). Mirrors the PDF's strip - see pdfFilterStrip. */
  function filterStripHTML(){
    var fs = activeFilterSummary();
    if (!fs.length) return '';
    var h = '<div class="fstrip"><span class="fstrip-lbl">Filtered by</span>';
    fs.forEach(function (g){
      h += '<span class="fchip"><b>' + esc(g.label) + '</b>' + esc(g.values.join(', ')) + '</span>';
    });
    return h + '</div>';
  }
  /** "7 of 50 projects" when a filter is hiding some, "50 projects" when not. */
  function ofTotal(n, total, one, many){
    return fmt(n) + (total > n ? ' of ' + fmt(total) : '') + ' ' + (n === 1 ? one : many);
  }
  function countBy(arr, fn){ var m={}; arr.forEach(function(x){var k=fn(x); if(k!=null)m[k]=(m[k]||0)+1;}); return m; }
  // Filters ALWAYS report project numbers - not activity or KPI counts. accProjects
  // folds one indicator's projectIds into the DISTINCT-project set for a key;
  // finalizeCounts turns those per-key sets into project counts.
  function accProjects(sets, key, pids){
    if (key==null) return;
    var s = sets[key] || (sets[key] = {});
    (pids||[]).forEach(function(pid){ s[pid]=1; });
  }
  function finalizeCounts(sets){ var m={}; Object.keys(sets).forEach(function(k){ m[k]=Object.keys(sets[k]).length; }); return m; }
  function uniq(arr){ var s={}; arr.forEach(function(x){if(x!=null)s[x]=1;}); return Object.keys(s); }
  function fmt(n){ return (n||0).toLocaleString('en-US'); }
  // Compact count: 2,141 -> "2.1K", 6,960 -> "7K", 1,250,000 -> "1.3M". Uppercase K/M,
  // one decimal, trailing .0 stripped. Below 1,000 renders the exact number.
  function fmtC(n){ n = +n || 0; var a = Math.abs(n), s = n < 0 ? '-' : '';
    if (a >= 1e6) return s + (a / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
    if (a >= 1e3) return s + (a / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
    return s + Math.round(a).toLocaleString('en-US'); }
  function fmtNum(n){ if(n==null)return '–'; return Math.abs(n)>=1000?Math.round(n).toLocaleString('en-US'):(Math.round(n*10)/10); }
  function shortDate(iso){
    if (!iso) return '';
    // parse "YYYY-MM-DD" as a LOCAL date (avoid the UTC-midnight off-by-one that
    // otherwise shows 2025-01-01 as 31/12/24 in behind-UTC timezones)
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    var d = m ? new Date(+m[1], +m[2]-1, +m[3]) : new Date(iso);
    return String(d.getDate()).padStart(2,'0')+'/'+String(d.getMonth()+1).padStart(2,'0')+'/'+String(d.getFullYear()).slice(2);
  }
  // year from a "YYYY-MM-DD" string WITHOUT the UTC-parse year shift
  function yearOf(iso){ var m = /^(\d{4})/.exec(String(iso)); return m ? m[1] : String(new Date(iso).getFullYear()); }

  // =========================================================================
  //  PREFERENCES - persisted to a cookie (with localStorage fallback for file://)
  // =========================================================================
  var PREF_COOKIE = 'rbm_prefs';

  function setCookie(name, val) {
    var d = new Date(); d.setTime(d.getTime() + 365 * 864e5);
    try { document.cookie = name + '=' + encodeURIComponent(val) + ';expires=' + d.toUTCString() + ';path=/;SameSite=Lax'; } catch (e) {}
  }
  function getCookie(name) {
    var m = ('; ' + document.cookie).split('; ' + name + '=');
    return m.length === 2 ? decodeURIComponent(m.pop().split(';').shift()) : null;
  }

  function persist() {
    try {
      var main = $('#main');
      var p = {
        theme: S.theme, tab: S.tab, plan: S.plan, range: S.range, from: S.from, to: S.to,
        selProg: Array.from(S.selProg), selRegion: Array.from(S.selRegion),
        selNodes: Array.from(S.selNodes), selSdg: Array.from(S.selSdg), selCountry: S.selCountry,
        selKpi: Array.from(S.selKpi), selUser: Array.from(S.selUser), kpiShown: S.kpiShown, userShown: S.userShown,
        selStatus: Array.from(S.selStatus), selType: Array.from(S.selType),
        selDonor: Array.from(S.selDonor), selProject: Array.from(S.selProject), selBenType: Array.from(S.selBenType),
        donorShown: S.donorShown, projectShown: S.projectShown, progShown: S.progShown,
        qList: S.qList, qProg: S.qProg, qSdg: S.qSdg, qKpi: S.qKpi, qUser: S.qUser, qDonor: S.qDonor, qProject: S.qProject, sort: S.sort, sortDir: S.sortDir,
        listMode: S.listMode, countBasis: S.countBasis, kpiSort: S.kpiSort, kpiSortDir: S.kpiSortDir, page: S.page,
        colorMode: S.colorMode, perfBasis: S.perfBasis, expandRegion: Array.from(S.expandRegion),
        expandSdg: Array.from(S.expandSdg), expandImpact: Array.from(S.expandImpact), expandOutcome: Array.from(S.expandOutcome),
        expandKpiPillar: Array.from(S.expandKpiPillar), expandUserRole: Array.from(S.expandUserRole),
        facetOrder: S.facetOrder, facetCollapsed: S.facetCollapsed,
        insX: S.insX, insTopX: S.insTopX, insY: S.insY, insTopY: S.insTopY, insMode: S.insMode,
        leftW: S.leftW, rightW: S.rightW,
        noLeft: main.classList.contains('no-left'),
        noRight: main.classList.contains('no-right'),
        legendMin: $('#legend').classList.contains('min')
      };
      var s = JSON.stringify(p);
      setCookie(PREF_COOKIE, s);
      try { localStorage.setItem(PREF_COOKIE, s); } catch (e) {}
    } catch (e) {}
  }

  function loadPrefs() {
    var raw = getCookie(PREF_COOKIE);
    if (!raw) { try { raw = localStorage.getItem(PREF_COOKIE); } catch (e) {} }
    if (!raw) return;
    try {
      var p = JSON.parse(raw);
      if (p.theme) S.theme = p.theme;
      if (p.tab) S.tab = p.tab;
      if (p.plan != null) S.plan = p.plan;   // validated against real plans by resolvePlan()
      if ('range' in p) S.range = p.range;
      S.from = p.from || null; S.to = p.to || null;
      if (p.selProg) S.selProg = new Set(p.selProg);
      if (p.selRegion) S.selRegion = new Set(p.selRegion);
      if (p.selNodes) S.selNodes = new Set(p.selNodes);
      if (p.expandSdg) S.expandSdg = new Set(p.expandSdg);
      if (p.expandImpact) S.expandImpact = new Set(p.expandImpact);
      if (p.expandOutcome) S.expandOutcome = new Set(p.expandOutcome);
      if (p.selSdg) S.selSdg = new Set(p.selSdg);
      if (p.selKpi) S.selKpi = new Set(p.selKpi);
      if (p.kpiShown) S.kpiShown = Math.max(10, p.kpiShown);
      if (p.selUser) S.selUser = new Set(p.selUser);
      if (p.selStatus) S.selStatus = new Set(p.selStatus);
      if (p.selType) S.selType = new Set(p.selType);
      if (p.selDonor) S.selDonor = new Set(p.selDonor);
      if (p.selProject) S.selProject = new Set(p.selProject);
      if (p.selBenType) S.selBenType = new Set(p.selBenType);
      if (p.donorShown) S.donorShown = Math.max(10, p.donorShown);
      if (p.projectShown) S.projectShown = Math.max(10, p.projectShown);
      if (p.progShown && typeof p.progShown === 'object') S.progShown = p.progShown;
      if (p.sortDir) S.sortDir = p.sortDir;
      if (p.expandKpiPillar) S.expandKpiPillar = new Set(p.expandKpiPillar);
      if (p.expandUserRole) S.expandUserRole = new Set(p.expandUserRole);
      if (Array.isArray(p.facetOrder)) S.facetOrder = p.facetOrder;
      if (p.facetCollapsed && typeof p.facetCollapsed === 'object') S.facetCollapsed = p.facetCollapsed;
      S.selCountry = p.selCountry || null;
      S.qList = p.qList || ''; S.qProg = p.qProg || ''; S.qSdg = p.qSdg || '';
      S.qKpi = p.qKpi || ''; S.qUser = p.qUser || ''; S.qDonor = p.qDonor || ''; S.qProject = p.qProject || '';
      if (p.sort) S.sort = p.sort;
      if (['name','budget','progress','kpis'].indexOf(S.sort) < 0) { S.sort = 'name'; S.sortDir = 'asc'; }   // migrate old (report) sort keys
      S.listMode = 'projects';   // KPIs pane mode removed - always show projects
      if (p.countBasis === 'projects' || p.countBasis === 'activities') S.countBasis = p.countBasis;
      if (p.kpiSort) S.kpiSort = p.kpiSort;
      if (p.kpiSortDir) S.kpiSortDir = p.kpiSortDir;
      if (['name','progress','performance','activities'].indexOf(S.kpiSort) < 0) { S.kpiSort = 'name'; S.kpiSortDir = 'asc'; }
      S.page = p.page || 0;
      if (p.colorMode) S.colorMode = p.colorMode;
      // map now colours locations by status or region only - migrate old modes
      if (['status','region','impact','donor','budget'].indexOf(S.colorMode) < 0) S.colorMode = 'status';
      if (p.perfBasis === 'progress' || p.perfBasis === 'performance') S.perfBasis = p.perfBasis;
      if (p.userShown && typeof p.userShown === 'object') S.userShown = p.userShown;
      if (p.insX) S.insX = p.insX; if (p.insTopX) S.insTopX = p.insTopX;
      if (p.insY) S.insY = p.insY; if (p.insTopY) S.insTopY = p.insTopY;
      if (DIM_LIST.indexOf(S.insX) < 0) S.insX = 'sdg';       // migrate removed dims (e.g. 'level')
      if (DIM_LIST.indexOf(S.insY) < 0) S.insY = 'region';
      if (p.insMode) S.insMode = p.insMode;
      if (p.leftW) S.leftW = p.leftW; if (p.rightW) S.rightW = p.rightW;
      if (p.expandRegion) S.expandRegion = new Set(p.expandRegion);
      S._noLeft = !!p.noLeft; S._noRight = !!p.noRight; S._legendMin = !!p.legendMin;
    } catch (e) {}
  }

  /** Sync the restored preferences onto the DOM controls after wire(). */
  function applyPrefs() {
    document.documentElement.setAttribute('data-theme', S.theme);
    $('#btnTheme').textContent = S.theme === 'light' ? '☀ Light' : '☾ Dark';
    // tab
    Array.prototype.forEach.call($('#tabs').children, function (x) { x.classList.toggle('on', x.dataset.tab === S.tab); });
    syncBasisToggles();   // set the two single-button toggle labels to the restored basis
    $('#mapView').classList.toggle('hide', S.tab !== 'map');
    $('#insightsView').classList.toggle('hide', S.tab !== 'insights');
    // custom dates + searches
    if (S.from) $('#dFrom').value = S.from;
    if (S.to) $('#dTo').value = S.to;
    $('#qList').value = S.qList; $('#qProg').value = S.qProg; $('#qSdg').value = S.qSdg;
    if ($('#qKpi')) $('#qKpi').value = S.qKpi; if ($('#qUser')) $('#qUser').value = S.qUser;
    if ($('#qDonor')) $('#qDonor').value = S.qDonor;
    if ($('#qProject')) $('#qProject').value = S.qProject;
    // pane mode search placeholder (KPIs pane mode removed)
    $('#qList').placeholder = S.listMode === 'kpis' ? 'Search primary KPIs…' : 'Search projects, donors, countries…';
    // sorts
    renderSortButtons();
    // colour mode + bubble-size mode
    $('#colorMode').value = S.colorMode;
    // collapsed panels
    if (S._noLeft) { $('#main').classList.add('no-left'); $('#colLeft').textContent = '›'; }
    if (S._noRight) { $('#main').classList.add('no-right'); $('#colRight').textContent = '‹'; }
    // legend minimised
    if (S._legendMin) { $('#legend').classList.add('min'); $('#legMin').textContent = '+'; }
    applyFacetLayout();   // restore saved filter-group order + collapsed state
    renderPlanChip();     // header plan chip reflects the active plan
    setGrid();
  }

  // =========================================================================
  //  AUTH - login gate, session, roles
  //  Browser-only app: passwords are demo-grade LOCAL validation, not security.
  // =========================================================================
  var SESSION_KEY = 'ddi_session';
  function saveSession(id){ setCookie(SESSION_KEY, String(id)); try{ localStorage.setItem(SESSION_KEY, String(id)); }catch(e){} }
  function clearSession(){ setCookie(SESSION_KEY, ''); try{ localStorage.removeItem(SESSION_KEY); }catch(e){} }
  function sessionUser(){
    var id = getCookie(SESSION_KEY); if (!id){ try{ id = localStorage.getItem(SESSION_KEY); }catch(e){} }
    if (!id) return null;
    var u = DB._idx.userById[+id];
    return (u && u.enabled) ? u : null;
  }
  // permission helpers - driven by Status (Admin / User / Viewer) and Section
  function curStatus(){ return CURRENT_USER ? userStatus(CURRENT_USER) : null; }
  function curSection(){ return CURRENT_USER ? userSection(CURRENT_USER) : null; }
  function isAdmin(){ return curStatus() === 'admin'; }
  function canManageUsers(){ return isAdmin(); }
  function canEditFramework(){ return isAdmin(); }
  function canReport(r){
    if (!CURRENT_USER) return false;
    var st = curStatus();
    if (st === 'viewer') return false;          // read-only
    if (st === 'admin') return true;            // report anywhere
    // status 'user': the central Section reports on any country; a country office on its own only
    if (curSection() === 'hq') return true;
    return !!(r && r.programme && r.programme.country_iso3 === CURRENT_USER.country_iso3);
  }

  function userScopeLabel(u){
    return userSection(u) === 'co' ? (u.country_iso3 || 'CO') : 'Section';
  }
  function renderUserChip(){
    var chip = $('#userChip'); if (!chip || !CURRENT_USER) return;
    chip.querySelector('.un').textContent = CURRENT_USER.name;
    chip.querySelector('.ua').textContent = (CURRENT_USER.name[0] || '?').toUpperCase();
    chip.title = CURRENT_USER.name + ' - account menu';
  }
  // ---- account dropdown: identity + edit profile + log out ------------------
  function closeUserMenu(){
    var m = $('#userMenu'); if (m){ m.hidden = true; m.innerHTML = ''; }
    var c = $('#userChip'); if (c) c.setAttribute('aria-expanded', 'false');
  }
  function toggleUserMenu(){
    var m = $('#userMenu'); if (!m || !CURRENT_USER) return;
    if (!m.hidden){ closeUserMenu(); return; }
    m.innerHTML = ''; m.hidden = false;
    var c = $('#userChip'); if (c) c.setAttribute('aria-expanded', 'true');
    // identity header (name + status · scope)
    var head = el('div', 'um-head');
    head.appendChild(el('span', 'um-av', (CURRENT_USER.name[0] || '?').toUpperCase()));
    var tx = el('div', 'um-tx');
    tx.appendChild(el('div', 'um-nm', CURRENT_USER.name));
    tx.appendChild(el('div', 'um-sub', (STATUS_LABEL[curStatus()] || '') + ' · ' + userScopeLabel(CURRENT_USER)));
    head.appendChild(tx);
    m.appendChild(head);
    m.appendChild(el('div', 'um-sep'));
    var edit = el('button', 'um-item');
    edit.innerHTML = '<span class="um-ic" aria-hidden="true">✎</span><span>Edit profile</span>';
    edit.onclick = function (){ closeUserMenu(); openProfileEdit(); };
    m.appendChild(edit);
    var out = el('button', 'um-item danger');
    out.innerHTML = '<span class="um-ic" aria-hidden="true">⎋</span><span>Log out</span>';
    out.onclick = function (){ closeUserMenu(); doLogout(); };
    m.appendChild(out);
  }
  // Self-service profile editor - name, username, email, password. Section and
  // Status stay admin-controlled, so they are not shown here.
  function openProfileEdit(){
    if (!CURRENT_USER) return;
    var body = $('#userEditBody'); body.innerHTML = '';
    $('#userEditTitle').textContent = 'My profile';
    body.appendChild(profileForm(CURRENT_USER));
    $('#userEditOverlay').classList.add('on');
    var fn = body.querySelector('.pf-name'); if (fn) fn.focus();
  }
  function profileForm(u){
    var f = el('div', 'uform');
    f.innerHTML =
      '<div class="uform-h">My profile</div>' +
      '<div class="ufgrid">' +
      '  <label><span>Full name *</span><input class="pf-name" type="text" value="' + esc(u.name || '') + '"></label>' +
      '  <label><span>Username *</span><input class="pf-user" type="text" value="' + esc(u.username || '') + '"></label>' +
      '  <label><span>Email</span><input class="pf-email" type="email" value="' + esc(u.email || '') + '"></label>' +
      '  <label><span>New password</span><input class="pf-pass" type="password" placeholder="leave blank to keep" value=""></label>' +
      '  <label><span>Confirm password</span><input class="pf-pass2" type="password" placeholder="repeat new password" value=""></label>' +
      '</div>' +
      '<div class="cp-note">Your Section and Status are set by an administrator.</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn uf-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary uf-save" type="button">Save changes</button></div>';
    f.querySelector('.uf-cancel').onclick = function (){ closeUserEdit(); };
    f.querySelector('.uf-save').onclick = function (){
      var name = f.querySelector('.pf-name').value.trim();
      var uname = f.querySelector('.pf-user').value.trim();
      var email = f.querySelector('.pf-email').value.trim();
      var pass = f.querySelector('.pf-pass').value;
      var pass2 = f.querySelector('.pf-pass2').value;
      var msg = f.querySelector('.ufmsg');
      if (!name || !uname){ msg.textContent = 'Name and username are required.'; return; }
      if (usernameTaken(uname, u.id)){ msg.textContent = 'That username is already taken.'; return; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ msg.textContent = 'Enter a valid email address.'; return; }
      if (pass || pass2){
        if (pass !== pass2){ msg.textContent = 'The two passwords do not match.'; return; }
        if (pass.length < 4){ msg.textContent = 'Password must be at least 4 characters.'; return; }
      }
      u.name = name; u.username = uname; u.email = email || null;
      if (pass) u.password = pass;
      // Self-service save: refresh the chip + views, and the Users editor only if
      // an Admin happens to have the Control Panel open (avoids rebuilding it for
      // a regular user who edited their own profile).
      Promise.resolve(DB.persist('user', [u])).then(function (){
        closeUserEdit(); enrich(); renderTicker(); renderAll(); renderUserChip();
        if ($('#cpModal').classList.contains('on')) renderControl('users');
      });
    };
    return f;
  }
  function applyRole(){
    document.body.classList.remove('status-admin','status-user','status-viewer','sec-hq','sec-co');
    if (CURRENT_USER) { document.body.classList.add('status-' + curStatus()); document.body.classList.add('sec-' + curSection()); }
  }
  function loginAs(u){
    CURRENT_USER = u; saveSession(u.id);
    $('#loginGate').classList.remove('on');
    renderUserChip(); applyRole(); renderAll();
  }
  // The owner account differs between the public and internal seeds (see
  // tools/gen_seed.py), so name it from the data rather than hard-coding it in
  // the markup - otherwise the hint tells one build's users the other's login.
  function renderLoginHint(){
    var el = $('.lg-hint'); if (!el) return;
    var owner = ((DB.tables && DB.tables.user) || []).filter(function(u){ return u.status === 'admin'; })[0];
    if (!owner) return;
    el.innerHTML = "Demo access - each user's password is their username. Owner: <b>" +
                   esc(owner.username) + "</b> / <b>" + esc(owner.username) + "</b>.";
  }
  function showLogin(){
    var g = $('#loginGate'); if (!g) return;
    g.classList.add('on'); $('#lgMsg').textContent = '';
    renderLoginHint();
    var uu = $('#lgUser'); if (uu){ uu.value=''; $('#lgPass').value=''; uu.focus(); }
  }
  function doLogout(){ closeUserMenu(); CURRENT_USER = null; clearSession(); showLogin(); }
  function attemptLogin(){
    var uname = ($('#lgUser').value || '').trim().toLowerCase();
    var pass = $('#lgPass').value || '';
    var u = DB._idx.userByUsername[uname];
    if (!u){ $('#lgMsg').textContent = 'Unknown username.'; return; }
    if (!u.enabled){ $('#lgMsg').textContent = 'This account is disabled. Contact an Admin.'; return; }
    if (String(u.password) !== pass){ $('#lgMsg').textContent = 'Incorrect password.'; return; }
    loginAs(u);
  }
  function wireAuth(){
    $('#lgForm').addEventListener('submit', function(e){ e.preventDefault(); attemptLogin(); });
    // Logout now lives in the account-chip dropdown (see toggleUserMenu).
  }

  // Reconcile country → region assignments from the (authoritative) seed onto any
  // previously-persisted IndexedDB data, so region taxonomy changes - e.g. the move
  // from UN Regional Offices to geographic continents - reach existing browsers
  // without a manual data reset. Programmes, projects and country-office users all carry a
  // denormalised region derived from their country; each is realigned here.
  // Countries are never edited in-app, so this is always safe.
  function reconcileRegions() {
    var seed = (window.SEED && window.SEED.country) || [];
    if (!seed.length) return Promise.resolve();
    var regionByIso = {}; seed.forEach(function (c) { regionByIso[c.iso3] = c.region; });
    var cChanged = [], pChanged = [], prjChanged = [], uChanged = [];
    DB.tables.country.forEach(function (c) {
      var rg = regionByIso[c.iso3];
      if (rg && c.region !== rg) { c.region = rg; cChanged.push(c); }
    });
    DB.tables.programme.forEach(function (p) {
      var rg = regionByIso[p.country_iso3];
      if (rg && p.region !== rg) { p.region = rg; pChanged.push(p); }
    });
    DB.tables.project.forEach(function (pr) {
      var rg = regionByIso[pr.country_iso3];
      if (rg && pr.region !== rg) { pr.region = rg; prjChanged.push(pr); }
    });
    DB.tables.user.forEach(function (usr) {
      if (userSection(usr) !== 'co' || !usr.country_iso3) return;
      var rg = regionByIso[usr.country_iso3];
      if (rg && usr.region !== rg) { usr.region = rg; uChanged.push(usr); }
    });
    _countryShade = null;   // region membership may have shifted → recolour
    var jobs = [];
    if (cChanged.length) jobs.push(DB.persist('country', cChanged));
    if (pChanged.length) jobs.push(DB.persist('programme', pChanged));
    if (prjChanged.length) jobs.push(DB.persist('project', prjChanged));
    if (uChanged.length) jobs.push(DB.persist('user', uChanged));
    return Promise.all(jobs);
  }

  // Give every KPI an exact baseline/target date, derived from its year if the
  // data predates the date fields (1 Jan baseline year → 31 Dec target year).
  function reconcileKpiDates() {
    var changed = [];
    DB.tables.indicator.forEach(function (i) {
      var bd = i.baseline_date || ((i.baseline_year || 2025) + '-01-01');
      var td = i.target_date || ((i.target_year || 2027) + '-12-31');
      if (i.baseline_date !== bd || i.target_date !== td) { i.baseline_date = bd; i.target_date = td; changed.push(i); }
    });
    return changed.length ? DB.persist('indicator', changed) : Promise.resolve();
  }

  // Backfill beneficiary-measure descriptions and codes from the seed onto any
  // cached data that predates them. Only fills blanks, so admin edits are kept.
  function reconcileBenTypeDescriptions() {
    var seed = (window.SEED && window.SEED.beneficiary_type) || [];
    if (!seed.length) return Promise.resolve();
    var descByName = {}; seed.forEach(function (b) { if (b.description) descByName[b.name] = b.description; });
    var codeByName = {}; seed.forEach(function (b) { if (b.code) codeByName[b.name] = b.code; });
    var changed = [];
    DB.tables.beneficiary_type.forEach(function (t) {
      var hit = false;
      if (!t.description && descByName[t.name]) { t.description = descByName[t.name]; hit = true; }
      if (!t.code && codeByName[t.name]) { t.code = codeByName[t.name]; hit = true; }
      if (hit) changed.push(t);
    });
    return changed.length ? DB.persist('beneficiary_type', changed) : Promise.resolve();
  }

  // =========================================================================
  //  BOOT
  // =========================================================================
  DB.init().then(function () {
    loadPrefs();
    reconcileRegions();   // pull region taxonomy fixes onto any cached data
    reconcileKpiDates();  // backfill exact baseline/target dates
    reconcileBenTypeDescriptions();  // backfill measure descriptions onto cached data
    enrich();
    drawBase();
    initMapInteractions();
    initResizers();
    wire();
    wireAuth();
    applyPrefs();
    renderTicker();
    renderAll();
    // gate on login: restore a valid session, else show the login screen
    var u = sessionUser();
    if (u) loginAs(u); else showLogin();
    handleProjectHash();   // open a deep-linked project (#project/<id>) if present
  }).catch(function (err) {
    document.body.innerHTML = '<pre style="padding:20px;color:#b00">Failed to start: ' + (err && err.message) + '</pre>';
    console.error(err);
  });

  // =========================================================================
  //  PDF EXPORT - a genuine .pdf file, hand-built (no library, works offline).
  //  Uses the base-14 Helvetica / Helvetica-Bold fonts (no embedding needed);
  //  AFM widths below drive accurate wrapping and right-alignment. Renders the
  //  same scope banner, stat cards and results table shown in the popup.
  // =========================================================================
  // Helvetica & Helvetica-Bold advance widths (1000-unit em), char codes 32..126.
  var HELV_W = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
  var HELB_W = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

  // opts.landscape swaps the A4 page to its wide orientation - the whole export is
  // laid out off doc.PW/doc.PH, so nothing else has to know which way the page turned.
  function pdfWriter(opts){
    var PW = 595.28, PH = 841.89, margin = 44;
    if (opts && opts.landscape){ var _t = PW; PW = PH; PH = _t; }
    var pages = [], cur = null;
    function addPage(){ cur = { ops: [] }; pages.push(cur); return cur; }
    function op(s){ cur.ops.push(s); }
    function f(n){ return (Math.round(n * 100) / 100).toString(); }
    function rgb(hex){
      hex = (hex || '#000').replace('#', '');
      if (hex.length === 3) hex = hex.replace(/./g, '$&$&');
      var n = parseInt(hex, 16) || 0;
      return [Math.round(((n >> 16) & 255) / 255 * 1000) / 1000,
              Math.round(((n >> 8) & 255) / 255 * 1000) / 1000,
              Math.round((n & 255) / 255 * 1000) / 1000];
    }
    // fold text to WinAnsi single-byte space (unmapped glyphs → '?').
    function enc(s){
      s = String(s == null ? '' : s); var out = '';
      for (var i = 0; i < s.length; i++){
        var c = s.charCodeAt(i), o;
        if (c === 0x2019 || c === 0x2018) o = 39;
        else if (c === 0x201C || c === 0x201D) o = 34;
        else if (c === 0x2013 || c === 0x2014) o = 45;
        else if (c === 0x2192 || c === 0x21B3) o = 45;
        else if (c === 0x2022) o = 149;
        else if (c === 0x00B7) o = 183;
        else if (c <= 255) o = c;
        else o = 63;
        out += String.fromCharCode(o);
      }
      return out;
    }
    function cw(code, bold){
      if (code >= 32 && code <= 126) return (bold ? HELB_W : HELV_W)[code - 32];
      if (code === 183) return 278;
      if (code === 149) return 350;
      return bold ? 611 : 556;
    }
    function textWEnc(s, size, bold){ var w = 0; for (var i = 0; i < s.length; i++) w += cw(s.charCodeAt(i), bold); return w / 1000 * size; }
    function textW(s, size, bold){ return textWEnc(enc(s), size, bold); }
    function escPdf(s){ return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
    // Draw text with its baseline at (x, y).
    function text(str, x, y, opt){
      opt = opt || {}; var s = enc(str); if (!s) return;
      var col = opt.color || [0, 0, 0];
      op('BT /' + (opt.bold ? 'F2' : 'F1') + ' ' + (opt.size || 10) + ' Tf '
        + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg 1 0 0 1 ' + f(x) + ' ' + f(y) + ' Tm ('
        + escPdf(s) + ') Tj ET');
    }
    function rect(x, y, w, h, col){ op('q ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg ' + f(x) + ' ' + f(y) + ' ' + f(w) + ' ' + f(h) + ' re f Q'); }
    function rectStroke(x, y, w, h, col, lw){ op('q ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' RG ' + (lw || 0.5) + ' w ' + f(x) + ' ' + f(y) + ' ' + f(w) + ' ' + f(h) + ' re S Q'); }
    // Rounded rectangle / pill (corner radius r) via cubic Béziers. Filled when lw is
    // omitted, stroked (outline) when lw is given - used for the heat-map pills so the
    // PDF matches the fully-rounded pills on screen.
    function roundRect(x, y, w, h, r, col, lw){
      r = Math.min(r, h / 2, w / 2); var c = r * 0.5522847498;
      var p = f(x + r) + ' ' + f(y) + ' m '
        + f(x + w - r) + ' ' + f(y) + ' l '
        + f(x + w - r + c) + ' ' + f(y) + ' ' + f(x + w) + ' ' + f(y + r - c) + ' ' + f(x + w) + ' ' + f(y + r) + ' c '
        + f(x + w) + ' ' + f(y + h - r) + ' l '
        + f(x + w) + ' ' + f(y + h - r + c) + ' ' + f(x + w - r + c) + ' ' + f(y + h) + ' ' + f(x + w - r) + ' ' + f(y + h) + ' c '
        + f(x + r) + ' ' + f(y + h) + ' l '
        + f(x + r - c) + ' ' + f(y + h) + ' ' + f(x) + ' ' + f(y + h - r + c) + ' ' + f(x) + ' ' + f(y + h - r) + ' c '
        + f(x) + ' ' + f(y + r) + ' l '
        + f(x) + ' ' + f(y + r - c) + ' ' + f(x + r - c) + ' ' + f(y) + ' ' + f(x + r) + ' ' + f(y) + ' c h';
      if (lw != null) op('q ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' RG ' + lw + ' w ' + p + ' S Q');
      else op('q ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg ' + p + ' f Q');
    }
    function hline(x1, x2, y, col, lw){ op('q ' + col[0] + ' ' + col[1] + ' ' + col[2] + ' RG ' + (lw || 0.5) + ' w ' + f(x1) + ' ' + f(y) + ' m ' + f(x2) + ' ' + f(y) + ' l S Q'); }
    // Word-wrap an (encoded-space) string to lines that fit maxW; hard-breaks any
    // single token longer than the column.
    function wrap(str, maxW, size, bold){
      var s = enc(str), words = s.split(/\s+/), lines = [], line = '';
      function pushBroken(word){
        var chunk = '';
        for (var j = 0; j < word.length; j++){
          if (textWEnc(chunk + word[j], size, bold) > maxW && chunk){ lines.push(chunk); chunk = word[j]; }
          else chunk += word[j];
        }
        return chunk;
      }
      for (var i = 0; i < words.length; i++){
        var word = words[i]; if (word === '') continue;
        var test = line ? line + ' ' + word : word;
        if (textWEnc(test, size, bold) <= maxW){ line = test; continue; }
        if (line){ lines.push(line); line = ''; }
        if (textWEnc(word, size, bold) > maxW) line = pushBroken(word);
        else line = word;
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    }
    function pad10(n){ n = '' + n; while (n.length < 10) n = '0' + n; return n; }
    function save(name){
      var objs = [];
      function put(s){ objs.push(s); return objs.length; }
      var catalogN = put(''), pagesN = put('');
      var f1 = put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      var f2 = put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      var kids = [];
      pages.forEach(function (pg){
        var stream = pg.ops.join('\n');
        var contentN = put('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
        var pageN = put('<< /Type /Page /Parent ' + pagesN + ' 0 R /MediaBox [0 0 ' + PW + ' ' + PH
          + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + contentN + ' 0 R >>');
        kids.push(pageN);
      });
      objs[catalogN - 1] = '<< /Type /Catalog /Pages ' + pagesN + ' 0 R >>';
      objs[pagesN - 1] = '<< /Type /Pages /Kids [' + kids.map(function (k){ return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
      var out = '%PDF-1.4\n%âãÏÓ\n', offsets = [];
      for (var i = 0; i < objs.length; i++){ offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
      var xref = out.length;
      out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
      offsets.forEach(function (o){ out += pad10(o) + ' 00000 n \n'; });
      out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalogN + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF';
      var bytes = new Uint8Array(out.length);
      for (var b = 0; b < out.length; b++) bytes[b] = out.charCodeAt(b) & 0xff;
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function (){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    return { PW: PW, PH: PH, margin: margin, addPage: addPage, text: text, rect: rect, rectStroke: rectStroke,
             roundRect: roundRect, hline: hline, rgb: rgb, enc: enc, wrap: wrap, textW: textW, textWEnc: textWEnc, save: save };
  }

  // Render a results table (auto-fit columns, wrapping, page breaks). Returns the y
  // cursor after the last row. Wrappable = left-aligned columns; numeric (right-
  // aligned) columns keep to a single line.
  function pdfTable(doc, cols, rows, x, availW, startY, opts){
    if (!cols.length) return startY;
    opts = opts || {};
    var C = { ink: doc.rgb('#39424f'), head: doc.rgb('#5b6675'), headBg: doc.rgb('#eef1f5'),
              rule: doc.rgb('#c9d0da'), soft: doc.rgb('#eaedf2'), grid: doc.rgb('#e3e7ee'),
              pillEdge: doc.rgb('#8792a3'), pillEmptyEdge: doc.rgb('#dfe4ec') };
    var grid = !!opts.grid;
    var pad = 6, hF = 7.5, dF = 8.5, lineH = 11, vpad = 4, n = cols.length;
    // right- and centre-aligned columns hold single-line values; only left cols wrap
    var wrapCol = cols.map(function (c){ return c.align !== 'right' && c.align !== 'center'; });
    var colW, i;
    // When every column carries a `w` weight (the on-screen pixel width), size the PDF
    // columns to the SAME proportions as the screen - scaled to the page's usable width.
    if (cols.every(function (c){ return typeof c.w === 'number' && c.w > 0; })){
      var sumW = cols.reduce(function (a, c){ return a + c.w; }, 0);
      colW = cols.map(function (c){ return availW * c.w / sumW; });
    } else {
      var nat = cols.map(function (c, ci){
        var w = doc.textW(c.t, hF, true);
        for (var r = 0; r < rows.length; r++){ var cell = rows[r][ci]; if (cell) w = Math.max(w, doc.textW(cell.t, dF, false) + (cell.dot ? 10 : 0)); }
        return Math.min(w + pad * 2, 230);
      });
      var total = nat.reduce(function (a, b){ return a + b; }, 0); colW = nat.slice();
      if (total > availW){
        var fixed = 0, wrapNat = 0, wc = 0;
        for (i = 0; i < n; i++){ if (wrapCol[i]){ wrapNat += nat[i]; wc++; } else fixed += nat[i]; }
        var avail = Math.max(availW - fixed, wc * 46);
        for (i = 0; i < n; i++) if (wrapCol[i]) colW[i] = Math.max(46, nat[i] / (wrapNat || 1) * avail);
      } else {
        var extra = availW - total, wcount = wrapCol.filter(Boolean).length;
        for (i = 0; i < n; i++) if (wrapCol[i]) colW[i] += extra / (wcount || n);
        if (!wcount) colW[n - 1] += extra;
      }
    }
    var xs = [x]; for (i = 1; i < n; i++) xs[i] = xs[i - 1] + colW[i - 1];
    // uniform pill width: sized to the single widest number carried in any pill, but
    // capped to the narrowest pill-bearing column so pills never overflow their cell.
    var pillTextW = 0, minPillColW = Infinity;
    for (i = 0; i < n; i++){
      var hasPill = false;
      for (var rr = 0; rr < rows.length; rr++){ var cc = rows[rr][i]; if (cc && (cc.pill || cc.pillHollow || cc.pillEmpty)){ hasPill = true; if (cc.t) pillTextW = Math.max(pillTextW, doc.textWEnc(doc.enc(cc.t), dF, true)); } }
      if (hasPill) minPillColW = Math.min(minPillColW, colW[i]);
    }
    var pillW = pillTextW + 12;
    if (minPillColW !== Infinity) pillW = Math.min(pillW, minPillColW - 3);
    var y = startY;
    function xAlign(i, tw){
      var a = cols[i].align;
      if (a === 'right') return xs[i] + colW[i] - pad - tw;
      if (a === 'center') return xs[i] + (colW[i] - tw) / 2;
      return xs[i] + pad;
    }
    function header(){
      if (!grid) doc.rect(x, y - 15, availW, 15, C.headBg);   // gridded tables use a white header, like on screen
      for (var i = 0; i < n; i++){
        doc.text(cols[i].t, xAlign(i, doc.textW(cols[i].t, hF, true)), y - 10.5, { size: hF, bold: true, color: C.head });
        if (grid) doc.rectStroke(xs[i], y - 15, colW[i], 15, C.grid, 0.5);
      }
      y -= 15; if (!grid) doc.hline(x, x + availW, y, C.rule, 0.8);
    }
    header();
    if (!rows.length){ doc.text('No rows.', x + pad, y - 11, { size: dF, color: doc.rgb('#8792a3') }); return y - 16; }
    rows.forEach(function (row){
      var cellLines = [], maxLines = 1;
      for (var i = 0; i < n; i++){
        var cell = row[i] || { t: '' };
        var lines = wrapCol[i] ? doc.wrap(cell.t, colW[i] - pad * 2 - (cell.dot ? 10 : 0), dF, false) : [doc.enc(cell.t)];
        cellLines.push(lines); if (lines.length > maxLines) maxLines = lines.length;
      }
      var rowH = vpad * 2 + maxLines * lineH;
      if (y - rowH < doc.margin){ doc.addPage(); y = doc.PH - doc.margin; header(); }
      for (i = 0; i < n; i++){
        var cell = row[i] || { t: '' }, lines = cellLines[i];
        var col = cell.color ? doc.rgb(cell.color) : C.ink, bold = !!cell.color;
        var indent = (cell.dot ? 10 : 0);
        // filled / hollow / empty pill: a uniform-width rounded badge (stadium shape)
        // holding the centred number - mirrors the on-screen pills.
        if (cell.pill || cell.pillHollow || cell.pillEmpty){
          var ph = dF + 5.5, pw = Math.max(pillW, ph + 2);
          var px = xs[i] + (colW[i] - pw) / 2, py = (y - vpad - dF) + dF * 0.34 - ph / 2;
          if (cell.pill) doc.roundRect(px, py, pw, ph, ph / 2, doc.rgb(cell.pill));
          else doc.roundRect(px, py, pw, ph, ph / 2, cell.pillEmpty ? C.pillEmptyEdge : C.pillEdge, 0.7);
        }
        if (cell.dot) doc.rect(xs[i] + pad, y - vpad - dF + 1, 6, 6, doc.rgb(cell.dot));
        // pill (number) cells render one point smaller than the body text; pill geometry
        // above stays keyed to dF so only the digits shrink, mirroring the on-screen table.
        var tF = (cell.pill || cell.pillHollow || cell.pillEmpty) ? dF - 1 : dF;
        for (var li = 0; li < lines.length; li++){
          var ln = lines[li], by = y - vpad - dF - li * lineH;
          var tw = doc.textWEnc(ln, tF, bold);
          var tx = cols[i].align === 'center' ? xs[i] + (colW[i] - tw) / 2
                 : cols[i].align === 'right' ? xs[i] + colW[i] - pad - tw
                 : xs[i] + pad + indent;
          doc.text(ln, tx, by, { size: tF, bold: bold, color: col });
        }
        if (grid) doc.rectStroke(xs[i], y - rowH, colW[i], rowH, C.grid, 0.5);
      }
      y -= rowH; if (!grid) doc.hline(x, x + availW, y, C.soft, 0.4);
    });
    return y;
  }

  /** Draw the active-filter strip into the PDF: a tinted panel of "LABEL value"
   *  lines, wrapped to the page. Mirrors filterStripHTML. Returns the y cursor
   *  below it, unchanged when nothing is filtered. */
  function pdfFilterStrip(doc, filters, M, AW, y){
    if (!filters || !filters.length) return y;
    var padX = 9, padY = 7, lineH = 11, labelF = 6.5, valF = 8;
    // measure first: every group's value text wrapped to the panel width
    var lines = [];
    filters.forEach(function (g){
      var lbl = (g.label || '').toUpperCase();
      var lw = doc.textW(lbl, labelF, true) + 8;
      var vw = AW - padX * 2 - lw;
      var wrapped = doc.wrap(g.values.join(', '), vw, valF, false);
      wrapped.forEach(function (t, i){ lines.push({ label: i === 0 ? lbl : '', lw: lw, text: t }); });
    });
    var capH = 12;
    var boxH = padY * 2 + capH + lines.length * lineH;
    doc.rect(M, y - boxH, AW, boxH, doc.rgb('#f4f6f9'));
    doc.rect(M, y - boxH, 2.5, boxH, doc.rgb('#0c447c'));       // accent rule, as on screen
    // Caption: without it the panel reads as page furniture rather than as the
    // statement that these numbers are a slice.
    doc.text('FILTERED BY', M + padX, y - padY - 7, { size: labelF, bold: true, color: doc.rgb('#0c447c') });
    var ly = y - padY - 8 - capH;
    lines.forEach(function (ln){
      if (ln.label) doc.text(ln.label, M + padX, ly, { size: labelF, bold: true, color: doc.rgb('#8792a3') });
      doc.text(ln.text, M + padX + ln.lw, ly, { size: valF, color: doc.rgb('#1a2230') });
      ly -= lineH;
    });
    return y - boxH - 12;
  }

  function pdfFileName(p){
    var base = (p.title || 'results').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    return 'grassroots-' + (base || 'results') + '-' + TODAY.toISOString().slice(0, 10) + '.pdf';
  }

  // Build and download the PDF for the results box currently on screen.
  function exportResultsPDF(p){
    if (!p){ alert('Open a results box first, then export.'); return; }
    // Activities + beneficiaries (p.grid) carry many columns - export those landscape.
    var doc = pdfWriter({ landscape: !!p.grid }), PW = doc.PW, M = doc.margin, AW = PW - 2 * M;
    doc.addPage();
    var y = doc.PH - M;
    var INK = doc.rgb('#1a2230'), MUT = doc.rgb('#8792a3'), SUB = doc.rgb('#5b6675');

    // running header
    doc.text('THE GRASSROOTS', M, y - 9, { size: 9, bold: true, color: doc.rgb('#0c447c') });
    var rt = 'Results export · ' + TODAY.toISOString().slice(0, 10);
    doc.text(rt, PW - M - doc.textW(rt, 8.5, false), y - 9, { size: 8.5, color: MUT });
    y -= 15; doc.hline(M, PW - M, y, doc.rgb('#d9dee6'), 0.7); y -= 16;

    // active development plan - stamped on every export
    var _ap = activePlan();
    if (_ap){
      var planLine = 'PLAN · ' + _ap.name + (planPeriod(_ap) ? '    ' + planPeriod(_ap) : '');
      doc.text(planLine, M, y - 8, { size: 8.5, bold: true, color: doc.rgb('#0c447c') });
      y -= 16;
    }
    y -= 6;

    // badge + title
    var badge = (p.badge || '').toUpperCase();
    if (badge){
      var bw = doc.textW(badge, 8, true) + 16;
      doc.rect(M, y - 12, bw, 16, doc.rgb(p.badgeColor || '#7c8aa5'));
      doc.text(badge, M + 8, y - 8, { size: 8, bold: true, color: [1, 1, 1] });
      doc.text(p.title || '', M + bw + 10, y - 8, { size: 14, bold: true, color: INK });
    } else {
      doc.text(p.title || '', M, y - 8, { size: 14, bold: true, color: INK });
    }
    y -= 22;
    if (p.sub){ doc.text(p.sub, M, y - 8, { size: 9.5, color: SUB }); y -= 13; }
    if (p.summary){ doc.text('↳ ' + p.summary, M, y - 8, { size: 9.5, color: MUT }); y -= 14; }
    y -= 8;

    // Active filters - the on-screen strip, redrawn. A printed export outlives the
    // screen it came from, so without this the reader cannot tell whether "7
    // projects" is the whole portfolio or one country's slice of it.
    y = pdfFilterStrip(doc, p.filters, M, AW, y);

    // stat cards
    if (p.stats && p.stats.length){
      var nS = p.stats.length, gap = 8, cardW = (AW - gap * (nS - 1)) / nS, cardH = 48;
      for (var i = 0; i < nS; i++){
        var sx = M + i * (cardW + gap), st = p.stats[i];
        doc.rect(sx, y - cardH, cardW, cardH, doc.rgb('#f4f6f9'));
        doc.text((st.label || '').toUpperCase(), sx + 8, y - 14, { size: 7, bold: true, color: MUT });
        doc.text(st.value || '', sx + 8, y - 31, { size: 13, bold: true, color: INK });
        if (st.sub){
          if (st.color){
            var chW = doc.textW(st.sub, 6.5, true) + 11;
            doc.rect(sx + 8, y - 44, Math.min(chW, cardW - 16), 12, doc.rgb(st.color));
            doc.text(st.sub, sx + 13.5, y - 41, { size: 6.5, bold: true, color: [1, 1, 1] });
          } else {
            doc.text(st.sub, sx + 8, y - 41, { size: 7.5, color: MUT });
          }
        }
      }
      y -= cardH + 18;
    }

    if (p.section){ doc.text(p.section.toUpperCase(), M, y - 9, { size: 8.5, bold: true, color: SUB }); y -= 15; }
    y = pdfTable(doc, p.columns || [], p.rows || [], M, AW, y, { grid: !!p.grid });
    if (p.note){ y -= 6; doc.text(p.note, M, y - 8, { size: 8, color: MUT }); }

    // optional second table (e.g. the beneficiaries heat-map) - always gridded
    if (p.table2 && p.table2.columns && p.table2.rows && p.table2.rows.length){
      y -= 22;
      if (y < M + 90){ doc.addPage(); y = doc.PH - M; }
      doc.text(p.table2.section.toUpperCase(), M, y - 9, { size: 8.5, bold: true, color: SUB }); y -= 15;
      y = pdfTable(doc, p.table2.columns, p.table2.rows, M, AW, y, { grid: true });
    }

    doc.save(pdfFileName(p));
  }

})();
