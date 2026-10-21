import * as THREE from 'three';

/* ============================================================
   城市生命：车流 / 行人 / 信号灯
   ------------------------------------------------------------
   与 environment.js 的城市骨架分离，专门负责“会动”的元素：

   · 车辆：沿主干道 / 快速路的双向车道行驶，路口遇红灯减速停车；
   · 行人：滨江步道、海心沙环岛、花城广场轴线与塔基广场的
     步行人流，按路径往返 / 环绕；
   · 信号灯：主要路口的两相位灯组，红 / 黄 / 绿循环，
     与车流共用同一套相位状态；
   · 全部元素使用 InstancedMesh / Points 合批，保持低绘制次数。
   ============================================================ */

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flatPoints(flat) {
  const out = [];
  if (flat.length && Array.isArray(flat[0])) {
    for (const p of flat) out.push({ x: p[0], z: p[1] });
    return out;
  }
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ x: flat[i], z: flat[i + 1] });
  }
  return out;
}

/* 把若干净几何拼成一个，减少 instance / draw call 数量 */
function mergeGeometries(list) {
  const geos = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let count = 0;
  for (const g of geos) count += g.attributes.position.count;

  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  let offset = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, offset * 3);
    nor.set(g.attributes.normal.array, offset * 3);
    offset += g.attributes.position.count;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return geo;
}

function makeGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.28, 'rgba(255,244,214,0.65)');
  g.addColorStop(0.62, 'rgba(255,214,150,0.14)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ============================================================
   道路采样
   ============================================================ */

function buildRoad(pts, width, kind) {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  return {
    pts,
    cum,
    total: cum[cum.length - 1],
    width,
    kind,
    lights: [],
    minDist: 0,
  };
}

const _sample = { x: 0, z: 0, dx: 0, dz: 0 };

function sampleRoad(road, d) {
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
function collectRoads(data) {
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

    const road = buildRoad(raw, width, kind);
    if (road.total < 160) continue;
    road.minDist = minDist;
    roads.push(road);
  }

  return roads;
}

/* ============================================================
   信号灯相位
   ============================================================ */

const SIGNAL_CYCLE = 30;
const SIGNAL_GREEN = 14;
const SIGNAL_YELLOW = 2;

/* group 0 = 东西向（axis 0），group 1 = 南北向（axis 1） */
const signalStates = ['green', 'green'];

function updateSignalStates(time) {
  const offset = [0, SIGNAL_CYCLE * 0.5];
  for (let g = 0; g < 2; g++) {
    const t = (time + offset[g]) % SIGNAL_CYCLE;
    if (t < SIGNAL_GREEN) signalStates[g] = 'green';
    else if (t < SIGNAL_GREEN + SIGNAL_YELLOW) signalStates[g] = 'yellow';
    else signalStates[g] = 'red';
  }
}

/* ============================================================
   路口筛选
   ============================================================ */

function segmentIntersection(a, b, c, d) {
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

function findIntersections(roads, rand) {
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

/* ============================================================
   车流
   ============================================================ */

function createCars(roads, islandAt, rand) {
  const bodies = [];

  let sum = 0;
  const weights = roads.map((r) => {
    const w = r.total * clamp(1.55 - r.minDist / 1500, 0.28, 1.55);
    sum += w;
    return w;
  });

  const totalCars = 330;
  const palette = [
    0xe9edef, 0xc7ced2, 0x9aa4a9, 0x242a2e, 0x14181b,
    0xb23a32, 0x2f5f9e, 0xd8ab44, 0x3c6b55,
  ];

  for (let r = 0; r < roads.length; r++) {
    const road = roads[r];
    const count = Math.min(12, Math.max(1, Math.round((weights[r] / sum) * totalCars)));

    for (let i = 0; i < count; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const large = rand() < 0.09;
      bodies.push({
        road,
        d: ((i + rand() * 0.55) / count) * road.total,
        dir,
        lane: -dir * road.width * (0.2 + rand() * 0.05),
        cruise: 8.5 + rand() * 6.5,
        speed: 8 + rand() * 6,
        scaleX: large ? 1.55 + rand() * 0.25 : 1,
        scaleY: large ? 1.45 : 1,
        color: large
          ? (rand() < 0.5 ? 0xd8ab44 : 0x3c6b55)
          : palette[(rand() * palette.length) | 0],
        phase: rand() * Math.PI * 2,
      });
    }
  }

  // 车体：车身 + 座舱
  const carGeo = mergeGeometries([
    new THREE.BoxGeometry(4.2, 0.78, 1.84).translate(0, 0.56, 0),
    new THREE.BoxGeometry(2.15, 0.62, 1.64).translate(-0.18, 1.2, 0),
    new THREE.BoxGeometry(3.5, 0.22, 1.9).translate(0, 0.2, 0),
  ]);

  const carMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.42,
    roughness: 0.38,
    emissive: 0x0a1418,
    emissiveIntensity: 0.25,
  });

  const mesh = new THREE.InstancedMesh(carGeo, carMat, bodies.length);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(bodies.length * 3),
    3
  );

  const color = new THREE.Color();
  bodies.forEach((car, i) => {
    color.setHex(car.color);
    mesh.setColorAt(i, color);
    mesh.setMatrixAt(i, new THREE.Matrix4());
  });
  mesh.instanceColor.needsUpdate = true;

  // 车灯：前灯暖白、尾灯红
  const headPos = new Float32Array(bodies.length * 2 * 3);
  const tailPos = new Float32Array(bodies.length * 2 * 3);

  const headGeo = new THREE.BufferGeometry();
  headGeo.setAttribute('position', new THREE.BufferAttribute(headPos, 3));
  const tailGeo = new THREE.BufferGeometry();
  tailGeo.setAttribute('position', new THREE.BufferAttribute(tailPos, 3));

  const glow = makeGlowTexture();
  const headMat = new THREE.PointsMaterial({
    size: 3.6,
    map: glow,
    color: 0xfff3d0,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const tailMat = new THREE.PointsMaterial({
    size: 2.6,
    map: glow,
    color: 0xff5a44,
    transparent: true,
    opacity: 0.85,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });

  const head = new THREE.Points(headGeo, headMat);
  const tail = new THREE.Points(tailGeo, tailMat);
  head.frustumCulled = false;
  tail.frustumCulled = false;

  const group = new THREE.Group();
  group.add(mesh, head, tail);

  const dummy = new THREE.Object3D();
  const baseY = (x, z, kind) =>
    (islandAt(x, z) ? 1.3 : kind === 1 ? 0.3 : kind === 2 ? 0.32 : 0.28) + 0.02;

  function update(time, dt) {
    for (let i = 0; i < bodies.length; i++) {
      const car = bodies[i];
      const road = car.road;

      // 前方最近的红灯
      let target = car.cruise;
      for (const light of road.lights) {
        const ahead = (light.d - car.d) * car.dir;
        if (ahead > 3 && ahead < 48) {
          const state = signalStates[light.axis];
          if (state !== 'green') {
            target = Math.min(target, Math.max(0, (ahead - 4) * 0.75));
          }
        }
      }

      const accel = target > car.speed ? 7 : 16;
      car.speed += clamp(target - car.speed, -accel * dt, accel * dt);
      if (car.speed < 0.02 && target < 0.1) car.speed = 0;

      car.d += car.dir * car.speed * dt;
      if (car.d > road.total) car.d -= road.total;
      else if (car.d < 0) car.d += road.total;

      const s = sampleRoad(road, car.d);
      // 横向车道偏移：lane 为负时落在行驶方向右侧
      const x = s.x - s.dz * car.lane;
      const z = s.z + s.dx * car.lane;
      const y = baseY(x, z, road.kind);

      const dx = s.dx * car.dir;
      const dz = s.dz * car.dir;
      const yaw = Math.atan2(-dz, dx);

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(car.scaleX, car.scaleY, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const sideX = -dz;
      const sideZ = dx;
      const bob = Math.sin(time * 6 + car.phase) * 0.02 * (car.speed / 12);
      const yl = y + 0.62 + bob;
      const hx = x + dx * 2.05;
      const hz = z + dz * 2.05;
      const tx = x - dx * 2.05;
      const tz = z - dz * 2.05;

      const h2 = i * 6;
      headPos[h2] = hx + sideX * 0.62;
      headPos[h2 + 1] = yl;
      headPos[h2 + 2] = hz + sideZ * 0.62;
      headPos[h2 + 3] = hx - sideX * 0.62;
      headPos[h2 + 4] = yl;
      headPos[h2 + 5] = hz - sideZ * 0.62;

      tailPos[h2] = tx + sideX * 0.68;
      tailPos[h2 + 1] = yl;
      tailPos[h2 + 2] = tz + sideZ * 0.68;
      tailPos[h2 + 3] = tx - sideX * 0.68;
      tailPos[h2 + 4] = yl;
      tailPos[h2 + 5] = tz - sideZ * 0.68;
    }

    mesh.instanceMatrix.needsUpdate = true;
    headGeo.attributes.position.needsUpdate = true;
    tailGeo.attributes.position.needsUpdate = true;
  }

  return { group, update, count: bodies.length };
}

/* ============================================================
   行人
   ============================================================ */

function buildWalkPath(rawPts, closed, y) {
  const pts = [];
  for (const p of rawPts) {
    const last = pts[pts.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 1.2) pts.push(p);
  }
  if (pts.length < 2) return null;

  const n = pts.length;
  const cum = [0];
  for (let i = 1; i < n; i++) {
    cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  let total = cum[n - 1];
  if (closed) total += Math.hypot(pts[0].x - pts[n - 1].x, pts[0].z - pts[n - 1].z);
  if (total < 24) return null;

  const segments = Math.max(4, Math.round(total / 3));
  const step = total / segments;

  const at = (d) => {
    d = ((d % total) + total) % total;
    let lo = 1;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < d) lo = mid + 1;
      else hi = mid;
    }
    const a = pts[lo - 1];
    const b = pts[lo % n] || pts[0];
    const seg = Math.max(0.001, cum[lo] - cum[lo - 1]);
    const u = clamp((d - cum[lo - 1]) / seg, 0, 1);
    return { x: a.x + (b.x - a.x) * u, z: a.z + (b.z - a.z) * u };
  };

  const samples = [];
  for (let i = 0; i <= segments; i++) samples.push(at(i * step));

  return { samples, step, total, closed, y };
}

function sampleWalkPath(path, d) {
  let i;
  let u;
  if (path.closed) {
    d = ((d % path.total) + path.total) % path.total;
    i = Math.floor(d / path.step);
    u = (d % path.step) / path.step;
  } else {
    d = clamp(d, 0, path.total);
    i = Math.floor(d / path.step);
    if (i >= path.samples.length - 1) {
      i = path.samples.length - 2;
      u = 1;
    } else {
      u = (d - i * path.step) / path.step;
    }
  }

  const a = path.samples[i];
  const b = path.samples[(i + 1) % path.samples.length];
  return {
    x: a.x + (b.x - a.x) * u,
    z: a.z + (b.z - a.z) * u,
  };
}

/* 环形岸线：向陆地一侧偏移，并按可视范围切成若干段步道 */
function ringWalkPaths(ring, offset, closedHint, y) {
  const n = ring.length;
  const normals = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[i];
    const c = ring[(i + 1) % n];
    const d1x = b.x - a.x;
    const d1z = b.z - a.z;
    const d2x = c.x - b.x;
    const d2z = c.z - b.z;
    const l1 = Math.hypot(d1x, d1z) || 1;
    const l2 = Math.hypot(d2x, d2z) || 1;
    let nx = -d1z / l1 + -d2z / l2;
    let nz = d1x / l1 + d2x / l2;
    const l = Math.hypot(nx, nz) || 1;
    nx /= l;
    nz /= l;
    normals.push({ x: nx, z: nz });
  }

  const runs = [];
  let run = [];
  for (let i = 0; i <= n; i++) {
    const idx = i % n;
    const p = ring[idx];
    const nrm = normals[idx];
    const x = p.x + nrm.x * offset;
    const z = p.z + nrm.z * offset;
    const near = x * x + z * z < 2500 * 2500;
    if (near) run.push({ x, z });
    else if (run.length) {
      runs.push(run);
      run = [];
    }
  }
  if (run.length) runs.push(run);

  if (closedHint) {
    const first = runs[0];
    const last = runs[runs.length - 1];
    if (first && last && runs.length > 1) {
      const a = last[last.length - 1];
      const b = first[0];
      if (Math.hypot(a.x - b.x, a.z - b.z) < 400) {
        runs[0] = last.concat(first);
        runs.pop();
      }
    }
  }

  const paths = [];
  for (const pts of runs) {
    const path = buildWalkPath(pts, false, y);
    if (path && path.total > 60) paths.push(path);
  }
  return paths;
}

function circlePath(cx, cz, radius, y, count) {
  const pts = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    pts.push({ x: cx + Math.cos(a) * radius, z: cz + Math.sin(a) * radius });
  }
  return buildWalkPath(pts, true, y);
}

function linePath(x0, z0, x1, z1, y) {
  const pts = [];
  const steps = Math.max(2, Math.round(Math.hypot(x1 - x0, z1 - z0) / 12));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t });
  }
  return buildWalkPath(pts, false, y);
}

function collectWalkPaths(riverRings, islandRings) {
  const paths = [];

  // 珠江两岸滨江步道（东西两侧各一条）
  for (const ring of riverRings) {
    for (const off of [1.6, 4.2]) {
      paths.push(...ringWalkPaths(ring, -off, true, 1.24));
    }
  }

  // 海心沙等岛屿环岛步道
  for (const ring of islandRings) {
    let cx = 0;
    let cz = 0;
    for (const p of ring) {
      cx += p.x;
      cz += p.z;
    }
    cx /= ring.length;
    cz /= ring.length;

    for (const inset of [2.2, 4.0]) {
      const pts = ring.map((p) => {
        const dx = cx - p.x;
        const dz = cz - p.z;
        const l = Math.hypot(dx, dz) || 1;
        return { x: p.x + (dx / l) * inset, z: p.z + (dz / l) * inset };
      });
      const path = buildWalkPath(pts, true, 1.24);
      if (path) paths.push(path);
    }
  }

  // 塔基广场环道人流
  const ring1 = circlePath(0, 0, 104, 0.58, 96);
  const ring2 = circlePath(0, 0, 114, 0.58, 96);
  if (ring1) paths.push(ring1);
  if (ring2) paths.push(ring2);

  // 花城广场中轴步行道
  const axisA = linePath(-7, -790, -7, -2250, 0.73);
  const axisB = linePath(7, -2250, 7, -790, 0.73);
  if (axisA) paths.push(axisA);
  if (axisB) paths.push(axisB);

  return paths;
}

function createPedestrians(paths, rand) {
  const count = 460;
  const total = paths.reduce((s, p) => s + p.total, 0);
  const peds = [];

  for (const path of paths) {
    const n = Math.max(2, Math.round((path.total / total) * count));
    for (let i = 0; i < n; i++) {
      const dir = rand() < 0.5 ? 1 : -1;
      peds.push({
        path,
        d: ((i + rand() * 0.6) / n) * path.total,
        dir,
        speed: 0.85 + rand() * 0.75,
        side: (rand() * 2 - 1) * 0.9,
        phase: rand() * Math.PI * 2,
        scale: 0.92 + rand() * 0.16,
        color: 0,
      });
    }
  }

  const palette = [
    0xd9dee2, 0x8d99a3, 0x3b4650, 0x22303a, 0xb5493f, 0x3f6b8f,
    0xd8ab44, 0x4d7f63, 0xe0e6e9, 0x7b5fa8, 0xcf7f52, 0x5d7480,
  ];

  for (const ped of peds) {
    ped.color = palette[(rand() * palette.length) | 0];
  }

  // 身体（腿 + 躯干 + 手臂）
  const bodyGeo = mergeGeometries([
    new THREE.BoxGeometry(0.34, 0.78, 0.24).translate(0, 0.39, 0),
    new THREE.BoxGeometry(0.44, 0.62, 0.28).translate(0, 1.09, 0),
    new THREE.BoxGeometry(0.11, 0.56, 0.12).translate(-0.27, 1.08, 0),
    new THREE.BoxGeometry(0.11, 0.56, 0.12).translate(0.27, 1.08, 0),
  ]);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 0.05,
    roughness: 0.86,
    emissive: 0x0a1216,
    emissiveIntensity: 0.22,
  });

  const bodyMesh = new THREE.InstancedMesh(bodyGeo, bodyMat, peds.length);
  bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bodyMesh.frustumCulled = false;
  bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(peds.length * 3),
    3
  );

  const color = new THREE.Color();
  peds.forEach((ped, i) => {
    color.setHex(ped.color);
    bodyMesh.setColorAt(i, color);
  });
  bodyMesh.instanceColor.needsUpdate = true;

  const headGeo = new THREE.SphereGeometry(0.16, 7, 5);
  headGeo.translate(0, 1.56, 0);
  const headMat = new THREE.MeshStandardMaterial({
    color: 0xd8b599,
    metalness: 0.02,
    roughness: 0.8,
    emissive: 0x0a0c0e,
    emissiveIntensity: 0.18,
  });
  const headMesh = new THREE.InstancedMesh(headGeo, headMat, peds.length);
  headMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  headMesh.frustumCulled = false;

  const group = new THREE.Group();
  group.add(bodyMesh, headMesh);

  const dummy = new THREE.Object3D();

  function update(time, dt) {
    for (let i = 0; i < peds.length; i++) {
      const ped = peds[i];
      const path = ped.path;

      ped.d += ped.dir * ped.speed * dt;
      if (path.closed) {
        ped.d = ((ped.d % path.total) + path.total) % path.total;
      } else if (ped.d > path.total) {
        ped.d = path.total;
        ped.dir = -1;
      } else if (ped.d < 0) {
        ped.d = 0;
        ped.dir = 1;
      }

      const p = sampleWalkPath(path, ped.d);
      const ahead = sampleWalkPath(path, ped.d + ped.dir * 1.6);
      let dx = ahead.x - p.x;
      let dz = ahead.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;

      const x = p.x - dz * ped.side;
      const z = p.z + dx * ped.side;
      const bob = Math.abs(Math.sin(time * 5.2 + ped.phase)) * 0.045;
      const yaw = Math.atan2(-dz, dx);

      dummy.position.set(x, path.y + bob, z);
      dummy.rotation.set(0, yaw, Math.sin(time * 5.2 + ped.phase) * 0.03);
      dummy.scale.setScalar(ped.scale);
      dummy.updateMatrix();
      bodyMesh.setMatrixAt(i, dummy.matrix);
      headMesh.setMatrixAt(i, dummy.matrix);
    }

    bodyMesh.instanceMatrix.needsUpdate = true;
    headMesh.instanceMatrix.needsUpdate = true;
  }

  return { group, update, count: peds.length };
}

/* ============================================================
   信号灯实体
   ============================================================ */

function createSignals(roads, intersections) {
  const poles = [];

  for (const it of intersections) {
    const seen = new Set();

    for (const hit of it.roads) {
      for (const seg of [hit.A, hit.B]) {
        const idx = seg.road;
        if (seen.has(idx)) continue;
        seen.add(idx);

        const road = roads[idx];
        const a = road.pts[seg.i - 1];
        const b = road.pts[seg.i];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const tx = dx / len;
        const tz = dz / len;
        const rightX = -tz;
        const rightZ = tx;
        const y = 0.32;
        const poleX = it.x + rightX * (road.width * 0.5 + 2.4);
        const poleZ = it.z + rightZ * (road.width * 0.5 + 2.4);
        const axis = Math.abs(tx) >= Math.abs(tz) ? 0 : 1;

        poles.push({
          x: poleX,
          z: poleZ,
          y,
          yaw: Math.atan2(tz, -tx),
          axis,
        });
      }
    }
  }

  // ---------------- 杆体 ----------------
  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.14, 0.18, 6.6, 6).translate(0, 3.3, 0),
    new THREE.CylinderGeometry(0.09, 0.11, 4.5, 6)
      .rotateX(Math.PI / 2)
      .translate(0, 6.28, 2.25),
    new THREE.BoxGeometry(0.46, 1.94, 0.62).translate(0, 5.5, 4.4),
    new THREE.BoxGeometry(0.52, 0.26, 0.52).translate(0, 0.13, 0),
  ]);

  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x2b343a,
    metalness: 0.65,
    roughness: 0.48,
    emissive: 0x0c161b,
    emissiveIntensity: 0.35,
  });

  const poleMesh = new THREE.InstancedMesh(poleGeo, poleMat, Math.max(1, poles.length));
  poleMesh.frustumCulled = false;

  const dummy = new THREE.Object3D();
  poles.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poleMesh.setMatrixAt(i, dummy.matrix);
  });

  // ---------------- 灯珠 ----------------
  const lampMat = (color) =>
    new THREE.MeshBasicMaterial({ color });

  const lamps = [
    { red: lampMat(0x2a0b08), yellow: lampMat(0x2c2206), green: lampMat(0x0b2417) },
    { red: lampMat(0x2a0b08), yellow: lampMat(0x2c2206), green: lampMat(0x0b2417) },
  ];

  const lampGeo = new THREE.SphereGeometry(0.17, 8, 6);
  // 灯珠局部位置（灯面朝 +x）
  const lampLocal = [
    { key: 'red', y: 6.06, z: 4.4, x: 0.3 },
    { key: 'yellow', y: 5.5, z: 4.4, x: 0.3 },
    { key: 'green', y: 4.94, z: 4.4, x: 0.3 },
  ];

  const groups = [0, 1].map((axisGroup) => {
    const list = poles
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => p.axis === axisGroup);
    const meshes = {};

    for (const key of ['red', 'yellow', 'green']) {
      const m = new THREE.InstancedMesh(
        lampGeo,
        lamps[axisGroup][key],
        Math.max(1, list.length)
      );
      m.frustumCulled = false;
      m.count = list.length;
      list.forEach(({ p }, i) => {
        const ll = lampLocal.find((l) => l.key === key);
        const mtx = new THREE.Matrix4().makeRotationY(p.yaw);
        mtx.setPosition(p.x, p.y, p.z);
        const local = new THREE.Matrix4().makeTranslation(ll.x, ll.y, ll.z);
        mtx.multiply(local);
        m.setMatrixAt(i, mtx);
      });
      meshes[key] = m;
    }
    return meshes;
  });

  const group = new THREE.Group();
  group.add(poleMesh);
  for (const g of groups) group.add(g.red, g.yellow, g.green);

  const onColor = { red: 0xff3a24, yellow: 0xffc23a, green: 0x46ff9a };
  const offColor = { red: 0x2a0b08, yellow: 0x2c2206, green: 0x0b2417 };
  const lastState = ['', ''];

  function update() {
    for (let g = 0; g < 2; g++) {
      const state = signalStates[g];
      if (state === lastState[g]) continue;

      for (const key of ['red', 'yellow', 'green']) {
        lamps[g][key].color.setHex(key === state ? onColor[key] : offColor[key]);
      }
      lastState[g] = state;
    }
  }

  return { group, update, count: poles.length };
}

/* ============================================================
   主入口
   ============================================================ */

export function createLife({ data, islandAt, riverRings, islandRings }) {
  const rand = mulberry32(20241108);
  const group = new THREE.Group();

  /* ---------- 车道与路口 ---------- */
  const roads = collectRoads(data);

  const intersections = findIntersections(roads, rand);
  for (const it of intersections) {
    for (const hit of it.roads) {
      for (const entry of [
        { seg: hit.A, u: hit.t },
        { seg: hit.B, u: hit.u },
      ]) {
        const seg = entry.seg;
        const road = roads[seg.road];
        const a = road.pts[seg.i - 1];
        const b = road.pts[seg.i];
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const axis = Math.abs(b.x - a.x) / len >= Math.abs(b.z - a.z) / len ? 0 : 1;
        road.lights.push({
          d: road.cum[seg.i - 1] + len * entry.u,
          axis,
        });
      }
    }
  }

  const signals = createSignals(roads, intersections);
  group.add(signals.group);

  /* ---------- 车流 ---------- */
  const cars = createCars(roads, islandAt, rand);
  group.add(cars.group);

  /* ---------- 行人 ---------- */
  const walkPaths = collectWalkPaths(riverRings, islandRings);
  const peds = createPedestrians(walkPaths, rand);
  group.add(peds.group);

  function update(time, dt) {
    updateSignalStates(time);
    signals.update(time, dt);
    cars.update(time, dt);
    peds.update(time, dt);
  }

  return {
    group,
    update,
    stats: {
      cars: cars.count,
      pedestrians: peds.count,
      signals: signals.count,
      roads: roads.length,
      intersections: intersections.length,
    },
  };
}
