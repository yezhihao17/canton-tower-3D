import json, math
LON0, LAT0 = 113.3191506, 23.1090162
MLAT = 111195.0
MLON = 102370.0
def xy(lon, lat):
    return ((lon-LON0)*MLON, -(lat-LAT0)*MLAT)

def bbox_coords(geom):
    return [xy(p['lon'], p['lat']) for p in geom]

def path(pts, close=True):
    if not pts: return ''
    d = 'M ' + ' L '.join(f'{x:.1f},{y:.1f}' for x,y in pts)
    if close: d += ' Z'
    return d

svg = []
W,H = 1200,1200
# world range x -1500..1500, z -3000..1000 => y
# scale
xmin,xmax = -1600,1600
zmin,zmax = -3200,800
sx = W/(xmax-xmin); sy = H/(zmax-zmin)
def sv(x,y):
    return ((x-xmin)*sx, (y-zmin)*sy)  # y is z
def path2(pts, close=True):
    if not pts: return ''
    d='M '+' L '.join(f'{sv(x,y)[0]:.1f},{sv(x,y)[1]:.1f}' for x,y in pts)
    if close: d+=' Z'
    return d

def add(el):
    svg.append(el)

add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="#0a1016"/>')

# water
water=json.load(open('data/water-raw.json'))
for e in water['elements']:
    if e['type']=='way':
        g=e.get('geometry')
        if not g: continue
        pts=[xy(p['lon'],p['lat']) for p in g]
        add(f'<path d="{path2(pts)}" fill="#1a4b63" stroke="#2a7a99" stroke-width="0.5"/>')
    else:
        for m in e.get('members',[]):
            g=m.get('geometry') or []
            if not g: continue
            pts=[xy(p['lon'],p['lat']) for p in g]
            col='#1a4b63' if m.get('role')=='outer' else '#0a1016'
            add(f'<path d="{path2(pts)}" fill="{col}" stroke="#2a7a99" stroke-width="0.5"/>')

# parks
parks=json.load(open('data/parks-raw.json'))
for e in parks['elements']:
    if e['type']=='way':
        g=e.get('geometry')
        if not g: continue
        pts=[xy(p['lon'],p['lat']) for p in g]
        if len(pts)>2:
            add(f'<path d="{path2(pts)}" fill="#163d27" stroke="#1c5a37" stroke-width="0.3" opacity="0.9"/>')

# buildings
b=json.load(open('data/buildings-raw.json'))
for e in b['elements']:
    g=e.get('geometry')
    if not g or len(g)<3: continue
    pts=[xy(p['lon'],p['lat']) for p in g]
    h=0
    t=e.get('tags',{})
    try: h=float(t.get('height') or 0)
    except: pass
    if not h:
        try: h=float(t.get('building:levels') or 0)*3.2
        except: h=0
    if h<=0: h=8
    col = '#2c3a45' if h<60 else '#485d6e' if h<150 else '#7897ad' if h<250 else '#a9e2ff'
    add(f'<path d="{path2(pts)}" fill="{col}" stroke="#0b131a" stroke-width="0.3"/>')

# roads
roads=json.load(open('data/roads-raw.json'))
widths={'motorway':7,'trunk':6,'primary':4.5,'secondary':3.5,'tertiary':2.5,'residential':1.5,'unclassified':1.3,'living_street':1.2,'pedestrian':1.2,'service':0.7}
for e in roads['elements']:
    g=e.get('geometry')
    if not g: continue
    t=e.get('tags',{})
    if t.get('tunnel') or t.get('layer','') and int(t.get('layer','0') or 0)<0: continue
    pts=[xy(p['lon'],p['lat']) for p in g]
    hw=t.get('highway'); w=widths.get(hw,1.0)
    col='#d9a441' if hw in ('motorway','trunk') else '#a8874b' if hw in ('primary','secondary') else '#6f6350'
    add(f'<path d="{path2(pts,False)}" fill="none" stroke="{col}" stroke-width="{max(w,0.6)}" opacity="0.9"/>')

# tower
tx,ty=xy(LON0,LAT0)
sx0,sy0=sv(tx,ty)
add(f'<circle cx="{sx0}" cy="{sy0}" r="5" fill="#ff3355" stroke="#fff" stroke-width="1"/>')
add(f'<text x="{sx0+8}" y="{sy0}" fill="#fff" font-size="12">Canton Tower</text>')

# axes
add(f'<line x1="0" y1="{sv(0,0)[1]}" x2="0" y2="{sv(0,-2500)[1]}" stroke="#ff00ff" stroke-width="0.7" stroke-dasharray="4 4" opacity="0.6"/>')
add(f'<line x1="0" y1="{sv(0,-720)[1]}" x2="0" y2="{sv(0,-2300)[1]}" stroke="#00ffff" stroke-width="0.7" stroke-dasharray="4 4" opacity="0.4"/>')

add(f'<text x="10" y="20" fill="#fff" font-size="14">Zhujiang New Town OSM map · local meters · red=Canton Tower</text>')
add('</svg>')
open('data/map.svg','w').write('\n'.join(svg))
print('wrote', len(svg), 'elements')

# report extents and key info
