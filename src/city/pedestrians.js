import * as THREE from 'three';
import { clamp } from '../core/utils.js';
import { mergeGeometries } from '../core/geometry.js';

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

export function collectWalkPaths(riverRings, islandRings) {
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

export function createPedestrians(paths, rand) {
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

  return { group, update, count: peds.length, bodyMesh, headMesh, peds };
}
