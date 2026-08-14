import json, sys

src = json.load(open('assets/world_raw.geojson', encoding='utf-8'))
countries = []
for f in src['features']:
    p = f['properties']
    name = p.get('ADMIN') or p.get('NAME') or p.get('SOVEREIGNT')
    iso = p.get('ISO_A3') or p.get('ADM0_A3') or ''
    geom = f['geometry']
    if not geom: continue
    polys = []
    if geom['type'] == 'Polygon':
        raw = [geom['coordinates']]
    elif geom['type'] == 'MultiPolygon':
        raw = geom['coordinates']
    else:
        continue
    # each poly = list of rings; keep only outer ring (ring[0]) to save size
    best_area = 0; centroid = None
    for poly in raw:
        ring = poly[0]
        # round to 1 decimal
        rr = []
        last = None
        for x, y in ring:
            pt = [round(x,1), round(y,1)]
            if pt != last:
                rr.append(pt); last = pt
        if len(rr) < 4: 
            continue
        polys.append(rr)
        # shoelace area + centroid
        area = 0; cx = 0; cy = 0
        for i in range(len(rr)-1):
            x0,y0 = rr[i]; x1,y1 = rr[i+1]
            cross = x0*y1 - x1*y0
            area += cross; cx += (x0+x1)*cross; cy += (y0+y1)*cross
        area *= 0.5
        if abs(area) > 1e-9:
            c = [cx/(6*area), cy/(6*area)]
        else:
            c = rr[0]
        if abs(area) > best_area:
            best_area = abs(area); centroid = c
    if not polys: continue
    countries.append({'name':name,'iso':iso,'c':[round(centroid[0],2),round(centroid[1],2)],'p':polys})

out = {'countries': countries}
js = 'window.WORLD=' + json.dumps(out, separators=(',',':')) + ';'
open('data/world.js','w',encoding='utf-8').write(js)
print('countries:', len(countries))
print('bytes:', len(js))
