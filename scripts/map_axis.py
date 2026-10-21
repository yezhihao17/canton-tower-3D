import json, math
LON0, LAT0 = 113.3191506, 23.1090162
MLAT, MLON = 111195.0, 102370.0
def xy(lon,lat): return ((lon-LON0)*MLON, -(lat-LAT0)*MLAT)
xmin,xmax=-500,500; zmin,zmax=-2600,200
W,H=900,2200; sx=W/(xmax-xmin); sy=H/(zmax-zmin)
def sv(x,y): return ((x-xmin)*sx,(y-zmin)*sy)
def path(pts,close=True):
    d='M '+' L '.join(f'{sv(x,y)[0]:.1f},{sv(x,y)[1]:.1f}' for x,y in pts)
    return d+(' Z' if close else '')
svg=[f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"><rect width="100%" height="100%" fill="#0a1016"/>']
# grid
for z in range(0,-2601,-200):
    y=sv(0,z)[1]
    svg.append(f'<line x1="0" y1="{y:.1f}" x2="{W}" y2="{y:.1f}" stroke="#203040" stroke-width="0.5"/>')
    svg.append(f'<text x="4" y="{y-3:.1f}" fill="#4c7084" font-size="10">z={z}</text>')
for x in range(-400,401,200):
    xx=sv(x,0)[0]
    svg.append(f'<line x1="{xx:.1f}" y1="0" x2="{xx:.1f}" y2="{H}" stroke="#203040" stroke-width="0.5"/>')
    svg.append(f'<text x="{xx+2:.1f}" y="12" fill="#4c7084" font-size="10">x={x}</text>')
# water
water=json.load(open('data/water-raw.json'))
for e in water['elements']:
    if e['type']=='relation' and e.get('tags',{}).get('water')=='river':
        for m in e['members']:
            g=m.get('geometry') or []
            if not g: continue
            pts=[xy(p['lon'],p['lat']) for p in g]
            col='#1a4b63' if m.get('role')=='outer' else '#0a1016'
            svg.append(f'<path d="{path(pts)}" fill="{col}" stroke="#2a7a99" stroke-width="0.5"/>')
# parks
parks=json.load(open('data/parks-raw.json'))
for e in parks['elements']:
    if e['type']=='way':
        g=e.get('geometry')
        if not g: continue
        pts=[xy(p['lon'],p['lat']) for p in g]
        if len(pts)>2:
            svg.append(f'<path d="{path(pts)}" fill="#163d27" stroke="#1c5a37" stroke-width="0.3" opacity="0.85"/>')
# roads
roads=json.load(open('data/roads-raw.json'))
widths={'motorway':7,'trunk':6,'primary':4.5,'secondary':3.5,'tertiary':2.5,'residential':1.5,'unclassified':1.3,'living_street':1.2,'pedestrian':1.2,'service':0.7}
for e in roads['elements']:
    g=e.get('geometry'); t=e.get('tags',{})
    if not g or t.get('tunnel'): continue
    pts=[xy(p['lon'],p['lat']) for p in g]
    hw=t.get('highway'); w=widths.get(hw,1)
    col='#d9a441' if hw in ('motorway','trunk') else '#a8874b' if hw in ('primary','secondary') else '#5f5545'
    svg.append(f'<path d="{path(pts,False)}" fill="none" stroke="{col}" stroke-width="{max(w*1.2,0.6)}" opacity="0.9"/>')
# buildings with names and heights
b=json.load(open('data/buildings-raw.json'))
for e in b['elements']:
    g=e.get('geometry'); t=e.get('tags',{})
    if not g or len(g)<3: continue
    pts=[xy(p['lon'],p['lat']) for p in g]
    if max(p[1] for p in pts)<zmin or min(p[1] for p in pts)>zmax or max(p[0] for p in pts)<xmin or min(p[0] for p in pts)>xmax: continue
    h=0
    try: h=float(t.get('height') or 0)
    except: pass
    if not h:
        try: h=float(t.get('building:levels') or 0)*3.2
        except: h=0
    if h<=0: h=8
    col = '#2c3a45' if h<60 else '#485d6e' if h<150 else '#7897ad' if h<250 else '#b9efff'
    svg.append(f'<path d="{path(pts)}" fill="{col}" stroke="#0b131a" stroke-width="0.3"/>')
    n=t.get('name')
    if n and ('塔' in n or '广场' in n or '中心' in n or '图书馆' in n or '博物馆' in n or '大剧院' in n or '中信' in n or '金融' in n or '体育' in n):
        cx=sum(p[0] for p in pts)/len(pts); cz=sum(p[1] for p in pts)/len(pts)
        X,Y=sv(cx,cz)
        if -50<X<W+100 and -20<Y<H+20:
            svg.append(f'<text x="{X:.0f}" y="{Y:.0f}" fill="#cfe" font-size="11" text-anchor="middle">{n}</text>')
# tower
X,Y=sv(0,0)
svg.append(f'<circle cx="{X}" cy="{Y}" r="6" fill="#ff3355" stroke="#fff" stroke-width="1.5"/>')
svg.append(f'<text x="{X+10}" y="{Y+4}" fill="#fff" font-size="13">Canton Tower 0,0</text>')
# bridges lines from OSM roads named
for e in roads['elements']:
    t=e.get('tags',{}); n=t.get('name','')
    if any(k in n for k in ['广州大桥','猎德大桥','海心桥']):
        g=e.get('geometry')
        if not g: continue
        pts=[xy(p['lon'],p['lat']) for p in g]
        svg.append(f'<path d="{path(pts,False)}" fill="none" stroke="#ff66cc" stroke-width="3" opacity="0.8"/>')
        if len(pts)>1:
            mid=pts[len(pts)//2]; X,Y=sv(*mid)
            svg.append(f'<text x="{X:.0f}" y="{Y:.0f}" fill="#ff99dd" font-size="12">{n}</text>')
svg.append('</svg>')
open('data/map-axis.svg','w').write('\n'.join(svg))
print('ok')
