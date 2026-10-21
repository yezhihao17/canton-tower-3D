#!/usr/bin/env python3
"""
Build the compact Zhujiang New Town scene dataset from OpenStreetMap extracts.

Inputs are the raw Overpass JSON files in ../assets/data/raw (fetched with the
queries documented in README). Output is ../src/data/city-data.js.

Coordinate system: metres, x = east, z = south. Origin is the centre of the
Canton Tower footprint (lon 113.3191506, lat 23.1090162). y is up.
"""

import json
import math
import os
import random
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DATA = os.path.join(ROOT, "assets", "data", "raw")
OUT = os.path.join(ROOT, "src", "data", "city-data.js")

LON0 = 113.3191506
LAT0 = 23.1090162
M_PER_DEG_LAT = 111195.0
M_PER_DEG_LON = 102370.0

# Key OSM ids that are replaced with bespoke models in environment.js.
SKIP_BUILDING_IDS = {
    584204634,   # Canton Tower itself
    521222276,   # Canton Tower metro station
    620358651,   # Canton Tower APM station
    299687657,   # CTF Finance Centre complex (custom tower)
    240896441,   # Guangzhou Library (custom)
    240896442,   # Guangdong Museum (custom)
    157418082,   # CITIC Plaza apartment (custom CITIC complex nearby)
}

# Landmark coordinates resolved from the OSM tags. x,z in metres, h in metres.
LANDMARK_NAMES = {
    "westTower": "广州国际金融中心(广州西塔)",
    "pearlRiverTower": "珠江城大厦",
    "leatop": "利通广场",
    "guangSheng": "广晟国际大厦",
    "globalMetro": "环球都会广场",
    "yuexiuFin": "越秀金融中心",
    "rfYingkai": "富力盈凯广场",
    "gzBank": "广州银行大厦",
    "gfSecurities": "广发证券总部",
    "opera": "广州大剧院",
    "museum": "广东省博物馆",
    "library": "广州图书馆",
    "tianheSports": "天河体育中心",
}


def local(lon, lat):
    return ((lon - LON0) * M_PER_DEG_LON, -(lat - LAT0) * M_PER_DEG_LAT)


def round1(v):
    return round(v, 1)


def poly_area(pts):
    if len(pts) < 3:
        return 0.0
    s = 0.0
    for i in range(len(pts) - 1):
        s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return abs(s) * 0.5


def signed_area(pts):
    s = 0.0
    for i in range(len(pts) - 1):
        s += pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
    return s * 0.5


def centroid(pts):
    # Polygon centroid (fallback to average for degenerate rings).
    a = signed_area(pts)
    if abs(a) < 1e-9:
        xs = [p[0] for p in pts]
        zs = [p[1] for p in pts]
        return sum(xs) / len(xs), sum(zs) / len(zs)
    cx = 0.0
    cz = 0.0
    for i in range(len(pts) - 1):
        cross = pts[i][0] * pts[i + 1][1] - pts[i + 1][0] * pts[i][1]
        cx += (pts[i][0] + pts[i + 1][0]) * cross
        cz += (pts[i][1] + pts[i + 1][1]) * cross
    return cx / (6 * a), cz / (6 * a)


def point_in_ring(x, z, ring):
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, zi = ring[i]
        xj, zj = ring[j]
        if ((zi > z) != (zj > z)) and (
            x < (xj - xi) * (z - zi) / ((zj - zi) or 1e-12) + xi
        ):
            inside = not inside
        j = i
    return inside


def dist_point_segment(p, a, b):
    px, pz = p
    ax, az = a
    bx, bz = b
    dx = bx - ax
    dz = bz - az
    if dx == 0 and dz == 0:
        return math.hypot(px - ax, pz - az)
    t = ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz)
    t = max(0.0, min(1.0, t))
    return math.hypot(px - (ax + dx * t), pz - (az + dz * t))


def simplify(points, tol):
    """Douglas-Peucker on a polyline (closed rings keep first == last)."""
    if len(points) <= 3 or tol <= 0:
        return points
    closed = (
        abs(points[0][0] - points[-1][0]) < 1e-6
        and abs(points[0][1] - points[-1][1]) < 1e-6
    )
    pts = points[:-1] if closed else points
    if len(pts) <= 3:
        return points

    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        if j <= i + 1:
            continue
        ax, az = pts[i]
        bx, bz = pts[j]
        dx, dz = bx - ax, bz - az
        denom = math.hypot(dx, dz)
        best = -1.0
        idx = -1
        for k in range(i + 1, j):
            px, pz = pts[k]
            if denom < 1e-9:
                d = math.hypot(px - ax, pz - az)
            else:
                d = abs((px - ax) * dz - (pz - az) * dx) / denom
            if d > best:
                best = d
                idx = k
        if best > tol:
            keep[idx] = True
            stack.append((i, idx))
            stack.append((idx, j))

    out = [pts[k] for k in range(len(pts)) if keep[k]]
    if closed:
        out.append(out[0])
    return out


def parse_number(v):
    if v is None:
        return None
    m = re.search(r"-?\d+(?:\.\d+)?", str(v))
    if not m:
        return None
    try:
        return float(m.group())
    except ValueError:
        return None


def building_class(tags):
    t = (tags.get("building") or "").lower()
    if t in ("apartments", "residential", "dormitory", "house", "detached", "terrace", "bungalow"):
        return 0
    if t in ("commercial", "office", "retail", "hotel", "yes", "mixed"):
        return 1
    if t in ("school", "university", "college", "kindergarten", "hospital", "public", "museum", "theatre", "train_station", "transportation", "government", "civic"):
        return 2
    if t in ("industrial", "manufacture", "warehouse", "service", "garage", "garages", "parking", "roof", "terrace", "hut", "shed", "construction"):
        return 3
    return 1


def floor_height(tags):
    t = (tags.get("building") or "").lower()
    if t in ("office", "commercial", "hotel", "retail"):
        return 4.0
    if t in ("apartments", "residential", "dormitory", "house", "detached"):
        return 3.0
    return 3.3


def building_height(tags, area, rng):
    h = parse_number(tags.get("height"))
    if h is not None and 1.5 <= h <= 560:
        return h
    levels = parse_number(tags.get("building:levels")) or parse_number(tags.get("levels"))
    if levels is not None and 1 <= levels <= 130:
        return max(4.0, levels * floor_height(tags) + 1.5)

    t = (tags.get("building") or "yes").lower()
    name = tags.get("name") or ""
    # Named commercial towers with missing height: give them a plausible
    # high-rise mass so the skyline still reads correctly.
    if any(k in name for k in ("大厦", "金融", "广场", "中心", "国际")):
        if area > 1800:
            return 55.0 + rng.random() * 95.0
        if area > 800:
            return 35.0 + rng.random() * 50.0
    if t in ("apartments", "residential", "dormitory"):
        if area > 800:
            return 45.0 + rng.random() * 55.0
        if area > 350:
            return 28.0 + rng.random() * 42.0
        return 12.0 + rng.random() * 22.0
    if t in ("commercial", "office", "hotel", "retail"):
        if area > 2500:
            return 30.0 + rng.random() * 55.0
        if area > 800:
            return 22.0 + rng.random() * 60.0
        return 10.0 + rng.random() * 22.0
    if t in ("school", "university", "college", "hospital", "public", "government"):
        return 12.0 + rng.random() * 22.0
    if t in ("industrial", "manufacture", "warehouse", "service", "garage", "parking", "roof", "construction", "hut", "shed"):
        return 5.0 + rng.random() * 10.0
    if t in ("train_station", "transportation", "trn"):
        return 7.0 + rng.random() * 8.0
    if t in ("stadium", "grandstand"):
        return 15.0 + rng.random() * 12.0
    # generic yes
    if area > 1600:
        return 22.0 + rng.random() * 40.0
    if area > 500:
        return 12.0 + rng.random() * 24.0
    return 6.0 + rng.random() * 12.0


def road_class(tags):
    hw = tags.get("highway", "")
    if hw in ("motorway", "trunk", "motorway_link", "trunk_link"):
        return 2
    if hw in ("primary", "secondary", "tertiary", "primary_link", "secondary_link", "tertiary_link"):
        return 1
    if hw in ("pedestrian", "living_street"):
        return 3
    return 0


def road_width(tags):
    hw = tags.get("highway", "")
    width = parse_number(tags.get("width"))
    if width and 2 <= width <= 60:
        return width
    lanes = parse_number(tags.get("lanes"))
    defaults = {
        "motorway": 30.0, "trunk": 26.0, "motorway_link": 12.0, "trunk_link": 12.0,
        "primary": 20.0, "primary_link": 10.0,
        "secondary": 16.0, "secondary_link": 9.0,
        "tertiary": 12.0, "tertiary_link": 8.0,
        "residential": 8.0, "unclassified": 8.0, "living_street": 6.0,
        "pedestrian": 8.0, "service": 5.0,
    }
    w = defaults.get(hw, 7.0)
    if lanes is not None:
        w = max(w, min(44.0, lanes * 3.3 + 2.5))
    return w


def clip_ring_rect(ring, xmin, xmax, zmin, zmax):
    """Sutherland-Hodgman clip of a closed ring against an axis rect."""
    if not ring:
        return []
    # Drop the duplicate closing point before clipping.
    pts = list(ring)
    if len(pts) > 1 and abs(pts[0][0] - pts[-1][0]) < 1e-6 and abs(pts[0][1] - pts[-1][1]) < 1e-6:
        pts = pts[:-1]

    def clip_edge(poly, inside, intersect):
        out = []
        if not poly:
            return out
        prev = poly[-1]
        prev_in = inside(prev)
        for cur in poly:
            cur_in = inside(cur)
            if cur_in:
                if not prev_in:
                    out.append(intersect(prev, cur))
                out.append(cur)
            elif prev_in:
                out.append(intersect(prev, cur))
            prev = cur
            prev_in = cur_in
        return out

    def ix_vertical(a, b, x):
        t = (x - a[0]) / (b[0] - a[0]) if abs(b[0] - a[0]) > 1e-12 else 0.0
        return (x, a[1] + (b[1] - a[1]) * t)

    def ix_horizontal(a, b, z):
        t = (z - a[1]) / (b[1] - a[1]) if abs(b[1] - a[1]) > 1e-12 else 0.0
        return (a[0] + (b[0] - a[0]) * t, z)

    pts = clip_edge(pts, lambda p: p[0] >= xmin, lambda a, b: ix_vertical(a, b, xmin))
    pts = clip_edge(pts, lambda p: p[0] <= xmax, lambda a, b: ix_vertical(a, b, xmax))
    pts = clip_edge(pts, lambda p: p[1] >= zmin, lambda a, b: ix_horizontal(a, b, zmin))
    pts = clip_edge(pts, lambda p: p[1] <= zmax, lambda a, b: ix_horizontal(a, b, zmax))
    if len(pts) >= 3:
        pts.append(pts[0])
    return pts


def stitch_ways(ways):
    """Stitch OSM way geometries (lists of (x,z)) into closed rings."""
    segments = []
    for w in ways:
        if len(w) < 2:
            continue
        pts = [tuple(p) for p in w]
        # Remove consecutive duplicates.
        clean = [pts[0]]
        for p in pts[1:]:
            if math.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 0.01:
                clean.append(p)
        if len(clean) >= 2:
            segments.append(clean)

    rings = []
    while segments:
        cur = segments.pop(0)
        changed = True
        while changed and segments:
            changed = False
            for i, seg in enumerate(segments):
                if math.hypot(cur[-1][0] - seg[0][0], cur[-1][1] - seg[0][1]) < 0.8:
                    cur.extend(seg[1:])
                    segments.pop(i)
                    changed = True
                    break
                if math.hypot(cur[-1][0] - seg[-1][0], cur[-1][1] - seg[-1][1]) < 0.8:
                    cur.extend(reversed(seg[:-1]))
                    segments.pop(i)
                    changed = True
                    break
                if math.hypot(cur[0][0] - seg[-1][0], cur[0][1] - seg[-1][1]) < 0.8:
                    cur = seg[:-1] + cur
                    segments.pop(i)
                    changed = True
                    break
                if math.hypot(cur[0][0] - seg[0][0], cur[0][1] - seg[0][1]) < 0.8:
                    cur = list(reversed(seg[1:])) + cur
                    segments.pop(i)
                    changed = True
                    break
        if len(cur) > 3:
            if math.hypot(cur[0][0] - cur[-1][0], cur[0][1] - cur[-1][1]) > 0.8:
                cur.append(cur[0])
            rings.append(cur)
    return rings


def load(name):
    path = os.path.join(DATA, name)
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def main():
    buildings_raw = load("buildings-raw.json")
    roads_raw = load("roads-raw.json")
    parks_raw = load("parks-raw.json")
    water_raw = load("water-raw.json")

    # ------------------------------------------------------------------
    # Water: river outer rings + islands + small ponds
    # ------------------------------------------------------------------
    river_rings = []
    island_rings = []
    pond_rings = []

    for e in water_raw["elements"]:
        if e.get("type") == "relation" and e.get("tags", {}).get("water") == "river":
            outer_ways = []
            inner_ways = []
            for m in e.get("members", []):
                g = m.get("geometry") or []
                if not g:
                    continue
                pts = [local(p["lon"], p["lat"]) for p in g]
                if m.get("role") == "outer":
                    outer_ways.append(pts)
                elif m.get("role") == "inner":
                    inner_ways.append(pts)
            river_rings.extend(stitch_ways(outer_ways))
            island_rings.extend(stitch_ways(inner_ways))
        elif e.get("type") == "way":
            tags = e.get("tags", {})
            if tags.get("natural") == "water" or tags.get("waterway") == "riverbank":
                g = e.get("geometry") or []
                if len(g) >= 4:
                    pts = [local(p["lon"], p["lat"]) for p in g]
                    if pts[0] != pts[-1]:
                        pts.append(pts[0])
                    pond_rings.append(simplify(pts, 0.8))

    # Simplify and quantise the river / island / pond rings.
    def clean_ring(ring, tol=1.0):
        ring = simplify(ring, tol)
        ring = [(round1(x), round1(z)) for x, z in ring]
        # Drop duplicate closing point for JSON; JS closes rings.
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring = ring[:-1]
        return ring

    river_rings = [
        clean_ring(clip_ring_rect(r, -6500, 6500, -1900, 1500), 1.2)
        for r in river_rings if len(r) >= 4
    ]
    river_rings = [r for r in river_rings if len(r) >= 4]
    island_rings = [
        clean_ring(clip_ring_rect(r, -6500, 6500, -1900, 1500), 1.0)
        for r in island_rings if len(r) >= 4
    ]
    island_rings = [r for r in island_rings if len(r) >= 4]
    pond_rings = [
        clean_ring(clip_ring_rect(r, -4500, 4500, -4500, 1500), 0.8)
        for r in pond_rings if len(r) >= 4
    ]
    pond_rings = [r for r in pond_rings if len(r) >= 4]

    # Keep the scene relevant water bodies (main river + islands + ponds near axis).
    river_rings = [
        r for r in river_rings
        if max(p[0] for p in r) > -4500 and min(p[0] for p in r) < 4500
        and max(p[1] for p in r) > -1200 and min(p[1] for p in r) < 1000
    ]
    island_rings = [
        r for r in island_rings
        if max(p[0] for p in r) > -4500 and min(p[0] for p in r) < 4500
        and max(p[1] for p in r) > -1200 and min(p[1] for p in r) < 1000
    ]
    pond_rings = [
        r for r in pond_rings
        if max(p[0] for p in r) > -2500 and min(p[0] for p in r) < 2500
        and max(p[1] for p in r) > -3000 and min(p[1] for p in r) < 1200
        and poly_area(r) > 120
    ]

    # ------------------------------------------------------------------
    # Buildings
    # ------------------------------------------------------------------
    buildings = []
    landmark_centers = {}
    landmark_heights = {}
    skipped_water = 0
    skipped_small = 0

    def is_water(x, z):
        in_river = any(point_in_ring(x, z, r) for r in river_rings)
        if not in_river:
            return False
        # Islands are land even though they sit inside the river polygon.
        in_island = any(point_in_ring(x, z, r) for r in island_rings)
        return not in_island

    for e in buildings_raw["elements"]:
        if e.get("type") != "way":
            continue
        if e.get("id") in SKIP_BUILDING_IDS:
            continue
        tags = e.get("tags", {})
        geom = e.get("geometry") or []
        if len(geom) < 3:
            continue
        btype = (tags.get("building") or "").lower()
        if btype in ("no", "roof") and not tags.get("height"):
            continue
        if tags.get("layer") is not None:
            try:
                if int(tags.get("layer")) < 0:
                    continue
            except Exception:
                pass
        name = tags.get("name") or ""
        if "广州塔" in name:
            continue

        pts = [local(p["lon"], p["lat"]) for p in geom]
        if pts[0] != pts[-1]:
            pts.append(pts[0])
        area = poly_area(pts)
        if area < 14:
            skipped_small += 1
            continue
        cx, cz = centroid(pts)
        if is_water(cx, cz):
            skipped_water += 1
            continue
        # Ignore remote specks that add noise at the edge of the scene.
        if abs(cx) > 4200 or cz > 1600 or cz < -4800:
            continue

        pts = simplify(pts, 1.0)
        if len(pts) > 120:
            pts = simplify(pts, 2.0)
        pts = [(round1(x), round1(z)) for x, z in pts]
        if len(pts) > 1 and pts[0] == pts[-1]:
            pts = pts[:-1]
        if len(pts) < 3:
            continue

        rng = random.Random(e["id"])
        h = building_height(tags, area, rng)
        # Cap absurd generic slabs, but keep the known tall towers.
        if h > 520:
            h = 520.0
        k = building_class(tags)
        seed = round(rng.random(), 3)
        footprint = []
        for x, z in pts:
            footprint.append(round1(x))
            footprint.append(round1(z))
        buildings.append([round1(h), k, seed, footprint])

        # First occurrence wins for landmark names.
        if name and name not in landmark_centers:
            landmark_centers[name] = (round1(cx), round1(cz))
            landmark_heights[name] = round1(h)

    # The list comprehension above is intentionally compact but error-prone;
    # rebuild the footprint flat list explicitly.
    fixed = []
    for b in buildings:
        h, k, seed, p = b
        fixed.append([h, k, seed, p])
    buildings = fixed

    # ------------------------------------------------------------------
    # Roads
    # ------------------------------------------------------------------
    roads = []
    bridge_names = {
        "广州大桥", "猎德大桥", "海心桥", "华南大桥", "琶洲大桥", "海印大桥",
        "广州大桥新桥",
    }
    for e in roads_raw["elements"]:
        if e.get("type") != "way":
            continue
        tags = e.get("tags", {})
        if tags.get("tunnel"):
            continue
        try:
            if tags.get("layer") is not None and int(tags.get("layer")) < 0:
                continue
        except Exception:
            pass
        if tags.get("construction") or tags.get("proposed"):
            continue
        name = tags.get("name") or ""
        if name in bridge_names:
            continue
        hw = tags.get("highway")
        if hw not in (
            "motorway", "trunk", "primary", "secondary", "tertiary",
            "residential", "unclassified", "living_street", "pedestrian",
            "service", "motorway_link", "trunk_link", "primary_link",
            "secondary_link", "tertiary_link",
        ):
            continue
        geom = e.get("geometry") or []
        if len(geom) < 2:
            continue
        pts = [local(p["lon"], p["lat"]) for p in geom]
        # Clip to the scene bounds (with a generous margin).
        if all(x < -4200 or x > 4200 or z < -5000 or z > 1800 for x, z in pts):
            continue
        pts = simplify(pts, 1.2)
        pts = [(round1(x), round1(z)) for x, z in pts]
        if len(pts) < 2:
            continue
        k = road_class(tags)
        w = road_width(tags)
        roads.append([k, round1(w), [x for p in pts for x in p]])

    # ------------------------------------------------------------------
    # Parks / green areas
    # ------------------------------------------------------------------
    parks = []
    for e in parks_raw["elements"]:
        if e.get("type") == "relation":
            geoms = []
            for m in e.get("members", []):
                g = m.get("geometry") or []
                if g and m.get("role") in (None, "", "outer"):
                    geoms.append([local(p["lon"], p["lat"]) for p in g])
        else:
            g = e.get("geometry") or []
            geoms = [[local(p["lon"], p["lat"]) for p in g]] if g else []
        if not geoms:
            continue
        tags = e.get("tags", {})
        leisure = tags.get("leisure") or ""
        landuse = tags.get("landuse") or ""
        natural = tags.get("natural") or ""
        if leisure == "pitch":
            kind = 1
        elif leisure in ("park", "garden", "stadium", "sports_centre", "playground") or landuse in ("grass", "recreation_ground", "forest", "meadow", "village_green") or natural in ("wood", "scrub"):
            kind = 0
        else:
            continue
        for pts in geoms:
            if len(pts) < 4:
                continue
            if pts[0] != pts[-1]:
                pts.append(pts[0])
            area = poly_area(pts)
            if area < 180:
                continue
            cx, cz = centroid(pts)
            if abs(cx) > 4500 or cz > 1600 or cz < -5000:
                continue
            if any(point_in_ring(cx, cz, r) for r in river_rings) and not any(point_in_ring(cx, cz, r) for r in island_rings):
                continue
            pts = simplify(pts, 1.4)
            pts = [(round1(x), round1(z)) for x, z in pts]
            if len(pts) > 1 and pts[0] == pts[-1]:
                pts = pts[:-1]
            if len(pts) < 3:
                continue
            parks.append([kind, [x for p in pts for x in p]])

    # ------------------------------------------------------------------
    # Landmarks
    # ------------------------------------------------------------------
    landmarks = {
        "eastTower": [166.0, -1280.0, 530.0],
        "westTower": [-133.0, -1250.0, 440.2],
        "citic": [25.0, -3975.0, 390.0],
        "opera": [-118.0, -995.0, 43.0],
        "museum": [232.0, -934.0, 28.0],
        "library": [147.0, -1093.0, 30.0],
        "haixinsha": [70.0, -555.0, 22.0],
        "flowerCity": [3.0, -1508.0, 6.0],
        "guangzhouBridge": [-930.0, -450.0, 20.0],
        "liedeBridge": [950.0, -650.0, 150.0],
        "haixinBridge": [-468.0, -240.0, 62.0],
        "huananBridge": [2743.0, -650.0, 150.0],
        "tianheSports": [0.0, -3400.0, 30.0],
    }
    for key, name in LANDMARK_NAMES.items():
        if name in landmark_centers:
            cx, cz = landmark_centers[name]
            h = landmark_heights.get(name, 30.0)
            if key == "yuexiuFin":
                h = 309.0
            landmarks[key] = [cx, cz, h]

    # ------------------------------------------------------------------
    # Emit
    # ------------------------------------------------------------------
    data = {
        "meta": {
            "origin": [LON0, LAT0],
            "source": "OpenStreetMap contributors",
            "license": "ODbL 1.0",
            "note": "Local metres: x=east, z=south, y=up",
        },
        "buildings": buildings,
        "roads": roads,
        "parks": parks,
        "water": {
            "rivers": river_rings,
            "islands": island_rings,
            "ponds": pond_rings,
        },
        "landmarks": landmarks,
    }

    js = (
        "// Generated by scripts/build_city_data.py from OpenStreetMap data.\n"
        "// © OpenStreetMap contributors, ODbL 1.0. See https://www.openstreetmap.org/copyright\n"
        "export const CITY_DATA = "
        + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(js)

    size = os.path.getsize(OUT)
    print(f"wrote {OUT} ({size/1024/1024:.2f} MB)")
    print(f"buildings={len(buildings)} roads={len(roads)} parks={len(parks)}")
    print(f"water rivers={len(river_rings)} islands={len(island_rings)} ponds={len(pond_rings)}")
    print(f"skipped water buildings={skipped_water}, tiny={skipped_small}")
    hs = sorted([b[0] for b in buildings], reverse=True)
    print("tallest buildings:", hs[:15])
    print("landmarks:", json.dumps(landmarks, ensure_ascii=False))


if __name__ == "__main__":
    main()
