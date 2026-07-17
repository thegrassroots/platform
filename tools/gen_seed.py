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

# Country-office leads (country-team level). One name per programme country,
# drawn WITHOUT replacement so every seeded user has a distinct display name
# (Lead dropdowns label users by name - duplicates are indistinguishable).
# Keep this pool >= len(COUNTRIES) and every surname unique.
LEADS = ["A. Mwangi","S. Rahman","T. Eriksson","M. Okonkwo","L. Petrova","J. Alvarez",
 "N. Haile","R. Santos","F. Ndiaye","P. Gurung","K. Nasser","E. Bryant","C. Dlamini","H. Tran",
 "B. Kamau","D. Osei","G. Abebe","W. Banda","S. Diallo","M. Toure","R. Chirwa","A. Farah",
 "L. Mensah","K. Sow","J. Moyo","C. Nkosi","T. Gebre","H. Mansour","R. Khalil","S. Barakat",
 "N. Aziz","F. Hamdan","L. Saleh","A. Sharma","P. Thapa","S. Fernando","M. Chowdhury",
 "R. Iyer","K. Bhatti","D. Nguyen","L. Phan","T. Aung","B. Ganbold","C. Reyes","I. Kovacs",
 "O. Marchenko","D. Ivanova","A. Hoxha","N. Beridze","Z. Osmonov","G. Rustamov","E. Popescu",
 "V. Jovanovic","C. Mendoza","P. Vargas","R. Quispe","L. Castillo","J. Fuentes","M. Herrera",
 "A. Paredes"]

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
 "pillar":1,"tag":"Health & Nutrition",
 "impact":"Communities have reliable access to essential health and nutrition services.",
 "outcomes":[
  ("Essential primary health services are available and used in underserved districts.",
    [("Primary health facilities upgraded and staffed in priority districts.","Priya Raman",
        [("Number of primary health facilities meeting the minimum service standard","quantitative","count","increase",0,120,
            "Facility assessment records"),
         ("Share of the target population within 5 km of a functioning facility","quantitative","%","increase",42,80,
            "Household survey; facility registry")]),
     ("Community health worker network trained and deployed.","Elena Duarte",
        [("Number of community health workers certified and active","quantitative","count","increase",0,3500,
            "Training and deployment records"),
         ("Share of districts with full community health worker coverage","quantitative","%","increase",15,75,
            "District coverage register")]),
     ("Essential medicines supply chain strengthened.","Priya Raman",
        [("Share of facilities reporting no stock-out of essential medicines","quantitative","%","increase",55,95,
            "Supply chain monitoring reports")])]),
  ("Maternal and child health outcomes improve in priority districts.",
    [("Maternal and newborn care packages delivered at scale.","Marco Ruiz",
        [("Share of births attended by a skilled health worker","quantitative","%","increase",61,90,
            "Health information system"),
         ("Number of women reached with four or more antenatal visits","quantitative","count","increase",0,250000,
            "Health information system")]),
     ("Child nutrition screening and treatment expanded.","Nadia Haddad",
        [("Prevalence of acute malnutrition among children under five","quantitative","%","decrease",12.4,5,
            "Nutrition survey"),
         ("Number of children screened for malnutrition","quantitative","count","increase",0,400000,
            "Screening records")])]),
 ],
},
{
 "pillar":2,"tag":"Education & Learning",
 "impact":"Children and young people complete quality basic education and learn.",
 "outcomes":[
  ("More children enrol in and complete basic education.",
    [("Classrooms rehabilitated and learning spaces expanded.","Elena Duarte",
        [("Number of classrooms rehabilitated or built","quantitative","count","increase",0,900,
            "Construction completion certificates"),
         ("Net enrolment rate in target districts","quantitative","%","increase",68,90,
            "Education management information system")]),
     ("Teachers trained in learner-centred pedagogy.","Ingrid Lindqvist",
        [("Number of teachers completing certified training","quantitative","count","increase",0,12000,
            "Training registry"),
         ("Share of schools with at least one certified teacher per grade","quantitative","%","increase",34,85,
            "School survey")])]),
  ("Learning outcomes improve, particularly for girls.",
    [("Structured literacy and numeracy programme rolled out.","Marco Ruiz",
        [("Share of pupils meeting the minimum literacy standard","quantitative","%","increase",41,75,
            "Learning assessment"),
         ("Share of pupils meeting the minimum numeracy standard","quantitative","%","increase",38,72,
            "Learning assessment")]),
     ("Barriers to girls' education addressed in target communities.","Nadia Haddad",
        [("Gender parity index in secondary completion","quantitative","index","increase",0.78,1,
            "Education statistics")])]),
 ],
},
{
 "pillar":3,"tag":"Climate & Resilience",
 "impact":"Communities and ecosystems withstand climate shocks and recover faster.",
 "outcomes":[
  ("Communities are protected by early warning and preparedness systems.",
    [("Multi-hazard early warning systems installed and operating.","Priya Raman",
        [("Number of districts covered by a multi-hazard early warning system","quantitative","count","increase",0,60,
            "System commissioning records"),
         ("Share of population receiving timely hazard alerts","quantitative","%","increase",25,85,
            "Alert reach survey")]),
     ("Community preparedness plans developed and rehearsed.","Ingrid Lindqvist",
        [("Number of communities with a rehearsed preparedness plan","quantitative","count","increase",0,750,
            "Plan registry; drill reports")])]),
  ("Natural resources are managed sustainably and degraded land is restored.",
    [("Degraded land restored through community schemes.","Marco Ruiz",
        [("Hectares of degraded land under restoration","quantitative","count","increase",0,150000,
            "Restoration monitoring"),
         ("Share of restored sites surviving after two years","quantitative","%","increase",0,80,
            "Site survival survey")]),
     ("Water and sanitation services made climate-resilient.","Elena Duarte",
        [("Number of people with climate-resilient water services","quantitative","count","increase",0,600000,
            "Utility and programme records"),
         ("Share of water points functional after a shock","quantitative","%","increase",48,85,
            "Post-shock functionality survey")])]),
 ],
},
{
 "pillar":4,"tag":"Livelihoods & Inclusion",
 "impact":"Households earn decent incomes and the most marginalised are included.",
 "outcomes":[
  ("Households diversify income and increase productivity.",
    [("Smallholder producers linked to markets and inputs.","Nadia Haddad",
        [("Number of smallholder producers reached with inputs and advisory services","quantitative","count","increase",0,180000,
            "Programme beneficiary records"),
         ("Average household income change in target districts","quantitative","%","increase",0,35,
            "Household income survey")]),
     ("Vocational and enterprise training delivered to young people.","Ingrid Lindqvist",
        [("Number of young people completing vocational training","quantitative","count","increase",0,45000,
            "Training completion records"),
         ("Share of graduates in work or self-employment after 12 months","quantitative","%","increase",0,60,
            "Tracer study")])]),
  ("Social protection reaches the most vulnerable.",
    [("Social protection registries expanded and made inclusive.","Priya Raman",
        [("Number of vulnerable households enrolled in social protection","quantitative","count","increase",0,220000,
            "Social protection registry")]),
     ("Services made accessible to persons with disabilities.","Marco Ruiz",
        [("Share of service points meeting accessibility standards","quantitative","%","increase",18,70,
            "Accessibility audit"),
         ("Composite inclusion index across target districts","quantitative","index","increase",2.1,4.2,
            "Inclusion assessment")])]),
 ],
},
]

# =============================================================================
#  FRAMEWORK 2 - Development Plan (2026-2030)   [the current four pillars]
# =============================================================================
PILLARS_2026 = [
{
 "pillar":1,"tag":"Universal Health Coverage",
 "impact":"Everyone can reach quality essential health services without financial hardship.",
 "outcomes":[
  ("Essential health services approach universal coverage in target countries.",
    [("Integrated service delivery extended to the remaining underserved districts.","Priya Raman",
        [("Universal health coverage service index","quantitative","index","increase",52,80,
            "Coverage index assessment"),
         ("Share of districts delivering the full essential services package","quantitative","%","increase",40,95,
            "District service audit")]),
     ("Health financing reforms reduce out-of-pocket costs.","Elena Duarte",
        [("Share of households facing catastrophic health expenditure","quantitative","%","decrease",9.6,3,
            "Household expenditure survey")])]),
  ("Health systems withstand shocks and outbreaks.",
    [("Outbreak detection and response capacity established nationally.","Marco Ruiz",
        [("Median days from outbreak detection to response","quantitative","index","decrease",14,3,
            "Outbreak response logs"),
         ("Number of countries meeting core preparedness capacities","quantitative","count","increase",8,40,
            "Preparedness assessment")])]),
 ],
},
{
 "pillar":2,"tag":"Learning for All",
 "impact":"Every child and young person gains the skills to thrive.",
 "outcomes":[
  ("Foundational learning is secured for all children.",
    [("Foundational learning programme institutionalised in national systems.","Ingrid Lindqvist",
        [("Share of children achieving foundational literacy by age 10","quantitative","%","increase",48,85,
            "National learning assessment"),
         ("Number of countries with the programme in the national curriculum","quantitative","count","increase",4,35,
            "Curriculum records")]),
     ("Alternative pathways reach learners where schooling is disrupted.","Nadia Haddad",
        [("Number of learners reached through alternative learning pathways","quantitative","count","increase",0,900000,
            "Programme records")])]),
  ("Young people transition into work with relevant skills.",
    [("Skills programmes aligned to labour market demand.","Marco Ruiz",
        [("Share of graduates employed within six months","quantitative","%","increase",44,75,
            "Tracer study"),
         ("Number of employers partnering on skills programmes","quantitative","count","increase",0,600,
            "Partnership agreements")])]),
 ],
},
{
 "pillar":3,"tag":"Climate Adaptation & Nature",
 "impact":"Countries adapt to climate change and restore the ecosystems people depend on.",
 "outcomes":[
  ("National adaptation plans are financed and implemented.",
    [("Adaptation plans costed, financed and under implementation.","Priya Raman",
        [("Number of countries implementing a financed adaptation plan","quantitative","count","increase",6,45,
            "Plan and finance records"),
         ("Adaptation finance mobilised (index, baseline=100)","quantitative","index","increase",100,320,
            "Finance tracking")]),
     ("Nature-based solutions scaled across landscapes.","Elena Duarte",
        [("Hectares under nature-based solutions","quantitative","count","increase",0,500000,
            "Landscape monitoring")])]),
  ("Communities and infrastructure are resilient to climate shocks.",
    [("Critical infrastructure upgraded to resilience standards.","Ingrid Lindqvist",
        [("Share of critical infrastructure meeting resilience standards","quantitative","%","increase",22,75,
            "Infrastructure audit"),
         ("Number of people better protected from climate hazards","quantitative","count","increase",0,2500000,
            "Protection coverage assessment")])]),
 ],
},
{
 "pillar":4,"tag":"Inclusive Economies",
 "impact":"Economic opportunity reaches those furthest behind.",
 "outcomes":[
  ("Decent work expands in target economies.",
    [("Micro and small enterprises grow with access to finance.","Nadia Haddad",
        [("Number of micro and small enterprises accessing finance","quantitative","count","increase",0,120000,
            "Financial institution records"),
         ("Share of supported enterprises surviving after two years","quantitative","%","increase",0,70,
            "Enterprise survey")]),
     ("Women's economic participation increased.","Marco Ruiz",
        [("Female labour force participation rate in target districts","quantitative","%","increase",38,60,
            "Labour force survey")])]),
  ("Social protection systems are universal and shock-responsive.",
    [("Shock-responsive social protection operating nationally.","Priya Raman",
        [("Number of countries with shock-responsive social protection","quantitative","count","increase",5,40,
            "System assessment"),
         ("Share of the eligible population covered by social protection","quantitative","%","increase",34,80,
            "Coverage statistics")])]),
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
  "description":"The first five-year development plan - building primary health and nutrition services, basic education, climate resilience and inclusive livelihoods across 2021-2025.",
  "start":date(2021,1,1),"end":date(2025,12,31),
  "framework":PILLARS_2021,
  "meas_from":(2021,1),"meas_to":(2025,12),"meas_cap":None,
  "proj_starts":["2021-01-01","2021-06-01","2022-01-01","2022-09-01","2023-01-01"],
  "proj_ends":["2024-06-30","2024-12-31","2025-06-30","2025-12-31"]},
 {"id":2,"name":"Development Plan (2026-2030)",
  "description":"The current plan - moving from service delivery to universal coverage, from access to learning outcomes, from resilience to financed adaptation, and from income growth to inclusive economies across 2026-2030.",
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
    narrative_pool = ["Reported through the monthly country-office cycle.","Validated against district records.",
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
        "id":iid,"result_id":result_id,"code":code,"name":name,
        "type_id":KTYPE_ID[typ],"unit_id":UNIT_ID[unit],"direction_id":DIR_ID[direction],
        "secondary":0,"project_id":None,
        "baseline_value":base,"baseline_year":plan["baseline_year"],"baseline_date":plan["baseline_date"],
        "target_value":target,"target_year":plan["target_year"],"target_date":plan["target_date"],
        "means_of_verification": mov or pick(["Administrative records","Reporting records","Programme monitoring database",
            "Regional review report","Independent assessment","Household survey"]),
        "collection_method_id":METHOD_ID[pick(["Administrative records","Facility records","Survey","Self-reporting","Regional review"])],
        "frequency_id":FREQ_ID[pick(["annual","semi-annual","quarterly","monthly"])],
        "responsible_id":responsible_id,
        "disaggregation_id":DISAGG_ID[pick(["region","region, partner","none","region, country"])],
    })
    add_measurements(iid, base, target, unit, reporter_id, plan, iso=iso)

# ---- Affiliations (UNIVERSAL lookup) ----------------------------------------
# One row per lead category. user.affiliation_id references this table and the
# app's Lead dropdowns filter to users affiliated to the matching category (a
# Donor Lead must come from Donor-affiliated users). `key` equals the report
# category keys the app already uses.
AFFILIATIONS = [
 (1, "plan",    "Plans"),
 (2, "impact",  "Impact"),
 (3, "outcome", "Outcome"),
 (4, "output",  "Output"),
 (5, "project", "Projects"),
 (6, "donor",   "Donors"),
 (7, "region",  "Regions"),
 (8, "country", "Countries"),
]
affiliations = [{"id":i,"key":k,"name":n,"seq":i} for (i,k,n) in AFFILIATIONS]
AFF = {k:i for (i,k,n) in AFFILIATIONS}

# ---- Reference lookups (UNIVERSAL) -------------------------------------------
# Every fixed form list lives in its own table; rows are selected and SAVED BY
# ID, never by text. `key` is the stable code the app's logic switches on
# (e.g. unit 'count' accumulates); `name` is the display label.
def _lookup(rows):
    return [{"id":i+1,"key":k,"name":n,"seq":i+1} for i,(k,n) in enumerate(rows)]
units              = _lookup([(u,u) for u in ["count","%","index","ratio","score","days","USD"]])
frequencies        = _lookup([(f,f) for f in ["annual","semi-annual","quarterly","monthly"]])
collection_methods = _lookup([(m,m) for m in ["Administrative records","Facility records","Platform analytics",
                                              "Survey","Self-reporting","Regional review","Independent assessment"]])
disaggregations    = _lookup([(d,d) for d in ["none","region","region, agency","region, country","region, partner","sex","age"]])
kpi_types          = _lookup([("quantitative","Quantitative"),("qualitative","Qualitative")])
directions         = _lookup([("increase","Higher is better"),("decrease","Lower is better")])
donor_types        = _lookup([(t,t) for t in ["Bilateral","Multilateral","Foundation"]])
user_statuses      = _lookup([("admin","Admin"),("user","User"),("viewer","Viewer")])
UNIT_ID    = {r["key"]:r["id"] for r in units}
FREQ_ID    = {r["key"]:r["id"] for r in frequencies}
METHOD_ID  = {r["key"]:r["id"] for r in collection_methods}
DISAGG_ID  = {r["key"]:r["id"] for r in disaggregations}
KTYPE_ID   = {r["key"]:r["id"] for r in kpi_types}
DIR_ID     = {r["key"]:r["id"] for r in directions}
DTYPE_ID   = {r["key"]:r["id"] for r in donor_types}
USTATUS_ID = {r["key"]:r["id"] for r in user_statuses}

# ---- users (Owner / affiliated officers / Country Offices) -------------------
# Reports are attributed to a logged-in user, never a typed name. Each user's
# demo password equals their username (browser-only app; not real security).
# Users are UNIVERSAL - shared across plans. Every user carries an
# affiliation_id; Lead assignments below always come from the matching pool.
users = []
uid = 0
_AFF_FOR    = {"owner":AFF["plan"], "hq":AFF["output"], "co":AFF["country"]}
_STATUS_FOR = {"owner":"admin", "hq":"user", "co":"user"}
# NB: users carry no region/country columns - a Countries-affiliated user's
# scope is DERIVED from the countries they Lead (country.lead_id).
def add_user(username, name, role, enabled=1, aff=None):
    global uid
    uid += 1
    users.append({"id":uid,"username":username,"name":name,"password":username,
        "email":f"{username}@thegrassroots.org",   # profile email - report delivery goes here
        "affiliation_id":aff if aff is not None else _AFF_FOR[role],
        "status_id":USTATUS_ID[_STATUS_FOR[role]],
        "enabled":enabled,
        "created":"2021-01-01"})
    return uid

# Owner - full control. Identity depends on the build variant (see INTERNAL above).
add_user(OWNER[0], OWNER[1], "owner")
# Output officers - the distinct output owners across BOTH frameworks (can edit Results & Framework)
hq_by_name = {}
for _fw in (PILLARS_2021, PILLARS_2026):
    for _t in _fw:
        for (_os, _outs) in _t["outcomes"]:
            for (_ostmt, _owner, _kpis) in _outs:
                if _owner not in hq_by_name:
                    hq_by_name[_owner] = add_user(_owner.lower().replace(" ", "."), _owner, "hq")

# ---- category Lead pools (deterministic - NO RNG, so nothing else churns) ----
# Each non-Output, non-Country category gets a dedicated pool of users carrying
# that affiliation, so its Lead dropdown has real candidates and every seeded
# Lead satisfies the affiliation filter. Pools are sized so a round-robin spreads
# the assignments thinly - no single user Leads a large share of a category (the
# Assigned column stays diverse). Every name here is unique across the seed.
def _add_pool(aff_key, names):
    return [add_user(n.lower().replace(" ", "."), n, "hq", aff=AFF[aff_key]) for n in names]
plan_pool    = [users[0]["id"]] + _add_pool("plan", ["Alice Navarro","Viktor Hale"])   # the Owner is Plans-affiliated too
impact_pool  = _add_pool("impact",  ["Ingrid Solberg","Mateo Vidal","Lucia Romano","Youssef Amari"])
outcome_pool = _add_pool("outcome", ["Tomas Keller","Aisha Bello","Farid Qureshi","Selin Yilmaz",
                                     "Diego Morales","Amara Okoye","Kenji Sato","Carmen Vega"])
project_pool = _add_pool("project", ["Lena Fischer","Marcus Doyle","Sofia Marino","Daniel Achebe",
                                     "Rania Aziz","Bjorn Holt","Chiara Ferrari","Emeka Obi",
                                     "Sandra Kohl","Pablo Castro","Yara Nassar","Ivan Petrov",
                                     "Mei Lund","Oscar Dubois"])
donor_pool   = _add_pool("donor",   ["Clara Jensen","Omar Kassab","Grace Wanjiru","Henrik Sol",
                                     "Fatima Zahra","Andres Reyes","Lea Almeida","Samuel Kim"])
region_pool  = _add_pool("region",  ["Elias Berg","Nadia Rahman","Carmen Diaz",
                                     "Theo Sorensen","Ana Moreau","Luca Bianchi"])

# ---- Leads for every category -----------------------------------------------
# The Communication panel reports to a Lead per plan/impact/outcome/output/project/
# donor/region/country. Outputs (owner per framework spec, Output-affiliated),
# projects, programmes and programme countries are assigned elsewhere; here the
# rest rotate deterministically through their affiliation's pool so assignments
# spread evenly. Impacts map one owner per pillar. Outcomes assign the NEXT pool
# member to each distinct outcome slot (pillar, oi) the first time it is seen -
# a true round-robin, so every outcome Lead carries a near-equal share and none
# is left idle. The same slot (shared across plans and country instances) always
# resolves to the same owner, keeping the Assigned count stable.
def _impact_owner(t):
    return impact_pool[(t["pillar"] - 1) % len(impact_pool)]
_outcome_slot = {}   # (pillar, oi) -> pool id, filled round-robin on first sight
def _outcome_owner(pillar, oi):
    key = (pillar, oi)
    if key not in _outcome_slot:
        _outcome_slot[key] = outcome_pool[len(_outcome_slot) % len(outcome_pool)]
    return _outcome_slot[key]
for _i, (_p, _row) in enumerate(zip(PLANS, plans)):
    _row["lead_id"] = plan_pool[(_i + 1) % len(plan_pool)]   # skip the Owner for seeded plans
for _i, _r in enumerate(regions):
    _r["lead_id"] = region_pool[_i % len(region_pool)]

# ---- country programmes (UNIVERSAL - shared across plans) -------------------
prog_by_iso = {}
co_by_iso = {}
lead_name_by_iso = {}
_lead_pool = LEADS[:]   # sample without replacement -> unique names
for iso, cname, region in COUNTRIES:
    pid += 1
    lead = _lead_pool.pop(int(rnd() * len(_lead_pool)))
    co_uid = add_user(iso.lower(), lead, "co")   # username = iso3; scope = this country via country.lead_id
    co_by_iso[iso] = co_uid
    lead_name_by_iso[iso] = lead
    programmes.append({
        "id":pid,"name":cname,"short_name":iso,"region":region,
        "country_iso3":iso,"lead_id":co_uid,
        "budget_usd": ri(1,9)*100_000,
        "start_date":"2021-01-01","end_date":"2030-12-31",
    })
    prog_by_iso[iso] = pid

# Lead dropdowns label users by display name - duplicates would be
# indistinguishable, so every seeded user's name must be unique.
assert len({u["name"] for u in users}) == len(users), "duplicate user display names in seed"

# Country reference table: the 56 programme countries PLUS every other country in
# the world (reference-only). Each carries the region NAME (denormalised mirror
# the app filters on) AND a region_id FOREIGN key into the `region` table.
# Programme countries carry their country-office user as the accountable Lead
# (co_by_iso is keyed by iso3; reference-only countries have no lead yet).
countries = [{"iso3":i,"name":n,"region":r,"region_id":region_id_by_name[r],
              "lead_id":co_by_iso.get(i)}
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
                "owner_id":_impact_owner(t),
                "assumptions":"Leadership engagement sustained; Steering group priorities hold; resourcing confirmed.",
                "risks":pick(["Resourcing constraints under prioritisation.","Uneven partner engagement.",
                    "Seasonal access constraints.","Capacity gaps at field level."]),
                "risk_level":pick(["low","medium","medium","high"])})
            for oi,(o_stmt, outputs) in enumerate(t["outcomes"], start=1):
                rid += 1; outcome_id = rid
                results.append({"id":rid,"plan_id":plan["id"],"programme_id":prog_id,"parent_id":impact_id,"level":"outcome",
                    "code":f"Outcome {t['pillar']}.{oi}","statement":o_stmt,"sdg":t["pillar"],
                    "owner_id":_outcome_owner(t["pillar"], oi),
                    "assumptions":"Regional and country counterparts remain engaged; enabling policy environment holds.",
                    "risks":pick(["Institutional turnover weakens ownership.","Delayed decisions slow delivery.",
                        "Capacity gaps in implementing teams.","Access constraints in remote districts."]),
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
 ("Global Resilience Fund","GRF","Multilateral"),
 ("Multi-Donor Trust Fund","MDTF","Multilateral"),
 ("Government of Denmark (Danida)","DANIDA","Bilateral"),
]
DONOR_PAL = ["#4FA9E8","#33C2B4","#9D7BEE","#F5A04D","#EC7BA6","#5399EA","#2CC4A0","#E0A93B",
 "#6FBF73","#EA8A5B","#C58BE0","#48B0C4","#D98CA0","#8FB84E","#E2B54A","#7E9BEA"]
# each donor gets a relationship Lead from the Donor-affiliated pool
donors = [{"id":i+1,"name":n,"short_name":s,"type_id":DTYPE_ID[t],"color":DONOR_PAL[i % len(DONOR_PAL)],
           "lead_id":donor_pool[i % len(donor_pool)]}
          for i,(n,s,t) in enumerate(DONOR_DEFS)]

# ---- Projects (plan-SCOPED) -------------------------------------------------
# A project belongs to a country AND a plan, is funded by a donor, has a budget
# and dates, and carries PRIMARY KPIs (that plan's inventory indicators, linked
# via project_kpi) and SECONDARY KPIs (project-local indicators). Some of the
# plan's activities (measurements) are attributed to the project.
PROJECT_THEMES = ["Primary Health Access","Maternal & Newborn Care","Child Nutrition",
 "Water, Sanitation & Hygiene","Basic Education Access","Teacher Development",
 "Girls' Education","Climate Early Warning","Land Restoration",
 "Smallholder Livelihoods","Youth Skills & Employment","Social Protection",
 "Disability Inclusion","Community Resilience"]
SEC_NAMES = [
 ("Community consultation sessions held","count"),
 ("Local officials trained on programme delivery","count"),
 ("Beneficiaries reached through field activities","count"),
 ("Village outreach points established","count"),
 ("Community satisfaction with services received","%"),
 ("Local partner organisations engaged","count"),
 ("Village development plans completed","count"),
 ("Grievances resolved within service standard","%"),
 ("Women participating in community sessions","count"),
 ("Frontline supply kits distributed","count"),
 ("District review meetings held with local authorities","count"),
 ("Field staff trained on safeguarding","count"),
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
        "id":iid,"result_id":None,"code":code,"name":nm,
        "type_id":KTYPE_ID["quantitative"],"unit_id":UNIT_ID[unit],
        "direction_id":DIR_ID["increase"],"secondary":1,"project_id":project_id,
        "baseline_value":base,"baseline_year":plan["baseline_year"],"baseline_date":plan["baseline_date"],
        "target_value":target,"target_year":plan["target_year"],"target_date":plan["target_date"],
        "means_of_verification":"Project monitoring records; field verification",
        "collection_method_id":METHOD_ID[pick(["Self-reporting","Survey","Administrative records"])],
        "frequency_id":FREQ_ID[pick(["monthly","quarterly"])],"responsible_id":None,
        "disaggregation_id":DISAGG_ID[pick(["none","sex","region"])],
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
                # Lead from the Projects-affiliated pool (activities still report via the country office)
                "lead_id":project_pool[(prj - 1) % len(project_pool)],
                "start_date":pick(plan["proj_starts"]),"end_date":pick(plan["proj_ends"]),
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
 "Primary Health Access":        ["Men","Women","Boys","Girls","Youth","Persons with Disabilities","Elderly"],
 "Maternal & Newborn Care":      ["Women","Girls"],
 "Child Nutrition":              ["Boys","Girls","Women"],
 "Water, Sanitation & Hygiene":  ["Men","Women","Boys","Girls","Youth","Persons with Disabilities","Elderly","Refugees","IDPs","Host community"],
 "Basic Education Access":       ["Boys","Girls","Youth","Persons with Disabilities"],
 "Teacher Development":          ["Men","Women","Youth"],
 "Girls' Education":             ["Girls","Women","Youth"],
 "Climate Early Warning":        ["Men","Women","Youth","Elderly","Persons with Disabilities","Host community"],
 "Land Restoration":             ["Men","Women","Youth","Host community"],
 "Smallholder Livelihoods":      ["Men","Women","Youth"],
 "Youth Skills & Employment":    ["Youth","Men","Women","Persons with Disabilities"],
 "Social Protection":            ["Men","Women","Boys","Girls","Elderly","Persons with Disabilities","Refugees","IDPs","Returnees","Host community"],
 "Disability Inclusion":         ["Persons with Disabilities","Men","Women","Boys","Girls","Youth","Elderly"],
 "Community Resilience":         ["Men","Women","Youth","Elderly","Refugees","IDPs","Returnees","Host community"],
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
    "affiliation":affiliations,
    "unit":units,
    "frequency":frequencies,
    "collection_method":collection_methods,
    "disaggregation":disaggregations,
    "kpi_type":kpi_types,
    "direction":directions,
    "donor_type":donor_types,
    "user_status":user_statuses,
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
