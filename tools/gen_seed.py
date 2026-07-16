#!/usr/bin/env python3
# Deterministic RBM/M&E seed generator -> js/seed.js
#
# The framework now sits under a PLAN (a multi-year development plan). A Plan is
# the top level of the results chain:
#   Plan > Impact (Pillar) > Outcome > Output > KPI.
# Two plans are seeded:
#   1. Development Plan (2021-2025) - the existing four-pillar framework, re-dated
#      into 2021-2025 so it reads as a completed historical plan.
#   2. Development Plan (2026-2030) - an evolved, forward-looking four-pillar
#      framework for the current period (measurements run Jan-Jul 2026, i.e. only
#      the elapsed part of the plan).
#
# UNIVERSAL data is shared across plans and never duplicated: countries, regions,
# users, donors and beneficiary types. Plan-SCOPED data carries a `plan_id`:
# results (impact/outcome/output) and projects; indicators inherit the plan from
# their result (or their project, for secondary KPIs); measurements inherit it
# from their indicator/project.
#
# The `sdg` field on results is REPURPOSED to hold the Pillar id (1-4), PLAN-SCOPED
# (each plan numbers its pillars 1-4). Every impact row also carries pillar_name /
# pillar_color so the app rebuilds its colour/name lookup from the active plan.
import json, os
from datetime import date

OUT = "js/seed.js"

# ---- tiny deterministic PRNG (mulberry32) -----------------------------------
_state = 0x9E3779B9
def rnd():
    global _state
    _state = (_state + 0x6D2B79F5) & 0xFFFFFFFF
    t = _state
    t = ((t ^ (t >> 15)) * (t | 1)) & 0xFFFFFFFF
    t ^= (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
    return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0
def ri(a, b): return a + int(rnd() * (b - a + 1))
def pick(lst): return lst[int(rnd() * len(lst))]
def chance(p): return rnd() < p
def shuffle(lst):
    for i in range(len(lst) - 1, 0, -1):
        j = int(rnd() * (i + 1)); lst[i], lst[j] = lst[j], lst[i]

TODAY = date(2026, 7, 13)   # the app's "today"

# The owner account. Everyone in the seed is fictional - the repo is public and
# the local app is the same build, so there is no second variant to keep apart.
OWNER = ("demo", "Demo Owner")

# ---- Country teams / offices (iso3, name, region) ------------------------------
# Regions are the six geographic continents (UN M49 continental grouping), with
# the Americas split into North and South. Placement follows the UN M49 geoscheme:
# North Africa (Egypt/Morocco/Tunisia) sits in Africa; the Middle East, Central
# Asia and the Caucasus (Georgia/Armenia = Western Asia) sit in Asia; Mexico,
# Central America and the Caribbean sit in North America.
COUNTRIES = [
 ("KEN","Kenya","Africa"),("ETH","Ethiopia","Africa"),("NGA","Nigeria","Africa"),
 ("GHA","Ghana","Africa"),("UGA","Uganda","Africa"),("TZA","Tanzania","Africa"),
 ("RWA","Rwanda","Africa"),("ZMB","Zambia","Africa"),("MOZ","Mozambique","Africa"),
 ("SEN","Senegal","Africa"),("MWI","Malawi","Africa"),("COD","Dem. Rep. Congo","Africa"),
 ("CIV","Côte d'Ivoire","Africa"),("CMR","Cameroon","Africa"),("ZWE","Zimbabwe","Africa"),
 ("EGY","Egypt","Africa"),("MAR","Morocco","Africa"),("JOR","Jordan","Asia"),
 ("TUN","Tunisia","Africa"),("YEM","Yemen","Asia"),("SDN","Sudan","Africa"),
 ("IRQ","Iraq","Asia"),("LBN","Lebanon","Asia"),
 ("BGD","Bangladesh","Asia"),("NPL","Nepal","Asia"),("PAK","Pakistan","Asia"),
 ("IDN","Indonesia","Asia"),("PHL","Philippines","Asia"),("VNM","Viet Nam","Asia"),
 ("KHM","Cambodia","Asia"),("LKA","Sri Lanka","Asia"),("MMR","Myanmar","Asia"),
 ("PNG","Papua New Guinea","Oceania"),("MNG","Mongolia","Asia"),("LAO","Lao PDR","Asia"),
 ("ALB","Albania","Europe"),("GEO","Georgia","Asia"),("MDA","Moldova","Europe"),
 ("KGZ","Kyrgyzstan","Asia"),("TJK","Tajikistan","Asia"),("UKR","Ukraine","Europe"),
 ("ARM","Armenia","Asia"),("UZB","Uzbekistan","Asia"),("SRB","Serbia","Europe"),
 ("BOL","Bolivia","South America"),("GTM","Guatemala","North America"),
 ("PER","Peru","South America"),("COL","Colombia","South America"),
 ("HTI","Haiti","North America"),("HND","Honduras","North America"),
 ("ECU","Ecuador","South America"),("PRY","Paraguay","South America"),
 ("SLV","El Salvador","North America"),("JAM","Jamaica","North America"),
 ("DOM","Dominican Republic","North America"),("MEX","Mexico","North America"),
]

# ---- Regions (UNIVERSAL reference table; PRIMARY key = id) -------------------
# The six geographic continents (UN M49 continental grouping, Americas split
# North/South). This is the single place the region taxonomy lives; every
# country associates to a region via a FOREIGN key (country.region_id), so the
# region for any country is looked up here rather than restated per country.
REGIONS = [
 (1, "Africa",        1),
 (2, "Asia",          2),
 (3, "Europe",        3),
 (4, "North America", 4),
 (5, "South America", 5),
 (6, "Oceania",       6),
]
regions = [{"id": rid, "name": name, "seq": seq} for (rid, name, seq) in REGIONS]
region_id_by_name = {name: rid for (rid, name, seq) in REGIONS}

# ---- Every OTHER country in the world (reference-only) ----------------------
# The 56 COUNTRIES above run country programmes/projects. WORLD_EXTRA lists every
# remaining country/territory so ALL of the world is selectable in the app's
# country drop-downs, even where there is no project yet. Continent placement
# follows the UN M49 geoscheme (North Africa in Africa; the Middle East, Central
# Asia and the Caucasus in Asia; Central America and the Caribbean in North
# America). None of these iso3 codes overlap the 56 above (asserted below).
WORLD_EXTRA = [
 # --- Africa ---------------------------------------------------------------
 ("DZA","Algeria","Africa"),("AGO","Angola","Africa"),("BEN","Benin","Africa"),
 ("BWA","Botswana","Africa"),("BFA","Burkina Faso","Africa"),("BDI","Burundi","Africa"),
 ("CPV","Cabo Verde","Africa"),("CAF","Central African Rep.","Africa"),("TCD","Chad","Africa"),
 ("COM","Comoros","Africa"),("COG","Congo","Africa"),("DJI","Djibouti","Africa"),
 ("GNQ","Equatorial Guinea","Africa"),("ERI","Eritrea","Africa"),("SWZ","Eswatini","Africa"),
 ("GAB","Gabon","Africa"),("GMB","Gambia","Africa"),("GIN","Guinea","Africa"),
 ("GNB","Guinea-Bissau","Africa"),("LSO","Lesotho","Africa"),("LBR","Liberia","Africa"),
 ("LBY","Libya","Africa"),("MDG","Madagascar","Africa"),("MLI","Mali","Africa"),
 ("MRT","Mauritania","Africa"),("MUS","Mauritius","Africa"),("NAM","Namibia","Africa"),
 ("NER","Niger","Africa"),("STP","Sao Tome and Principe","Africa"),("SYC","Seychelles","Africa"),
 ("SLE","Sierra Leone","Africa"),("SOM","Somalia","Africa"),("ZAF","South Africa","Africa"),
 ("SSD","South Sudan","Africa"),("TGO","Togo","Africa"),("ESH","Western Sahara","Africa"),
 ("MYT","Mayotte","Africa"),("REU","Réunion","Africa"),("SHN","Saint Helena","Africa"),
 # --- Asia -----------------------------------------------------------------
 ("AFG","Afghanistan","Asia"),("AZE","Azerbaijan","Asia"),("BHR","Bahrain","Asia"),
 ("BTN","Bhutan","Asia"),("BRN","Brunei","Asia"),("CHN","China","Asia"),
 ("CYP","Cyprus","Asia"),("IND","India","Asia"),("IRN","Iran","Asia"),
 ("ISR","Israel","Asia"),("JPN","Japan","Asia"),("KAZ","Kazakhstan","Asia"),
 ("KWT","Kuwait","Asia"),("MYS","Malaysia","Asia"),("MDV","Maldives","Asia"),
 ("PRK","North Korea","Asia"),("OMN","Oman","Asia"),("PSE","Palestine","Asia"),
 ("QAT","Qatar","Asia"),("SAU","Saudi Arabia","Asia"),("SGP","Singapore","Asia"),
 ("KOR","South Korea","Asia"),("SYR","Syria","Asia"),("TWN","Taiwan","Asia"),
 ("THA","Thailand","Asia"),("TLS","Timor-Leste","Asia"),("TUR","Turkey","Asia"),
 ("TKM","Turkmenistan","Asia"),("ARE","United Arab Emirates","Asia"),
 ("HKG","Hong Kong","Asia"),("MAC","Macao","Asia"),
 # --- Europe ---------------------------------------------------------------
 ("AND","Andorra","Europe"),("AUT","Austria","Europe"),("BLR","Belarus","Europe"),
 ("BEL","Belgium","Europe"),("BIH","Bosnia and Herz.","Europe"),("BGR","Bulgaria","Europe"),
 ("HRV","Croatia","Europe"),("CZE","Czechia","Europe"),("DNK","Denmark","Europe"),
 ("EST","Estonia","Europe"),("FIN","Finland","Europe"),("FRA","France","Europe"),
 ("DEU","Germany","Europe"),("GRC","Greece","Europe"),("HUN","Hungary","Europe"),
 ("ISL","Iceland","Europe"),("IRL","Ireland","Europe"),("ITA","Italy","Europe"),
 ("XKX","Kosovo","Europe"),("LVA","Latvia","Europe"),("LIE","Liechtenstein","Europe"),
 ("LTU","Lithuania","Europe"),("LUX","Luxembourg","Europe"),("MLT","Malta","Europe"),
 ("MCO","Monaco","Europe"),("MNE","Montenegro","Europe"),("NLD","Netherlands","Europe"),
 ("MKD","North Macedonia","Europe"),("NOR","Norway","Europe"),("POL","Poland","Europe"),
 ("PRT","Portugal","Europe"),("ROU","Romania","Europe"),("RUS","Russia","Europe"),
 ("SMR","San Marino","Europe"),("SVK","Slovakia","Europe"),("SVN","Slovenia","Europe"),
 ("ESP","Spain","Europe"),("SWE","Sweden","Europe"),("CHE","Switzerland","Europe"),
 ("GBR","United Kingdom","Europe"),("VAT","Holy See","Europe"),
 ("FRO","Faroe Islands","Europe"),("GIB","Gibraltar","Europe"),("IMN","Isle of Man","Europe"),
 ("JEY","Jersey","Europe"),("GGY","Guernsey","Europe"),("ALA","Åland Islands","Europe"),
 # --- North America (incl. Central America + Caribbean) --------------------
 ("CAN","Canada","North America"),("USA","United States","North America"),
 ("BMU","Bermuda","North America"),("GRL","Greenland","North America"),
 ("SPM","St. Pierre and Miquelon","North America"),("BLZ","Belize","North America"),
 ("CRI","Costa Rica","North America"),("NIC","Nicaragua","North America"),
 ("PAN","Panama","North America"),("ATG","Antigua and Barb.","North America"),
 ("BHS","Bahamas","North America"),("BRB","Barbados","North America"),
 ("CUB","Cuba","North America"),("DMA","Dominica","North America"),
 ("GRD","Grenada","North America"),("KNA","St. Kitts and Nevis","North America"),
 ("LCA","Saint Lucia","North America"),("VCT","St. Vin. and Gren.","North America"),
 ("TTO","Trinidad and Tobago","North America"),("PRI","Puerto Rico","North America"),
 ("AIA","Anguilla","North America"),("ABW","Aruba","North America"),
 ("VGB","British Virgin Is.","North America"),("VIR","U.S. Virgin Is.","North America"),
 ("CYM","Cayman Is.","North America"),("CUW","Curaçao","North America"),
 ("MTQ","Martinique","North America"),("GLP","Guadeloupe","North America"),
 ("MSR","Montserrat","North America"),("TCA","Turks and Caicos Is.","North America"),
 ("SXM","Sint Maarten","North America"),("BLM","Saint-Barthélemy","North America"),
 ("MAF","Saint-Martin","North America"),("BES","Bonaire","North America"),
 # --- South America --------------------------------------------------------
 ("ARG","Argentina","South America"),("BRA","Brazil","South America"),
 ("CHL","Chile","South America"),("GUY","Guyana","South America"),
 ("SUR","Suriname","South America"),("URY","Uruguay","South America"),
 ("VEN","Venezuela","South America"),("GUF","French Guiana","South America"),
 ("FLK","Falkland Is.","South America"),
 # --- Oceania --------------------------------------------------------------
 ("AUS","Australia","Oceania"),("NZL","New Zealand","Oceania"),("FJI","Fiji","Oceania"),
 ("SLB","Solomon Is.","Oceania"),("VUT","Vanuatu","Oceania"),("NCL","New Caledonia","Oceania"),
 ("PYF","French Polynesia","Oceania"),("WSM","Samoa","Oceania"),("TON","Tonga","Oceania"),
 ("KIR","Kiribati","Oceania"),("FSM","Micronesia","Oceania"),("MHL","Marshall Is.","Oceania"),
 ("PLW","Palau","Oceania"),("NRU","Nauru","Oceania"),("TUV","Tuvalu","Oceania"),
 ("COK","Cook Is.","Oceania"),("NIU","Niue","Oceania"),("GUM","Guam","Oceania"),
 ("ASM","American Samoa","Oceania"),("MNP","Northern Mariana Is.","Oceania"),
 ("WLF","Wallis and Futuna","Oceania"),
]

# Sanity: no iso3 appears twice, and every region name resolves to a region id.
_seen_iso = set()
for _iso, _nm, _rg in COUNTRIES + WORLD_EXTRA:
    assert _iso not in _seen_iso, f"duplicate iso3 {_iso}"
    _seen_iso.add(_iso)
    assert _rg in region_id_by_name, f"unknown region {_rg!r} for {_iso}"

# Country-office leads (country-team level)
LEADS = ["A. Mwangi","S. Rahman","T. Eriksson","M. Okonkwo","L. Petrova","J. Alvarez",
 "N. Haile","R. Santos","F. Ndiaye","P. Gurung","K. Nasser","E. Bryant","C. Dlamini","H. Tran"]

# ---- Place seeding: REAL settlements per country ----------------------------
# tools/cities.json holds real cities/towns per country (name, type, lat, lng),
# extracted from the GeoNames cities1000 dataset (CC BY 4.0). The demo/historical
# activities are logged at these real settlements so the map shows real points on
# first load. Interactive activity logging in the app searches OpenStreetMap live.
def build_places():
    path = os.path.join(os.path.dirname(__file__), "cities.json")
    data = json.load(open(path, encoding="utf-8"))
    for iso, cname, region in COUNTRIES:
        data.setdefault(iso, [])
    return data

PLACES = build_places()

# Shared pillar identity colours (reused per plan - only one plan shows at a time).
PILLAR_PALETTE = {1:"#4FA9E8", 2:"#33C2B4", 3:"#9D7BEE", 4:"#F5A04D"}

# =============================================================================
#  FRAMEWORK 1 - Development Plan (2021-2025)   [the existing four pillars]
# =============================================================================
# each pillar: pillar(id), tag(short), impact(statement),
#   outcomes[ (outcome_stmt, outputs[ (output_stmt, owner, kpis[]) ]) ]
# each KPI = (name, type, unit, direction, baseline, target, means_of_verification)
PILLARS_2021 = [
{
 "pillar":1,"tag":"Data Governance & Quality",
 "impact":"Programmes plan and report on the basis of trusted, high-quality, interoperable data.",
 "outcomes":[
  ("Data governance frameworks and standards are adopted across the organisation.",
    [("Data and dashboards policy issued and applied across regions.","Priya Raman",
        [("Number of regions applying the data and dashboards policy","quantitative","count","increase",0,5,
            "Policy document; regional confirmations"),
         ("Number of regions with adopted data governance standards","quantitative","count","increase",0,5,
            "Regional governance adoption records")]),
     ("Minimum shared dataset standard for interoperability defined and endorsed.","Elena Duarte",
        [("Share of country teams reporting against the minimum dataset standard","quantitative","%","increase",0,70,
            "Steering group record; reporting-system extracts"),
         ("Share of the organisation reporting on trusted, interoperable data","quantitative","%","increase",45,90,
            "Interoperability audit")]),
     ("Data protection focal point function operational under the data protection office.","Priya Raman",
        [("Share of data protection requests processed within agreed procedures","quantitative","%","increase",0,100,
            "Focal point log")])]),
  ("Leadership and mandated reporting are served by timely, quality data and analytics.",
    [("Executive and mandated data reporting delivered on schedule.","Priya Raman",
        [("Share of mandated reporting cycles delivered on time","quantitative","%","increase",90,100,
            "Reporting calendar and submission records"),
         ("Composite data quality index across mandated reporting","quantitative","index","increase",2.4,4.5,
            "Data quality assessment across mandated reporting")]),
     ("Country-team profiles and scorecards maintained and current.","Elena Duarte",
        [("Share of country-team profiles and scorecards updated within 30 days","quantitative","%","increase",75,95,
            "Reporting-system and platform audit"),
         ("Share of leadership data requests served within service standards","quantitative","%","increase",70,95,
            "Service desk / request tracker records")])]),
 ],
},
{
 "pillar":2,"tag":"Digital Platforms & Services",
 "impact":"Country teams use reliable, integrated platforms that lighten the reporting burden and increase efficiency.",
 "outcomes":[
  ("The Programme Portal functions as the trusted digital backbone of the organisation.",
    [("Programme Portal maintained and enhanced with partner engagement strengthened.","Marco Ruiz",
        [("Increase in active partner users on the Programme Portal","quantitative","%","increase",0,40,
            "Platform analytics"),
         ("Reduction in reporting burden reported by country offices (index, baseline=100)","quantitative","index","decrease",100,60,
            "Country-office reporting burden survey")]),
     ("Country-level dashboard guidance issued and dashboards rolled out on demand.","Nadia Haddad",
        [("Number of country teams with a live country dashboard","quantitative","count","increase",0,60,
            "Guidance note; dashboard registry")])]),
  ("Proven field solutions are matured and reused across the organisation through the Solutions Lab.",
    [("Field-generated solutions curated, matured, and made reusable by the Solutions Lab.","Nadia Haddad",
        [("Number of proven solutions matured and reused by 3+ country teams","quantitative","count","increase",0,12,
            "Lab solution registry")]),
     ("Delivery partner team aligned to priorities with stable delivery capacity.","Marco Ruiz",
        [("Share of sprint commitments delivered per release cycle","quantitative","%","increase",0,90,
            "Sprint and release reports"),
         ("Platform availability across the organisation","quantitative","%","increase",99,99.7,
            "Platform uptime monitoring")])]),
 ],
},
{
 "pillar":3,"tag":"Innovation & Emerging Technology",
 "impact":"The organisation adopts emerging technologies responsibly, with governance in place and value demonstrated in the field.",
 "outcomes":[
  ("Responsible AI governance and quality assurance are in place across the organisation.",
    [("AI Governance and QA Framework launched and applied to AI tools.","Nadia Haddad",
        [("Share of AI tools assessed under the framework","quantitative","%","increase",0,100,
            "Framework document; assessment log")]),
     ("Design intelligence service cleared, trained, and rolled out to country offices.","Nadia Haddad",
        [("Number of country offices onboarded to the design intelligence service","quantitative","count","increase",0,90,
            "OICT record; training and onboarding log")])]),
  ("AI capabilities are embedded in workflows and demonstrably reduce workload.",
    [("AI assistant enablement programme delivered across country offices.","Nadia Haddad",
        [("Share of licensed AI assistant users active monthly","quantitative","%","increase",0,75,
            "Licence and usage reports")]),
     ("Field AI use cases assessed, and high-value cases scaled.","Nadia Haddad",
        [("Number of field AI use cases scaled to 3+ country teams","quantitative","count","increase",0,8,
            "AI use case registry"),
         ("Number of AI use cases delivering measurable field value","quantitative","count","increase",0,40,
            "AI use case registry - value assessment")])]),
 ],
},
{
 "pillar":4,"tag":"Capacity & Partnerships",
 "impact":"Staff have the skills, peer networks, and partnerships to sustain capacity and delivery in the field.",
 "outcomes":[
  ("Learning is delivered at scale through regional, cohort, and peer-based formats.",
    [("Learning sessions delivered in regional and peer formats.","Ingrid Lindqvist",
        [("Number of learning sessions delivered","quantitative","count","increase",0,20,
            "Session records; feedback surveys"),
         ("Share of staff with core delivery capacity","quantitative","%","increase",40,75,
            "Capacity self-assessment; HR records"),
         ("Participant satisfaction with learning","quantitative","%","increase",78,88,
            "Post-session feedback surveys")]),
     ("Digital capability training programme designed for launch when resourced.","Ingrid Lindqvist",
        [("Capability programme design and launch-readiness level (1-5)","qualitative","index","increase",1,5,
            "Programme document; Steering group decision")])]),
  ("Partnerships extend capacity and bring expertise to the field.",
    [("Partnerships with academia, volunteer networks, and training institutes active and delivering.","Ingrid Lindqvist",
        [("Number of active partnership agreements with joint deliverables","quantitative","count","increase",0,5,
            "Partnership agreements; joint deliverables")]),
     ("Volunteer pipeline of digital experts deploying to the field.","Ingrid Lindqvist",
        [("Number of digital experts deployed to country offices","quantitative","count","increase",0,15,
            "Volunteer deployment records")])]),
 ],
},
]

# =============================================================================
#  FRAMEWORK 2 - Development Plan (2026-2030)   [evolved, forward-looking]
# =============================================================================
# A plausible continuation of the 2021-2025 plan: from governance to foresight,
# from integrated platforms to one unified ecosystem, from AI adoption to AI at
# scale, and from learning delivery to sustained capability. Baselines reflect
# roughly where the first plan left off; targets are 2030 ambitions.
PILLARS_2026 = [
{
 "pillar":1,"tag":"Predictive Data & Foresight",
 "impact":"The organisation anticipates needs through predictive, real-time, and shared data foresight.",
 "outcomes":[
  ("Real-time data pipelines and predictive analytics are institutionalised across the organisation.",
    [("Federated real-time data pipelines operating across all regions.","Priya Raman",
        [("Number of regions operating federated real-time data pipelines","quantitative","count","increase",1,5,
            "Data platform telemetry; regional confirmations"),
         ("Share of core datasets refreshed in near real time","quantitative","%","increase",20,90,
            "Pipeline monitoring dashboard")]),
     ("Predictive analytics service delivers forward-looking indicators to leadership.","Elena Duarte",
        [("Number of predictive indicators in regular leadership use","quantitative","count","increase",0,25,
            "Analytics service catalogue"),
         ("Forecast accuracy of the predictive analytics service","quantitative","%","increase",55,85,
            "Backtesting and validation reports")])]),
  ("Shared foresight shapes organisational planning.",
    [("System-wide foresight briefs produced and used in planning cycles.","Priya Raman",
        [("Share of country teams using foresight briefs in planning","quantitative","%","increase",0,70,
            "Planning cycle records"),
         ("Number of foresight briefs published per year","quantitative","count","increase",2,24,
            "Foresight briefs registry")])]),
 ],
},
{
 "pillar":2,"tag":"Integrated Digital Ecosystem",
 "impact":"Country teams operate on one interoperable digital ecosystem with shared identity and services.",
 "outcomes":[
  ("A unified platform ecosystem replaces fragmented tools across the organisation.",
    [("Single sign-on and a shared service layer are adopted across platforms.","Marco Ruiz",
        [("Share of platforms behind single sign-on","quantitative","%","increase",30,100,
            "Identity platform records"),
         ("Reduction in duplicate data entry across platforms (index, baseline=100)","quantitative","index","decrease",100,45,
            "Process audit")]),
     ("Country dashboards converge onto the shared ecosystem.","Nadia Haddad",
        [("Number of country teams on the converged dashboard stack","quantitative","count","increase",12,80,
            "Dashboard registry")])]),
  ("The ecosystem is resilient, open, and continuously delivered.",
    [("Open APIs and continuous delivery sustain the ecosystem.","Marco Ruiz",
        [("Number of published open APIs reused across the system","quantitative","count","increase",4,40,
            "API gateway registry"),
         ("Ecosystem availability across the organisation","quantitative","%","increase",99.5,99.9,
            "Uptime monitoring")])]),
 ],
},
{
 "pillar":3,"tag":"Applied AI at Scale",
 "impact":"Trusted AI is embedded at scale, with automated workflows delivering measurable value under strong governance.",
 "outcomes":[
  ("Governed AI is deployed at scale across organisational workflows.",
    [("Enterprise AI assistants are deployed to all country offices under the governance framework.","Nadia Haddad",
        [("Share of country offices with a governed AI assistant in daily use","quantitative","%","increase",10,95,
            "Usage analytics; governance log"),
         ("Share of AI systems passing the responsible-AI assurance review","quantitative","%","increase",60,100,
            "Assurance review records")]),
     ("Agentic workflows automate routine reporting and coordination tasks.","Nadia Haddad",
        [("Number of agentic workflows in production across the system","quantitative","count","increase",0,30,
            "Automation registry")])]),
  ("AI delivers measurable, evaluated value in the field.",
    [("Field AI use cases are evaluated and scaled where value is proven.","Nadia Haddad",
        [("Number of AI use cases delivering evaluated field value","quantitative","count","increase",8,60,
            "Use case registry - value assessment"),
         ("Estimated staff hours saved per month through AI (thousands)","quantitative","count","increase",2,40,
            "Time-use study")])]),
 ],
},
{
 "pillar":4,"tag":"Skills & Sustainable Capacity",
 "impact":"Staff sustain digital capability through continuous learning, strong peer networks, and durable partnerships.",
 "outcomes":[
  ("Continuous learning sustains digital capability at scale.",
    [("A continuous-learning academy operates across regions and cohorts.","Ingrid Lindqvist",
        [("Number of staff completing certified learning pathways","quantitative","count","increase",300,4000,
            "Learning management system records"),
         ("Share of staff at the target digital-capability level","quantitative","%","increase",55,90,
            "Capability assessment")]),
     ("Digital capabilities are embedded in every country office.","Ingrid Lindqvist",
        [("Number of country offices with embedded digital capability","quantitative","count","increase",20,130,
            "Country-office capability records")])]),
  ("Networks and partnerships sustain capacity beyond the core organisation.",
    [("Peer networks and partnerships deliver durable capacity.","Ingrid Lindqvist",
        [("Number of active partnerships delivering joint capacity","quantitative","count","increase",5,20,
            "Partnership agreements"),
         ("Number of digital experts sustained in the field","quantitative","count","increase",15,60,
            "Deployment records")])]),
 ],
},
]

# ---- Plans ------------------------------------------------------------------
def _elapsed(start, end):
    """Fraction of the plan's timeline elapsed by TODAY (clamped to [0,1])."""
    if TODAY <= start: return 0.0
    if TODAY >= end: return 1.0
    return (TODAY - start).days / (end - start).days

PLANS = [
 {"id":1,"name":"Development Plan (2021-2025)",
  "description":"The organisation's first digital transformation plan - establishing data governance, integrated platforms, responsible innovation and field capacity across 2021-2025.",
  "start":date(2021,1,1),"end":date(2025,12,31),
  "framework":PILLARS_2021,
  "meas_from":(2021,1),"meas_to":(2025,12),"meas_cap":None,
  "proj_starts":["2021-01-01","2021-06-01","2022-01-01","2022-09-01","2023-01-01"],
  "proj_ends":["2024-06-30","2024-12-31","2025-06-30","2025-12-31"]},
 {"id":2,"name":"Development Plan (2026-2030)",
  "description":"The current plan - moving from governance to foresight, from integrated platforms to one unified ecosystem, and from AI adoption to trusted AI at scale, sustained by continuous capability across 2026-2030.",
  "start":date(2026,1,1),"end":date(2030,12,31),
  "framework":PILLARS_2026,
  "meas_from":(2026,1),"meas_to":(2026,7),"meas_cap":(2026,7),
  "proj_starts":["2025-09-01","2026-01-01","2026-03-01","2026-06-01"],
  "proj_ends":["2028-12-31","2029-06-30","2029-12-31","2030-06-30","2030-12-31"]},
]
for _p in PLANS:
    _p["baseline_year"] = _p["start"].year
    _p["target_year"]   = _p["end"].year
    _p["baseline_date"] = _p["start"].isoformat()
    _p["target_date"]   = _p["end"].isoformat()
    _p["elapsed"]       = _elapsed(_p["start"], _p["end"])

plans = [{"id":p["id"],"name":p["name"],"description":p["description"],
          "start_date":p["baseline_date"],"end_date":p["target_date"],"seq":p["id"]}
         for p in PLANS]

# ---------------------------------------------------------------------------
programmes, results, indicators, measurements = [], [], [], []
pid = rid = iid = mid = 0

def _month_date(k, n, plan):
    """Map step k (of n) across the plan's measurement window [meas_from..meas_to].
    Plan 2's window is capped at TODAY's month, so its final activities never post
    a date in the future."""
    fy, fm = plan["meas_from"]; ty, tm = plan["meas_to"]
    total = (ty - fy) * 12 + (tm - fm)
    off = int(round(k * total / max(1, n)))
    idx = (fm - 1) + off
    yr = fy + idx // 12
    month = idx % 12 + 1
    cap = plan.get("meas_cap")
    if cap and (yr > cap[0] or (yr == cap[0] and month >= cap[1])):
        yr, month = cap[0], cap[1]
        day = ri(1, min(TODAY.day, 28))
    else:
        day = ri(1, 28)
    return f"{yr:04d}-{month:02d}-{day:02d}", yr, month

def _place_for(iso):
    pool = PLACES.get(iso) or []
    if not pool: return (None, None, None)
    p = pick(pool)
    return (p["name"], p["lat"], p["lng"])

def _site_tuple(s): return (s["name"], s["lat"], s["lng"])

def sample_sites(iso, k):
    """A project's handful of field SITES: k distinct real settlements drawn from
    the country gazetteer. All of a project's activities are logged at these few
    sites (not scattered one-per-city), so each location aggregates a realistic
    number of activities on the map."""
    pool = (PLACES.get(iso) or [])[:]
    if not pool: return []
    shuffle(pool)
    return pool[:min(k, len(pool))]

def add_measurements(indicator, base_v, target_v, unit, reporter_id, plan,
                     iso=None, project_id=None, sites=None):
    """Emit monthly reporting transactions across the plan's elapsed window. The
    achieved PROGRESS (share of the baseline->target gap) is scaled by how much of
    the plan has elapsed, so early in a long plan (2026-2030) results are modest
    while a completed plan (2021-2025) shows final achievement. Status = baseline +
    increments (count units) or the latest level (%/index)."""
    global mid
    # ~6% of indicators are newly created and have no data yet (No Data / grey)
    if rnd() < 0.06:
        return
    # target PERFORMANCE band (progress vs time-elapsed): ~42% good, 33% mid, 25% poor
    r = rnd()
    if r < 0.42: perf = 0.85 + rnd()*0.4    # on track / over-achieve
    elif r < 0.75: perf = 0.55 + rnd()*0.32 # at risk band
    else: perf = 0.1 + rnd()*0.4            # off track
    perf = max(0.0, perf)
    # progress achieved so far = performance x elapsed-share of the plan
    progress = perf * plan["elapsed"]
    n = ri(3, 6)
    narrative_pool = ["Reported through the monthly country-office cycle.","Validated against reporting-system analytics.",
        "Confirmed during regional review.","Awaiting final quality assurance.","Self-reported by the country team."]
    achieved = base_v + (target_v - base_v) * progress   # cumulative level reached by now

    def emit(value, k):
        global mid
        date_s, _, _ = _month_date(k, n, plan)
        mid += 1
        pname, plat, plng = _site_tuple(pick(sites)) if sites else _place_for(iso)
        measurements.append({
            "id":mid,"indicator_id":indicator,"date":date_s,
            "value":round(value, 2),
            "narrative": pick(narrative_pool),
            "reported_by_id":reporter_id,
            "project_id":project_id,
            "place_name":pname,"place_lat":plat,"place_lng":plng,
        })

    if unit == "count":
        # increments that sum to (achieved - baseline); status engine = baseline + sum
        total_delta = achieved - base_v
        weights = [0.5 + rnd() for _ in range(n)]
        wsum = sum(weights) or 1.0
        for k in range(n):
            emit(total_delta * weights[k] / wsum, k + 1)
    else:
        # levels from baseline up to the achieved level (latest = current value)
        for k in range(n + 1):
            p = (k / n) * progress
            val = base_v + (target_v - base_v) * p
            val += (rnd() - 0.5) * abs(target_v - base_v) * 0.05
            emit(val, k)

def make_indicator(result_id, spec, responsible_id, reporter_name, reporter_id, code, iso, plan):
    """A KPI sits ONLY under an Output. `spec` = (name, type, unit, direction,
    baseline, target, means_of_verification). `code` = system-generated hierarchy
    code 'KPI #.#.#.#' (never user-edited). Baseline/target years come from the
    plan; the monthly reports (activities) are entered by the country office."""
    global iid
    name,typ,unit,direction,base,target,mov = spec
    iid += 1
    indicators.append({
        "id":iid,"result_id":result_id,"code":code,"name":name,"type":typ,"unit":unit,"direction":direction,
        "secondary":0,"project_id":None,
        "baseline_value":base,"baseline_year":plan["baseline_year"],"baseline_date":plan["baseline_date"],
        "target_value":target,"target_year":plan["target_year"],"target_date":plan["target_date"],
        "means_of_verification": mov or pick(["Platform analytics","Reporting records","Programme monitoring database",
            "Regional review report","Independent assessment","Steering group record"]),
        "collection_method":pick(["Administrative records","Platform analytics","Survey","Self-reporting","Regional review"]),
        "frequency":pick(["annual","semi-annual","quarterly","monthly"]),
        "responsible_id":responsible_id,
        "disaggregation":pick(["region","region, partner","none","region, country"]),
    })
    add_measurements(iid, base, target, unit, reporter_id, plan, iso=iso)

# ---- users (Owner / Section / Country Office) ------------------------------------------
# Reports are attributed to a logged-in user, never a typed name. Each user's
# demo password equals their username (browser-only app; not real security).
# Users are UNIVERSAL - shared across plans.
users = []
uid = 0
_SECTION_FOR = {"owner":"hq", "hq":"hq", "co":"co"}
_STATUS_FOR  = {"owner":"admin", "hq":"user", "co":"user"}
def add_user(username, name, role, region=None, iso=None, enabled=1):
    global uid
    uid += 1
    users.append({"id":uid,"username":username,"name":name,"password":username,
        "section":_SECTION_FOR[role],"status":_STATUS_FOR[role],
        "region":region,"country_iso3":iso,"enabled":enabled,
        "created":"2021-01-01"})
    return uid

# Owner - full control. Identity depends on the build variant (see INTERNAL above).
add_user(OWNER[0], OWNER[1], "owner")
# Section - the distinct output owners across BOTH frameworks (can edit Results & Framework)
hq_by_name = {}
for _fw in (PILLARS_2021, PILLARS_2026):
    for _t in _fw:
        for (_os, _outs) in _t["outcomes"]:
            for (_ostmt, _owner, _kpis) in _outs:
                if _owner not in hq_by_name:
                    hq_by_name[_owner] = add_user(_owner.lower().replace(" ", "."), _owner, "hq")

# ---- country programmes (UNIVERSAL - shared across plans) -------------------
prog_by_iso = {}
co_by_iso = {}
lead_name_by_iso = {}
for iso, cname, region in COUNTRIES:
    pid += 1
    lead = pick(LEADS)
    co_uid = add_user(iso.lower(), lead, "co", region, iso)   # username = iso3
    co_by_iso[iso] = co_uid
    lead_name_by_iso[iso] = lead
    programmes.append({
        "id":pid,"name":cname,"short_name":iso,"region":region,
        "country_iso3":iso,"lead":lead,
        "budget_usd": ri(1,9)*100_000,
        "start_date":"2021-01-01","end_date":"2030-12-31",
    })
    prog_by_iso[iso] = pid

# Country reference table: the 56 programme countries PLUS every other country in
# the world (reference-only). Each carries the region NAME (denormalised mirror
# the app filters on) AND a region_id FOREIGN key into the `region` table.
countries = [{"iso3":i,"name":n,"region":r,"region_id":region_id_by_name[r]}
             for (i,n,r) in COUNTRIES + WORLD_EXTRA]

# ---- results framework - rolled out per PLAN x country ----------------------
# each country implements all four pillars of each plan, so its KPI inventory
# carries candidates under every impact of every plan.
for plan in PLANS:
    for iso, cname, region in COUNTRIES:
        prog_id = prog_by_iso[iso]
        lead = lead_name_by_iso[iso]
        co_uid = co_by_iso[iso]
        for t in plan["framework"]:
            color = t.get("color") or PILLAR_PALETTE.get(t["pillar"], "#94a3b8")
            rid += 1; impact_id = rid
            results.append({"id":rid,"plan_id":plan["id"],"programme_id":prog_id,"parent_id":None,"level":"impact",
                "code":f"Impact {t['pillar']}","statement":t["impact"],"sdg":t["pillar"],
                "pillar_name":t["tag"],"pillar_color":color,
                "assumptions":"Leadership engagement sustained; Steering group priorities hold; resourcing confirmed.",
                "risks":pick(["Resourcing constraints under prioritisation.","Uneven partner engagement.",
                    "Competing reporting demands on country offices.","Capacity gaps at field level."]),
                "risk_level":pick(["low","medium","medium","high"])})
            for oi,(o_stmt, outputs) in enumerate(t["outcomes"], start=1):
                rid += 1; outcome_id = rid
                results.append({"id":rid,"plan_id":plan["id"],"programme_id":prog_id,"parent_id":impact_id,"level":"outcome",
                    "code":f"Outcome {t['pillar']}.{oi}","statement":o_stmt,"sdg":t["pillar"],
                    "assumptions":"Regional and country counterparts remain engaged; enabling policy environment holds.",
                    "risks":pick(["Institutional turnover weakens ownership.","Delayed decisions slow delivery.",
                        "Capacity gaps in implementing teams.","Data systems remain fragmented."]),
                    "risk_level":pick(["low","medium","medium","high"])})
                for pj,(out_stmt, owner, kpis) in enumerate(outputs, start=1):
                    rid += 1; output_id = rid
                    results.append({"id":rid,"plan_id":plan["id"],"programme_id":prog_id,"parent_id":outcome_id,"level":"output",
                        "code":f"Output {t['pillar']}.{oi}.{pj}","statement":out_stmt,"sdg":t["pillar"],
                        "assumptions":"Delivery timelines are met; country offices and partners participate.",
                        "risks":pick(["Delivery / procurement delays.","Clearance dependencies.","Staff attrition.","Budget constraints."]),
                        "risk_level":pick(["low","low","medium","high"]),
                        "owner_id":hq_by_name.get(owner)})
                    for ki,kpi in enumerate(kpis, start=1):
                        make_indicator(output_id, kpi, hq_by_name.get(owner), lead, co_uid,
                                       f"KPI {t['pillar']}.{oi}.{pj}.{ki}", iso, plan)

# ---- Donors (UNIVERSAL) -----------------------------------------------------
DONOR_DEFS = [
 ("European Union","EU","Multilateral"),
 ("World Bank","WB","Multilateral"),
 ("Government of Norway","NOR","Bilateral"),
 ("Government of Sweden (Sida)","SIDA","Bilateral"),
 ("Government of Germany (BMZ)","BMZ","Bilateral"),
 ("Government of Japan","JPN","Bilateral"),
 ("Government of Canada","CAN","Bilateral"),
 ("United Kingdom (FCDO)","FCDO","Bilateral"),
 ("Gates Foundation","GATES","Foundation"),
 ("Rockefeller Foundation","ROCK","Foundation"),
 ("Government of the Netherlands","NLD","Bilateral"),
 ("Republic of Korea (KOICA)","KOICA","Bilateral"),
 ("Swiss Cooperation (SDC)","SDC","Bilateral"),
 ("Joint SDG Fund","JSDG","Multilateral"),
 ("UN Multi-Partner Trust Fund","MPTF","Multilateral"),
 ("Government of Denmark (Danida)","DANIDA","Bilateral"),
]
DONOR_PAL = ["#4FA9E8","#33C2B4","#9D7BEE","#F5A04D","#EC7BA6","#5399EA","#2CC4A0","#E0A93B",
 "#6FBF73","#EA8A5B","#C58BE0","#48B0C4","#D98CA0","#8FB84E","#E2B54A","#7E9BEA"]
donors = [{"id":i+1,"name":n,"short_name":s,"type":t,"color":DONOR_PAL[i % len(DONOR_PAL)]}
          for i,(n,s,t) in enumerate(DONOR_DEFS)]

# ---- Projects (plan-SCOPED) -------------------------------------------------
# A project belongs to a country AND a plan, is funded by a donor, has a budget
# and dates, and carries PRIMARY KPIs (that plan's inventory indicators, linked
# via project_kpi) and SECONDARY KPIs (project-local indicators). Some of the
# plan's activities (measurements) are attributed to the project.
PROJECT_THEMES = ["Digital Public Infrastructure","Data for Development","AI for Public Services",
 "Inclusive Digital Transformation","Open Data & Transparency","Digital Skills & Capacity",
 "e-Government Modernisation","Climate Data Systems","Frontier Tech for the SDGs",
 "National Data Governance","Digital Health Information","Smart Service Delivery",
 "Foundational Digital ID","Data-Driven Local Governance"]
SEC_NAMES = [
 ("Community consultation sessions held","count"),
 ("Local officials trained on the platform","count"),
 ("Beneficiaries reached through field activities","count"),
 ("Field data-collection points established","count"),
 ("Community satisfaction with digital services","%"),
 ("Local partner organisations engaged","count"),
 ("Village-level datasets published","count"),
 ("Grievances resolved within service standard","%"),
 ("Women participating in digital-skills sessions","count"),
 ("Frontline devices deployed","count"),
 ("Sub-national dashboards adopted by district offices","count"),
 ("Field staff trained on responsible data use","count"),
]

result_by_id = {r["id"]: r for r in results}
# indicators grouped by (plan, programme) for project KPI pooling
inds_by_plan_prog = {}
for _ind in indicators:
    _r = result_by_id.get(_ind["result_id"])
    if _r: inds_by_plan_prog.setdefault((_r["plan_id"], _r["programme_id"]), []).append(_ind)
meas_by_ind = {}
for _m in measurements:
    meas_by_ind.setdefault(_m["indicator_id"], []).append(_m)

def make_secondary(project_id, iso, reporter_id, code, plan, sites=None):
    """A project-local (secondary) KPI: an indicator with secondary=1 and no
    result parent. Gets its own field activities, attributed to the project."""
    global iid
    nm, unit = pick(SEC_NAMES)
    if unit == "count":
        base, target = 0, ri(20, 500)
    else:  # %
        base, target = ri(20, 50), ri(70, 95)
    iid += 1
    indicators.append({
        "id":iid,"result_id":None,"code":code,"name":nm,"type":"quantitative","unit":unit,
        "direction":"increase","secondary":1,"project_id":project_id,
        "baseline_value":base,"baseline_year":plan["baseline_year"],"baseline_date":plan["baseline_date"],
        "target_value":target,"target_year":plan["target_year"],"target_date":plan["target_date"],
        "means_of_verification":"Project monitoring records; field verification",
        "collection_method":pick(["Self-reporting","Survey","Administrative records"]),
        "frequency":pick(["monthly","quarterly"]),"responsible_id":None,"disaggregation":pick(["none","sex","region"]),
    })
    add_measurements(iid, base, target, unit, reporter_id, plan, iso=iso, project_id=project_id, sites=sites)
    return iid

projects, project_kpi = [], []
proj_theme = {}          # project id -> theme (scopes its beneficiary breakdown)
prj = pk = 0
for plan in PLANS:
    for p in programmes:
        iso, region = p["country_iso3"], p["region"]
        reporter_id = co_by_iso.get(iso)
        pool = list(inds_by_plan_prog.get((plan["id"], p["id"]), []))
        shuffle(pool)
        nproj = ri(1, 3)
        for j in range(nproj):
            prj += 1
            code = f"PRJ-{iso}-P{plan['id']}-{j+1:02d}"
            donor = pick(donors)
            theme = pick(PROJECT_THEMES)
            proj_theme[prj] = theme
            sites = sample_sites(iso, ri(3, 6))
            # primary KPIs: round-robin partition of the plan's country inventory
            prim = pool[j::nproj][:ri(3, 6)]
            for ind in prim:
                pk += 1
                project_kpi.append({"id":pk,"project_id":prj,"indicator_id":ind["id"]})
                for m in meas_by_ind.get(ind["id"], []):
                    if m.get("project_id") is None:
                        m["project_id"] = prj
                        if sites:
                            s = pick(sites)
                            m["place_name"], m["place_lat"], m["place_lng"] = s["name"], s["lat"], s["lng"]
            projects.append({
                "id":prj,"plan_id":plan["id"],"code":code,"name":f"{theme} - {p['name']}",
                "budget_usd": ri(3, 45) * 100_000,
                "donor_id":donor["id"],"country_iso3":iso,"region":region,
                "lead":p["lead"],"start_date":pick(plan["proj_starts"]),"end_date":pick(plan["proj_ends"]),
                "description":f"{theme} initiative in {p['name']}, supported by {donor['name']}, "
                              f"strengthening capacity and delivery in the field.",
            })
            for s in range(ri(1, 3)):
                make_secondary(prj, iso, reporter_id, f"SEC-{iso}-P{plan['id']}-{j+1:02d}.{s+1}", plan, sites=sites)

# ---- Beneficiaries (UNIVERSAL measures; entries hang off activities) --------
BENEFICIARY_TYPES = [
 ("Men", "MEN", "Adult male beneficiaries, 18 years and older, reached by the activity."),
 ("Women", "WMN", "Adult female beneficiaries, 18 years and older, reached by the activity."),
 ("Boys", "BOY", "Male children and adolescents under 18 years reached by the activity."),
 ("Girls", "GRL", "Female children and adolescents under 18 years reached by the activity."),
 ("Persons with Disabilities", "PWD", "People with a physical, sensory, intellectual or psychosocial disability."),
 ("Refugees", "REF", "People who have fled across an international border and hold refugee status."),
 ("IDPs", "IDP", "Internally displaced persons uprooted within their own country's borders."),
 ("Returnees", "RET", "Former refugees or IDPs who have returned to their area of origin."),
 ("Host community", "HST", "Local residents of areas hosting refugees, IDPs or returnees."),
 ("Youth", "YTH", "Young people aged 15 to 24, per the UN definition of youth."),
 ("Elderly", "ELD", "Older persons, generally aged 60 years and above."),
]
beneficiary_types = [{"id":i+1,"name":n,"code":c,"description":d,"seq":i+1} for i,(n,c,d) in enumerate(BENEFICIARY_TYPES)]
_bt_by_name = {b["name"]: b for b in beneficiary_types}

THEME_BENEFICIARIES = {
 "Digital Public Infrastructure":    ["Men","Women","Youth","Persons with Disabilities","Elderly"],
 "Data for Development":             ["Men","Women","Youth"],
 "AI for Public Services":           ["Men","Women","Youth","Persons with Disabilities"],
 "Inclusive Digital Transformation": ["Men","Women","Boys","Girls","Youth","Persons with Disabilities","Elderly","Refugees","IDPs","Host community"],
 "Open Data & Transparency":         ["Men","Women","Youth"],
 "Digital Skills & Capacity":        ["Men","Women","Boys","Girls","Youth","Persons with Disabilities"],
 "e-Government Modernisation":        ["Men","Women","Youth","Persons with Disabilities","Elderly"],
 "Climate Data Systems":             ["Men","Women","Youth","Host community"],
 "Frontier Tech for the SDGs":       ["Men","Women","Youth","Persons with Disabilities"],
 "National Data Governance":         ["Men","Women","Youth"],
 "Digital Health Information":       ["Men","Women","Boys","Girls","Youth","Persons with Disabilities","Elderly"],
 "Smart Service Delivery":           ["Men","Women","Youth","Persons with Disabilities","Elderly","Refugees","IDPs","Host community"],
 "Foundational Digital ID":          ["Men","Women","Youth","Persons with Disabilities","Elderly","Refugees","IDPs","Returnees","Host community"],
 "Data-Driven Local Governance":     ["Men","Women","Youth","Persons with Disabilities","Elderly","Host community"],
}

beneficiaries = []; bnid = 0
for m in measurements:
    if m.get("project_id") is None: continue
    if rnd() < 0.35: continue                 # ~65% of project activities record beneficiaries
    allowed = THEME_BENEFICIARIES.get(proj_theme.get(m["project_id"]), ["Men","Women","Youth"])
    types = [_bt_by_name[n] for n in allowed]; shuffle(types)
    hi = min(5, len(types)); lo = min(2, hi)  # 2-5 types per activity, capped to the theme's set
    for bt in types[: ri(lo, hi)]:
        bnid += 1
        beneficiaries.append({"id":bnid,"measurement_id":m["id"],"type_id":bt["id"],
            "value": ri(3, 600)})

payload = {
    "plan":plans,
    "region":regions,
    "country":countries,
    "user":users,
    "donor":donors,
    "programme":programmes,
    "project":projects,
    "project_kpi":project_kpi,
    "result":results,
    "indicator":indicators,
    "measurement":measurements,
    "beneficiary_type":beneficiary_types,
    "beneficiary":beneficiaries,
}
payload_json = json.dumps(payload, separators=(",",":"))
# Content stamp: a short hash of the payload. db.js compares it against the
# stamp it last persisted and auto-reseeds when the data changes, so a
# regenerated seed reaches every browser on next load WITHOUT touching DB_NAME
# and WITHOUT anyone running a console command.
import hashlib
stamp = hashlib.sha1(payload_json.encode("utf-8")).hexdigest()[:12]
js = "window.SEED_STAMP=" + json.dumps(stamp) + ";window.SEED=" + payload_json + ";"
open(OUT,"w",encoding="utf-8").write(js)
print("owner:",OWNER[0],"/",OWNER[1])
print("stamp:",stamp)
# NB: interactive activity logging searches REAL settlements live from OpenStreetMap
# (Photon) in the app. The PLACES gazetteer here only seeds coordinates onto the
# demo/historical activities so the map has points on first load; it is no longer
# shipped as a file or used for search.
print("plans:",len(plans))
print("regions:",len(regions))
print("countries:",len(countries),"(",len(COUNTRIES),"with programmes )")
print("users:",len(users))
print("donors:",len(donors))
print("programmes:",len(programmes))
print("projects:",len(projects))
print("project_kpi:",len(project_kpi))
print("results:",len(results))
print("indicators:",len(indicators),"(incl. secondary)")
print("measurements:",len(measurements))
print("beneficiary_types:",len(beneficiary_types))
print("beneficiaries:",len(beneficiaries))
print("bytes:",len(js))
