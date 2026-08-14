# The Grassroots - keeps track of what changes on the ground

A self-contained, browser-native **Results-Based M&E platform**: an interactive world map,
faceted filters, a record list and an insights dashboard over the **Results-Based Management
(RBM) results chain**.

> **No build step, no npm, no framework.** Pure vanilla JavaScript + native browser
> APIs, loaded as classic scripts. The only runtime dependency is **MapLibre GL JS**
> (from unpkg), which draws the basemap.

**[▶ Live demo](https://thegrassroots.github.io/platform/)** - sign in with **`demo`** / **`demo`**.
Every seeded user's password is their username. The data is synthetic.

---

## Run it

```
python server.py
```

then open <http://localhost:8777>. `server.py` serves
this folder **and** a real **SQLite** database, `rbm.db`, which it creates and seeds on
first run. Python's standard library is the only requirement - `sqlite3` and
`http.server` ship with Python, so there is still **nothing to install**.

Prefer no server at all? This also works, and is exactly what the published demo runs:

```
python -m http.server 8777
```

An internet connection is needed for the basemap (MapLibre from unpkg, map tiles from
CARTO) and for the activity location search. The status engine and every chart always
run in the browser.

### Two backends, one schema

The app picks its data store at boot by probing for the API, and behaves identically
either way:

| | **LOCAL** (`python server.py`) | **STATIC** (any web host) |
|---|---|---|
| Store | **SQLite** file, `rbm.db` | the browser's own **IndexedDB** |
| Foreign keys | **enforced by the engine** | declared, validated by the audit |
| Writes | batched into one atomic transaction | per-store transactions |
| Shared between browsers | yes - one database on disk | no - per browser, per device |
| Needs a server | yes (Python, stdlib only) | **no** |

**The GitHub Pages snapshot is unaffected by any of this.** With no API to answer the
probe, the app falls back to STATIC mode - the same dependency-free demo as before,
seeded from `js/seed.js`. Publishing is still "push the folder".

Useful commands:

```
python server.py --check     # audit every relationship, print the model, exit
python server.py --reseed    # DESTRUCTIVE: reload every row from js/seed.js
python server.py --rebuild   # DESTRUCTIVE: rebuild rbm.db from schema.sql, then seed
```

Run `--rebuild` after changing a **column or foreign key on an existing table**:
`CREATE TABLE IF NOT EXISTS` adds new tables but never alters existing ones, so the
server hashes `schema.sql` and warns you when the file has moved on without the
database.

---

## What you see

| Surface                   | What it shows                                                     |
|---------------------------|-------------------------------------------------------------------|
| Portfolio panel           | **Programme portfolio**, grouped by world region (continent) → country |
| Map bubbles (size/colour) | Country bubbles - **size = # indicators**, **colour = performance status (RAG)** or **SDG** |
| Indicator cards           | Status dot, latest vs. target, result statement, level/SDG/status badges |
| Bubble colour toggle      | **By Progress / By Performance** - which metric drives the RAG    |
| Insights tab              | KPIs + status donut + SDG / region / results-chain charts + programme league table |
| Forecast tab              | Scenario projections toward targets: best / realistic / worst case, by plan, impact, outcome, output, project, region or country |
| Ticker                    | Most recently updated indicators                                  |

**Status (RAG)** is always **computed** from the reported results - never picked from a
list. Two complementary metrics are derived per indicator:

- **Progress** = `(current − baseline) / (target − baseline)` - flat achievement of the
  target, ignoring time.
- **Performance** = `Progress ÷ time-elapsed` - achievement *relative to how much of the
  timeframe has passed*. e.g. a 12-month KPI with target 12: at end-June (≈ 0.5 elapsed),
  3 done → 25 % / 50 % = **50 %**; 6 done → 50 % / 50 % = **100 %**.

Because 0 % is the baseline and 100 % is the target, **Performance** maps to the RAG bands:
`Over Track` (blue) **> 100 %**, `On Track` (green) **90–100 %**, `At Risk` (amber) **75–90 %**,
`Off Track` (red) **50–75 %**, `Under Track` (crimson) **0–50 %**, and `Back Track` (near-black)
**< 0 %** - a regression *below the baseline*; indicators with no measurement yet are `No Data`
(grey). **Status is always Performance** - Progress cannot tell status; it is shown only for
visibility (bars and %s), and any status badge on a Progress figure borrows the Performance band.

---

## Forecast - making the future present

The **Forecast** tab (header, next to Insights) projects every result toward its target.
It works in *achievement space* - `(current − baseline) / (target − baseline)` - so counts
and levels are comparable and can be averaged. Per KPI the engine derives the recent
monthly velocity (an OLS slope over the last 12 monthly positions) and its volatility
(the std-dev of month-over-month moves); **Realistic** continues at that velocity, while
**Best / Worst** run at velocity ± one volatility, so the uncertainty cone widens with how
erratic delivery has actually been. Projections freeze at each KPI's own target date -
no progress is assumed beyond the plan window.

Pick one of seven lenses - **Plans** (the active plan), **Impacts, Outcomes, Outputs,
Projects, Regions, Countries** - and a horizon (end of plan, +6/12/24 months). Every
active filter applies, so the forecast is always for the slice on screen. The view
answers the senior-management questions directly: forecast achievement at the horizon
with a projected RAG, the scenario range, the date the target is attained at the current
pace, the **required run-rate** (×N of today's pace) to land the target by plan end, and
a prioritised "what to change" panel - acceleration needed, where to concentrate
support, regressing KPIs, quick wins within reach, and stale or missing reporting. Click
any row to focus the trajectory chart and advice on that slice of the portfolio.

---

## Data model - the RBM results framework

The schema follows the standard RBM results-framework table (*Results | Indicators |
Baseline | Target | Means of Verification | Risks & Assumptions*) and the results chain
**Plan → Impact → Outcome → Output → Activity**.

A **Plan** is a multi-year development plan and the top of the results chain: every
`result` (and `project`) carries a `plan_id`, and the app scopes the whole view - map,
facets, list, insights and the framework editor - to one **active plan** at a time.
Switch it from the **Results Framework** panel (left sidebar), or manage plans
(create / edit / delete) in **Control Panel → Results Framework**. Universal reference
data - regions, countries, users, donors and beneficiary types - is shared across every
plan. Two plans ship in the seed: **Development Plan (2021-2025)** (completed) and
**Development Plan (2026-2030)** (current, the default view).

**Regions & countries.** The six geographic continents live once in a **`region`**
table (primary key `id`); every country in the **`country`** table associates to one via
a `region_id` **foreign key** (and keeps the region *name* as a denormalised mirror the
app filters on). The country table holds **every country in the world** - all of them are
selectable in the app's country drop-downs (New Project, Users Management, …) even where
there is no project yet; the 56 country programmes are the subset that run projects.
**Donors** (funding partners) are managed in **Control Panel → Donors** - add / edit /
delete, with the donor's identity colour; a donor still funding projects can't be deleted.

```
plan ─┐
region ──< country ─┐
programme ──< result (plan-scoped; self-referential: impact→outcome→output)
                 └──< indicator (baseline, target, means of verification, frequency, …)
                          └──< measurement (time-series actual values)
```

The canonical definition is `schema.sql` - valid SQLite DDL you can load directly:

```
sqlite3 rbm.db < schema.sql
```

### `schema.sql` is read at runtime, not just at build time

Neither tier keeps its own copy of the model. **The table list, the primary keys, the
foreign keys, which tables are reference lookups and which carry row-level ownership are
all derived from `schema.sql` at boot** - so adding a table there is the whole change:

- **`server.py`** introspects the database it built (`PRAGMA table_info`,
  `foreign_key_list`) and derives a dependency-safe insert order from the foreign keys.
- **`js/db.js`** asks the server for that model (`api/meta`); with no server it *fetches
  and parses `schema.sql` itself*, which is why STATIC mode knows about `country`'s
  `iso3` key and 51 foreign keys without a server. On `file://`, where `fetch` is
  blocked, it infers the shape from the seed rows.

Both routes agree exactly: 27 tables, 51 foreign keys, same primary keys.

**Foreign keys are real in LOCAL mode.** Every reference declares its delete behaviour -
`CASCADE` for composition (an activity's beneficiaries), `SET NULL` for soft pointers
(leads, owners, `created_by`), `RESTRICT` for a NOT NULL pointer that is not composition.
Checks are **deferred to COMMIT** and the client batches every write issued in the same
tick into **one transaction**, so a cascade like "delete this plan and everything under
it" is atomic and order-independent. A rejected write names the broken reference
(`project.donor_id -> missing donor`) and the client re-reads from the database, so
memory can never drift from disk.

In STATIC mode IndexedDB enforces nothing, so the same relationships are validated
instead - `python server.py --check` runs SQLite's `foreign_key_check`, looks for empty
required references, and flags any denormalised name mirror (`country.region`) that has
drifted from the id it mirrors.

`DB.exportSQL()` still emits `INSERT` statements that load into a database created from
`schema.sql`, now in parent-before-child order so they load with foreign keys ON.

---

## Project layout

```
index.html          App shell (loads classic scripts, no modules → works on file://)
styles.css          Visual system (light/dark)
server.py           LOCAL mode: static server + SQLite (rbm.db). Python stdlib only.
schema.sql          Canonical schema, READ AT RUNTIME by both server.py and js/db.js
data/world.js       Simplified world map (Natural Earth 110m, → window.WORLD)
js/seed.js          Seeded sample database (→ window.SEED)
js/db.js            Relational layer: SQLite via server.py, or IndexedDB with no server
js/app.js           UI: SVG map + projection, facets, list, insights, status engine
tools/gen_seed.py   Regenerates js/seed.js (deterministic RBM sample data)
tools/proc_world.py Regenerates data/world.js from a Natural Earth GeoJSON
```

Sample data: **2 plans, 56 country programmes, ~2,970 results, ~3,070 indicators,
~14,500 measurements**, across two four-**Impact** frameworks (2021-2025 and 2026-2030),
each rolled out to every country. Every primary KPI is attached to an **Output**; Impact,
Outcome and Plan status is rolled up from their outputs.

## Projects, donors and activities

On top of the results framework, the platform tracks **Projects** - country-scoped,
donor-funded initiatives. Each project (right-hand pane, as **Project cards**) has a
code, name, budget, **donor**, country, and start/end dates, and carries two kinds of KPIs:

- **Primary KPIs** - drawn from the KPI inventory (existing framework indicators).
- **Secondary KPIs** - project-local KPIs, defined and used within the project only.
  They are structured like primary KPIs and are **aggregated separately *and* together
  with primaries**; a global **Secondary KPIs** toggle (sub bar) excludes them from every
  view when needed.

The **New Project** button (or clicking a project card) opens a four-tab form:
**Project details · Primary KPIs · Secondary KPIs · Activities**. The *Activities* tab lists
the project's logged activities; **＋ Add activity** opens a popup to log a new one. Each
activity is attributed to a project KPI and to a **point** - a real city/village looked up
**live from the OpenStreetMap database** (via the Photon geocoder) with a search-as-you-type
box scoped to the project's country, and pinned to its real coordinates.

### Beneficiaries

Each activity records **who benefits**, broken down by a **beneficiary measure** - Men, Women,
Children, Persons with Disabilities, Refugees, IDPs, and so on. The activity popup has two tabs
(**Activity details** · **Beneficiaries**); the Beneficiaries tab is a table of measure + value,
added/edited through a small popup. The measure list itself is editable in **Control Panel →
Beneficiary Types** (add / rename / delete).

### The map - Google-style basemap + clustered project locations

The map is a **live basemap** (Web-Mercator vector tiles from **CARTO Voyager**, rendered from
OpenStreetMap data via MapLibre GL) styled to look like Google Maps - so as you zoom in you see **streets,
waterways, natural landmarks and place names** (the basemap's own labels; no parallel labelling
layer). On top of it, **project-activity locations** (real settlements) are plotted as markers
that **cluster** by proximity - Google-style **count badges** show how many locations each cluster
holds - sized by count and coloured by rolled-up project status. Markers keep a **constant
on-screen size** at any zoom, and as you **zoom in the clusters diffuse** into their constituent
points. **Clicking a marker lists the projects there** in a popup - for a single location the
popup is titled with the **place name** - each a deep link `#project/<id>`; multi-location
clusters also offer a **Zoom in** control. The left-hand filters (donor, region, status, KPI, …)
drive which project locations the map shows.

> **What reaches the network at runtime:** the MapLibre GL library (unpkg), the basemap
> style and tiles (CARTO, rendered from OpenStreetMap data), and the activity **location
> search** (`photon.komoot.io`, an OpenStreetMap-backed geocoder). Nothing else - there is
> no application backend, and no data leaves the browser. The seed's real settlement
> coordinates come from **GeoNames** (`cities1000`, CC BY 4.0) baked into `js/seed.js` at
> build time via `tools/cities.json`; the app itself ships no gazetteer file.
>
> See [ATTRIBUTION.md](ATTRIBUTION.md) for the full list of third-party data and licences.

## Regenerating data (optional)

```
python tools/gen_seed.py                 # rebuilds js/seed.js (deterministic; reads tools/cities.json)
python tools/proc_world.py               # rebuilds data/world.js from assets/world_raw.geojson
```

`tools/cities.json` is the real-settlement gazetteer (name, type, lat/lng per country) that
`gen_seed.py` samples to place demo activities; it was extracted from the GeoNames
`cities1000` dump (CC BY 4.0).

Every person in the seed is fictional, and the app ships one build - what runs locally is
what is published. The owner account is **`demo` / `demo`**; every other seeded user's
password is likewise their username.
