/* =============================================================================
 * app.js - RBM / M&E Monitor UI (zero dependencies, vanilla JS).
 * ========================================================================== */
(function () {
  'use strict';

  // ---- constants -----------------------------------------------------------
  // Single source of truth for the app version. The version advances by ONE every
  // WORKING DAY (Mon-Fri): the patch (Z) climbs 1..99, then rolls into the minor
  // (Y) which climbs 0..99, then into the major (X). It is a base-100 count of
  // working days since the project's first working day (Thu 2026-07-16 = 0.0.1),
  // read off the real wall clock (NOT the demo clock, which can jump ahead of the
  // calendar), so any running install re-derives the current version on each load.
  var VERSION_EPOCH = Date.UTC(2026, 6, 16);   // Thu 2026-07-16 = working day #1 = 0.0.1
  function workingDaysSinceEpoch(){
    var now = new Date();
    var today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
    if (today < VERSION_EPOCH) return 1;       // before launch: pin to 0.0.1
    var n = 0;
    for (var t = VERSION_EPOCH; t <= today; t += 86400000){
      var dow = new Date(t).getUTCDay();        // 0=Sun .. 6=Sat
      if (dow >= 1 && dow <= 5) n++;            // count weekdays only; weekends hold
    }
    return n < 1 ? 1 : n;
  }
  // Encode the working-day count base-100: 1 -> 0.0.1, 99 -> 0.0.99, 100 -> 0.1.0,
  // 199 -> 0.1.99, 200 -> 0.2.0, 10000 -> 1.0.0.
  function computeAppVersion(){
    var v = workingDaysSinceEpoch();
    var z = v % 100;
    var y = Math.floor(v / 100) % 100;
    var x = Math.floor(v / 10000);
    return x + '.' + y + '.' + z;
  }
  var APP_VERSION = computeAppVersion();        // e.g. 0.0.2 on Sat 2026-07-18
  /** True on the public GitHub Pages demo (thegrassroots.github.io). Real email
   *  delivery is disabled there - the send button is shown but inert - so the
   *  hosted demo can never fire mail. Runs normally on localhost / self-hosted. */
  function isPublicDemo(){
    try { return /(^|\.)github\.io$/i.test(location.hostname); }
    catch (e) { return false; }
  }
  /** "Now" for every derived stat (status, forecast, ranges, report stamps).
   *  Anchored to UTC midnight of the local calendar day, because measurement
   *  dates are date-only ISO strings that parse as UTC midnight. Follows the
   *  wall clock; when the seeded data runs AHEAD of the clock (a freshly
   *  generated demo), it follows the data's newest day instead so the demo
   *  reads as live. Re-derived at the top of every enrich(), so it tracks
   *  reseeds and future-dated entries without a reload. */
  function deriveToday(){
    var d = new Date();
    var t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    var latest = null;
    var ms = (window.DB && DB.tables && DB.tables.measurement) || [];
    ms.forEach(function (m){ if (m.date && (!latest || m.date > latest)) latest = m.date; });
    if (latest){ var lt = new Date(latest); if (lt > t) t = lt; }
    return t;
  }
  var TODAY = deriveToday();
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
        // a pillar beyond the base four with no stored colour still gets a
        // deterministic identity (same formula the pillar editor uses), so a
        // plan may carry any number of pillars without collapsing to grey
        if (!PILLAR_COLORS[r.sdg]) PILLAR_COLORS[r.sdg] = NEW_PILLAR_PALETTE[(r.sdg - 1) % NEW_PILLAR_PALETTE.length];
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
  /** Fallback KPI window when a KPI carries no explicit baseline/target dates:
   *  its OWN plan's window, else the active plan's, else a 3-year window from
   *  this year. Replaces the hard-coded 2025/2027 horizon, so KPIs created
   *  under any plan derive sensible dates from that plan. */
  function kpiWindowYears(ind){
    var p = planById(indicatorPlanId(ind || {})) || activePlan();
    var sy = (ind && ind.baseline_year)
      || (p && p.start_date ? +String(p.start_date).slice(0, 4) : TODAY.getUTCFullYear());
    var ey = (ind && ind.target_year)
      || (p && p.end_date ? +String(p.end_date).slice(0, 4) : sy + 2);
    if (!(ey >= sy)) ey = sy + 2;
    return { start: sy, end: ey };
  }
  /** Default dates for NEW KPIs: the active plan's own window (falls back to
   *  Jan 1 this year → Dec 31 of the derived end year). */
  function defaultBaselineDate(){
    var p = activePlan();
    return p && p.start_date ? String(p.start_date).slice(0, 10) : (kpiWindowYears(null).start + '-01-01');
  }
  function defaultTargetDate(){
    var p = activePlan();
    return p && p.end_date ? String(p.end_date).slice(0, 10) : (kpiWindowYears(null).end + '-12-31');
  }
  var STATUS = {
    blue:{c:'#2563eb', label:'Over Track'},
    green:{c:'#16a34a', label:'On Track'},
    amber:{c:'#f59e0b', label:'At Risk'},
    red:{c:'#ef4444', label:'Off Track'},
    maroon:{c:'#9f1239', label:'Under Track'},
    black:{c:'#450a0a', label:'Back Track'},
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
  /** Region names for ordering, dropdowns and grouping: every row of the
   *  `region` table (regions are admin-editable in Global Items), classic six
   *  first in their canonical order, any additions after them alphabetically.
   *  Falls back to the static six before the DB hydrates. */
  function regionNames(){
    var db = (window.DB && DB.tables && DB.tables.region) || [];
    var names = db.map(function (r){ return r.name; }).filter(Boolean);
    if (!names.length) return REGION_ORDER.slice();
    var six = REGION_ORDER.filter(function (n){ return names.indexOf(n) >= 0; });
    var extra = names.filter(function (n){ return REGION_ORDER.indexOf(n) < 0; }).sort();
    return six.concat(extra);
  }
  // Known regions keep their identity colour; admin-added ones derive a stable
  // palette colour from their name instead of collapsing to grey.
  function regionColor(region){
    var m = REGION_META[region];
    return (m && m.color) || (region ? catColor(region) : '#94a3b8');
  }
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
  // People carry two orthogonal fields: an Affiliation (the category they belong
  // to - Plans / Impact / Outcome / Output / Projects / Donors / Regions /
  // Countries; stored as user.affiliation_id into the `affiliation` table) and a
  // Status (their permission: Admin / User / Viewer). Lead dropdowns filter to
  // the matching affiliation (a Donor Lead comes from Donor-affiliated users).
  // Countries-affiliated users act as a country office (region/country scoped);
  // everyone else sits centrally - `userSection` derives that legacy hq/co split.
  var STATUS_LABEL  = { admin:'Admin', user:'User', viewer:'Viewer' };
  function affiliationOf(u){ return u && u.affiliation_id != null ? (DB._idx.affiliationById[+u.affiliation_id] || null) : null; }
  function affByKey(key){ var m = null; DB.tables.affiliation.forEach(function (a){ if (a.key === key) m = a; }); return m; }
  // legacy rows persisted before affiliations carried section hq/co - fall back
  function userAffKey(u){ var a = affiliationOf(u); if (a) return a.key; return u && u.section === 'co' ? 'country' : null; }
  function userAffName(u){ var a = affiliationOf(u); if (a) return a.name; return u && u.section === 'co' ? 'Countries' : '–'; }
  function userSection(u){ return u ? (userAffKey(u) === 'country' ? 'co' : 'hq') : null; }
  // ---- reference lookups ---------------------------------------------------
  // Every fixed form list lives in a DB table ({id, key, name, seq}); rows are
  // selected and SAVED BY ID, never by text. `key` is the stable code the app's
  // logic switches on; `name` is the display label. The legacy text argument
  // keeps rows persisted before the migration readable.
  function lkRow(table, id){ return id != null ? ((DB._idx.lookup || {})[table] || {})[+id] : null; }
  function lkKey(table, id, legacy){ var r = lkRow(table, id); return r ? r.key : (legacy != null && legacy !== '' ? legacy : null); }
  function lkName(table, id, legacy){ var r = lkRow(table, id); if (r) return r.name; if (legacy == null || legacy === '') return ''; var byKey = lkByKey(table, legacy); return byKey ? byKey.name : String(legacy); }
  function lkByKey(table, key){ var hit = null; (DB.tables[table] || []).forEach(function (r){ if (r.key === key) hit = r; }); return hit; }
  function lkIdByKey(table, key){ var r = lkByKey(table, key); return r ? r.id : null; }
  /** <option> list for a lookup table; value = the row's id. `curId` wins; a
   *  legacy text value selects its matching row instead of being dropped. */
  function lookupOptions(table, curId, legacy){
    var rows = (DB.tables[table] || []).slice().sort(function (a, b){ return (a.seq || 0) - (b.seq || 0); });
    var cur = curId != null ? +curId : (legacy ? lkIdByKey(table, legacy) : null);
    return rows.map(function (r){ return '<option value="' + r.id + '"' + (r.id === cur ? ' selected' : '') + '>' + esc(r.name) + '</option>'; }).join('');
  }
  // raw-row field accessors (all return the stable KEY; *Name variants the label)
  function kpiUnit(ind){ return lkKey('unit', ind.unit_id, ind.unit); }
  function kpiType(ind){ return lkKey('kpi_type', ind.type_id, ind.type); }
  function kpiDirection(ind){ return lkKey('direction', ind.direction_id, ind.direction); }
  function kpiFrequency(ind){ return lkName('frequency', ind.frequency_id, ind.frequency); }
  function kpiMethod(ind){ return lkName('collection_method', ind.collection_method_id, ind.collection_method); }
  function kpiDisagg(ind){ return lkName('disaggregation', ind.disaggregation_id, ind.disaggregation); }
  function donorType(d){ return d ? lkName('donor_type', d.type_id, d.type) : ''; }
  function userStatus(u){ return u ? (lkKey('user_status', u.status_id, u.status) || 'user') : null; }
  // The countries a user Leads (country.lead_id) - this IS a Countries-affiliated
  // user's scope. The per-user Region/Country profile fields are gone: scope
  // follows the Lead assignments in Global Items → Countries, one source of truth.
  function userCountryIsos(u){ return u ? (DB._idx.countryIsosByLead[u.id] || []) : []; }
  // One base colour per affiliation group (Plans … Countries). The "Logged by"
  // group header wears the base and each member wears a deterministic shade of
  // it (same shadeByKey device as the KPI facet), so groups AND users both keep
  // a stable colour identity. An affiliation beyond the known eight still gets
  // a deterministic palette colour instead of collapsing to grey.
  var AFF_COLORS = { plan:'#9D7BEE', impact:'#EC7BA6', outcome:'#2CC4A0', output:'#F2934A',
                     project:'#5399EA', donor:'#E0A93B', partner:'#5B8DEF', region:'#6FBF73', country:'#8FA3C4' };
  function affColor(key){
    return AFF_COLORS[key] || NEW_PILLAR_PALETTE[hashKey(key || '') % NEW_PILLAR_PALETTE.length];
  }
  // Per-user shade of a base colour, keyed by id so the identity survives a
  // rename. Sequential ids hash to adjacent values (hashKey walks the decimal
  // digits), which would give near-identical shades - scramble with a Knuth
  // multiplicative constant first so neighbouring ids land far apart.
  function userShade(base, u, spread){ return shadeByKey(base, (u.id * 2654435761) >>> 0, spread); }
  // colour identity for a user row (Admin keeps its accent as the shade base; a
  // Countries-affiliated user inherits the colour of the country they Lead;
  // everyone else shades their affiliation's base colour)
  function userColor(u){
    if (!u) return '#aab6c8';
    if (userStatus(u) === 'admin') return userShade('#5B8DEF', u, 0.3);
    if (userSection(u) === 'hq') return userShade(affColor(userAffKey(u)), u, 0.4);
    var isos = userCountryIsos(u);
    return isos.length ? countryColor(isos[0]) : userShade(affColor('country'), u, 0.4);
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
  // el() sets textContent, so markup handed to it renders as literal "<b>" on
  // screen. elHTML() is the deliberate exception for the handful of help notes
  // that need emphasis. Callers MUST esc() anything interpolated into `html`.
  var elHTML = function (tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
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
    selStatus: new Set(),   // performance status: blue|green|amber|red|maroon|black|nodata
    selType: new Set(),     // KPI type: quantitative|qualitative
    selDonor: new Set(),    // donor ids (project funding partner)
    selPartner: new Set(),  // partner ids (implementing partner)
    selProject: new Set(),  // project ids (specific projects)
    selBenType: new Set(),  // beneficiary type ids (Project Beneficiaries filter)
    projectShown: 10,       // Projects filter reveal count (More/Less)
    donorShown: 10,         // Donors filter reveal count (More/Less)
    partnerShown: 10,       // Partners filter reveal count (More/Less)
    progShown: {},          // per-region reveal count for the Programme Portfolio country sublists
    selCountry: null,       // iso3 (map click)
    qList: '', qProg: '', qSdg: '', qKpi: '', qUser: '', qDonor: '', qPartner: '', qProject: '',
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
    expandUserRole: new Set(['country']),
    // left-sidebar filter groups: display order + which are collapsed (drag-and-drop)
    facetOrder: null,        // array of group keys; null = use FACET_ORDER_DEFAULT
    facetCollapsed: {},      // { groupKey: true } for collapsed groups
    // insights dashboard config
    insX: 'sdg', insTopX: 5, insY: 'region', insTopY: 10, insMode: 'bar',
    // forecast dashboard config (fcSel is transient - reset when the dimension changes)
    fcDim: 'plans',      // plans | outcomes | outputs | projects | countries
    fcHorizon: 'plan',   // plan (end of plan) | 6m | 12m | 24m
    fcSel: null,         // selected entity key ('' / null = whole portfolio)
    // timeline (Gantt) config - groups by the SAME dimensions as the Forecast tab
    tlDim: 'donors',     // plans | impacts | outcomes | outputs | projects | donors | partners | regions | countries
    tlActs: true,        // overlay logged-activity ticks on each project bar
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
    if (kpiUnit(ind) === 'count') {
      var sum = 0; ms.forEach(function (m) { sum += (+m.value || 0); });
      return (+ind.baseline_value || 0) + sum;
    }
    return ms[ms.length - 1].value;
  }
  // RAG thresholds on progress = (value − baseline) / (target − baseline), so 0% is the
  // baseline and 100% is the target. Below baseline (negative) is a regression.
  //   Over Track > 100% · On Track 90–100% · At Risk 75–90% · Off Track 50–75% ·
  //   Under Track 0–50% (a KPI with no report yet counts as 0%) · Back Track < 0%
  //   (below baseline) · No Data = genuinely unmeasurable (no baseline/target).
  function ratioToCode(ratio) {
    if (ratio == null || isNaN(ratio)) return 'nodata';
    if (ratio > 1) return 'blue';        // Over Track  (>100%)
    if (ratio < 0) return 'black';       // Back Track  (<0%, regressed below baseline)
    if (ratio >= 0.90) return 'green';   // On Track    (90–100%)
    if (ratio >= 0.75) return 'amber';   // At Risk     (75–90%)
    if (ratio >= 0.50) return 'red';     // Off Track   (50–75%)
    return 'maroon';                      // Under Track (0–50%)
  }

  /** Fraction of the KPI's timeframe elapsed by `asOf` (default TODAY; day
   *  granularity, so the monthly reporting cadence is respected): from 1 Jan of the
   *  baseline year to 31 Dec of the target year. e.g. a 12-month KPI at end-June ≈ 0.5. */
  function elapsedFraction(ind, asOf) {
    var when = asOf != null ? new Date(asOf) : TODAY;
    // prefer the exact baseline/target dates; fall back to the KPI's plan window
    var yrs = kpiWindowYears(ind);
    var start = ind.baseline_date ? new Date(ind.baseline_date) : new Date(yrs.start, 0, 1);
    var end = ind.target_date ? new Date(ind.target_date) : new Date(yrs.end, 11, 31);
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
    // No baseline/target, or a zero gap in any form, is genuinely unmeasurable - No Data.
    if (b == null || t == null || +t === +b) return {
      progress: null, performance: null, progressCode: 'nodata', perfCode: 'nodata',
      code: 'nodata', frac: null, perf: null, latest: latest, series: ms };
    // No report yet counts as 0% progress (nothing achieved above the baseline) ->
    // Under Track, so an unreported KPI is included in averages/rollups as 0, not
    // silently dropped. The value stays null (we don't invent a measurement).
    if (!latest) return {
      progress: 0, performance: 0, progressCode: ratioToCode(0), perfCode: ratioToCode(0),
      code: ratioToCode(0), frac: 0, perf: 0, value: null, latest: null, series: ms };
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
    TODAY = deriveToday();   // track the clock AND any future-dated data/reseed
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
        id: ind.id, raw: ind, name: ind.name, unit: kpiUnit(ind), type: kpiType(ind),
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
      var dset = {}, ptset = {};
      pids.forEach(function (pid) {
        var p = DB._idx.projectById[pid];
        if (p && p.donor_id != null) dset[p.donor_id] = 1;
        if (p && p.partner_id != null) ptset[p.partner_id] = 1;   // implementing partners funding this KPI's projects
      });
      r.donorIds = Object.keys(dset).map(Number);
      r.partnerIds = Object.keys(ptset).map(Number);
      r.projPrimary = pids.length ? DB._idx.projectById[pids[0]] : null;
      r.donorPrimary = (r.projPrimary && r.projPrimary.donor_id != null) ? DB._idx.donorById[r.projPrimary.donor_id] : null;
      r.partnerPrimary = (r.projPrimary && r.projPrimary.partner_id != null) ? DB._idx.partnerById[r.projPrimary.partner_id] : null;
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
        partnerId: (proj && proj.partner_id != null) ? proj.partner_id : null,
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
        partner: p.partner_id != null ? DB._idx.partnerById[p.partner_id] : null,
        // delivery modality: 'partner' when an implementing partner is set, else 'direct'
        implementation: p.partner_id != null ? 'partner' : (p.implementation || 'direct'),
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

  /** Bind the RAG status onto every KPI, then re-roll it up to each ancestor
   *  result. Status is ALWAYS performance — progress cannot tell status. Progress
   *  (achievement of target) is only ever the % the bars show for visibility. */
  function applyBasis() {
    IND.forEach(function (r) {
      r.status = r.perfCode;        // status is always performance
      r.ratio = r.performance;      // the metric the RAG judges is always performance
      r.frac = r.progress;          // % bars still show achievement, for visibility only
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
    // TODAY is part of the key: relative ranges anchor to it, and it can move
    // (real clock day change, future-dated entry) without the range changing
    var key = S.range + '|' + (S.from || '') + '|' + (S.to || '') + '|' + TODAY.getTime();
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
    // A KPI with no report yet is a STANDING 0% (Under Track) status, not a dated
    // event - a time-window filter must not delete it, or it vanishes from every
    // band. Keep it in range regardless of the window.
    if (r.updated == null) return true;
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
    // donor / partner / project are project-level; a KPI passes if it belongs to a matching project
    if (skip.indexOf('donor') < 0 && S.selDonor.size &&
        !(r.donorIds || []).some(function (id) { return S.selDonor.has(id); })) return false;
    if (skip.indexOf('partner') < 0 && S.selPartner.size &&
        !(r.partnerIds || []).some(function (id) { return S.selPartner.has(id); })) return false;
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
    if (skip.indexOf('partner') < 0 && S.selPartner.size && !(a.partnerId != null && S.selPartner.has(a.partnerId))) return false;
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
    var ctrl = document.querySelector('#basemap .maplibregl-ctrl-attrib');
    if (!ctrl) return;
    ctrl.classList.remove('maplibregl-compact-show');
    if (ctrl.tagName === 'DETAILS') { ctrl.open = false; }
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
  var _STORDER = ['black','maroon','red','amber','green','blue','nodata'];
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
      l.partnerId = domFreq(l.projList, function (p) { return p.partner ? p.partner.id : null; });
      if (l.partnerId != null) l.partnerId = +l.partnerId;
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
    if (S.colorMode === 'partner') {
      var pid = domFreq(c.locs, function (l) { return l.partnerId; });
      var pt = pid != null ? DB._idx.partnerById[+pid] : null;
      return pt && pt.color ? pt.color : '#94a3b8';
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
      regionNames().forEach(function (rg) { if (rc[rg]) box.appendChild(legRow(regionColor(rg), regionFull(rg), rc[rg], true)); });
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
    if (S.colorMode === 'partner') {
      $('#colorNote').textContent = 'partner';
      var pcnt = {}, pref = {};
      locs.forEach(function (l) {
        var d = l.partnerId != null ? DB._idx.partnerById[l.partnerId] : null;
        var key = d ? d.id : 0; pcnt[key] = (pcnt[key] || 0) + 1; if (d) pref[key] = d;
      });
      var porder = Object.keys(pcnt).sort(function (a, b) { return pcnt[b] - pcnt[a]; });
      var PCAP = 10, pshown = porder.slice(0, PCAP), prest = porder.slice(PCAP);
      pshown.forEach(function (key) {
        var d = pref[key];
        var col = d && d.color ? d.color : '#94a3b8';
        var label = d ? d.name : 'Direct (no partner)';
        box.appendChild(legRow(col, label, pcnt[key], true));
      });
      if (prest.length) {
        var pother = prest.reduce(function (s, k) { return s + pcnt[k]; }, 0);
        box.appendChild(legRow('#94a3b8', 'Other partners (' + prest.length + ')', pother, true));
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
    $('#colorNote').textContent = 'project status · by Performance';
    var sc = { blue:0, green:0, amber:0, red:0, maroon:0, black:0, nodata:0 };
    locs.forEach(function (l) { sc[l.status]++; });
    ['blue','green','amber','red','maroon','black'].forEach(function (k) { box.appendChild(legRow(STATUS[k].c, STATUS[k].label, sc[k], true)); });
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
    renderPartnerFacet();
    renderProjectFacet();
    renderStatusFacet();
    renderFrameworkFacet();
    renderBenTypeFacet();
    renderKpiFacet();
    renderUserFacet();
  }

  // ---- filter-group layout: drag-to-reorder + collapse, persisted in prefs ----
  var FACET_ORDER_DEFAULT = ['prog', 'level', 'donor', 'partner', 'project', 'status', 'bentype', 'kpi', 'user'];

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

  // ---------------------------------------------------------------------------
  //  Filter-pane rule: an option that OTHER active filters cross-filter down to
  //  zero must stay VISIBLE showing "0", never disappear. The enumerated facets
  //  (status / level / region / beneficiary …) already iterate their full
  //  universe, so this holds for them. The count-sorted, paginated facets
  //  (donor / partner / project / kpi / user) would instead re-rank a zeroed
  //  option below the "＋ more" fold - so they order by a SELECTION-INDEPENDENT
  //  rank (below) and let only the displayed count vary with the other filters.
  // ---------------------------------------------------------------------------
  var ALL_FACET_SKIP = ['region','prog','nodes','sdg','kpi','user','status','type','donor','partner','project','bentype','country'];
  /** Count projects per key across the active plan, ignoring every facet
   *  selection (PROJECTS is already plan-scoped) - a stable ordering key. */
  function projRankCounts(keyOf) {
    var m = {}; PROJECTS.forEach(function (p) { var k = keyOf(p); if (k != null) m[k] = (m[k] || 0) + 1; }); return m;
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
    // order by a selection-independent rank so cross-filtering only zeroes a
    // row's count, never re-ranks it out of the reveal window (filter-pane rule).
    var rank = isActs() ? actCountsBy(ALL_FACET_SKIP, function (a) { return a.donorId != null ? a.donorId : 0; })
                        : projRankCounts(function (p) { return p.donor ? p.donor.id : 0; });
    var all = DB.tables.donor.slice()
      .filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0 || (d.short_name || '').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (rank[b.id] || 0) - (rank[a.id] || 0) || (a.name < b.name ? -1 : 1); });
    var total = all.length, win = q ? total : Math.min(S.donorShown, total);
    var shown = all.slice(0, win);
    all.forEach(function (d) { if (S.selDonor.has(d.id) && shown.indexOf(d) < 0) shown.push(d); });   // keep selected visible
    shown.forEach(function (d) {
      var col = d.color || '#7c8aa5';
      host.appendChild(facetRow({
        checkbox: true, checked: S.selDonor.has(d.id), color: col,
        name: d.name, title: donorType(d) + ' donor', count: counts[d.id] || 0,
        barPct: (counts[d.id] || 0) / maxN, barColor: col, selected: S.selDonor.has(d.id),
        onCheck: function () { toggle(S.selDonor, d.id); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('donor', d.id); }
      }));
    });
    if (!q) facetMoreLess(host, win, total,
      function () { return S.donorShown; }, function (v) { S.donorShown = v; }, renderDonorFacet);
  }

  /** PARTNERS facet - one row per implementing partner (the NGO delivering a
   *  project on the ground), counting the projects it implements under the other
   *  active filters. Selecting partners narrows the project list. Projects with no
   *  partner (delivered directly) fall under id 0 and are not listed here. */
  function renderPartnerFacet() {
    var host = $('#facetPartner'); if (!host) return; host.innerHTML = '';
    var q = (S.qPartner || '').toLowerCase(), progIso = progIsoSet();
    var counts;
    if (isActs()) {
      counts = actCountsBy(['partner'], function (a) { return a.partnerId != null ? a.partnerId : 0; });
    } else {
      counts = {};
      PROJECTS.forEach(function (p) {
        if (!projectPassesFacets(p, false, progIso, false, false, true)) return;   // ignore partner selection for counts
        var id = p.partner ? p.partner.id : 0;
        counts[id] = (counts[id] || 0) + 1;
      });
    }
    var maxN = 1; Object.keys(counts).forEach(function (k) { if (+k && counts[k] > maxN) maxN = counts[k]; });
    var rank = isActs() ? actCountsBy(ALL_FACET_SKIP, function (a) { return a.partnerId != null ? a.partnerId : 0; })
                        : projRankCounts(function (p) { return p.partner ? p.partner.id : 0; });
    var all = DB.tables.partner.slice()
      .filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) >= 0 || (d.acronym || '').toLowerCase().indexOf(q) >= 0; })
      .sort(function (a, b) { return (rank[b.id] || 0) - (rank[a.id] || 0) || (a.name < b.name ? -1 : 1); });
    var total = all.length, win = q ? total : Math.min(S.partnerShown, total);
    var shown = all.slice(0, win);
    all.forEach(function (d) { if (S.selPartner.has(d.id) && shown.indexOf(d) < 0) shown.push(d); });   // keep selected visible
    shown.forEach(function (d) {
      var col = d.color || '#7c8aa5';
      host.appendChild(facetRow({
        checkbox: true, checked: S.selPartner.has(d.id), color: col,
        name: d.name, title: (d.acronym ? d.acronym + ' · ' : '') + 'implementing partner', count: counts[d.id] || 0,
        barPct: (counts[d.id] || 0) / maxN, barColor: col, selected: S.selPartner.has(d.id),
        onCheck: function () { toggle(S.selPartner, d.id); S.page = 0; renderAll(); },
        onOpen: function () { openEntitySummary('partner', d.id); }
      }));
    });
    if (!q) facetMoreLess(host, win, total,
      function () { return S.partnerShown; }, function (v) { S.partnerShown = v; }, renderPartnerFacet);
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
    var counts = acts ? actCountsBy(['project'], function (a) { return a.pid; }) : null;   // activities per project (cross-filtered)
    var rank = acts ? actCountsBy(ALL_FACET_SKIP, function (a) { return a.pid; }) : null;   // selection-independent order
    // Full plan universe (only search narrows). A project the OTHER facets filter
    // out is kept and shown with a 0 count, never hidden (filter-pane rule); its
    // own selection is skipped so checking projects doesn't zero its siblings.
    var pass = {}; PROJECTS.forEach(function (p) { pass[p.id] = projectPassesFacets(p, false, progIso, true); });
    var all = PROJECTS.filter(function (p) {
      if (!q) return true;
      var co = p.country ? p.country.name : '';
      return ((p.code || '') + ' ' + p.name + ' ' + (p.donor ? p.donor.name : '') + ' ' + co).toLowerCase().indexOf(q) >= 0;
    });
    if (acts) all.sort(function (a, b) { return (rank[b.id] || 0) - (rank[a.id] || 0) || ((a.name || '') < (b.name || '') ? -1 : 1); });
    else all.sort(function (a, b) { var an = (a.name || '').toLowerCase(), bn = (b.name || '').toLowerCase(); return an < bn ? -1 : (an > bn ? 1 : 0); });
    var maxN = 1; if (acts) all.forEach(function (p) { if (pass[p.id] && (counts[p.id] || 0) > maxN) maxN = counts[p.id] || 0; });
    var total = all.length, win = q ? total : Math.min(S.projectShown, total);
    var shown = all.slice(0, win);
    PROJECTS.forEach(function (p) { if (S.selProject.has(p.id) && shown.indexOf(p) < 0) shown.push(p); });   // keep selected visible
    shown.forEach(function (p) {
      var ok = pass[p.id], col = STATUS[projStat(p).code].c;
      var n = ok ? (acts ? (counts[p.id] || 0) : 1) : 0;
      host.appendChild(facetRow({
        checkbox: true, checked: S.selProject.has(p.id), color: col,
        count: n, barPct: acts ? n / maxN : (ok ? 1 : 0), barColor: col,
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
      ['blue','green','amber','red','maroon','black'].map(function (k) { return { key: k, label: STATUS[k].label, color: STATUS[k].c }; }), 'status',
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
    var regionOrder = regionNames();
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
      if (o.indeterminate) cb.indeterminate = true;   // some-but-not-all members selected (group headers)
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
    // results summary. An expandable header with no summary expands on body-click;
    // a flat row with no summary falls back to toggling its filter.
    if (o.onOpen) { row.classList.add('openable'); row.onclick = function () { o.onOpen(); }; }
    else if (o.onExpand) row.onclick = function () { o.onExpand(); };
    else if (o.onCheck) row.onclick = function () { o.onCheck(); };
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
    // selection-independent rank (top = most reported across the plan) so cross-
    // filtering only zeroes a KPI's count, never re-ranks it out of the window.
    var rank;
    if (isActs()) {
      rank = actCountsBy(ALL_FACET_SKIP, function (a) { return a.name; });
    } else {
      var rankSets = {};
      IND.filter(function (r) { return inTimeRange(r); }).forEach(function (r) { accProjects(rankSets, r.name, r.projectIds); });
      rank = finalizeCounts(rankSets);
    }
    var names = Object.keys(pillarOf).filter(function (n) { return !q || n.toLowerCase().indexOf(q) >= 0; });
    names.sort(function (a, b) { return (rank[b] || 0) - (rank[a] || 0) || (a < b ? -1 : 1); });   // top = most reported
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

  /** Reported By - users grouped by Affiliation; selecting filters by reporter. */
  function renderUserFacet() {
    var host = $('#facetUser'); if (!host) return; host.innerHTML = '';
    // per-user count = DISTINCT projects the user reported on (or activities the
    // user logged when S.countBasis says so). In projects basis userSets is kept
    // (not just finalized) so a section header can union its members' projects.
    var acts = isActs(), userSets = {}, counts;
    if (acts) {
      counts = actCountsBy(['user'], function (a) { return a.reporterId; });
    } else {
      // mirror the click path exactly: passAll tests the KPI's all-time reporterIds
      // and inTimeRange its latest update, so the facet number = what checking the
      // user actually filters to (it previously demanded an in-window report by the
      // user, disagreeing with the filter in both directions).
      var pool = IND.filter(function (r) { return inTimeRange(r) && passAll(r, ['user']); });
      pool.forEach(function (r) {
        (r.reporterIds || []).forEach(function (id) { accProjects(userSets, id, r.projectIds); });
      });
      counts = finalizeCounts(userSets);
    }
    // selection-independent per-user rank so cross-filtering only zeroes a user's
    // count, never re-ranks them out of a group's reveal window (filter-pane rule).
    var rank;
    if (acts) {
      rank = actCountsBy(ALL_FACET_SKIP, function (a) { return a.reporterId; });
    } else {
      var rankSets = {};
      IND.filter(function (r) { return inTimeRange(r); }).forEach(function (r) { (r.reporterIds || []).forEach(function (id) { accProjects(rankSets, id, r.projectIds); }); });
      rank = finalizeCounts(rankSets);
    }
    var q = (S.qUser || '').toLowerCase();
    // one collapsible group per affiliation (Plans … Countries), in table order
    var groups = DB.tables.affiliation.slice().sort(function (a, b) { return (a.seq || 0) - (b.seq || 0); });
    // first pass: resolve each visible group's members + total, so the category
    // bars scale against the busiest group (like every other facet's mini-bars).
    var grpRows = [], maxGroupTotal = 1;
    groups.forEach(function (aff) {
      var section = aff.key;
      var us = DB.tables.user.filter(function (u) {
        if (userAffKey(u) !== section) return false;
        // zero-count users are NOT hidden - they show a value of 0 (only search narrows)
        return !q || u.name.toLowerCase().indexOf(q) >= 0 || userCountryIsos(u).join(' ').toLowerCase().indexOf(q) >= 0;
      }).sort(function (a, b) { return (rank[b.id] || 0) - (rank[a.id] || 0) || (a.name < b.name ? -1 : 1); });
      if (!us.length) return;
      // group total: activities basis sums per-user counts (each activity has ONE
      // reporter, so no double-count); projects basis unions the members' project
      // sets (a sum would double-count a project two members both reported on).
      var total;
      if (acts) { total = us.reduce(function (s, u) { return s + (counts[u.id] || 0); }, 0); }
      else {
        var stot = {};
        us.forEach(function (u) { var s = userSets[u.id]; if (s) Object.keys(s).forEach(function (pid) { stot[pid] = 1; }); });
        total = Object.keys(stot).length;
      }
      if (total > maxGroupTotal) maxGroupTotal = total;
      grpRows.push({ aff: aff, section: section, us: us, total: total });
    });
    grpRows.forEach(function (grp) {
      var aff = grp.aff, section = grp.section, us = grp.us, total = grp.total;
      var base = affColor(section);
      var open = S.expandUserRole.has(section) || !!q;
      // group header checkbox = select ALL its members at once (uses the same
      // selUser dimension as the leaf rows). Checked when every member is picked,
      // indeterminate when only some are — matching the region/pillar headers.
      var memberIds = us.map(function (u) { return u.id; });
      var selN = memberIds.filter(function (id) { return S.selUser.has(id); }).length;
      var allSel = memberIds.length > 0 && selN === memberIds.length;
      host.appendChild(facetRow({
        cat: true, expandable: true, open: open, color: base, name: aff.name, count: total,
        barPct: total / maxGroupTotal, barColor: base,
        checkbox: true, checked: allSel, indeterminate: selN > 0 && !allSel, selected: allSel,
        onCheck: function () {
          if (allSel) memberIds.forEach(function (id) { S.selUser.delete(id); });
          else memberIds.forEach(function (id) { S.selUser.add(id); });
          S.page = 0; renderAll();
        },
        onExpand: function () { toggle(S.expandUserRole, section); renderUserFacet(); persist(); }
      }));
      if (!open) return;
      var sub = el('div', 'subrow');
      var maxN = 1; us.forEach(function (u) { if ((counts[u.id] || 0) > maxN) maxN = counts[u.id] || 0; });
      // reveal window (per group) - long groups (e.g. 56 country offices) page 10 at a time
      var window = q ? us.length : Math.min(S.userShown[section] || FACET_PAGE, us.length);
      var shown = us.slice(0, window);
      us.forEach(function (u) { if (S.selUser.has(u.id) && shown.indexOf(u) < 0) shown.push(u); });   // keep selected visible
      shown.forEach(function (u) {
        var col = userColor(u), isos = userCountryIsos(u);
        sub.appendChild(facetRow({
          checkbox: true, checked: S.selUser.has(u.id), color: col,
          name: u.name + (isos.length ? ' · ' + isos.join(' ') : ''), title: u.name,
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

  /** Does a project pass the active facets? Country/region/donor/partner are
   *  matched on the project itself; KPI-level facets (framework node / impact /
   *  KPI / status / type / reporter) require the project to own at least one KPI
   *  that passes. */
  function projectPassesFacets(p, skipDonor, progIso, skipProject, skipBenType, skipPartner) {
    if (S.selRegion.size && !S.selRegion.has(p.region)) return false;
    if (S.selCountry && p.iso !== S.selCountry) return false;
    if (S.selProg.size && !(progIso || progIsoSet())[p.iso]) return false;
    if (!skipDonor && S.selDonor.size && !(p.donor && S.selDonor.has(p.donor.id))) return false;
    if (!skipPartner && S.selPartner.size && !(p.partner && S.selPartner.has(p.partner.id))) return false;
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
      var hit = pool.some(function (r) { return inTimeRange(r) && passAll(r, ['region', 'prog', 'country', 'donor', 'partner', 'project', 'bentype']); });
      if (!hit) return false;
    }
    return true;
  }

  /** The text the list search box matches a project against - shared with the
   *  activities-basis metric so both bases search the same fields. */
  function projectSearchHay(p) {
    var co = p.country ? p.country.name : '';
    return (p.code + ' ' + p.name + ' ' + (p.donor ? p.donor.name : '') + ' ' + (p.partner ? p.partner.name + ' ' + (p.partner.acronym || '') : '') + ' ' + co + ' ' + (p.raw.lead_id != null ? userName(+p.raw.lead_id) : '')).toLowerCase();
  }
  /** Filtered + searched list of enriched projects for the right pane. */
  function projectsFor() {
    var q = (S.qList || '').toLowerCase(), progIso = progIsoSet();
    return PROJECTS.filter(function (p) {
      if (!projectPassesFacets(p, false, progIso)) return false;
      if (q && projectSearchHay(p).indexOf(q) < 0) return false;
      return true;
    });
  }
  function projStat(p) { return p.statAll; }
  /** A project's rolled-up stat over ONLY the KPIs that survive the active
   *  filters - the exact scope the results panel shows. With no KPI-level filter
   *  active, passFacets() passes every KPI, so this equals statAll and the
   *  unfiltered views are unchanged. Used where a view must agree with the panel
   *  it drills into (e.g. the Timeline under a Performance-status filter). */
  function projStatScoped(p) {
    var inds = (p.kpis || []).filter(function (r) { return inTimeRange(r) && passFacets(r); });
    return inds.length ? aggKpis(inds) : p.statAll;
  }
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
      // honour the list search too, matching the SAME project fields the projects
      // basis searches (code/name/donor/country/lead), so the bases agree
      var mActs = actPool([]);
      if (S.qList) {
        var mq = S.qList.toLowerCase();
        mActs = mActs.filter(function (a){
          var p = a.pid != null ? PROJECTSBYID[a.pid] : null;
          return !!(p && projectSearchHay(p).indexOf(mq) >= 0);
        });
      }
      $('#metricN').textContent = fmt(mActs.length);
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
    agg.appendChild(kpiChip('Progress', r.progress, r.perfCode));   // status badge borrowed from performance
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

    // tags: delivery (partner / direct) · dates · activities · status
    var tags = el('div', 'tags');
    if (p.partner) { var pt = el('span', 'tag', p.partner.acronym || p.partner.name); pt.title = 'Implemented by ' + p.partner.name; softTag(pt, p.partner.color || '#5B8DEF'); tags.appendChild(pt); }
    else { var dr = el('span', 'tag', 'Direct'); dr.title = 'Implemented directly by the organisation'; softTag(dr, '#7c8aa5'); tags.appendChild(dr); }
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
  // The plain-language name for the KIND of thing a report is about - the pill
  // that tells a reader "this is an Impact / a Project / a Country" at a glance.
  // Keys are the entityScope `badge` codes (and forecast ref kinds resolve to the
  // same set via entityScope), so one map serves every report and PDF.
  var TYPE_PILL = { plan:'Plan', impact:'Impact', outcome:'Outcome', output:'Output',
    project:'Project', country:'Country', region:'Region', donor:'Donor', partner:'Partner',
    kpi:'KPI', person:'Person', beneficiary:'Beneficiary', status:'Status' };
  function typePillLabel(badge){ return TYPE_PILL[badge] || cap(badge || ''); }

  // The eyebrow above the modal title telling the reader WHICH report this is -
  // 'RESULTS REPORT' vs 'FORECAST REPORT' - so the two screens are never confused.
  // The optional type pill (Impact / Project / Country …) says what it is ABOUT.
  function setModalKicker(txt, typeLabel, color){
    var k = $('#mKicker'); if (!k) return;
    k.className = 'mkicker' + (/FORECAST/.test(txt || '') ? ' fc' : '');
    k.textContent = '';
    if (txt) k.appendChild(el('span', 'mk-lbl', txt));
    if (typeLabel){
      var pill = el('span', 'mk-type', typeLabel);
      if (color) pill.style.background = color;
      k.appendChild(pill);
    }
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
    if (b == null || t == null || +t === +b){
      s.value = null; s.updated = null; s.progress = null; s.performance = null;
      s.progressCode = 'nodata'; s.perfCode = 'nodata'; s.status = 'nodata';
      return s;
    }
    if (!latest){   // no report from this project yet = 0% progress -> Under Track
      s.value = null; s.updated = null; s.progress = 0; s.performance = 0;
      s.progressCode = ratioToCode(0); s.perfCode = ratioToCode(0); s.status = ratioToCode(0);
      return s;
    }
    var v = indicatorValue(ind, ms);
    var progress = (v - b) / (t - b), elapsed = elapsedFraction(ind);
    var performance = elapsed > 0 ? progress / elapsed : progress;
    s.value = v; s.updated = latest.date;
    s.progress = progress; s.performance = performance;
    s.progressCode = ratioToCode(progress); s.perfCode = ratioToCode(performance);
    s.status = ratioToCode(performance);   // status is always performance
    return s;
  }
  function openDetail(r, push, projectId){
    navEnter({ t: 'kpi', id: r.id, projectId: projectId }, push);
    curDetail = r;                                  // tabs (Projects / Activities) use the full indicator
    r = indicatorScopedToProject(r, projectId);     // the body shows this project's results only
    var _tabs = $('#mTabs'); if (_tabs) _tabs.style.display = 'none';   // match the generic results box - no tabs
    $('#mProjects').classList.add('hide'); $('#mResults').classList.add('hide');
    $('#mBody').classList.remove('hide');
    setModalKicker('RESULTS REPORT', 'KPI', r.sdg ? (PILLAR_COLORS[r.sdg] || '#7c8aa5') : '#7c8aa5');
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
    if (kind === 'plan'){
      // The whole active plan - the top of the results chain. Its scope is every
      // KPI and project the app carries; the filter-narrowing step below then
      // makes the box mirror whatever slice the dashboard is showing.
      var ap = planById(key) || activePlan();
      inds = IND.slice(); projs = PROJECTS.slice();
      var apPeriod = ap ? ((ap.start_date ? yearOf(ap.start_date) : '?') + '–' + (ap.end_date ? yearOf(ap.end_date) : '?')) : '';
      title = ap ? ap.name : 'Development plan';
      sub = (apPeriod ? apPeriod + '  ·  ' : '') + 'Development plan';
      color = '#2563eb'; badge = 'plan';
    } else if (kind === 'region'){
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
      title = d ? d.name : 'Donor'; sub = d ? (donorType(d) + ' donor') : 'Donor';
      color = (d && d.color) || color; badge = 'donor';
    } else if (kind === 'partner'){
      var pt = DB._idx.partnerById[key];
      projs = PROJECTS.filter(function (p){ return p.partner && p.partner.id === key; });
      inds = IND.filter(function (r){ return (r.partnerIds || []).indexOf(key) >= 0; });
      title = pt ? pt.name : 'Partner'; sub = pt ? ((pt.acronym ? pt.acronym + '  ·  ' : '') + 'Implementing partner') : 'Implementing partner';
      color = (pt && pt.color) || color; badge = 'partner';
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
      sub = u ? (userAffName(u) + (userCountryIsos(u).length ? '  ·  ' + userCountryIsos(u).join(' ') : '')) : '';
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

  // Section an entity's projects by the NEXT level down the results chain, so a
  // results page never shows a flat wall of projects: Plan → Impacts, Impact →
  // Outcomes, Outcome → Outputs, Region → Countries. Each project lands in the
  // single group its in-scope KPIs contribute the most to (so it appears once).
  // Returns null for leaf/flat kinds (Output, Donor, Partner, Country, …) - those
  // list their projects flat. `scopeInds` are the entity's in-scope KPIs.
  // The read-only hierarchy code ('Outcome 1.2' / 'Output 1.2.1') for a framework
  // node identified by a chainKey ('level~|~statement'). Country instances of an
  // output share one code, so the first match in the active plan is authoritative.
  function chainKeyCode(ck){
    var i = ck.indexOf(SEP); if (i < 0) return '';
    var lvl = ck.slice(0, i), stmt = ck.slice(i + SEP.length), arr = DB.tables.result;
    for (var j = 0; j < arr.length; j++){
      var r = arr[j];
      if (r.plan_id === S.plan && r.level === lvl && r.statement === stmt && r.code) return r.code;
    }
    return '';
  }

  function esumProjectGroups(kind, key, projs, scopeInds){
    if (!projs || !projs.length) return null;
    // Region is a geographic parent - group by the project's own country.
    if (kind === 'region'){
      var byC = {}, cord = [];
      projs.forEach(function (p){
        var k = p.iso || '?';
        var g = byC[k];
        if (!g){ var cnm = p.country ? p.country.name : (p.iso || '—'); g = byC[k] = { code: '', name: cnm, title: cnm, color: p.iso ? countryColor(p.iso) : null, projs: [] }; cord.push(g); }
        g.projs.push(p);
      });
      cord.sort(function (a, b){ return a.title < b.title ? -1 : a.title > b.title ? 1 : 0; });
      return cord.length ? cord : null;
    }
    // Framework chain: the child level's chainKey prefix.
    var childPrefix = null, childIsImpact = false;
    if (kind === 'plan'){ childPrefix = 'sdg'; childIsImpact = true; }
    else if (kind === 'node'){
      var lvl = String(key).split(SEP)[0];
      if (lvl === 'sdg') childPrefix = 'outcome';
      else if (lvl === 'outcome') childPrefix = 'output';
      else return null;                 // output is a leaf → flat project list
    } else return null;                 // donor, partner, country, kpi, … → flat
    var inScope = {}; (scopeInds || []).forEach(function (r){ inScope[r.id] = 1; });
    var pre = childPrefix + SEP;
    var groups = {}, order = [];
    var unmapped = { code: '', name: 'Project-specific KPIs (no framework parent)', title: 'Project-specific KPIs (no framework parent)', color: '#94a3b8', projs: [] };
    projs.forEach(function (p){
      var tally = {}, best = null, bestN = 0;
      (p.kpis || []).forEach(function (r){
        if (!inScope[r.id]) return;
        (r.chainKeys || []).forEach(function (ck){
          if (ck.indexOf(pre) !== 0) return;
          tally[ck] = (tally[ck] || 0) + 1;
          if (tally[ck] > bestN){ bestN = tally[ck]; best = ck; }
        });
      });
      if (!best){ unmapped.projs.push(p); return; }
      var g = groups[best];
      if (!g){
        var val = best.slice(pre.length);
        if (childIsImpact){
          var inm = PILLAR_NAMES[+val] || '';
          g = groups[best] = { code: pillarLabel(+val), name: inm, title: pillarLabel(+val) + (inm ? ' · ' + inm : ''), color: PILLAR_COLORS[+val] || '#94a3b8', sort: +val, projs: [] };
        } else {
          var ocode = chainKeyCode(best);
          g = groups[best] = { code: ocode, name: val, title: ocode ? ocode + ' · ' + val : val, color: null, sort: val, projs: [] };
        }
        order.push(best);
      }
      g.projs.push(p);
    });
    var out = order.map(function (k){ return groups[k]; });
    out.sort(function (a, b){ return a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0; });
    if (unmapped.projs.length) out.push(unmapped);
    // Only a framework mapping justifies sections; if nothing mapped, stay flat.
    return out.length && out.some(function (g){ return g !== unmapped; }) ? out : null;
  }

  function openEntitySummary(kind, key, push){
    var sc = entityScope(kind, key); if (!sc) return;
    navEnter({ t: 'entity', kind: kind, key: key }, push);
    curDetail = null;
    var tabs = $('#mTabs'); if (tabs) tabs.style.display = 'none';
    $('#mProjects').classList.add('hide'); $('#mResults').classList.add('hide');
    $('#mBody').classList.remove('hide');
    setModalKicker('RESULTS REPORT', typePillLabel(sc.badge), sc.color);
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
    var perfCode = ratioToCode(perfAvg);   // status is always performance; progress badges borrow it
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
    expStats.push({ label: 'Progress', value: progAvg != null ? Math.round(progAvg * 100) + '%' : '–', sub: progAvg != null ? STATUS[perfCode].label : '', color: progAvg != null ? STATUS[perfCode].c : null });
    expStats.push({ label: 'Performance', value: perfAvg != null ? Math.round(perfAvg * 100) + '%' : '–', sub: perfAvg != null ? STATUS[perfCode].label : '', color: perfAvg != null ? STATUS[perfCode].c : null });

    html += '<div class="esum-grid">'
      + stat(countLbl, countVal, actSub)
      + stat('Budget', hasBudget ? '$' + fmtBudget(budget) : '–')
      + (tlVal ? stat('Timeline', tlVal) : '')
      + pctStat('Progress', progAvg, perfCode)
      + pctStat('Performance', perfAvg, perfCode)
      + '</div>';

    // ---- results table --------------------------------------------------------
    // A single project shows its KPIs; every other item shows its projects. KPIs
    // are never listed on a non-project results box. The same rows are pushed into
    // expCols/expRows so the PDF export mirrors exactly what is on screen.
    var expCols = [], expRows = [], expSections = [], expSection = '', expNote = '';
    var indsHead = 'KPIs - ' + ofTotal(inds.length, sc.indsAll.length, 'KPI', 'KPIs').replace(/ KPIs?$/, '');
    var projsHead = 'Projects - ' + ofTotal(projs.length, sc.projsAll.length, 'project', 'projects').replace(/ projects?$/, '');
    if (isProject){
      expSection = indsHead;
      expCols = [{ t: 'KPI' }, { t: 'Type' }, { t: 'Baseline', align: 'right' }, { t: 'Target', align: 'right' },
                 { t: 'Latest', align: 'right' }, { t: 'Activities', align: 'right' }, { t: 'Progress', align: 'right' }, { t: 'Performance', align: 'right' }];
      html += '<div class="msec"><h4>' + esc(indsHead) + '</h4>';
      if (!inds.length) html += '<div class="empty">' + (sc.indsAll.length ? 'No KPIs on this project match the active filters.' : 'No KPIs attached to this project.') + '</div>';
      else {
        html += '<div class="esum-card"><table class="esum-tbl esum-kpi"><thead><tr><th>KPI</th><th class="tcol">Type</th><th class="num">Baseline</th><th class="num">Target</th><th class="num">Latest</th><th class="num">Activities</th><th class="num">Progress</th><th class="num">Performance</th></tr></thead><tbody>';
        inds.slice().sort(function (a, b){ return (b.updated || '') < (a.updated || '') ? -1 : 1; }).forEach(function (r){
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
            + '<td class="num"><b style="color:' + STATUS[r.perfCode].c + '">' + pro + '</b></td>'
            + '<td class="num"><b style="color:' + STATUS[r.perfCode].c + '">' + per + '</b></td></tr>';
          expRows.push([
            { t: (r.code ? r.code + ' · ' : '') + r.name, dot: col },
            // tinted Type badge in the PDF, matching the on-screen .kpi-type colours
            { t: r.secondary ? 'Secondary' : 'Primary',
              tag: r.secondary ? { bg: '#dce4d1', fg: '#27500a' } : { bg: '#d8e3ec', fg: '#0c447c' } },
            { t: ind.baseline_value != null ? fmtNum(ind.baseline_value) + u : '–' },
            { t: ind.target_value != null ? fmtNum(ind.target_value) + u : '–' },
            { t: r.value != null ? fmtNum(r.value) + u : '–' },
            { t: fmt(kActs) },
            { t: pro, color: STATUS[r.perfCode].c },
            { t: per, color: STATUS[r.perfCode].c }
          ]);
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    } else {
      expSection = projsHead;
      expCols = [{ t: 'Project' }, { t: 'Country' }, { t: 'Donor' }, { t: 'Partner' }, { t: 'Budget', align: 'right' },
                 { t: 'Activities', align: 'right' }, { t: 'Progress', align: 'right' }, { t: 'Performance', align: 'right' }];
      html += '<div class="msec"><h4>' + esc(projsHead) + '</h4>';
      if (!projs.length) html += '<div class="empty">No projects match this item under the current filters.</div>';
      else {
        // Activities per project follow the filters AND this box's own scope (sc.acts
        // is the same pool the Activities stat above counts), so the column adds up
        // to that stat rather than to the project's lifetime total.
        var actByProj = {};
        sc.acts.forEach(function (m){ if (m.project_id != null) actByProj[m.project_id] = (actByProj[m.project_id] || 0) + 1; });
        var byActs = function (a, b){ return (actByProj[b.id] || 0) - (actByProj[a.id] || 0); };
        // one row's on-screen HTML + its export cell array, built once and reused
        function projRow(p){
          var pActs = actByProj[p.id] || 0;
          var proV = aggMetric(p.kpis, 'progress'), perV = aggMetric(p.kpis, 'performance');
          var pro = proV != null ? Math.round(proV * 100) + '%' : '–';
          var per = perV != null ? Math.round(perV * 100) + '%' : '–';
          var col = (p.donor && p.donor.color) || countryColor(p.iso);
          var h = '<tr class="esum-trow" data-proj="' + p.id + '">'
            + '<td class="esum-nm"><span class="esum-dot" style="background:' + col + '"></span>' + esc((p.code ? p.code + ' · ' : '') + p.name) + '</td>'
            + '<td>' + esc(p.country ? p.country.name : p.iso) + '</td>'
            + '<td>' + esc(p.donor ? (p.donor.short_name || p.donor.name) : '–') + '</td>'
            + '<td>' + esc(p.partner ? (p.partner.acronym || p.partner.name) : 'Direct') + '</td>'
            + '<td class="num">' + (p.budget != null ? '$' + fmtBudget(p.budget) : '–') + '</td>'
            + '<td class="num">' + fmt(pActs) + '</td>'
            + '<td class="num"><b style="color:' + STATUS[ratioToCode(perV)].c + '">' + pro + '</b></td>'
            + '<td class="num"><b style="color:' + STATUS[ratioToCode(perV)].c + '">' + per + '</b></td></tr>';
          var row = [
            { t: (p.code ? p.code + ' · ' : '') + p.name, dot: col },
            { t: p.country ? p.country.name : p.iso },
            { t: p.donor ? (p.donor.short_name || p.donor.name) : '–' },
            { t: p.partner ? (p.partner.acronym || p.partner.name) : 'Direct' },
            { t: p.budget != null ? '$' + fmtBudget(p.budget) : '–' },
            { t: fmt(pActs) },
            { t: pro, color: STATUS[ratioToCode(perV)].c },
            { t: per, color: STATUS[ratioToCode(perV)].c }
          ];
          return { html: h, row: row };
        }
        // group projects one level down the chain (Plan→Impacts, …); null = flat.
        // Each group is its own rounded card: the hierarchy code + statement sit
        // OUTSIDE the card as a label; the column header + rows live INSIDE it.
        var pgroups = esumProjectGroups(kind, key, projs, sc.inds);
        var projThead = '<thead><tr><th>Project</th><th>Country</th><th>Donor</th><th>Partner</th><th class="num">Budget</th><th class="num">Activities</th><th class="num">Progress</th><th class="num">Performance</th></tr></thead>';
        if (pgroups){
          pgroups.forEach(function (g){
            var gRows = g.projs.slice().sort(byActs);
            html += '<div class="esum-group">'
              + '<div class="esum-group-hd">'
              +   '<span class="esum-grp-bar" style="background:' + (g.color || '#94a3b8') + '"></span>'
              +   (g.code ? '<span class="esum-grp-code">' + esc(g.code) + '</span>' : '')
              +   '<span class="esum-grp-t">' + esc(g.name || g.title) + '</span>'
              +   '<span class="esum-grp-n">' + gRows.length + ' project' + (gRows.length === 1 ? '' : 's') + '</span>'
              + '</div>'
              + '<div class="esum-card"><table class="esum-tbl esum-proj">' + projThead + '<tbody>';
            var secRows = [];
            gRows.forEach(function (p){ var r = projRow(p); html += r.html; expRows.push(r.row); secRows.push(r.row); });
            html += '</tbody></table></div></div>';
            expSections.push({ code: g.code, title: g.title, name: g.name || g.title, color: g.color || '#94a3b8', rows: secRows });
          });
        } else {
          html += '<div class="esum-card"><table class="esum-tbl esum-proj">' + projThead + '<tbody>';
          projs.slice().sort(byActs).forEach(function (p){ var r = projRow(p); html += r.html; expRows.push(r.row); });
          html += '</tbody></table></div>';
        }
      }
      html += '</div>';
    }

    lastResultsExport = { badge: sc.badge, badgeColor: sc.color, title: sc.title, sub: sc.sub || '',
      summary: kidsTxt, filters: activeFilterSummary(), stats: expStats, section: expSection,
      columns: expCols, rows: expRows, sections: expSections.length ? expSections : null, note: expNote };

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
    setModalKicker('RESULTS REPORT', badge, color);

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
  // `exclMeasId` (edit mode): the measurement being edited - it must not count
  // toward "before", or a count KPI would preview its own increment twice.
  function fillReportPreview(hostId, r, valId, exclMeasId){
    var host = document.getElementById(hostId); if (!host) return;
    if (!r){ host.innerHTML = ''; return; }
    var vEl = document.getElementById(valId || 'afValue'), raw = vEl ? vEl.value : '';
    var ind = r.raw, b = +ind.baseline_value, t = +ind.target_value;
    var pool = DB.measurementsFor(r.id);
    if (exclMeasId != null) pool = pool.filter(function (m){ return m.id !== exclMeasId; });
    var beforeVal = indicatorValue(ind, pool);
    if (beforeVal == null) beforeVal = b;
    var isCount = kpiUnit(ind) === 'count';
    var hasVal = raw !== '' && !isNaN(+raw);
    var newVal = isCount ? (beforeVal + (hasVal ? +raw : 0)) : (hasVal ? +raw : beforeVal);
    var uu = kpiUnit(ind) === '%' ? '%' : '';
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
    var unit = r ? (kpiUnit(r.raw) || 'value') : 'value';
    return (r && kpiUnit(r.raw) === 'count')
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
    fillReportPreview('naPreview', r, 'naValue', m.id);   // before/after preview, as in Add mode
    $('#naValue').addEventListener('input', function (){ fillReportPreview('naPreview', r, 'naValue', m.id); });
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
    var isCount = kpiUnit(r.raw) === 'count';
    var unit = kpiUnit(r.raw) || '';
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
  // Countries-affiliated users are scoped to the countries they Lead (locked to
  // it when they Lead exactly one); Admin and central affiliations to any.
  function projectCountryLock(){
    if (curSection() !== 'co' || !CURRENT_USER) return null;
    var isos = userCountryIsos(CURRENT_USER);
    return isos.length === 1 ? isos[0] : null;
  }
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
    var pt = curProject && curProject.partner_id != null ? DB._idx.partnerById[curProject.partner_id] : null;
    var via = curProject ? (pt ? ('via ' + (pt.acronym || pt.name)) : (projImpl(curProject) === 'direct' ? 'direct delivery' : '')) : '';
    $('#prSub').textContent = curProject
      ? [co ? co.name : '', don ? don.name : '', via, curProject.budget_usd != null ? '$' + fmtBudget(curProject.budget_usd) : ''].filter(Boolean).join('  ·  ')
      : 'Create a country programme project - donor, partner, budget, KPIs and activities';
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
    configProjectFoot(node);
  }
  /** Wire the persistent modal footer to the tab that is currently on screen.
   *  Export PDF is offered once the project exists; the primary Save button takes
   *  the active tab's own save handler (details / primary KPIs) and hides itself on
   *  the list-style tabs that save through their own child popups. */
  function configProjectFoot(node){
    var msg = $('#prMsg'); if (msg){ msg.textContent = ''; msg.classList.remove('ok'); }
    var exp = $('#prExportPdf'); if (exp) exp.style.display = curProject ? '' : 'none';
    var save = $('#prSaveBtn'); if (!save) return;
    var saver = node && node.__save;
    if (saver){ save.style.display = ''; save.textContent = (node && node.__saveLabel) || 'Save changes'; save.onclick = saver; }
    else { save.style.display = 'none'; save.onclick = null; }
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
  function partnerOptions(cur){
    return '<option value="">– select partner –</option>' + DB.tables.partner.slice()
      .sort(function (a, b){ return a.name < b.name ? -1 : 1; })
      .map(function (d){ return '<option value="' + d.id + '"' + (d.id === cur ? ' selected' : '') + '>' + esc(d.name) + (d.acronym ? ' (' + esc(d.acronym) + ')' : '') + '</option>'; }).join('');
  }
  // Delivery modality of a raw project row: 'partner' when an implementing partner
  // is attached, otherwise the stored implementation flag (default 'direct').
  function projImpl(p){ return (p && p.partner_id != null) ? 'partner' : ((p && p.implementation) || 'direct'); }
  function countryOptionsGrouped(cur, restrictIso){
    var byReg = {}; DB.tables.country.forEach(function (c){ (byReg[c.region] = byReg[c.region] || []).push(c); });
    return '<option value="">– select country –</option>' + regionNames().map(function (rg){
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
      '  <label><span>Project name *</span><input class="pf-name" type="text" value="' + esc(p ? p.name : '') + '" placeholder="What this project delivers"></label>' +
      '  <label><span>Donor</span><select class="pf-donor">' + donorOptions(p ? p.donor_id : null) + '</select></label>' +
      '  <label><span>Country *</span><select class="pf-country"' + (lock ? ' disabled' : '') + '>' + countryOptionsGrouped(iso, lock) + '</select></label>' +
      '  <label><span>Delivery</span><select class="pf-impl">' +
          '<option value="direct"' + (projImpl(p) === 'direct' ? ' selected' : '') + '>Directly by organisation</option>' +
          '<option value="partner"' + (projImpl(p) === 'partner' ? ' selected' : '') + '>Through an implementing partner</option>' +
        '</select></label>' +
      '  <label><span>Implementing partner</span><select class="pf-partner"' + (projImpl(p) === 'partner' ? '' : ' disabled') + '>' + partnerOptions(p ? p.partner_id : null) + '</select></label>' +
      '  <label><span>Budget (USD)</span><input class="pf-budget" type="text" inputmode="numeric" value="' + esc(p && p.budget_usd != null ? fmt(p.budget_usd) : '') + '" placeholder="0"></label>' +
      '  <label><span>Lead</span><select class="pf-lead">' + userOptions(projectLeadId(p), 'project') + '</select></label>' +
      '  <label><span>Start date</span><input class="pf-start" type="date" value="' + esc(p ? (p.start_date || '') : '') + '"></label>' +
      '  <label><span>End date</span><input class="pf-end" type="date" value="' + esc(p ? (p.end_date || '') : '') + '"></label>' +
      '  <label class="pf-wide"><span>Description</span><textarea class="pf-desc" rows="3" placeholder="Objectives, scope, partners…">' + esc(p ? (p.description || '') : '') + '</textarea></label>' +
      '</div>' +
      (ro ? '<div class="cp-note">Read-only - you do not have permission to edit this project.</div>' : '');
    if (ro) { f.querySelectorAll('input,select,textarea').forEach(function (x){ x.disabled = true; }); return f; }
    // Save is driven from the persistent modal footer (configProjectFoot).
    f.__saveLabel = p ? 'Save changes' : 'Create project';
    f.__save = function (){ saveProjectDetails(f); };
    // Delivery toggle: the partner dropdown is only live when 'Through a partner'
    // is chosen; switching back to 'Directly' disables and clears the partner.
    var impl = f.querySelector('.pf-impl'), pfPartner = f.querySelector('.pf-partner');
    if (impl && pfPartner) impl.addEventListener('change', function (){
      var on = impl.value === 'partner';
      pfPartner.disabled = !on;
      if (!on) pfPartner.value = '';
    });
    // Budget: re-insert thousands separators as the user types (keeps caret at end).
    // Decimals survive: only the integer part is re-grouped, the fraction rides along.
    var bud = f.querySelector('.pf-budget');
    if (bud) bud.addEventListener('input', function (){
      var raw = bud.value.replace(/[^\d.]/g, '');
      var dot = raw.indexOf('.');
      var whole = dot < 0 ? raw : raw.slice(0, dot);
      var frac = dot < 0 ? null : raw.slice(dot + 1).replace(/\./g, '');
      bud.value = (whole ? (+whole).toLocaleString('en-US') : (frac != null ? '0' : ''))
                + (frac != null ? '.' + frac : '');
    });
    return f;
  }
  function saveProjectDetails(f){
    var v = function (c){ var e = f.querySelector(c); return e ? e.value : ''; };
    var name = v('.pf-name').trim(), iso = v('.pf-country') || projectCountryLock();
    var msg = $('#prMsg');
    if (msg) msg.classList.remove('ok');   // reset to error/neutral colour before revalidating
    if (!name){ msg.textContent = 'Project name is required.'; return; }
    if (!iso){ msg.textContent = 'Select a country.'; return; }
    var co = DB._idx.countryByIso[iso];
    var num = function (x){ return x === '' || isNaN(+x) ? null : +x; };
    // Delivery: through a partner (partner_id set) or directly (partner_id null).
    // Choosing 'Through a partner' but leaving the partner blank still records the
    // intent as 'partner' so the modality is explicit.
    var impl = v('.pf-impl') === 'partner' ? 'partner' : 'direct';
    var partnerId = impl === 'partner' && v('.pf-partner') ? +v('.pf-partner') : null;
    var fields = {
      code: v('.pf-code').trim(), name: name,
      donor_id: v('.pf-donor') ? +v('.pf-donor') : null,
      partner_id: partnerId,
      implementation: impl,
      country_iso3: iso, region: co ? co.region : null,
      budget_usd: num(v('.pf-budget').replace(/,/g, '')), lead_id: v('.pf-lead') ? +v('.pf-lead') : null,
      start_date: v('.pf-start') || null, end_date: v('.pf-end') || null,
      description: v('.pf-desc').trim()
    };
    msg.textContent = 'Saving…';
    var done = function (){
      enrich(); renderTicker(); renderAll();
      openProject(curProject);   // refresh header + tabs against the saved row
      var m2 = $('#prMsg'); if (m2) { m2.textContent = 'Saved.'; m2.classList.add('ok'); }
    };
    if (curProject){
      Object.keys(fields).forEach(function (k){ curProject[k] = fields[k]; });
      delete curProject.lead;   // legacy name column, superseded by lead_id
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
    box.appendChild(elHTML('div', 'cp-note', 'Primary KPIs are drawn from the <b>KPI inventory</b> for ' + esc((DB._idx.countryByIso[p.country_iso3] || {}).name || p.country_iso3) + '. Tick the KPIs this project reports against; their activities aggregate into the project. Secondary (project-local) KPIs are managed on the next tab.'));
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
    // Save is driven from the persistent modal footer (configProjectFoot).
    if (!ro) { box.__saveLabel = 'Save primary KPIs'; box.__save = function (){ savePrimaryKpis(box, linked); }; }
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
    var msg = $('#prMsg'); if (msg){ msg.classList.remove('ok'); msg.textContent = 'Saving…'; }
    Promise.all(jobs).then(function (){
      enrich(); renderTicker(); renderAll(); setProjectTab('primary');
      var m2 = $('#prMsg'); if (m2){ m2.textContent = 'Saved.'; m2.classList.add('ok'); }
    });
  }

  // ---- TAB 3 · secondary KPIs (project-local) ------------------------------
  function projectSecondaryEditor(){
    var p = curProject, ro = !canEditThisProject(p);
    var secs = (DB._idx.secondaryByProject[p.id] || []).slice().sort(function (a, b){ return (a.code < b.code ? -1 : 1); });
    var box = el('div', 'prtab');
    box.appendChild(elHTML('div', 'cp-note', 'Secondary KPIs are <b>defined and used within this project only</b>. They are structured like primary KPIs and are <b>aggregated separately and together with primaries</b>. A global toggle (top bar) can exclude all secondary KPIs from every view when needed.'));
    if (!ro) { var add = el('button', 'hbtn primary', '＋ Add secondary KPI'); add.onclick = function (){ openSecEdit(null); }; box.appendChild(add); }
    var tbl = el('table', 'utbl');
    tbl.innerHTML = '<thead><tr><th>Code</th><th>KPI</th><th>Unit</th><th>Baseline</th><th>Target</th><th>Progress</th><th></th></tr></thead>';
    var tb = el('tbody');
    if (!secs.length) tb.innerHTML = '<tr><td colspan="7" class="re-empty">No secondary KPIs yet.</td></tr>';
    secs.forEach(function (ind){
      var r = INDBYID[ind.id]; var u = kpiUnit(ind) === '%' ? '%' : '';
      var tr = el('tr');
      tr.innerHTML = '<td class="umono">' + esc(ind.code || '') + '</td>'
        + '<td><span class="udot" style="background:#33C2B4"></span>' + esc(ind.name) + '</td>'
        + '<td class="umono">' + esc(kpiUnit(ind) || '') + '</td>'
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
    var bd = (ind && ind.baseline_date) || defaultBaselineDate();
    var td = (ind && ind.target_date) || defaultTargetDate();
    f.innerHTML =
      '<div class="ufgrid kpigrid">' +
      '  <label class="kf-wide"><span>KPI name *</span><input class="sf-name" type="text" value="' + esc(ind ? ind.name : '') + '"></label>' +
      '  <label><span>Unit</span><select class="sf-unit">' + lookupOptions('unit', ind ? ind.unit_id : lkIdByKey('unit', 'count'), ind && ind.unit) + '</select></label>' +
      '  <label><span>Direction</span><select class="sf-dir">' + lookupOptions('direction', ind ? ind.direction_id : lkIdByKey('direction', 'increase'), ind && ind.direction) + '</select></label>' +
      '  <label><span>Baseline value</span><input class="sf-base" type="number" step="any" value="' + esc(ind ? ind.baseline_value : 0) + '"></label>' +
      '  <label><span>Target value</span><input class="sf-tgt" type="number" step="any" value="' + esc(ind ? ind.target_value : '') + '"></label>' +
      '  <label><span>Baseline date</span><input class="sf-basedate" type="date" value="' + esc(bd) + '"></label>' +
      '  <label><span>Target date</span><input class="sf-tgtdate" type="date" value="' + esc(td) + '"></label>' +
      '  <label><span>Frequency</span><select class="sf-freq">' + lookupOptions('frequency', ind ? ind.frequency_id : lkIdByKey('frequency', 'quarterly'), ind && ind.frequency) + '</select></label>' +
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
      ind.name = name; ind.unit_id = +v('.sf-unit'); ind.direction_id = +v('.sf-dir');
      delete ind.unit; delete ind.direction;   // legacy text columns, superseded by ids
      var b = num(v('.sf-base')); if (b != null) ind.baseline_value = b;
      var t = num(v('.sf-tgt')); if (t != null) ind.target_value = t;
      if (bd){ ind.baseline_date = bd; ind.baseline_year = +bd.slice(0, 4); }
      if (td){ ind.target_date = td; ind.target_year = +td.slice(0, 4); }
      ind.frequency_id = +v('.sf-freq'); delete ind.frequency;
      ind.means_of_verification = v('.sf-mov').trim();
      apply(DB.persist('indicator', [ind]));
    } else {
      var n = (DB._idx.secondaryByProject[curProject.id] || []).length + 1;
      var code = 'SEC-' + (curProject.code ? curProject.code.replace(/^PRJ-/, '') : ('P' + curProject.id)) + '.' + n;
      apply(DB.insert('indicator', {
        result_id: null, project_id: curProject.id, secondary: 1, sdg: null, code: code,
        name: name, type_id: lkIdByKey('kpi_type', 'quantitative'), unit_id: +v('.sf-unit'), direction_id: +v('.sf-dir'),
        baseline_value: num(v('.sf-base')) || 0, baseline_year: +(bd || defaultBaselineDate()).slice(0, 4), baseline_date: bd || defaultBaselineDate(),
        target_value: num(v('.sf-tgt')), target_year: +(td || defaultTargetDate()).slice(0, 4), target_date: td || defaultTargetDate(),
        means_of_verification: v('.sf-mov').trim(), collection_method_id: lkIdByKey('collection_method', 'Self-reporting'),
        frequency_id: +v('.sf-freq'), responsible_id: null, disaggregation_id: lkIdByKey('disaggregation', 'none')
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
    var pt = $('#cpTabs').querySelector('[data-cptab="partners"]');
    if (pt) pt.classList.toggle('hide', !canEditFramework());
    var bt = $('#cpTabs').querySelector('[data-cptab="beneficiaries"]');
    if (bt) bt.classList.toggle('hide', !canEditFramework());
    var rt = $('#cpTabs').querySelector('[data-cptab="regions"]');
    if (rt) rt.classList.toggle('hide', !canEditFramework());
    var ct = $('#cpTabs').querySelector('[data-cptab="countries"]');
    if (ct) ct.classList.toggle('hide', !canEditFramework());
    renderControl('donors'); $('#cpModal').classList.add('on');
  }
  function closeControl(){ $('#cpModal').classList.remove('on'); }

  // Results Management modal - Results Framework + KPI Inventory
  function openResults(){ renderResults('framework'); $('#rmModal').classList.add('on'); }
  function closeResults(){ $('#rmModal').classList.remove('on'); }

  function openAbout(tab){
    aboutTab(tab || 'grass');
    $('#aboutModal').classList.add('on');
  }
  function closeAbout(){ $('#aboutModal').classList.remove('on'); }
  function aboutTab(tab){
    var org = tab === 'org';
    $('#aboutTabG').classList.toggle('on', !org);
    $('#aboutTabO').classList.toggle('on', org);
    $('#aboutPaneG').style.display = org ? 'none' : '';
    $('#aboutPaneO').style.display = org ? '' : 'none';
    if (org) renderOrgPane();
  }

  // ---- About - "Your organization" tab ----------------------------------------
  //  Edits the org profile (see orgProfile above). Every change persists straight
  //  to localStorage - there is nothing to lose by closing the modal.
  function renderOrgPane(){
    var host = $('#aboutPaneO');
    var o = orgProfile();
    host.innerHTML =
      '<div class="cp-note" style="margin-top:0">Tell the platform who <b>you</b> are. When the profile is ' +
      'activated, every PDF export - results, forecasts and the monthly Lead reports - carries your ' +
      'organization\'s name on the letterhead, footer and file name, and your logo replaces the Grassroots ' +
      'mark. Deactivate it at any time to fall back to The Grassroots branding. Everything here stays in ' +
      'this browser only - it is never written to the database or the SQL export.</div>' +
      '<label class="org-onoff"><input type="checkbox" class="org-enabled"' + (o.enabled ? ' checked' : '') + '> ' +
      '<b>Use this profile on all PDF exports</b><span class="org-status"></span></label>' +
      '<div class="uform">' +
      '  <div class="ufgrid" style="grid-template-columns:2fr 1fr">' +
      '    <label><span>Organization name *</span><input class="org-name" type="text" maxlength="120" value="' + esc(o.name || '') + '" placeholder="e.g. Sahel Development Trust"></label>' +
      '    <label><span>Acronym</span><input class="org-acronym" type="text" maxlength="20" value="' + esc(o.acronym || '') + '" placeholder="e.g. SDT"></label>' +
      '  </div>' +
      '  <div class="ufgrid" style="grid-template-columns:1fr 1fr 1fr">' +
      '    <label><span>Email</span><input class="org-email" type="email" maxlength="120" value="' + esc(o.email || '') + '" placeholder="info@example.org"></label>' +
      '    <label><span>Phone</span><input class="org-phone" type="text" maxlength="40" value="' + esc(o.phone || '') + '" placeholder="+00 000 000 000"></label>' +
      '    <label><span>Website</span><input class="org-web" type="text" maxlength="120" value="' + esc(o.website || '') + '" placeholder="www.example.org"></label>' +
      '  </div>' +
      '  <div class="ufgrid" style="grid-template-columns:1fr">' +
      '    <label><span>Address</span><input class="org-addr" type="text" maxlength="200" value="' + esc(o.address || '') + '" placeholder="Street, city, country"></label>' +
      '  </div>' +
      '  <div class="org-logo-row">' +
      '    <div class="org-logo-prev">' + (o.logo && o.logo.jpeg ? '<img alt="Organization logo" src="' + o.logo.jpeg + '">' : '<span>No logo yet</span>') + '</div>' +
      '    <div class="org-logo-btns">' +
      '      <div class="org-logo-hint">PNG, JPEG or SVG. Transparency is flattened onto white; on the PDF letterhead the logo sits on a white chip inside the brand band.</div>' +
      '      <input class="org-logo-file" type="file" accept="image/*" style="display:none">' +
      '      <button class="hbtn org-logo-up" type="button">↥ Upload logo</button>' +
      (o.logo && o.logo.jpeg ? '<button class="hbtn danger org-logo-rm" type="button">Remove logo</button>' : '') +
      '    </div>' +
      '  </div>' +
      '  <div class="ufbtns"><span class="ufmsg org-msg"></span><button class="hbtn primary org-save" type="button">Save profile</button></div>' +
      '</div>';
    var msg = host.querySelector('.org-msg');
    function status(){
      var st = host.querySelector('.org-status'), cur = orgProfile();
      st.textContent = !cur.enabled ? 'Disabled - exports carry The Grassroots branding'
        : (String(cur.name || '').trim() ? 'Active - "' + orgShort() + '" appears on every PDF export'
                                         : 'Waiting for a name - enter the organization name below');
      st.className = 'org-status' + (orgActive() ? ' ok' : '');
    }
    function collect(){
      var cur = orgProfile();
      return {
        enabled: host.querySelector('.org-enabled').checked ? 1 : 0,
        name: host.querySelector('.org-name').value.trim(),
        acronym: host.querySelector('.org-acronym').value.trim(),
        email: host.querySelector('.org-email').value.trim(),
        phone: host.querySelector('.org-phone').value.trim(),
        website: host.querySelector('.org-web').value.trim(),
        address: host.querySelector('.org-addr').value.trim(),
        logo: cur.logo || null
      };
    }
    function persist(note){
      var c = collect();
      if (c.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)){
        msg.textContent = 'Enter a valid email address (or leave it empty).'; msg.classList.remove('ok'); return;
      }
      orgSaveProfile(c);
      msg.textContent = note || '✓ Saved.'; msg.classList.add('ok');
      status();
    }
    host.querySelector('.org-save').onclick = function (){ persist('✓ Profile saved.'); };
    host.querySelector('.org-enabled').onchange = function (){
      persist(this.checked ? '✓ Activated - PDF exports now carry this profile.' : '✓ Deactivated - exports are back to The Grassroots branding.');
    };
    Array.prototype.forEach.call(host.querySelectorAll('.uform input[type=text],.uform input[type=email]'),
      function (inp){ inp.addEventListener('change', function (){ persist(); }); });
    var file = host.querySelector('.org-logo-file');
    host.querySelector('.org-logo-up').onclick = function (){ file.click(); };
    file.onchange = function (){
      var f = file.files && file.files[0];
      if (!f) return;
      orgReadLogo(f, function (logo){
        if (!logo){ msg.textContent = 'Could not read that image - try a PNG or JPEG.'; msg.classList.remove('ok'); return; }
        var c = collect(); c.logo = logo; orgSaveProfile(c);
        renderOrgPane();
        var m2 = host.querySelector('.org-msg');
        m2.textContent = '✓ Logo saved.'; m2.classList.add('ok');
      });
    };
    var rm = host.querySelector('.org-logo-rm');
    if (rm) rm.onclick = function (){
      var c = collect(); c.logo = null; orgSaveProfile(c);
      renderOrgPane();
      var m2 = host.querySelector('.org-msg');
      m2.textContent = '✓ Logo removed - the letterhead falls back to the Grassroots mark.'; m2.classList.add('ok');
    };
    status();
  }

  function renderControl(tab){
    tab = tab || 'donors';
    if (tab === 'users' && !canManageUsers()) tab = 'donors';
    if ((tab === 'donors' || tab === 'partners' || tab === 'beneficiaries' || tab === 'regions' || tab === 'countries') && !canEditFramework()) tab = 'donors';
    Array.prototype.forEach.call($('#cpTabs').children, function (x){ x.classList.toggle('on', x.dataset.cptab === tab); });
    var body = $('#cpBody'); body.innerHTML = '';
    if (tab === 'users') body.appendChild(usersEditor());
    else if (tab === 'partners') body.appendChild(partnersEditor());
    else if (tab === 'beneficiaries') body.appendChild(beneficiaryTypesEditor());
    else if (tab === 'regions') body.appendChild(regionLeadsEditor());
    else if (tab === 'countries') body.appendChild(countryLeadsEditor());
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
  // donor types live in the `donor_type` lookup table (saved as donor.type_id)
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
    tbl.innerHTML = '<thead><tr><th>Donor</th><th>Short</th><th>Type</th><th>Lead</th><th>Projects</th><th></th></tr></thead>';
    var tb = el('tbody');
    var list = donors();
    if (!list.length) tb.innerHTML = '<tr><td colspan="6" class="re-empty">No donors yet.</td></tr>';
    list.forEach(function (d){
      var used = donorProjectCount(d.id);
      var tr = el('tr');
      tr.innerHTML =
        '<td><span class="udot" style="background:' + (d.color || '#94a3b8') + '"></span>' + esc(d.name) + '</td>' +
        '<td class="umono">' + esc(d.short_name || '') + '</td>' +
        '<td>' + esc(donorType(d)) + '</td>' +
        '<td>' + (d.lead_id != null ? esc(userName(+d.lead_id)) : '–') + '</td>' +
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
    var typeOpts = lookupOptions('donor_type', d ? d.type_id : null, d && d.type);
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
      '<div class="ufgrid" style="grid-template-columns:1fr">' +
      '  <label><span>Lead</span><select class="dn-lead">' + userOptions(d && d.lead_id != null ? +d.lead_id : null, 'donor') + '</select></label>' +
      '</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn dn-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary dn-save" type="button">' + (d ? 'Save changes' : 'Add donor') + '</button></div>';
    f.querySelector('.dn-cancel').onclick = closeDonorEdit;
    f.querySelector('.dn-save').onclick = function (){
      var name = f.querySelector('.dn-name').value.trim(), msg = f.querySelector('.ufmsg');
      var short_name = f.querySelector('.dn-short').value.trim();
      var typeId = f.querySelector('.dn-type').value ? +f.querySelector('.dn-type').value : null;
      var col = f.querySelector('.dn-color').value;
      var leadId = f.querySelector('.dn-lead').value ? +f.querySelector('.dn-lead').value : null;
      if (!name){ msg.textContent = 'Donor name is required.'; return; }
      msg.textContent = 'Saving…';
      if (d){ d.name = name; d.short_name = short_name; d.type_id = typeId; delete d.type; d.color = col; d.lead_id = leadId; applyDonorMutation(DB.persist('donor', [d])); }
      else { applyDonorMutation(DB.insert('donor', { name: name, short_name: short_name, type_id: typeId, color: col, lead_id: leadId })); }
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
  //  CONTROL PANEL - Partners (implementing NGOs; editable; Admin only)
  // =========================================================================
  // A partner delivers projects on the ground on behalf of the organisation. It
  // carries full contact details, an identity colour and a relationship Lead.
  var PARTNER_PALETTE = ['#5B8DEF','#2FB39B','#B07CE8','#EE9A57','#E284A8','#4C9BD6','#37B58A','#D7A83E',
    '#79C06B','#E07E6C','#B888D8','#54AEBC'];
  function partners(){ return DB.tables.partner.slice().sort(function (a, b){ return a.name < b.name ? -1 : 1; }); }
  function nextPartnerColor(){
    var used = {}; DB.tables.partner.forEach(function (d){ if (d.color) used[d.color.toUpperCase()] = 1; });
    for (var i = 0; i < PARTNER_PALETTE.length; i++){ if (!used[PARTNER_PALETTE[i].toUpperCase()]) return PARTNER_PALETTE[i]; }
    return PARTNER_PALETTE[DB.tables.partner.length % PARTNER_PALETTE.length];
  }
  function partnerProjectCount(id){ return DB.tables.project.reduce(function (n, p){ return n + (p.partner_id === id ? 1 : 0); }, 0); }
  function applyPartnerMutation(p){
    return Promise.resolve(p).then(function (){ closePartnerEdit(); enrich(); renderTicker(); renderAll(); renderControl('partners'); });
  }
  function partnersEditor(){
    var box = el('div', 'cp-users');
    var note = el('div', 'cp-note');
    note.innerHTML = 'Partners are the <b>implementing NGOs</b> that deliver projects on the ground on behalf of your organization (as opposed to donors, who fund). Add, edit or delete them here - they populate the Partner drop-down on every project, the Partners filter, the Partner colouring on the map and the monthly partner reports. A project is delivered either <b>directly</b> or <b>through</b> one of these partners.';
    box.appendChild(note);
    var add = el('button', 'hbtn primary', '＋ Add partner'); add.onclick = function (){ openPartnerEdit(null); };
    box.appendChild(add);
    var tbl = el('table', 'utbl');
    tbl.innerHTML = '<thead><tr><th>Partner</th><th>Acronym</th><th>Contact</th><th>Lead</th><th>Projects</th><th></th></tr></thead>';
    var tb = el('tbody');
    var list = partners();
    if (!list.length) tb.innerHTML = '<tr><td colspan="6" class="re-empty">No partners yet.</td></tr>';
    list.forEach(function (d){
      var used = partnerProjectCount(d.id);
      var contact = [];
      if (d.phone) contact.push(esc(d.phone));
      if (d.website) contact.push('<a href="' + esc(d.website) + '" target="_blank" rel="noopener noreferrer">' + esc(String(d.website).replace(/^https?:\/\//, '')) + '</a>');
      var tr = el('tr');
      tr.innerHTML =
        '<td><span class="udot" style="background:' + (d.color || '#94a3b8') + '"></span>' + esc(d.name) + (d.address ? '<div class="umuted">' + esc(d.address) + '</div>' : '') + '</td>' +
        '<td class="umono">' + esc(d.acronym || '') + '</td>' +
        '<td>' + (contact.join('<br>') || '–') + '</td>' +
        '<td>' + (d.lead_id != null ? esc(userName(+d.lead_id)) : '–') + '</td>' +
        '<td class="umono">' + fmt(used) + '</td>';
      var act = el('td', 'uact');
      var ed = el('button', 'cp-mini', 'Edit'); ed.onclick = function (){ openPartnerEdit(d); };
      var del = el('button', 'cp-del', '🗑'); del.title = used ? 'In use by ' + used + ' project(s) - cannot delete' : 'Delete partner';
      del.disabled = !!used;
      del.onclick = function (){ if (used) return; if (confirm('Delete partner "' + d.name + '"?')) deletePartner(d); };
      act.appendChild(ed); act.appendChild(del); tr.appendChild(act); tb.appendChild(tr);
    });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }
  function openPartnerEdit(d){
    var body = $('#partnerEditBody'); body.innerHTML = '';
    $('#partnerEditTitle').textContent = d ? ('Edit partner · ' + d.name) : '＋ Add partner';
    var color = d && d.color ? d.color : nextPartnerColor();
    var f = el('div', 'uform');
    f.innerHTML =
      '<div class="ufgrid" style="grid-template-columns:2fr 1fr">' +
      '  <label><span>Partner name *</span><input class="pn-name" type="text" value="' + esc(d ? d.name : '') + '" placeholder="e.g. Health in Action International"></label>' +
      '  <label><span>Acronym</span><input class="pn-acr" type="text" value="' + esc(d && d.acronym ? d.acronym : '') + '" placeholder="e.g. HAI"></label>' +
      '</div>' +
      '<div class="ufgrid" style="grid-template-columns:1fr">' +
      '  <label><span>Address</span><input class="pn-addr" type="text" value="' + esc(d && d.address ? d.address : '') + '" placeholder="Office / postal address"></label>' +
      '</div>' +
      '<div class="ufgrid" style="grid-template-columns:1fr 1fr">' +
      '  <label><span>Phone number</span><input class="pn-phone" type="tel" value="' + esc(d && d.phone ? d.phone : '') + '" placeholder="e.g. +254 20 555 0187"></label>' +
      '  <label><span>Website</span><input class="pn-web" type="url" value="' + esc(d && d.website ? d.website : '') + '" placeholder="https://…"></label>' +
      '</div>' +
      '<div class="ufgrid" style="grid-template-columns:2fr 1fr">' +
      '  <label><span>Lead</span><select class="pn-lead">' + userOptions(d && d.lead_id != null ? +d.lead_id : null, 'partner') + '</select></label>' +
      '  <label><span>Identity colour</span><input class="pn-color" type="color" value="' + esc(color) + '"></label>' +
      '</div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn pn-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary pn-save" type="button">' + (d ? 'Save changes' : 'Add partner') + '</button></div>';
    f.querySelector('.pn-cancel').onclick = closePartnerEdit;
    f.querySelector('.pn-save').onclick = function (){
      var name = f.querySelector('.pn-name').value.trim(), msg = f.querySelector('.ufmsg');
      var acronym = f.querySelector('.pn-acr').value.trim();
      var address = f.querySelector('.pn-addr').value.trim();
      var phone = f.querySelector('.pn-phone').value.trim();
      var website = f.querySelector('.pn-web').value.trim();
      var col = f.querySelector('.pn-color').value;
      var leadId = f.querySelector('.pn-lead').value ? +f.querySelector('.pn-lead').value : null;
      if (!name){ msg.textContent = 'Partner name is required.'; return; }
      msg.textContent = 'Saving…';
      if (d){ d.name = name; d.acronym = acronym; d.address = address; d.phone = phone; d.website = website; d.color = col; d.lead_id = leadId; applyPartnerMutation(DB.persist('partner', [d])); }
      else { applyPartnerMutation(DB.insert('partner', { name: name, acronym: acronym, address: address, phone: phone, website: website, color: col, lead_id: leadId })); }
    };
    body.appendChild(f);
    $('#partnerEditOverlay').classList.add('on');
    var fn = f.querySelector('.pn-name'); if (fn) fn.focus();
  }
  function closePartnerEdit(){ var o = $('#partnerEditOverlay'); if (o) o.classList.remove('on'); }
  function deletePartner(d){
    if (partnerProjectCount(d.id)) return;   // guarded in the UI too
    Promise.resolve(DB.remove('partner', [d.id])).then(function (){ enrich(); renderTicker(); renderAll(); renderControl('partners'); });
  }

  // =========================================================================
  //  CONTROL PANEL - Regions / Countries tabs (assign Leads; Admin only)
  // =========================================================================
  // Inline Lead dropdown for a lookup row - selecting a user persists the row's
  // lead_id immediately (id-based, from the user list, never free-typed).
  function inlineLeadSelect(row, table){
    var s = el('select', 'geo-lead');
    // the affiliation keys equal the lookup table names ('region' / 'country')
    s.innerHTML = userOptions(row.lead_id != null ? +row.lead_id : null, table);
    s.onchange = function (){
      row.lead_id = s.value ? +s.value : null;
      DB.persist(table, [row]);
    };
    return s;
  }
  function regionLeadsEditor(){
    var box = el('div', 'cp-users cp-geo');
    box.appendChild(elHTML('div', 'cp-note', 'Assign an accountable <b>Lead</b> to each <b>region</b> - chosen from the user list, saved immediately on selection.'));

    // ---- regions (the six continents) --------------------------------------
    var rtbl = el('table', 'utbl');
    rtbl.innerHTML = '<thead><tr><th>Region</th><th>Countries</th><th>Projects</th><th>Lead</th></tr></thead>';
    var rtb = el('tbody');
    var projByRegion = {}; DB.tables.project.forEach(function (p){ if (p.region) projByRegion[p.region] = (projByRegion[p.region] || 0) + 1; });
    DB.tables.region.slice().sort(function (a, b){ return (a.seq || 0) - (b.seq || 0); }).forEach(function (rg){
      var nCty = DB.tables.country.reduce(function (n, c){ return n + (c.region_id === rg.id ? 1 : 0); }, 0);
      var tr = el('tr');
      tr.innerHTML = '<td><span class="udot" style="background:' + regionColor(rg.name) + '"></span>' + esc(rg.name) + '</td>'
        + '<td class="umono">' + fmt(nCty) + '</td>'
        + '<td class="umono">' + fmt(projByRegion[rg.name] || 0) + '</td>';
      var td = el('td', 'geo-lead-cell'); td.appendChild(inlineLeadSelect(rg, 'region')); tr.appendChild(td);
      rtb.appendChild(tr);
    });
    rtbl.appendChild(rtb); box.appendChild(rtbl);
    return box;
  }
  function countryLeadsEditor(){
    var box = el('div', 'cp-users cp-geo');
    box.appendChild(elHTML('div', 'cp-note', 'Assign an accountable <b>Lead</b> to each <b>country</b> - chosen from the user list, saved immediately on selection. Programme countries come seeded with their country-office user as Lead; reference-only countries start unassigned.'));

    // ---- countries (all of them, searchable) --------------------------------
    var q = el('input', 'geo-search');
    q.type = 'search'; q.placeholder = 'Search countries…';
    box.appendChild(q);
    var ctbl = el('table', 'utbl');
    ctbl.innerHTML = '<thead><tr><th>Country</th><th>Region</th><th>Projects</th><th>Lead</th></tr></thead>';
    var ctb = el('tbody');
    var rows = [];   // [{tr, hay}] for the search filter
    DB.tables.country.slice().sort(function (a, b){ return a.name < b.name ? -1 : 1; }).forEach(function (c){
      var nProj = (DB._idx.projectByCountry[c.iso3] || []).length;
      var tr = el('tr');
      tr.innerHTML = '<td>' + esc(c.name) + ' <span class="umono">' + esc(c.iso3) + '</span></td>'
        + '<td>' + esc(c.region || '') + '</td>'
        + '<td class="umono">' + fmt(nProj) + '</td>';
      var td = el('td', 'geo-lead-cell'); td.appendChild(inlineLeadSelect(c, 'country')); tr.appendChild(td);
      rows.push({ tr: tr, hay: (c.name + ' ' + c.iso3 + ' ' + (c.region || '')).toLowerCase() });
      ctb.appendChild(tr);
    });
    ctbl.appendChild(ctb); box.appendChild(ctbl);
    q.oninput = function (){
      var v = q.value.trim().toLowerCase();
      rows.forEach(function (r){ r.tr.style.display = (!v || r.hay.indexOf(v) >= 0) ? '' : 'none'; });
    };
    return box;
  }

  // =========================================================================
  //  COMMUNICATION - monthly PDF results reports for every Lead
  //  A report is a fixed snapshot: KPI values / progress / performance as of the
  //  end of the selected month, plus the month's activities and beneficiaries -
  //  the same numbers the app derives, scoped to what each Lead is accountable
  //  for. Reports are generated as real PDFs (built in-browser, zero libraries),
  //  stored in the `report` table, and emailed to each Lead from the panel.
  // =========================================================================
  var COMM_CATS = [
    { key:'plan',    label:'Plans',     one:'Plan' },
    { key:'impact',  label:'Impacts',   one:'Impact' },
    { key:'outcome', label:'Outcomes',  one:'Outcome' },
    { key:'output',  label:'Outputs',   one:'Output' },
    { key:'project', label:'Projects',  one:'Project' },
    { key:'donor',   label:'Donors',    one:'Donor' },
    { key:'partner', label:'Partners',  one:'Partner' },
    { key:'region',  label:'Regions',   one:'Region' },
    { key:'country', label:'Countries', one:'Country' }
  ];
  function commCatOne(cat){ var c = COMM_CATS.filter(function (x){ return x.key === cat; })[0]; return c ? c.one : cat; }
  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var COMM = { tab:'plan', year:null, month:null, busy:false };
  function p2(n){ return (n < 10 ? '0' : '') + n; }
  // Reports default to the last COMPLETED month (you report on a finished period).
  function commDefaultPeriod(){
    var d = new Date(TODAY), y = d.getFullYear(), m = d.getMonth();   // getMonth() is 0-based = previous 1-based month
    if (m === 0){ y--; m = 12; }
    return { year: y, month: m };
  }
  function commPeriodLabel(){ return MONTH_NAMES[COMM.month - 1] + ' ' + COMM.year; }
  // Reports cover what has happened - never a period after the current month.
  function commNow(){ var d = new Date(TODAY); return { y: d.getFullYear(), m: d.getMonth() + 1 }; }
  function commIsFuture(y, m){ var n = commNow(); return y > n.y || (y === n.y && m > n.m); }
  // A lead's email comes from their PROFILE (user.email - editable in My profile
  // and in Users Management). Accounts created before the field existed fall back
  // to the derived demo address so report delivery never silently loses them.
  function leadEmail(uid){
    var u = DB._idx.userById[uid];
    if (!u) return '';
    return u.email || (u.username + '@thegrassroots.org');
  }
  function commWhen(iso){
    var d = new Date(iso); if (isNaN(d)) return '';
    return MONTH_NAMES[d.getMonth()].slice(0,3) + ' ' + d.getDate() + ', ' + p2(d.getHours()) + ':' + p2(d.getMinutes());
  }

  // ---- who gets a report: every entity of a category that HAS a Lead ---------
  function commEntities(cat){
    var out = [];
    if (cat === 'plan'){
      allPlans().forEach(function (p){ if (p.lead_id != null) out.push({ cat:cat, ref:'plan:'+p.id, name:p.name, code:'', leadId:+p.lead_id }); });
    } else if (cat === 'impact' || cat === 'outcome' || cat === 'output'){
      var seen = {};
      DB.tables.result.forEach(function (r){
        if (r.plan_id !== S.plan || r.level !== cat || r.owner_id == null) return;
        var k = (r.sdg == null ? 0 : r.sdg) + '|' + r.statement;
        if (seen[k]) return; seen[k] = 1;
        out.push({ cat:cat, ref:cat+':'+k, name:r.statement, code:r.code || '', leadId:+r.owner_id, sdg:r.sdg, stmt:r.statement });
      });
    } else if (cat === 'project'){
      DB.tables.project.forEach(function (p){ if (p.plan_id === S.plan && p.lead_id != null) out.push({ cat:cat, ref:'project:'+p.id, name:p.name, code:p.code || '', leadId:+p.lead_id, project:p }); });
    } else if (cat === 'donor'){
      DB.tables.donor.forEach(function (d){ if (d.lead_id != null) out.push({ cat:cat, ref:'donor:'+d.id, name:d.name, code:d.short_name || '', leadId:+d.lead_id, donor:d }); });
    } else if (cat === 'partner'){
      DB.tables.partner.forEach(function (d){ if (d.lead_id != null) out.push({ cat:cat, ref:'partner:'+d.id, name:d.name, code:d.acronym || '', leadId:+d.lead_id, partner:d }); });
    } else if (cat === 'region'){
      DB.tables.region.forEach(function (r){ if (r.lead_id != null) out.push({ cat:cat, ref:'region:'+r.id, name:r.name, code:'', leadId:+r.lead_id, region:r }); });
    } else if (cat === 'country'){
      DB.tables.country.forEach(function (c){ if (c.lead_id != null) out.push({ cat:cat, ref:'country:'+c.iso3, name:c.name, code:c.iso3, leadId:+c.lead_id, country:c }); });
    }
    out.sort(function (a, b){ return a.code && b.code && a.code !== b.code ? (a.code < b.code ? -1 : 1) : (a.name < b.name ? -1 : 1); });
    return out;
  }
  // How many entities of a category still have NO lead (surfaced as a hint).
  function commUnassigned(cat){
    if (cat === 'plan') return allPlans().filter(function (p){ return p.lead_id == null; }).length;
    if (cat === 'impact' || cat === 'outcome' || cat === 'output'){
      // a statement is unassigned only when NO country instance carries an owner -
      // commEntities picks the first OWNED instance, so this stays its exact complement
      var all = {}, owned = {};
      DB.tables.result.forEach(function (r){
        if (r.plan_id !== S.plan || r.level !== cat) return;
        var k = (r.sdg == null ? 0 : r.sdg) + '|' + r.statement;
        all[k] = 1;
        if (r.owner_id != null) owned[k] = 1;
      });
      return Object.keys(all).filter(function (k){ return !owned[k]; }).length;
    }
    if (cat === 'project') return DB.tables.project.filter(function (p){ return p.plan_id === S.plan && p.lead_id == null; }).length;
    if (cat === 'donor') return DB.tables.donor.filter(function (d){ return d.lead_id == null; }).length;
    if (cat === 'partner') return DB.tables.partner.filter(function (d){ return d.lead_id == null; }).length;
    if (cat === 'region') return DB.tables.region.filter(function (r){ return r.lead_id == null; }).length;
    if (cat === 'country') return DB.tables.country.filter(function (c){ return c.lead_id == null; }).length;
    return 0;
  }

  // ---- the KPIs a report covers (the entity's scope) --------------------------
  function commIndicators(ent){
    var cat = ent.cat, all = DB.tables.indicator;
    if (cat === 'plan'){
      var pid = +ent.ref.split(':')[1];
      return all.filter(function (i){ return indicatorPlanId(i) === pid; });
    }
    if (cat === 'impact' || cat === 'outcome' || cat === 'output'){
      // every KPI under any country instance of the statement's subtree; sdg must
      // match EXACTLY (null only pairs with null), or a null-sdg entity would
      // swallow every same-statement subtree of every sdg
      var roots = DB.tables.result.filter(function (r){ return r.plan_id === S.plan && r.level === cat && r.statement === ent.stmt && (ent.sdg == null ? r.sdg == null : r.sdg === ent.sdg); });
      var byParent = {};
      DB.tables.result.forEach(function (r){ if (r.parent_id != null) (byParent[r.parent_id] = byParent[r.parent_id] || []).push(r); });
      var ids = {}, stack = roots.slice();
      while (stack.length){ var n = stack.pop(); ids[n.id] = 1; (byParent[n.id] || []).forEach(function (c){ stack.push(c); }); }
      return all.filter(function (i){ return i.result_id != null && ids[i.result_id]; });
    }
    if (cat === 'project'){
      var p = ent.project;
      var prim = (DB._idx.projectKpiByProject[p.id] || []).map(function (pk){ return DB._idx.indicatorById[pk.indicator_id]; }).filter(Boolean);
      return prim.concat(DB._idx.secondaryByProject[p.id] || []);
    }
    if (cat === 'donor' || cat === 'partner'){
      // active plan only - commProjectsFor lists the entity's ACTIVE-plan projects,
      // so the KPI scope (headline tiles, forecast) must cover the same universe
      var entId = cat === 'donor' ? ent.donor.id : ent.partner.id;
      var fld = cat === 'donor' ? 'donor_id' : 'partner_id';
      var set = {}, res = [];
      DB.tables.project.forEach(function (p){
        if (p[fld] !== entId || p.plan_id !== S.plan) return;
        (DB._idx.projectKpiByProject[p.id] || []).forEach(function (pk){
          if (!set[pk.indicator_id]){ set[pk.indicator_id] = 1; var i = DB._idx.indicatorById[pk.indicator_id]; if (i) res.push(i); }
        });
        (DB._idx.secondaryByProject[p.id] || []).forEach(function (i){ if (!set[i.id]){ set[i.id] = 1; res.push(i); } });
      });
      return res;
    }
    // region / country: KPIs whose programme (or project) country falls in scope, active plan
    var isoSet = {};
    if (cat === 'country') isoSet[ent.country.iso3] = 1;
    else DB.tables.country.forEach(function (c){ if (c.region_id === ent.region.id) isoSet[c.iso3] = 1; });
    return all.filter(function (i){
      if (indicatorPlanId(i) !== S.plan) return false;
      var iso = null;
      if (i.result_id != null){ var r = DB._idx.resultById[i.result_id], pg = r ? DB._idx.programmeById[r.programme_id] : null; iso = pg ? pg.country_iso3 : null; }
      else if (i.project_id != null){ var pj = DB._idx.projectById[i.project_id]; iso = pj ? pj.country_iso3 : null; }
      return !!(iso && isoSet[iso]);
    });
  }
  // A KPI snapshot AS OF the end of the report month (same maths the app uses,
  // with the clock stopped at month end): value / progress / performance status,
  // plus the month's own activity count and beneficiary reach.
  // `projId` (optional): a project-lead report must count only the month's OWN
  // activity - primary KPIs are shared across projects, and sibling projects'
  // measurements must not inflate this project's activity/reach cards. The KPI
  // value/progress stay the portfolio roll-up (same as the KPI inventory view).
  function commSnapshot(ind, startISO, endISO, projId){
    var upto = DB.measurementsFor(ind.id).filter(function (m){ return m.date && m.date <= endISO; });
    var inMonth = upto.filter(function (m){ return m.date >= startISO; });
    if (projId != null) inMonth = inMonth.filter(function (m){ return m.project_id === projId; });
    var b = ind.baseline_value, t = ind.target_value;
    var v = indicatorValue(ind, upto);
    // No baseline/target or a zero gap is unmeasurable (null); no report yet as of
    // month end counts as 0% progress -> Under Track (not excluded from the report).
    var progress = (t == null || b == null || +t === +b) ? null : (v == null ? 0 : (v - b) / (t - b));
    var perf = progress == null ? null : progress / elapsedFraction(ind, endISO);
    var ben = 0;
    inMonth.forEach(function (m){ (DB._idx.benByMeasurement[m.id] || []).forEach(function (x){ ben += (+x.value || 0); }); });
    return { value: v, progress: progress, perf: perf, code: ratioToCode(perf), acts: inMonth.length, ben: ben };
  }

  // ---- organization profile ---------------------------------------------------
  //  The About modal's "Your organization" tab. Lives ONLY in localStorage (like
  //  the Brevo mail settings) - never in the DB or the SQL export. When the
  //  profile is ACTIVATED (and carries a name), every PDF export swaps The
  //  Grassroots identity for the organization's: band title, footer, file name,
  //  and - when a logo was uploaded - the logo instead of the orbit mark.
  var ORG_KEY = 'gr_org_profile_v1';
  var _orgCache;
  function orgProfile(){
    if (_orgCache === undefined){
      _orgCache = null;
      try { var o = JSON.parse(localStorage.getItem(ORG_KEY)); if (o && typeof o === 'object') _orgCache = o; } catch (e) {}
    }
    return _orgCache || {};
  }
  function orgSaveProfile(o){
    _orgCache = o;
    try { localStorage.setItem(ORG_KEY, JSON.stringify(o)); } catch (e) {}
  }
  function orgActive(){ var o = orgProfile(); return !!(o.enabled && String(o.name || '').trim()); }
  // Long form ("Sahel Development Trust") - band titles, footers, sender names.
  function orgBrand(){ return orgActive() ? String(orgProfile().name).trim() : 'The Grassroots'; }
  // Short form (acronym when given) - file names, tight spots.
  function orgShort(){
    var o = orgProfile();
    return orgActive() ? (String(o.acronym || '').trim() || String(o.name).trim()) : 'The Grassroots';
  }
  // Uploaded logo decoded to raw JPEG bytes for PDF embedding; null when the
  // profile is off or has no logo. Cached per data-URL.
  var _orgLogoBin = null;
  function orgLogo(){
    if (!orgActive()) return null;
    var o = orgProfile();
    if (!o.logo || !o.logo.jpeg) return null;
    if (!_orgLogoBin || _orgLogoBin.src !== o.logo.jpeg){
      try { _orgLogoBin = { src: o.logo.jpeg, data: atob(String(o.logo.jpeg).split(',')[1]), w: o.logo.w, h: o.logo.h }; }
      catch (e) { return null; }
    }
    return _orgLogoBin;
  }
  // Read an uploaded image file, flatten any transparency onto white (JPEG has
  // no alpha) and downscale - big enough for a 300 dpi letterhead, small enough
  // for localStorage.
  function orgReadLogo(file, done){
    var rd = new FileReader();
    rd.onload = function (){
      var img = new Image();
      img.onload = function (){
        var s = Math.min(1, 160 / img.height, 480 / img.width);
        var w = Math.max(1, Math.round(img.width * s)), h = Math.max(1, Math.round(img.height * s));
        var cv = document.createElement('canvas'); cv.width = w; cv.height = h;
        var cx = cv.getContext('2d');
        cx.fillStyle = '#ffffff'; cx.fillRect(0, 0, w, h);
        cx.drawImage(img, 0, 0, w, h);
        done({ jpeg: cv.toDataURL('image/jpeg', 0.92), w: w, h: h });
      };
      img.onerror = function (){ done(null); };
      img.src = rd.result;
    };
    rd.onerror = function (){ done(null); };
    rd.readAsDataURL(file);
  }

  // ---- brand mark for the PDF letterheads -------------------------------------
  // The orbit mark from assets/icon.svg, redrawn as raw content-stream ops
  // (both PDF writers speak the same op syntax): a ring, a satellite dot on the
  // upper-right rim, and a soft centre dot. The centre dot is 55% opacity on
  // screen; neither writer supports alpha, so its colour is pre-flattened
  // against the navy band. (cx, cy) is the ring centre in page points (y up);
  // u scales the 512-unit icon geometry.
  function pdfMarkOps(cx, cy, u){
    function n(v){ return (Math.round(v * 100) / 100).toString(); }
    function cv(hex){
      var h = parseInt(hex.slice(1), 16);
      return ((h >> 16 & 255) / 255).toFixed(3) + ' ' + ((h >> 8 & 255) / 255).toFixed(3) + ' ' + ((h & 255) / 255).toFixed(3);
    }
    function circle(x, y, r){
      var c = r * 0.5523;
      return n(x - r) + ' ' + n(y) + ' m '
        + n(x - r) + ' ' + n(y + c) + ' ' + n(x - c) + ' ' + n(y + r) + ' ' + n(x) + ' ' + n(y + r) + ' c '
        + n(x + c) + ' ' + n(y + r) + ' ' + n(x + r) + ' ' + n(y + c) + ' ' + n(x + r) + ' ' + n(y) + ' c '
        + n(x + r) + ' ' + n(y - c) + ' ' + n(x + c) + ' ' + n(y - r) + ' ' + n(x) + ' ' + n(y - r) + ' c '
        + n(x - c) + ' ' + n(y - r) + ' ' + n(x - r) + ' ' + n(y - c) + ' ' + n(x - r) + ' ' + n(y) + ' c h';
    }
    return [
      'q ' + cv('#ffffff') + ' RG ' + n(36 * u) + ' w ' + circle(cx, cy, 178 * u) + ' S Q',
      'q ' + cv('#92abc4') + ' rg ' + circle(cx, cy, 34 * u) + ' f Q',
      'q ' + cv('#ffffff') + ' rg ' + circle(cx + 126 * u, cy + 126 * u, 58 * u) + ' f Q'
    ];
  }

  // Letterhead identity for the pdfWriter docs (results + forecast exports):
  // navy band, gold root-line, then either the Grassroots orbit mark + wordmark
  // or - when the organization profile is active - the org's logo (on a white
  // chip, so any logo reads on the navy) and name, shrunk to fit and falling
  // back to the acronym when even that is too long. maxRight caps the title so
  // it never collides with the caller's right-hand band text.
  function pdfBrandHead(doc, M, maxRight){
    doc.rect(0, doc.PH - 44, doc.PW, 44, doc.rgb('#0c447c'));
    doc.rect(0, doc.PH - 48, doc.PW, 4, doc.rgb('#FCC30B'));   // a grassroots accent root-line
    var x = M + 34, logo = orgLogo();
    if (logo){
      var lh = 26, lw = lh * logo.w / logo.h;
      if (lw > 84){ lw = 84; lh = lw * logo.h / logo.w; }
      doc.roundRect(M, doc.PH - 22 - lh / 2 - 4, lw + 8, lh + 8, 3, [1, 1, 1]);
      doc.image(logo, M + 4, doc.PH - 22 - lh / 2, lw, lh);
      x = M + lw + 8 + 10;
    } else if (!orgActive()){
      pdfMarkOps(M + 13, doc.PH - 22, 0.065).forEach(function (o){ doc.raw(o); });
    } else {
      x = M;   // active profile without a logo: the name starts at the margin
    }
    var name = orgBrand().toUpperCase(), sz = 11, avail = maxRight - x;
    while (sz > 8 && doc.textW(name, sz, true) > avail) sz -= 0.5;
    if (doc.textW(name, sz, true) > avail && orgActive() && String(orgProfile().acronym || '').trim()){
      name = String(orgProfile().acronym).trim().toUpperCase(); sz = 11;
      while (sz > 8 && doc.textW(name, sz, true) > avail) sz -= 0.5;
    }
    doc.text(name, x, doc.PH - 26, { size: sz, bold: true, color: [1, 1, 1] });
  }

  // ---- a tiny PDF writer (PDF 1.4, Helvetica, zero dependencies) --------------
  var PDF_W = 595.28, PDF_H = 841.89;   // A4 portrait, points
  function PdfDoc(){ this.pagesOps = []; this.ops = null; this.newPage(); }
  PdfDoc.prototype.newPage = function (){ this.ops = []; this.pagesOps.push(this.ops); };
  function pdfEsc(s){
    s = String(s == null ? '' : s); var out = '';
    for (var i = 0; i < s.length; i++){
      var c = s.charCodeAt(i), ch = s.charAt(i);
      if (c === 40 || c === 41 || c === 92) out += '\\' + ch;
      else if (c === 8226) out += '-';
      else if (c > 255) out += '?';
      else out += ch;
    }
    return out;
  }
  function pdfCol(hex){ var r = hexToRgb(hex); return (r[0]/255).toFixed(3) + ' ' + (r[1]/255).toFixed(3) + ' ' + (r[2]/255).toFixed(3); }
  PdfDoc.prototype.text = function (x, y, s, size, bold, color){
    this.ops.push('BT /F' + (bold ? 2 : 1) + ' ' + size + ' Tf ' + pdfCol(color || '#1e293b') + ' rg 1 0 0 1 ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' Tm (' + pdfEsc(s) + ') Tj ET');
  };
  PdfDoc.prototype.rect = function (x, y, w, h, color){
    this.ops.push(pdfCol(color) + ' rg ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' ' + w.toFixed(2) + ' ' + h.toFixed(2) + ' re f');
  };
  PdfDoc.prototype.line = function (x1, y1, x2, y2, color, w){
    this.ops.push(pdfCol(color) + ' RG ' + (w || 0.7) + ' w ' + x1.toFixed(2) + ' ' + y1.toFixed(2) + ' m ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' l S');
  };
  // Place a JPEG (img = { data: raw bytes as a binary string, w, h }) - the org
  // logo on the letterhead. Registered once per doc, referenced as /ImN.
  PdfDoc.prototype.image = function (img, x, y, w, h){
    this.images = this.images || [];
    var i = this.images.indexOf(img);
    if (i < 0){ i = this.images.length; this.images.push(img); }
    this.ops.push('q ' + w.toFixed(2) + ' 0 0 ' + h.toFixed(2) + ' ' + x.toFixed(2) + ' ' + y.toFixed(2) + ' cm /Im' + (i + 1) + ' Do Q');
  };
  // Helvetica width approximation (avg ~0.5em) - good enough to truncate/right-align.
  function pdfW(s, size){ return String(s == null ? '' : s).length * size * 0.5; }
  function pdfTrunc(s, size, maxW){
    s = String(s == null ? '' : s);
    if (pdfW(s, size) <= maxW) return s;
    var n = Math.max(1, Math.floor(maxW / (size * 0.5)) - 3);
    return s.slice(0, n) + '...';
  }
  function pdfWrap(s, size, maxW){
    var words = String(s == null ? '' : s).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w){
      var t = cur ? cur + ' ' + w : w;
      if (pdfW(t, size) > maxW && cur){ lines.push(cur); cur = w; } else cur = t;
    });
    if (cur) lines.push(cur);
    return lines;
  }
  PdfDoc.prototype.build = function (){
    // objects: 1 catalog · 2 pages · 3-4 fonts · 5..4+k images · then page/content pairs
    var n = this.pagesOps.length, imgs = this.images || [], k = imgs.length, objs = [], kids = [];
    for (var i = 0; i < n; i++) kids.push((5 + k + i * 2) + ' 0 R');
    objs.push('<< /Type /Catalog /Pages 2 0 R >>');
    objs.push('<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + n + ' >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    imgs.forEach(function (im){
      objs.push('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h
        + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length
        + ' >>\nstream\n' + im.data + '\nendstream');
    });
    var xres = k ? ' /XObject << ' + imgs.map(function (_, j){ return '/Im' + (j + 1) + ' ' + (5 + j) + ' 0 R'; }).join(' ') + ' >>' : '';
    this.pagesOps.forEach(function (ops, i){
      objs.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PDF_W + ' ' + PDF_H + '] /Resources << /Font << /F1 3 0 R /F2 4 0 R >>' + xres + ' >> /Contents ' + (6 + k + i * 2) + ' 0 R >>');
      var stream = ops.join('\n');
      objs.push('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
    });
    var out = '%PDF-1.4\n', offs = [0];
    objs.forEach(function (o, i){ offs.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    var xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n';
    for (var j = 1; j <= objs.length; j++) out += ('0000000000' + offs[j]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF';
    return out;
  };

  // ---- build one Lead's monthly report PDF ------------------------------------
  //  PROJECT reports drill into the project's KPIs. Every OTHER report lists
  //  PROJECTS - grouped one level down the results chain, so a Lead reads their
  //  scope the way the framework hangs together:
  //    Plan -> projects under each Impact · Impact -> under each Outcome ·
  //    Outcome -> under each Output · Region -> under each country ·
  //    Output / Donor / Country -> a flat project list.
  var COMM_BRAND = '#0c447c';   // brand dark blue (matches the results-export letterhead)
  function commProjectKpis(p){
    var prim = (DB._idx.projectKpiByProject[p.id] || []).map(function (pk){ return DB._idx.indicatorById[pk.indicator_id]; }).filter(Boolean);
    return prim.concat(DB._idx.secondaryByProject[p.id] || []);
  }
  // Projects in an entity's scope, each with the KPIs that tie it to that scope.
  function commProjectsFor(ent){
    var cat = ent.cat;
    if (cat === 'plan'){
      var pid = +ent.ref.split(':')[1];
      return DB.tables.project.filter(function (p){ return p.plan_id === pid; })
        .map(function (p){ return { p: p, kpis: commProjectKpis(p) }; });
    }
    if (cat === 'donor' || cat === 'partner' || cat === 'region' || cat === 'country'){
      var ok;
      if (cat === 'donor') ok = function (p){ return p.donor_id === ent.donor.id; };
      else if (cat === 'partner') ok = function (p){ return p.partner_id === ent.partner.id; };
      else if (cat === 'country') ok = function (p){ return p.country_iso3 === ent.country.iso3; };
      else { var iso = {}; DB.tables.country.forEach(function (c){ if (c.region_id === ent.region.id) iso[c.iso3] = 1; }); ok = function (p){ return !!iso[p.country_iso3]; }; }
      return DB.tables.project.filter(function (p){ return p.plan_id === S.plan && ok(p); })
        .map(function (p){ return { p: p, kpis: commProjectKpis(p) }; });
    }
    // impact / outcome / output: projects reporting against KPIs in the node's subtree
    var scope = {};
    commIndicators(ent).forEach(function (i){ scope[i.id] = 1; });
    var rows = [];
    DB.tables.project.forEach(function (p){
      if (p.plan_id !== S.plan) return;
      var ks = commProjectKpis(p).filter(function (i){ return scope[i.id]; });
      if (ks.length) rows.push({ p: p, kpis: ks });
    });
    return rows;
  }
  // Section groups one level down the chain; each project lands in the group it
  // contributes the most KPIs to (so it appears exactly once). Returns null for
  // flat categories (output / donor / country).
  function commGroups(ent, projRows){
    var cat = ent.cat;
    if (cat === 'region'){
      var by = {};
      projRows.forEach(function (r){ var c = DB._idx.countryByIso[r.p.country_iso3]; var k = c ? c.name : (r.p.country_iso3 || '?'); (by[k] = by[k] || []).push(r); });
      return Object.keys(by).sort().map(function (k){ return { code: '', name: k, title: k, color: null, rows: by[k] }; });
    }
    var level = cat === 'plan' ? 'impact' : cat === 'impact' ? 'outcome' : cat === 'outcome' ? 'output' : null;
    if (!level) return null;
    var planId = cat === 'plan' ? +ent.ref.split(':')[1] : S.plan;
    var rById = DB._idx.resultById;
    var kids = {}, order = [];
    DB.tables.result.forEach(function (r){
      if (r.plan_id !== planId || r.level !== level) return;
      if (cat !== 'plan'){
        var par = rById[r.parent_id];
        if (!par || par.statement !== ent.stmt || (ent.sdg == null ? par.sdg != null : par.sdg !== ent.sdg)) return;
      }
      var k = (r.sdg == null ? 0 : r.sdg) + '|' + r.statement;
      if (!kids[k]){
        var gname = level === 'impact' ? (r.pillar_name || r.statement) : r.statement;
        kids[k] = { key: k, code: r.code || '', name: gname, title: (r.code ? r.code + ' · ' : '') + gname,
          color: level === 'impact' ? (r.pillar_color || PILLAR_COLORS[r.sdg] || '#94a3b8') : null, ids: {}, rows: [] };
        order.push(kids[k]);
      }
    });
    // each group's KPI id-set via its subtree (byParent built once per report)
    var byParent = {};
    DB.tables.result.forEach(function (r){ if (r.parent_id != null) (byParent[r.parent_id] = byParent[r.parent_id] || []).push(r); });
    DB.tables.result.forEach(function (r){
      if (r.plan_id !== planId || r.level !== level) return;
      var g = kids[(r.sdg == null ? 0 : r.sdg) + '|' + r.statement]; if (!g) return;
      var stack = [r];
      while (stack.length){
        var n = stack.pop();
        (DB._idx.indicatorByResult[n.id] || []).forEach(function (i){ g.ids[i.id] = 1; });
        (byParent[n.id] || []).forEach(function (c){ stack.push(c); });
      }
    });
    var other = { code: '', name: 'Project-specific KPIs (no framework parent)', title: 'Project-specific KPIs (no framework parent)', color: null, rows: [] };
    projRows.forEach(function (row){
      var best = null, bestN = 0;
      order.forEach(function (g){
        var n = 0; row.kpis.forEach(function (i){ if (g.ids[i.id]) n++; });
        if (n > bestN){ bestN = n; best = g; }
      });
      (best || other).rows.push(row);
    });
    var out = order.filter(function (g){ return g.rows.length; });
    out.sort(function (a, b){ return a.title < b.title ? -1 : 1; });
    if (other.rows.length) out.push(other);
    return out;
  }
  // A project's monthly snapshot: mean KPI progress/performance as of month end,
  // plus the activities logged and people reached during the month.
  function commProjectSnap(row, startISO, endISO){
    var progs = [], perfs = [];
    row.kpis.forEach(function (ind){
      var s = commSnapshot(ind, startISO, endISO);
      if (s.progress != null){ progs.push(s.progress); perfs.push(s.perf); }
    });
    // count only measurements against the KPIs that tie the project to THIS scope
    // (row.kpis) - an Outcome lead's table must not absorb the project's activity
    // under sibling outcomes, or overlapping scopes double-attribute the same work
    var inScope = {}; row.kpis.forEach(function (i){ inScope[i.id] = 1; });
    var acts = 0, ben = 0;
    (DB._idx.measByProject[row.p.id] || []).forEach(function (m){
      if (inScope[m.indicator_id] && m.date && m.date >= startISO && m.date <= endISO){ acts++; ben += benTotalFor(m.id); }
    });
    function avg(a){ var s = 0; a.forEach(function (x){ s += x; }); return a.length ? s / a.length : null; }
    var progress = avg(progs), perf = avg(perfs);
    return { progress: progress, perf: perf, code: progress == null ? 'nodata' : ratioToCode(perf), acts: acts, ben: ben };
  }
  function commBuildPdf(ent, year, month){
    var startISO = year + '-' + p2(month) + '-01';
    var lastDay = new Date(year, month, 0).getDate();
    var endISO = year + '-' + p2(month) + '-' + p2(lastDay);
    var period = MONTH_NAMES[month - 1] + ' ' + year;
    var asOf = lastDay + ' ' + MONTH_NAMES[month - 1] + ' ' + year;
    var leadNm = userName(ent.leadId);
    var catLabel = commCatOne(ent.cat);
    var projMode = ent.cat !== 'project';
    var snaps = null, projRows = null, groups = null, total;
    var acts = 0, ben = 0, counts = { blue:0, green:0, amber:0, red:0, maroon:0, black:0, nodata:0 };
    if (projMode){
      projRows = commProjectsFor(ent);
      projRows.forEach(function (row){ row.s = commProjectSnap(row, startISO, endISO); });
      projRows.sort(function (a, b){ return String(a.p.code || a.p.name) < String(b.p.code || b.p.name) ? -1 : 1; });
      groups = commGroups(ent, projRows);
      projRows.forEach(function (row){ acts += row.s.acts; ben += row.s.ben; counts[row.s.code]++; });
      total = projRows.length;
    } else {
      var inds = commIndicators(ent);
      snaps = inds.map(function (ind){ return { ind: ind, s: commSnapshot(ind, startISO, endISO, ent.project.id) }; });
      snaps.sort(function (a, b){ return String(a.ind.code || '') < String(b.ind.code || '') ? -1 : 1; });
      snaps.forEach(function (x){ acts += x.s.acts; ben += x.s.ben; counts[x.s.code]++; });
      total = snaps.length;
    }
    var noun = projMode ? 'project' : 'KPI';
    var withData = total - counts.nodata, onTrack = counts.blue + counts.green;

    var doc = new PdfDoc(), M = 46, y;
    var ink = '#1e293b', mut = '#64748b', faint = '#f1f5f9';
    // header band - a slim brand strip
    doc.rect(0, PDF_H - 44, PDF_W, 44, COMM_BRAND);
    doc.rect(0, PDF_H - 48, PDF_W, 4, '#FCC30B');   // a grassroots accent root-line
    // pdfW's 0.5em/char average runs short on bold uppercase (~0.67em) and mixed
    // case (~0.58em) - widen those estimates so the band's labels never collide.
    var pw = pdfW(period, 10.5) * 1.15;
    doc.text(PDF_W - M - pw, PDF_H - 26, period, 10.5, true, '#ffffff');
    var scopeTxt = catLabel.toUpperCase() + (ent.code ? ' - ' + ent.code : '');
    var scopeX = PDF_W - M - pw - 14 - pdfW(scopeTxt, 7.5) * 1.2;
    doc.text(scopeX, PDF_H - 26, scopeTxt, 7.5, false, '#d7e3f0');
    // brand identity: the org logo + name when the profile is active, the
    // Grassroots mark otherwise (same fallbacks as pdfBrandHead)
    var bx = M + 34, logo = orgLogo();
    if (logo){
      var lgH = 26, lgW = lgH * logo.w / logo.h;
      if (lgW > 84){ lgW = 84; lgH = lgW * logo.h / logo.w; }
      doc.rect(M, PDF_H - 22 - lgH / 2 - 4, lgW + 8, lgH + 8, '#ffffff');
      doc.image(logo, M + 4, PDF_H - 22 - lgH / 2, lgW, lgH);
      bx = M + lgW + 8 + 10;
    } else if (!orgActive()){
      pdfMarkOps(M + 13, PDF_H - 22, 0.065).forEach(function (o){ doc.ops.push(o); });
    } else {
      bx = M;
    }
    var bandNm = orgBrand().toUpperCase();
    var bandAvail = scopeX - 14 - bx - (pdfW('Monthly Results Report', 8.5) * 1.15 + 12);
    var bandF = 11;
    while (bandF > 8 && pdfW(bandNm, bandF) * 1.4 > bandAvail) bandF -= 0.5;
    if (pdfW(bandNm, bandF) * 1.4 > bandAvail && orgActive() && String(orgProfile().acronym || '').trim()){
      bandNm = String(orgProfile().acronym).trim().toUpperCase(); bandF = 11;
      while (bandF > 8 && pdfW(bandNm, bandF) * 1.4 > bandAvail) bandF -= 0.5;
    }
    doc.text(bx, PDF_H - 26, bandNm, bandF, true, '#ffffff');
    doc.text(bx + pdfW(bandNm, bandF) * 1.4 + 12, PDF_H - 26, 'Monthly Results Report', 8.5, false, '#d7e3f0');
    // prepared-for block
    y = PDF_H - 78;
    doc.text(M, y, 'PREPARED FOR', 7, true, mut);
    doc.text(M, y - 15, leadNm, 12.5, true, ink);
    doc.text(M, y - 28, leadEmail(ent.leadId), 8.5, false, mut);
    doc.text(300, y, 'SCOPE', 7, true, mut);
    doc.text(300, y - 15, pdfTrunc((ent.code ? ent.code + ' - ' : '') + ent.name, 10.5, PDF_W - M - 300), 10.5, true, ink);
    doc.text(300, y - 28, catLabel + ' - as of ' + asOf, 8.5, false, mut);
    // narrative
    y -= 50;
    var grouping = ent.cat === 'plan' ? ' Projects are grouped by the Impact they contribute to.'
      : ent.cat === 'impact' ? ' Projects are grouped by the Outcome they contribute to.'
      : ent.cat === 'outcome' ? ' Projects are grouped by the Output they contribute to.'
      : ent.cat === 'region' ? ' Projects are grouped by country.' : '';
    var story = 'During ' + period + ', ' + fmt(acts) + ' activit' + (acts === 1 ? 'y was' : 'ies were') + ' logged across the ' + total +
      ' ' + noun + (total === 1 ? '' : 's') + ' in this scope, reaching ' + fmt(ben) + ' people. ' +
      (withData ? onTrack + ' of ' + withData + ' ' + noun + 's with data are on or over track.' : 'No data has been reported in this scope yet.') + grouping;
    pdfWrap(story, 9.5, PDF_W - 2 * M).forEach(function (ln){ doc.text(M, y, ln, 9.5, false, ink); y -= 13; });
    // summary cards
    y -= 10;
    var cards = [
      { v: fmt(total), l: noun.toUpperCase() + 'S IN SCOPE', c: COMM_BRAND },
      { v: fmt(acts), l: 'ACTIVITIES THIS MONTH', c: '#2563eb' },
      { v: fmt(ben), l: 'PEOPLE REACHED', c: '#9D7BEE' },
      { v: withData ? Math.round(100 * onTrack / withData) + '%' : '–', l: 'ON / OVER TRACK', c: '#16a34a' }
    ];
    var cw = (PDF_W - 2 * M - 3 * 10) / 4;
    cards.forEach(function (cd, i){
      var cx = M + i * (cw + 10);
      doc.rect(cx, y - 46, cw, 46, faint);
      doc.rect(cx, y - 46, 2.5, 46, cd.c);
      doc.text(cx + 10, y - 20, cd.v, 14, true, cd.c);
      doc.text(cx + 10, y - 36, cd.l, 6.5, true, mut);
    });
    y -= 66;
    // status distribution bar
    doc.text(M, y, 'PERFORMANCE STATUS', 7, true, mut);
    y -= 12;
    var order = ['blue','green','amber','red','maroon','black'], barW = PDF_W - 2 * M, bx = M;
    if (total){
      order.forEach(function (k){
        var w = barW * counts[k] / total;
        if (w > 0){ doc.rect(bx, y - 9, w, 9, STATUS[k].c); bx += w; }
      });
    } else doc.rect(M, y - 9, barW, 9, faint);
    y -= 22;
    var lx = M;
    order.forEach(function (k){
      if (!counts[k]) return;
      doc.rect(lx, y - 1.5, 6, 6, STATUS[k].c);
      var lbl = STATUS[k].label + ' ' + counts[k];
      doc.text(lx + 9, y, lbl, 7.5, false, mut);
      lx += 9 + pdfW(lbl, 7.5) + 14;
    });
    y -= 24;
    // table columns per mode (KPI drill-down for a project; projects otherwise).
    // The STATUS pill is NOT a flowed column - it anchors to the table's right
    // edge, leaving clear air after the right-aligned PROG/PERF numbers.
    var cols = projMode ? [
      { t:'CODE', w:54 }, { t:'PROJECT', w:126 }, { t:'COUNTRY', w:52 }, { t:'DONOR', w:34 },
      { t:'BUDGET', w:42, r:1 }, { t:'KPIS', w:26, r:1 }, { t:'ACT', w:24, r:1 }, { t:'PROG %', w:32, r:1 }, { t:'PERF %', w:32, r:1 }
    ] : [
      { t:'CODE', w:58 }, { t:'KPI', w:150 }, { t:'UNIT', w:28 }, { t:'BASE', w:40, r:1 },
      { t:'TARGET', w:40, r:1 }, { t:'VALUE', w:40, r:1 }, { t:'PROG %', w:32, r:1 }, { t:'PERF %', w:32, r:1 }
    ];
    var pillW = 50, pillX = PDF_W - M - pillW;
    function tableHead(){
      var x = M;
      cols.forEach(function (c){ doc.text(c.r ? x + c.w - pdfW(c.t, 6) : x, y, c.t, 6, true, mut); x += c.w; });
      doc.text(PDF_W - M - pdfW('STATUS', 6), y, 'STATUS', 6, true, mut);
      y -= 5; doc.line(M, y, PDF_W - M, y, '#cbd5e1', 0.8); y -= 13;
    }
    function pageBreak(need){
      if (y >= need) return;
      doc.newPage(); y = PDF_H - 54;
      doc.text(M, y, pdfTrunc(ent.name, 9, 330) + ' - ' + period + ' (continued)', 9, true, mut);
      y -= 20; tableHead();
    }
    function footer(){
      doc.pagesOps.forEach(function (ops, i){
        var save = doc.ops; doc.ops = ops;
        doc.line(M, 42, PDF_W - M, 42, '#e2e8f0', 0.6);
        doc.text(M, 30, orgBrand() + ' - ' + catLabel + ' report - ' + pdfTrunc(ent.name, 7.5, 260) + ' - ' + period, 7.5, false, mut);
        var pg = 'Page ' + (i + 1) + ' of ' + doc.pagesOps.length;
        doc.text(PDF_W - M - pdfW(pg, 7.5), 30, pg, 7.5, false, mut);
        doc.ops = save;
      });
    }
    var MAXROWS = 150, shown = 0, truncated = 0;
    function statusPill(code){
      doc.rect(pillX, y - 2.5, pillW, 10.5, STATUS[code].c);
      var slb = STATUS[code].label.toUpperCase();
      doc.text(pillX + (pillW - pdfW(slb, 5.5)) / 2, y, slb, 5.5, true, '#ffffff');
    }
    function drawCells(cells, code){
      pageBreak(62);
      if (shown % 2 === 1) doc.rect(M - 4, y - 4, PDF_W - 2 * M + 8, 14.5, '#f8fafc');
      var x = M;
      cells.forEach(function (c, j){
        var col = cols[j];
        doc.text(col.r ? x + col.w - pdfW(String(c), 7) : x, y, String(c), 7, j === 0, j === 0 ? mut : ink);
        x += col.w;
      });
      statusPill(code);
      y -= 15.5; shown++;
    }
    function pct(v){ return v == null ? '–' : Math.round(v * 100) + '%'; }
    function drawProjRow(row){
      if (shown >= MAXROWS){ truncated++; return; }
      var p = row.p, s = row.s;
      var co = DB._idx.countryByIso[p.country_iso3], dn = DB._idx.donorById[p.donor_id];
      drawCells([
        p.code || '', pdfTrunc(p.name, 7, cols[1].w - 6), pdfTrunc(co ? co.name : (p.country_iso3 || ''), 7, cols[2].w - 4),
        dn ? (dn.short_name || '') : '', p.budget_usd != null ? '$' + fmtCompact(p.budget_usd) : '–',
        String(row.kpis.length), String(s.acts),
        pct(s.progress), pct(s.perf)
      ], s.code);
    }
    function groupHeader(g){
      if (y < 110){ doc.newPage(); y = PDF_H - 54; }
      doc.rect(M - 4, y - 3, 2.5, 11.5, g.color || '#94a3b8');
      doc.text(M + 4, y, pdfTrunc(g.title, 9.5, 370), 9.5, true, ink);
      var cnt = g.rows.length + ' project' + (g.rows.length === 1 ? '' : 's');
      doc.text(PDF_W - M - pdfW(cnt, 7.5), y, cnt, 7.5, false, mut);
      y -= 16; tableHead();
    }
    if (projMode){
      if (groups) groups.forEach(function (g){ groupHeader(g); g.rows.forEach(drawProjRow); y -= 6; });
      else { tableHead(); projRows.forEach(drawProjRow); }
      if (truncated) doc.text(M, y, '... and ' + truncated + ' more projects - open The Grassroots for the full list.', 8.5, false, mut);
      if (!projRows.length) doc.text(M, y, 'No projects fall in this scope for the active plan.', 9, false, mut);
    } else {
      tableHead();
      for (var i = 0; i < snaps.length; i++){
        if (shown >= MAXROWS){
          doc.text(M, y, '... and ' + (snaps.length - shown) + ' more KPIs - open The Grassroots for the full list.', 8.5, false, mut);
          break;
        }
        var sn = snaps[i], ind = sn.ind, s = sn.s;
        drawCells([
          ind.code || '', pdfTrunc(ind.name, 7, cols[1].w - 6), kpiUnit(ind) || '',
          fmtNum(ind.baseline_value), fmtNum(ind.target_value),
          s.value == null ? '–' : fmtNum(s.value),
          pct(s.progress), pct(s.perf)
        ], s.code);
      }
      if (!snaps.length) doc.text(M, y, 'No KPIs fall in this scope for the active plan.', 9, false, mut);
    }
    footer();
    return {
      b64: btoa(doc.build()),
      summary: total + ' ' + noun + (total === 1 ? '' : 's') + ' - ' + fmt(acts) + ' activities - ' + fmt(ben) + ' people reached'
    };
  }

  // The forecast companion that rides along with every results report - the same
  // detailed layout the Forecast tab exports (letterhead, plan stamp, headline
  // tiles, trajectory chart, advice and the breakdown table), but scoped the way
  // the results report is: the tiles/chart/advice cover the lead's entity, and
  // the table forecasts each PROJECT under it (a project lead drills into its
  // own KPIs instead). Always projected to the end of the active plan, free of
  // any on-screen filters. Returns the PDF base64-encoded for the email.
  function commBuildForecastPdf(ent, year, month){
    var period = MONTH_NAMES[month - 1] + ' ' + year;
    var asOf = new Date(year, month, 0).getDate() + ' ' + MONTH_NAMES[month - 1] + ' ' + year;
    var savedH = S.fcHorizon, savedD = S.fcDim, savedAsOf = FC_ASOF_MI;
    S.fcHorizon = 'plan';   // lead briefs always look to the end of the plan
    S.fcDim = 'projects';   // the breakdown below is per project (labels follow)
    // Anchor the brief to the SAME as-of snapshot as its results report (end of the
    // report month), never past today - so the NOW column tallies with the report's
    // progress instead of quietly folding in a later, still-open month's data.
    FC_ASOF_MI = Math.min(year * 12 + (month - 1), fcMi(TODAY.getTime()));
    try {
      // INDBYID only holds the ACTIVE plan's enriched rows; a lead of another
      // plan still gets a populated brief via a lightweight row (kpiForecast
      // needs only raw + series; label/colour fields ride along for per-KPI ents).
      function liteRow(i){
        var res = i.result_id != null ? DB._idx.resultById[i.result_id] : null;
        var pids = [];
        if (i.secondary && i.project_id != null) pids.push(i.project_id);
        (DB._idx.projectKpiByIndicator[i.id] || []).forEach(function (pk){ if (pids.indexOf(pk.project_id) < 0) pids.push(pk.project_id); });
        return { id: i.id, raw: i, name: i.name, unit: kpiUnit(i), sdg: res ? res.sdg : null,
                 series: DB.measurementsFor(i.id), projectIds: pids };
      }
      function toRows(inds){ return inds.map(function (i){ return INDBYID[i.id] || liteRow(i); }); }
      // the lead's whole scope drives the tiles, the chart and the advice
      var scope = fcEntity(ent.ref, (ent.code ? ent.code + ' - ' : '') + ent.name,
        commCatOne(ent.cat), COMM_BRAND, toRows(commIndicators(ent)));
      fcCompute(scope);
      var ents = [], groups = null, dimLabel = null, entityLabel = null;
      var byRisk = function (a, b){ return (a.aR == null ? 2 : a.aR) - (b.aR == null ? 2 : b.aR); };
      if (ent.cat === 'project'){
        // exception: a project lead gets the per-KPI forecast of their project
        dimLabel = 'KPIs'; entityLabel = 'KPI';
        toRows(commIndicators(ent)).forEach(function (r){
          ents.push(fcEntity('kpi:' + r.id, (r.raw.code ? r.raw.code + ' · ' : '') + r.name,
            r.unit || '', r.sdg ? (PILLAR_COLORS[r.sdg] || '#94a3b8') : '#94a3b8', [r]));
        });
      } else {
        var projRows = commProjectsFor(ent), entByPid = {};
        projRows.forEach(function (row){
          var p = row.p, co = DB._idx.countryByIso[p.country_iso3], dn = DB._idx.donorById[p.donor_id];
          var e = fcEntity('project:' + p.id, (p.code ? p.code + ' · ' : '') + p.name,
            (co ? co.name : (p.country_iso3 || '')) + (dn ? ' · ' + (dn.short_name || dn.name) : ''),
            p.country_iso3 ? countryColor(p.country_iso3) : '#94a3b8', toRows(row.kpis || []));
          entByPid[p.id] = e; ents.push(e);
        });
      }
      ents.forEach(fcCompute);
      // section groups one level down the chain, exactly like the results
      // report: Plan -> Impact, Impact -> Outcome, Outcome -> Output, Region ->
      // country; Output / Donor / Country stay flat (commGroups returns null)
      if (ent.cat !== 'project'){
        var rawGroups = commGroups(ent, projRows);
        if (rawGroups) groups = rawGroups.map(function (g){
          var ge = g.rows.map(function (row){ return entByPid[row.p.id]; });
          ge.sort(byRisk);
          return { code: g.code || '', name: g.name || g.title, title: g.title, color: g.color, ents: ge };
        });
      }
      // riskiest first, same ordering as the Forecast tab
      ents.sort(byRisk);
      var doc = fcPdfDoc(scope, ents, null, {
        groups: groups,
        tag: 'Forecast Brief  ·  ' + period,
        subjectType: commCatOne(ent.cat),
        preparedFor: ent,
        noFilters: true,
        dimLabel: dimLabel, entityLabel: entityLabel,
        ctx: commCatOne(ent.cat) + '  ·  forecast to end of plan  ·  as of ' + asOf
      });
      return btoa(doc.build());
    } finally {
      S.fcHorizon = savedH; S.fcDim = savedD; FC_ASOF_MI = savedAsOf;
    }
  }

  // ---- report rows (the `report` table) ---------------------------------------
  function commFindReport(ref, y, m){
    return DB.tables.report.filter(function (r){ return r.ref === ref && r.year === y && r.month === m; })[0];
  }
  function commGenerate(ent, y, m){
    var built = commBuildPdf(ent, y, m), fcB64 = commBuildForecastPdf(ent, y, m);
    var rep = commFindReport(ent.ref, y, m), now = new Date().toISOString();
    if (rep){
      rep.category = ent.cat; rep.ref_name = ent.name; rep.lead_id = ent.leadId;
      rep.generated = now; rep.sent = null; rep.summary = built.summary; rep.pdf = built.b64; rep.pdf_fc = fcB64;
      return DB.persist('report', [rep]);
    }
    return DB.insert('report', { category: ent.cat, ref: ent.ref, ref_name: ent.name, lead_id: ent.leadId,
      year: y, month: m, enabled: 1, generated: now, sent: null, summary: built.summary, pdf: built.b64, pdf_fc: fcB64 });
  }
  function commFileName(rep, forecast){
    var safe = String(rep.ref_name || 'report').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
    var brand = orgActive() ? (String(orgShort()).replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'Grassroots') : 'Grassroots';
    return brand + '_' + (forecast ? 'Forecast_' : '') + cap(rep.category) + '_' + safe + '_' + rep.year + '-' + p2(rep.month) + '.pdf';
  }
  function commPdfBlobUrl(rep, forecast){
    var bin = atob(forecast ? rep.pdf_fc : rep.pdf), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return URL.createObjectURL(new Blob([arr], { type: 'application/pdf' }));
  }

  // ---- email template ({PLACEHOLDER} substitution; editable, persisted) --------
  // v2: the default now covers the forecast brief - the key bump stops a stale
  // v1 save (pre-forecast wording) from shadowing the new default.
  var COMM_TPL_KEY = 'gr_email_tpl_v2';
  function commDefaultTpl(){
    return {
      subject: 'Your {MONTH} {YEAR} results & forecast - {ENTITY}',
      body: 'Dear {LEAD},\n\n' +
        'I hope this finds you well. Attached are two PDFs for {MONTH} {YEAR}, covering {ENTITY} - the {CATEGORY} you lead on The Grassroots: your monthly results report and your forecast brief.\n\n' +
        'The month at a glance: {SUMMARY}. In the results report you will find each KPI\'s value against its baseline and target, its progress, and its performance status as of the end of {MONTH}, alongside the activities logged and the people reached during the month.\n\n' +
        'The forecast brief looks ahead: best, realistic and worst-case trajectories for your scope to the end of the plan, the projects under it ranked riskiest first (a project\'s brief drills into its KPIs instead), and what to do now to keep every target within reach.\n\n' +
        'If anything looks off - or you would like the underlying activity detail - just reply to this email, or open The Grassroots and drill into your scope.\n\n' +
        'Thank you for everything you and your team put into this. It shows.\n\n' +
        'Warm regards,\n{SENDER}\nThe Grassroots - Monitoring & Evaluation'
    };
  }
  function commTpl(){
    try {
      var t = JSON.parse(localStorage.getItem(COMM_TPL_KEY));
      if (t && t.subject != null && t.body != null) return t;
    } catch (e) {}
    return commDefaultTpl();
  }
  function commFill(s, ent, rep){
    // function replacements: entity/user names may contain `$&`/`$'`-style
    // sequences that a string replacement would expand instead of inserting
    var vals = {
      LEAD: userName(ent.leadId),
      MONTH: MONTH_NAMES[COMM.month - 1],
      YEAR: String(COMM.year),
      ENTITY: (ent.code ? ent.code + ' - ' : '') + ent.name,
      CATEGORY: commCatOne(ent.cat),
      SUMMARY: rep && rep.summary ? rep.summary : 'KPI progress, performance and reach for the period',
      SENDER: CURRENT_USER ? CURRENT_USER.name : 'The Grassroots Team'
    };
    return String(s).replace(/\{(LEAD|MONTH|YEAR|ENTITY|CATEGORY|SUMMARY|SENDER)\}/g, function (_, k){ return vals[k]; });
  }

  // ---- panel rendering ---------------------------------------------------------
  function openComms(){
    if (COMM.year == null){ var d = commDefaultPeriod(); COMM.year = d.year; COMM.month = d.month; }
    renderCommBar(); renderCommTabs(); renderComm();
    $('#commModal').classList.add('on');
  }
  function closeComms(){ $('#commModal').classList.remove('on'); }
  function commYears(){
    var min = 2100, max = 2000;
    allPlans().forEach(function (p){
      if (p.start_date) min = Math.min(min, +p.start_date.slice(0, 4));
      if (p.end_date) max = Math.max(max, +p.end_date.slice(0, 4));
    });
    if (min > max){ max = commNow().y; min = max - 9; }   // no dated plans: offer the last decade
    max = Math.min(max, commNow().y);   // never offer a future year
    if (min > max) min = max;
    var out = []; for (var y = min; y <= max; y++) out.push(y);
    return out;
  }
  function renderCommBar(){
    var bar = $('#commBar'); bar.innerHTML = '';
    var ro = !canEditFramework();
    // clamp any future selection back to the current month (defence in depth -
    // the dropdowns below never offer a future period)
    var now = commNow();
    if (commIsFuture(COMM.year, COMM.month)){ COMM.year = now.y; COMM.month = now.m; }
    var lbl = el('span', 'comm-lbl', 'Reporting period');
    var ySel = el('select', 'comm-sel comm-year');
    ySel.innerHTML = commYears().map(function (y){ return '<option value="' + y + '"' + (y === COMM.year ? ' selected' : '') + '>' + y + '</option>'; }).join('');
    var mSel = el('select', 'comm-sel comm-month');
    mSel.innerHTML = MONTH_NAMES.map(function (m, i){
      var future = commIsFuture(COMM.year, i + 1);
      return '<option value="' + (i + 1) + '"' + (i + 1 === COMM.month ? ' selected' : '') + (future ? ' disabled' : '') + '>' + m + (future ? ' ·' : '') + '</option>';
    }).join('');
    ySel.onchange = function (){
      COMM.year = +ySel.value;
      if (commIsFuture(COMM.year, COMM.month)) COMM.month = now.m;   // e.g. December selected, then the current year chosen
      renderCommBar(); renderComm();
    };
    mSel.onchange = function (){ COMM.month = +mSel.value; renderCommBar(); renderComm(); };
    var gen = el('button', 'hbtn primary comm-genall', '⚙ Generate ' + commPeriodLabel() + ' reports');
    gen.title = 'Build (or rebuild) the monthly PDF for every enabled Lead in every category';
    gen.onclick = commGenerateAll;
    var send = el('button', 'hbtn comm-sendall', '📤 Send all by email');
    if (isPublicDemo()){
      send.disabled = true;
      send.title = 'Email sending is disabled on the public demo. Run the app locally or self-host to connect Brevo and send.';
    } else {
      send.title = 'Email every enabled, generated ' + commPeriodLabel() + ' report to its Lead';
      send.onclick = commSendAll;
    }
    var msg = el('span', 'comm-msg'); msg.id = 'commMsg';
    bar.appendChild(lbl); bar.appendChild(mSel); bar.appendChild(ySel);
    if (!ro){ bar.appendChild(gen); bar.appendChild(send); }
    bar.appendChild(msg);
  }
  function renderCommTabs(){
    var tabs = $('#commTabs'); tabs.innerHTML = '';
    COMM_CATS.forEach(function (c){
      var n = commEntities(c.key).length;
      var b = el('button', COMM.tab === c.key ? 'on' : '', c.label + (n ? ' ' : ''));
      if (n){ var ct = el('span', 'comm-count', String(n)); b.appendChild(ct); }
      b.dataset.commtab = c.key;
      tabs.appendChild(b);
    });
    var em = el('button', 'comm-mailtab' + (COMM.tab === 'email' ? ' on' : ''), '✉ Email draft');
    em.dataset.commtab = 'email';
    tabs.appendChild(em);
    var dv = el('button', 'comm-mailtab' + (COMM.tab === 'delivery' ? ' on' : ''), '📮 Email delivery');
    dv.dataset.commtab = 'delivery';
    tabs.appendChild(dv);
  }
  function commStatusChip(rep){
    if (rep && rep.enabled === 0) return '<span class="comm-chip off">Disabled</span>';
    if (rep && rep.sent) return '<span class="comm-chip sent">✓ Sent ' + esc(commWhen(rep.sent)) + '</span>';
    if (rep && rep.pdf) return '<span class="comm-chip ready">● Ready ' + esc(commWhen(rep.generated)) + '</span>';
    return '<span class="comm-chip none">– Not generated</span>';
  }
  function renderComm(){
    var body = $('#commBody'); body.innerHTML = '';
    if (!canEditFramework()){
      body.appendChild(el('div', 'cp-note', 'Communication is limited to Admin status.'));
      return;
    }
    if (COMM.tab === 'email'){ body.appendChild(commEmailEditor()); return; }
    if (COMM.tab === 'delivery'){ body.appendChild(commMailSettings()); return; }
    var cat = COMM.tab, ents = commEntities(cat), un = commUnassigned(cat);
    var catDef = COMM_CATS.filter(function (c){ return c.key === cat; })[0];
    var note = el('div', 'cp-note');
    var contentTxt = cat === 'project' ? 'the project\'s KPIs'
      : cat === 'plan' ? 'the plan\'s projects, grouped by Impact'
      : cat === 'impact' ? 'the projects contributing to it, grouped by Outcome'
      : cat === 'outcome' ? 'the projects contributing to it, grouped by Output'
      : cat === 'region' ? 'the region\'s projects, grouped by country'
      : 'its projects';
    note.innerHTML = 'Each row is one <b>' + commCatOne(cat) + '</b> with a Lead, and the monthly PDFs they will receive for <b>' +
      esc(commPeriodLabel()) + '</b>. The results report shows ' + contentTxt + ' - point-in-time snapshots of the same results the app derives: progress and performance as of month end, plus the month\'s activities and reach. A <b>forecast brief</b> for the same scope rides along in every email: best/realistic/worst trajectories to the end of the plan, and what to do to keep the targets on track.' +
      (un ? ' <b>' + un + '</b> ' + (un === 1 ? 'entry has' : 'entries have') + ' no Lead yet - assign them to include them here.' : '');
    body.appendChild(note);
    if (!ents.length){
      body.appendChild(el('div', 'cp-empty', 'No ' + catDef.label.toLowerCase() + ' have a Lead assigned yet.'));
      return;
    }
    // bulk enable/disable for THIS category + period (one click covers every row)
    var nOn = ents.filter(function (ent){ var r = commFindReport(ent.ref, COMM.year, COMM.month); return !r || r.enabled !== 0; }).length;
    var bulk = el('div', 'comm-bulk');
    bulk.appendChild(el('span', 'comm-bulk-lbl', nOn + ' of ' + ents.length + ' enabled for ' + commPeriodLabel()));
    var allOn = el('button', 'cp-mini', '✓ Enable all');
    allOn.title = 'Include every ' + commCatOne(cat).toLowerCase() + ' lead in batch generate & send';
    allOn.disabled = nOn === ents.length;
    allOn.onclick = function (){ commSetAllEnabled(cat, true); };
    var allOff = el('button', 'cp-mini', '✗ Disable all');
    allOff.title = 'Exclude every ' + commCatOne(cat).toLowerCase() + ' lead from batch generate & send';
    allOff.disabled = nOn === 0;
    allOff.onclick = function (){ commSetAllEnabled(cat, false); };
    bulk.appendChild(allOn); bulk.appendChild(allOff);
    body.appendChild(bulk);
    var tbl = el('table', 'utbl commtbl');
    tbl.innerHTML = '<thead><tr><th>Lead</th><th>' + esc(commCatOne(cat)) + '</th><th>' + (cat === 'project' ? 'KPIs' : 'Projects') + '</th><th>Report</th><th></th></tr></thead>';
    var tb = el('tbody');
    ents.forEach(function (ent){ tb.appendChild(commRow(ent)); });
    tbl.appendChild(tb); body.appendChild(tbl);
  }
  function commRow(ent){
    var rep = commFindReport(ent.ref, COMM.year, COMM.month);
    var enabled = !rep || rep.enabled !== 0;
    var u = DB._idx.userById[ent.leadId];
    var tr = el('tr', enabled ? '' : 'comm-off');
    tr.innerHTML =
      '<td><span class="udot" style="background:' + (u ? userColor(u) : '#94a3b8') + '"></span>' + esc(userName(ent.leadId)) +
        '<div class="comm-email">' + esc(leadEmail(ent.leadId)) + '</div></td>' +
      '<td>' + (ent.code ? '<span class="umono">' + esc(ent.code) + '</span> · ' : '') + esc(ent.name) + '</td>' +
      '<td class="umono">' + (ent.cat === 'project' ? commIndicators(ent).length : commProjectsFor(ent).length) + '</td>' +
      '<td>' + commStatusChip(rep) + '</td>';
    var act = el('td', 'uact comm-act');
    function btn(txt, title, fn, disabled){
      var b = el('button', 'cp-mini', txt); b.title = title; b.disabled = !!disabled;
      b.onclick = fn; act.appendChild(b); return b;
    }
    var future = commIsFuture(COMM.year, COMM.month);
    btn(rep && rep.pdf ? '⟳' : '⚙', future ? commPeriodLabel() + ' hasn\'t happened yet' : (rep && rep.pdf ? 'Regenerate this report from current data' : 'Generate this report'), function (){
      if (commIsFuture(COMM.year, COMM.month)) return;
      Promise.resolve(commGenerate(ent, COMM.year, COMM.month)).then(renderComm);
    }, !enabled || future);
    btn('👁', 'View results PDF', function (){ if (rep && rep.pdf) window.open(commPdfBlobUrl(rep), '_blank'); }, !(rep && rep.pdf));
    btn('↗', 'View forecast PDF', function (){ if (rep && rep.pdf_fc) window.open(commPdfBlobUrl(rep, true), '_blank'); }, !(rep && rep.pdf_fc));
    btn('⬇', 'Download the PDFs (results + forecast)', function (){
      if (!(rep && rep.pdf)) return;
      var a = document.createElement('a'); a.href = commPdfBlobUrl(rep); a.download = commFileName(rep); a.click();
      if (rep.pdf_fc){ var a2 = document.createElement('a'); a2.href = commPdfBlobUrl(rep, true); a2.download = commFileName(rep, true); a2.click(); }
    }, !(rep && rep.pdf));
    btn(enabled ? '✓' : '✗', enabled ? 'Enabled - click to exclude from batch generate & send' : 'Disabled - click to include again', function (){
      if (rep){ rep.enabled = enabled ? 0 : 1; Promise.resolve(DB.persist('report', [rep])).then(renderComm); }
      else Promise.resolve(DB.insert('report', { category: ent.cat, ref: ent.ref, ref_name: ent.name, lead_id: ent.leadId,
        year: COMM.year, month: COMM.month, enabled: 0, generated: null, sent: null, summary: null, pdf: null })).then(renderComm);
    });
    btn('🗑', 'Delete this generated report', function (){
      if (rep) Promise.resolve(DB.remove('report', [rep.id])).then(renderComm);
    }, !rep);
    tr.appendChild(act);
    return tr;
  }

  // Flip the enabled flag for EVERY lead of a category in the selected period.
  // Rows without a report yet default to enabled, so "disable" creates a stub
  // (enabled:0, no pdf) and "enable" only has to touch existing rows.
  function commSetAllEnabled(cat, on){
    var news = [], upds = [];
    commEntities(cat).forEach(function (ent){
      var rep = commFindReport(ent.ref, COMM.year, COMM.month);
      if (rep){
        if ((rep.enabled !== 0) !== on){ rep.enabled = on ? 1 : 0; upds.push(rep); }
      } else if (!on){
        news.push({ category: ent.cat, ref: ent.ref, ref_name: ent.name, lead_id: ent.leadId,
          year: COMM.year, month: COMM.month, enabled: 0, generated: null, sent: null, summary: null, pdf: null });
      }
    });
    var jobs = [];
    if (news.length) jobs.push(DB.insert('report', news));
    if (upds.length) jobs.push(DB.persist('report', upds));
    return Promise.all(jobs).then(renderComm);
  }

  // ---- batch generate & send (chunked so the UI stays alive) -------------------
  function commAllEnts(){
    var out = [];
    COMM_CATS.forEach(function (c){ out = out.concat(commEntities(c.key)); });
    return out;
  }
  function commGenerateAll(){
    if (COMM.busy) return;
    if (commIsFuture(COMM.year, COMM.month)){ commSay('⛔ ' + commPeriodLabel() + ' hasn\'t happened yet - reports cover completed or current months only.'); return; }
    var ents = commAllEnts().filter(function (ent){
      var rep = commFindReport(ent.ref, COMM.year, COMM.month);
      return !rep || rep.enabled !== 0;
    });
    if (!ents.length){ commSay('Nothing to generate - no Leads assigned yet.'); return; }
    COMM.busy = true;
    var i = 0;
    function step(){
      // batch the DB writes per chunk - DB.insert/persist rebuild indexes per call,
      // so one call per chunk (not per report) keeps 170+ reports fast (chunks of
      // 10 now that every row builds two PDFs: results + forecast)
      var n = Math.min(i + 10, ents.length), news = [], upds = [], now = new Date().toISOString();
      for (; i < n; i++){
        var ent = ents[i], built = commBuildPdf(ent, COMM.year, COMM.month);
        var fcB64 = commBuildForecastPdf(ent, COMM.year, COMM.month);
        var rep = commFindReport(ent.ref, COMM.year, COMM.month);
        if (rep){
          rep.category = ent.cat; rep.ref_name = ent.name; rep.lead_id = ent.leadId;
          rep.generated = now; rep.sent = null; rep.summary = built.summary; rep.pdf = built.b64; rep.pdf_fc = fcB64;
          upds.push(rep);
        } else {
          news.push({ category: ent.cat, ref: ent.ref, ref_name: ent.name, lead_id: ent.leadId,
            year: COMM.year, month: COMM.month, enabled: 1, generated: now, sent: null, summary: built.summary, pdf: built.b64, pdf_fc: fcB64 });
        }
      }
      if (news.length) DB.insert('report', news);
      if (upds.length) DB.persist('report', upds);
      commSay('Generating ' + commPeriodLabel() + ' reports… ' + i + ' / ' + ents.length);
      if (i < ents.length) setTimeout(step, 10);
      else { COMM.busy = false; commSay('✓ ' + ents.length + ' reports generated for ' + commPeriodLabel() + '.'); renderComm(); }
    }
    step();
  }
  function commSendAll(){
    if (COMM.busy) return;
    if (isPublicDemo()){ commSay('⛔ Email sending is disabled on the public demo. Run the app locally or self-host to send.'); return; }
    if (commIsFuture(COMM.year, COMM.month)){ commSay('⛔ ' + commPeriodLabel() + ' hasn\'t happened yet - reports cover completed or current months only.'); return; }
    var reps = DB.tables.report.filter(function (r){ return r.year === COMM.year && r.month === COMM.month && r.enabled !== 0 && r.pdf; });
    if (!reps.length){ commSay('No generated reports for ' + commPeriodLabel() + ' - hit Generate first.'); return; }
    var leads = {}; reps.forEach(function (r){ if (r.lead_id != null) leads[r.lead_id] = 1; });
    var nLeads = Object.keys(leads).length;
    var cfg = commMailCfg();
    if (!cfg){
      // no mail service connected yet - record the sends locally
      if (!confirm('No email service is connected (add your free Brevo key in the ✉ Email draft tab to really send).\n\nRecord ' + reps.length + ' ' + commPeriodLabel() + ' report' + (reps.length === 1 ? '' : 's') + ' to ' + nLeads + ' lead' + (nLeads === 1 ? '' : 's') + ' as sent?')) return;
      var now0 = new Date().toISOString();
      reps.forEach(function (r){ r.sent = now0; });
      Promise.resolve(DB.persist('report', reps)).then(function (){
        commSay('✓ ' + reps.length + ' reports recorded as sent. Connect Brevo in the ✉ Email draft tab for real delivery.');
        renderComm();
      });
      return;
    }
    var destTxt = cfg.live
      ? 'each lead\'s profile email address'
      : 'YOUR OWN inbox (' + cfg.senderEmail + ') - test mode is on';
    if (!confirm('Send ' + reps.length + ' ' + commPeriodLabel() + ' report' + (reps.length === 1 ? '' : 's') + ' (' + nLeads + ' lead' + (nLeads === 1 ? '' : 's') + ') via Brevo, each with its results and forecast PDFs attached?\n\nDelivery goes to ' + destTxt + '.')) return;
    COMM.busy = true;
    var i = 0, ok = 0, fail = 0, firstErr = null, now = new Date().toISOString();
    function next(){
      if (i >= reps.length){
        COMM.busy = false;
        commSay((fail ? '⚠ ' : '✓ ') + ok + ' of ' + reps.length + ' reports emailed via Brevo' + (cfg.live ? '' : ' (test mode - delivered to ' + esc(cfg.senderEmail) + ')') +
          (fail ? ' · ' + fail + ' failed - first error: ' + esc(firstErr || '') : '.'));
        renderComm();
        return;
      }
      var batch = reps.slice(i, i + 3); i += batch.length;
      var sentNow = [];
      Promise.all(batch.map(function (rep){
        return commMailSend(rep, cfg).then(
          function (){ rep.sent = now; sentNow.push(rep); ok++; },
          function (e){ fail++; if (!firstErr) firstErr = e.message; });
      })).then(function (){
        if (sentNow.length) DB.persist('report', sentNow);
        commSay('📤 Sending via Brevo… ' + (ok + fail) + ' / ' + reps.length + (fail ? ' · ' + fail + ' failed' : ''));
        next();
      });
    }
    next();
  }
  function commSay(html){ var m = $('#commMsg'); if (m) m.innerHTML = html; }

  // ---- real email delivery via Brevo (free tier: 300/day, browser-callable) ----
  // The API key is the USER'S OWN (brevo.com -> SMTP & API -> API keys) and lives
  // ONLY in localStorage - never in the repo, the DB, or the SQL export. Until a
  // key is saved, "Send all" records sends locally (simulation). Test mode (the
  // default) redirects every email to the sender's own inbox, so the fictional
  // demo lead addresses are never actually mailed.
  var COMM_MAIL_KEY = 'gr_mail_cfg_v1';
  function commMailCfg(){
    try {
      var c = JSON.parse(localStorage.getItem(COMM_MAIL_KEY));
      if (c && c.key && c.senderEmail) return c;
    } catch (e) {}
    return null;
  }
  function commMailSend(rep, cfg){
    var ent = { cat: rep.category, code: '', name: rep.ref_name, leadId: rep.lead_id };
    var tpl = commTpl();
    var live = !!cfg.live;
    var atts = [{ name: commFileName(rep), content: rep.pdf }];
    if (rep.pdf_fc) atts.push({ name: commFileName(rep, true), content: rep.pdf_fc });
    var payload = {
      sender: { name: cfg.senderName || orgBrand(), email: cfg.senderEmail },
      to: [{ email: live ? leadEmail(rep.lead_id) : cfg.senderEmail, name: userName(rep.lead_id) }],
      subject: commFill(tpl.subject, ent, rep) + (live ? '' : '  [test - would go to ' + userName(rep.lead_id) + ']'),
      textContent: commFill(tpl.body, ent, rep),
      attachment: atts
    };
    return fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': cfg.key },
      body: JSON.stringify(payload)
    }).then(function (r){
      if (!r.ok) return r.text().then(function (t){ throw new Error(r.status + ' ' + t.slice(0, 160)); });
    });
  }

  // Delivery settings card (Email draft tab): connect the user's own free Brevo
  // account, choose test mode vs live delivery, and fire a one-off test send.
  function commMailSettings(){
    var cfg = commMailCfg() || {};
    var box = el('div', 'comm-svc');
    box.appendChild(elHTML('div', 'comm-svc-h', '📮 Email delivery <span class="comm-svc-badge ' + (commMailCfg() ? 'on' : '') + '">' + (commMailCfg() ? (cfg.live ? 'Connected · LIVE' : 'Connected · test mode') : 'Not connected - sends are simulated') + '</span>'));
    box.appendChild(elHTML('div', 'cp-note', 'Real sending uses <b>Brevo</b> (free: 300 emails/day, PDF attachments included). Create a free account at brevo.com, verify your sender address, copy an API key from <i>SMTP &amp; API → API keys</i>, and paste it here. The key stays in this browser\'s local storage only - it is never written to the database, the SQL export, or the repository.'));
    var f = el('div', 'uform');
    f.innerHTML =
      '<div class="ufgrid" style="grid-template-columns:1fr 1fr">' +
      '  <label><span>Sender name</span><input class="ms-name" type="text" value="' + esc(cfg.senderName || (CURRENT_USER ? CURRENT_USER.name : '')) + '" placeholder="The Grassroots M&E"></label>' +
      '  <label><span>Sender email (verified in Brevo) *</span><input class="ms-email" type="email" value="' + esc(cfg.senderEmail || '') + '" placeholder="you@example.org"></label>' +
      '</div>' +
      '<div class="ufgrid" style="grid-template-columns:1fr">' +
      '  <label><span>Brevo API key *</span><input class="ms-key" type="password" value="' + esc(cfg.key || '') + '" placeholder="xkeysib-…"></label>' +
      '</div>' +
      '<label class="comm-live"><input class="ms-live" type="checkbox"' + (cfg.live ? ' checked' : '') + '> Deliver to the leads\' real addresses (unchecked = TEST MODE: every email goes to the sender\'s own inbox instead - the demo leads\' addresses are fictional, so leave this off until your leads carry real emails)</label>' +
      '<div class="ufbtns"><span class="ufmsg ms-msg"></span>' +
      '<button class="hbtn ms-test" type="button">✉ Send me a test</button>' +
      '<button class="hbtn ms-clear" type="button">Disconnect</button>' +
      '<button class="hbtn primary ms-save" type="button">Save connection</button></div>';
    var msg = f.querySelector('.ms-msg');
    function readCfg(){
      return { key: f.querySelector('.ms-key').value.trim(), senderName: f.querySelector('.ms-name').value.trim(),
        senderEmail: f.querySelector('.ms-email').value.trim(), live: f.querySelector('.ms-live').checked ? 1 : 0 };
    }
    f.querySelector('.ms-save').onclick = function (){
      var c = readCfg();
      if (!c.key || !c.senderEmail){ msg.textContent = 'API key and sender email are required.'; return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.senderEmail)){ msg.textContent = 'Enter a valid sender email.'; return; }
      try { localStorage.setItem(COMM_MAIL_KEY, JSON.stringify(c)); } catch (e) {}
      msg.textContent = '✓ Saved. Use "Send me a test" to verify.'; renderComm();
    };
    f.querySelector('.ms-clear').onclick = function (){
      try { localStorage.removeItem(COMM_MAIL_KEY); } catch (e) {}
      renderComm();
    };
    f.querySelector('.ms-test').onclick = function (){
      var c = readCfg();
      if (!c.key || !c.senderEmail){ msg.textContent = 'Fill in the API key and sender email first.'; return; }
      var rep = DB.tables.report.filter(function (r){ return r.year === COMM.year && r.month === COMM.month && r.pdf; })[0];
      if (!rep){ msg.textContent = 'Generate at least one ' + commPeriodLabel() + ' report first.'; return; }
      msg.textContent = 'Sending test to ' + c.senderEmail + '…';
      commMailSend(rep, { key: c.key, senderName: c.senderName, senderEmail: c.senderEmail, live: 0 }).then(
        function (){ msg.textContent = '✓ Test sent to ' + c.senderEmail + ' - check your inbox (and spam folder).'; },
        function (e){ msg.textContent = '✗ Brevo said: ' + e.message; });
    };
    box.appendChild(f);
    return box;
  }

  // ---- Email draft tab: edit the template, preview a real example --------------
  function commEmailEditor(){
    var box = el('div', 'comm-mail');
    var tpl = commTpl();
    var left = el('div', 'comm-mail-edit');
    left.appendChild(elHTML('div', 'cp-note', 'This is the email every Lead receives - two PDFs ride along as attachments: the monthly results report and the forecast brief. Placeholders fill in per lead: <b>{LEAD}</b> · <b>{MONTH}</b> · <b>{YEAR}</b> · <b>{ENTITY}</b> · <b>{CATEGORY}</b> · <b>{SUMMARY}</b> · <b>{SENDER}</b>.'));
    var subj = el('input', 'comm-subj'); subj.type = 'text'; subj.value = tpl.subject;
    var subjLab = el('label', 'comm-field'); subjLab.appendChild(el('span', '', 'Subject')); subjLab.appendChild(subj);
    var bodyTa = el('textarea', 'comm-body'); bodyTa.rows = 16; bodyTa.value = tpl.body;
    var bodyLab = el('label', 'comm-field'); bodyLab.appendChild(el('span', '', 'Body')); bodyLab.appendChild(bodyTa);
    var btns = el('div', 'ufbtns');
    var msg = el('span', 'ufmsg');
    var reset = el('button', 'hbtn', 'Reset to default');
    var save = el('button', 'hbtn primary', 'Save template');
    save.onclick = function (){
      try { localStorage.setItem(COMM_TPL_KEY, JSON.stringify({ subject: subj.value, body: bodyTa.value })); } catch (e) {}
      msg.textContent = 'Template saved.'; preview();
    };
    reset.onclick = function (){
      try { localStorage.removeItem(COMM_TPL_KEY); } catch (e) {}
      var d = commDefaultTpl(); subj.value = d.subject; bodyTa.value = d.body;
      msg.textContent = 'Back to the default template.'; preview();
    };
    btns.appendChild(msg); btns.appendChild(reset); btns.appendChild(save);
    left.appendChild(subjLab); left.appendChild(bodyLab); left.appendChild(btns);
    // live preview against a real lead (first entity that has one)
    var right = el('div', 'comm-mail-prev');
    function sampleEnt(){
      for (var i = 0; i < COMM_CATS.length; i++){
        var e = commEntities(COMM_CATS[i].key);
        if (e.length) return e[0];
      }
      return null;
    }
    function preview(){
      right.innerHTML = '';
      var ent = sampleEnt();
      if (!ent){ right.appendChild(el('div', 'cp-empty', 'Assign a Lead somewhere to preview the email.')); return; }
      var rep = commFindReport(ent.ref, COMM.year, COMM.month);
      var head = el('div', 'comm-prev-head');
      head.innerHTML =
        '<div class="comm-prev-lbl">PREVIEW - as ' + esc(userName(ent.leadId)) + ' will receive it</div>' +
        '<div class="comm-prev-row"><b>From</b> ' + esc((CURRENT_USER ? CURRENT_USER.name : orgBrand()) + ' <' + (CURRENT_USER ? leadEmail(CURRENT_USER.id) : (orgActive() && orgProfile().email ? orgProfile().email : 'noreply@thegrassroots.org')) + '>') + '</div>' +
        '<div class="comm-prev-row"><b>To</b> ' + esc(userName(ent.leadId) + ' <' + leadEmail(ent.leadId) + '>') + '</div>' +
        '<div class="comm-prev-row comm-prev-subj"><b>Subject</b> ' + esc(commFill(subj.value, ent, rep)) + '</div>';
      var bod = el('div', 'comm-prev-body');
      commFill(bodyTa.value, ent, rep).split(/\n{2,}/).forEach(function (par){
        var p = el('p', '', ''); p.textContent = par; bod.appendChild(p);
      });
      var stub = { category: ent.cat, ref_name: ent.name, year: COMM.year, month: COMM.month };
      var att = el('div', 'comm-prev-att');
      att.innerHTML = '<span class="comm-att-ic">📄</span><span>' + esc(commFileName(stub)) + '</span><span class="comm-att-k">PDF</span>';
      var attFc = el('div', 'comm-prev-att');
      attFc.innerHTML = '<span class="comm-att-ic">📈</span><span>' + esc(commFileName(stub, true)) + '</span><span class="comm-att-k">PDF</span>';
      right.appendChild(head); right.appendChild(bod); right.appendChild(att); right.appendChild(attFc);
    }
    subj.oninput = preview; bodyTa.oninput = preview;
    preview();
    box.appendChild(left); box.appendChild(right);
    return box;
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
    box.appendChild(elHTML('div', 'cp-note', 'Beneficiary <b>measures / units</b> record who benefits from an activity (e.g. Men, Women, Children, Persons with Disabilities, Refugees, IDPs). Add, rename or delete them here - they populate the Beneficiaries tab of the activity form.'));
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
  // Impacts and Outcomes also carry a Lead (accountable user, stored as
  // result.owner_id) - selectable here from the user list, never free-typed.
  function openFwRename(labelText, level, stmt, pillar){
    openFwPopup('Edit ' + labelText, function (){
      var withLead = level === 'impact' || level === 'outcome';
      var curLead = withLead ? frameworkLeadId(level, stmt, pillar) : null;
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>' + esc(labelText) + ' statement</span><input class="fw-stmt" type="text"></label>' +
        (withLead ? '  <label><span>Lead</span><select class="fw-lead">' + userOptions(curLead, level) + '</select></label>' : '') +
        '</div>' + fwButtons('Save changes');
      f.querySelector('.fw-stmt').value = stmt;
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var v = f.querySelector('.fw-stmt').value.trim();
        var leadId = withLead ? (f.querySelector('.fw-lead').value ? +f.querySelector('.fw-lead').value : null) : undefined;
        if (!v){ f.querySelector('.ufmsg').textContent = 'Statement is required.'; return; }
        if (v === stmt && (!withLead || leadId === curLead)){ closeFwEdit(); return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(updateResults(level, stmt, pillar, v, leadId));
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
        '  <label><span>Lead</span><select class="fw-lead">' + userOptions(null, 'outcome') + '</select></label>' +
        '</div>' + fwButtons('Add outcome');
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var stmt = f.querySelector('.fw-ostmt').value.trim();
        var leadId = f.querySelector('.fw-lead').value ? +f.querySelector('.fw-lead').value : null;
        if (!stmt){ f.querySelector('.ufmsg').textContent = 'Outcome statement is required.'; return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(addOutcome(pillar, stmt, leadId));
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
        '  <label><span>Lead</span><select class="fw-lead">' + userOptions(null, 'impact') + '</select></label>' +
        '</div>' + fwButtons('Add impact');
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var name = f.querySelector('.fw-pname').value.trim(), impact = f.querySelector('.fw-pimpact').value.trim();
        var leadId = f.querySelector('.fw-lead').value ? +f.querySelector('.fw-lead').value : null;
        if (!name || !impact){ f.querySelector('.ufmsg').textContent = 'Impact name and statement are required.'; return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(addPillar(name, impact, leadId));
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
  // Output codes are shown read-only for context; the Output statement and its
  // Lead (accountable user, stored as result.owner_id, selected from the user
  // list) are editable. KPIs are added and re-parented separately in the KPI
  // Inventory.
  //   mode 'add'  → outcomeStmt is the parent outcome; curStmt unused
  //   mode 'edit' → outcomeStmt is the parent outcome; curStmt is the output
  function openFwOutput(mode, pillar, outcomeStmt, curStmt){
    var isEdit = mode === 'edit';
    openFwPopup(isEdit ? 'Edit output' : 'Add output', function (){
      var pillarTxt = pillarLabel(pillar) + (pillar ? ' · ' + (PILLAR_NAMES[pillar] || '') : '');
      var ocCode = frameworkCode('outcome', outcomeStmt, pillar);
      var outcomeTxt = (ocCode ? ocCode + ' · ' : '') + outcomeStmt;
      var outCode = isEdit ? frameworkCode('output', curStmt, pillar) : (nextOutputCode(pillar, outcomeStmt) + ' (new)');
      var curLead = isEdit ? frameworkLeadId('output', curStmt, pillar) : null;
      var f = el('div', 'uform');
      f.innerHTML =
        '<div class="ufgrid" style="grid-template-columns:1fr">' +
        '  <label><span>Impact</span><input type="text" value="' + esc(pillarTxt) + '" readonly></label>' +
        '  <label><span>Outcome</span><input type="text" value="' + esc(outcomeTxt) + '" readonly></label>' +
        '  <label><span>Output code</span><input type="text" value="' + esc(outCode) + '" readonly></label>' +
        '  <label><span>Output statement</span><input class="fw-stmt" type="text" placeholder="What this output delivers"></label>' +
        '  <label><span>Lead</span><select class="fw-lead">' + userOptions(curLead, 'output') + '</select></label>' +
        '</div>' + fwButtons(isEdit ? 'Save changes' : 'Add output');
      if (isEdit) f.querySelector('.fw-stmt').value = curStmt;
      f.querySelector('.fw-cancel').onclick = closeFwEdit;
      f.querySelector('.fw-save').onclick = function (){
        var v = f.querySelector('.fw-stmt').value.trim();
        var leadId = f.querySelector('.fw-lead').value ? +f.querySelector('.fw-lead').value : null;
        if (!v){ f.querySelector('.ufmsg').textContent = 'Output statement is required.'; return; }
        if (isEdit && v === curStmt && leadId === curLead){ closeFwEdit(); return; }
        f.querySelector('.ufmsg').textContent = 'Saving…';
        applyMutation(isEdit ? updateResults('output', curStmt, pillar, v, leadId) : addOutput(pillar, outcomeStmt, v, leadId));
      };
      return f;
    });
  }

  // =========================================================================
  //  CONTROL PANEL - KPI Inventory (fine-tune KPI definitions; Admin only)
  // =========================================================================
  // KPI list options (unit / frequency / collection method / disaggregation /
  // type / direction) live in the reference lookup TABLES - see lookupOptions().
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
    box.appendChild(elHTML('div', 'cp-note', 'Fine-tune KPI definitions - name, type, unit, direction, baseline/target, means & method of measurement, frequency, responsible and <b>parent Output</b>. Every KPI belongs to an Output; use <b>＋ Add KPI</b> to create one under an Output, or Edit to change it (applies to every country instance and re-derives status & roll-up).'));
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
    var u = kpiUnit(g.rep) === '%' ? '%' : '';
    tr.innerHTML = '<td class="umono">' + esc(g.rep.code || '') + '</td>'
      + '<td><span class="udot" style="background:' + col + '"></span>' + esc(g.name) + '</td>'
      + '<td><span class="kpi-pill" style="background:' + shade(col, 0.74) + ';color:' + shade(col, -0.32) + '">' + esc(pillarLabel(g.sdg)) + '</span></td>'
      + '<td class="umono">' + esc(kpiUnit(g.rep) || '') + '</td>'
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
  // (form option lists are built from the reference lookup tables - lookupOptions)
  // A project's Lead as a user id (people are ALWAYS referenced by id, never by
  // a stored display name). Legacy rows persisted before lead_id existed carried
  // the display name in `lead`; resolve that to the user list once so the
  // dropdown still preselects correctly until the row is next saved.
  function projectLeadId(p){
    if (!p) return null;
    if (p.lead_id != null) return +p.lead_id;
    if (p.lead){ var u = DB.tables.user.filter(function (x){ return x.name === p.lead; })[0]; if (u) return u.id; }
    return null;
  }
  // dropdown of EXISTING users (by id) for person references - users are never
  // created/renamed outside Users Management, only selected here. `aff` is an
  // affiliation key ('donor', 'plan', …): the list filters to users affiliated
  // to that category, so e.g. a Donor Lead must come from Donor-affiliated
  // users. null = no filter. The currently-assigned user always stays in the
  // list (even if disabled or differently affiliated) so an existing value is
  // never silently dropped on save.
  function userOptions(curId, aff){
    var us = DB.tables.user.filter(function (u){ return (u.enabled && (!aff || userAffKey(u) === aff)) || u.id === curId; })
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
    var kw = kpiWindowYears(ind);
    var baseDate = ind.baseline_date || (kw.start + '-01-01');
    var tgtDate  = ind.target_date  || (kw.end + '-12-31');
    var f = el('div', 'uform kpiuform');
    f.innerHTML =
      '<div class="uform-h">Edit KPI - applies to all ' + g.insts.length + ' instance' + (g.insts.length === 1 ? '' : 's') + '</div>' +
      '<div class="ufgrid kpigrid">' +
      '  <label class="kf-wide"><span>KPI name *</span><input class="kf-name" type="text" value="' + esc(ind.name) + '"></label>' +
      '  <label><span>Type</span><select class="kf-type">' + lookupOptions('kpi_type', ind.type_id, ind.type || 'quantitative') + '</select></label>' +
      '  <label><span>Unit</span><select class="kf-unit">' + lookupOptions('unit', ind.unit_id, ind.unit || 'count') + '</select></label>' +
      '  <label><span>Direction</span><select class="kf-dir">' + lookupOptions('direction', ind.direction_id, ind.direction || 'increase') + '</select></label>' +
      '  <label><span>Baseline value</span><input class="kf-base" type="number" step="any" value="' + esc(ind.baseline_value) + '"></label>' +
      '  <label><span>Baseline date</span><input class="kf-basedate" type="date" value="' + esc(baseDate) + '"></label>' +
      '  <label><span>Target value</span><input class="kf-tgt" type="number" step="any" value="' + esc(ind.target_value) + '"></label>' +
      '  <label><span>Target date</span><input class="kf-tgtdate" type="date" value="' + esc(tgtDate) + '"></label>' +
      '  <label><span>Frequency</span><select class="kf-freq">' + lookupOptions('frequency', ind.frequency_id, ind.frequency) + '</select></label>' +
      '  <label><span>Collection method</span><select class="kf-method">' + lookupOptions('collection_method', ind.collection_method_id, ind.collection_method) + '</select></label>' +
      '  <label class="kf-wide"><span>Means of verification</span><input class="kf-mov" type="text" value="' + esc(ind.means_of_verification || '') + '"></label>' +
      '  <label><span>Responsible</span><select class="kf-resp">' + userOptions(ind.responsible_id, 'output') + '</select></label>' +
      '  <label><span>Disaggregation</span><select class="kf-disag">' + lookupOptions('disaggregation', ind.disaggregation_id, ind.disaggregation || 'none') + '</select></label>' +
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
      ind.name = newName;
      // every list selection persists the lookup row's id, never its text
      ind.type_id = +v('.kf-type'); ind.unit_id = +v('.kf-unit'); ind.direction_id = +v('.kf-dir');
      delete ind.type; delete ind.unit; delete ind.direction;   // legacy text columns
      var b = num(v('.kf-base')); if (b != null) ind.baseline_value = b;
      var bd = v('.kf-basedate'); if (bd){ ind.baseline_date = bd; ind.baseline_year = +bd.slice(0,4); }
      var t = num(v('.kf-tgt')); if (t != null) ind.target_value = t;
      var td = v('.kf-tgtdate'); if (td){ ind.target_date = td; ind.target_year = +td.slice(0,4); }
      ind.frequency_id = +v('.kf-freq'); ind.collection_method_id = +v('.kf-method');
      delete ind.frequency; delete ind.collection_method;
      ind.means_of_verification = v('.kf-mov').trim();
      ind.responsible_id = v('.kf-resp') ? +v('.kf-resp') : null;   // user reference by id
      ind.disaggregation_id = +v('.kf-disag'); delete ind.disaggregation;
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
      '  <label><span>Type</span><select class="kf-type">' + lookupOptions('kpi_type', null, 'quantitative') + '</select></label>' +
      '  <label><span>Unit</span><select class="kf-unit">' + lookupOptions('unit', null, 'count') + '</select></label>' +
      '  <label><span>Direction</span><select class="kf-dir">' + lookupOptions('direction', null, 'increase') + '</select></label>' +
      '  <label><span>Baseline value</span><input class="kf-base" type="number" step="any" value="0"></label>' +
      '  <label><span>Baseline date</span><input class="kf-basedate" type="date" value="' + defaultBaselineDate() + '"></label>' +
      '  <label><span>Target value</span><input class="kf-tgt" type="number" step="any" placeholder="0"></label>' +
      '  <label><span>Target date</span><input class="kf-tgtdate" type="date" value="' + defaultTargetDate() + '"></label>' +
      '  <label><span>Frequency</span><select class="kf-freq">' + lookupOptions('frequency', null, 'quarterly') + '</select></label>' +
      '  <label><span>Collection method</span><select class="kf-method">' + lookupOptions('collection_method', null, 'Administrative records') + '</select></label>' +
      '  <label class="kf-wide"><span>Means of verification</span><input class="kf-mov" type="text" placeholder="Data source"></label>' +
      '  <label><span>Responsible</span><select class="kf-resp">' + userOptions(null, 'output') + '</select></label>' +
      '  <label><span>Disaggregation</span><select class="kf-disag">' + lookupOptions('disaggregation', null, 'none') + '</select></label>' +
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
      name: name, type_id: +v('.kf-type'), unit_id: +v('.kf-unit'), direction_id: +v('.kf-dir'),
      baseline_value: num(v('.kf-base')) || 0, baseline_year: +(bd || defaultBaselineDate()).slice(0, 4), baseline_date: bd || defaultBaselineDate(),
      target_value: num(v('.kf-tgt')), target_year: +(td || defaultTargetDate()).slice(0, 4), target_date: td || defaultTargetDate(),
      means_of_verification: v('.kf-mov').trim(), collection_method_id: +v('.kf-method'),
      frequency_id: +v('.kf-freq'), responsible_id: v('.kf-resp') ? +v('.kf-resp') : null, disaggregation_id: +v('.kf-disag')
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
  // The entities a user is ASSIGNED to: the rows of their affiliation's category
  // that carry them as Lead. A Countries-affiliated user is assigned to countries
  // exactly like a Donor-affiliated user is assigned to donors - the same
  // relation, read from the category table's lead_id / owner_id, never stored on
  // the user row itself.
  function userAssignments(u){
    var key = userAffKey(u), out = [], seen = {};
    if (!u || !key) return out;
    function add(lbl){ if (lbl && !seen[lbl]){ seen[lbl] = 1; out.push(lbl); } }
    if (key === 'plan') allPlans().forEach(function (p){ if (p.lead_id === u.id) add(p.name); });
    else if (key === 'impact' || key === 'outcome' || key === 'output')
      DB.tables.result.forEach(function (r){ if (r.level === key && r.owner_id === u.id) add(r.code || r.statement); });   // country instances share a code → dedupe
    else if (key === 'project') DB.tables.project.forEach(function (p){ if (p.lead_id === u.id) add(p.code || p.name); });
    else if (key === 'donor') DB.tables.donor.forEach(function (d){ if (d.lead_id === u.id) add(d.short_name || d.name); });
    else if (key === 'partner') DB.tables.partner.forEach(function (d){ if (d.lead_id === u.id) add(d.acronym || d.name); });
    else if (key === 'region') DB.tables.region.forEach(function (r){ if (r.lead_id === u.id) add(r.name); });
    else if (key === 'country') userCountryIsos(u).forEach(add);
    return out;
  }
  // singular / plural category noun for the count display
  var AFF_NOUN = {
    plan:['Plan','Plans'], impact:['Impact','Impacts'], outcome:['Outcome','Outcomes'],
    output:['Output','Outputs'], project:['Project','Projects'], donor:['Donor','Donors'],
    partner:['Partner','Partners'], region:['Region','Regions'], country:['Country','Countries']
  };
  // count only, never names - e.g. '1 Plan', '2 Impacts', '7 Projects'
  function userAssignedText(u){
    var n = userAssignments(u).length;
    if (!n) return '–';
    var noun = AFF_NOUN[userAffKey(u)] || ['item','items'];
    return n + ' ' + (n === 1 ? noun[0] : noun[1]);
  }
  function userAffSeq(u){ var a = affiliationOf(u); return a ? (a.seq || 0) : 99; }

  function usersEditor(){
    var box = el('div', 'cp-users');
    box.appendChild(el('div', 'cp-note', 'Create and manage users. Affiliation sets which Lead role a user can hold (a Donor Lead comes from Donor-affiliated users); the Assigned column counts what they Lead. Status sets permissions - Admin: full control · User: log activities · Viewer: read-only. (Demo passwords are stored locally - not real security.)'));
    var addBtn = el('button', 'hbtn primary cp-adduser', '＋ Add user');
    addBtn.onclick = function (){ openUserEdit(null); };
    box.appendChild(addBtn);
    var tbl = el('table', 'utbl');
    tbl.innerHTML = '<thead><tr><th>Name</th><th>Username</th><th>Affiliation</th><th>Status</th><th>Assigned</th><th>Access</th><th></th></tr></thead>';
    var tb = el('tbody');
    var order = { admin:0, user:1, viewer:2 };
    DB.tables.user.slice().sort(function (a,b){
      return (order[userStatus(a)]-order[userStatus(b)]) || (userAffSeq(a)-userAffSeq(b)) || (a.name < b.name ? -1 : 1);
    }).forEach(function (u){ tb.appendChild(userRow(u)); });
    tbl.appendChild(tb); box.appendChild(tbl);
    return box;
  }

  function userRow(u){
    var tr = el('tr');
    var dot = '<span class="udot" style="background:' + userColor(u) + '"></span>';
    tr.innerHTML =
      '<td>' + dot + esc(u.name) + '</td>' +
      '<td class="umono">' + esc(u.username) + (u.email ? '<div class="comm-email">' + esc(u.email) + '</div>' : '') + '</td>' +
      '<td>' + esc(userAffName(u)) + '</td>' +
      '<td><span class="ustatus ' + userStatus(u) + '">' + esc(STATUS_LABEL[userStatus(u)] || '') + '</span></td>' +
      '<td class="umono">' + esc(userAssignedText(u)) + '</td>' +
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
    f.innerHTML =
      '<div class="uform-h">' + (isNew ? '＋ Add user' : 'Edit user') + '</div>' +
      '<div class="ufgrid">' +
      '  <label><span>Full name *</span><input class="uf-name" type="text" value="' + esc(u ? u.name : '') + '"></label>' +
      '  <label><span>Username *</span><input class="uf-user" type="text" value="' + esc(u ? u.username : '') + '"></label>' +
      '  <label><span>Email</span><input class="uf-email" type="email" value="' + esc(u && u.email ? u.email : '') + '" placeholder="name@example.org"></label>' +
      '  <label><span>' + (isNew ? 'Password *' : 'Reset password') + '</span><input class="uf-pass" type="text" placeholder="' + (isNew ? '' : 'leave blank to keep') + '" value=""></label>' +
      '  <label><span>Affiliation *</span><select class="uf-aff">' + affiliationSelectOptions(u) + '</select></label>' +
      '  <label><span>Status *</span><select class="uf-status">' +
          lookupOptions('user_status', u ? u.status_id : null, u ? userStatus(u) : 'user') +
        '</select></label>' +
      '  <label class="uf-en"><span>Access</span><select class="uf-enabled"><option value="1"' + ((!u || u.enabled) ? ' selected' : '') + '>Enabled</option><option value="0"' + (u && !u.enabled ? ' selected' : '') + '>Disabled</option></select></label>' +
      '</div>' +
      '<div class="cp-note uf-statusnote"></div>' +
      '<div class="ufbtns"><span class="ufmsg"></span>' +
        '<button class="hbtn uf-cancel" type="button">Cancel</button>' +
        '<button class="hbtn primary uf-save" type="button">' + (isNew ? 'Create user' : 'Save changes') + '</button></div>';

    var affSel = f.querySelector('.uf-aff'), statusSel = f.querySelector('.uf-status');
    var STATUS_NOTE = {
      admin:'Admin - full control: manage users, edit the framework & KPIs, and log activities for any country.',
      user:'User - can log activities (Countries-affiliated users: only for their assigned countries; every other affiliation: any country). No user or framework administration.',
      viewer:'Viewer - read-only. Cannot log activities or edit anything.'
    };
    // the select's values are user_status IDs - resolve to the key for the note
    function syncStatusNote(){ var r = lkRow('user_status', +statusSel.value); f.querySelector('.uf-statusnote').textContent = (r && STATUS_NOTE[r.key]) || ''; }
    statusSel.onchange = syncStatusNote;
    syncStatusNote();

    f.querySelector('.uf-cancel').onclick = function (){ closeUserEdit(); };
    f.querySelector('.uf-save').onclick = function (){
      var name = f.querySelector('.uf-name').value.trim(), uname = f.querySelector('.uf-user').value.trim();
      var email = f.querySelector('.uf-email').value.trim();
      var pass = f.querySelector('.uf-pass').value, statusId = statusSel.value ? +statusSel.value : null;
      var affId = affSel.value ? +affSel.value : null;   // affiliation reference by id
      var msg = f.querySelector('.ufmsg');
      if (!name || !uname) { msg.textContent = 'Name and username are required.'; return; }
      if (usernameTaken(uname, u ? u.id : -1)) { msg.textContent = 'That username is already taken.'; return; }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){ msg.textContent = 'Enter a valid email address.'; return; }
      if (isNew && !pass) { msg.textContent = 'Set an initial password.'; return; }
      if (affId == null) { msg.textContent = 'Pick an affiliation.'; return; }
      var enabled = +f.querySelector('.uf-enabled').value;
      if (isNew) {
        applyUserMutation(DB.insert('user', { username: uname, name: name, email: email || null, password: pass, affiliation_id: affId, status_id: statusId,
          enabled: enabled, created: new Date(TODAY).toISOString().slice(0,10) }));
      } else {
        u.name = name; u.username = uname; u.email = email || null; u.affiliation_id = affId; u.status_id = statusId; u.enabled = enabled;
        delete u.status;    // legacy text column, superseded by status_id
        delete u.section;   // legacy hq/co column, superseded by affiliation_id
        delete u.region; delete u.country_iso3;   // legacy scope columns - scope now = the countries the user Leads
        if (pass) u.password = pass;
        applyUserMutation(DB.persist('user', [u]));
      }
    };
    return f;
  }
  // <option>s for the Affiliation select (value = affiliation id - selections
  // always persist the entity id, never a name). New users default to Countries,
  // mirroring the old default of a country-office section.
  function affiliationSelectOptions(u){
    var cur = (function (){
      var a = affiliationOf(u); if (a) return a.id;
      var c = affByKey('country');
      if (u) return u.section === 'co' && c ? c.id : null;   // legacy row fallback
      return c ? c.id : null;
    })();
    return DB.tables.affiliation.slice().sort(function (a, b){ return (a.seq || 0) - (b.seq || 0); })
      .map(function (a){ return '<option value="' + a.id + '"' + (a.id === cur ? ' selected' : '') + '>' + esc(a.name) + '</option>'; }).join('');
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
  function addPlan(name, desc, start, end, leadId){
    return DB.insert('plan', { name: name, description: desc || '', start_date: start || null, end_date: end || null, lead_id: leadId == null ? null : leadId, seq: nextPlanSeq(), is_default: 0 });
  }
  function editPlan(p, name, desc, start, end, leadId){
    p.name = name; p.description = desc || ''; p.start_date = start || null; p.end_date = end || null; p.lead_id = leadId == null ? null : leadId;
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

  // update every result row (across country instances) matching level+statement(+pillar)
  // WITHIN THE ACTIVE PLAN - a statement/pillar pair can recur in another plan.
  // Renames the statement and/or (re)assigns the Lead (owner_id) in one persist.
  // Pass leadId === undefined to leave the Lead untouched (impact rename has none).
  function updateResults(level, oldStmt, pillar, newStmt, leadId){
    var changed = [];
    DB.tables.result.forEach(function (x){
      if (x.plan_id === S.plan && x.level === level && x.statement === oldStmt && (pillar == null || x.sdg === pillar)) {
        if (newStmt != null) x.statement = newStmt;
        if (leadId !== undefined) x.owner_id = leadId;
        changed.push(x);
      }
    });
    return changed.length ? DB.persist('result', changed) : Promise.resolve();
  }

  // add a new output under every instance of the parent outcome (active plan).
  // KPIs are NOT created here - they are added and attached in the KPI Inventory.
  function addOutput(pillar, outcomeStmt, outStmt, leadId){
    var outcomes = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'outcome' && x.statement === outcomeStmt && x.sdg === pillar; });
    if (!outcomes.length) return Promise.resolve();
    var newOuts = outcomes.map(function (oc){
      // `code` is system-generated in DB.insert (Output #.#.#) - never set here.
      return { plan_id: oc.plan_id, programme_id: oc.programme_id, parent_id: oc.id, level: 'output',
        statement: outStmt, sdg: pillar, owner_id: leadId == null ? null : leadId, assumptions: 'Delivery timelines are met; country offices and partners participate.',
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
  function addPillar(name, impactStmt, leadId){
    var id = nextPillarId();
    var color = NEW_PILLAR_PALETTE[(id - 1) % NEW_PILLAR_PALETTE.length];
    PILLAR_NAMES[id] = name; PILLAR_COLORS[id] = color;
    var rows = DB.tables.programme.map(function (p){
      // `code` is system-generated in DB.insert (Impact #) - never set here.
      return { plan_id: S.plan, programme_id: p.id, parent_id: null, level: 'impact',
        statement: impactStmt, sdg: id, pillar_name: name, pillar_color: color,
        owner_id: leadId == null ? null : leadId,
        assumptions: '', risks: '', risk_level: 'low' };
    });
    return DB.insert('result', rows);
  }
  // add a new Outcome under every country instance of the pillar's impact (active plan)
  function addOutcome(pillar, outcomeStmt, leadId){
    var impacts = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === 'impact' && x.sdg === pillar; });
    if (!impacts.length) return Promise.resolve();
    var rows = impacts.map(function (im){
      // `code` is system-generated in DB.insert (Outcome #.#) - never set here.
      return { plan_id: im.plan_id, programme_id: im.programme_id, parent_id: im.id, level: 'outcome',
        statement: outcomeStmt, sdg: pillar, owner_id: leadId == null ? null : leadId,
        assumptions: '', risks: '', risk_level: 'low' };
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
      main.appendChild(el('span', 'plan-mi-sub', planPeriod(p) + (planPhase(p) ? '  ·  ' + planPhase(p) : '') + (p.lead_id != null ? '  ·  Lead: ' + userName(+p.lead_id) : '')));
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
        '  <label><span>Lead</span><select class="pl-lead">' + userOptions(isEdit && plan.lead_id != null ? +plan.lead_id : null, 'plan') + '</select></label>' +
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
        var leadId = f.querySelector('.pl-lead').value ? +f.querySelector('.pl-lead').value : null;
        var msg = f.querySelector('.ufmsg');
        if (!name){ msg.textContent = 'Plan name is required.'; return; }
        if (start && end && end < start){ msg.textContent = 'End date must be on or after the start date.'; return; }
        msg.textContent = 'Saving…';
        if (isEdit){
          Promise.resolve(editPlan(plan, name, desc, start, end, leadId)).then(function (){
            closeFwEdit(); refreshAfterPlan(); persist();
          });
        } else {
          Promise.resolve(addPlan(name, desc, start, end, leadId)).then(function (rows){
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
      : 'This is the Results Framework of the plan shown above (switch or manage plans from 🗂 Plan Management in the header). Use the Edit buttons to rename a statement or assign its Lead, and the ＋ controls to add Impacts, Outcomes and Outputs. Every change propagates across all country instances of this plan and is saved locally.'));

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
  // The Lead (owner_id) of a framework node - every country instance carries the
  // same Lead, so the first instance is authoritative.
  function frameworkLeadId(level, stmt, pillar){
    var m = DB.tables.result.filter(function (x){ return x.plan_id === S.plan && x.level === level && x.statement === stmt && (pillar == null || x.sdg === pillar); })[0];
    return m && m.owner_id != null ? +m.owner_id : null;
  }
  // Small "👤 Name" chip shown next to a framework statement when a Lead is set.
  function leadChip(level, stmt, pillar){
    var id = frameworkLeadId(level, stmt, pillar);
    if (id == null) return null;
    var chip = el('span', 'cp-leadchip', '👤 ' + userName(id));
    chip.title = 'Lead: ' + userName(id);
    return chip;
  }
  // Read-only statement row + an Edit button that opens the rename child popup –
  // no editing happens on the framework screen itself.
  function stmtRow(labelText, level, stmt, pillar){
    var row = el('div', 'cp-row cp-' + level);
    row.appendChild(el('span', 'cp-lab', labelText));
    var code = frameworkCode(level, stmt, pillar);
    var txt = el('span', 'cp-stmt', (code ? code + ' · ' : '') + stmt); txt.title = stmt; row.appendChild(txt);
    if (level === 'impact' || level === 'outcome'){ var lc = leadChip(level, stmt, pillar); if (lc) row.appendChild(lc); }
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
    var lc = leadChip('output', op, pillar); if (lc) row.appendChild(lc);
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
  // ISO date strings are read verbatim - `new Date('YYYY-MM-DD')` is UTC midnight,
  // so local getMonth() shifted every 1st-of-month date into the PREVIOUS month
  // for any user west of UTC.
  function mmYYYY(d){
    var iso = /^(\d{4})-(\d{2})/.exec(String(d));
    if (iso) return iso[2] + '-' + iso[1];
    var dt = new Date(d); if (isNaN(dt)) return null;
    var m = dt.getMonth() + 1; return (m < 10 ? '0' + m : m) + '-' + dt.getFullYear();
  }
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
    partner:   { label:'Partner',      val:function(r){ return r.partnerPrimary ? r.partnerPrimary.name : null; },
                 color:function(k){ var d=DB.tables.partner.filter(function(x){return x.name===k;})[0]; return d && d.color ? d.color : catColor(k); } },
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
  var DIM_LIST = ['sdg','region','country','donor','partner','project','budget','programme','kpi','user','date','status'];
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
  //  TIMELINE - portfolio delivery Gantt (projects & activities over time)
  // =========================================================================
  //  A schedule view: every project in the current filter set becomes a bar
  //  from its start to end date, coloured by delivery status and filled by
  //  achievement, with its logged activities plotted as ticks along the bar and
  //  a shared TODAY marker. Projects group under the chosen dimension (status,
  //  region, donor, country) so a manager reads the portfolio's shape at a
  //  glance. Everything fits the pane width (no horizontal scroll); the domain
  //  snaps to whole calendar years so the axis is always clean.
  var TL_LABEL_W = 250;   // px - MUST match --tl-label-w in styles.css
  var TL_PAD = 1.6;       // % buffer on each side of the plot band (keeps bars off the card edges)

  // Parse an ISO date to ms (UTC midnight - dates are stored/compared in UTC).
  function tlParse(iso){ if (!iso) return null; var t = Date.parse(String(iso).slice(0, 10)); return isNaN(t) ? null : t; }
  // ms -> "YYYY-MM-DD" (UTC) so shortDate() can format it consistently.
  function tlIso(ms){ var d = new Date(ms); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0'); }

  /** The group bucket(s) {key,label,sub,color,sort} a project belongs to under
   *  the active Timeline dimension - the SAME dimensions the Forecast tab uses.
   *  Most dimensions map a project to ONE group; results-chain dimensions
   *  (impacts / outcomes / outputs) can place it in several (its KPIs may span
   *  more than one), exactly as the Forecast entities do. */
  function tlProjectGroups(p){
    var dim = S.tlDim, out = [];
    function push(key, label, color, sort, sub){ out.push({ key: key, label: label, color: color || '#94a3b8', sort: sort, sub: sub || '' }); }
    if (dim === 'plans'){
      var ap = activePlan(); push('plan', ap ? ap.name : 'Active plan', '#2563eb', '', ap ? planPeriod(ap) : '');
    } else if (dim === 'projects'){
      push('flat', '', '#94a3b8', '');   // no grouping - one flat card of every project bar
    } else if (dim === 'donors'){
      var d = p.donor; push('d:' + (d ? d.id : 0), d ? d.name : 'No donor', (d && d.color) || '#94a3b8', d ? '0' + d.name : '1', d ? donorType(d) : '');
    } else if (dim === 'partners'){
      var pt = p.partner; push('pt:' + (pt ? pt.id : 0), pt ? pt.name : 'No partner', (pt && pt.color) || '#94a3b8', pt ? '0' + pt.name : '1', pt && pt.acronym ? pt.acronym : '');
    } else if (dim === 'regions'){
      var rg = p.region || 'Unassigned'; push('r:' + rg, rg, p.region ? regionColor(p.region) : '#94a3b8', p.region ? '0' + rg : '1');
    } else if (dim === 'countries'){
      var c = p.country; push('c:' + (p.iso || 0), c ? c.name : (p.iso || 'Unknown'), p.iso ? countryColor(p.iso) : '#94a3b8', c ? '0' + c.name : '1', c ? c.region : '');
    } else if (dim === 'impacts'){
      var seen = {};
      (p.kpis || []).forEach(function (r){
        var sdg = r.sdg || 0; if (seen[sdg]) return; seen[sdg] = 1;
        var stmt = ''; FRAMEWORK.forEach(function (g){ if (g.sdg === sdg) stmt = g.impact; });
        push('i:' + sdg, pillarLabel(sdg) + (PILLAR_NAMES[sdg] ? ' · ' + PILLAR_NAMES[sdg] : ''), PILLAR_COLORS[sdg] || '#94a3b8', sdg ? '0' + ('00' + sdg).slice(-3) : '1', stmt);
      });
      if (!out.length) push('i:0', pillarLabel(0), '#94a3b8', '1');
    } else {   // outcomes | outputs
      var lvl = dim === 'outcomes' ? 'outcome' : 'output', pre = lvl + SEP, seen2 = {};
      (p.kpis || []).forEach(function (r){
        (r.chainKeys || []).forEach(function (k){
          if (k.indexOf(pre) !== 0) return;
          var stmt = k.slice(pre.length); if (seen2[stmt]) return; seen2[stmt] = 1;
          var sdg = r.sdg || 0;
          push(lvl + ':' + stmt, stmt, sdg ? PILLAR_COLORS[sdg] : '#94a3b8', '0' + stmt,
            sdg ? (pillarLabel(sdg) + (PILLAR_NAMES[sdg] ? ' · ' + PILLAR_NAMES[sdg] : '')) : cap(lvl));
        });
      });
      if (!out.length) push(lvl + ':0', 'Unassigned ' + lvl, '#94a3b8', '1');
    }
    return out;
  }

  function tlControls(){
    var bar = el('div', 'tl-ctrl');
    var seg = el('span', 'tl-seg');
    FC_DIMS.forEach(function (g){
      var b = el('button', S.tlDim === g[0] ? 'on' : null, g[1]);
      b.onclick = function (){ if (S.tlDim === g[0]) return; S.tlDim = g[0]; renderTimeline(); persist(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    var tog = el('label', 'tl-toggle');
    var cb = el('input'); cb.type = 'checkbox'; cb.checked = !!S.tlActs;
    cb.onchange = function (){ S.tlActs = cb.checked; renderTimeline(); persist(); };
    tog.appendChild(cb); tog.appendChild(document.createTextNode('Show activities'));
    bar.appendChild(tog);
    // Export PDF - same right-aligned control the Forecast tab carries (fc-export
    // owns the margin-left:auto that pushes it to the end of the bar).
    var ex = el('button', 'fc-export');
    ex.type = 'button';
    ex.title = 'Export this timeline as a PDF report';
    ex.innerHTML = '<span class="ic">⤓</span>Export PDF';
    ex.onclick = function (){ try { exportTimelinePDF(); } catch (e){ console.error(e); alert('Could not build the PDF: ' + (e && e.message || e)); } };
    bar.appendChild(ex);
    return bar;
  }

  /** A per-card gridline overlay (year + quarter lines), aligned to the track
   *  column and drawn BEHIND the rows so the lines segment neatly between cards. */
  function tlGridOverlay(xPct, y0, y1, showQ){
    var grid = el('div', 'tl-grid');
    // faint quarter lines first (so the stronger year lines sit on top)
    if (showQ) for (var qy = y0; qy <= y1; qy++){
      [3, 6, 9].forEach(function (m){ var q = el('div', 'gl q'); q.style.left = xPct(Date.UTC(qy, m, 1)) + '%'; grid.appendChild(q); });
    }
    for (var yy = y0; yy <= y1 + 1; yy++){
      var gl = el('div', 'gl'); gl.style.left = xPct(Date.UTC(yy, 0, 1)) + '%'; grid.appendChild(gl);
    }
    return grid;
  }

  /** The TODAY marker, in its own overlay ABOVE the bars (so the line and label
   *  are never hidden behind a project bar). Only the first card gets the label. */
  function tlTodayOverlay(xPct, d0, d1, todayMs, withLabel){
    if (todayMs < d0 || todayMs > d1) return null;
    var ov = el('div', 'tl-today-ov');
    var td = el('div', 'tl-today'); td.style.left = xPct(todayMs) + '%';
    if (withLabel) td.appendChild(el('span', 'tdlab', 'TODAY'));
    ov.appendChild(td);
    return ov;
  }

  function tlLegend(){
    var leg = el('div', 'tl-legend');
    ['blue','green','amber','red','maroon','black'].forEach(function (c){
      var li = el('span', 'li'); var sq = el('span', 'sq'); sq.style.background = STATUS[c].c;
      li.appendChild(sq); li.appendChild(document.createTextNode(STATUS[c].label)); leg.appendChild(li);
    });
    var la = el('span', 'li'); la.appendChild(el('span', 'actmk')); la.appendChild(document.createTextNode('Activity logged')); leg.appendChild(la);
    var lt = el('span', 'li'); lt.appendChild(el('span', 'todaymk')); lt.appendChild(document.createTextNode('Today')); leg.appendChild(lt);
    var le = el('span', 'li mut'); le.appendChild(el('span', 'estmk')); le.appendChild(document.createTextNode('Estimated dates')); leg.appendChild(le);
    return leg;
  }

  /** One project row: fixed label + a positioned bar with progress fill and
   *  activity ticks. left/width are % of the whole-years domain. */
  function tlRow(r, xPct, d0, d1){
    var p = r.p, st = projStatScoped(p), code = st.code || 'nodata', s = STATUS[code] || STATUS.nodata;
    var row = el('div', 'tl-row');

    var lab = el('div', 'tl-label');
    var dot = el('span', 'ldot'); dot.style.background = p.iso ? countryColor(p.iso) : '#94a3b8'; lab.appendChild(dot);
    var lt = el('div', 'ltx');
    lt.appendChild(el('div', 'lnm', (p.code ? p.code + ' · ' : '') + p.name));
    var subTxt = [p.country ? p.country.name : '', p.donor ? (p.donor.short_name || p.donor.name) : ''].filter(Boolean).join(' · ');
    lt.appendChild(el('div', 'lsub', subTxt || '—'));
    lab.appendChild(lt);
    lab.title = (p.code ? p.code + ' · ' : '') + p.name + ' — open this project’s results';
    lab.onclick = function (){ openEntitySummary('project', p.id, true); };
    row.appendChild(lab);

    var track = el('div', 'tl-track');
    var left = Math.max(0, xPct(r.s)), right = Math.min(100, xPct(r.e));
    var bar = el('div', 'tl-bar' + (r.estimated ? ' est' : ''));
    bar.style.left = left + '%'; bar.style.width = Math.max(0.7, right - left) + '%';
    bar.style.setProperty('--bc', s.c);
    // The bar shows PROGRESS (achievement of target) as its meter fill and number -
    // that is the "how far along" figure for visibility. The bar's COLOUR is the
    // performance status (always performance); the tooltip spells out both so the
    // small progress % and the status band never look contradictory.
    var prog = st.frac, perf = st.ratio;
    var fillFrac = prog == null ? null : Math.max(0, Math.min(1, prog));
    if (fillFrac != null){ var fill = el('i', 'fill'); fill.style.width = (fillFrac * 100) + '%'; bar.appendChild(fill); }
    bar.appendChild(el('span', 'blab', prog != null ? Math.round(prog * 100) + '%' : ''));
    bar.title = (p.code ? p.code + ' · ' : '') + p.name + '\n' +
      shortDate(tlIso(r.s)) + ' → ' + shortDate(tlIso(r.e)) + '\n' +
      s.label + (perf != null ? ' (performance ' + Math.round(perf * 100) + '%)' : '') +
      (prog != null ? ' · ' + Math.round(prog * 100) + '% progress' : '') +
      (r.estimated ? '\n(dates estimated from the active plan)' : '') +
      '\n(click to open this project’s results)';
    bar.onclick = function (){ openEntitySummary('project', p.id, true); };
    track.appendChild(bar);

    if (S.tlActs){
      var acts = DB._idx.measByProject[p.id] || [], seen = {}, nAct = 0;
      acts.forEach(function (m){
        var ms = tlParse(m.date); if (ms == null || ms < d0 || ms > d1) return;
        var xp = xPct(ms), bucket = Math.round(xp * 2);   // coalesce ticks within ~0.5% columns
        if (seen[bucket]) { seen[bucket]++; return; } seen[bucket] = 1; nAct++;
        var tk = el('span', 'tl-act'); tk.style.left = xp + '%';
        tk.title = shortDate(tlIso(ms)) + ' · activity logged'; track.appendChild(tk);
      });
      if (nAct) bar.title += '\n' + fmt(p.activityN || acts.length) + ' activit' + ((p.activityN || acts.length) === 1 ? 'y' : 'ies') + ' logged';
    }
    row.appendChild(track);
    return row;
  }

  /** The Timeline's data model - the projects placed on the year domain, fanned
   *  out into the active dimension's groups. One source shared by the on-screen
   *  Gantt (renderTimeline) and the PDF export (tlPdfDoc) so the two can never
   *  drift. Returns { rows, noDate, projects } alone when nothing is placeable;
   *  otherwise adds the domain (y0/y1/d0/d1/span/showQ/todayMs) and the sorted
   *  groups/order. Coordinate mapping is left to each caller (screen plots into a
   *  % band, the PDF into a point rectangle). */
  function tlModel(){
    var projects = projectsFor();
    var ap = activePlan();
    var planS = tlParse(ap && ap.start_date), planE = tlParse(ap && ap.end_date);
    var rows = [], noDate = 0;
    projects.forEach(function (p){
      var s = tlParse(p.start), e = tlParse(p.end);
      var s2 = s != null ? s : (planS != null ? planS : e);
      var e2 = e != null ? e : (planE != null ? planE : s);
      if (s2 == null || e2 == null){ noDate++; return; }
      if (e2 < s2){ var t = s2; s2 = e2; e2 = t; }
      rows.push({ p: p, s: s2, e: e2, estimated: (s == null || e == null) });
    });
    if (!rows.length) return { rows: rows, noDate: noDate, projects: projects };

    // domain: cover every bar, the plan window and today, then snap to whole years
    var t0 = Infinity, t1 = -Infinity, todayMs = TODAY.getTime();
    rows.forEach(function (r){ if (r.s < t0) t0 = r.s; if (r.e > t1) t1 = r.e; });
    if (planS != null && planS < t0) t0 = planS;
    if (planE != null && planE > t1) t1 = planE;
    if (todayMs < t0) t0 = todayMs; if (todayMs > t1) t1 = todayMs;
    var y0 = new Date(t0).getUTCFullYear(), y1 = new Date(t1).getUTCFullYear();
    var d0 = Date.UTC(y0, 0, 1), d1 = Date.UTC(y1 + 1, 0, 1), span = Math.max(1, d1 - d0);
    // Show quarter ticks only when the years are wide enough to fit them.
    var showQ = (y1 - y0 + 1) <= 12;

    // group + sort: a project can land in several buckets (impacts/outcomes/
    // outputs), so we fan each row out over tlProjectGroups(). Groups by the
    // group sort key; rows within a group by start date.
    var flat = (S.tlDim === 'projects');
    var groups = {}, order = [];
    rows.forEach(function (r){
      tlProjectGroups(r.p).forEach(function (g){
        var b = groups[g.key];
        if (!b){ b = groups[g.key] = { meta: g, rows: [] }; order.push(g.key); }
        b.rows.push(r);
      });
    });
    order.sort(function (a, b){ var ga = groups[a].meta.sort, gb = groups[b].meta.sort; return ga < gb ? -1 : ga > gb ? 1 : 0; });
    order.forEach(function (k){ groups[k].rows.sort(function (a, b){ return a.s - b.s || a.e - b.e; }); });

    return { rows: rows, noDate: noDate, projects: projects, todayMs: todayMs,
      y0: y0, y1: y1, d0: d0, d1: d1, span: span, showQ: showQ, flat: flat,
      groups: groups, order: order };
  }

  function renderTimeline(){
    var host = $('#timelineView'); if (!host) return;
    host.innerHTML = '';
    host.appendChild(tlControls());

    var model = tlModel();
    var rows = model.rows, noDate = model.noDate;

    if (!rows.length){
      host.appendChild(el('div', 'tl-empty', model.projects.length
        ? 'The projects under the current filters carry no dates to place on a timeline.'
        : 'No projects match the current filters.'));
      return;
    }

    var todayMs = model.todayMs, y0 = model.y0, y1 = model.y1,
        d0 = model.d0, d1 = model.d1, span = model.span, showQ = model.showQ, flat = model.flat,
        groups = model.groups, order = model.order;
    // Plot into an inset band [TL_PAD .. 100-TL_PAD] so bars, gridlines and the
    // year/quarter axis all share one coordinate system AND leave a small buffer
    // off each card edge (nothing touches the border).
    function xPct(ms){ return TL_PAD + (ms - d0) / span * (100 - 2 * TL_PAD); }

    var wrap = el('div', 'tl-wrap');
    wrap.style.setProperty('--tl-label-w', TL_LABEL_W + 'px');

    // ---- sticky header: summary + year/quarter axis ----
    var head = el('div', 'tl-head');
    var hlab = el('div', 'tl-head-label');
    hlab.appendChild(el('span', 'tl-head-title', fmt(rows.length) + (rows.length === 1 ? ' project' : ' projects')));
    hlab.appendChild(el('span', 'tl-head-sub', y0 === y1 ? String(y0) : (y0 + ' – ' + y1)));
    head.appendChild(hlab);
    var axis = el('div', 'tl-axis');
    // year bands + quarter labels, all positioned by xPct so the axis lines up
    // exactly with the body gridlines (years AND quarters match)
    for (var y = y0; y <= y1; y++){
      var yl = xPct(Date.UTC(y, 0, 1)), yr = xPct(Date.UTC(y + 1, 0, 1));
      var yc = el('div', 'tl-year');
      yc.style.left = yl + '%'; yc.style.width = (yr - yl) + '%';
      yc.appendChild(el('span', 'yl', String(y)));
      axis.appendChild(yc);
      if (showQ) [0, 3, 6, 9].forEach(function (m, qi){
        var qa = xPct(Date.UTC(y, m, 1)), qb = xPct(Date.UTC(y, m + 3, 1));
        var ql = el('div', 'tl-q', 'Q' + (qi + 1)); ql.style.left = ((qa + qb) / 2) + '%';
        axis.appendChild(ql);
      });
    }
    head.appendChild(axis);
    wrap.appendChild(head);

    // ---- one rounded card per group, each with its own gridline overlay ----
    var gwrap = el('div', 'tl-groups');
    order.forEach(function (k, gi){
      var gr = groups[k], card = el('div', 'tl-gcard');
      if (!flat){
        var gh = el('div', 'tl-ghead');
        var gd = el('span', 'gdot'); gd.style.background = gr.meta.color; gh.appendChild(gd);
        gh.appendChild(el('span', 'gnm', gr.meta.label));
        if (gr.meta.sub) gh.appendChild(el('span', 'gsub', truncTxt(gr.meta.sub, 90)));
        gh.appendChild(el('span', 'gct', fmt(gr.rows.length) + (gr.rows.length === 1 ? ' project' : ' projects')));
        card.appendChild(gh);
      }
      var body = el('div', 'tl-gbody');
      body.appendChild(tlGridOverlay(xPct, y0, y1, showQ));
      gr.rows.forEach(function (r){ body.appendChild(tlRow(r, xPct, d0, d1)); });
      var todayOv = tlTodayOverlay(xPct, d0, d1, todayMs, gi === 0);
      if (todayOv) body.appendChild(todayOv);
      card.appendChild(body);
      gwrap.appendChild(card);
    });
    if (noDate) gwrap.appendChild(el('div', 'tl-note', fmt(noDate) + ' project' + (noDate === 1 ? '' : 's') + ' hidden — no start or end date set.'));
    wrap.appendChild(gwrap);

    host.appendChild(wrap);
    host.appendChild(tlLegend());
  }

  /** Label for the active Timeline group-by dimension (mirrors the segment). */
  function tlDimLabel(){ var f = null; FC_DIMS.forEach(function (d){ if (d[0] === S.tlDim) f = d[1]; }); return f || S.tlDim; }

  /** Build and download the Timeline (portfolio delivery Gantt) as a PDF. Runs
   *  off the same tlModel() the on-screen view uses, so the export can never
   *  drift from the screen. Landscape - a Gantt needs the width. */
  function exportTimelinePDF(){
    var model = tlModel();
    if (!model.rows.length){ alert('The timeline has no dated projects to export under the current filters.'); return; }
    tlPdfDoc(model).save(pdfFileName({ title: 'timeline-' + S.tlDim }));
  }

  /** The Timeline panel as a pdfWriter doc - letterhead, plan stamp, a year/
   *  quarter axis and one Gantt block per group (bar coloured by performance
   *  status, filled by progress, activity ticks, a TODAY line), then a legend.
   *  Paginates row-by-row, redrawing the axis at the top of each new page. */
  function tlPdfDoc(model){
    var doc = pdfWriter({ landscape: true }), PW = doc.PW, M = doc.margin, AW = PW - 2 * M;
    doc.addPage();
    var INK = doc.rgb('#1a2230'), MUT = doc.rgb('#8792a3'), SUB = doc.rgb('#5b6675'), NAVY = doc.rgb('#0c447c');
    var rows = model.rows, y0 = model.y0, y1 = model.y1, d0 = model.d0, d1 = model.d1,
        span = model.span, showQ = model.showQ, flat = model.flat,
        groups = model.groups, order = model.order, todayMs = model.todayMs;
    doc.footer = orgBrand() + '  ·  Timeline  ·  ' + fmt(rows.length) + (rows.length === 1 ? ' project' : ' projects');

    // ---- colour + geometry helpers -----------------------------------------
    function mixWhite(hex, t){ var c = doc.rgb(hex); return [c[0] + (1 - c[0]) * t, c[1] + (1 - c[1]) * t, c[2] + (1 - c[2]) * t]; }
    function vline(x, ya, yb, hex, lw, dash){
      var c = doc.rgb(hex), s = 'q ' + c[0] + ' ' + c[1] + ' ' + c[2] + ' RG ' + (lw || 0.5) + ' w ';
      if (dash) s += dash + ' d ';
      s += x.toFixed(2) + ' ' + ya.toFixed(2) + ' m ' + x.toFixed(2) + ' ' + yb.toFixed(2) + ' l S Q';
      doc.raw(s);
    }
    function fit(str, maxW, size, bold){
      var t = String(str == null ? '' : str);
      if (doc.textW(t, size, bold) <= maxW) return t;
      while (t.length > 1 && doc.textW(t + '…', size, bold) > maxW) t = t.slice(0, -1);
      return t + '…';
    }
    var labelW = 178, padL = 6;
    var plotX0 = M + labelW, plotX1 = PW - M, plotW = plotX1 - plotX0;
    function xAt(ms){ return plotX0 + padL + (ms - d0) / span * (plotW - 2 * padL); }

    // ---- letterhead + heading (page 1 only) --------------------------------
    var rt = 'Timeline Export  ·  ' + pdfDate(TODAY);
    pdfBrandHead(doc, M, PW - M - doc.textW(rt, 8.5, false) - 14);
    doc.text(rt, PW - M - doc.textW(rt, 8.5, false), doc.PH - 26, { size: 8.5, color: doc.rgb('#d7e3f0') });
    var y = doc.PH - 63;

    var _ap = activePlan();
    if (_ap){
      var px = M;
      doc.text('PLAN', px, y - 8, { size: 6.5, bold: true, color: MUT });
      px += doc.textW('PLAN', 6.5, true) + 7;
      doc.text(_ap.name, px, y - 8, { size: 9, bold: true, color: NAVY });
      if (planPeriod(_ap)){
        px += doc.textW(_ap.name, 9, true) + 7;
        doc.text('·  ' + planPeriod(_ap), px, y - 8, { size: 8.5, color: MUT });
      }
      y -= 17;
    }
    y -= 7;

    var bw = doc.textW('TIMELINE', 7.5, true) + 16;
    doc.roundRect(M, y - 12.5, bw, 16, 8, NAVY);
    doc.text('TIMELINE', M + 8, y - 8, { size: 7.5, bold: true, color: [1, 1, 1] });
    doc.text('Portfolio delivery timeline', M + bw + 10, y - 9.5, { size: 16, bold: true, color: INK });
    y -= 24;
    var ctx = 'Grouped by ' + tlDimLabel() + '  ·  ' + fmt(rows.length) + (rows.length === 1 ? ' project' : ' projects')
            + '  ·  ' + (y0 === y1 ? String(y0) : (y0 + ' – ' + y1)) + (S.tlActs ? '  ·  activities shown' : '');
    doc.text(ctx, M, y - 8, { size: 9, color: SUB });
    y -= 18;
    y = pdfFilterStrip(doc, activeFilterSummary(), M, AW, y);

    // ---- year / quarter axis (redrawn atop every page) ---------------------
    function drawAxis(){
      var top = y, tickTop = top - 26;
      for (var yy = y0; yy <= y1; yy++){
        var xl = xAt(Date.UTC(yy, 0, 1)), xr = xAt(Date.UTC(yy + 1, 0, 1));
        vline(xl, tickTop, top - 2, '#d7dce4', 0.7);
        var yl = String(yy), wl = doc.textW(yl, 8.5, true);
        doc.text(yl, Math.max((xl + xr) / 2 - wl / 2, xl + 1), top - 11, { size: 8.5, bold: true, color: SUB });
        if (showQ) ['Q1', 'Q2', 'Q3', 'Q4'].forEach(function (q, qi){
          var qa = xAt(Date.UTC(yy, qi * 3, 1)), qb = xAt(Date.UTC(yy, qi * 3 + 3, 1)), wq = doc.textW(q, 6, false);
          doc.text(q, (qa + qb) / 2 - wq / 2, top - 21, { size: 6, color: MUT });
        });
      }
      vline(xAt(Date.UTC(y1 + 1, 0, 1)), tickTop, top - 2, '#d7dce4', 0.7);
      doc.text('PROJECT', M, top - 11, { size: 6.5, bold: true, color: MUT });
      if (todayMs >= d0 && todayMs <= d1){
        var tx = xAt(todayMs), tl = 'TODAY';
        doc.text(tl, Math.min(tx + 3, plotX1 - doc.textW(tl, 6, true)), top - 11, { size: 6, bold: true, color: doc.rgb('#2563eb') });
      }
      y = top - (showQ ? 30 : 26);
    }

    // faint year + quarter gridlines behind a [ya..yb] row band
    function drawGrid(ya, yb){
      for (var yy = y0; yy <= y1 + 1; yy++) vline(xAt(Date.UTC(yy, 0, 1)), ya, yb, '#eef1f5', 0.5);
      if (showQ) for (var yq = y0; yq <= y1; yq++) [3, 6, 9].forEach(function (m){ vline(xAt(Date.UTC(yq, m, 1)), ya, yb, '#f5f7fa', 0.5); });
    }

    var BOT = 46, rowH = 15, barH = 8.5, headH = 17;
    function need(h){ if (y - h < BOT){ doc.addPage(); y = doc.PH - M; drawAxis(); } }

    drawAxis();

    // ---- one Gantt block per group -----------------------------------------
    order.forEach(function (k){
      var gr = groups[k];
      need((flat ? 0 : headH) + rowH + 6);   // keep a header with at least its first row
      if (!flat){
        var hy = y;
        doc.roundRect(M, hy - headH, AW, headH, 3, doc.rgb('#f2f5f9'));
        doc.roundRect(M + 9, hy - headH / 2 - 3, 6, 6, 1.5, doc.rgb(gr.meta.color || '#94a3b8'));
        var gl = fit(gr.meta.label, labelW + 120, 9, true);
        doc.text(gl, M + 21, hy - 11.5, { size: 9, bold: true, color: INK });
        if (gr.meta.sub){
          var glW = doc.textW(gl, 9, true);
          doc.text(fit(gr.meta.sub, 260, 7.5, false), M + 21 + glW + 8, hy - 11.5, { size: 7.5, color: MUT });
        }
        var cnt = fmt(gr.rows.length) + (gr.rows.length === 1 ? ' project' : ' projects');
        doc.text(cnt, PW - M - doc.textW(cnt, 7.5, false), hy - 11.5, { size: 7.5, color: MUT });
        y -= headH + 2;
      }
      gr.rows.forEach(function (r){
        need(rowH);
        var top = y, mid = top - rowH / 2;
        drawGrid(top, top - rowH);
        if (todayMs >= d0 && todayMs <= d1) vline(xAt(todayMs), top, top - rowH, '#2563eb', 1, '[2 2] 0');

        var p = r.p, st = projStatScoped(p), code = st.code || 'nodata', s = STATUS[code] || STATUS.nodata;
        var nm = (p.code ? p.code + ' · ' : '') + p.name;
        doc.text(fit(nm, labelW - 8, 8, true), M, mid + 1.5, { size: 8, bold: true, color: INK });
        var sub = [p.country ? p.country.name : '', p.donor ? (p.donor.short_name || p.donor.name) : ''].filter(Boolean).join(' · ');
        doc.text(fit(sub || '—', labelW - 8, 6.5, false), M, mid - 6.5, { size: 6.5, color: MUT });

        var bx0 = Math.max(xAt(r.s), plotX0 + 1), bx1 = Math.min(xAt(r.e), plotX1 - 1);
        var bw2 = Math.max(3, bx1 - bx0), by = mid - barH / 2;
        doc.roundRect(bx0, by, bw2, barH, 2.5, mixWhite(s.c, 0.78));            // track tint
        var prog = st.frac == null ? null : Math.max(0, Math.min(1, st.frac));
        if (prog != null && prog > 0) doc.roundRect(bx0, by, Math.max(1.4, bw2 * prog), barH, 2.5, doc.rgb(s.c));
        doc.roundRect(bx0, by, bw2, barH, 2.5, r.estimated ? doc.rgb('#b7bfca') : doc.rgb(s.c), r.estimated ? 0.7 : 0.9);

        if (S.tlActs){
          var acts = DB._idx.measByProject[p.id] || [], seen = {};
          acts.forEach(function (m){
            var ms = tlParse(m.date); if (ms == null || ms < d0 || ms > d1) return;
            var xp = xAt(ms); if (xp < bx0 + 1 || xp > bx1 - 1) return;
            var b = Math.round(xp); if (seen[b]) return; seen[b] = 1;
            doc.rect(xp - 0.6, by + barH / 2 - 1.3, 1.2, 2.6, doc.rgb('#3a4658'));
          });
        }
        if (prog != null){
          var pl = Math.round(prog * 100) + '%', plw = doc.textW(pl, 6.5, true);
          if (bx1 + 4 + plw <= plotX1) doc.text(pl, bx1 + 4, mid - 2.2, { size: 6.5, bold: true, color: SUB });
          else if (bw2 > plw + 8) doc.text(pl, bx1 - plw - 3, mid - 2.2, { size: 6.5, bold: true, color: INK });
        }
        y -= rowH;
      });
      y -= 6;
    });

    if (model.noDate){
      need(14);
      doc.text(fmt(model.noDate) + ' project' + (model.noDate === 1 ? '' : 's') + ' hidden - no start or end date set.',
        M, y - 8, { size: 7.5, italic: true, color: MUT });
      y -= 14;
    }

    // ---- legend ------------------------------------------------------------
    need(20);
    var ly = y - 8, lx = M;
    doc.text('LEGEND', lx, ly, { size: 6.5, bold: true, color: MUT }); lx += doc.textW('LEGEND', 6.5, true) + 12;
    ['blue', 'green', 'amber', 'red', 'maroon', 'black'].forEach(function (c){
      doc.roundRect(lx, ly - 6.5, 9, 8, 2, doc.rgb(STATUS[c].c)); lx += 12;
      doc.text(STATUS[c].label, lx, ly, { size: 7, color: SUB }); lx += doc.textW(STATUS[c].label, 7, false) + 14;
    });
    doc.rect(lx, ly - 5, 1.4, 6, doc.rgb('#3a4658')); lx += 6;
    doc.text('Activity logged', lx, ly, { size: 7, color: SUB }); lx += doc.textW('Activity logged', 7, false) + 14;
    vline(lx + 0.7, ly - 6, ly + 2, '#2563eb', 1, '[2 2] 0'); lx += 6;
    doc.text('Today', lx, ly, { size: 7, color: SUB }); lx += doc.textW('Today', 7, false) + 14;
    doc.roundRect(lx, ly - 6.5, 13, 8, 2, doc.rgb('#b7bfca'), 0.7); lx += 16;
    doc.text('Estimated dates', lx, ly, { size: 7, color: SUB });

    return doc;
  }

  // =========================================================================
  //  FORECAST - scenario projections toward targets (senior-management view)
  // =========================================================================
  // The engine works in ACHIEVEMENT space: a = (value − baseline) / (target −
  // baseline), so 0 is the baseline, 1 is the target, and every KPI - counts
  // and levels alike - is comparable and can be averaged into an entity. Per
  // KPI it derives the recent monthly velocity (OLS slope over the last 12
  // monthly positions) and its volatility (std-dev of month-over-month moves):
  // REALISTIC continues at that velocity; BEST / WORST run at velocity ± one
  // volatility, so the cone widens with how erratic delivery has been, not by
  // an arbitrary %. Projections freeze at each KPI's own target date - no
  // progress is assumed beyond the plan window.

  var FC_DIMS = [['plans','Plans'],['impacts','Impacts'],['outcomes','Outcomes'],['outputs','Outputs'],['projects','Projects'],['donors','Donors'],['partners','Partners'],['regions','Regions'],['countries','Countries']];
  var FC_SING = { plans:'Plan', impacts:'Impact', outcomes:'Outcome', outputs:'Output', projects:'Project', donors:'Donor', partners:'Partner', regions:'Region', countries:'Country' };
  var FC_HORIZONS = [['plan','End of plan'],['6m','+6 months'],['12m','+12 months'],['24m','+24 months']];
  var FC_MONS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  var FC_COL = { hi:'#16a34a', mid:'#2563eb', lo:'#ef4444' };
  // When set (a month index), the forecast anchors "now" here instead of the wall
  // clock. The monthly-report bundle uses it so the brief's NOW column is the same
  // as-of snapshot as its results report (end of the report month), rather than
  // silently folding in partial data from a later, still-open month. null = live
  // (the on-screen Forecast tab and standalone export always run from TODAY).
  var FC_ASOF_MI = null;

  // UTC getters: measurement dates parse to UTC midnight, so local getters would
  // bucket every 1st-of-month report into the previous month west of UTC.
  function fcMi(ms){ var d = new Date(ms); return d.getUTCFullYear() * 12 + d.getUTCMonth(); }
  function fcNowMi(){ return FC_ASOF_MI != null ? FC_ASOF_MI : fcMi(TODAY.getTime()); }
  function fcMiLab(mi){ return FC_MONS[((mi % 12) + 12) % 12] + ' ' + String(Math.floor(mi / 12)).slice(2); }
  function fcMiFull(mi){ return FC_MONS[((mi % 12) + 12) % 12] + ' ' + Math.floor(mi / 12); }
  function fcPct(a){ return a == null ? '–' : Math.round(a * 100) + '%'; }
  function fcClamp(a){ return Math.max(-0.25, Math.min(1.6, a)); }
  function fcDimLabel(){ var l = ''; FC_DIMS.forEach(function (d){ if (d[0] === S.fcDim) l = d[1]; }); return l; }
  /** Horizon as a phrase that follows a verb: "at end of plan" / "in 12 months". */
  function fcHorizonLabel(){ return S.fcHorizon === 'plan' ? 'at end of plan' : 'in ' + parseInt(S.fcHorizon, 10) + ' months'; }

  function fcOlsSlope(arr){
    var n = arr.length; if (n < 2) return 0;
    var sx = 0, sy = 0, sxy = 0, sxx = 0;
    for (var i = 0; i < n; i++){ sx += i; sy += arr[i]; sxy += i * arr[i]; sxx += i * i; }
    var d = n * sxx - sx * sx;
    return d ? (n * sxy - sx * sy) / d : 0;
  }
  function fcDeltaSd(arr){
    if (arr.length < 3) return 0;
    var ds = [], i, m = 0, v = 0;
    for (i = 1; i < arr.length; i++) ds.push(arr[i] - arr[i - 1]);
    ds.forEach(function (d){ m += d; }); m /= ds.length;
    ds.forEach(function (d){ v += (d - m) * (d - m); }); v /= (ds.length - 1);
    return Math.sqrt(v);
  }

  /** Per-KPI forecast. Needs only r.raw (baseline/target/dates/unit) + r.series,
   *  so it also works on the lightweight rows built for non-active plans. */
  function kpiForecast(r){
    var ind = r.raw, b = +ind.baseline_value, t = +ind.target_value;
    if (!isFinite(b) || !isFinite(t) || t === b) return null;            // unmeasurable
    var series = r.series || [];
    var span = t - b;
    var yrs = kpiWindowYears(ind);
    var m0 = fcMi(ind.baseline_date ? Date.parse(ind.baseline_date) : Date.UTC(yrs.start, 0, 1));
    var mEnd = fcMi(ind.target_date ? Date.parse(ind.target_date) : Date.UTC(yrs.end, 11, 31));
    if (mEnd <= m0) mEnd = m0 + 1;
    var mNow = Math.max(fcNowMi(), m0);
    // Measurable but never reported: the results engine treats this as a STANDING
    // 0% (Under Track) that is COUNTED, never dropped, in every average. The
    // forecast mirrors that - 0% now and, with no data to imply otherwise, held
    // flat at 0 across every scenario - and keeps it in `fcs`, so NOW, the history
    // line and the scenarios all average over the SAME KPI set the results screens
    // use. That is what makes the forecast NOW column tally with results Progress.
    // It stays flagged `unreported` so the "no reports yet" advice can still count it.
    if (!series.length) return {
      ok: true, unreported: true, a0: 0, aArr: [0], m0: m0, mEnd: mEnd, mNow: mNow,
      slope: 0, slopeHi: 0, slopeLo: 0, monthsLeft: Math.max(0, mEnd - mNow),
      needSlope: mEnd - mNow > 0 ? 1 / (mEnd - mNow) : Infinity, reps: 0, lastMi: m0
    };
    // monthly achievement positions from the baseline month to now (carry-forward)
    var acc = kpiUnit(ind) === 'count', sumBy = {}, lvlBy = {};
    series.forEach(function (m){
      var mi = fcMi(Date.parse(m.date)); if (!isFinite(mi)) return;
      if (acc) sumBy[mi] = (sumBy[mi] || 0) + (+m.value || 0);
      else lvlBy[mi] = +m.value;              // chronological series → keeps the month's last report
    });
    var aArr = [], cum = b, lvl = null, k;
    for (k = m0; k <= mNow; k++){
      if (acc){ cum += (sumBy[k] || 0); aArr.push((cum - b) / span); }
      else { if (lvlBy[k] != null) lvl = lvlBy[k]; aArr.push(lvl == null ? 0 : (lvl - b) / span); }
    }
    var a0 = aArr[aArr.length - 1];
    var w = aArr.slice(Math.max(0, aArr.length - 12));   // the recent pace matters most
    var slope = fcOlsSlope(w), sd = fcDeltaSd(w);
    if (!(sd > 0)) sd = Math.abs(slope) * 0.25 || 0.008; // flat history → assume ±25% (min ±0.8pp/mo)
    var monthsLeft = Math.max(0, mEnd - mNow);
    return {
      ok: true, a0: a0, aArr: aArr, m0: m0, mEnd: mEnd, mNow: mNow,
      slope: slope, slopeHi: slope + sd, slopeLo: slope - sd,
      monthsLeft: monthsLeft,
      needSlope: a0 >= 1 ? 0 : (monthsLeft > 0 ? (1 - a0) / monthsLeft : Infinity),
      reps: series.length,
      lastMi: fcMi(Date.parse(series[series.length - 1].date))
    };
  }

  /** Scenario position of one KPI at month mi. Frozen past its own plan end -
   *  and never projected BACKWARDS: a KPI whose target month already passed
   *  (mEnd < mNow) holds its current position instead of extrapolating a
   *  negative month delta (which inverted best/worst and understated it). */
  function fcAt(f, which, mi){
    var m = Math.max(f.mNow, Math.min(mi, Math.max(f.mEnd, f.mNow)));
    var sl = which === 'hi' ? f.slopeHi : which === 'lo' ? f.slopeLo : f.slope;
    return fcClamp(f.a0 + sl * (m - f.mNow));
  }

  // ---- entities: the six dimensions -----------------------------------------
  // projFilter (optional): predicate limiting which linked projects count toward
  // nProj - shared KPIs can be linked to projects outside the entity (e.g. a
  // KPI two donors co-fund), and those must not inflate the entity's tally.
  function fcEntity(key, label, sub, color, members, projFilter){
    var fcs = [], nodata = 0, pset = {};
    members.forEach(function (r){
      var f = kpiForecast(r);
      if (f && f.ok){ fcs.push(f); if (f.unreported) nodata++; }
      (r.projectIds || []).forEach(function (pid){
        if (!projFilter || projFilter(DB._idx.projectById[pid])) pset[pid] = 1;
      });
    });
    return { key: key, label: label, sub: sub, color: color, n: members.length,
             nProj: Object.keys(pset).length, fcs: fcs, nodataN: nodata };
  }

  function fcHorizonMi(ent){
    var mNow = fcNowMi();
    if (S.fcHorizon !== 'plan') return mNow + { '6m': 6, '12m': 12, '24m': 24 }[S.fcHorizon];
    var mx = mNow + 1;
    ent.fcs.forEach(function (f){ if (f.mEnd > mx) mx = f.mEnd; });
    return mx;
  }
  /** Mean scenario position of an entity's KPIs at month mi. */
  function fcMean(ent, which, mi){
    if (!ent.fcs.length) return null;
    var s = 0; ent.fcs.forEach(function (f){ s += fcAt(f, which, mi); });
    return s / ent.fcs.length;
  }
  /** Mean HISTORICAL position at a past month (0 before a KPI's window opens). */
  function fcHist(ent, mi){
    if (!ent.fcs.length) return null;
    var s = 0;
    ent.fcs.forEach(function (f){ s += mi < f.m0 ? 0 : f.aArr[Math.min(mi - f.m0, f.aArr.length - 1)]; });
    return s / ent.fcs.length;
  }

  /** Headline numbers for one entity, at its own horizon. */
  function fcCompute(ent){
    var mNow = fcNowMi(), mH = ent.mH = fcHorizonMi(ent);
    if (!ent.fcs.length){
      ent.aNow = ent.aW = ent.aR = ent.aB = ent.exp = null; ent.code = 'nodata';
      ent.slope = 0; ent.mEnd = null; ent.needSlope = null; ent.paceX = null; ent.etaMi = null;
      ent.reps = 0; ent.staleN = 0; ent.regressN = 0; ent.winsN = 0; ent.unreachN = 0; ent.overN = 0; ent.conf = '–';
      return;
    }
    // NOW is a pure ACTUAL: the mean achieved progress of every measurable KPI
    // (unreported ones counted as 0), computed exactly as the results screens
    // compute Progress, so the two always tally. Predictions (aW/aR/aB) extend
    // FROM this actual into the future - they are never blended into NOW.
    var aNowSum = 0; ent.fcs.forEach(function (f){ aNowSum += f.a0; });
    ent.aNow = aNowSum / ent.fcs.length;
    ent.aW = fcMean(ent, 'lo', mH); ent.aR = fcMean(ent, 'mid', mH); ent.aB = fcMean(ent, 'hi', mH);
    // expected-by-horizon share of each KPI's window → projected RAG (Performance logic)
    var ex = 0;
    ent.fcs.forEach(function (f){ ex += Math.max(0.02, Math.min(1, (Math.min(mH, f.mEnd) - f.m0) / (f.mEnd - f.m0))); });
    ent.exp = ex / ent.fcs.length;
    ent.code = ratioToCode(ent.aR / ent.exp);
    // pace: the monthly velocity the target needs (by plan end) vs the current one
    var slope = 0, mEndMax = mNow + 1;
    ent.fcs.forEach(function (f){ slope += f.slope; if (f.mEnd > mEndMax) mEndMax = f.mEnd; });
    slope /= ent.fcs.length;
    ent.slope = slope; ent.mEnd = mEndMax;
    var left = Math.max(0, mEndMax - mNow);
    ent.needSlope = ent.aNow >= 1 ? 0 : (left > 0 ? (1 - ent.aNow) / left : Infinity);
    ent.paceX = ent.needSlope === 0 ? 0
      : (ent.needSlope !== Infinity && slope > 1e-6 ? ent.needSlope / slope : null);
    ent.etaMi = ent.aNow >= 1 ? mNow : (slope > 1e-6 ? mNow + Math.ceil((1 - ent.aNow) / slope) : null);
    var reps = 0, stale = 0, regress = 0, wins = 0, unreach = 0, over = 0;
    ent.fcs.forEach(function (f){
      reps += f.reps;
      if (mNow - f.lastMi >= 3) stale++;
      if (f.slope < -1e-4) regress++;
      var r = fcAt(f, 'mid', mH); if (r >= 0.85 && r < 1) wins++;
      if (fcAt(f, 'hi', f.mEnd) < 1) unreach++;
      // Over Track per KPI: realistic forecast ahead of that KPI's expected-by-horizon share
      var exf = Math.max(0.02, Math.min(1, (Math.min(mH, f.mEnd) - f.m0) / (f.mEnd - f.m0)));
      if (r / exf > 1) over++;
    });
    ent.reps = reps; ent.staleN = stale; ent.regressN = regress; ent.winsN = wins; ent.unreachN = unreach; ent.overN = over;
    var mean = reps / ent.fcs.length;
    ent.conf = mean >= 6 ? 'High' : mean >= 3 ? 'Medium' : 'Low';
  }

  function fcEntities(rowsOverride){
    var rows = rowsOverride || filtered(), ents = [];
    if (S.fcDim === 'plans'){
      // the whole app is scoped to ONE active plan - forecast it alone
      var ap = activePlan();
      if (ap){
        var period = (ap.start_date ? yearOf(ap.start_date) : '?') + '–' + (ap.end_date ? yearOf(ap.end_date) : '?');
        ents.push(fcEntity('plan:' + ap.id, ap.name, period + ' · active plan', '#2563eb', rows));
      }
    } else if (S.fcDim === 'impacts'){
      var bySdg = {};
      rows.forEach(function (r){ if (r.sdg != null) (bySdg[r.sdg] = bySdg[r.sdg] || []).push(r); });
      Object.keys(bySdg).forEach(function (s){
        var sdg = +s, stmt = '';
        FRAMEWORK.forEach(function (g){ if (g.sdg === sdg) stmt = g.impact; });
        ents.push(fcEntity('impact:' + sdg,
          pillarLabel(sdg) + (PILLAR_NAMES[sdg] ? ' · ' + PILLAR_NAMES[sdg] : ''), stmt,
          PILLAR_COLORS[sdg] || '#94a3b8', bySdg[sdg]));
      });
    } else if (S.fcDim === 'outcomes' || S.fcDim === 'outputs'){
      var lvl = S.fcDim === 'outcomes' ? 'outcome' : 'output', pre = lvl + SEP, by = {};
      rows.forEach(function (r){
        (r.chainKeys || []).forEach(function (k){
          if (k.indexOf(pre) !== 0) return;
          var g = by[k.slice(pre.length)] = by[k.slice(pre.length)] || { rows: [], sdg: r.sdg };
          g.rows.push(r);
        });
      });
      Object.keys(by).forEach(function (stmt){
        var g = by[stmt];
        ents.push(fcEntity(lvl + ':' + stmt, stmt,
          g.sdg ? pillarLabel(g.sdg) + (PILLAR_NAMES[g.sdg] ? ' · ' + PILLAR_NAMES[g.sdg] : '') : cap(lvl),
          g.sdg ? PILLAR_COLORS[g.sdg] : '#94a3b8', g.rows));
      });
    } else if (S.fcDim === 'projects'){
      var inSet = {}; rows.forEach(function (r){ inSet[r.id] = 1; });
      var progIso = progIsoSet();
      PROJECTS.forEach(function (p){
        if (!projectPassesFacets(p, false, progIso)) return;
        var mem = p.kpis.filter(function (r){ return inSet[r.id]; });
        if (!mem.length) return;
        ents.push(fcEntity('project:' + p.id, (p.code ? p.code + ' · ' : '') + p.name,
          (p.country ? p.country.name : '') + (p.donor ? ' · ' + (p.donor.short_name || p.donor.name) : ''),
          p.iso ? countryColor(p.iso) : '#94a3b8', mem));
      });
    } else if (S.fcDim === 'donors'){
      var byDon = {};
      rows.forEach(function (r){
        (r.donorIds || []).forEach(function (id){ (byDon[id] = byDon[id] || []).push(r); });
      });
      Object.keys(byDon).forEach(function (idS){
        var d = DB._idx.donorById[+idS];
        ents.push(fcEntity('donor:' + idS, d ? d.name : 'Donor ' + idS,
          d ? (d.short_name ? d.short_name + ' · ' : '') + donorType(d) + (donorType(d) ? ' donor' : '') : '',
          (d && d.color) || '#94a3b8', byDon[idS],
          function (p){ return p && p.donor_id === +idS; }));
      });
    } else if (S.fcDim === 'partners'){
      var byPt = {};
      rows.forEach(function (r){
        (r.partnerIds || []).forEach(function (id){ (byPt[id] = byPt[id] || []).push(r); });
      });
      Object.keys(byPt).forEach(function (idS){
        var d = DB._idx.partnerById[+idS];
        ents.push(fcEntity('partner:' + idS, d ? d.name : 'Partner ' + idS,
          d ? ((d.acronym ? d.acronym + ' · ' : '') + 'implementing partner') : '',
          (d && d.color) || '#94a3b8', byPt[idS],
          function (p){ return p && p.partner_id === +idS; }));
      });
    } else if (S.fcDim === 'regions'){
      var byReg = {};
      rows.forEach(function (r){
        if (!r.region) return;
        var g = byReg[r.region] = byReg[r.region] || { rows: [], isos: {} };
        g.rows.push(r);
        if (r.iso) g.isos[r.iso] = 1;
      });
      regionNames().concat(Object.keys(byReg)).forEach(function (reg){
        var g = byReg[reg]; if (!g || g.done) return; g.done = true;
        var nCo = Object.keys(g.isos).length;
        ents.push(fcEntity('region:' + reg, reg, nCo + (nCo === 1 ? ' country' : ' countries'),
          regionColor(reg), g.rows,
          // membership by the PROJECT's own region - a shared KPI can be linked to
          // a project in a sister country that contributed no KPI row of its own
          function (p){ var c = p && DB._idx.countryByIso[p.country_iso3]; return !!(c && c.region === reg); }));
      });
    } else {   // countries
      var byIso = {};
      rows.forEach(function (r){ if (r.iso) (byIso[r.iso] = byIso[r.iso] || []).push(r); });
      Object.keys(byIso).forEach(function (iso){
        var co = DB._idx.countryByIso[iso];
        ents.push(fcEntity('country:' + iso, co ? co.name : iso, co ? co.region : '', countryColor(iso), byIso[iso],
          function (p){ return p && p.country_iso3 === iso; }));
      });
    }
    ents.forEach(fcCompute);
    // risk first: the lowest realistic forecast leads the table
    ents.sort(function (a, b){ return (a.aR == null ? 2 : a.aR) - (b.aR == null ? 2 : b.aR); });
    return ents;
  }

  // ---- render ---------------------------------------------------------------
  function renderForecast(){
    var host = $('#forecastView'); if (!host) return;
    host.innerHTML = '';
    var ents = fcEntities();
    var sel = null;
    if (S.fcSel){
      ents.forEach(function (e){ if (e.key === S.fcSel) sel = e; });
      if (!sel) S.fcSel = null;
    }
    var scope = sel;
    if (!scope){
      var ap = activePlan();
      scope = fcEntity('__all__', 'Whole portfolio' + (ap ? ' · ' + ap.name : ''), '', '#2563eb', filtered());
      fcCompute(scope);
    }
    host.appendChild(fcControls(sel));
    var body = el('div', 'fc-body');
    var strip = filterStripHTML();
    if (strip) body.appendChild(elHTML('div', 'fc-strip', strip));
    body.appendChild(fcTiles(scope, ents));
    var mid = el('div', 'fc-mid');
    mid.appendChild(fcChartCard(scope));
    mid.appendChild(fcAdviceCard(scope, ents, !!sel));
    body.appendChild(mid);
    body.appendChild(fcTableCard(ents, sel));
    host.appendChild(body);
  }

  function fcControls(sel){
    var bar = el('div', 'fc-ctrl');
    var seg = el('span', 'fc-seg');
    FC_DIMS.forEach(function (d){
      var b = el('button', S.fcDim === d[0] ? 'on' : null, d[1]);
      b.onclick = function (){ if (S.fcDim === d[0]) return; S.fcDim = d[0]; S.fcSel = null; renderForecast(); persist(); };
      seg.appendChild(b);
    });
    bar.appendChild(seg);
    bar.appendChild(el('span', 'fc-lbl', 'Horizon'));
    var hs = el('select');
    FC_HORIZONS.forEach(function (h){ var o = el('option', null, h[1]); o.value = h[0]; if (h[0] === S.fcHorizon) o.selected = true; hs.appendChild(o); });
    hs.onchange = function (){ S.fcHorizon = hs.value; renderForecast(); persist(); };
    bar.appendChild(hs);
    if (sel){
      var chip = el('button', 'fc-selchip');
      chip.title = 'Focused on ' + sel.label + ' - click to return to the whole portfolio';
      var dt = el('span', 'dot'); dt.style.background = sel.color || '#94a3b8';
      chip.appendChild(dt);
      chip.appendChild(document.createTextNode(truncTxt(sel.label, 44)));
      chip.appendChild(el('span', 'x', '×'));
      chip.onclick = function (){ S.fcSel = null; renderForecast(); };
      bar.appendChild(chip);
    }
    var ex = el('button', 'fc-export');
    ex.type = 'button';
    ex.title = 'Export this forecast view as a PDF report';
    ex.innerHTML = '<span class="ic">⤓</span>Export PDF';
    ex.onclick = function (){ try { exportForecastPDF(); } catch (e){ console.error(e); alert('Could not build the PDF: ' + (e && e.message || e)); } };
    bar.appendChild(ex);
    return bar;
  }

  /** The six headline tiles as plain data - one source for the on-screen grid
   *  AND the PDF export, so the two can never drift apart. */
  function fcTileData(scope, ents){
    var tiles = [], st = STATUS[scope.code] || STATUS.nodata;
    tiles.push({ l: 'Forecast ' + fcHorizonLabel(), v: fcPct(scope.aR), s: st.label, chip: st.c });
    tiles.push({ l: 'Scenario range', v: scope.aW == null ? '–' : fcPct(scope.aW) + ' – ' + fcPct(scope.aB), s: 'worst → best case' });
    var on = 0, over = 0, tot = 0;
    ents.forEach(function (e){ if (e.aR == null) return; tot++; if (e.code === 'green') on++; else if (e.code === 'blue') over++; });
    tiles.push({ l: fcDimLabel() + ' on course', v: tot ? on + ' / ' + tot : '–',
      s: over ? 'On Track at horizon · ' + over + ' Over Track (ease off)' : 'projected On Track at horizon' });
    var etaTxt = scope.aNow != null && scope.aNow >= 1 ? 'Achieved'
      : scope.etaMi == null ? (scope.aR == null ? '–' : 'Not at this pace')
      : fcMiFull(scope.etaMi) + (scope.mEnd != null && scope.etaMi > scope.mEnd ? ' ⚠' : '');
    tiles.push({ l: 'Target attained (realistic)', v: etaTxt, s: scope.mEnd != null ? 'plan ends ' + fcMiFull(scope.mEnd) : null });
    var paceTxt, paceSub = null;
    if (scope.aR == null){ paceTxt = '–'; }
    else if (scope.paceX === 0){ paceTxt = '✓'; paceSub = 'target already met'; }
    else if (scope.paceX == null){ paceTxt = 'Stalled'; paceSub = 'no positive pace to scale'; }
    else {
      paceTxt = '×' + (scope.paceX >= 10 ? Math.round(scope.paceX) : scope.paceX.toFixed(1));
      paceSub = (scope.needSlope * 100).toFixed(1) + 'pp/mo needed · now ' + (scope.slope * 100).toFixed(1);
    }
    tiles.push({ l: 'Pace to hit target', v: paceTxt, s: paceSub });
    tiles.push({ l: 'Forecast confidence', v: scope.conf,
      s: scope.fcs.length ? fmt(scope.fcs.length) + ' KPIs · ' + fmt(scope.reps) + ' reports' + (scope.nodataN ? ' · ' + fmt(scope.nodataN) + ' no data' : '')
                          : 'no measurable KPIs in this slice' });
    return tiles;
  }

  function fcTiles(scope, ents, onCourseLabel){
    var grid = el('div', 'fc-tiles');
    var data = fcTileData(scope, ents);
    // the third tile is "<dimension> on course" - a forecast report counts the
    // breakdown below (projects / KPIs), so let the caller relabel it to match
    if (onCourseLabel && data[2]) data[2].l = onCourseLabel;
    data.forEach(function (d){
      var t = el('div', 'fc-tile');
      t.appendChild(el('div', 'tl', d.l));
      t.appendChild(el('div', 'tv', d.v));
      var s = el('div', 'ts');
      if (d.s != null){
        if (d.chip){ var c = el('span', 'chip', d.s); c.style.background = d.chip; s.appendChild(c); }
        else s.textContent = d.s;
      }
      t.appendChild(s);
      grid.appendChild(t);
    });
    return grid;
  }

  /** The Best/Realistic/Worst legend - lives on the chart card, whose lines it
   *  explains (it used to crowd the control bar). */
  function fcScenLegend(){
    var leg = el('span', 'fc-scen');
    [['hi','Best case'],['mid','Realistic'],['lo','Worst case']].forEach(function (s){
      var li = el('span', 'li'); var sq = el('span', 'sq'); sq.style.background = FC_COL[s[0]];
      li.appendChild(sq); li.appendChild(document.createTextNode(s[1])); leg.appendChild(li);
    });
    return leg;
  }

  function fcChartCard(scope){
    var card = el('div', 'fc-card fc-chartcard');
    var head = el('div', 'fc-chart-head');
    head.appendChild(el('div', 'fc-h', 'Trajectory · ' + truncTxt(scope.label, 70) + ' · actuals, then scenarios ' +
      (S.fcHorizon === 'plan' ? 'to end of plan' : 'for the next ' + parseInt(S.fcHorizon, 10) + ' months')));
    head.appendChild(fcScenLegend());
    card.appendChild(head);
    var wrap = el('div', 'fc-chart');
    wrap.innerHTML = fcChartSvg(scope);
    card.appendChild(wrap);
    return card;
  }

  function fcChartSvg(scope){
    if (!scope.fcs.length) return '<div class="empty">No measurable KPIs under the current filters.</div>';
    var mNow = fcNowMi(), mH = Math.max(scope.mH, mNow + 1), k;
    var m0 = mNow; scope.fcs.forEach(function (f){ if (f.m0 < m0) m0 = f.m0; });
    var hist = [];
    for (k = m0; k <= mNow; k++) hist.push(fcHist(scope, k));
    var fu = { lo: [], mid: [], hi: [] };
    for (k = mNow; k <= mH; k++){ fu.lo.push(fcMean(scope, 'lo', k)); fu.mid.push(fcMean(scope, 'mid', k)); fu.hi.push(fcMean(scope, 'hi', k)); }
    var maxV = 1.12, minV = 0;
    hist.concat(fu.hi, fu.lo).forEach(function (v){ if (v > maxV - 0.08) maxV = v + 0.08; if (v < minV) minV = v - 0.04; });
    var W = 900, H = 400, padL = 44, padR = 76, padT = 16, padB = 30;
    var plotW = W - padL - padR, plotH = H - padT - padB, nM = mH - m0;
    function X(mi){ return padL + (mi - m0) / nM * plotW; }
    function Y(a){ return padT + plotH - (a - minV) / (maxV - minV) * plotH; }
    var svg = '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';
    for (var g = Math.ceil(minV / 0.25) * 0.25; g <= maxV + 1e-9; g += 0.25){
      var gy = Y(g);
      svg += '<line class="gridline" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy.toFixed(1) + '" y2="' + gy.toFixed(1) + '"/>';
      svg += '<text class="axlabel" x="' + (padL - 7) + '" y="' + (gy + 3).toFixed(1) + '" text-anchor="end">' + Math.round(g * 100) + '%</text>';
    }
    var ty = Y(1);
    svg += '<line class="fc-target" x1="' + padL + '" x2="' + (W - padR) + '" y1="' + ty.toFixed(1) + '" y2="' + ty.toFixed(1) + '"/>';
    svg += '<text class="fc-tlab" x="' + (W - padR - 4) + '" y="' + (ty - 5).toFixed(1) + '" text-anchor="end">TARGET 100%</text>';
    var step = Math.max(1, Math.round(nM / 8));
    for (k = m0; k <= mH; k += step)
      svg += '<text class="xlab" x="' + X(k).toFixed(1) + '" y="' + (H - padB + 16) + '" text-anchor="middle">' + fcMiLab(k) + '</text>';
    // uncertainty cone (worst → best), then the three scenario lines
    var cone = [];
    for (k = mNow; k <= mH; k++) cone.push(X(k).toFixed(1) + ',' + Y(fu.hi[k - mNow]).toFixed(1));
    for (k = mH; k >= mNow; k--) cone.push(X(k).toFixed(1) + ',' + Y(fu.lo[k - mNow]).toFixed(1));
    svg += '<polygon class="fc-cone" points="' + cone.join(' ') + '"/>';
    var hp = hist.map(function (v, i){ return X(m0 + i).toFixed(1) + ',' + Y(v).toFixed(1); });
    svg += '<polyline class="fc-hist" points="' + hp.join(' ') + '"/>';
    // end-point labels, nudged apart when scenarios converge
    var ends = [['hi', fu.hi[fu.hi.length - 1]], ['mid', fu.mid[fu.mid.length - 1]], ['lo', fu.lo[fu.lo.length - 1]]];
    ends.forEach(function (e){ e[2] = Y(e[1]) + 3; });
    ends.sort(function (a, b){ return a[2] - b[2]; });
    for (var i = 1; i < ends.length; i++) if (ends[i][2] - ends[i - 1][2] < 11) ends[i][2] = ends[i - 1][2] + 11;
    [['hi', fu.hi], ['mid', fu.mid], ['lo', fu.lo]].forEach(function (sc){
      var pts = sc[1].map(function (v, i){ return X(mNow + i).toFixed(1) + ',' + Y(v).toFixed(1); });
      svg += '<polyline class="fc-scen-ln' + (sc[0] === 'mid' ? ' mid' : '') + '" points="' + pts.join(' ') + '" stroke="' + FC_COL[sc[0]] + '"/>';
      var e = null; ends.forEach(function (x){ if (x[0] === sc[0]) e = x; });
      svg += '<text class="fc-end" x="' + (X(mH) + 5).toFixed(1) + '" y="' + e[2].toFixed(1) + '" fill="' + FC_COL[sc[0]] + '">' + fcPct(e[1]) + '</text>';
    });
    var tx = X(mNow);
    svg += '<line class="fc-today" x1="' + tx.toFixed(1) + '" x2="' + tx.toFixed(1) + '" y1="' + padT + '" y2="' + (H - padB) + '"/>';
    svg += '<text class="fc-tdlab" x="' + (tx + 4).toFixed(1) + '" y="' + (padT + 9) + '">TODAY</text>';
    svg += '</svg>';
    return svg;
  }

  function fcAdviceCard(scope, ents, isEntity){
    var card = el('div', 'fc-card fc-advice');
    card.appendChild(el('div', 'fc-h', 'To meet the targets'));
    var list = el('div', 'fc-recs');
    fcRecs(scope, ents, isEntity).forEach(function (r){
      var it = el('div', 'fc-rec ' + r.tone + fcRecSpan(r));
      it.appendChild(el('div', 'rt', r.t));
      it.appendChild(el('div', 'rb', r.b));
      list.appendChild(it);
    });
    card.appendChild(list);
    return card;
  }

  /** The advice cards are a plain 3-column table - one card per cell. Only a
   *  genuinely oversized entry (rare - e.g. the long Over-Track write-up) claims a
   *  second column so it does not force its whole row tall; the dense grid then
   *  backfills the freed cell. Everything else stays a tidy single cell. */
  function fcRecSpan(r){
    var n = (r.t ? r.t.length : 0) + (r.b ? r.b.length : 0);
    return n >= 400 ? ' fc-wide' : '';
  }

  /** Plain-language, prioritised advice derived from the numbers on screen. */
  function fcRecs(scope, ents, isEntity){
    var recs = [];
    if (!scope.fcs.length){
      recs.push({ tone: 'info', t: 'No measurable KPIs in this slice',
        b: 'Widen the filters, or give these KPIs baselines, targets and a first report so the engine has a trajectory to project.' });
      return recs;
    }
    var needPP = scope.needSlope == null || scope.needSlope === Infinity ? null : Math.round(scope.needSlope * 1000) / 10;
    var nowPP = Math.round(scope.slope * 1000) / 10;
    var aEndR = fcMean(scope, 'mid', scope.mEnd), aEndB = fcMean(scope, 'hi', scope.mEnd);
    if (scope.aNow >= 1){
      recs.push({ tone: 'good', t: 'Target already achieved',
        b: 'Protect the gains: keep reporting so any regression surfaces early, and consider a stretch target for the remaining period.' });
    } else if (scope.code === 'blue'){
      // one decimal here: whole-percent rounding can make forecast and expected look equal
      var p1 = function (a){ return (Math.round(a * 1000) / 10) + '%'; };
      recs.push({ tone: 'warn', t: 'Over Track - ease off to land On Track',
        b: 'Forecast ' + p1(scope.aR) + ' against ' + p1(scope.exp) + ' expected ' + fcHorizonLabel() +
           ' - ahead of the glide path, which usually means targets were set too low or resources are over-concentrated here. ' +
           (scope.paceX != null && scope.paceX > 0 && scope.paceX < 1
             ? 'Delivery can slow to ×' + scope.paceX.toFixed(1) + ' of the current pace (' + needPP + 'pp/month against ' + nowPP +
               ' now) and still land exactly on target by ' + fcMiFull(scope.mEnd) + '. '
             : '') +
           'Verify the reports behind the surge first; if the over-delivery is real, shift the surplus budget and effort to the lagging results below, or raise the target so the plan reflects true ambition.' });
    } else if (aEndR >= 1){
      recs.push({ tone: 'good', t: 'On course at the current pace',
        b: 'The realistic scenario reaches the target by ' + (scope.etaMi != null ? fcMiFull(Math.min(scope.etaMi, scope.mEnd)) : 'plan end') +
           '. Maintain the delivery cadence (' + nowPP + 'pp of target per month) and watch that the worst case stays above the glide path.' });
    } else if (aEndB >= 1){
      recs.push({ tone: 'warn', t: 'Achievable - but only with acceleration',
        b: 'Reaching the target by ' + fcMiFull(scope.mEnd) + ' needs ' +
           (scope.paceX != null && scope.paceX > 0 ? '×' + scope.paceX.toFixed(1) + ' the current pace - ' : '') +
           needPP + 'pp/month against ' + nowPP + ' now. Front-load activities and unblock the slowest results this quarter, before the required pace grows further.' });
    } else {
      recs.push({ tone: 'risk', t: 'Target out of reach on current trends',
        b: 'Even the best case lands at ' + fcPct(aEndB) + ' by ' + fcMiFull(scope.mEnd) +
           '. Escalate now: re-scope or re-phase the targets, re-allocate budget from saturated results to the laggards, or agree a timeline extension.' });
    }
    if (!isEntity){
      var focus = ents.filter(function (e){ return e.aR != null && e.aR < 1; }).slice(0, 3);
      if (focus.length) recs.push({ tone: 'warn', t: 'Concentrate support here first',
        b: focus.map(function (e){ return truncTxt(e.label, 36) + ' (' + fcPct(e.aR) + (e.paceX != null && e.paceX > 0 ? ', needs ×' + e.paceX.toFixed(1) : '') + ')'; }).join('  ·  ') });
      var overEnts = ents.filter(function (e){ return e.code === 'blue' && !(e.aNow != null && e.aNow >= 1); }).slice(0, 3);
      if (overEnts.length) recs.push({ tone: 'warn', t: 'Running ahead - ease these back to On Track',
        b: overEnts.map(function (e){ return truncTxt(e.label, 36) + ' (' + fcPct(e.aR) + (e.paceX != null && e.paceX > 0 && e.paceX < 1 ? ', can slow to ×' + e.paceX.toFixed(1) : '') + ')'; }).join('  ·  ') +
           '. Redirect their slack budget and effort to the entries above.' });
    }
    if (scope.overN && scope.code !== 'blue') recs.push({ tone: 'warn', t: scope.overN + ' KPI' + (scope.overN > 1 ? 's' : '') + ' ahead of the glide path',
      b: 'Forecast past where they need to be by the horizon. Check for over-reporting, then throttle their delivery pace or raise their targets - the freed capacity is better spent on the KPIs falling behind.' });
    if (scope.regressN) recs.push({ tone: 'risk', t: scope.regressN + ' KPI' + (scope.regressN > 1 ? 's are' : ' is') + ' moving backwards',
      b: 'Recent reports fall below the earlier level. Verify the data first; if the regression is real these need corrective action, not more of the same.' });
    if (scope.winsN) recs.push({ tone: 'good', t: scope.winsN + ' quick win' + (scope.winsN > 1 ? 's' : '') + ' within reach',
      b: 'Forecast to land at 85–99% of target. A small, targeted push converts them into achieved targets and lifts the headline rate cheaply.' });
    if (scope.staleN) recs.push({ tone: 'info', t: scope.staleN + ' KPI' + (scope.staleN > 1 ? 's' : '') + ' silent for 3+ months',
      b: 'Their trajectories are projected from old data. Chase the reporting before the next review - the true position may differ.' });
    if (scope.nodataN) recs.push({ tone: 'info', t: scope.nodataN + ' KPI' + (scope.nodataN > 1 ? 's have' : ' has') + ' no reports yet',
      b: 'Excluded from this forecast entirely. First measurements would firm up every number on this page.' });
    return recs;
  }

  function fcSparkSvg(e){
    if (!e.fcs.length) return '<span class="mut">–</span>';
    var mNow = fcNowMi(), vals = [], k, v, mn = Infinity, mx = -Infinity;
    for (k = mNow - 11; k <= mNow; k++){ v = fcHist(e, k); vals.push(v); if (v < mn) mn = v; if (v > mx) mx = v; }
    if (mx - mn < 0.02){ mx += 0.01; mn -= 0.01; }
    var W = 64, H = 18, pts = [];
    vals.forEach(function (val, i){
      pts.push((i / (vals.length - 1) * (W - 2) + 1).toFixed(1) + ',' + (H - 2 - (val - mn) / (mx - mn) * (H - 4)).toFixed(1));
    });
    var c = (STATUS[e.code] || STATUS.nodata).c;
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"><polyline points="' + pts.join(' ') +
      '" fill="none" stroke="' + c + '" stroke-width="1.6" stroke-linejoin="round"/></svg>';
  }

  function fcRangeBar(e){
    if (e.aR == null) return '<span class="mut">no data</span>';
    function pos(a){ return Math.max(0, Math.min(1, (Math.max(-0.1, Math.min(1.5, a)) + 0.1) / 1.6)) * 100; }
    var lo = pos(e.aW), hi = pos(e.aB), md = pos(e.aR), tg = pos(1);
    var tt = 'worst ' + fcPct(e.aW) + ' · realistic ' + fcPct(e.aR) + ' · best ' + fcPct(e.aB) + ' · target 100%';
    return '<span class="fc-range" title="' + esc(tt) + '">' +
      '<i class="band" style="left:' + lo.toFixed(1) + '%;width:' + Math.max(1.5, hi - lo).toFixed(1) + '%"></i>' +
      '<i class="tgt" style="left:' + tg.toFixed(1) + '%"></i>' +
      '<i class="dotr" style="left:' + md.toFixed(1) + '%"></i></span>';
  }


  /** Map a forecast-entity key ('impact:3', 'project:12', 'country:KEN', …) to the
   *  entityScope (kind, key) that resolves its KPIs and projects - the same scope
   *  the results report uses, so the two reports break down identically. */
  function fcEntityScopeRef(key){
    var i = String(key || '').indexOf(':'); if (i < 0) return null;
    var pre = key.slice(0, i), val = key.slice(i + 1);
    switch (pre){
      case 'plan':    return { kind: 'plan', key: +val };
      case 'impact':  return { kind: 'node', key: 'sdg' + SEP + val };
      case 'outcome': return { kind: 'node', key: 'outcome' + SEP + val };
      case 'output':  return { kind: 'node', key: 'output' + SEP + val };
      case 'project': return { kind: 'project', key: +val };
      case 'donor':   return { kind: 'donor', key: +val };
      case 'partner': return { kind: 'partner', key: +val };
      case 'region':  return { kind: 'region', key: val };
      case 'country': var pg = DB._idx.programmeByIso[val]; return pg ? { kind: 'programme', key: pg.id } : null;
    }
    return null;
  }

  /** A stand-alone FORECAST REPORT for one entity, opened in the detail modal - the
   *  forecast twin of the results report (openEntitySummary). The tiles, trajectory
   *  chart and advice cover the clicked ITEM; below them the PROJECTS under it are
   *  forecast and sectioned one level down the chain (Plan→Impacts, Impact→Outcomes,
   *  …) exactly like the results report. A project item breaks down into its KPIs.
   *  The on-screen breakdown and the Export PDF are built from the SAME scope / ents
   *  / groups (via fcPdfDoc, the shared forecast writer), so the two always tally. */
  function openForecastReport(e){
    if (!e) return;
    var scope = e;   // the clicked item's own forecast drives tiles / chart / advice
    var ref = fcEntityScopeRef(e.key);
    var sc = ref ? entityScope(ref.kind, ref.key) : null;
    var byRisk = function (a, b){ return (a.aR == null ? 2 : a.aR) - (b.aR == null ? 2 : b.aR); };
    var ents = [], groups = null, entityLabel = null, breakLabel = 'Projects';

    if (ref && ref.kind === 'project'){
      // a project drills into its own KPIs (no chain grouping below a project)
      entityLabel = 'KPI'; breakLabel = 'KPIs';
      (sc.inds || []).forEach(function (r){
        var ke = fcEntity('kpi:' + r.id, (r.code ? r.code + ' · ' : '') + r.name,
          r.unit || '', r.sdg ? (PILLAR_COLORS[r.sdg] || '#94a3b8') : '#94a3b8', [r]);
        fcCompute(ke); ents.push(ke);
      });
      ents.sort(byRisk);
    } else if (sc){
      // every other item breaks down into the PROJECTS under it, grouped one level
      // down the chain via the same helper the results report uses
      var indSet = {}; (sc.inds || []).forEach(function (r){ indSet[r.id] = 1; });
      var entByPid = {};
      (sc.projs || []).forEach(function (p){
        var kpis = (p.kpis || []).filter(function (r){ return indSet[r.id]; });
        var pe = fcEntity('project:' + p.id, (p.code ? p.code + ' · ' : '') + p.name,
          (p.country ? p.country.name : (p.iso || '')) + (p.donor ? ' · ' + (p.donor.short_name || p.donor.name) : ''),
          p.iso ? countryColor(p.iso) : '#94a3b8', kpis);
        fcCompute(pe); ents.push(pe); entByPid[p.id] = pe;
      });
      var rawGroups = esumProjectGroups(ref.kind, ref.key, sc.projs || [], sc.inds || []);
      if (rawGroups) groups = rawGroups.map(function (g){
        var ge = g.projs.map(function (p){ return entByPid[p.id]; }).filter(Boolean);
        ge.sort(byRisk);
        return { code: g.code || '', name: g.name || g.title, title: g.title, color: g.color, ents: ge };
      });
      ents.sort(byRisk);
    }

    detailStack = []; curView = null; updateBackBtn();   // a leaf report - no drill history
    curDetail = null;
    var tabs = $('#mTabs'); if (tabs) tabs.style.display = 'none';
    $('#mProjects').classList.add('hide'); $('#mResults').classList.add('hide');
    $('#mBody').classList.remove('hide');
    setModalKicker('FORECAST REPORT', sc ? typePillLabel(sc.badge) : '', scope.color);
    $('#mTitle').textContent = scope.label;
    $('#mSub').textContent = scope.sub || '';
    $('#mImpact').textContent = '';

    var body = $('#mBody'); body.innerHTML = '';
    var head = el('div', 'fcr-head');
    head.appendChild(el('div', 'fc-h', breakLabel + ' under ' + truncTxt(scope.label, 46) + ' · forecast ' + fcHorizonLabel()));
    var ex = el('button', 'rc-export fcr-export');
    ex.type = 'button';
    ex.title = 'Export this forecast report to a PDF file';
    ex.innerHTML = '<span class="ic">⤓</span>Export PDF';
    ex.onclick = function (){
      var savedD = S.fcDim;
      try {
        S.fcDim = 'projects';   // the breakdown table is per project (or per KPI) - match its columns
        fcPdfDoc(scope, ents, null, {
          groups: groups,
          tag: 'Forecast Report  ·  ' + pdfDate(TODAY),
          subjectType: sc ? typePillLabel(sc.badge) : '',
          dimLabel: entityLabel ? breakLabel : null,
          entityLabel: entityLabel
        }).save(pdfFileName({ title: 'forecast-' + scope.label }));
      } catch (err){ console.error(err); alert('Could not build the PDF: ' + (err && err.message || err)); }
      finally { S.fcDim = savedD; }
    };
    head.appendChild(ex);
    body.appendChild(head);
    // A flex-gap column so the tiles, chart and table breathe apart, matching the
    // Forecast tab's .fc-body (the bare modal body has no inter-child spacing).
    var rbody = el('div', 'fc-rbody');
    var strip = filterStripHTML();
    if (strip) rbody.appendChild(elHTML('div', 'fc-strip', strip));
    rbody.appendChild(fcTiles(scope, ents, breakLabel + ' on course'));
    var mid = el('div', 'fc-mid');
    mid.appendChild(fcChartCard(scope));
    mid.appendChild(fcAdviceCard(scope, ents, false));
    rbody.appendChild(mid);
    rbody.appendChild(fcTableCard(ents, null, {
      heading: breakLabel + ' under ' + truncTxt(scope.label, 40) + ' · forecast ' + fcHorizonLabel() + ' · riskiest first'
        + (entityLabel ? '' : ' · click a row for its forecast'),
      groups: groups,
      entitySing: entityLabel || 'Project',
      countLabel: entityLabel ? null : 'KPIs',
      count: function (x){ return x.n; },
      emptyMsg: 'No ' + breakLabel.toLowerCase() + ' under this item for the current filters.',
      rowClick: entityLabel ? null : function (x){ openForecastReport(x); }
    }));
    body.appendChild(rbody);
    body.scrollTop = 0;
    $('#modal').classList.add('on');
  }

  /** The forecast breakdown table. Two callers:
   *   - the Forecast tab (opts omitted): lists the current dimension's entities,
   *     each row opening its forecast report.
   *   - a forecast report (opts set): the PROJECTS (or KPIs) under one item,
   *     sectioned by opts.groups one level down the chain. opts = { heading,
   *     groups, entitySing, countLabel (null drops the column), count(e), emptyMsg,
   *     rowClick(e) (null = not clickable) }. */
  function fcTableCard(ents, sel, opts){
    opts = opts || {};
    var card = el('div', 'fc-card fc-tablecard');
    card.appendChild(el('div', 'fc-h', opts.heading != null ? opts.heading
      : (fcDimLabel() + ' · forecast ' + fcHorizonLabel() + ' · riskiest first · click a row to open its forecast report')));
    if (!ents.length){ card.appendChild(el('div', 'empty', opts.emptyMsg || 'Nothing to forecast under the current filters.')); return card; }
    var entSing = opts.entitySing || FC_SING[S.fcDim] || 'Entity';
    var cntCol = opts.hasOwnProperty('countLabel') ? opts.countLabel : (S.fcDim === 'projects' ? 'KPIs' : 'Projects');
    var showCount = cntCol != null;
    var countOf = opts.count || function (e){ return S.fcDim === 'projects' ? e.n : e.nProj; };
    var rowClick = opts.hasOwnProperty('rowClick') ? opts.rowClick : function (e){ openForecastReport(e); };
    // A fresh column header per table - grouped mode gives each group its own
    // card, so the header (Trend, Outlook, …) is repeated inside every card.
    function makeHead(){
      var thead = el('thead'), hr = el('tr');
      var head = [[entSing, '']];
      if (showCount) head.push([cntCol, 'num']);
      head.push(['Now','num'],['Trend',''],['Outlook',''],['Realistic','num'],['Forecast status',''],['Pace','num'],['Target by','num']);
      head.forEach(function (c){ hr.appendChild(el('th', c[1] || null, c[0])); });
      thead.appendChild(hr); return thead;
    }
    function drawRow(e, tbody){
      var st = STATUS[e.code] || STATUS.nodata;
      var tr = el('tr', sel && sel.key === e.key ? 'on' : null);
      if (rowClick){ tr.title = 'Open the forecast report for ' + e.label; tr.onclick = function (){ rowClick(e); }; }
      else tr.classList.add('fc-noclick');
      var td = el('td', 'ent');
      var dt = el('span', 'dot'); dt.style.background = e.color || '#94a3b8'; td.appendChild(dt);
      var nm = el('span', 'nm', truncTxt(e.label, 52)); nm.title = e.label; td.appendChild(nm);
      if (e.sub) td.appendChild(el('span', 'sub', truncTxt(e.sub, 48)));
      tr.appendChild(td);
      if (showCount) tr.appendChild(el('td', 'num', fmt(countOf(e))));
      tr.appendChild(el('td', 'num', fcPct(e.aNow)));
      var sp = el('td', 'spark'); sp.innerHTML = fcSparkSvg(e); tr.appendChild(sp);
      var ol = el('td', 'outlook'); ol.innerHTML = fcRangeBar(e); tr.appendChild(ol);
      var rl = el('td', 'num', fcPct(e.aR)); rl.style.color = st.c; rl.style.fontWeight = '550'; tr.appendChild(rl);
      var stc = el('td'); var chip = el('span', 'fc-chip', st.label); chip.style.background = st.c; stc.appendChild(chip); tr.appendChild(stc);
      var pc = el('td', 'num');
      if (e.aR == null) pc.textContent = '–';
      else if (e.paceX === 0) pc.textContent = '✓';
      else if (e.paceX == null) pc.textContent = 'stalled';
      else {
        pc.textContent = '×' + (e.paceX >= 10 ? Math.round(e.paceX) : e.paceX.toFixed(1));
        pc.style.color = e.paceX > 2 ? STATUS.red.c : e.paceX > 1.15 ? STATUS.amber.c : e.paceX < 0.85 ? STATUS.blue.c : STATUS.green.c;
      }
      pc.title = 'Acceleration needed on the current pace to reach the target by plan end · below ×1 = running faster than needed, room to ease off';
      tr.appendChild(pc);
      var eta = el('td', 'num');
      if (e.aNow != null && e.aNow >= 1) eta.textContent = 'done';
      else if (e.etaMi == null) eta.textContent = '–';
      else { eta.textContent = fcMiLab(e.etaMi) + (e.mEnd != null && e.etaMi > e.mEnd ? ' ⚠' : '');
        if (e.mEnd != null && e.etaMi > e.mEnd) eta.title = 'At the current pace the target lands AFTER the plan ends (' + fcMiFull(e.mEnd) + ')'; }
      tr.appendChild(eta);
      tbody.appendChild(tr);
    }
    if (opts.groups){
      // one rounded card per group: the hierarchy code + statement label sit
      // OUTSIDE the card, the column header + rows INSIDE it (same language as
      // the results report).
      opts.groups.forEach(function (g){
        var grp = el('div', 'esum-group fc-group');
        var hd = el('div', 'esum-group-hd');
        var bar = el('span', 'esum-grp-bar'); bar.style.background = g.color || '#94a3b8'; hd.appendChild(bar);
        if (g.code) hd.appendChild(el('span', 'esum-grp-code', g.code));
        hd.appendChild(el('span', 'esum-grp-t', g.name || g.title));
        hd.appendChild(el('span', 'esum-grp-n', g.ents.length + ' project' + (g.ents.length === 1 ? '' : 's')));
        grp.appendChild(hd);
        var cardEl = el('div', 'esum-card');
        var tbl = el('table', 'fc-tbl'); tbl.appendChild(makeHead());
        var tbody = el('tbody'); g.ents.forEach(function (e){ drawRow(e, tbody); }); tbl.appendChild(tbody);
        cardEl.appendChild(tbl); grp.appendChild(cardEl);
        card.appendChild(grp);
      });
    } else {
      var tbl = el('table', 'fc-tbl'); tbl.appendChild(makeHead());
      var tbody = el('tbody'); ents.forEach(function (e){ drawRow(e, tbody); }); tbl.appendChild(tbody);
      card.appendChild(tbl);
    }
    return card;
  }

  // ---- PDF export -----------------------------------------------------------
  //  One A4 portrait brief mirroring the on-screen panel - headline tiles,
  //  trajectory chart, advice list and the entity table - drawn with the shared
  //  results-export writer so every Grassroots export carries the same
  //  letterhead and table language.
  function fcToneColor(t){ return { good: '#16a34a', warn: '#f59e0b', risk: '#ef4444', info: '#94a3b8' }[t] || '#94a3b8'; }
  // '✓' and '⚠' have no WinAnsi glyph - swap them for words before printing.
  function fcPdfSafe(s){ return String(s == null ? '' : s).replace(/\s*⚠/g, ' (late)').replace(/✓/g, 'Met'); }

  /** The on-screen trajectory chart, redrawn in page ops (history line, the
   *  worst→best uncertainty cone, three scenario lines, target and today
   *  markers). Returns the y cursor below the chart. */
  function fcChartPdf(doc, scope, x0, w, yTop, h){
    var MUT = doc.rgb('#8792a3');
    if (!scope.fcs.length){
      doc.text('No measurable KPIs under the current filters.', x0, yTop - 12, { size: 9, italic: true, color: MUT });
      return yTop - 22;
    }
    var mNow = fcNowMi(), mH = Math.max(scope.mH, mNow + 1), k;
    var m0 = mNow; scope.fcs.forEach(function (f){ if (f.m0 < m0) m0 = f.m0; });
    var hist = [];
    for (k = m0; k <= mNow; k++) hist.push(fcHist(scope, k));
    var fu = { lo: [], mid: [], hi: [] };
    for (k = mNow; k <= mH; k++){ fu.lo.push(fcMean(scope, 'lo', k)); fu.mid.push(fcMean(scope, 'mid', k)); fu.hi.push(fcMean(scope, 'hi', k)); }
    var maxV = 1.12, minV = 0;
    hist.concat(fu.hi, fu.lo).forEach(function (v){ if (v > maxV - 0.08) maxV = v + 0.08; if (v < minV) minV = v - 0.04; });
    var padL = 32, padR = 36, padT = 10, padB = 16;
    var plotW = w - padL - padR, plotH = h - padT - padB, nM = mH - m0;
    var yB = yTop - h + padB;
    function X(mi){ return x0 + padL + (mi - m0) / nM * plotW; }
    function Y(a){ return yB + (a - minV) / (maxV - minV) * plotH; }
    function f(n){ return (Math.round(n * 100) / 100).toString(); }
    function path(pts){ return pts.map(function (p, i){ return f(p[0]) + ' ' + f(p[1]) + (i ? ' l' : ' m'); }).join(' '); }
    function stroke(pts, hex, lw, dash){
      var c = doc.rgb(hex);
      doc.raw('q 1 J 1 j ' + c[0] + ' ' + c[1] + ' ' + c[2] + ' RG ' + lw + ' w ' + (dash ? '[' + dash + '] 0 d ' : '') + path(pts) + ' S Q');
    }
    // gridlines + % scale
    for (var g = Math.ceil(minV / 0.25) * 0.25; g <= maxV + 1e-9; g += 0.25){
      var gy = Y(g), gl = Math.round(g * 100) + '%';
      doc.hline(X(m0), X(mH), gy, doc.rgb('#e8ecf2'), 0.5);
      doc.text(gl, x0 + padL - 5 - doc.textW(gl, 6.5, false), gy - 2.2, { size: 6.5, color: MUT });
    }
    // month scale
    var step = Math.max(1, Math.round(nM / 8));
    for (k = m0; k <= mH; k += step){
      var xl = fcMiLab(k);
      doc.text(xl, X(k) - doc.textW(xl, 6.5, false) / 2, yTop - h + 2, { size: 6.5, color: MUT });
    }
    // uncertainty cone (worst → best), pre-flattened light blue (no alpha in the writer)
    var cone = [];
    for (k = mNow; k <= mH; k++) cone.push([X(k), Y(fu.hi[k - mNow])]);
    for (k = mH; k >= mNow; k--) cone.push([X(k), Y(fu.lo[k - mNow])]);
    var cc = doc.rgb('#dbeafe');
    doc.raw('q ' + cc[0] + ' ' + cc[1] + ' ' + cc[2] + ' rg ' + path(cone) + ' h f Q');
    // target line at 100%
    var ty = Y(1);
    stroke([[X(m0), ty], [X(mH), ty]], '#0c447c', 0.8, '3 2.5');
    doc.text('TARGET 100%', X(mH) - doc.textW('TARGET 100%', 6, true), ty + 3, { size: 6, bold: true, color: doc.rgb('#0c447c') });
    // actuals, then the three scenario lines
    stroke(hist.map(function (v, i){ return [X(m0 + i), Y(v)]; }), '#334155', 1.6);
    var ends = [];
    [['hi', 1.2], ['mid', 2], ['lo', 1.2]].forEach(function (sc){
      var arr = fu[sc[0]];
      stroke(arr.map(function (v, i){ return [X(mNow + i), Y(v)]; }), FC_COL[sc[0]], sc[1]);
      ends.push({ k: sc[0], v: arr[arr.length - 1], y: Y(arr[arr.length - 1]) - 2.4 });
    });
    // endpoint labels, nudged apart when the scenarios converge
    ends.sort(function (a, b){ return b.y - a.y; });
    for (var i = 1; i < ends.length; i++) if (ends[i - 1].y - ends[i].y < 9) ends[i].y = ends[i - 1].y - 9;
    ends.forEach(function (e){
      doc.text(fcPct(e.v), X(mH) + 4, e.y, { size: 7, bold: true, color: doc.rgb(FC_COL[e.k]) });
    });
    // "now" marker - the point projections start from. Labelled TODAY when the
    // forecast runs live; when a monthly brief is anchored to a past report month
    // (FC_ASOF_MI), it names that month so the origin can't be read as the wall clock.
    var tx = X(mNow);
    var nowLbl = (FC_ASOF_MI != null && FC_ASOF_MI < fcMi(TODAY.getTime())) ? fcMiFull(mNow).toUpperCase() : 'TODAY';
    stroke([[tx, yB], [tx, yB + plotH]], '#94a3b8', 0.7, '2 2');
    doc.text(nowLbl, tx + 3, yB + plotH - 6, { size: 6, bold: true, color: MUT });
    return yTop - h - 4;
  }

  /** Build and download the Forecast panel as a PDF brief. */
  function exportForecastPDF(){
    var ents = fcEntities(), sel = null;
    if (S.fcSel) ents.forEach(function (e){ if (e.key === S.fcSel) sel = e; });
    var scope = sel;
    if (!scope){
      scope = fcEntity('__all__', 'Whole portfolio', '', '#2563eb', filtered());
      fcCompute(scope);
    }
    fcPdfDoc(scope, ents, sel, { subjectType: sel ? FC_SING[S.fcDim] : 'Portfolio' })
      .save(pdfFileName({ title: 'forecast-' + S.fcDim + (sel ? '-' + sel.label : '') }));
  }

  /** The full Forecast panel as a pdfWriter doc - letterhead, plan stamp, tiles,
   *  trajectory chart, advice and the dimension table. Shared by the tab's
   *  Export PDF (downloaded) and the Communication panel's per-lead forecast
   *  brief (attached to the email, base64). opts: tag (letterhead right text),
   *  preparedFor (comm entity - adds the lead line), noFilters (skip the
   *  on-screen filter strip), ctx (context line override). */
  function fcPdfDoc(scope, ents, sel, opts){
    opts = opts || {};
    var doc = pdfWriter(), PW = doc.PW, M = doc.margin, AW = PW - 2 * M;
    doc.addPage();
    var INK = doc.rgb('#1a2230'), MUT = doc.rgb('#8792a3'), SUB = doc.rgb('#5b6675'),
        NAVY = doc.rgb('#0c447c');
    doc.footer = orgBrand() + '  ·  Forecast  ·  ' + truncTxt(scope.label, 60);

    // letterhead - the slim brand band shared with every Grassroots export
    var rt = opts.tag || ('Forecast Report  ·  ' + pdfDate(TODAY));
    pdfBrandHead(doc, M, PW - M - doc.textW(rt, 8.5, false) - 14);
    doc.text(rt, PW - M - doc.textW(rt, 8.5, false), doc.PH - 26, { size: 8.5, color: doc.rgb('#d7e3f0') });
    var y = doc.PH - 63;

    // active development plan - stamped on every export
    var _ap = activePlan();
    if (_ap){
      var px = M;
      doc.text('PLAN', px, y - 8, { size: 6.5, bold: true, color: MUT });
      px += doc.textW('PLAN', 6.5, true) + 7;
      doc.text(_ap.name, px, y - 8, { size: 9, bold: true, color: NAVY });
      if (planPeriod(_ap)){
        px += doc.textW(_ap.name, 9, true) + 7;
        doc.text('·  ' + planPeriod(_ap), px, y - 8, { size: 8.5, color: MUT });
      }
      y -= 17;
    }
    // prepared-for line - only on the Communication panel's lead briefs
    if (opts.preparedFor){
      var pf = opts.preparedFor, pfX = M;
      doc.text('PREPARED FOR', pfX, y - 8, { size: 6.5, bold: true, color: MUT });
      pfX += doc.textW('PREPARED FOR', 6.5, true) + 8;
      var pfNm = userName(pf.leadId);
      doc.text(pfNm, pfX, y - 8, { size: 9, bold: true, color: INK });
      pfX += doc.textW(pfNm, 9, true) + 7;
      doc.text('·  ' + leadEmail(pf.leadId), pfX, y - 8, { size: 8.5, color: MUT });
      y -= 17;
    }
    y -= 7;

    // report-kind badge (FORECAST) + subject-type pill (what it is about) + title
    var bw = doc.textW('FORECAST', 7.5, true) + 16;
    doc.roundRect(M, y - 12.5, bw, 16, 8, NAVY);
    doc.text('FORECAST', M + 8, y - 8, { size: 7.5, bold: true, color: [1, 1, 1] });
    var tx = M + bw + 6;
    var subjType = (opts.subjectType || (sel ? FC_SING[S.fcDim] : 'Portfolio') || '').toUpperCase();
    if (subjType){                           // tinted pill telling Plan / Impact / Project …
      var sbw = doc.textW(subjType, 7.5, true) + 14;
      doc.roundRect(tx, y - 12.5, sbw, 16, 8, doc.rgb('#d8e3ec'));
      doc.text(subjType, tx + 7, y - 8, { size: 7.5, bold: true, color: NAVY });
      tx += sbw + 8;
    }
    var tF = 16;                             // long entity names shrink to fit
    while (tF > 10.5 && doc.textW(scope.label, tF, true) > PW - M - tx) tF -= 0.5;
    doc.text(scope.label, tx, y - 9.5, { size: tF, bold: true, color: INK });
    y -= 24;
    var ctx = opts.ctx || ((sel ? FC_SING[S.fcDim] + (scope.sub ? '  ·  ' + scope.sub : '')
                   : 'All KPIs under the current filters')
            + '  ·  forecast ' + fcHorizonLabel());
    doc.wrap(ctx, AW, 9, false).forEach(function (ln){ doc.text(ln, M, y - 8, { size: 9, color: SUB }); y -= 12.5; });
    y -= 8;

    // active filters - a printed forecast outlives the screen it came from
    // (lead briefs skip this: they are built from the full, unfiltered scope)
    if (!opts.noFilters) y = pdfFilterStrip(doc, activeFilterSummary(), M, AW, y);

    // headline tiles - 3 x 2 cards, same data as the on-screen grid
    var tiles = fcTileData(scope, ents), gap = 10, cardW = (AW - gap * 2) / 3, cardH = 52;
    // the third tile is "<dimension> on course" - rename it when the breakdown
    // is something else (the comm brief's per-KPI drill-down for project leads)
    if (opts.dimLabel) tiles[2].l = opts.dimLabel + ' on course';
    tiles.forEach(function (t, i){
      var cx = M + (i % 3) * (cardW + gap);
      var cy = y - Math.floor(i / 3) * (cardH + gap);
      doc.roundRect(cx, cy - cardH, cardW, cardH, 6, doc.rgb('#f7f9fc'));
      doc.roundRect(cx, cy - cardH, cardW, cardH, 6, doc.rgb('#e3e8f0'), 0.8);
      doc.text(t.l.toUpperCase(), cx + 9, cy - 15, { size: 6.5, bold: true, color: MUT });
      var v = fcPdfSafe(t.v), vF = 14;
      while (vF > 8 && doc.textW(v, vF, true) > cardW - 18) vF -= 0.5;
      doc.text(v, cx + 9, cy - 32, { size: vF, bold: true, color: INK });
      if (t.s != null){
        var s = fcPdfSafe(t.s);
        if (t.chip){
          var chW = doc.textW(s, 6.5, true) + 12;
          doc.roundRect(cx + 9, cy - 47, Math.min(chW, cardW - 18), 12, 6, doc.rgb(t.chip));
          doc.text(s, cx + 15, cy - 43.5, { size: 6.5, bold: true, color: [1, 1, 1] });
        } else {
          var sF = 7;
          while (sF > 5.5 && doc.textW(s, sF, false) > cardW - 18) sF -= 0.25;
          doc.text(s, cx + 9, cy - 44, { size: sF, color: MUT });
        }
      }
    });
    y -= cardH * 2 + gap + 18;

    // trajectory chart (kept on one page with its heading)
    var chH = 190;
    if (y - chH - 16 < M + 20){ doc.addPage(); y = doc.PH - M; }
    var hd = 'TRAJECTORY  ·  ACTUALS, THEN SCENARIOS ' +
      (S.fcHorizon === 'plan' ? 'TO END OF PLAN' : 'FOR THE NEXT ' + parseInt(S.fcHorizon, 10) + ' MONTHS');
    doc.text(hd, M, y - 9, { size: 8.5, bold: true, color: SUB });
    var lx = PW - M;   // scenario legend, right-aligned on the heading row
    [['lo', 'Worst case'], ['mid', 'Realistic'], ['hi', 'Best case']].forEach(function (s){
      lx -= doc.textW(s[1], 6.5, false);
      doc.text(s[1], lx, y - 9, { size: 6.5, color: MUT });
      lx -= 9; doc.rect(lx, y - 11.5, 6, 6, doc.rgb(FC_COL[s[0]])); lx -= 12;
    });
    y -= 16;
    y = fcChartPdf(doc, scope, M, AW, y, chH);
    y -= 14;

    // advice panels - the on-screen cards, below the chart. A 2-column masonry:
    // each card keeps its natural height and drops into the shorter column, so a
    // long paragraph simply runs taller (a "double-height" card) without leaving
    // a gap. The rare monster spans the full width - but only while the columns
    // are still level, so a full-width card never strands an empty half-column.
    var recs = fcRecs(scope, ents, !!sel);
    if (y < M + 90){ doc.addPage(); y = doc.PH - M; }
    doc.text('TO MEET THE TARGETS', M, y - 9, { size: 8.5, bold: true, color: SUB });
    y -= 17;
    var acGap = 10, acW = (AW - acGap) / 2, colX = [M, M + acW + acGap], colY = [y, y];
    recs.forEach(function (r){
      var n = (r.t ? r.t.length : 0) + (r.b ? r.b.length : 0);
      var full = n >= 330 && Math.abs(colY[0] - colY[1]) < 1;   // monster + level cols
      var w = full ? AW : acW;
      var tl = doc.wrap(r.t, w - 32, 9.5, true), bl = doc.wrap(r.b, w - 32, 8.5, false);
      var h = 15 + (tl.length - 1) * 12 + 12.5 + (bl.length - 1) * 11 + 12;
      var ci = full ? 0 : (colY[0] >= colY[1] ? 0 : 1);         // taller col = larger y
      var top = full ? Math.min(colY[0], colY[1]) : colY[ci];
      if (top - h < M + 20){ doc.addPage(); colY[0] = colY[1] = top = doc.PH - M; ci = 0; }
      var cx = full ? M : colX[ci];
      doc.roundRect(cx, top - h, w, h, 5, doc.rgb('#f8fafc'));
      doc.roundRect(cx, top - h, w, h, 5, doc.rgb('#e3e8f0'), 0.7);
      doc.roundRect(cx + 5, top - h + 5, 2.5, h - 10, 1.25, doc.rgb(fcToneColor(r.tone)));
      var ly = top - 15;
      tl.forEach(function (ln){ doc.text(ln, cx + 16, ly, { size: 9.5, bold: true, color: INK }); ly -= 12; });
      ly -= 0.5;
      bl.forEach(function (ln){ doc.text(ln, cx + 16, ly, { size: 8.5, color: doc.rgb('#39424f') }); ly -= 11; });
      if (full){ colY[0] = colY[1] = top - h - 8; } else { colY[ci] = top - h - 8; }
    });
    y = Math.min(colY[0], colY[1]) - 10;

    // entity table - the same columns as on screen minus the sparkline (the
    // outlook bar becomes a worst-best range). The per-KPI drill-down (comm
    // project briefs) also drops the KPI-count column - a count of 1 says nothing.
    var hasLate = false;
    var perKpi = opts.entityLabel === 'KPI';
    // project rows count their KPIs; every other dimension counts its projects
    var showProj = !perKpi && S.fcDim !== 'projects';
    var cols = [
      { t: opts.entityLabel || FC_SING[S.fcDim] || 'Entity' }, { t: showProj ? 'Projects' : 'KPIs', align: 'right' },
      { t: 'Now', align: 'right' },
      { t: 'Realistic', align: 'right' }, { t: 'Worst - best', align: 'right' },
      { t: 'Forecast status' }, { t: 'Pace', align: 'right' }, { t: 'Target by', align: 'right' }
    ];
    if (perKpi) cols.splice(1, 1);
    function rowFor(e){
      var st = STATUS[e.code] || STATUS.nodata;
      var pace, paceCol = null;
      if (e.aR == null) pace = '–';
      else if (e.paceX === 0) pace = 'met';
      else if (e.paceX == null) pace = 'stalled';
      else {
        pace = '×' + (e.paceX >= 10 ? Math.round(e.paceX) : e.paceX.toFixed(1));
        // same tiers as the on-screen table, including the blue "faster than needed"
        paceCol = e.paceX > 2 ? STATUS.red.c : e.paceX > 1.15 ? STATUS.amber.c : e.paceX < 0.85 ? STATUS.blue.c : STATUS.green.c;
      }
      var eta;
      if (e.aNow != null && e.aNow >= 1) eta = 'done';
      else if (e.etaMi == null) eta = '–';
      else { eta = fcMiLab(e.etaMi); if (e.mEnd != null && e.etaMi > e.mEnd){ eta += ' *'; hasLate = true; } }
      var cells = [
        { t: e.label + (e.sub ? '  ·  ' + e.sub : ''), dot: e.color },
        { t: fmt(showProj ? e.nProj : e.n) }, { t: fcPct(e.aNow) },
        { t: fcPct(e.aR), color: e.aR == null ? null : st.c },
        { t: e.aR == null ? '–' : fcPct(e.aW) + ' – ' + fcPct(e.aB) },
        { t: st.label, tag: { bg: st.c, fg: '#ffffff' } },
        { t: pace, color: paceCol },
        { t: eta }
      ];
      if (perKpi) cells.splice(1, 1);
      return cells;
    }
    if (y < M + 80){ doc.addPage(); y = doc.PH - M; }
    doc.text(((opts.dimLabel || fcDimLabel()) + '  ·  FORECAST ' + fcHorizonLabel() + '  ·  RISKIEST FIRST').toUpperCase(),
      M, y - 9, { size: 8.5, bold: true, color: SUB });
    y -= 15;
    if (opts.groups && opts.groups.length){
      // sectioned table - one sub-table per group, with the accent-bar header
      // language of the results report (riskiest first inside each group)
      opts.groups.forEach(function (g){
        if (y < M + 95){ doc.addPage(); y = doc.PH - M; }
        if (g.color) doc.rect(M, y - 12.5, 2.5, 10.5, doc.rgb(g.color));
        doc.text(truncTxt(g.title, 95), M + (g.color ? 8 : 0), y - 10.5, { size: 9.5, bold: true, color: INK });
        var cnt = g.ents.length + ' project' + (g.ents.length === 1 ? '' : 's');
        doc.text(cnt, PW - M - doc.textW(cnt, 7.5, false), y - 10.5, { size: 7.5, color: MUT });
        y -= 19;
        y = pdfTable(doc, cols, g.ents.map(rowFor), M, AW, y);
        y -= 14;
      });
      y += 2;
    } else {
      y = pdfTable(doc, cols, ents.map(rowFor), M, AW, y);
      y -= 12;
    }
    var note = "Scenarios project each KPI's recent monthly pace (±1 sd) forward from today; entities are ordered riskiest first."
             + (hasLate ? '  * At the current pace the target lands after the plan ends.' : '');
    doc.wrap(note, AW, 8, false).forEach(function (ln){
      if (y < M + 14){ doc.addPage(); y = doc.PH - M; }
      doc.text(ln, M, y - 8, { size: 8, italic: true, color: MUT }); y -= 11;
    });

    return doc;
  }

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
    var offTrack = withData.filter(function (r) { return r.status === 'red' || r.status === 'maroon' || r.status === 'black'; }).length;
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
    else if (S.tab === 'forecast') { renderForecast(); renderList(); }
    else if (S.tab === 'timeline') { renderTimeline(); renderList(); }
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
    // date range filter removed - the dashboard always shows all-time now
    var rc = $('#ranges');
    if (rc) {
      RANGES.forEach(function (r) {
        var b = el('button','range'+(r[0]===S.range?' on':''), r[1]); b.dataset.r = r[0];
        b.onclick = function () { S.range = r[0]; S.from = S.to = null; if($('#dFrom'))$('#dFrom').value=''; if($('#dTo'))$('#dTo').value='';
          Array.prototype.forEach.call(rc.children,function(x){x.classList.toggle('on',x.dataset.r===r[0]);});
          S.page = 0; renderAll(); };
        rc.appendChild(b);
      });
    }
    var dF = $('#dFrom'); if (dF) dF.onchange = function (e){ S.from = e.target.value||null; clearRangeButtons(); S.page=0; renderAll(); };
    var dT = $('#dTo'); if (dT) dT.onchange = function (e){ S.to = e.target.value||null; clearRangeButtons(); S.page=0; renderAll(); };

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
      $('#timelineView').classList.toggle('hide', S.tab!=='timeline');
      $('#forecastView').classList.toggle('hide', S.tab!=='forecast');
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
    var qpt = $('#qPartner'); if (qpt) { var partnerBounced = debounce(function (){ renderPartnerFacet(); persist(); }); qpt.addEventListener('input', function (e){ S.qPartner = e.target.value; partnerBounced(); }); }
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
    $('#clearFilters').onclick=function(){ S.selProg.clear(); S.selRegion.clear(); S.selNodes.clear(); S.selSdg.clear(); S.selKpi.clear(); S.selUser.clear(); S.selStatus.clear(); S.selType.clear(); S.selDonor.clear(); S.selPartner.clear(); S.selProject.clear(); S.selBenType.clear(); S.selCountry=null; S.qList=''; $('#qList').value=''; S.qKpi=''; S.qUser=''; S.qDonor=''; S.qPartner=''; if($('#qPartner'))$('#qPartner').value=''; S.qProject=''; if($('#qProject'))$('#qProject').value=''; S.page=0; renderAll(); };

    // legend / map controls
    $('#colorMode').onchange=function(e){ S.colorMode=e.target.value; renderBubbles(); persist(); };
    $('#legMin').onclick=function(){ $('#legend').classList.toggle('min'); $('#legMin').textContent = $('#legend').classList.contains('min')?'+':'–'; persist(); };
    // (status basis toggle removed - status is always performance; progress cannot tell status)

    // collapse panels
    $('#colLeft').onclick=function(){ toggleCol('no-left','#colLeft','‹','›'); };
    $('#colRight').onclick=function(){ toggleCol('no-right','#colRight','›','‹'); };
    // small screens: the panes are overlay drawers over a dimming scrim
    // (.main::before). A click on the scrim targets .main itself - the grid's
    // in-flow children cover everything else - so close any open drawer.
    $('#main').addEventListener('click', function(e){
      if (e.target !== e.currentTarget) return;
      var m=$('#main');
      if (!m.classList.contains('no-left'))  toggleCol('no-left','#colLeft','‹','›');
      if (!m.classList.contains('no-right')) toggleCol('no-right','#colRight','›','‹');
    });

    // bottom bar buttons
    $('#btnTheme').onclick=toggleTheme;
    $('#btnControl').onclick=openControl;
    $('#btnResults').onclick=openResults;
    var bCm=$('#btnComms'); if(bCm) bCm.onclick=openComms;

    // Communication modal: close + category tab switching
    $('#commClose').onclick=closeComms;
    $('#commModal').addEventListener('click',function(e){ if(e.target===$('#commModal')) closeComms(); });
    $('#commTabs').addEventListener('click',function(e){
      var b=e.target.closest('button'); if(!b) return;
      COMM.tab=b.dataset.commtab; renderCommTabs(); renderComm();
    });

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
    $('#aboutTabG').onclick=function(){ aboutTab('grass'); };
    $('#aboutTabO').onclick=function(){ aboutTab('org'); };
    $('#aboutModal').addEventListener('click',function(e){ if(e.target===$('#aboutModal')) closeAbout(); });
    var avEl=$('#appVersion'); if(avEl) avEl.textContent=APP_VERSION;   // render the app version from its single source of truth
    var bNP=$('#btnNewProject'); if(bNP) bNP.onclick=function(){ openProject(null); };
    var bNPSide=$('#btnNewProjectSide'); if(bNPSide) bNPSide.onclick=function(){ openProject(null); };

    // New Activity child popup
    $('#naClose').onclick = closeNewActivity;
    $('#newActivityOverlay').addEventListener('click', function (e){ if (e.target === $('#newActivityOverlay')) closeNewActivity(); });

    // Project modal + its tabs
    $('#prClose').onclick = closeProject;
    var prCloseBtn = $('#prCloseBtn'); if (prCloseBtn) prCloseBtn.onclick = closeProject;
    var prExport = $('#prExportPdf');
    if (prExport) prExport.onclick = function (){
      try { exportProjectPDF(curProject); }
      catch (e){ console.error(e); alert('Could not build the PDF: ' + (e && e.message || e)); }
    };
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
    $('#partnerEditClose').onclick = closePartnerEdit;
    $('#partnerEditOverlay').addEventListener('click', function (e){ if (e.target === $('#partnerEditOverlay')) closePartnerEdit(); });

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
        if ($('#partnerEditOverlay').classList.contains('on')) { closePartnerEdit(); return; }
        if ($('#secEditOverlay').classList.contains('on')) { closeSecEdit(); return; }
        if ($('#kpiEditOverlay').classList.contains('on')) { closeKpiEdit(); return; }
        if ($('#userEditOverlay').classList.contains('on')) { closeUserEdit(); return; }
        if ($('#fwEditOverlay').classList.contains('on')) { closeFwEdit(); return; }
        if ($('#newActivityOverlay').classList.contains('on')) { closeNewActivity(); return; }
        if ($('#aboutModal').classList.contains('on')) { closeAbout(); return; }
        if ($('#projectModal').classList.contains('on')) { closeProject(); return; }
        if ($('#commModal').classList.contains('on')) { closeComms(); return; }
        if ($('#rmModal').classList.contains('on')) { closeResults(); return; }
        closeDetail(); closeControl();
      }
    });
  }
  function clearRangeButtons(){ S.range=''; var rc=$('#ranges'); if(rc) Array.prototype.forEach.call(rc.children,function(x){x.classList.remove('on');}); }
  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function setGrid(){
    var m=$('#main');
    var L = m.classList.contains('no-left')  ? 0 : (S.leftW  != null ? S.leftW  : defPaneW());
    var R = m.classList.contains('no-right') ? 0 : (S.rightW != null ? S.rightW : defPaneW());
    m.style.gridTemplateColumns = L + 'px 1fr ' + R + 'px';
    // the pane-collapse buttons live on .main and anchor to these widths
    m.style.setProperty('--paneL', L + 'px');
    m.style.setProperty('--paneR', R + 'px');
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
  function hasFilters(){ return S.selProg.size||S.selRegion.size||S.selNodes.size||S.selSdg.size||S.selKpi.size||S.selUser.size||S.selStatus.size||S.selType.size||S.selDonor.size||S.selPartner.size||S.selProject.size||S.selBenType.size||S.selCountry||S.qList; }
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
    add('Partners', names(S.selPartner, function (id){
      var d = DB._idx.partnerById[id]; return d ? (d.acronym || d.name) : null;
    }));
    add('Projects', names(S.selProject, function (id){
      var p = PROJECTSBYID[id]; return p ? (p.code || p.name) : null;
    }));
    add('Performance status', names(S.selStatus, function (k){ return STATUS[k] ? STATUS[k].label : k; }));
    add('KPI type', names(S.selType, function (t){ return cap(t); }));
    add('Project beneficiaries', names(S.selBenType, function (id){ return benTypeName(id); }));
    add('KPI inventory', names(S.selKpi, function (n){ return n; }));
    add('User groups', names(S.selUser, function (id){ var u = userById(id); return u ? u.name : null; }));
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
        selDonor: Array.from(S.selDonor), selPartner: Array.from(S.selPartner), selProject: Array.from(S.selProject), selBenType: Array.from(S.selBenType),
        donorShown: S.donorShown, partnerShown: S.partnerShown, projectShown: S.projectShown, progShown: S.progShown,
        qList: S.qList, qProg: S.qProg, qSdg: S.qSdg, qKpi: S.qKpi, qUser: S.qUser, qDonor: S.qDonor, qPartner: S.qPartner, qProject: S.qProject, sort: S.sort, sortDir: S.sortDir,
        listMode: S.listMode, countBasis: S.countBasis, kpiSort: S.kpiSort, kpiSortDir: S.kpiSortDir, page: S.page,
        colorMode: S.colorMode, perfBasis: S.perfBasis, expandRegion: Array.from(S.expandRegion),
        expandSdg: Array.from(S.expandSdg), expandImpact: Array.from(S.expandImpact), expandOutcome: Array.from(S.expandOutcome),
        expandKpiPillar: Array.from(S.expandKpiPillar), expandUserRole: Array.from(S.expandUserRole),
        facetOrder: S.facetOrder, facetCollapsed: S.facetCollapsed,
        insX: S.insX, insTopX: S.insTopX, insY: S.insY, insTopY: S.insTopY, insMode: S.insMode,
        fcDim: S.fcDim, fcHorizon: S.fcHorizon,
        tlDim: S.tlDim, tlActs: S.tlActs,
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
      // restore the last-viewed tab (Map is only the fresh-load default, when no
      // preference has been saved yet)
      if (['map','insights','timeline','forecast'].indexOf(p.tab) >= 0) S.tab = p.tab;
      if (p.plan != null) S.plan = p.plan;   // validated against real plans by resolvePlan()
      // date range filter removed - always all-time; ignore any persisted range/from/to
      S.range = 'all'; S.from = null; S.to = null;
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
      if (p.selPartner) S.selPartner = new Set(p.selPartner);
      if (p.selProject) S.selProject = new Set(p.selProject);
      if (p.selBenType) S.selBenType = new Set(p.selBenType);
      if (p.donorShown) S.donorShown = Math.max(10, p.donorShown);
      if (p.partnerShown) S.partnerShown = Math.max(10, p.partnerShown);
      if (p.projectShown) S.projectShown = Math.max(10, p.projectShown);
      if (p.progShown && typeof p.progShown === 'object') S.progShown = p.progShown;
      if (p.sortDir) S.sortDir = p.sortDir;
      if (p.expandKpiPillar) S.expandKpiPillar = new Set(p.expandKpiPillar);
      if (p.expandUserRole) S.expandUserRole = new Set(p.expandUserRole);
      if (Array.isArray(p.facetOrder)) S.facetOrder = p.facetOrder;
      if (p.facetCollapsed && typeof p.facetCollapsed === 'object') S.facetCollapsed = p.facetCollapsed;
      S.selCountry = p.selCountry || null;
      S.qList = p.qList || ''; S.qProg = p.qProg || ''; S.qSdg = p.qSdg || '';
      S.qKpi = p.qKpi || ''; S.qUser = p.qUser || ''; S.qDonor = p.qDonor || ''; S.qPartner = p.qPartner || ''; S.qProject = p.qProject || '';
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
      if (['status','region','impact','donor','partner','budget'].indexOf(S.colorMode) < 0) S.colorMode = 'status';
      S.perfBasis = 'performance';   // status is always performance; ignore any persisted 'progress'
      if (p.userShown && typeof p.userShown === 'object') S.userShown = p.userShown;
      if (p.insX) S.insX = p.insX; if (p.insTopX) S.insTopX = p.insTopX;
      if (p.insY) S.insY = p.insY; if (p.insTopY) S.insTopY = p.insTopY;
      if (DIM_LIST.indexOf(S.insX) < 0) S.insX = 'sdg';       // migrate removed dims (e.g. 'level')
      if (DIM_LIST.indexOf(S.insY) < 0) S.insY = 'region';
      if (p.insMode) S.insMode = p.insMode;
      if (['plans','impacts','outcomes','outputs','projects','donors','partners','regions','countries'].indexOf(p.fcDim) >= 0) S.fcDim = p.fcDim;
      if (['plan','6m','12m','24m'].indexOf(p.fcHorizon) >= 0) S.fcHorizon = p.fcHorizon;
      if (['plans','impacts','outcomes','outputs','projects','donors','partners','regions','countries'].indexOf(p.tlDim) >= 0) S.tlDim = p.tlDim;
      if (typeof p.tlActs === 'boolean') S.tlActs = p.tlActs;
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
    $('#timelineView').classList.toggle('hide', S.tab !== 'timeline');
    $('#forecastView').classList.toggle('hide', S.tab !== 'forecast');
    // custom dates + searches
    if (S.from && $('#dFrom')) $('#dFrom').value = S.from;
    if (S.to && $('#dTo')) $('#dTo').value = S.to;
    $('#qList').value = S.qList; $('#qProg').value = S.qProg; $('#qSdg').value = S.qSdg;
    if ($('#qKpi')) $('#qKpi').value = S.qKpi; if ($('#qUser')) $('#qUser').value = S.qUser;
    if ($('#qDonor')) $('#qDonor').value = S.qDonor;
    if ($('#qPartner')) $('#qPartner').value = S.qPartner;
    if ($('#qProject')) $('#qProject').value = S.qProject;
    // pane mode search placeholder (KPIs pane mode removed)
    $('#qList').placeholder = S.listMode === 'kpis' ? 'Search primary KPIs…' : 'Search projects, donors, countries…';
    // sorts
    renderSortButtons();
    // colour mode + bubble-size mode
    $('#colorMode').value = S.colorMode;
    // collapsed panels (small screens always start collapsed: the panes act as
    // overlay drawers on top of the map there, opened via the ‹ › buttons)
    var compact = window.matchMedia && window.matchMedia('(max-width:900px)').matches;
    if (S._noLeft || compact) { $('#main').classList.add('no-left'); $('#colLeft').textContent = '›'; }
    if (S._noRight || compact) { $('#main').classList.add('no-right'); $('#colRight').textContent = '‹'; }
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
    // status 'user': central affiliations report on any country; a Countries-
    // affiliated user only on the countries they Lead
    if (curSection() === 'hq') return true;
    return !!(r && r.programme && userCountryIsos(CURRENT_USER).indexOf(r.programme.country_iso3) >= 0);
  }

  // account-menu identity line: affiliation, plus the user's assignments when
  // they have any - e.g. 'Countries · KEN' or 'Donors · EU, WB' (uniform across
  // every category; nothing scope-specific)
  function userScopeLabel(u){
    var t = userAssignedText(u);
    return userAffName(u) + (t !== '–' ? ' · ' + t : '');
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
  // Self-service profile editor - name, username, email, password. Affiliation
  // and Status stay admin-controlled, so they are not shown here.
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
      '<div class="cp-note">Your Affiliation and Status are set by an administrator.</div>' +
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
    var owner = ((DB.tables && DB.tables.user) || []).filter(function(u){ return userStatus(u) === 'admin'; })[0];
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
  // without a manual data reset. Programmes and projects carry a denormalised
  // region derived from their country; each is realigned here. (Users carry no
  // region/country - their scope derives from country.lead_id.)
  // Countries are never edited in-app, so this is always safe.
  function reconcileRegions() {
    var seed = (window.SEED && window.SEED.country) || [];
    if (!seed.length) return Promise.resolve();
    var regionByIso = {}; seed.forEach(function (c) { regionByIso[c.iso3] = c.region; });
    var cChanged = [], pChanged = [], prjChanged = [];
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
    _countryShade = null;   // region membership may have shifted → recolour
    var jobs = [];
    if (cChanged.length) jobs.push(DB.persist('country', cChanged));
    if (pChanged.length) jobs.push(DB.persist('programme', pChanged));
    if (prjChanged.length) jobs.push(DB.persist('project', prjChanged));
    return Promise.all(jobs);
  }

  // Give every KPI an exact baseline/target date, derived from its year if the
  // data predates the date fields (1 Jan baseline year → 31 Dec target year).
  function reconcileKpiDates() {
    var changed = [];
    DB.tables.indicator.forEach(function (i) {
      var yrs = kpiWindowYears(i);   // the KPI's own plan window, not a fixed year
      var bd = i.baseline_date || (yrs.start + '-01-01');
      var td = i.target_date || (yrs.end + '-12-31');
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

  // Migrate any row still carrying a legacy TEXT list value onto the reference
  // lookups: seed the lookup tables from window.SEED when a cached DB predates
  // them, upsert a row for any unknown legacy value, stamp the *_id, and drop
  // the text column. After this, every list selection lives as an id.
  function reconcileLookups() {
    var jobs = [];
    // a cached pre-lookup DB has empty lookup stores - fill them from the seed
    var LK = ['unit', 'frequency', 'collection_method', 'disaggregation', 'kpi_type', 'direction', 'donor_type', 'user_status'];
    LK.forEach(function (t) {
      if (!DB.tables[t].length && window.SEED && (window.SEED[t] || []).length) {
        jobs.push(DB.insert(t, window.SEED[t].map(function (r) { return JSON.parse(JSON.stringify(r)); })));
      }
    });
    return Promise.all(jobs).then(function () {
      function idFor(table, text) {           // find-or-create by key OR name
        var hit = null;
        DB.tables[table].forEach(function (r) { if (r.key === text || r.name === text) hit = r; });
        if (hit) return Promise.resolve(hit.id);
        return DB.insert(table, { key: text, name: text, seq: DB.tables[table].length + 1 })
          .then(function (rows) { return rows[0].id; });
      }
      function migrate(rows, table, field, idField) {
        var out = Promise.resolve(), changed = [];
        rows.forEach(function (r) {
          if (r[idField] != null || r[field] == null || r[field] === '') return;
          out = out.then(function () { return idFor(table, r[field]); })
                   .then(function (id) { r[idField] = id; delete r[field]; changed.push(r); });
        });
        return out.then(function () { return changed; });
      }
      var inds = DB.tables.indicator;
      return migrate(inds, 'unit', 'unit', 'unit_id')
        .then(function (c1) { return migrate(inds, 'kpi_type', 'type', 'type_id').then(function (c2) { return c1.concat(c2); }); })
        .then(function (c) { return migrate(inds, 'direction', 'direction', 'direction_id').then(function (c2) { return c.concat(c2); }); })
        .then(function (c) { return migrate(inds, 'frequency', 'frequency', 'frequency_id').then(function (c2) { return c.concat(c2); }); })
        .then(function (c) { return migrate(inds, 'collection_method', 'collection_method', 'collection_method_id').then(function (c2) { return c.concat(c2); }); })
        .then(function (c) { return migrate(inds, 'disaggregation', 'disaggregation', 'disaggregation_id').then(function (c2) { return c.concat(c2); }); })
        .then(function (indChanged) {
          var more = [];
          if (indChanged.length) more.push(DB.persist('indicator', dedupeRows(indChanged)));
          return Promise.all(more);
        })
        .then(function () { return migrate(DB.tables.donor, 'donor_type', 'type', 'type_id'); })
        .then(function (c) { return c.length ? DB.persist('donor', c) : null; })
        .then(function () { return migrate(DB.tables.user, 'user_status', 'status', 'status_id'); })
        .then(function (c) { return c.length ? DB.persist('user', c) : null; });
    });
    function dedupeRows(rows) {
      var seen = {}, out = [];
      rows.forEach(function (r) { if (!seen[r.id]) { seen[r.id] = 1; out.push(r); } });
      return out;
    }
  }

  // =========================================================================
  //  BOOT
  // =========================================================================
  DB.init().then(function () {
    loadPrefs();
    reconcileRegions();   // pull region taxonomy fixes onto any cached data
    reconcileKpiDates();  // backfill exact baseline/target dates
    reconcileBenTypeDescriptions();  // backfill measure descriptions onto cached data
    return reconcileLookups();       // legacy text list values -> lookup ids
  }).then(function () {
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
        else if (c === 0x2013) o = 150;                    // en dash (WinAnsi 0x96)
        else if (c === 0x2014) o = 151;                    // em dash (WinAnsi 0x97)
        else if (c === 0x2192 || c === 0x21B3) o = 150;    // arrows read as an en dash in print
        else if (c === 0x2026) o = 133;                    // ellipsis (WinAnsi 0x85)
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
      if (code === 150) return 556;   // en dash
      if (code === 151) return 1000;  // em dash
      if (code === 133) return 1000;  // ellipsis
      return bold ? 611 : 556;
    }
    function textWEnc(s, size, bold){ var w = 0; for (var i = 0; i < s.length; i++) w += cw(s.charCodeAt(i), bold); return w / 1000 * size; }
    function textW(s, size, bold){ return textWEnc(enc(s), size, bold); }
    function escPdf(s){ return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)'); }
    // Build the content-stream op for a text run (baseline at x, y); used by
    // text() while drawing and by save() to stamp the per-page footer.
    function textOp(str, x, y, opt){
      opt = opt || {}; var s = enc(str); if (!s) return '';
      var col = opt.color || [0, 0, 0];
      var font = opt.bold ? 'F2' : (opt.italic ? 'F3' : 'F1');
      return 'BT /' + font + ' ' + (opt.size || 10) + ' Tf '
        + col[0] + ' ' + col[1] + ' ' + col[2] + ' rg 1 0 0 1 ' + f(x) + ' ' + f(y) + ' Tm ('
        + escPdf(s) + ') Tj ET';
    }
    // Draw text with its baseline at (x, y).
    function text(str, x, y, opt){
      var o = textOp(str, x, y, opt); if (o) op(o);
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
    // Place a JPEG (img = { data: raw bytes as a binary string, w, h }) - the org
    // logo on the letterhead. Registered once per doc, referenced as /ImN.
    var images = [];
    function image(img, x, y, w, h){
      var i = images.indexOf(img);
      if (i < 0){ i = images.length; images.push(img); }
      op('q ' + f(w) + ' 0 0 ' + f(h) + ' ' + f(x) + ' ' + f(y) + ' cm /Im' + (i + 1) + ' Do Q');
    }
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
    function build(){
      // Per-page footer: hairline, document title on the left, "Page n of N" on
      // the right - stamped here because only now is the page count known.
      if (writer.footer){
        var fMut = rgb('#98a2b3'), fRule = rgb('#e3e7ee');
        pages.forEach(function (pg, i){
          pg.ops.push('q ' + fRule[0] + ' ' + fRule[1] + ' ' + fRule[2] + ' RG 0.6 w '
            + f(margin) + ' 31 m ' + f(PW - margin) + ' 31 l S Q');
          pg.ops.push(textOp(writer.footer, margin, 21, { size: 7, color: fMut }));
          var pn = 'Page ' + (i + 1) + ' of ' + pages.length;
          pg.ops.push(textOp(pn, PW - margin - textW(pn, 7, false), 21, { size: 7, color: fMut }));
        });
      }
      var objs = [];
      function put(s){ objs.push(s); return objs.length; }
      var catalogN = put(''), pagesN = put('');
      var f1 = put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      var f2 = put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      var f3 = put('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>');
      var imgNs = images.map(function (im){
        return put('<< /Type /XObject /Subtype /Image /Width ' + im.w + ' /Height ' + im.h
          + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + im.data.length
          + ' >>\nstream\n' + im.data + '\nendstream');
      });
      var xres = imgNs.length ? ' /XObject << ' + imgNs.map(function (nn, i){ return '/Im' + (i + 1) + ' ' + nn + ' 0 R'; }).join(' ') + ' >>' : '';
      var kids = [];
      pages.forEach(function (pg){
        var stream = pg.ops.join('\n');
        var contentN = put('<< /Length ' + stream.length + ' >>\nstream\n' + stream + '\nendstream');
        var pageN = put('<< /Type /Page /Parent ' + pagesN + ' 0 R /MediaBox [0 0 ' + PW + ' ' + PH
          + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R /F3 ' + f3 + ' 0 R >>' + xres + ' >> /Contents ' + contentN + ' 0 R >>');
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
      return out;
    }
    function save(name){
      var out = build();
      var bytes = new Uint8Array(out.length);
      for (var b = 0; b < out.length; b++) bytes[b] = out.charCodeAt(b) & 0xff;
      var blob = new Blob([bytes], { type: 'application/pdf' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click();
      setTimeout(function (){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    }
    var writer = { PW: PW, PH: PH, margin: margin, addPage: addPage, text: text, rect: rect, rectStroke: rectStroke,
                   roundRect: roundRect, hline: hline, rgb: rgb, enc: enc, wrap: wrap, textW: textW, textWEnc: textWEnc,
                   image: image, raw: op, build: build, save: save, footer: '' };
    return writer;
  }

  // Render a results table (auto-fit columns, wrapping, page breaks). Returns the y
  // cursor after the last row. Wrappable = left-aligned columns; numeric (right-
  // aligned) columns keep to a single line.
  function pdfTable(doc, cols, rows, x, availW, startY, opts){
    if (!cols.length) return startY;
    opts = opts || {};
    var C = { ink: doc.rgb('#39424f'), head: doc.rgb('#5b6675'), headBg: doc.rgb('#eef1f5'),
              rule: doc.rgb('#c9d0da'), soft: doc.rgb('#eaedf2'), grid: doc.rgb('#e3e7ee'),
              zebra: doc.rgb('#f6f8fb'),
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
    // Non-grid header labels print as small caps; grid headers keep their case
    // (heat-map column names can be long and uppercasing would overflow them).
    function headLabel(i){ return grid ? cols[i].t : String(cols[i].t || '').toUpperCase(); }
    var headH = grid ? 15 : 17;
    function header(){
      if (!grid) doc.rect(x, y - headH, availW, headH, C.headBg);
      for (var i = 0; i < n; i++){
        var hs = grid ? hF : 6.5;
        doc.text(headLabel(i), xAlign(i, doc.textW(headLabel(i), hs, true)), y - headH + 5, { size: hs, bold: true, color: C.head });
        if (grid) doc.rectStroke(xs[i], y - headH, colW[i], headH, C.grid, 0.5);
      }
      y -= headH; if (!grid) doc.hline(x, x + availW, y, C.rule, 0.8);
    }
    header();
    if (!rows.length){ doc.text('No rows.', x + pad, y - 11, { size: dF, color: doc.rgb('#8792a3') }); return y - 16; }
    var zebra = false;   // alternate-row tint replaces the old per-row hairlines
    rows.forEach(function (row){
      // section band: a { group } marker row - a full-width heading (coloured
      // tick + title + project count) introducing a chain-level group of rows.
      if (row && row.group){
        var gH = 20;
        if (y - gH < doc.margin){ doc.addPage(); y = doc.PH - doc.margin; header(); zebra = false; }
        y -= 6;
        var gc = doc.rgb(row.group.color || '#94a3b8');
        doc.rect(x, y - 11, 2.5, 12, gc);
        doc.text(String(row.group.title || ''), x + 8, y - 9, { size: 9, bold: true, color: doc.rgb('#1a2230') });
        if (row.group.count != null){
          var gcn = row.group.count + ' project' + (row.group.count === 1 ? '' : 's');
          doc.text(gcn, x + availW - doc.textW(gcn, 7.5, false), y - 9, { size: 7.5, color: doc.rgb('#8792a3') });
        }
        y -= 15; zebra = false;
        return;
      }
      var cellLines = [], cellFit = [], maxLines = 1;
      for (var i = 0; i < n; i++){
        var cell = row[i] || { t: '' };
        var availTW = colW[i] - pad * 2 - (cell.dot ? 10 : 0);
        // tag cells render as a one-line tinted badge, never as wrapped text
        var lines = cell.tag ? [''] : (wrapCol[i] ? doc.wrap(cell.t, availTW, dF, false) : [doc.enc(cell.t)]);
        var fit = null;
        // A lone word that misses the column by a little ("Secondary" in a narrow
        // Type column) reads far better shrunk to fit than hard-broken mid-word.
        if (lines.length > 1 && !/\s/.test(String(cell.t == null ? '' : cell.t).trim())){
          var fs = dF;
          while (fs > 6 && doc.textW(cell.t, fs, false) > availTW) fs -= 0.25;
          lines = [doc.enc(cell.t)]; fit = fs;
        }
        cellLines.push(lines); cellFit.push(fit);
        if (lines.length > maxLines) maxLines = lines.length;
      }
      var rowH = vpad * 2 + maxLines * lineH;
      if (y - rowH < doc.margin){ doc.addPage(); y = doc.PH - doc.margin; header(); zebra = false; }
      if (!grid && zebra) doc.rect(x, y - rowH, availW, rowH, C.zebra);
      zebra = !zebra;
      for (i = 0; i < n; i++){
        var cell = row[i] || { t: '' }, lines = cellLines[i];
        var col = cell.color ? doc.rgb(cell.color) : C.ink, bold = !!cell.color;
        var indent = (cell.dot ? 10 : 0);
        // tag cell: a small tinted badge with coloured uppercase text, mirroring the
        // on-screen .kpi-type badges (cell.tag = { bg, fg }).
        if (cell.tag){
          var tg = doc.enc(String(cell.t || '').toUpperCase());
          var tf = 6.5, maxTW = Math.max(colW[i] - pad * 2 - 8, 12);
          while (tf > 5 && doc.textWEnc(tg, tf, true) > maxTW) tf -= 0.25;
          var tgw = doc.textWEnc(tg, tf, true), tpw = tgw + 8, tph = 11;
          var tpx = xs[i] + pad, tpy = (y - vpad - dF) + dF * 0.34 - tph / 2;
          doc.roundRect(tpx, tpy, tpw, tph, 3, doc.rgb(cell.tag.bg));
          doc.text(cell.t.toUpperCase(), tpx + 4, tpy + 3.4, { size: tf, bold: true, color: doc.rgb(cell.tag.fg) });
        }
        // filled / hollow / empty pill: a uniform-width rounded badge (stadium shape)
        // holding the centred number - mirrors the on-screen pills.
        if (cell.pill || cell.pillHollow || cell.pillEmpty){
          var ph = dF + 5.5, pw = Math.max(pillW, ph + 2);
          var px = xs[i] + (colW[i] - pw) / 2, py = (y - vpad - dF) + dF * 0.34 - ph / 2;
          if (cell.pill) doc.roundRect(px, py, pw, ph, ph / 2, doc.rgb(cell.pill));
          else doc.roundRect(px, py, pw, ph, ph / 2, cell.pillEmpty ? C.pillEmptyEdge : C.pillEdge, 0.7);
        }
        if (cell.dot) doc.roundRect(xs[i] + pad, y - vpad - dF + 1, 6, 6, 3, doc.rgb(cell.dot));
        // pill (number) cells render one point smaller than the body text; pill geometry
        // above stays keyed to dF so only the digits shrink, mirroring the on-screen table.
        var tF = (cell.pill || cell.pillHollow || cell.pillEmpty) ? dF - 1 : (cellFit[i] || dF);
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
      y -= rowH;
    });
    if (!grid) doc.hline(x, x + availW, y, C.rule, 0.8);   // closing rule under the last row
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
      var vw = AW - padX * 2 - lw - 5;   // 5 = the accent-rule indent the draw below adds
      var wrapped = doc.wrap(g.values.join(', '), vw, valF, false);
      wrapped.forEach(function (t, i){ lines.push({ label: i === 0 ? lbl : '', lw: lw, text: t }); });
    });
    var capH = 12;
    var boxH = padY * 2 + capH + lines.length * lineH;
    doc.roundRect(M, y - boxH, AW, boxH, 5, doc.rgb('#f4f6f9'));
    doc.roundRect(M, y - boxH, AW, boxH, 5, doc.rgb('#e3e8f0'), 0.7);
    doc.roundRect(M + 6, y - boxH + 6, 2.5, boxH - 12, 1.25, doc.rgb('#0c447c'));   // accent rule, as on screen
    // Caption: without it the panel reads as page furniture rather than as the
    // statement that these numbers are a slice.
    doc.text('FILTERED BY', M + padX + 5, y - padY - 7, { size: labelF, bold: true, color: doc.rgb('#0c447c') });
    var ly = y - padY - 8 - capH;
    lines.forEach(function (ln){
      if (ln.label) doc.text(ln.label, M + padX + 5, ly, { size: labelF, bold: true, color: doc.rgb('#8792a3') });
      doc.text(ln.text, M + padX + 5 + ln.lw, ly, { size: valF, color: doc.rgb('#1a2230') });
      ly -= lineH;
    });
    return y - boxH - 14;
  }

  function pdfFileName(p){
    var base = (p.title || 'results').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    var brand = orgActive() ? (orgShort().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'grassroots') : 'grassroots';
    return brand + '-' + (base || 'results') + '-' + TODAY.toISOString().slice(0, 10) + '.pdf';
  }

  // "13 July 2026" - a printed report deserves a human date, not an ISO stamp.
  function pdfDate(d){
    var MO = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    return d.getUTCDate() + ' ' + MO[d.getUTCMonth()] + ' ' + d.getUTCFullYear();
  }

  // Build and download the PDF for the results box currently on screen.
  function exportResultsPDF(p){
    if (!p){ alert('Open a results box first, then export.'); return; }
    // Activities + beneficiaries (p.grid) carry many columns - export those landscape.
    var doc = pdfWriter({ landscape: !!p.grid }), PW = doc.PW, M = doc.margin, AW = PW - 2 * M;
    doc.addPage();
    var y = doc.PH - M;
    var INK = doc.rgb('#1a2230'), MUT = doc.rgb('#8792a3'), SUB = doc.rgb('#5b6675'),
        NAVY = doc.rgb('#0c447c');
    doc.footer = orgBrand() + '  ·  ' + (p.title || 'Results');

    // letterhead: the slim brand band shared with the comm monthly reports
    var rt = 'Results Report  ·  ' + pdfDate(TODAY);
    pdfBrandHead(doc, M, PW - M - doc.textW(rt, 8.5, false) - 14);
    doc.text(rt, PW - M - doc.textW(rt, 8.5, false), doc.PH - 26, { size: 8.5, color: doc.rgb('#d7e3f0') });
    y = doc.PH - 63;

    // active development plan - stamped on every export
    var _ap = activePlan();
    if (_ap){
      var px = M;
      doc.text('PLAN', px, y - 8, { size: 6.5, bold: true, color: MUT });
      px += doc.textW('PLAN', 6.5, true) + 7;
      doc.text(_ap.name, px, y - 8, { size: 9, bold: true, color: NAVY });
      if (planPeriod(_ap)){
        px += doc.textW(_ap.name, 9, true) + 7;
        doc.text('·  ' + planPeriod(_ap), px, y - 8, { size: 8.5, color: MUT });
      }
      y -= 17;
    }
    y -= 7;

    // badge (rounded tag, as on screen) + title
    var badge = (p.badge || '').toUpperCase();
    if (badge){
      var bw = doc.textW(badge, 7.5, true) + 16;
      doc.roundRect(M, y - 12.5, bw, 16, 8, doc.rgb(p.badgeColor || '#7c8aa5'));
      doc.text(badge, M + 8, y - 8, { size: 7.5, bold: true, color: [1, 1, 1] });
      doc.text(p.title || '', M + bw + 10, y - 9.5, { size: 16, bold: true, color: INK });
    } else {
      doc.text(p.title || '', M, y - 9.5, { size: 16, bold: true, color: INK });
    }
    y -= 24;
    if (p.sub){ doc.text(p.sub, M, y - 8, { size: 9.5, color: SUB }); y -= 13; }
    if (p.summary){ doc.text(p.summary, M, y - 8, { size: 9, italic: true, color: MUT }); y -= 14; }
    y -= 9;

    // Active filters - the on-screen strip, redrawn. A printed export outlives the
    // screen it came from, so without this the reader cannot tell whether "7
    // projects" is the whole portfolio or one country's slice of it.
    y = pdfFilterStrip(doc, p.filters, M, AW, y);

    // stat cards - bordered rounded panels, label / value / status chip
    if (p.stats && p.stats.length){
      var nS = p.stats.length, gap = 10, cardW = (AW - gap * (nS - 1)) / nS, cardH = 50;
      for (var i = 0; i < nS; i++){
        var sx = M + i * (cardW + gap), st = p.stats[i];
        doc.roundRect(sx, y - cardH, cardW, cardH, 6, doc.rgb('#f7f9fc'));
        doc.roundRect(sx, y - cardH, cardW, cardH, 6, doc.rgb('#e3e8f0'), 0.8);
        doc.text((st.label || '').toUpperCase(), sx + 9, y - 15, { size: 6.5, bold: true, color: MUT });
        // long values (e.g. a Timeline date range) shrink to fit rather than clip
        var vF = 14;
        while (vF > 8 && doc.textW(st.value || '', vF, true) > cardW - 18) vF -= 0.5;
        doc.text(st.value || '', sx + 9, y - 32, { size: vF, bold: true, color: INK });
        if (st.sub){
          if (st.color){
            var chW = doc.textW(st.sub, 6.5, true) + 12;
            doc.roundRect(sx + 9, y - 46.5, Math.min(chW, cardW - 18), 12, 6, doc.rgb(st.color));
            doc.text(st.sub, sx + 15, y - 43, { size: 6.5, bold: true, color: [1, 1, 1] });
          } else {
            doc.text(st.sub, sx + 9, y - 43, { size: 7.5, color: MUT });
          }
        }
      }
      y -= cardH + 20;
    }

    // section headings read as "PROJECTS · 5 OF 13" - the on-screen " - " separator
    // looks like a minus once uppercased on paper.
    function sectionHead(s){ return String(s || '').toUpperCase().replace(/\s+-\s+/g, '  ·  '); }
    if (p.section){
      doc.text(sectionHead(p.section), M, y - 9, { size: 8.5, bold: true, color: SUB });
      y -= 15;
    }
    // Grouped project tables (Plan→Impacts, …) render as ONE table with a
    // full-width band before each group, so every group shares identical columns
    // and pagination. A band is a { group } marker row pdfTable knows to draw.
    var tblRows = p.rows || [];
    if (p.sections && p.sections.length){
      tblRows = [];
      p.sections.forEach(function (s){
        tblRows.push({ group: { title: s.title, color: s.color, count: s.rows.length } });
        s.rows.forEach(function (r){ tblRows.push(r); });
      });
    }
    y = pdfTable(doc, p.columns || [], tblRows, M, AW, y, { grid: !!p.grid });
    if (p.note){ y -= 8; doc.text(p.note, M, y - 8, { size: 8, italic: true, color: MUT }); }

    // optional second table (e.g. the beneficiaries heat-map) - always gridded
    if (p.table2 && p.table2.columns && p.table2.rows && p.table2.rows.length){
      y -= 24;
      if (y < M + 90){ doc.addPage(); y = doc.PH - M; }
      doc.text(sectionHead(p.table2.section), M, y - 9, { size: 8.5, bold: true, color: SUB }); y -= 15;
      y = pdfTable(doc, p.table2.columns, p.table2.rows, M, AW, y, { grid: true });
    }

    doc.save(pdfFileName(p));
  }

  // =========================================================================
  //  PROJECT DOSSIER PDF - the whole picture of one project, exported from the
  //  project modal footer. Three chapters, each on its own page opener with the
  //  shared brand letterhead: Overview (identity + snapshot), Results so far
  //  (the achieved picture, KPI by KPI + the activity log) and Forecast (where
  //  the trajectory lands by end of plan). Built on the same zero-dependency
  //  pdfWriter / pdfTable primitives as the results and forecast exports, so the
  //  type, colour and table language all match the rest of the suite.
  // =========================================================================
  function exportProjectPDF(pr){
    if (!pr || pr.id == null){ alert('Save the project details first, then export.'); return; }
    var P = PROJECTSBYID[pr.id];
    if (!P){ alert('This project is not in the active plan - open it in its own plan to export.'); return; }

    var doc = pdfWriter(), PW = doc.PW, PH = doc.PH, M = doc.margin, AW = PW - 2 * M;
    var INK = doc.rgb('#1a2230'), MUT = doc.rgb('#8792a3'), SUB = doc.rgb('#5b6675'),
        NAVY = doc.rgb('#0c447c'), GOLD = doc.rgb('#FCC30B'), RULE = doc.rgb('#e3e7ee'),
        SOFT = doc.rgb('#f7f9fc'), CARD = doc.rgb('#e3e8f0');
    var co = P.country, don = P.donor, pt = P.partner;
    var st = P.statAll || {}, code = st.code || 'nodata', S0 = STATUS[code] || STATUS.nodata;
    doc.footer = orgBrand() + '  ·  ' + (P.name || 'Project') + (pr.code ? '  ·  ' + pr.code : '');

    // ---- shared page-opener / section chrome -------------------------------
    // Each main part opens a new page with the brand letterhead and an uppercase
    // title over a gold rule.
    function chapter(title, sub){
      doc.addPage();
      var rt = 'Project Dossier  ·  ' + pdfDate(TODAY);
      pdfBrandHead(doc, M, PW - M - doc.textW(rt, 8.5, false) - 14);
      doc.text(rt, PW - M - doc.textW(rt, 8.5, false), PH - 26, { size: 8.5, color: doc.rgb('#d7e3f0') });
      var t = String(title).toUpperCase(), y = PH - 92;
      var tf = 16; while (tf > 11 && doc.textW(t, tf, true) > AW) tf -= 0.5;
      doc.text(t, M, y, { size: tf, bold: true, color: INK });
      y -= 9;
      doc.roundRect(M, y - 3, 36, 3, 1.5, GOLD);   // gold root-line accent, as on the letterhead
      y -= 13;
      if (sub){ doc.text(sub, M, y - 2, { size: 9.5, color: SUB }); y -= 15; }
      return y - 8;
    }
    function section(y, label){
      y = (y < M + 74) ? (doc.addPage(), PH - M) : y - 8;
      doc.text(String(label || '').toUpperCase(), M, y - 9, { size: 8.5, bold: true, color: NAVY });
      doc.hline(M, PW - M, y - 15, RULE, 0.8);
      return y - 25;
    }
    // A fresh page WITHIN the current part (no letterhead band) headed by an
    // uppercase title over a gold rule, with an optional wrapped subtitle - used
    // for the activity log, which the caller wants on its own page.
    function subPage(title, sub){
      doc.addPage();
      var y = PH - M, t = String(title).toUpperCase();
      var tf = 13; while (tf > 11 && doc.textW(t, tf, true) > AW) tf -= 0.5;
      doc.text(t, M, y - 12, { size: tf, bold: true, color: INK });
      y -= 15;
      doc.roundRect(M, y - 3, 34, 3, 1.5, GOLD);
      y -= 11;
      if (sub){ doc.wrap(sub, AW, 9.5, false).forEach(function (ln){ doc.text(ln, M, y - 2, { size: 9.5, color: SUB }); y -= 13; }); }
      return y - 8;
    }

    // ---- stat cards (bordered rounded panels, label / value / status chip) --
    function statCards(y, stats){
      var nS = stats.length, gap = 10, cardW = (AW - gap * (nS - 1)) / nS, cardH = 52;
      for (var i = 0; i < nS; i++){
        var sx = M + i * (cardW + gap), s = stats[i];
        doc.roundRect(sx, y - cardH, cardW, cardH, 6, SOFT);
        doc.roundRect(sx, y - cardH, cardW, cardH, 6, CARD, 0.8);
        doc.text((s.label || '').toUpperCase(), sx + 9, y - 15, { size: 6.5, bold: true, color: MUT });
        var vF = 15; while (vF > 9 && doc.textW(s.value || '', vF, true) > cardW - 18) vF -= 0.5;
        doc.text(s.value || '', sx + 9, y - 33, { size: vF, bold: true, color: INK });
        if (s.sub){
          if (s.color){
            var chW = Math.min(doc.textW(s.sub, 6.5, true) + 12, cardW - 18);
            doc.roundRect(sx + 9, y - 48, chW, 12, 6, doc.rgb(s.color));
            doc.text(s.sub, sx + 15, y - 44.5, { size: 6.5, bold: true, color: [1, 1, 1] });
          } else doc.text(s.sub, sx + 9, y - 44.5, { size: 7.5, color: MUT });
        }
      }
      return y - cardH - 18;
    }

    // ---- two-column fact grid (label over value) ---------------------------
    function factGrid(y, facts){
      var gap = 16, colW = (AW - gap) / 2, rowH = 33;
      for (var i = 0; i < facts.length; i += 2){
        if (y - rowH < M + 14){ doc.addPage(); y = PH - M; }
        for (var c = 0; c < 2; c++){
          var fct = facts[i + c]; if (!fct) continue;
          var fx = M + c * (colW + gap);
          doc.text(String(fct[0]).toUpperCase(), fx, y - 10, { size: 6.5, bold: true, color: MUT });
          var vv = String(fct[1] == null || fct[1] === '' ? '-' : fct[1]), vf = 10.5;
          while (vf > 8 && doc.textW(vv, vf, false) > colW) vf -= 0.25;
          doc.text(doc.wrap(vv, colW, vf, false)[0], fx, y - 23, { size: vf, color: INK });
        }
        y -= rowH;
      }
      return y;
    }

    // KPI groups: primaries by impact pillar, then any secondaries as one group -
    // the same "group by the level below" language the on-screen project lists use.
    function kpiGroups(){
      var groups = [], byS = {};
      P.primary.forEach(function (r){ var s = r.sdg || 0; (byS[s] = byS[s] || []).push(r); });
      Object.keys(byS).sort(function (a, b){ return (+a || 99) - (+b || 99); }).forEach(function (s){
        groups.push({ title: (+s) ? (pillarLabel(+s) + ' · ' + (PILLAR_NAMES[+s] || '')) : 'Unaligned',
                      color: (+s) ? PILLAR_COLORS[+s] : '#94a3b8', rows: byS[s] });
      });
      if (P.secondary.length) groups.push({ title: 'Secondary KPIs', color: '#27500a', rows: P.secondary.slice() });
      return groups;
    }
    function groupedRows(groups, cellsFor){
      var rows = [];
      groups.forEach(function (g){
        rows.push({ group: { title: g.title, color: g.color, count: null } });   // count null → no "N projects" label
        g.rows.forEach(function (r){ rows.push(cellsFor(r)); });
      });
      return rows;
    }
    function kdot(r){ return r.sdg ? PILLAR_COLORS[r.sdg] : (r.secondary ? '#27500a' : '#94a3b8'); }
    function unitSuf(r){ return r.unit === '%' ? '%' : ''; }

    // =====================================================================
    //  CHAPTER 1 · OVERVIEW
    // =====================================================================
    var y = chapter(P.name || 'Project',
      [pr.code, co ? co.name : (pr.country_iso3 || ''), don ? don.name : ''].filter(Boolean).join('  ·  '));

    // headline status badge + performance
    var badge = S0.label.toUpperCase(), bw = doc.textW(badge, 7.5, true) + 16;
    doc.roundRect(M, y - 13, bw, 16, 8, doc.rgb(S0.c));
    doc.text(badge, M + 8, y - 8.5, { size: 7.5, bold: true, color: [1, 1, 1] });
    doc.text(st.ratio != null ? 'Overall performance ' + Math.round(st.ratio * 100) + '%' : 'Not yet measured',
      M + bw + 10, y - 8.5, { size: 9, color: MUT });
    y -= 28;

    // snapshot cards
    y = statCards(y, [
      { label: 'Performance', value: st.ratio != null ? Math.round(st.ratio * 100) + '%' : '-', sub: S0.label, color: S0.c },
      { label: 'Progress', value: st.frac != null ? Math.round(st.frac * 100) + '%' : '-', sub: 'achieved of target' },
      { label: 'KPIs', value: fmt(P.kpis.length), sub: fmt(P.primary.length) + ' primary · ' + fmt(P.secondary.length) + ' secondary' },
      { label: 'Activities', value: fmt(P.activityN || 0), sub: 'reports logged' }
    ]);

    // identity fact grid
    y = section(y, 'Project profile');
    y = factGrid(y, [
      ['Project code', pr.code],
      ['Country', co ? co.name : pr.country_iso3],
      ['Donor', don ? don.name : ''],
      ['Delivery', P.implementation === 'partner' ? 'Through an implementing partner' : 'Directly by the organisation'],
      ['Implementing partner', pt ? (pt.name + (pt.acronym ? ' (' + pt.acronym + ')' : '')) : (P.implementation === 'partner' ? 'Not set' : '-')],
      ['Lead', userName(projectLeadId(pr))],
      ['Budget (USD)', pr.budget_usd != null ? '$' + fmt(pr.budget_usd) : ''],
      ['Timeframe', (pr.start_date || '?') + '   to   ' + (pr.end_date || '?')]
    ]);

    // description paragraph
    if (pr.description && pr.description.trim()){
      y = section(y, 'Description');
      var dl = doc.wrap(pr.description.trim(), AW, 9.5, false);
      for (var di = 0; di < dl.length; di++){
        if (y - 13 < M + 14){ doc.addPage(); y = PH - M; }
        doc.text(dl[di], M, y - 9, { size: 9.5, color: SUB }); y -= 13;
      }
    }

    // =====================================================================
    //  CHAPTER 2 · RESULTS SO FAR
    // =====================================================================
    y = chapter('Results so far', 'Achievement to date, KPI by KPI, with the underlying activity log.');
    var resCols = [
      { t: 'Code', w: 66 }, { t: 'KPI', w: 196 },
      { t: 'Baseline', w: 60, align: 'right' }, { t: 'Latest', w: 56, align: 'right' },
      { t: 'Target', w: 60, align: 'right' }, { t: 'Progress', w: 58, align: 'right' },
      { t: 'Status', w: 92 }
    ];
    y = section(y, 'Key performance indicators');
    if (!P.kpis.length){
      doc.text('No KPIs are attached to this project yet.', M, y - 9, { size: 9, italic: true, color: MUT }); y -= 16;
    } else {
      y = pdfTable(doc, resCols, groupedRows(kpiGroups(), function (r){
        var suf = unitSuf(r), s = STATUS[r.status] || STATUS.nodata;
        return [
          { t: r.raw.code || '-' },
          { t: r.name, dot: kdot(r) },
          { t: fmtNum(r.raw.baseline_value) + suf, align: 'right' },
          { t: r.value != null ? fmtNum(r.value) + suf : '-', align: 'right' },
          { t: fmtNum(r.raw.target_value) + suf, align: 'right' },
          { t: r.progress != null ? Math.round(r.progress * 100) + '%' : '-', align: 'right', color: s.c },
          { t: s.label, color: s.c }
        ];
      }), M, AW, y);
      y -= 6;
      doc.text('Progress is achievement of target; Status is the RAG performance rating (pace against the KPI’s own timeframe).',
        M, y - 8, { size: 7.5, italic: true, color: MUT }); y -= 14;
    }

    // Activity log - on its own page within this part. The full detail behind the
    // numbers (activity, KPI, location, value, date, reporter) with the beneficiary
    // reach heat-map beneath it, reusing the app's own beneficiary export spec so
    // the dossier matches the on-screen tables column for column.
    var acts = (DB._idx.measByProject[pr.id] || []).slice()
      .sort(function (a, b){ return (a.date < b.date) ? 1 : -1; });
    y = subPage('Activity log', acts.length
      ? ('All ' + fmt(acts.length) + ' activity reports logged against this project - what was done, where, how much and by whom, with the beneficiary reach behind each report.')
      : 'The activity reports logged against this project.');

    y = section(y, 'Activities' + (acts.length ? ' · ' + fmt(acts.length) : ''));
    if (!acts.length){
      doc.text('No activities have been logged against this project yet.', M, y - 9, { size: 9, italic: true, color: MUT });
    } else {
      y = pdfTable(doc, [
        { t: '#', align: 'center', w: 26 }, { t: 'Activity', w: 150 }, { t: 'KPI', w: 88, align: 'right' },
        { t: 'Location', w: 92 }, { t: 'Value', w: 56, align: 'right' }, { t: 'Date', w: 62, align: 'center' },
        { t: 'Reported by', w: 92 }
      ], acts.map(function (m, i){
        var ind = INDBYID[m.indicator_id], u = (ind && ind.unit === '%') ? '%' : '';
        return [
          { t: String(i + 1) },
          { t: m.narrative || '-', dot: ind ? kdot(ind) : '#94a3b8' },
          { t: ind ? (ind.raw.code || ind.name) : '-', align: 'right' },
          { t: m.place_name || '-' },
          { t: fmtNum(m.value) + u, align: 'right' },
          { t: m.date ? shortDate(m.date) : '-', align: 'center' },
          { t: m.reported_by_id != null ? userName(m.reported_by_id) : '-' }
        ];
      }), M, AW, y);

      // beneficiary reach heat-map for the same activities (the app's own spec)
      var ben = beneficiaryHeatmap(acts);
      y = section(y, ben.table ? ben.table.section.replace(' - ', ' · ') : 'Beneficiaries');
      if (!ben.table){
        doc.text('No beneficiaries recorded against these activities.', M, y - 9, { size: 9, italic: true, color: MUT });
      } else {
        y = pdfTable(doc, ben.table.columns, ben.table.rows, M, AW, y, { grid: true });
        y -= 6;
        doc.text('Reach by beneficiary type per activity. Darker cells = more beneficiaries; totals are hollow.',
          M, y - 8, { size: 7.5, italic: true, color: MUT });
      }
    }

    // =====================================================================
    //  CHAPTER 3 · FORECAST
    // =====================================================================
    // One forecast entity over the project's whole KPI set, projected to the
    // latest KPI target month (end of plan). NOW is the achieved actual; the
    // realistic / best / worst columns extend the recent pace forward - the same
    // engine, and the same numbers, as the Forecast panel.
    var ent = fcEntity('project:' + pr.id, P.name, '', S0.c, P.kpis);
    var mNow = fcNowMi(), mH = mNow + 1;
    ent.fcs.forEach(function (f){ if (f.mEnd > mH) mH = f.mEnd; });
    var aNow = null, aR = null, aW = null, aB = null, exp = null, fcode = 'nodata', conf = '-';
    if (ent.fcs.length){
      var sN = 0; ent.fcs.forEach(function (f){ sN += f.a0; }); aNow = sN / ent.fcs.length;
      aR = fcMean(ent, 'mid', mH); aW = fcMean(ent, 'lo', mH); aB = fcMean(ent, 'hi', mH);
      var ex = 0, reps = 0;
      ent.fcs.forEach(function (f){
        ex += Math.max(0.02, Math.min(1, (Math.min(mH, f.mEnd) - f.m0) / (f.mEnd - f.m0)));
        reps += f.reps;
      });
      exp = ex / ent.fcs.length; fcode = ratioToCode(aR / exp);
      var mr = reps / ent.fcs.length; conf = mr >= 6 ? 'High' : mr >= 3 ? 'Medium' : 'Low';
    }
    var FS = STATUS[fcode] || STATUS.nodata;
    y = chapter('Forecast', 'Where the current trajectory lands by ' + fcMiFull(mH) + ' (end of plan).');

    if (!ent.fcs.length){
      doc.text('This project has no measurable KPIs to forecast yet.', M, y - 9, { size: 9.5, italic: true, color: MUT });
      doc.save(projFileName(P, pr));
      return;
    }

    // projected badge + confidence
    var fbadge = ('Projected ' + FS.label).toUpperCase(), fbw = doc.textW(fbadge, 7.5, true) + 16;
    doc.roundRect(M, y - 13, fbw, 16, 8, doc.rgb(FS.c));
    doc.text(fbadge, M + 8, y - 8.5, { size: 7.5, bold: true, color: [1, 1, 1] });
    doc.text('Confidence: ' + conf + '  ·  ' + ent.fcs.length + ' KPI' + (ent.fcs.length === 1 ? '' : 's') + ' modelled',
      M + fbw + 10, y - 8.5, { size: 9, color: MUT });
    y -= 28;

    // scenario cards
    y = statCards(y, [
      { label: 'Now (actual)', value: Math.round(aNow * 100) + '%', sub: 'achieved today' },
      { label: 'Worst case', value: Math.round(aW * 100) + '%', sub: 'cautious pace', color: (STATUS[ratioToCode(aW / exp)] || STATUS.nodata).c },
      { label: 'Realistic', value: Math.round(aR * 100) + '%', sub: FS.label, color: FS.c },
      { label: 'Best case', value: Math.round(aB * 100) + '%', sub: 'strong pace', color: (STATUS[ratioToCode(aB / exp)] || STATUS.nodata).c }
    ]);

    y = section(y, 'Projected outcome by KPI');
    y = pdfTable(doc, [
      { t: 'Code', w: 66 }, { t: 'KPI', w: 210 }, { t: 'Now', w: 52, align: 'right' },
      { t: 'Projected', w: 66, align: 'right' }, { t: 'Outlook', w: 100 }
    ], groupedRows(kpiGroups(), function (r){
      var f = kpiForecast(r);
      if (!f){
        return [ { t: r.raw.code || '-' }, { t: r.name, dot: kdot(r) },
                 { t: '-', align: 'right' }, { t: '-', align: 'right' },
                 { t: 'Not measurable', color: '#94a3b8' } ];
      }
      var proj = fcAt(f, 'mid', mH);
      var exf = Math.max(0.02, Math.min(1, (Math.min(mH, f.mEnd) - f.m0) / (f.mEnd - f.m0)));
      var s = STATUS[ratioToCode(proj / exf)] || STATUS.nodata;
      return [
        { t: r.raw.code || '-' }, { t: r.name, dot: kdot(r) },
        { t: Math.round(f.a0 * 100) + '%', align: 'right' },
        { t: Math.round(proj * 100) + '%', align: 'right', color: s.c },
        { t: f.unreported ? s.label + ' (no reports)' : s.label, color: s.c }
      ];
    }), M, AW, y);
    y -= 6;
    doc.text('Projection extends each KPI’s recent pace to its target date; Outlook is the resulting performance rating.',
      M, y - 8, { size: 7.5, italic: true, color: MUT });

    doc.save(projFileName(P, pr));
  }

  // File name for a project dossier: <org>-<project>-YYYY-MM-DD.pdf
  function projFileName(P, pr){
    var base = ((pr.code ? pr.code + '-' : '') + (P.name || 'project')).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
    var brand = (orgActive() ? (orgShort() || 'grassroots') : 'grassroots')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'grassroots';
    return brand + '-' + (base || 'project') + '-' + TODAY.toISOString().slice(0, 10) + '.pdf';
  }

})();
