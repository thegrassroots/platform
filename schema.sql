-- =============================================================================
--  The Grassroots - Monitoring platform SQLite schema
--  Two waterfalls meet at the KPI:
--    1. RESULTS chain (RBM lineage):  Plan > Impact > Outcome > Output > KPI.
--       A Plan is the top level; results carry a plan_id and the app shows one
--       plan at a time.
--       KPIs (indicators) are attached ONLY to Output-level results; Pillar/Outcome
--       status is rolled up from their outputs. Activities are NOT a level here.
--    2. DELIVERY chain:               Donor > Project > Activity.
--       Each Activity (a `measurement` row) is one logged report of progress
--       against a KPI assigned to the project, and carries Beneficiaries.
--  So a KPI is authored in chain 1 (under an Output) and reported against in
--  chain 2 (an Activity logged by a Project). `sdg` is REPURPOSED to hold the
--  Pillar id (1-4).
--
--  This file is the canonical relational contract. The browser app mirrors it
--  exactly in js/db.js over IndexedDB so it runs with zero external dependencies.
--  DB.exportSQL() emits INSERTs that load into a database created from this DDL
--  (sqlite3 rbm.db < schema.sql, then load the exported INSERTs).
-- =============================================================================

PRAGMA foreign_keys = ON;

-- Plan: the TOP of the results chain (Plan > Impact > Outcome > Output > KPI) ----
-- A multi-year development plan. Results and projects carry a plan_id; one plan is
-- "active" in the app at a time and the whole view is scoped to it. Universal data
-- (country, user, donor, beneficiary_type) is shared across every plan.
CREATE TABLE IF NOT EXISTS plan (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,          -- e.g. 'Development Plan (2026-2030)'
    description TEXT,
    start_date  TEXT,                   -- ISO 8601
    end_date    TEXT,                   -- ISO 8601
    lead_id     INTEGER REFERENCES user(id),  -- accountable Lead, selected from the user list
    seq         INTEGER                 -- display order
);

-- Region reference: the geographic continents, in ONE place ----------------------
-- The six UN M49 continental groupings (the Americas split North/South). Every
-- country associates to exactly one region via a FOREIGN key (country.region_id),
-- so the region taxonomy is defined here once and referenced, never restated.
CREATE TABLE IF NOT EXISTS region (
    id      INTEGER PRIMARY KEY,         -- 1..6
    name    TEXT NOT NULL UNIQUE,        -- Africa | Asia | Europe | North America | South America | Oceania
    lead_id INTEGER REFERENCES user(id), -- accountable Lead, selected from the user list
    seq     INTEGER                      -- display order
);

-- Country reference (centroids come from data/world.js at render time) -----------
-- Holds EVERY country in the world (selectable in drop-downs even with no
-- projects yet), each keyed to a `region` by PRIMARY/FOREIGN key. `region` is a
-- denormalised copy of the region name the app filters on; `region_id` is the
-- authoritative FOREIGN key into `region(id)`.
CREATE TABLE IF NOT EXISTS country (
    iso3      TEXT PRIMARY KEY,          -- e.g. 'KEN'
    name      TEXT NOT NULL,
    region    TEXT,                      -- denormalised region name (mirror of region.name)
    region_id INTEGER REFERENCES region(id),  -- FOREIGN key -> region(id)
    lead_id   INTEGER REFERENCES user(id)     -- accountable Lead, selected from the user list
);

-- Application users. Activities are attributed to the logged-in user, never a
-- typed name. `password` is demo-grade local validation only (browser-only app,
-- no server), NOT real authentication. A user carries two orthogonal fields:
--   section = where they sit (the central Section or a Country Office)
--   status  = permission level (Admin: full control · User: log activities in
--             scope · Viewer: read-only)
CREATE TABLE IF NOT EXISTS user (
    id           INTEGER PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,          -- display name attributed to activities
    email        TEXT,                   -- profile email (report delivery goes here)
    password     TEXT,                   -- demo-grade, stored locally
    section      TEXT CHECK (section IN ('hq','co')),
    status       TEXT CHECK (status IN ('admin','user','viewer')),
    region       TEXT,                   -- country-office scoping (their region)
    country_iso3 TEXT REFERENCES country(iso3),  -- country-office scoping (their country)
    enabled      INTEGER NOT NULL DEFAULT 1,      -- 0 = cannot log in
    created      TEXT
);

-- Programme / portfolio (the organisational grouping; a country programme) -------
CREATE TABLE IF NOT EXISTS programme (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    short_name   TEXT,
    region       TEXT,
    country_iso3 TEXT REFERENCES country(iso3),
    lead_id      INTEGER REFERENCES user(id),  -- accountable Lead, selected from the user list
    budget_usd   REAL,
    start_date   TEXT,                   -- ISO 8601
    end_date     TEXT
);

-- Donor / funding partner (associated with projects) -----------------------------
CREATE TABLE IF NOT EXISTS donor (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    short_name TEXT,
    type       TEXT CHECK (type IN ('Bilateral','Multilateral','Foundation')),
    color      TEXT,                     -- identity colour
    lead_id    INTEGER REFERENCES user(id)  -- accountable Lead, selected from the user list
);

-- Project: a country-scoped, donor-funded initiative carrying a set of KPIs --------
--   PRIMARY KPIs   = existing inventory indicators, linked via project_kpi
--   SECONDARY KPIs = project-local indicators (indicator.secondary = 1, project_id)
CREATE TABLE IF NOT EXISTS project (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER REFERENCES plan(id),  -- the plan this project belongs to
    code         TEXT,                   -- e.g. 'PRJ-KEN-P2-01'
    name         TEXT NOT NULL,
    donor_id     INTEGER REFERENCES donor(id),
    country_iso3 TEXT REFERENCES country(iso3),
    region       TEXT,
    budget_usd   REAL,
    lead_id      INTEGER REFERENCES user(id),  -- accountable Lead, selected from the user list
    start_date   TEXT,                   -- ISO 8601
    end_date     TEXT,
    description  TEXT
);

-- Results framework node (self-referential hierarchy) ---------------------------
CREATE TABLE IF NOT EXISTS result (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER REFERENCES plan(id),  -- the plan this result belongs to
    programme_id INTEGER NOT NULL REFERENCES programme(id),
    parent_id    INTEGER REFERENCES result(id),
    level        TEXT NOT NULL CHECK (level IN ('impact','outcome','output','activity')),  -- 'activity' is LEGACY: activities now live in the delivery chain as `measurement` rows, never as results

    code         TEXT,                   -- SYSTEM-GENERATED hierarchy code (read-only): 'Pillar 3' / 'Outcome 1.2' / 'Output 1.2.1'
    statement    TEXT NOT NULL,          -- past-tense change language
    sdg          INTEGER,                -- REPURPOSED: holds the Pillar id (1-4+)
    owner_id     INTEGER REFERENCES user(id),  -- accountable Lead (impacts, outcomes & outputs); people are referenced by id, shown as "Lead" in the app
    pillar_name  TEXT,                   -- (impact rows only) display name of a custom pillar
    pillar_color TEXT,                   -- (impact rows only) identity colour of a custom pillar
    assumptions  TEXT,
    risks        TEXT,
    risk_level   TEXT CHECK (risk_level IN ('low','medium','high'))
);

-- Performance indicator / KPI (belongs to an Output-level result) ----------------
CREATE TABLE IF NOT EXISTS indicator (
    id                INTEGER PRIMARY KEY,
    result_id         INTEGER REFERENCES result(id),   -- NULL for secondary (project-local) KPIs
    secondary         INTEGER DEFAULT 0,               -- 1 = project-local KPI (not in the Impact→Output framework)
    project_id        INTEGER REFERENCES project(id),  -- owning project (secondary KPIs only)
    code              TEXT,              -- SYSTEM-GENERATED hierarchy code (read-only): 'KPI 1.2.1.1'; secondary KPIs carry a 'SEC-…' code
    name              TEXT NOT NULL,
    type              TEXT CHECK (type IN ('quantitative','qualitative')),
    unit              TEXT,              -- count | % | index | ratio | score | days | USD
    direction         TEXT CHECK (direction IN ('increase','decrease')),  -- is higher better?
    baseline_value    REAL,
    baseline_year     INTEGER,
    baseline_date     TEXT,              -- ISO 8601 exact baseline date
    target_value      REAL,
    target_year       INTEGER,
    target_date       TEXT,              -- ISO 8601 exact target date
    means_of_verification TEXT,          -- data source
    collection_method TEXT,              -- survey | administrative records | platform analytics ...
    frequency         TEXT,              -- annual | semi-annual | quarterly | monthly
    responsible_id    INTEGER REFERENCES user(id),  -- accountable person, referenced by id
    disaggregation    TEXT               -- none | region | sex | age | region, agency ...
);

-- Link table: project -> PRIMARY KPI (an inventory indicator) ---------------------
-- One row per (project, indicator) pair; the app never links the same KPI twice.
CREATE TABLE IF NOT EXISTS project_kpi (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES project(id),
    indicator_id INTEGER NOT NULL REFERENCES indicator(id),
    UNIQUE (project_id, indicator_id)
);

-- ACTIVITY: the leaf of the delivery chain (Donor > Project > Activity) ----------
-- One row = one Activity: a logged report of progress against a KPI, attributed to
-- a project (project_id) and a KPI (indicator_id). For count/number indicators the
-- `value` is the increment logged (current value = baseline + SUM of increments);
-- for %/index/ratio indicators the `value` is the level (current value = latest).
-- Beneficiaries attach here (one Activity reaches a breakdown of people).
CREATE TABLE IF NOT EXISTS measurement (
    id             INTEGER PRIMARY KEY,
    indicator_id   INTEGER NOT NULL REFERENCES indicator(id),
    date           TEXT,                 -- ISO 8601 activity date (the year drives period grouping)
    value          REAL,
    narrative      TEXT,
    reported_by_id INTEGER REFERENCES user(id),  -- the user who logged it (name looked up by id)
    project_id     INTEGER REFERENCES project(id),  -- project this activity is attributed to
    place_name     TEXT,                 -- city / village the activity was logged at (a POINT)
    place_lat      REAL,
    place_lng      REAL
);

-- Beneficiary measure/unit (editable lookup: Men, Women, Children, PWD, …) -------
CREATE TABLE IF NOT EXISTS beneficiary_type (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT,                   -- short admin-editable measure code, e.g. 'PWD', 'IDP'
    description TEXT,                   -- short definition of who this measure counts
    seq         INTEGER                 -- display order
);

-- Beneficiaries of an activity: a count per measure for a given measurement -------
CREATE TABLE IF NOT EXISTS beneficiary (
    id             INTEGER PRIMARY KEY,
    measurement_id INTEGER NOT NULL REFERENCES measurement(id),
    type_id        INTEGER NOT NULL REFERENCES beneficiary_type(id),
    value          REAL
);

-- Monthly results report for a Lead (Communication panel) ------------------------
-- One row = one monthly PDF report for a (category, entity, year, month). The PDF
-- itself is a generated artefact stored base64-encoded in the browser store so a
-- generated report is a fixed snapshot; DB.exportSQL() omits the blob column.
CREATE TABLE IF NOT EXISTS report (
    id        INTEGER PRIMARY KEY,
    category  TEXT NOT NULL CHECK (category IN ('plan','impact','outcome','output','project','donor','region','country')),
    ref       TEXT NOT NULL,             -- entity key, e.g. 'country:KEN' / 'donor:3' / 'outcome:1|<statement>'
    ref_name  TEXT,                      -- entity display name at generation time
    lead_id   INTEGER REFERENCES user(id),  -- the Lead the report is addressed to
    year      INTEGER NOT NULL,
    month     INTEGER NOT NULL,          -- 1..12
    enabled   INTEGER NOT NULL DEFAULT 1,   -- 0 = excluded from batch generate & send
    generated TEXT,                      -- ISO timestamp of last (re)generation
    sent      TEXT,                      -- ISO timestamp of last email send
    summary   TEXT,                      -- one-line content summary (feeds the email's {SUMMARY})
    pdf       TEXT                       -- the report PDF, base64 (browser store only)
);
CREATE INDEX IF NOT EXISTS idx_report_period ON report(year, month);

CREATE INDEX IF NOT EXISTS idx_beneficiary_measure ON beneficiary(measurement_id);
CREATE INDEX IF NOT EXISTS idx_beneficiary_type    ON beneficiary(type_id);
CREATE INDEX IF NOT EXISTS idx_result_plan       ON result(plan_id);
CREATE INDEX IF NOT EXISTS idx_project_plan       ON project(plan_id);
CREATE INDEX IF NOT EXISTS idx_result_programme  ON result(programme_id);
CREATE INDEX IF NOT EXISTS idx_result_parent     ON result(parent_id);
CREATE INDEX IF NOT EXISTS idx_indicator_result  ON indicator(result_id);
CREATE INDEX IF NOT EXISTS idx_indicator_project ON indicator(project_id);
CREATE INDEX IF NOT EXISTS idx_measure_indicator ON measurement(indicator_id);
CREATE INDEX IF NOT EXISTS idx_measure_date      ON measurement(date);
CREATE INDEX IF NOT EXISTS idx_measure_project   ON measurement(project_id);
CREATE INDEX IF NOT EXISTS idx_project_country   ON project(country_iso3);
CREATE INDEX IF NOT EXISTS idx_project_donor     ON project(donor_id);
CREATE INDEX IF NOT EXISTS idx_projkpi_project   ON project_kpi(project_id);
CREATE INDEX IF NOT EXISTS idx_projkpi_indicator ON project_kpi(indicator_id);
CREATE INDEX IF NOT EXISTS idx_country_region    ON country(region_id);
