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
--  This file is the canonical relational contract, and it is READ AT RUNTIME by
--  both halves of the app - nothing about the data model is restated in code:
--    * server.py  introspects the database built from this DDL (table list,
--      columns, primary keys, foreign keys, insert order) - no hardcoded lists.
--    * js/db.js   fetches and parses this file to derive its table list, primary
--      keys, reference lookups and owned tables. Adding a table here is all it
--      takes for both tiers to pick it up.
--  So this file is the ONE place the model is declared. Keep it authoritative.
--
--  Two backends mirror it:
--    * LOCAL   - a real SQLite database (rbm.db) behind server.py; foreign keys
--                are ENFORCED (deferred to COMMIT, so a batch may arrive in any
--                order as long as the committed state is consistent).
--    * STATIC  - IndexedDB in the browser, for the dependency-free GitHub Pages
--                demo. Key relationships are declared here and validated by the
--                client against this same DDL.
--  DB.exportSQL() emits INSERTs that load into a database created from this DDL
--  (sqlite3 rbm.db < schema.sql, then load the exported INSERTs).
--
--  FOREIGN KEY POLICY - every reference declares what happens to it on delete:
--    ON DELETE CASCADE  = composition. The child cannot exist without the parent
--                         (a measurement without its indicator, a beneficiary
--                         without its activity). Deleting the parent removes it.
--    ON DELETE SET NULL = a soft pointer to a person or a lookup. Deleting the
--                         referenced row must never destroy unrelated records,
--                         so the pointer is simply cleared (leads, owners,
--                         created_by, donor/partner/country of a project, …).
--    ON DELETE RESTRICT = a NOT NULL pointer that is not composition. The parent
--                         cannot be deleted while it is still referenced; the
--                         app clears the dependants first (beneficiary.type_id).
-- =============================================================================

PRAGMA foreign_keys = ON;

-- ROW-LEVEL OWNERSHIP ---------------------------------------------------------
-- Every user-editable data table carries `created_by` = the id of the user who
-- INSERTED the row. Edit/delete of an existing row is restricted to its creator;
-- Admins have universal override. Creating new rows still follows the app's
-- role/scope rules. `created_by` is stamped at insert (js/db.js: DB.insert) and
-- never taken as user input. `measurement` is the ONE exception: its existing
-- `reported_by_id` (the user who logged the activity) doubles as its creator/owner,
-- so it gets no separate `created_by`. Reference lookups, region, country, user,
-- programme and affiliation are seed/admin-managed and carry no `created_by`.

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
    lead_id     INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead, from the user list
    created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- OWNER: the user who inserted this row (edit/delete gate)
    seq         INTEGER                 -- display order
);

-- Region reference: the geographic continents, in ONE place ----------------------
-- The six UN M49 continental groupings (the Americas split North/South). Every
-- country associates to exactly one region via a FOREIGN key (country.region_id),
-- so the region taxonomy is defined here once and referenced, never restated.
CREATE TABLE IF NOT EXISTS region (
    id      INTEGER PRIMARY KEY,         -- 1..6
    name    TEXT NOT NULL UNIQUE,        -- Africa | Asia | Europe | North America | South America | Oceania
    color   TEXT,                        -- identity colour (map bubbles, facet dots), like donor.color
    lead_id INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead, from the user list
    seq     INTEGER                      -- display order: the app orders regions by this, never by a coded list
);

-- Country reference (centroids come from data/world.js at render time) -----------
-- Holds EVERY country in the world (selectable in drop-downs even with no
-- projects yet), each keyed to a `region` by PRIMARY/FOREIGN key. `region` is a
-- denormalised copy of the region name the app filters on; `region_id` is the
-- authoritative FOREIGN key into `region(id)`.
CREATE TABLE IF NOT EXISTS country (
    iso3      TEXT PRIMARY KEY,          -- e.g. 'KEN'
    name      TEXT NOT NULL,
    region    TEXT,                      -- DENORMALISED mirror of region.name - a read cache only.
                                         -- region_id is authoritative; server.py's integrity check
                                         -- reports any row where this drifts from region.name.
    region_id INTEGER REFERENCES region(id) ON DELETE SET NULL,  -- FOREIGN key -> region(id)
    lead_id   INTEGER REFERENCES user(id) ON DELETE SET NULL     -- accountable Lead, from the user list
);

-- Affiliation lookup: the categories a user can be affiliated to ----------------
-- One row per lead category (Plans, Impact, Outcome, Output, Projects, Donors,
-- Partners, Regions, Countries). user.affiliation_id references this table, and
-- every Lead dropdown filters to users affiliated to the matching category - e.g.
-- a Donor Lead must come from Donor-affiliated users, a Partner Lead from
-- Partner-affiliated users. `key` is the stable code the app matches on (it equals
-- the report category keys).
CREATE TABLE IF NOT EXISTS affiliation (
    id   INTEGER PRIMARY KEY,
    key  TEXT NOT NULL UNIQUE,           -- plan|impact|outcome|output|project|donor|partner|region|country
    name TEXT NOT NULL,                  -- display name, e.g. 'Donors'
    seq  INTEGER                         -- display order
);

-- Reference lookups: every fixed form list lives in its own table -------------
-- Rows are selected and SAVED BY ID, never by text. `key` is the stable code
-- the application logic switches on (e.g. unit 'count' accumulates activity
-- values; direction 'decrease' means lower is better); `name` is the display
-- label; `seq` orders the dropdown.
CREATE TABLE IF NOT EXISTS unit              (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS frequency         (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS collection_method (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS disaggregation    (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS kpi_type          (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS direction         (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS donor_type        (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS user_status       (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
-- These three were CHECK (col IN ('a','b','c')) enums - a list of values spelled
-- out in the schema and again in the app. They are lists, so they are tables:
-- the rows below are the taxonomy, referenced by key from result and project.
CREATE TABLE IF NOT EXISTS result_level      (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS risk_level        (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS implementation_mode (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);

-- Application users. Activities are attributed to the logged-in user, never a
-- typed name. `password` is demo-grade local validation only (browser-only app,
-- no server), NOT real authentication. A user carries two orthogonal fields:
--   affiliation_id = the category they belong to (FOREIGN key -> affiliation);
--                    Lead dropdowns filter on it. Countries-affiliated users act
--                    as a country office, scoped to the countries they Lead
--                    (DERIVED from country.lead_id - no per-user region/country)
--   status         = permission level (Admin: full control · User: log
--                    activities in scope · Viewer: read-only)
CREATE TABLE IF NOT EXISTS user (
    id           INTEGER PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,          -- display name attributed to activities
    email        TEXT,                   -- profile email (report delivery goes here)
    password     TEXT,                   -- demo-grade, stored locally
    affiliation_id INTEGER REFERENCES affiliation(id) ON DELETE SET NULL,
    status_id    INTEGER REFERENCES user_status(id) ON DELETE SET NULL,  -- permission level, by id
    enabled      INTEGER NOT NULL DEFAULT 1,      -- 0 = cannot log in
    created      TEXT
);

-- Programme / portfolio (the organisational grouping; a country programme) -------
CREATE TABLE IF NOT EXISTS programme (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    short_name   TEXT,
    region       TEXT,
    country_iso3 TEXT REFERENCES country(iso3) ON DELETE SET NULL,
    lead_id      INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead, from the user list
    budget_usd   REAL,
    start_date   TEXT,                   -- ISO 8601
    end_date     TEXT
);

-- Donor / funding partner (associated with projects) -----------------------------
CREATE TABLE IF NOT EXISTS donor (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    short_name TEXT,
    type_id    INTEGER REFERENCES donor_type(id) ON DELETE SET NULL,  -- Bilateral / Multilateral / Foundation, by id
    color      TEXT,                     -- identity colour
    lead_id    INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead, from the user list
    created_by INTEGER REFERENCES user(id) ON DELETE SET NULL   -- OWNER: the user who inserted this row (edit/delete gate)
);

-- Implementing partner: an NGO that delivers projects on behalf of the org -------
-- Distinct from a donor (who FUNDS): a partner IMPLEMENTS on the ground. Each
-- partner carries full contact details and an accountable relationship Lead
-- (selected from the user list, filtered to Partner-affiliated users). A project
-- is either implemented THROUGH a partner (project.partner_id set) or DIRECTLY by
-- the organisation (project.implementation = 'direct', partner_id NULL).
CREATE TABLE IF NOT EXISTS partner (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    acronym  TEXT,                       -- short label, e.g. 'HII'
    address  TEXT,                       -- postal / office address
    phone    TEXT,                       -- contact phone number
    website  TEXT,                       -- organisation website URL
    color    TEXT,                       -- identity colour (map / facet dot)
    lead_id  INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead, from the user list
    created_by INTEGER REFERENCES user(id) ON DELETE SET NULL -- OWNER: the user who inserted this row (edit/delete gate)
);

-- Project: a country-scoped, donor-funded initiative carrying a set of KPIs --------
--   PRIMARY KPIs   = existing inventory indicators, linked via project_kpi
--   SECONDARY KPIs = project-local indicators (indicator.secondary = 1, project_id)
--   DELIVERY       = either 'direct' (by the org) or through an implementing
--                    `partner` (partner_id set, implementation = 'partner').
CREATE TABLE IF NOT EXISTS project (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER REFERENCES plan(id) ON DELETE CASCADE,  -- COMPOSITION: a project belongs to its plan
    code         TEXT,                   -- e.g. 'PRJ-KEN-P2-01'
    name         TEXT NOT NULL,
    donor_id     INTEGER REFERENCES donor(id) ON DELETE SET NULL,
    partner_id   INTEGER REFERENCES partner(id) ON DELETE SET NULL,  -- implementing partner (NULL = delivered directly)
    implementation TEXT REFERENCES implementation_mode(key) ON DELETE RESTRICT,  -- delivery modality
    country_iso3 TEXT REFERENCES country(iso3) ON DELETE SET NULL,
    region       TEXT,                   -- DENORMALISED mirror of the country's region name (read cache;
                                         -- country_iso3 -> country.region_id is authoritative)
    budget_usd   REAL,
    lead_id      INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead, from the user list
    start_date   TEXT,                   -- ISO 8601
    end_date     TEXT,
    description  TEXT,
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL  -- OWNER: the user who inserted this row (edit/delete gate)
);

-- Results framework node (self-referential hierarchy) ---------------------------
CREATE TABLE IF NOT EXISTS result (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER REFERENCES plan(id) ON DELETE CASCADE,       -- COMPOSITION: results belong to their plan
    programme_id INTEGER NOT NULL REFERENCES programme(id) ON DELETE CASCADE,
    parent_id    INTEGER REFERENCES result(id) ON DELETE CASCADE,     -- COMPOSITION: impact -> outcome -> output
    -- the results-chain level, by REFERENCE into the result_level taxonomy
    -- ('activity' is LEGACY: activities now live in the delivery chain as
    -- `measurement` rows, never as results)
    level        TEXT NOT NULL REFERENCES result_level(key) ON DELETE RESTRICT,

    code         TEXT,                   -- SYSTEM-GENERATED hierarchy code (read-only): 'Pillar 3' / 'Outcome 1.2' / 'Output 1.2.1'
    statement    TEXT NOT NULL,          -- past-tense change language
    sdg          INTEGER,                -- REPURPOSED: holds the Pillar id (1-4+)
    owner_id     INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable Lead (impacts, outcomes & outputs); people are referenced by id, shown as "Lead" in the app
    pillar_name  TEXT,                   -- (impact rows only) display name of a custom pillar
    pillar_color TEXT,                   -- (impact rows only) identity colour of a custom pillar
    assumptions  TEXT,
    risks        TEXT,
    risk_level   TEXT REFERENCES risk_level(key) ON DELETE RESTRICT,
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL  -- OWNER: the user who inserted this row (edit/delete gate)
);

-- Performance indicator / KPI (belongs to an Output-level result) ----------------
CREATE TABLE IF NOT EXISTS indicator (
    id                INTEGER PRIMARY KEY,
    result_id         INTEGER REFERENCES result(id) ON DELETE CASCADE,   -- COMPOSITION (NULL for secondary KPIs)
    secondary         INTEGER DEFAULT 0,               -- 1 = project-local KPI (not in the Impact→Output framework)
    project_id        INTEGER REFERENCES project(id) ON DELETE CASCADE,  -- COMPOSITION: owning project (secondary KPIs only)
    code              TEXT,              -- SYSTEM-GENERATED hierarchy code (read-only): 'KPI 1.2.1.1'; secondary KPIs carry a 'SEC-…' code
    name              TEXT NOT NULL,
    type_id           INTEGER REFERENCES kpi_type(id) ON DELETE SET NULL,   -- quantitative / qualitative, by id
    unit_id           INTEGER REFERENCES unit(id) ON DELETE SET NULL,       -- count | % | index | …, by id
    direction_id      INTEGER REFERENCES direction(id) ON DELETE SET NULL,  -- is higher better?, by id
    baseline_value    REAL,
    baseline_year     INTEGER,
    baseline_date     TEXT,              -- ISO 8601 exact baseline date
    target_value      REAL,
    target_year       INTEGER,
    target_date       TEXT,              -- ISO 8601 exact target date
    means_of_verification TEXT,          -- data source (free text)
    collection_method_id INTEGER REFERENCES collection_method(id) ON DELETE SET NULL,
    frequency_id      INTEGER REFERENCES frequency(id) ON DELETE SET NULL,
    responsible_id    INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- accountable person, referenced by id
    disaggregation_id INTEGER REFERENCES disaggregation(id) ON DELETE SET NULL,
    created_by        INTEGER REFERENCES user(id) ON DELETE SET NULL   -- OWNER: the user who inserted this row (edit/delete gate)
);

-- Link table: project -> PRIMARY KPI (an inventory indicator) ---------------------
-- One row per (project, indicator) pair; the app never links the same KPI twice.
CREATE TABLE IF NOT EXISTS project_kpi (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,    -- COMPOSITION
    indicator_id INTEGER NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,  -- COMPOSITION: the link dies with either end
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- OWNER: the user who inserted this row (inherits its project's owner)
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
    indicator_id   INTEGER NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,  -- COMPOSITION
    date           TEXT,                 -- ISO 8601 activity date (the year drives period grouping)
    value          REAL,
    narrative      TEXT,
    reported_by_id INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- the user who logged it (name looked up by id); doubles as OWNER
    project_id     INTEGER REFERENCES project(id) ON DELETE CASCADE,  -- COMPOSITION: activity of a project
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
    created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- OWNER: the user who inserted this row (edit/delete gate)
    seq         INTEGER                 -- display order
);

-- Beneficiaries of an activity: a count per measure for a given measurement -------
CREATE TABLE IF NOT EXISTS beneficiary (
    id             INTEGER PRIMARY KEY,
    measurement_id INTEGER NOT NULL REFERENCES measurement(id) ON DELETE CASCADE,      -- COMPOSITION
    type_id        INTEGER NOT NULL REFERENCES beneficiary_type(id) ON DELETE RESTRICT, -- NOT NULL, not composition:
                                         -- a measure still in use cannot be deleted; the app clears its
                                         -- beneficiary rows first (Control Panel -> Beneficiary Types)
    value          REAL,
    created_by     INTEGER REFERENCES user(id) ON DELETE SET NULL  -- OWNER: inherits the parent activity's author
);

-- Monthly results report for a Lead (Communication panel) ------------------------
-- One row = one monthly PDF report for a (category, entity, year, month). The PDF
-- itself is a generated artefact stored base64-encoded in the browser store so a
-- generated report is a fixed snapshot; DB.exportSQL() omits the blob column.
CREATE TABLE IF NOT EXISTS report (
    id        INTEGER PRIMARY KEY,
    -- category is a REFERENCE into `affiliation`, not a hardcoded enum: the report
    -- categories and the user-affiliation categories are the same taxonomy, so it
    -- is declared once (in `affiliation`) and pointed at from here.
    category  TEXT NOT NULL REFERENCES affiliation(key) ON DELETE RESTRICT,
    ref       TEXT NOT NULL,             -- entity key, e.g. 'country:KEN' / 'donor:3' / 'partner:5' / 'outcome:1|<statement>'
    ref_name  TEXT,                      -- entity display name at generation time
    lead_id   INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- the Lead the report is addressed to
    year      INTEGER NOT NULL,
    month     INTEGER NOT NULL,          -- 1..12
    enabled   INTEGER NOT NULL DEFAULT 1,   -- 0 = excluded from batch generate & send
    generated TEXT,                      -- ISO timestamp of last (re)generation
    sent      TEXT,                      -- ISO timestamp of last email send
    summary   TEXT,                      -- one-line content summary (feeds the email's {SUMMARY})
    created_by INTEGER REFERENCES user(id) ON DELETE SET NULL,  -- OWNER: the user who generated this report (edit/delete gate)
    pdf       TEXT,                      -- the RESULTS report PDF, base64 (store only; omitted by exportSQL)
    pdf_fc    TEXT                       -- the FORECAST report PDF, base64 (store only; omitted by exportSQL)
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
CREATE INDEX IF NOT EXISTS idx_project_partner   ON project(partner_id);
CREATE INDEX IF NOT EXISTS idx_projkpi_project   ON project_kpi(project_id);
CREATE INDEX IF NOT EXISTS idx_projkpi_indicator ON project_kpi(indicator_id);
CREATE INDEX IF NOT EXISTS idx_country_region    ON country(region_id);
