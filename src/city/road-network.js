import { clamp, flatPoints, chaikin } from '../core/utils.js';

/* ============================================================
   道路采样
   ============================================================ */

export function buildRoad(pts, width, kind) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }

  // 每个节点的转角（0 = 直线）。车辆据此在弯道前主动减速。
  const curve = new Array(pts.length).fill(0);
  for (let i = 1; i < pts.length - 1; i++) {
    const ax = pts[i].x - pts[i - 1].x;
    const az = pts[i].z - pts[i - 1].z;
    const bx = pts[i + 1].x - pts[i].x;
    const bz = pts[i + 1].z - pts[i].z;
    const la = Math.hypot(ax, az) || 1;
    const lb = Math.hypot(bx, bz) || 1;
    const dot = clamp((ax * bx + az * bz) / (la * lb), -1, 1);
    curve[i] = Math.acos(dot);
  }

  return {
    pts,
    cum,
    curve,
    total: cum[cum.length - 1],
    width,
    kind,
    lights: [],
    minDist: 0,
  };
}

/* 采样 d 附近的最大转角，用于弯道限速 */
export function curvatureAt(road, d, lookahead = 12) {
  const n = road.pts.length;
  let maxAngle = 0;
  for (const off of [0, lookahead * 0.5, lookahead]) {
    const dd = ((d + off) % road.total + road.total) % road.total;
    let lo = 1;
    let hi = road.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (road.cum[mid] < dd) lo = mid + 1;
      else hi = mid;
    }
    // 取相邻两个节点，避免车辆正好错过转角
    maxAngle = Math.max(maxAngle, road.curve[lo - 1] || 0, road.curve[lo] || 0);
  }
  return maxAngle;
}

const _sample = { x: 0, z: 0, dx: 0, dz: 0 };

export function sampleRoad(road, d) {
  const { pts, cum } = road;
  const total = road.total;
  d = ((d % total) + total) % total;

  let lo = 1;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < d) lo = mid + 1;
    else hi = mid;
  }

  const a = pts[lo - 1];
  const b = pts[lo];
  const seg = Math.max(0.001, cum[lo] - cum[lo - 1]);
  const u = clamp((d - cum[lo - 1]) / seg, 0, 1);

  _sample.x = a.x + (b.x - a.x) * u;
  _sample.z = a.z + (b.z - a.z) * u;
  _sample.dx = (b.x - a.x) / seg;
  _sample.dz = (b.z - a.z) / seg;
  return _sample;
}

/* 沿道路走廊挑选适合跑车的路段 */
export function collectRoads(data) {
  const roads = [];

  for (const [kind, width, flat] of data.roads) {
    if (kind > 1 || width < 7) continue;
    const raw = flatPoints(flat);
    if (raw.length < 2) continue;

    let minDist = Infinity;
    for (const p of raw) {
      const d = Math.hypot(p.x, p.z);
      if (d < minDist) minDist = d;
    }
    if (minDist > 1550) continue;

    // 先把折线打磨圆润，再由车辆沿平滑轨迹行驶；
    // 道路路面仍然是原始 OSM 轮廓，弯道处的偏差控制在 1~2 米内。
    const smooth = chaikin(raw, raw.length > 3 ? 1 : 0);
    const road = buildRoad(smooth, width, kind);
    if (road.total < 160) continue;
    road.minDist = minDist;
    // 与道路纹理的车道线对齐：支路单车道，干道内外两条车道
    road.laneOffsets =
      kind === 1 && width >= 9.5 ? [0.075, 0.26] : [0.24];
    road.laneCount = road.laneOffsets.length;
    roads.push(road);
  }

  return roads;
}

/* ============================================================
   路口筛选
   ============================================================ */

export function segmentIntersection(a, b, c, d) {
  const rx = b.x - a.x;
  const rz = b.z - a.z;
  const sx = d.x - c.x;
  const sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;

  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;

  return { x: a.x + rx * t, z: a.z + rz * t, t, u };
}

export function findIntersections(roads, rand) {
  const items = [];

  for (let r = 0; r < roads.length; r++) {
    const road = roads[r];
    for (let i = 1; i < road.pts.length; i++) {
      const a = road.pts[i - 1];
      const b = road.pts[i];
      if (Math.hypot(b.x - a.x, b.z - a.z) < 3) continue;
      const cx = (a.x + b.x) * 0.5;
      const cz = (a.z + b.z) * 0.5;
      if (cx * cx + cz * cz > 1400 * 1400) continue;
      items.push({ road: r, i, a, b });
    }
  }

  const CELL = 80;
  const grid = new Map();
  items.forEach((it, idx) => {
    const minx = Math.min(it.a.x, it.b.x);
    const maxx = Math.max(it.a.x, it.b.x);
    const minz = Math.min(it.a.z, it.b.z);
    const maxz = Math.max(it.a.z, it.b.z);
    for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++) {
      for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
        const key = `${cx},${cz}`;
        let arr = grid.get(key);
        if (!arr) {
          arr = [];
          grid.set(key, arr);
        }
        arr.push(idx);
      }
    }
  });

  const raw = [];
  const seen = new Set();
  for (const arr of grid.values()) {
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const ia = arr[i];
        const ib = arr[j];
        if (ia >= ib) continue;
        const key = `${ia}-${ib}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const sa = items[ia];
        const sb = items[ib];
        if (sa.road === sb.road) continue;

        const hit = segmentIntersection(sa.a, sa.b, sb.a, sb.b);
        if (hit) raw.push({ ...hit, A: sa, B: sb });
      }
    }
  }

  // 同一路口的多个交点合并
  const merged = [];
  for (const hit of raw) {
    let target = null;
    for (const m of merged) {
      if ((m.x - hit.x) ** 2 + (m.z - hit.z) ** 2 < 26 * 26) {
        target = m;
        break;
      }
    }
    if (target) {
      target.roads.push(hit);
      target.x = (target.x * target.count + hit.x) / (target.count + 1);
      target.z = (target.z * target.count + hit.z) / (target.count + 1);
      target.count++;
    } else {
      merged.push({ x: hit.x, z: hit.z, count: 1, roads: [hit] });
    }
  }

  // 优先靠近广州塔、路网等级高、且彼此拉开距离的路口
  const scored = merged
    .map((m) => {
      let best = 0;
      for (const hit of m.roads) {
        const ra = roads[hit.A.road];
        const rb = roads[hit.B.road];
        best = Math.max(best, (2 - ra.kind) + (2 - rb.kind));
      }
      const dist = Math.hypot(m.x, m.z);
      return { ...m, score: best - dist / 1800 + rand() * 0.35, dist };
    })
    .sort((a, b) => b.score - a.score);

  const picked = [];
  for (const m of scored) {
    if (picked.length >= 26) break;
    if (m.dist < 80) continue;
    if (picked.some((p) => (p.x - m.x) ** 2 + (p.z - m.z) ** 2 < 130 * 130)) continue;
    picked.push(m);
  }

  return picked;
}
