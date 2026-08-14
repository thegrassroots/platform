/* =============================================================================
 * db.js - zero-dependency relational data layer for the RBM/M&E monitor.
 *
 * TWO BACKENDS, ONE MODEL. The app runs unchanged against either:
 *
 *   LOCAL  - a real SQLite database (rbm.db) behind server.py. Detected at boot
 *            by probing api/health. Foreign keys are ENFORCED by the engine and
 *            every write issued in the same tick commits as ONE transaction.
 *   STATIC - the browser's own IndexedDB, seeded from js/seed.js. No server, no
 *            dependencies - this is what the published GitHub Pages demo runs.
 *
 * NOTHING ABOUT THE MODEL IS HARDCODED IN THIS FILE. The table list, primary
 * keys, reference lookups and owned tables are all DERIVED at boot, in order of
 * authority:
 *     1. api/meta   - the live SQLite database, introspected by server.py
 *     2. schema.sql - fetched and parsed (works on GitHub Pages and any http
 *                     server; schema.sql is the canonical contract)
 *     3. window.SEED - last resort for file:// where fetch() is blocked
 * Add a table to schema.sql and both backends pick it up with no code change.
 *
 * Reads always come from the hot in-memory mirror (`mem`), so every consumer -
 * map, facets, insights, forecast, PDFs - is identical in both modes and does
 * not know or care which backend is underneath.
 * ========================================================================== */
(function () {
  'use strict';

  var DB_NAME = 'grassroots_v2';    // v2: stores are keyed on the schema's real
                                    // primary key (country -> iso3), not a synthetic id
  var LEGACY_DB_NAMES = ['grassroots_v1'];
  var STAMP_KEY = 'ddi_seed_stamp'; // localStorage: content stamp of last-seeded data (auto-reseed)
  var API_TIMEOUT = 2500;           // ms to wait for the health probe before falling back to STATIC

  // Where the API lives, and where schema.sql lives - both resolved from THIS
  // script's own URL, not from the page's. The desktop app is served at /, the
  // mobile PWA at /mobile/, and the whole thing may sit under a sub-path such as
  // /platform/; anchoring to js/db.js is the one thing true in all three.
  var ROOT = (function () {
    var src = (document.currentScript && document.currentScript.src) || '';
    var base = src.replace(/[?#].*$/, '').replace(/js\/db\.js$/, '');
    return (base && base !== src) ? base : '';
  })();
  var API = ROOT + 'api/';
  var SCHEMA_URL = ROOT + 'schema.sql';

  // A REFERENCE LIST is a table that carries nothing but identity, a stable
  // code, a display name, ordering and an accountable lead. Derived from the
  // parsed schema - never a list of table names in code.
  var REF_COLS = { id: 1, key: 1, name: 1, seq: 1, lead_id: 1, color: 1 };
  // Generated artefacts (report PDFs) are stored as base64 in a TEXT column.
  // exportSQL skips them by SIZE, not by name: they are artefacts, not
  // relational data, and they make the dump unusable in a terminal.
  var EXPORT_MAX_TEXT = 4096;

  // ---- the model, discovered at init ---------------------------------------
  // tables: { name: { columns:[], pk:'id', fks:[{column,table,to}], lookup:bool, owned:bool } }
  var MODEL = { tables: {}, order: [] };

  // In-memory mirror of every table (array of row objects). NOTE: this object is
  // mutated in place, never reassigned - DB.tables hands out a live reference.
  var mem = {};

  function tableNames() { return MODEL.order; }
  function pkOf(t) { var m = MODEL.tables[t]; return (m && m.pk) || 'id'; }

  // ==========================================================================
  //  Model discovery
  // ==========================================================================

  /** Parse schema.sql into the same shape server.py introspects from SQLite.
   *  A small, deliberate DDL reader: CREATE TABLE bodies scanned by paren depth,
   *  split on top-level commas, each piece read as a column or table constraint. */
  function parseSchema(sql) {
    var text = sql.replace(/--[^\n]*/g, '');          // strip line comments
    var tables = {}, re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([A-Za-z_][\w]*)"?\s*\(/gi, m;
    while ((m = re.exec(text))) {
      var name = m[1], i = re.lastIndex, depth = 1, start = i;
      while (i < text.length && depth > 0) {
        var ch = text.charAt(i);
        if (ch === "'") { i = text.indexOf("'", i + 1); if (i < 0) break; }
        else if (ch === '(') depth++;
        else if (ch === ')') depth--;
        i++;
      }
      tables[name] = readTableBody(name, text.slice(start, i - 1));
      re.lastIndex = i;
    }
    return finishModel(tables);
  }

  function splitTopLevel(body) {
    var parts = [], depth = 0, buf = '';
    for (var i = 0; i < body.length; i++) {
      var ch = body.charAt(i);
      if (ch === "'") { var j = body.indexOf("'", i + 1); if (j < 0) j = body.length; buf += body.slice(i, j + 1); i = j; continue; }
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
      buf += ch;
    }
    if (buf.trim()) parts.push(buf);
    return parts;
  }

  function readTableBody(name, body) {
    var meta = { columns: [], pk: null, fks: [], notnull: [] };
    splitTopLevel(body).forEach(function (piece) {
      var def = piece.trim();
      if (!def) return;
      // table-level constraint, e.g. UNIQUE (project_id, indicator_id)
      if (/^(PRIMARY|UNIQUE|CHECK|FOREIGN|CONSTRAINT)\b/i.test(def)) {
        var tp = def.match(/^PRIMARY\s+KEY\s*\(\s*"?(\w+)"?/i);
        if (tp) meta.pk = tp[1];
        return;
      }
      var col = (def.match(/^"?([A-Za-z_][\w]*)"?/) || [])[1];
      if (!col) return;
      meta.columns.push(col);
      if (/\bPRIMARY\s+KEY\b/i.test(def)) meta.pk = col;
      if (/\bNOT\s+NULL\b/i.test(def)) meta.notnull.push(col);
      var fk = def.match(/REFERENCES\s+"?(\w+)"?\s*\(\s*"?(\w+)"?\s*\)/i);
      if (fk) meta.fks.push({ column: col, table: fk[1], to: fk[2] });
    });
    if (!meta.pk) meta.pk = meta.columns.indexOf('id') >= 0 ? 'id' : meta.columns[0];
    return meta;
  }

  /** Classify tables (lookup / owned) and compute a parent-before-child order.
   *  Both fall out of the schema itself, so neither is ever spelled out here. */
  function finishModel(tables) {
    Object.keys(tables).forEach(function (t) {
      var meta = tables[t];
      meta.lookup = meta.columns.length > 0 && meta.columns.every(function (c) { return REF_COLS[c]; });
      // ROW-LEVEL OWNERSHIP: a table is owned exactly when it records its creator.
      meta.owned = meta.columns.indexOf('created_by') >= 0;
    });
    return { tables: tables, order: topoOrder(tables) };
  }

  function topoOrder(tables) {
    var names = Object.keys(tables).sort(), placed = {}, order = [];
    for (;;) {
      var ready = names.filter(function (t) {
        if (placed[t]) return false;
        return tables[t].fks.every(function (fk) {
          return fk.table === t || !tables[fk.table] || placed[fk.table];
        });
      });
      if (!ready.length) break;
      ready.forEach(function (t) { placed[t] = 1; order.push(t); });
    }
    names.forEach(function (t) { if (!placed[t]) order.push(t); });   // cycle fallback
    return order;
  }

  /** Last-resort model when neither the API nor schema.sql can be fetched
   *  (file://). Shape is inferred from the seed rows themselves. */
  function modelFromSeed(seed) {
    var tables = {};
    Object.keys(seed).forEach(function (t) {
      var cols = {}, rows = seed[t] || [];
      rows.slice(0, 50).forEach(function (r) { Object.keys(r).forEach(function (k) { cols[k] = 1; }); });
      var list = Object.keys(cols);
      tables[t] = { columns: list, pk: cols.id ? 'id' : list[0], fks: [], notnull: [] };
    });
    return finishModel(tables);
  }

  function fetchText(url) {
    if (typeof fetch !== 'function') return Promise.reject(new Error('no fetch'));
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) throw new Error(url + ' -> ' + r.status);
      return r.text();
    });
  }

  function apiFetch(path, opts) {
    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    var o = opts || {};
    if (ctrl) o.signal = ctrl.signal;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, o.timeout || 60000);
    return fetch(API + path, o).then(function (r) {
      clearTimeout(timer);
      return r.json().then(function (body) {
        if (!r.ok || body.ok === false) {
          var err = new Error(body.error || (path + ' -> ' + r.status));
          err.code = body.code; err.status = r.status;
          throw err;
        }
        return body;
      });
    }, function (e) { clearTimeout(timer); throw e; });
  }

  // ==========================================================================
  //  IndexedDB backend (STATIC mode)
  // ==========================================================================

  /** Open the store set, creating any object store the schema declares but the
   *  browser does not have yet. The version is derived, not maintained by hand:
   *  we open at the current version, and only if a store is missing do we
   *  reopen one version higher to create it. */
  function openIDB() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME);
      var settled = false;
      var timer = setTimeout(function () {
        settled = true;
        reject(new Error('IndexedDB open timed out (blocked by another open tab)'));
      }, 4000);
      req.onerror = function () { clearTimeout(timer); reject(req.error); };
      req.onsuccess = function () {
        clearTimeout(timer);
        var db = req.result;
        if (settled) { try { db.close(); } catch (e) {} return; }
        var missing = tableNames().filter(function (t) { return !db.objectStoreNames.contains(t); });
        if (!missing.length) { resolve(db); return; }
        var version = db.version + 1;
        db.close();
        var up = indexedDB.open(DB_NAME, version);
        up.onupgradeneeded = function (e) {
          var d = e.target.result;
          missing.forEach(function (t) {
            if (!d.objectStoreNames.contains(t)) d.createObjectStore(t, { keyPath: pkOf(t) });
          });
        };
        up.onsuccess = function () { resolve(up.result); };
        up.onerror = function () { reject(up.error); };
        up.onblocked = function () { reject(new Error('IndexedDB upgrade blocked by another open tab')); };
      };
    });
  }

  function idbCount(db, table) {
    return new Promise(function (resolve, reject) {
      var r = db.transaction(table, 'readonly').objectStore(table).count();
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function idbAll(db, table) {
    return new Promise(function (resolve, reject) {
      var r = db.transaction(table, 'readonly').objectStore(table).getAll();
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  function idbPut(db, table, rows) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(table, 'readwrite'), st = tx.objectStore(table);
      rows.forEach(function (r) { st.put(clone(r)); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function idbDel(db, table, ids) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(table, 'readwrite'), st = tx.objectStore(table);
      ids.forEach(function (id) { st.delete(id); });
      tx.oncomplete = function () { resolve(); };
      tx.onerror = function () { reject(tx.error); };
    });
  }

  function dropDatabase(name) {
    return new Promise(function (resolve) {
      var del = indexedDB.deleteDatabase(name);
      del.onsuccess = resolve; del.onerror = resolve; del.onblocked = resolve;
      setTimeout(resolve, 3000);     // a wedged tab can swallow every event
    });
  }

  // ==========================================================================
  //  Write queue (LOCAL mode) - same-tick writes commit as one transaction
  // ==========================================================================
  var QUEUE = [];
  var FLUSHING = null;    // the batch currently accepting ops (this tick)
  var TAIL = Promise.resolve();   // the chain that keeps batches in order on the wire

  /** Queue a write and return the promise for the batch it lands in.
   *
   *  Every write issued in the same tick shares one batch, so the app's existing
   *  Promise.all([...]) cascades - "delete this plan and everything under it" -
   *  reach SQLite as a single atomic transaction with deferred foreign keys.
   *  That is strictly safer than the per-store writes IndexedDB was doing. */
  function enqueue(op) {
    QUEUE.push(op);
    if (!FLUSHING) {
      FLUSHING = Promise.resolve().then(function () {
        var ops = QUEUE; QUEUE = []; FLUSHING = null;
        if (!ops.length) return;
        // Batches must reach the server in the order they were made. Without
        // this chain, a batch created while the previous POST is still in
        // flight races it - and "insert then delete" arriving reversed leaves a
        // row behind. Each batch waits for the one before it.
        TAIL = TAIL.then(function () { return postBatch(ops); }, function () { return postBatch(ops); });
        return TAIL;
      }).catch(function (err) {
        DB.lastError = err;
        if (typeof DB.onError === 'function') { try { DB.onError(err); } catch (e) {} }
        throw err;
      });
    }
    return FLUSHING;
  }

  function postBatch(ops) {
    return apiFetch('write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: ops })
    }).then(function (res) {
      if (res.dropped) {
        console.warn('DB: columns not in schema.sql were dropped by the server:', res.dropped);
      }
    }, function (err) {
      // The database refused the write, so memory and disk now disagree.
      // Reload from the database - it is the authority - and tell the app.
      console.error('DB: write rejected -', err.message);
      return DB.resync().then(function () { throw err; });
    });
  }

  function putRows(table, rows) {
    if (DB.mode === 'sqlite') return enqueue({ op: 'put', table: table, rows: rows.map(clone) });
    if (!DB._db) return Promise.resolve();                 // memory-only fallback
    return idbPut(DB._db, table, rows);
  }

  function delRows(table, ids) {
    if (DB.mode === 'sqlite') return enqueue({ op: 'del', table: table, ids: ids.slice() });
    if (!DB._db) return Promise.resolve();
    return idbDel(DB._db, table, ids);
  }

  // ==========================================================================
  //  Public API
  // ==========================================================================
  var DB = {
    tables: mem,
    mode: null,          // 'sqlite' (server) | 'idb' (browser store) | 'memory'
    model: MODEL,        // the discovered model, for anything that needs to reflect
    lastError: null,
    onError: null,       // optional hook: the app can surface rejected writes

    /** Discover the model, pick a backend, hydrate memory. */
    init: function () {
      return DB._loadModel().then(function (source) {
        tableNames().forEach(function (t) { if (!mem[t]) mem[t] = []; });
        return DB.mode === 'sqlite' ? DB._initServer(source) : DB._initBrowser(source);
      });
    },

    /** Resolve the model from the most authoritative source available. */
    _loadModel: function () {
      function adopt(m) {
        MODEL.tables = m.tables; MODEL.order = m.order;
        DB.model = MODEL;
      }
      return apiFetch('meta', { timeout: API_TIMEOUT }).then(function (body) {
        // The live database is the authority when there is one. SQLite reports a
        // composite primary key as a list; this layer keys on a single column.
        Object.keys(body.tables).forEach(function (t) {
          var meta = body.tables[t];
          meta.pk = (Array.isArray(meta.pk) ? meta.pk[0] : meta.pk) ||
                    (meta.columns.indexOf('id') >= 0 ? 'id' : meta.columns[0]);
        });
        adopt(finishModel(body.tables));
        MODEL.order = body.order || MODEL.order;
        DB.mode = 'sqlite';
        return 'api';
      }, function () {
        DB.mode = 'idb';
        return fetchText(SCHEMA_URL).then(function (sql) {
          adopt(parseSchema(sql));
          return 'schema.sql';
        }, function () {
          adopt(modelFromSeed(window.SEED || {}));
          return 'seed';
        });
      });
    },

    /** LOCAL mode: the SQLite database is the single source of truth. There is
     *  no seeding, no stamp and no reset dance here - server.py owns all three,
     *  precisely because this database may hold real work. */
    _initServer: function (source) {
      return apiFetch('all').then(function (body) {
        tableNames().forEach(function (t) { mem[t] = body.tables[t] || []; });
        DB._buildIndexes();
        return { persisted: true, seeded: false, mode: 'sqlite', model: source };
      });
    },

    /** STATIC mode: IndexedDB, seeded from window.SEED.
     *
     *  Auto-reseed: the seed carries a content stamp (window.SEED_STAMP). When it
     *  differs from the stamp we last persisted, the data was regenerated - so we
     *  wipe the persisted store and reseed. That keeps a stable DB_NAME while
     *  still delivering changed demo data to every browser on the next load. */
    _initBrowser: function (source) {
      var seed = window.SEED || {};
      var stamp = window.SEED_STAMP || null;
      var prevStamp = null;
      try { prevStamp = localStorage.getItem(STAMP_KEY); } catch (e) {}
      var stale = !!stamp && prevStamp !== stamp;
      function markStamp() { try { if (stamp) localStorage.setItem(STAMP_KEY, stamp); } catch (e) {} }
      function memoryOnly() {
        tableNames().forEach(function (t) { mem[t] = (seed[t] || []).slice(); });
        DB._buildIndexes(); markStamp(); DB.mode = 'memory';
        return { persisted: false, seeded: true, mode: 'memory', model: source };
      }

      if (!('indexedDB' in window) || indexedDB === null) return Promise.resolve(memoryOnly());

      LEGACY_DB_NAMES.forEach(function (n) { try { indexedDB.deleteDatabase(n); } catch (e) {} });
      var wipe = stale ? dropDatabase(DB_NAME) : Promise.resolve();
      var dbRef, seeded = false;
      return wipe.then(openIDB).then(function (db) {
        dbRef = db; DB._db = db;
        // Seed any EMPTY store (covers first run AND stores added since), then
        // hydrate. ONE STORE AT A TIME: the seed is ~36k rows, and firing 24
        // bulk readwrite transactions at once is enough to make a browser drop
        // the lot and send us to the memory-only fallback.
        return serial(tableNames(), function (t) {
          return idbCount(dbRef, t).then(function (n) {
            if (n > 0) return null;
            seeded = true;
            return idbPut(dbRef, t, (seed[t] || []).map(clone));
          }).then(function () {
            return idbAll(dbRef, t).then(function (rows) { mem[t] = rows; });
          });
        });
      }).then(function () {
        DB._buildIndexes();
        markStamp();
        return { persisted: true, seeded: seeded, mode: 'idb', model: source };
      }).catch(function (err) {
        // Falling back to a memory-only session means nothing the user does will
        // survive a reload - never let that happen quietly.
        console.warn('DB: browser store unavailable, running in memory only -', err && err.message || err);
        return memoryOnly();
      });
    },

    /** Reload every table from the backing store, discarding in-memory state.
     *  Used after a rejected write, so memory can never drift from the database. */
    resync: function () {
      if (DB.mode === 'sqlite') {
        return apiFetch('all').then(function (body) {
          tableNames().forEach(function (t) { mem[t] = body.tables[t] || []; });
          DB._buildIndexes();
        });
      }
      if (DB.mode === 'idb' && DB._db) {
        return Promise.all(tableNames().map(function (t) {
          return idbAll(DB._db, t).then(function (rows) { mem[t] = rows; });
        })).then(function () { DB._buildIndexes(); });
      }
      return Promise.resolve();
    },

    /** Wipe and re-seed. In LOCAL mode the server rebuilds rbm.db from
     *  js/seed.js; in STATIC mode the browser store is dropped and reseeded. */
    reset: function () {
      if (DB.mode === 'sqlite') {
        return apiFetch('reset', { method: 'POST' }).then(function () { return DB.init(); });
      }
      if (DB._db) { try { DB._db.close(); } catch (e) {} DB._db = null; }
      try { localStorage.removeItem(STAMP_KEY); } catch (e) {}
      return dropDatabase(DB_NAME).then(function () { return DB.init(); });
    },

    /** The relationship audit, straight from SQLite (LOCAL mode only). */
    integrity: function () {
      if (DB.mode !== 'sqlite') return Promise.resolve(null);
      return apiFetch('integrity').then(function (b) { return b.report; });
    },

    // ---- writes ------------------------------------------------------------
    _db: null,
    actingUserId: null,   // id of the logged-in user; stamped onto owned rows at insert
    nextId: function (table) {
      var key = pkOf(table), m = 0;
      mem[table].forEach(function (r) { if (+r[key] > m) m = +r[key]; });
      return m + 1;
    },
    /** Insert one or more new rows (auto-assigns sequential keys where missing). */
    insert: function (table, rows) {
      if (!Array.isArray(rows)) rows = [rows];
      var key = pkOf(table);
      var owned = MODEL.tables[table] && MODEL.tables[table].owned;
      var next = DB.nextId(table);
      rows.forEach(function (r) {
        if (r[key] == null) r[key] = next++;
        // ROW-LEVEL OWNERSHIP: stamp the creator (never taken from the caller) so
        // the app can restrict edit/delete to the inserting user. Only tables that
        // declare created_by carry it; a row that already has one keeps it.
        if (owned && r.created_by == null) r.created_by = DB.actingUserId;
        mem[table].push(r);
      });
      DB._buildIndexes();
      // System-generated hierarchy codes - assigned HERE at insert, never taken
      // from the caller, so they cannot be user-edited:
      //   Impact #  ·  Outcome #.#  ·  Output #.#.#  ·  KPI #.#.#.#
      if (table === 'result' || table === 'indicator') {
        // `code` is not part of any index (indexes key on id/parent_id/…), and the
        // index holds references to these same row objects, so stamping in place
        // needs no rebuild.
        rows.forEach(function (r) {
          // secondary (project-local) KPIs are not part of the Output hierarchy -
          // they keep the caller-supplied code (e.g. SEC-…), never a 'KPI #.#.#.#'.
          if (table === 'indicator' && r.secondary) { return; }
          if (table === 'indicator') { r.code = DB._codeForIndicator(r); }
          else if (r.level === 'impact' || r.level === 'outcome' || r.level === 'output') { r.code = DB._codeForResult(r); }
        });
      }
      return putRows(table, rows).then(function () { return rows; });
    },
    /** Hierarchy code for a result row (Impact / Outcome / Output). The ordinal
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
    /** Delete rows by primary key from memory + store. */
    remove: function (table, ids) {
      if (!Array.isArray(ids)) ids = [ids];
      var key = pkOf(table), set = {};
      ids.forEach(function (i) { set[i] = 1; });
      mem[table] = mem[table].filter(function (r) { return !set[r[key]]; });
      DB._buildIndexes();
      return delRows(table, ids);
    },

    // ---- indexes for fast lookup ------------------------------------------
    /** Mark the indexes stale. They are rebuilt on the next read of DB._idx,
     *  not here: every write called this, and a rebuild walks all ~36k rows, so
     *  a loop of 300 inserts used to pay for 300 full rebuilds. Deferring
     *  collapses a burst of writes into one rebuild at the next read, with no
     *  change in what any caller sees. */
    _buildIndexes: function () { _idxCache = null; },
    _rebuildIndexes: function () {
      var idx = {};
      idx.planById = byId(mem.plan, 'id');
      idx.regionById = byId(mem.region, 'id');
      idx.affiliationById = byId(mem.affiliation, 'id');
      // one id-keyed map per REFERENCE LIST - the set of them is derived from the
      // schema (see REF_COLS), so a new lookup table is resolvable the moment it
      // is declared, with no code change here.
      idx.lookup = {};
      tableNames().forEach(function (t) {
        if (MODEL.tables[t] && MODEL.tables[t].lookup) idx.lookup[t] = byId(mem[t], pkOf(t));
      });
      idx.programmeById = byId(mem.programme, 'id');
      idx.resultById = byId(mem.result, 'id');
      idx.indicatorById = byId(mem.indicator, 'id');
      idx.countryByIso = byId(mem.country, 'iso3');
      // lead user id -> the iso3s of the countries they Lead (a Countries-
      // affiliated user's scope is derived from this, not stored on the user)
      idx.countryIsosByLead = {};
      mem.country.forEach(function (c) { if (c.lead_id != null) (idx.countryIsosByLead[c.lead_id] = idx.countryIsosByLead[c.lead_id] || []).push(c.iso3); });
      idx.userById = byId(mem.user, 'id');
      idx.userByUsername = {};
      mem.user.forEach(function (u) { idx.userByUsername[String(u.username).toLowerCase()] = u; });
      idx.measById = byId(mem.measurement, 'id');
      idx.measByIndicator = groupBy(mem.measurement, 'indicator_id');
      idx.resultByProgramme = groupBy(mem.result, 'programme_id');
      idx.indicatorByResult = groupBy(mem.indicator, 'result_id');
      // ---- projects / donors / partners --------------------------------------
      idx.donorById = byId(mem.donor, 'id');
      idx.partnerById = byId(mem.partner, 'id');
      idx.projectById = byId(mem.project, 'id');
      idx.projectByCountry = groupBy(mem.project, 'country_iso3');
      idx.projectByPartner = groupBy(mem.project, 'partner_id');
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
      idx.benTypeById = byId(mem.beneficiary_type, 'id');
      idx.benByMeasurement = groupBy(mem.beneficiary, 'measurement_id');
      return idx;
    },

    // ---- convenience accessors --------------------------------------------
    measurementsFor: function (indicatorId) {
      return (DB._idx.measByIndicator[indicatorId] || []).slice().sort(function (a, b) {
        return (a.date < b.date) ? -1 : (a.date > b.date ? 1 : 0);
      });
    },

    /** Rows of a reference list, in the display order the table declares.
     *  Ordering comes from the data (`seq`), never from a coded list. */
    refList: function (table) {
      return (mem[table] || []).slice().sort(function (a, b) {
        var as = a.seq == null ? 1e9 : a.seq, bs = b.seq == null ? 1e9 : b.seq;
        if (as !== bs) return as - bs;
        return String(a.name || '').localeCompare(String(b.name || ''));
      });
    },

    /** Export the whole database as SQLite-compatible SQL text, in an order that
     *  loads cleanly with foreign keys ON (parents before children). */
    exportSQL: function () {
      var lines = ['PRAGMA foreign_keys=OFF;', 'BEGIN TRANSACTION;'];
      tableNames().forEach(function (t) {
        mem[t].forEach(function (row) {
          var cols = Object.keys(row).filter(function (k) { return !isBlob(row[k]); });
          var vals = cols.map(function (k) { return sqlVal(row[k]); });
          lines.push('INSERT INTO ' + t + ' (' + cols.join(',') + ') VALUES (' + vals.join(',') + ');');
        });
      });
      lines.push('COMMIT;');
      return lines.join('\n');
    }
  };

  // DB._idx is a live view: reading it rebuilds the indexes if a write has
  // invalidated them since the last read. Callers keep using DB._idx.xById
  // exactly as before and always see current data.
  var _idxCache = null;
  Object.defineProperty(DB, '_idx', {
    get: function () {
      if (!_idxCache) _idxCache = DB._rebuildIndexes();
      return _idxCache;
    },
    set: function (v) { _idxCache = v; },
    enumerable: true, configurable: true
  });

  // ---- helpers -------------------------------------------------------------
  /** A generated artefact (a report PDF) rather than relational data: a long
   *  run of base64 with no whitespace or punctuation. Detected by shape, so no
   *  column name is baked into exportSQL - and prose never trips it, because
   *  real text has spaces. */
  function isBlob(v) {
    return typeof v === 'string' && v.length > EXPORT_MAX_TEXT && /^[A-Za-z0-9+/=]+$/.test(v);
  }
  /** Run an async step over a list one at a time (Promise.all, but serial). */
  function serial(items, step) {
    return items.reduce(function (chain, item) {
      return chain.then(function () { return step(item); });
    }, Promise.resolve());
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  // 'Outcome 1.2' -> '1.2', 'Impact 3' -> '3' - strips the leading label word so
  // a child code can be built from its parent's numeric path.
  function stripCodeWord(code) { return String(code == null ? '' : code).replace(/^\s*[A-Za-z]+\s+/, ''); }
  function byId(arr, key) { var m = {}; (arr || []).forEach(function (r) { m[r[key]] = r; }); return m; }
  function groupBy(arr, key) {
    var m = {};
    (arr || []).forEach(function (r) { (m[r[key]] = m[r[key]] || []).push(r); });
    return m;
  }
  function sqlVal(v) {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return String(v);
    return "'" + String(v).replace(/'/g, "''") + "'";
  }

  window.DB = DB;
})();
