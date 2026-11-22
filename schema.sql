PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS plan (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    start_date  TEXT,
    end_date    TEXT,
    lead_id     INTEGER REFERENCES user(id) ON DELETE SET NULL,
    created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,
    seq         INTEGER
);
CREATE TABLE IF NOT EXISTS region (
    id      INTEGER PRIMARY KEY,
    name    TEXT NOT NULL UNIQUE,
    color   TEXT,
    lead_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
    seq     INTEGER
);
CREATE TABLE IF NOT EXISTS country (
    iso3      TEXT PRIMARY KEY,
    name      TEXT NOT NULL,
    region    TEXT,
    region_id INTEGER REFERENCES region(id) ON DELETE SET NULL,
    lead_id   INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS affiliation (
    id   INTEGER PRIMARY KEY,
    key  TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    seq  INTEGER
);
CREATE TABLE IF NOT EXISTS unit              (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS frequency         (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS collection_method (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS disaggregation    (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS kpi_type          (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS direction         (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS donor_type        (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS user_status       (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS result_level      (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS risk_level        (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS implementation_mode (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS user (
    id           INTEGER PRIMARY KEY,
    username     TEXT NOT NULL UNIQUE,
    name         TEXT NOT NULL,
    email        TEXT,
    password     TEXT,
    affiliation_id INTEGER REFERENCES affiliation(id) ON DELETE SET NULL,
    status_id    INTEGER REFERENCES user_status(id) ON DELETE SET NULL,
    enabled      INTEGER NOT NULL DEFAULT 1,
    created      TEXT
);
CREATE TABLE IF NOT EXISTS programme (
    id           INTEGER PRIMARY KEY,
    name         TEXT NOT NULL,
    short_name   TEXT,
    region       TEXT,
    country_iso3 TEXT REFERENCES country(iso3) ON DELETE SET NULL,
    lead_id      INTEGER REFERENCES user(id) ON DELETE SET NULL,
    budget_usd   REAL,
    start_date   TEXT,
    end_date     TEXT
);
CREATE TABLE IF NOT EXISTS donor (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    short_name TEXT,
    type_id    INTEGER REFERENCES donor_type(id) ON DELETE SET NULL,
    color      TEXT,
    lead_id    INTEGER REFERENCES user(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS partner (
    id       INTEGER PRIMARY KEY,
    name     TEXT NOT NULL,
    acronym  TEXT,
    address  TEXT,
    phone    TEXT,
    website  TEXT,
    color    TEXT,
    lead_id  INTEGER REFERENCES user(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS project (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER REFERENCES plan(id) ON DELETE CASCADE,
    code         TEXT,
    name         TEXT NOT NULL,
    donor_id     INTEGER REFERENCES donor(id) ON DELETE SET NULL,
    partner_id   INTEGER REFERENCES partner(id) ON DELETE SET NULL,
    implementation TEXT REFERENCES implementation_mode(key) ON DELETE RESTRICT,
    country_iso3 TEXT REFERENCES country(iso3) ON DELETE SET NULL,
    region       TEXT,
    budget_usd   REAL,
    lead_id      INTEGER REFERENCES user(id) ON DELETE SET NULL,
    start_date   TEXT,
    end_date     TEXT,
    description  TEXT,
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS result (
    id           INTEGER PRIMARY KEY,
    plan_id      INTEGER REFERENCES plan(id) ON DELETE CASCADE,
    parent_id    INTEGER REFERENCES result(id) ON DELETE CASCADE,
    level        TEXT NOT NULL REFERENCES result_level(key) ON DELETE RESTRICT,
    code         TEXT,
    statement    TEXT NOT NULL,
    sdg          INTEGER,
    owner_id     INTEGER REFERENCES user(id) ON DELETE SET NULL,
    pillar_name  TEXT,
    pillar_color TEXT,
    assumptions  TEXT,
    risks        TEXT,
    risk_level   TEXT REFERENCES risk_level(key) ON DELETE RESTRICT,
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS indicator (
    id                INTEGER PRIMARY KEY,
    result_id         INTEGER REFERENCES result(id) ON DELETE CASCADE,
    secondary         INTEGER DEFAULT 0,
    project_id        INTEGER REFERENCES project(id) ON DELETE CASCADE,
    code              TEXT,
    name              TEXT NOT NULL,
    type_id           INTEGER REFERENCES kpi_type(id) ON DELETE SET NULL,
    unit_id           INTEGER REFERENCES unit(id) ON DELETE SET NULL,
    direction_id      INTEGER REFERENCES direction(id) ON DELETE SET NULL,
    baseline_value    REAL,
    baseline_year     INTEGER,
    baseline_date     TEXT,
    target_value      REAL,
    target_year       INTEGER,
    target_date       TEXT,
    means_of_verification TEXT,
    collection_method_id INTEGER REFERENCES collection_method(id) ON DELETE SET NULL,
    frequency_id      INTEGER REFERENCES frequency(id) ON DELETE SET NULL,
    responsible_id    INTEGER REFERENCES user(id) ON DELETE SET NULL,
    disaggregation_id INTEGER REFERENCES disaggregation(id) ON DELETE SET NULL,
    created_by        INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS project_kpi (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    indicator_id INTEGER NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,
    baseline_value REAL,
    baseline_date  TEXT,
    target_value   REAL,
    target_date    TEXT,
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL,
    UNIQUE (project_id, indicator_id)
);
CREATE TABLE IF NOT EXISTS measurement (
    id             INTEGER PRIMARY KEY,
    indicator_id   INTEGER NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,
    date           TEXT,
    value          REAL,
    narrative      TEXT,
    reported_by_id INTEGER REFERENCES user(id) ON DELETE SET NULL,
    project_id     INTEGER REFERENCES project(id) ON DELETE CASCADE,
    country_iso3   TEXT REFERENCES country(iso3) ON DELETE SET NULL,
    place_name     TEXT,
    place_lat      REAL,
    place_lng      REAL
);
CREATE TABLE IF NOT EXISTS beneficiary_type (
    id          INTEGER PRIMARY KEY,
    name        TEXT NOT NULL,
    code        TEXT,
    description TEXT,
    created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,
    seq         INTEGER
);
CREATE TABLE IF NOT EXISTS beneficiary (
    id             INTEGER PRIMARY KEY,
    measurement_id INTEGER NOT NULL REFERENCES measurement(id) ON DELETE CASCADE,
    type_id        INTEGER NOT NULL REFERENCES beneficiary_type(id) ON DELETE RESTRICT,
    value          REAL,
    created_by     INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS report (
    id        INTEGER PRIMARY KEY,
    category  TEXT NOT NULL REFERENCES affiliation(key) ON DELETE RESTRICT,
    ref       TEXT NOT NULL,
    ref_name  TEXT,
    lead_id   INTEGER REFERENCES user(id) ON DELETE SET NULL,
    year      INTEGER NOT NULL,
    month     INTEGER NOT NULL,
    enabled   INTEGER NOT NULL DEFAULT 1,
    generated TEXT,
    sent      TEXT,
    summary   TEXT,
    created_by INTEGER REFERENCES user(id) ON DELETE SET NULL,
    pdf       TEXT,
    pdf_fc    TEXT
);
CREATE INDEX IF NOT EXISTS idx_report_period ON report(year, month);
CREATE TABLE IF NOT EXISTS evidence_type (id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, seq INTEGER);
CREATE TABLE IF NOT EXISTS evidence (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES project(id) ON DELETE CASCADE,
    indicator_id INTEGER NOT NULL REFERENCES indicator(id) ON DELETE CASCADE,
    type_id      INTEGER REFERENCES evidence_type(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    description  TEXT,
    evidence_date TEXT,
    file_name    TEXT,
    mime_type    TEXT,
    size_bytes   INTEGER,
    url          TEXT,
    uploaded     TEXT,
    created_by   INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_evidence_project   ON evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_evidence_indicator ON evidence(indicator_id);
CREATE TABLE IF NOT EXISTS evidence_file (
    evidence_id  INTEGER PRIMARY KEY REFERENCES evidence(id) ON DELETE CASCADE,
    data         BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS language (
    id          INTEGER PRIMARY KEY,
    key         TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    native_name TEXT,
    direction   TEXT NOT NULL DEFAULT 'ltr',
    is_source   INTEGER NOT NULL DEFAULT 0,
    enabled     INTEGER NOT NULL DEFAULT 1,
    seq         INTEGER,
    created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL
);
CREATE TABLE IF NOT EXISTS phrase (
    id          INTEGER PRIMARY KEY,
    source      TEXT NOT NULL UNIQUE,
    scope       TEXT NOT NULL DEFAULT 'ui',
    table_name  TEXT,
    column_name TEXT,
    seq         INTEGER
);
CREATE INDEX IF NOT EXISTS idx_phrase_scope ON phrase(scope);
CREATE TABLE IF NOT EXISTS translation (
    id          INTEGER PRIMARY KEY,
    phrase_id   INTEGER NOT NULL REFERENCES phrase(id) ON DELETE CASCADE,
    language_id INTEGER NOT NULL REFERENCES language(id) ON DELETE CASCADE,
    text        TEXT,
    auto        INTEGER NOT NULL DEFAULT 1,
    updated     TEXT,
    created_by  INTEGER REFERENCES user(id) ON DELETE SET NULL,
    UNIQUE (phrase_id, language_id)
);
CREATE INDEX IF NOT EXISTS idx_translation_lang ON translation(language_id);
CREATE INDEX IF NOT EXISTS idx_beneficiary_measure ON beneficiary(measurement_id);
CREATE INDEX IF NOT EXISTS idx_beneficiary_type    ON beneficiary(type_id);
CREATE INDEX IF NOT EXISTS idx_result_plan       ON result(plan_id);
CREATE INDEX IF NOT EXISTS idx_project_plan       ON project(plan_id);
CREATE INDEX IF NOT EXISTS idx_result_parent     ON result(parent_id);
CREATE INDEX IF NOT EXISTS idx_indicator_result  ON indicator(result_id);
CREATE INDEX IF NOT EXISTS idx_indicator_project ON indicator(project_id);
CREATE INDEX IF NOT EXISTS idx_measure_indicator ON measurement(indicator_id);
CREATE INDEX IF NOT EXISTS idx_measure_date      ON measurement(date);
CREATE INDEX IF NOT EXISTS idx_measure_project   ON measurement(project_id);
CREATE INDEX IF NOT EXISTS idx_measure_country   ON measurement(country_iso3);
CREATE INDEX IF NOT EXISTS idx_project_country   ON project(country_iso3);
CREATE INDEX IF NOT EXISTS idx_project_donor     ON project(donor_id);
CREATE INDEX IF NOT EXISTS idx_project_partner   ON project(partner_id);
CREATE INDEX IF NOT EXISTS idx_projkpi_project   ON project_kpi(project_id);
CREATE INDEX IF NOT EXISTS idx_projkpi_indicator ON project_kpi(indicator_id);
CREATE INDEX IF NOT EXISTS idx_country_region    ON country(region_id);
