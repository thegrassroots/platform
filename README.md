# The Grassroots - keeps track of what changes on the ground

A self-contained, browser-native **Results-Based M&E platform** whose interface mirrors
the *SDG Media Monitor* (map + facets + record list + insights), but whose data model is
the **Results-Based Management (RBM) results chain** from the UNDP *Handbook on Planning,
Monitoring and Evaluating for Development Results* (2009) - the reference in
`references/pme-handbook.pdf`.

> **No build step, no npm, no framework.** Pure vanilla JavaScript + native browser
> APIs, loaded as classic scripts. The only runtime dependency is **MapLibre GL JS**
> (from unpkg), which draws the basemap.

**[▶ Live demo](https://shamoug.github.io/grassroots/)** - sign in with **`demo`** / **`demo`**.
Every seeded user's password is their username. The data is synthetic.

---

## Run it

```
python -m http.server 8777
```

then open <http://localhost:8777>. (This is what `.claude/launch.json` starts.)

An internet connection is needed for the basemap (MapLibre from unpkg, map tiles from
CARTO) and for the activity location search. The rest of the app - the database, the
status engine, every chart - runs entirely in the browser with no server.

---

## What you see (and how it maps to the SDG Monitor)

| SDG Media Monitor        | RBM Monitor equivalent                                            |
|--------------------------|-------------------------------------------------------------------|
| 5,060 **Articles**       | **Indicators** tracked across the portfolio                       |
| Regional Offices          | **Programme portfolio**, grouped by world region (continent) → country |
| Development Goal (SDG)    | **Results by SDG** alignment                                      |
| Map bubbles (size/colour) | Country bubbles - **size = # indicators**, **colour = performance status (RAG)** or **SDG** |
| Article cards            | **Indicator cards** - status dot, latest vs. target, result statement, level/SDG/status badges |
| Most tagged / Latest     | Bubble colour **By Progress / By Performance** (which metric drives the RAG) |
| Insights tab             | KPIs + status donut + SDG / region / results-chain charts + programme league table |
| Ticker                   | Most recently updated indicators                                  |

**Status (RAG)** is always **computed** from the reported results - never picked from a
list. Two complementary metrics are derived per indicator:

- **Progress** = `(current − baseline) / (target − baseline)` - flat achievement of the
  target, ignoring time.
- **Performance** = `Progress ÷ time-elapsed` - achievement *relative to how much of the
  timeframe has passed*. e.g. a 12-month KPI with target 12: at end-June (≈ 0.5 elapsed),
  3 done → 25 % / 50 % = **50 %**; 6 done → 50 % / 50 % = **100 %**.

Because 0 % is the baseline and 100 % is the target, either metric maps to the same RAG bands:
`Over Track` (blue) **> 100 %**, `On Track` (green) **75–100 %**, `At Risk` (amber) **50–74 %**,
`Off Track` (red) **0–49 %**, and `Under Track` (crimson) **< 0 %** - a regression *below the
baseline*; indicators with no measurement yet are `No Data` (grey). The map toggle
**By Progress / By Performance** switches which metric colours the bubbles, legend and facets;
the indicator detail shows both side by side.

---

## Data model - the RBM results framework

The schema follows Table 6 of the handbook (*Results | Indicators | Baseline | Target |
Means of Verification | Risks & Assumptions*) and the results chain
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

### "SQLite" in a dependency-free browser

Browsers have no built-in SQLite engine, and the brief forbids external libraries
(that rules out `sql.js`/WASM). So `js/db.js` implements a **relational store that mirrors
`schema.sql` table-for-table** over **IndexedDB** (a native browser database), with a hot
in-memory copy for fast joins/filters. It is SQLite-*compatible* by construction:

- identical tables, keys and columns to `schema.sql`;
- `DB.exportSQL()` emits `INSERT` statements that load into a database created from
  `schema.sql`, so the data round-trips to `sqlite3` at any time.

Data is seeded on first run and persisted in IndexedDB; `DB.reset()` wipes and re-seeds.

---

## Project layout

```
index.html          App shell (loads classic scripts, no modules → works on file://)
styles.css          Visual system (light/dark, mirrors the SDG Monitor chrome)
schema.sql          Canonical SQLite schema (incl. donor/project/project_kpi + beneficiary_type/beneficiary)
data/world.js       Simplified world map (Natural Earth 110m, → window.WORLD)
js/seed.js          Seeded sample database (→ window.SEED)
js/db.js            IndexedDB relational layer mirroring schema.sql
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
