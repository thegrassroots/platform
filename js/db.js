/* =============================================================================
 * db.js - zero-dependency relational data layer for the RBM/M&E monitor.
 *
 * Mirrors schema.sql exactly. Persists to IndexedDB (native browser API, no
 * libraries) and keeps a hot in-memory copy for fast joins/filters. The same
 * table shapes load unchanged into a real SQLite DB; DB.exportSQL() emits the
 * INSERTs that `sqlite3` accepts verbatim on a database built from schema.sql.
 * ========================================================================== */
(function () {
  'use strict';

  var DB_NAME = 'grassroots_v1';   // bump to force every browser to drop and reseed
  var DB_VERSION = 5;              // v5 adds the `region` store (all-world country reference)
  var STAMP_KEY = 'ddi_seed_stamp'; // localStorage key: content stamp of last-seeded data (auto-reseed)
  // `plan` is the top of the results chain (Plan > Impact > Outcome > Output > KPI);
  // results & projects carry a plan_id. DB_NAME is unchanged - the content stamp
  // above auto-reseeds every browser when the seed (now two plans) regenerates.
  // `region` is a universal reference table (the six continents); country carries
  // a region_id FOREIGN key into it.
  var TABLES = ['plan', 'region', 'country', 'user', 'donor', 'programme', 'project', 'project_kpi', 'result', 'indicator', 'measurement', 'beneficiary_type', 'beneficiary'];

  // In-memory mirror of every table (array of row objects).
  var mem = {};
  TABLES.forEach(function (t) { mem[t] = []; });

  function openIDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        TABLES.forEach(function (t) {
          if (!db.objectStoreNames.contains(t)) {
            db.createObjectStore(t, { keyPath: 'id' });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function countStore(db, table) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(table, 'readonly');
      var r = tx.objectStore(table).count();
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function bulkPut(db, table, rows) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(table, 'readwrite');
      var store = tx.objectStore(table);
      rows.forEach(function (row) {
        // country has no numeric id → use iso3 as key
        if (table === 'country' && row.id === undefined) row.id = row.iso3;
        store.put(row);
      });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function loadAll(db, table) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(table, 'readonly');
      var r = tx.objectStore(table).getAll();
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  // ---- public API ----------------------------------------------------------
  var DB = {
    tables: mem,

    /** Open + (first run) seed + hydrate memory. Falls back to in-memory only
     *  if IndexedDB is unavailable (e.g. some private-mode file:// contexts).
     *
     *  Auto-reseed: the seed carries a content stamp (window.SEED_STAMP). When it
     *  differs from the stamp we last persisted, the data was regenerated - so we
     *  wipe the persisted DB and reseed from scratch. This keeps a stable DB_NAME
     *  while still delivering a changed seed to every browser on next load, with
     *  no manual reset. (First run: no stored stamp, tables are empty anyway.) */
    init: function () {
      var seed = window.SEED || {};
      var stamp = window.SEED_STAMP || null;
      var prevStamp = null;
      try { prevStamp = localStorage.getItem(STAMP_KEY); } catch (e) {}
      // Stale when we have a current stamp and it doesn't match what we stored.
      // A missing stored stamp also counts as stale, so existing installs pick up
      // the new data exactly once when this mechanism first ships.
      var stale = !!stamp && prevStamp !== stamp;
      function markStamp() { try { if (stamp) localStorage.setItem(STAMP_KEY, stamp); } catch (e) {} }

      if (!('indexedDB' in window) || indexedDB === null) {
        TABLES.forEach(function (t) { mem[t] = (seed[t] || []).slice(); });
        DB._buildIndexes();
        markStamp();
        return Promise.resolve({ persisted: false, seeded: true });
      }
      // If the seed changed, drop the persisted DB first so every table reseeds.
      var wipe = stale ? new Promise(function (resolve) {
        var del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = resolve; del.onerror = resolve; del.onblocked = resolve;
      }) : Promise.resolve();
      var dbRef;
      return wipe.then(openIDB).then(function (db) {
        dbRef = db; DB._db = db;
        // Seed any EMPTY table (covers first run AND newly-added stores like `user`).
        return Promise.all(TABLES.map(function (t) {
          return countStore(dbRef, t).then(function (n) {
            if (n > 0) return false;
            return bulkPut(dbRef, t, (seed[t] || []).map(clone)).then(function () { return true; });
          });
        }));
      }).then(function (seededFlags) {
        var seeded = seededFlags.some(Boolean);
        var jobs = TABLES.map(function (t) {
          return loadAll(dbRef, t).then(function (rows) { mem[t] = rows; });
        });
        return Promise.all(jobs).then(function () {
          DB._buildIndexes();
          markStamp();
          return { persisted: true, seeded: seeded };
        });
      }).catch(function () {
        // hard fallback: memory only
        TABLES.forEach(function (t) { mem[t] = (seed[t] || []).slice(); });
        DB._buildIndexes();
        markStamp();
        return { persisted: false, seeded: true };
      });
    },

    /** Wipe the persisted DB and re-seed from window.SEED. */
    reset: function () {
      return new Promise(function (resolve, reject) {
        var del = indexedDB.deleteDatabase(DB_NAME);
        del.onsuccess = resolve; del.onerror = function () { reject(del.error); };
        del.onblocked = resolve;
      }).then(function () { return DB.init(); });
    },

    // ---- writes (persist to IndexedDB + hot memory) -----------------------
    _db: null,
    nextId: function (table) {
      var m = 0; mem[table].forEach(function (r) { if (+r.id > m) m = +r.id; }); return m + 1;
    },
    /** Insert one or more new rows (auto-assigns sequential ids where missing). */
    insert: function (table, rows) {
      if (!Array.isArray(rows)) rows = [rows];
      var next = DB.nextId(table);
      rows.forEach(function (r) { if (r.id == null) r.id = next++; mem[table].push(r); });
      DB._buildIndexes();
      // System-generated hierarchy codes - assigned HERE at insert, never taken
      // from the caller, so they cannot be user-edited. Any `code` a caller
      // passed for these rows is overwritten:
      //   Pillar #  ·  Outcome #.#  ·  Output #.#.#  ·  KPI #.#.#.#
      if (table === 'result' || table === 'indicator') {
        // `code` is not part of any index (indexes key on id/parent_id/…), and the
        // index holds references to these same row objects, so stamping in place
        // needs no rebuild.
        rows.forEach(function (r) {
          // secondary (project-local) KPIs are not part of the Output hierarchy –
          // they keep the caller-supplied code (e.g. SEC-…), never a 'KPI #.#.#.#'.
          if (table === 'indicator' && r.secondary) { return; }
          if (table === 'indicator') { r.code = DB._codeForIndicator(r); }
          else if (r.level === 'impact' || r.level === 'outcome' || r.level === 'output') { r.code = DB._codeForResult(r); }
        });
      }
      return putRows(table, rows).then(function () { return rows; });
    },
    /** Hierarchy code for a result row (Pillar / Outcome / Output). The ordinal
     *  is this row's position among same-level siblings under the same parent,
     *  making codes stable and identical across every country instance. */
    _codeForResult: function (r) {
      if (r.level === 'impact') return 'Impact ' + r.sdg;
      var parent = DB._idx.resultById[r.parent_id];
      var base = (parent && parent.code) ? stripCodeWord(parent.code) : String(r.sdg == null ? '' : r.sdg);
      var idx = 0;
      mem.result.forEach(function (x) {
        if (x.parent_id === r.parent_id && x.level === r.level && x.id < r.id) idx++;
      });
      return (r.level === 'outcome' ? 'Outcome ' : 'Output ') + base + '.' + (idx + 1);
    },
    /** Hierarchy code for a KPI (indicator): parent Output code + KPI ordinal. */
    _codeForIndicator: function (ind) {
      var out = DB._idx.resultById[ind.result_id];
      var base = (out && out.code) ? stripCodeWord(out.code) : '';
      var idx = 0;
      mem.indicator.forEach(function (x) {
        if (x.result_id === ind.result_id && x.id < ind.id) idx++;
      });
      return 'KPI ' + base + '.' + (idx + 1);
    },
    /** Persist edits to rows already present (and mutated) in memory. */
    persist: function (table, rows) {
      if (!Array.isArray(rows)) rows = [rows];
      DB._buildIndexes();
      return putRows(table, rows);
    },
    /** Delete rows by id from memory + store. */
    remove: function (table, ids) {
      if (!Array.isArray(ids)) ids = [ids];
      var set = {}; ids.forEach(function (i) { set[i] = 1; });
      mem[table] = mem[table].filter(function (r) { return !set[r.id]; });
      DB._buildIndexes();
      return delRows(table, ids);
    },

    // ---- indexes for fast lookup (built after hydrate) ---------------------
    _idx: {},
    _buildIndexes: function () {
      var idx = DB._idx = {};
      idx.planById = byId(mem.plan);
      idx.regionById = byId(mem.region);
      idx.programmeById = byId(mem.programme);
      idx.resultById = byId(mem.result);
      idx.indicatorById = byId(mem.indicator);
      idx.countryByIso = {};
      mem.country.forEach(function (c) { idx.countryByIso[c.iso3] = c; });
      idx.userById = byId(mem.user);
      idx.userByUsername = {};
      mem.user.forEach(function (u) { idx.userByUsername[String(u.username).toLowerCase()] = u; });
      idx.measById = byId(mem.measurement);
      idx.measByIndicator = groupBy(mem.measurement, 'indicator_id');
      idx.resultByProgramme = groupBy(mem.result, 'programme_id');
      idx.indicatorByResult = groupBy(mem.indicator, 'result_id');
      // ---- projects / donors -------------------------------------------------
      idx.donorById = byId(mem.donor);
      idx.projectById = byId(mem.project);
      idx.projectByCountry = groupBy(mem.project, 'country_iso3');
      idx.projectKpiByProject = groupBy(mem.project_kpi, 'project_id');
      idx.projectKpiByIndicator = groupBy(mem.project_kpi, 'indicator_id');
      // secondary (project-local) KPIs are indicators carrying a project_id
      idx.secondaryByProject = {};
      mem.indicator.forEach(function (i) { if (i.secondary) (idx.secondaryByProject[i.project_id] = idx.secondaryByProject[i.project_id] || []).push(i); });
      // one programme per country → resolve a country's programme in O(1)
      idx.programmeByIso = {};
      mem.programme.forEach(function (p) { if (p.country_iso3 && !idx.programmeByIso[p.country_iso3]) idx.programmeByIso[p.country_iso3] = p; });
      idx.measByProject = groupBy(mem.measurement, 'project_id');
      // ---- beneficiaries -----------------------------------------------------
      idx.benTypeById = byId(mem.beneficiary_type);
      idx.benByMeasurement = groupBy(mem.beneficiary, 'measurement_id');
    },

    // ---- convenience accessors --------------------------------------------
    measurementsFor: function (indicatorId) {
      return (DB._idx.measByIndicator[indicatorId] || []).slice().sort(function (a, b) {
        return (a.date < b.date) ? -1 : (a.date > b.date ? 1 : 0);
      });
    },

    /** Export the whole database as SQLite-compatible SQL text. */
    exportSQL: function () {
      var lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
      TABLES.forEach(function (t) {
        mem[t].forEach(function (row) {
          var cols = Object.keys(row).filter(function (k) { return k !== 'id' || t !== 'country'; });
          var vals = cols.map(function (k) { return sqlVal(row[k]); });
          lines.push('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + vals.join(',') + ');');
        });
      });
      lines.push('COMMIT;');
      return lines.join('\n');
    }
  };

  // ---- helpers -------------------------------------------------------------
  function putRows(table, rows) {
    return new Promise(function (resolve, reject) {
      if (!DB._db) { resolve(); return; }                 // memory-only fallback
      var tx = DB._db.transaction(table, 'readwrite'), st = tx.objectStore(table);
      rows.forEach(function (r) { st.put(clone(r)); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function delRows(table, ids) {
    return new Promise(function (resolve, reject) {
      if (!DB._db) { resolve(); return; }
      var tx = DB._db.transaction(table, 'readwrite'), st = tx.objectStore(table);
      ids.forEach(function (id) { st.delete(id); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 'Outcome 1.2' -> '1.2', 'Pillar 3' -> '3' - strips the leading label word so
  // a child code can be built from its parent's numeric path.
  function stripCodeWord(code) { return String(code == null ? '' : code).replace(/^\s*[A-Za-z]+\s+/, ''); }
  function byId(arr) { var m = {}; arr.forEach(function (r) { m[r.id] = r; }); return m; }
  function groupBy(arr, key) {
    var m = {};
    arr.forEach(function (r) { (m[r[key]] = m[r[key]] || []).push(r); });
    return m;
  }
  function sqlVal(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  window.DB = DB;
})();
