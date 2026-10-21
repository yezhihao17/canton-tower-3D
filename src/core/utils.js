/* 通用数学 / 几何工具 */

export const TAU = Math.PI * 2;

export function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function flatPoints(flat) {
  const out = [];
  // 数据可能来自建筑/道路的扁平数组，也可能是水域环的 [x, z] 点对。
  if (flat.length && Array.isArray(flat[0])) {
    for (const p of flat) out.push({ x: p[0], z: p[1] });
    return out;
  }
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ x: flat[i], z: flat[i + 1] });
  }
  return out;
}

export function ringArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.z - b.x * a.z;
  }
  return s * 0.5;
}

export function pointInRing(x, z, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const zi = pts[i].z;
    const xj = pts[j].x;
    const zj = pts[j].z;
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi || 1e-9) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function centroidOf(pts) {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p.x;
    z += p.z;
  }
  return { x: x / pts.length, z: z / pts.length };
}

export function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/* Chaikin 曲线细分：把 OSM 折线打磨成适合车辆行驶的顺滑轨迹。
   端点保持不变，避免道路两端出现空隙。 */
export function chaikin(points, iterations = 1) {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      out.push(
        { x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 },
        { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 }
      );
    }
    out.push(pts[pts.length - 1]);
    pts = out;
  }
  return pts;
}

export function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
