# Attribution

The Grassroots bundles and fetches third-party data, software and fonts. Their licences are
independent of this repository's own terms and continue to apply to the material below.

---

## Map data

### OpenStreetMap — basemap tiles and location search
© OpenStreetMap contributors. Data licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/);
cartography licensed [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/).
<https://www.openstreetmap.org/copyright>

Reaches OpenStreetMap-derived services at runtime in two places:

- the **basemap**, served by CARTO (below);
- the **activity location search**, via the [Photon](https://photon.komoot.io) geocoder
  (`photon.komoot.io`), which indexes OpenStreetMap data.

The ODbL attribution requirement is met in-app: the map carries a visible
"© OpenStreetMap contributors · © CARTO" credit, bottom-right, linking to both
copyright pages. See `ensureBasemap()` in `js/app.js` and the
`.maplibregl-ctrl-attrib` rules in `styles.css` — **please keep it visible.**

### CARTO — basemap style and tile hosting
Basemap styles (*Voyager*, *Dark Matter*) and vector tiles © CARTO, rendered from
OpenStreetMap data. Used under CARTO's basemap terms.
<https://carto.com/attributions> · <https://github.com/CartoDB/basemap-styles>

### Natural Earth — country outlines (`data/world.js`)
Natural Earth 110m Admin-0 vector data, simplified at build time by `tools/proc_world.py`.
Public domain — no attribution required, offered here voluntarily.
<https://www.naturalearthdata.com/about/terms-of-use/>

### GeoNames — settlement gazetteer (`tools/cities.json` → `js/seed.js`)
The `cities1000` export, licensed
[Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).
Sampled at build time by `tools/gen_seed.py` to give demo activities real place names and
coordinates. The raw dump is not committed (see `.gitignore`); re-download it from
<https://download.geonames.org/export/dump/>.
<https://www.geonames.org/about.html>

---

## Software

### MapLibre GL JS 4.7.1 — basemap renderer
Loaded from unpkg in `index.html`. Licensed under the
[3-Clause BSD License](https://github.com/maplibre/maplibre-gl-js/blob/main/LICENSE.txt).
<https://maplibre.org>

---

## Fonts

### Inter
By Rasmus Andersson. Licensed under the
[SIL Open Font License 1.1](https://openfontlicense.org/), which requires this notice to
be retained. Embedded as a base64 `data:` URI in `assets/fonts.css`, so the app loads no
font from the network. (`assets/Inter.woff2` is the same typeface as a standalone file and
is currently unreferenced.)
<https://rsms.me/inter/>

---

## Reference material

### UNDP Handbook on Planning, Monitoring and Evaluating for Development Results (2009)
`references/pme-handbook.pdf`. © United Nations Development Programme. Included as the
methodological reference behind the RBM results-chain data model. All rights remain with
UNDP; it is not covered by this repository's terms.
<https://www.undp.org/publications/handbook-planning-monitoring-and-evaluating-development-results>

---

## A note on the sample data

Every programme, result, indicator, measurement, project, donor, beneficiary and **user
account** in `js/seed.js` is **synthetic**, generated deterministically by
`tools/gen_seed.py`. The people are invented and the figures illustrate the status engine
only — none of it reports on real programmes, funding or beneficiaries. The only real-world
data in the seed is the place names and coordinates from GeoNames.
