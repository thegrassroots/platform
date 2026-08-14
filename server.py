#!/usr/bin/env python3
# =============================================================================
#  server.py - The Grassroots: local server + real SQLite database.
#
#  PYTHON STANDARD LIBRARY ONLY. No pip install, no npm, no build step - the
#  same promise the browser app makes. `sqlite3` and `http.server` ship with
#  Python, and Python was already the prerequisite for running this app.
#
#  It does two jobs at once:
#    1. serves this folder statically (exactly what `python -m http.server` did);
#    2. exposes a small JSON API under /api/ backed by a real SQLite file (rbm.db).
#
#  The app detects the API at boot:
#    * API answers  -> LOCAL mode:  reads and writes go to SQLite (this server).
#    * API absent   -> STATIC mode: the browser's own IndexedDB store, seeded
#                      from js/seed.js. This is what GitHub Pages serves, so the
#                      published demo keeps working with no server at all.
#  One codebase, one schema, two backends. See js/db.js for the client half.
#
#  NOTHING ABOUT THE DATA MODEL IS HARDCODED HERE. The table list, the columns,
#  the primary keys, the foreign keys and the safe insert order are all
#  introspected from the database that schema.sql builds. Add a table to
#  schema.sql and this server serves it without a line changing.
#
#  Usage:
#    python server.py                 # serve on 127.0.0.1:8777
#    python server.py --port 8080
#    python server.py --reseed        # rebuild rbm.db from js/seed.js, then serve
#    python server.py --check         # run the integrity audit and exit
# =============================================================================

import argparse
import gzip
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import sys
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.join(ROOT, 'schema.sql')
SEED_PATH = os.path.join(ROOT, 'js', 'seed.js')
API_PREFIX = '/api/'

# Server-owned bookkeeping. Underscore-prefixed so introspection can tell it
# apart from the application model - it is NOT part of schema.sql and is never
# served to the client as data.
META_TABLE = '_meta'

_con = None            # single connection, guarded by _lock
_lock = threading.RLock()
_model = None          # introspected model cache (see introspect())


# ---------------------------------------------------------------------------
#  Connection
# ---------------------------------------------------------------------------
def connect(db_path):
    """Open the database with the pragmas this app needs.

    foreign_keys = ON is the point of moving to SQLite at all: the relationships
    declared in schema.sql are enforced by the engine, not by convention. They
    are DEFERRED per write transaction (see apply_ops), so a batch of related
    changes may arrive in any order as long as the committed state is valid.
    """
    con = sqlite3.connect(db_path, check_same_thread=False)
    con.row_factory = sqlite3.Row
    con.isolation_level = None                    # we manage BEGIN/COMMIT explicitly
    con.execute('PRAGMA journal_mode = WAL')      # concurrent readers + one writer
    con.execute('PRAGMA synchronous = NORMAL')    # durable enough, much faster
    con.execute('PRAGMA foreign_keys = ON')
    return con


# ---------------------------------------------------------------------------
#  Introspection - the model is READ FROM THE DATABASE, never restated
# ---------------------------------------------------------------------------
def introspect(con):
    """Derive the whole data model from the live database.

    Returns {tables: {name: {columns, pk, notnull, fks}}, order: [...]} where
    `order` is a dependency-safe insert order (parents before children)."""
    tables = {}
    rows = con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' "
        "ORDER BY name").fetchall()
    for (name,) in [(r['name'],) for r in rows]:
        info = con.execute('PRAGMA table_info("%s")' % name).fetchall()
        cols = [r['name'] for r in info]
        pk = [r['name'] for r in sorted((r for r in info if r['pk']), key=lambda r: r['pk'])]
        notnull = [r['name'] for r in info if r['notnull'] and r['name'] not in pk]
        fks = []
        for r in con.execute('PRAGMA foreign_key_list("%s")' % name).fetchall():
            fks.append({
                'column': r['from'], 'table': r['table'], 'to': r['to'],
                'on_delete': r['on_delete'], 'on_update': r['on_update'],
            })
        tables[name] = {'columns': cols, 'pk': pk, 'notnull': notnull, 'fks': fks}
    return {'tables': tables, 'order': topo_order(tables)}


def topo_order(tables):
    """Parents before children, so a full reseed never trips a foreign key.

    Self-references (result.parent_id -> result) are ignored: a table cannot
    depend on itself for ordering, and deferred FK checks cover the rest. Any
    genuine cycle falls through in name order - also fine, because writes defer
    their FK checks to COMMIT."""
    deps = {t: {fk['table'] for fk in m['fks'] if fk['table'] != t and fk['table'] in tables}
            for t, m in tables.items()}
    order, placed = [], set()
    while True:
        ready = sorted(t for t in tables if t not in placed and deps[t] <= placed)
        if not ready:
            break
        order.extend(ready)
        placed.update(ready)
    order.extend(sorted(t for t in tables if t not in placed))   # cycle fallback
    return order


def model(con):
    global _model
    if _model is None:
        _model = introspect(con)
    return _model


# ---------------------------------------------------------------------------
#  Seed - js/seed.js is the single source of demo data for BOTH backends
# ---------------------------------------------------------------------------
def read_seed():
    """Parse js/seed.js (the same file the static demo loads) into Python data.

    The file is `window.SEED_STAMP="..."; window.SEED={...}` - a JSON object
    behind a one-line JS prelude, so it reads without a JS engine."""
    with open(SEED_PATH, encoding='utf-8') as fh:
        src = fh.read()
    stamp_m = re.search(r'window\.SEED_STAMP\s*=\s*"([^"]*)"', src)
    seed_m = re.search(r'window\.SEED\s*=\s*', src)
    if not seed_m:
        raise SystemExit('server.py: could not find window.SEED in %s' % SEED_PATH)
    data, _ = json.JSONDecoder().raw_decode(src[seed_m.end():].lstrip())
    return (stamp_m.group(1) if stamp_m else None), data


def ensure_meta(con):
    con.execute('CREATE TABLE IF NOT EXISTS %s (key TEXT PRIMARY KEY, value TEXT)' % META_TABLE)


def meta_get(con, key):
    row = con.execute('SELECT value FROM %s WHERE key=?' % META_TABLE, (key,)).fetchone()
    return row['value'] if row else None


def meta_set(con, key, value):
    con.execute('INSERT INTO %s (key,value) VALUES (?,?) '
                'ON CONFLICT(key) DO UPDATE SET value=excluded.value' % META_TABLE,
                (key, value))


def seed_database(con):
    """Wipe every application table and reload it from js/seed.js.

    Destructive by design - this is what --reseed and /api/reset do. Tables are
    emptied child-first and refilled parent-first, both orders derived from the
    foreign keys, and the whole thing is one transaction with deferred FK checks
    so the database is never observed half-seeded."""
    stamp, data = read_seed()
    m = model(con)
    order = m['order']
    unknown = [t for t in data if t not in m['tables']]
    if unknown:
        print('  ! seed has tables not in schema.sql (skipped): %s' % ', '.join(sorted(unknown)))

    with _lock:
        con.execute('BEGIN')
        con.execute('PRAGMA defer_foreign_keys = ON')
        for t in reversed(order):
            con.execute('DELETE FROM "%s"' % t)
        total = 0
        for t in order:
            rows = data.get(t) or []
            if not rows:
                continue
            n, dropped = insert_rows(con, t, rows, upsert=False)
            total += n
            if dropped:
                print('  ! %s: seed keys not in schema.sql, dropped: %s'
                      % (t, ', '.join(sorted(dropped))))
            print('  seeded %-18s %6d' % (t, n))
        ensure_meta(con)
        meta_set(con, 'seed_stamp', stamp or '')
        con.commit()
    return total


# ---------------------------------------------------------------------------
#  Row <-> SQL, driven entirely by the introspected columns
# ---------------------------------------------------------------------------
def coerce(value):
    """JSON value -> SQLite value. Booleans become 0/1 (SQLite has no boolean);
    anything structural is a schema drift bug and is reported, not silently
    stringified."""
    if isinstance(value, bool):
        return 1 if value else 0
    if value is None or isinstance(value, (int, float, str)):
        return value
    raise ValueError('unsupported value type %s' % type(value).__name__)


def insert_rows(con, table, rows, upsert=True):
    """INSERT (or UPSERT) rows, keeping only columns the table actually has.

    Returns (count, dropped_keys). Unknown keys are reported rather than
    silently accepted, so a drift between the app and schema.sql is visible
    instead of quietly losing data."""
    meta = model(con)['tables'][table]
    cols, pk = meta['columns'], meta['pk']
    colset = set(cols)
    dropped = set()
    batches = {}          # column-tuple -> list of value tuples
    for row in rows:
        keys = [k for k in cols if k in row]          # schema order, stable SQL
        dropped |= (set(row) - colset)
        vals = tuple(coerce(row[k]) for k in keys)
        batches.setdefault(tuple(keys), []).append(vals)

    count = 0
    for keys, values in batches.items():
        quoted = ','.join('"%s"' % k for k in keys)
        holes = ','.join('?' * len(keys))
        sql = 'INSERT INTO "%s" (%s) VALUES (%s)' % (table, quoted, holes)
        if upsert and pk:
            sets = [k for k in keys if k not in pk]
            conflict = ','.join('"%s"' % k for k in pk)
            if sets:
                sql += ' ON CONFLICT(%s) DO UPDATE SET %s' % (
                    conflict, ','.join('"%s"=excluded."%s"' % (k, k) for k in sets))
            else:
                sql += ' ON CONFLICT(%s) DO NOTHING' % conflict
        con.executemany(sql, values)
        count += len(values)
    return count, dropped


def delete_rows(con, table, ids):
    """Delete by primary key. The key column is whatever schema.sql declares -
    `id` for most tables, `iso3` for country - never assumed."""
    meta = model(con)['tables'][table]
    pk = meta['pk'][0] if meta['pk'] else 'id'
    con.executemany('DELETE FROM "%s" WHERE "%s"=?' % (table, pk),
                    [(coerce(i),) for i in ids])
    return len(ids)


def apply_ops(con, ops):
    """Apply a batch of writes as ONE atomic transaction.

    The client batches every write issued in the same tick into a single call,
    so a cascade like "delete a plan and everything under it" either lands whole
    or not at all. defer_foreign_keys moves FK checking to COMMIT, which means
    the ops may arrive in any order - only the final state has to be consistent."""
    applied, dropped = 0, {}
    with _lock:
        con.execute('BEGIN')
        con.execute('PRAGMA defer_foreign_keys = ON')
        current = None
        try:
            for op in ops:
                table = op.get('table')
                if table not in model(con)['tables']:
                    raise ValueError('unknown table %r' % table)
                kind = op.get('op')
                current = '%s %s' % (kind, table)
                if kind == 'put':
                    n, drop = insert_rows(con, table, op.get('rows') or [])
                    if drop:
                        dropped.setdefault(table, sorted(drop))
                    applied += n
                elif kind == 'del':
                    applied += delete_rows(con, table, op.get('ids') or [])
                else:
                    raise ValueError('unknown op %r' % kind)
            # Deferred checks fire HERE, so the failure belongs to the batch as a
            # whole, not to whichever op happened to be last.
            current = 'commit of [%s]' % ', '.join(
                '%s %s' % (o.get('op'), o.get('table')) for o in ops)
            con.commit()
        except Exception as exc:
            con.rollback()
            detail = describe_violation(con, ops) if isinstance(exc, sqlite3.IntegrityError) else ''
            raise type(exc)('%s (while applying %s)%s' % (exc, current, detail))
    return applied, dropped


def describe_violation(con, ops):
    """Say WHICH reference broke. Replays the batch with the checks off, asks
    SQLite what is now dangling, and rolls the whole thing back - so a rejected
    write names the column and the missing parent instead of just 'FOREIGN KEY
    constraint failed'."""
    try:
        con.execute('BEGIN')
        con.execute('PRAGMA defer_foreign_keys = ON')
        for op in ops:
            if op.get('op') == 'put':
                insert_rows(con, op['table'], op.get('rows') or [])
            elif op.get('op') == 'del':
                delete_rows(con, op['table'], op.get('ids') or [])
        seen, bad = set(), []
        for row in con.execute('PRAGMA foreign_key_check').fetchall():
            child, parent, idx = row[0], row[2], row[3]
            fks = model(con)['tables'].get(child, {}).get('fks') or []
            col = fks[idx]['column'] if idx < len(fks) else '?'
            key = (child, col, parent)
            if key in seen:
                continue
            seen.add(key)
            bad.append('%s.%s -> missing %s' % (child, col, parent))
        return ': ' + '; '.join(bad[:5]) if bad else ''
    except Exception:                                             # noqa: BLE001
        return ''
    finally:
        try:
            con.rollback()
        except sqlite3.Error:
            pass


def dump_tables(con):
    """Every application table as {table: [row, ...]}.

    NULL columns are omitted so a row looks exactly like its js/seed.js
    counterpart - the client's in-memory shape is then identical in both
    backends, and nothing downstream has to care which one it came from."""
    out = {}
    for t in model(con)['order']:
        out[t] = [{k: v for k, v in dict(r).items() if v is not None}
                  for r in con.execute('SELECT * FROM "%s"' % t)]
    return out


def counts(con):
    return {t: con.execute('SELECT COUNT(*) AS n FROM "%s"' % t).fetchone()['n']
            for t in model(con)['order']}


# ---------------------------------------------------------------------------
#  Integrity audit
# ---------------------------------------------------------------------------
def integrity(con):
    """Check the relationships actually hold.

    Three passes, all derived from the schema - no table is named in code:
      1. SQLite's own foreign_key_check (every FK, every row);
      2. NOT NULL reference columns that are unexpectedly empty;
      3. denormalised name mirrors that have drifted from the id they mirror.
    """
    m = model(con)
    report = {'foreign_keys': [], 'null_refs': [], 'denormalised': [], 'ok': True}

    for r in con.execute('PRAGMA foreign_key_check').fetchall():
        report['foreign_keys'].append({
            'table': r[0], 'rowid': r[1], 'parent': r[2], 'fk_index': r[3]})

    for t, meta in m['tables'].items():
        fkcols = {fk['column'] for fk in meta['fks']}
        for col in meta['notnull']:
            if col in fkcols:
                n = con.execute('SELECT COUNT(*) FROM "%s" WHERE "%s" IS NULL' % (t, col)).fetchone()[0]
                if n:
                    report['null_refs'].append({'table': t, 'column': col, 'rows': n})

    # Denormalised mirrors: a TEXT column whose name matches a table that the row
    # also references by id. Discovered from the schema, so a new mirror column
    # is audited automatically.
    for t, meta in m['tables'].items():
        for fk in meta['fks']:
            mirror = fk['table']                       # e.g. region_id -> table 'region'
            if mirror in meta['columns'] and mirror != fk['column']:
                sql = ('SELECT COUNT(*) FROM "%s" c JOIN "%s" p ON c."%s" = p."%s" '
                       'WHERE c."%s" IS NOT NULL AND c."%s" <> p."name"'
                       % (t, mirror, fk['column'], fk['to'], mirror, mirror))
                try:
                    n = con.execute(sql).fetchone()[0]
                except sqlite3.Error:
                    continue                            # parent has no `name` column
                if n:
                    report['denormalised'].append(
                        {'table': t, 'column': mirror, 'authority': fk['column'], 'rows': n})

    report['ok'] = not (report['foreign_keys'] or report['null_refs'] or report['denormalised'])
    return report


# ---------------------------------------------------------------------------
#  HTTP
# ---------------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    server_version = 'Grassroots/1.0'

    # The database lives in the folder being served, so a plain static handler
    # would hand out the whole thing on GET /rbm.db - and the repository's .git
    # directory with it. Neither is ever a legitimate request from the app.
    BLOCKED_SUFFIXES = ('.db', '.db-wal', '.db-shm')
    BLOCKED_PARTS = ('.git',)

    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def is_blocked(self, path):
        clean = path.split('?')[0].split('#')[0].lower()
        if clean.endswith(self.BLOCKED_SUFFIXES):
            return True
        return any(part in self.BLOCKED_PARTS for part in clean.split('/'))

    # -- helpers ------------------------------------------------------------
    def send_json(self, payload, status=200):
        body = json.dumps(payload).encode('utf-8')
        headers = [('Content-Type', 'application/json; charset=utf-8')]
        # The full dump is tens of megabytes of JSON; gzip takes it to a few.
        if len(body) > 8192 and 'gzip' in (self.headers.get('Accept-Encoding') or ''):
            body = gzip.compress(body, 6)
            headers.append(('Content-Encoding', 'gzip'))
        self.send_response(status)
        for k, v in headers:
            self.send_header(k, v)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(body)

    def read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode('utf-8'))

    def end_headers(self):
        # Local development: never let the browser hold a stale script. The
        # ?v= cache-busters in index.html still work, this just makes them
        # unnecessary while developing against the server.
        path = self.path.split('?')[0]
        if path.endswith(('.js', '.css', '.html', '/')):
            self.send_header('Cache-Control', 'no-cache, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        if '/api/' in (self.path or '') or self.command != 'GET':
            sys.stderr.write('  %s %s\n' % (self.command, self.path))

    # -- routing ------------------------------------------------------------
    def do_GET(self):
        if self.path.split('?')[0].startswith(API_PREFIX):
            return self.api_get(self.path.split('?')[0][len(API_PREFIX):])
        if self.is_blocked(self.path):
            return self.send_error(403, 'not served')
        return super().do_GET()

    def do_HEAD(self):
        if self.path.split('?')[0].startswith(API_PREFIX):
            return self.api_get(self.path.split('?')[0][len(API_PREFIX):])
        if self.is_blocked(self.path):
            return self.send_error(403, 'not served')
        return super().do_HEAD()

    def do_POST(self):
        path = self.path.split('?')[0]
        if not path.startswith(API_PREFIX):
            return self.send_error(405, 'POST is only accepted under /api/')
        route = path[len(API_PREFIX):]
        try:
            if route == 'write':
                body = self.read_json()
                applied, dropped = apply_ops(_con, body.get('ops') or [])
                payload = {'ok': True, 'applied': applied}
                if dropped:
                    payload['dropped'] = dropped
                return self.send_json(payload)
            if route == 'reset':
                seed_database(_con)
                return self.send_json({'ok': True, 'counts': counts(_con)})
            return self.send_error(404, 'no such endpoint: %s' % route)
        except sqlite3.IntegrityError as exc:
            # A rejected write is the schema doing its job - tell the client
            # precisely what broke so it can resync and surface it.
            return self.send_json({'ok': False, 'code': 'integrity', 'error': str(exc)}, 409)
        except Exception as exc:                                  # noqa: BLE001
            return self.send_json({'ok': False, 'code': 'error', 'error': str(exc)}, 400)

    def api_get(self, route):
        # Reads take the same lock as writes. One connection is shared across
        # request threads, so an unguarded read could land mid-transaction and
        # see rows that are about to be rolled back.
        try:
            if route == 'health':
                with _lock:
                    stamp = meta_get(_con, 'seed_stamp')
                return self.send_json({'ok': True, 'backend': 'sqlite',
                                       'db': os.path.basename(_con_path), 'stamp': stamp})
            if route == 'meta':
                with _lock:
                    m = model(_con)
                    payload = {'ok': True, 'tables': m['tables'], 'order': m['order'],
                               'counts': counts(_con), 'stamp': meta_get(_con, 'seed_stamp')}
                return self.send_json(payload)
            if route == 'all':
                with _lock:
                    payload = {'ok': True, 'stamp': meta_get(_con, 'seed_stamp'),
                               'tables': dump_tables(_con)}
                return self.send_json(payload)
            if route == 'integrity':
                with _lock:
                    report = integrity(_con)
                return self.send_json({'ok': True, 'report': report})
            return self.send_error(404, 'no such endpoint: %s' % route)
        except Exception as exc:                                  # noqa: BLE001
            return self.send_json({'ok': False, 'code': 'error', 'error': str(exc)}, 500)


# ---------------------------------------------------------------------------
#  Bootstrap + CLI
# ---------------------------------------------------------------------------
def bootstrap(db_path, reseed=False, rebuild=False):
    global _con, _con_path, _model
    _con_path = db_path
    if rebuild and os.path.exists(db_path):
        try:
            for suffix in ('', '-wal', '-shm'):
                if os.path.exists(db_path + suffix):
                    os.remove(db_path + suffix)
        except OSError as exc:
            # On Windows the file cannot be removed while another server still
            # holds it. Say which file and what to do - not a traceback.
            raise SystemExit(
                'Cannot rebuild %s: it is open in another process.\n'
                '  %s\n'
                'Stop the other server (close its window) and run --rebuild again.'
                % (os.path.basename(db_path), exc))
        print('Rebuilt: dropped the old %s' % os.path.basename(db_path))
    fresh = not os.path.exists(db_path)
    _con = connect(db_path)
    with open(SCHEMA_PATH, encoding='utf-8') as fh:
        schema_sql = fh.read()
    _con.executescript(schema_sql)         # CREATE TABLE IF NOT EXISTS - idempotent
    _con.execute('PRAGMA foreign_keys = ON')
    ensure_meta(_con)
    _con.commit()
    _model = None                          # re-introspect after any DDL

    # CREATE TABLE IF NOT EXISTS creates tables that are missing - it does NOT
    # alter tables that already exist. So a change to a column or a foreign key
    # in schema.sql is silently ignored on an existing database, and the model
    # the app is told about would not be the one it is running against. Compare
    # a hash of the DDL and say so plainly.
    schema_hash = hashlib.sha1(schema_sql.encode('utf-8')).hexdigest()[:12]
    prior = meta_get(_con, 'schema_hash')
    if fresh or rebuild or not prior:
        meta_set(_con, 'schema_hash', schema_hash)
        _con.commit()
    elif prior != schema_hash:
        print('WARNING: schema.sql has changed since %s was built.' % os.path.basename(db_path))
        print('         New TABLES were added, but changes to EXISTING tables (columns,')
        print('         foreign keys, constraints) are NOT applied to a database that')
        print('         already exists. To rebuild from the current schema (DESTRUCTIVE):')
        print('           python server.py --rebuild')

    if fresh or reseed:
        print('%s %s from js/seed.js' % ('Seeding' if fresh else 'RESEEDING', os.path.basename(db_path)))
        seed_database(_con)
    else:
        # Never auto-reseed an existing database: unlike the browser demo, this
        # file may hold real work. Say so and let the operator decide.
        stamp, _ = read_seed()
        stored = meta_get(_con, 'seed_stamp')
        if stamp and stored and stamp != stored:
            print('NOTE: js/seed.js has changed since %s was seeded.' % os.path.basename(db_path))
            print('      Your data is untouched. To rebuild from the new seed (DESTRUCTIVE):')
            print('        python server.py --reseed')
    return _con


def print_check(con):
    m = model(con)
    fk_total = sum(len(t['fks']) for t in m['tables'].values())
    print('Model: %d tables, %d foreign keys' % (len(m['tables']), fk_total))
    print('Insert order: %s' % ' -> '.join(m['order']))
    print('Rows: %s' % ', '.join('%s=%d' % kv for kv in counts(con).items()))
    rep = integrity(con)
    if rep['ok']:
        print('Integrity: OK - every foreign key resolves, no orphans, no drifted mirrors.')
        return 0
    for v in rep['foreign_keys']:
        print('  FK VIOLATION  %(table)s row %(rowid)s -> %(parent)s' % v)
    for v in rep['null_refs']:
        print('  NULL REQUIRED REF  %(table)s.%(column)s (%(rows)d rows)' % v)
    for v in rep['denormalised']:
        print('  MIRROR DRIFT  %(table)s.%(column)s disagrees with %(authority)s (%(rows)d rows)' % v)
    return 1


def main():
    ap = argparse.ArgumentParser(description='The Grassroots - local server + SQLite database')
    ap.add_argument('--port', type=int, default=8777)
    ap.add_argument('--host', default='127.0.0.1', help='default 127.0.0.1 (local only)')
    ap.add_argument('--db', default=os.path.join(ROOT, 'rbm.db'))
    ap.add_argument('--reseed', action='store_true', help='DESTRUCTIVE: reload every row from js/seed.js')
    ap.add_argument('--rebuild', action='store_true',
                    help='DESTRUCTIVE: delete the database and rebuild it from schema.sql, then seed. '
                         'Needed after changing a column or foreign key on an EXISTING table.')
    ap.add_argument('--check', action='store_true', help='run the integrity audit and exit')
    args = ap.parse_args()

    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('text/css', '.css')
    mimetypes.add_type('application/manifest+json', '.webmanifest')

    con = bootstrap(args.db, reseed=args.reseed, rebuild=args.rebuild)
    if args.check:
        sys.exit(print_check(con))

    m = model(con)
    print('The Grassroots - LOCAL mode (SQLite: %s)' % os.path.basename(args.db))
    print('  %d tables, %d foreign keys, foreign_keys=ON'
          % (len(m['tables']), sum(len(t['fks']) for t in m['tables'].values())))
    print('  http://%s:%d/index.html' % (args.host, args.port))
    print('  Ctrl+C to stop.')
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print('\nstopped.')


_con_path = ''
if __name__ == '__main__':
    main()
