import * as THREE from 'three';
import { flatPoints, mulberry32, pointInRing } from '../core/utils.js';
import { mergeGeometries } from '../core/geometry.js';
import { appendRibbon } from './roads.js';
import { concreteMat } from './materials.js';

/* ============================================================
   街道细节
   ------------------------------------------------------------
   · 人行道 / 路缘石：沿主干道两侧生成的连续薄带
   · 斑马线：主要路口四个方向的白条
   · 路灯：沿路等距布置，灯头带柔光点
   · 滨江栏杆 / 长椅 / 垃圾桶：沿珠江岸线与岛屿步道
   所有重复构件都使用 InstancedMesh / 合并几何，控制 draw call。
   ============================================================ */

const DETAIL_RADIUS = 1750;

function makeSidewalkTexture() {
  const s = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = s;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#7f8a8e';
  ctx.fillRect(0, 0, s, s);

  ctx.strokeStyle = 'rgba(52, 62, 66, 0.5)';
  ctx.lineWidth = 2;
  for (let i = 0; i <= s; i += 64) {
    ctx.beginPath();
    ctx.moveTo(i + 0.5, 0);
    ctx.lineTo(i + 0.5, s);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i + 0.5);
    ctx.lineTo(s, i + 0.5);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
  for (let i = 0; i < 500; i++) {
    ctx.fillRect(Math.random() * s, Math.random() * s, 1.5, 1.5);
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.05)';
  for (let i = 0; i < 300; i++) {
    ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeZebraTexture() {
  const w = 64;
  const h = 64;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(228, 234, 230, 0.82)';
  for (let i = 0; i < 5; i++) {
    ctx.fillRect(5, i * 13 + 2, w - 10, 6.5);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

/* 折线法线（用于向道路两侧偏移） */
function offsetPolyline(pts, offset) {
  const n = pts.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    out[i] = { x: pts[i].x - (dz / len) * offset, z: pts[i].z + (dx / len) * offset };
  }
  return out;
}

function buildRibbonMesh(arrays, material) {
  if (!arrays.position.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(arrays.position, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(arrays.uv, 2));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(arrays.normal, 3));
  geo.setIndex(arrays.index);
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

function newRibbonArrays() {
  return { position: [], uv: [], normal: [], index: [] };
}

/* ------------------------------------------------------------
   人行道 + 路缘石
   ------------------------------------------------------------ */

function addSidewalks(details, roads, islandAt) {
  const walk = newRibbonArrays();
  const curb = newRibbonArrays();

  for (const road of roads) {
    if (road.minDist > DETAIL_RADIUS) continue;
    if (road.width < 6) continue;
    const walkY = (i, p) => (islandAt(p.x, p.z) ? 1.34 : 0.2);
    const curbY = (i, p) => (islandAt(p.x, p.z) ? 1.38 : 0.255);

    for (const sign of [1, -1]) {
      const edge = offsetPolyline(road.pts, sign * (road.width * 0.5 + 0.35));
      const path = offsetPolyline(road.pts, sign * (road.width * 0.5 + 2.1));
      appendRibbon(walk, path, 3.2, walkY, false);
      appendRibbon(curb, edge, 0.55, curbY, false);
    }
  }

  const walkMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6e8,
    map: makeSidewalkTexture(),
    metalness: 0.08,
    roughness: 0.86,
    emissive: 0x0e1c22,
    emissiveIntensity: 0.24,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -3,
  });

  const walkMesh = buildRibbonMesh(walk, walkMat);
  const curbMesh = buildRibbonMesh(curb, concreteMat);
  if (walkMesh) details.group.add(walkMesh);
  if (curbMesh) details.group.add(curbMesh);
  details.sidewalkMat = walkMat;
}

/* ------------------------------------------------------------
   斑马线
   ------------------------------------------------------------ */

function addCrosswalks(details, roads, intersections, islandAt) {
  const pos = [];
  const uv = [];
  const idx = [];

  const addQuad = (cx, cz, tx, tz, halfW, halfD) => {
    const nx = -tz;
    const nz = tx;
    const y = islandAt(cx, cz) ? 1.36 : 0.335;
    const base = pos.length / 3;
    const corners = [
      [cx - tx * halfD - nx * halfW, cz - tz * halfD - nz * halfW],
      [cx + tx * halfD - nx * halfW, cz + tz * halfD - nz * halfW],
      [cx + tx * halfD + nx * halfW, cz + tz * halfD + nz * halfW],
      [cx - tx * halfD + nx * halfW, cz - tz * halfD + nz * halfW],
    ];
    for (const [x, z] of corners) pos.push(x, y, z);
    uv.push(0, 0, 0, 1, 1, 1, 1, 0);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };

  for (const it of intersections) {
    const seen = new Set();
    for (const hit of it.roads) {
      for (const seg of [hit.A, hit.B]) {
        if (seen.has(seg.road)) continue;
        seen.add(seg.road);
        const road = roads[seg.road];
        if (!road || road.width < 6) continue;

        let dx = seg.b.x - seg.a.x;
        let dz = seg.b.z - seg.a.z;
        const len = Math.hypot(dx, dz) || 1;
        dx /= len;
        dz /= len;

        for (const sign of [1, -1]) {
          const cx = it.x + dx * (road.width * 0.5 + 5.4) * sign;
          const cz = it.z + dz * (road.width * 0.5 + 5.4) * sign;
          addQuad(cx, cz, dx, dz, road.width * 0.5 - 1.2, 2.6);
        }
      }
    }
  }

  if (!pos.length) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();

  const mat = new THREE.MeshBasicMaterial({
    map: makeZebraTexture(),
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: 0,
    polygonOffsetUnits: -8,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  details.group.add(mesh);
}

/* ------------------------------------------------------------
   路灯
   ------------------------------------------------------------ */

function addStreetlights(details, roads, islandAt, rand) {
  const lights = [];

  for (const road of roads) {
    if (road.minDist > DETAIL_RADIUS) continue;
    const step = road.kind === 1 ? 46 : 58;
    const offset = road.width * 0.5 + 2.4;

    for (let d = 18; d < road.total - 12; d += step) {
      // 两侧交替布置，避免灯杆过密
      const side = lights.length % 2 === 0 ? 1 : -1;
      const i = Math.min(road.pts.length - 1, Math.max(1, Math.round((d / road.total) * (road.pts.length - 1))));
      const p = road.pts[i];
      const a = road.pts[i - 1];
      const b = road.pts[i];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const nx = -dz * side;
      const nz = dx * side;
      const x = p.x + nx * offset;
      const z = p.z + nz * offset;
      if (x * x + z * z > DETAIL_RADIUS * DETAIL_RADIUS) continue;
      lights.push({
        x,
        z,
        y: islandAt(x, z) ? 1.3 : 0.28,
        // 灯臂朝向道路中心
        yaw: Math.atan2(-nz, -nx),
        phase: rand() * Math.PI * 2,
      });
    }
  }

  if (!lights.length) return;

  const poleGeo = mergeGeometries([
    new THREE.CylinderGeometry(0.13, 0.2, 8.4, 6).translate(0, 4.2, 0),
    new THREE.BoxGeometry(2.1, 0.13, 0.16).translate(1.05, 8.28, 0),
    new THREE.BoxGeometry(0.9, 0.18, 0.38).translate(1.95, 8.16, 0),
    new THREE.CylinderGeometry(0.28, 0.34, 0.3, 6).translate(0, 0.15, 0),
  ]);
  const poleMat = new THREE.MeshStandardMaterial({
    color: 0x38444b,
    metalness: 0.62,
    roughness: 0.46,
    emissive: 0x0c1a20,
    emissiveIntensity: 0.3,
  });

  const poles = new THREE.InstancedMesh(poleGeo, poleMat, lights.length);
  poles.frustumCulled = false;

  const headGeo = new THREE.BoxGeometry(0.78, 0.1, 0.3);
  const headMat = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const heads = new THREE.InstancedMesh(headGeo, headMat, lights.length);
  heads.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const glowPos = new Float32Array(lights.length * 3);
  lights.forEach((l, i) => {
    dummy.position.set(l.x, l.y, l.z);
    dummy.rotation.set(0, l.yaw, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    poles.setMatrixAt(i, dummy.matrix);

    const cos = Math.cos(l.yaw);
    const sin = Math.sin(l.yaw);
    const hx = l.x + cos * 1.95;
    const hz = l.z - sin * 1.95;
    dummy.position.set(hx, l.y + 8.1, hz);
    dummy.rotation.set(0, l.yaw, 0);
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);

    glowPos[i * 3] = hx;
    glowPos[i * 3 + 1] = l.y + 8.05;
    glowPos[i * 3 + 2] = hz;
  });

  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));
  const glowMat = new THREE.PointsMaterial({
    color: 0xffc27a,
    size: 3.4,
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const glow = new THREE.Points(glowGeo, glowMat);
  glow.frustumCulled = false;

  details.group.add(poles, heads, glow);
  details.streetlightGlow = glowMat;
}

/* ------------------------------------------------------------
   滨江栏杆 / 长椅 / 垃圾桶
   ------------------------------------------------------------ */

function nearestLandOffset(ring, p, amount) {
  // 判断向哪一侧偏移仍在陆地上
  for (const dir of [-1, 1]) {
    const x = p.x + p.nx * amount * dir;
    const z = p.z + p.nz * amount * dir;
    if (!pointInRing(x, z, ring)) return { x, z, nx: p.nx * dir, nz: p.nz * dir };
  }
  return null;
}

function ringFrames(ring) {
  const n = ring.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = ring[(i - 1 + n) % n];
    const b = ring[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    const p = ring[i];
    if (p.x * p.x + p.z * p.z > DETAIL_RADIUS * DETAIL_RADIUS) continue;
    out.push({
      x: p.x,
      z: p.z,
      tx: dx / len,
      tz: dz / len,
      nx: -dz / len,
      nz: dx / len,
    });
  }
  return out;
}

function addRailings(details, rings) {
  const railPositions = [];
  const posts = [];

  for (const ring of rings) {
    const frames = ringFrames(ring);
    if (frames.length < 4) continue;

    for (let i = 0; i < frames.length; i++) {
      const a = frames[i];
      const b = frames[(i + 1) % frames.length];
      const dist = Math.hypot(b.x - a.x, b.z - a.z);
      if (dist < 0.6 || dist > 40) continue;

      for (const h of [0.55, 0.92]) {
        railPositions.push(a.x, 1.18 + h, a.z, b.x, 1.18 + h, b.z);
      }
      posts.push({ x: a.x, z: a.z, yaw: Math.atan2(a.tx, a.tz) });
    }
  }

  if (railPositions.length) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0x9fb2ba,
      transparent: true,
      opacity: 0.5,
    });
    const rails = new THREE.LineSegments(geo, mat);
    rails.frustumCulled = false;
    details.group.add(rails);
  }

  if (!posts.length) return;
  const postGeo = new THREE.CylinderGeometry(0.045, 0.06, 1.0, 4).translate(0, 0.5, 0);
  const postMat = new THREE.MeshStandardMaterial({
    color: 0x7f8c92,
    metalness: 0.7,
    roughness: 0.4,
    emissive: 0x0c181d,
    emissiveIntensity: 0.25,
  });
  const mesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  posts.forEach((p, i) => {
    dummy.position.set(p.x, 1.18, p.z);
    dummy.rotation.set(0, p.yaw, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  details.group.add(mesh);
}

function addBenches(details, rings, islandRings) {
  const benches = [];
  const bins = [];

  const collect = (ring, spacing, inwardAmount) => {
    const frames = ringFrames(ring);
    if (frames.length < 4) return;

    // 先求周长，再按固定间距取样
    let total = 0;
    const cum = [0];
    for (let i = 1; i < frames.length; i++) {
      total += Math.hypot(frames[i].x - frames[i - 1].x, frames[i].z - frames[i - 1].z);
      cum.push(total);
    }

    const count = Math.max(1, Math.floor(total / spacing));
    for (let k = 0; k < count; k++) {
      const d = (k + 0.5) * (total / count);
      let i = 1;
      while (i < cum.length - 1 && cum[i] < d) i++;
      const a = frames[i - 1];
      const b = frames[i];
      const u = (d - cum[i - 1]) / Math.max(0.001, cum[i] - cum[i - 1]);
      const x = a.x + (b.x - a.x) * u;
      const z = a.z + (b.z - a.z) * u;
      const nx = a.nx + b.nx;
      const nz = a.nz + b.nz;
      const nl = Math.hypot(nx, nz) || 1;
      const p = { x, z, nx: nx / nl, nz: nz / nl };
      const land = nearestLandOffset(ring, p, inwardAmount);
      if (!land) continue;

      benches.push({
        x: land.x,
        z: land.z,
        y: 1.22,
        yaw: Math.atan2(-land.nx, -land.nz),
      });
      if (k % 2 === 0) {
        bins.push({
          x: land.x + (a.tx + b.tx) * 1.7,
          z: land.z + (a.tz + b.tz) * 1.7,
          y: 1.22,
        });
      }
    }
  };

  for (const ring of rings) collect(ring, 96, 3.4);
  for (const ring of islandRings) collect(ring, 130, 3.0);

  if (benches.length) {
    const woodGeo = mergeGeometries([
      new THREE.BoxGeometry(2.0, 0.12, 0.62).translate(0, 0.55, 0.06),
      new THREE.BoxGeometry(2.0, 0.46, 0.1).translate(0, 0.82, -0.26),
    ]);
    const woodMat = new THREE.MeshStandardMaterial({
      color: 0x8a5a36,
      metalness: 0.05,
      roughness: 0.82,
      emissive: 0x160b04,
      emissiveIntensity: 0.2,
    });
    const metalGeo = mergeGeometries([
      new THREE.BoxGeometry(0.1, 0.55, 0.56).translate(-0.82, 0.28, 0.06),
      new THREE.BoxGeometry(0.1, 0.55, 0.56).translate(0.82, 0.28, 0.06),
      new THREE.BoxGeometry(0.08, 0.55, 0.08).translate(-0.82, 0.82, -0.26),
      new THREE.BoxGeometry(0.08, 0.55, 0.08).translate(0.82, 0.82, -0.26),
    ]);
    const metalMat = new THREE.MeshStandardMaterial({
      color: 0x3a444a,
      metalness: 0.7,
      roughness: 0.42,
      emissive: 0x0a1418,
      emissiveIntensity: 0.2,
    });

    const wood = new THREE.InstancedMesh(woodGeo, woodMat, benches.length);
    const metal = new THREE.InstancedMesh(metalGeo, metalMat, benches.length);
    wood.frustumCulled = false;
    metal.frustumCulled = false;
    const dummy = new THREE.Object3D();
    benches.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, b.yaw, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      wood.setMatrixAt(i, dummy.matrix);
      metal.setMatrixAt(i, dummy.matrix);
    });
    details.group.add(wood, metal);
  }

  if (bins.length) {
    const binGeo = mergeGeometries([
      new THREE.CylinderGeometry(0.34, 0.3, 0.86, 8).translate(0, 0.43, 0),
      new THREE.TorusGeometry(0.35, 0.035, 4, 10).rotateX(Math.PI / 2).translate(0, 0.86, 0),
    ]);
    const binMat = new THREE.MeshStandardMaterial({
      color: 0x3f5c4b,
      metalness: 0.4,
      roughness: 0.6,
      emissive: 0x0a1510,
      emissiveIntensity: 0.22,
    });
    const mesh = new THREE.InstancedMesh(binGeo, binMat, bins.length);
    mesh.frustumCulled = false;
    const dummy = new THREE.Object3D();
    bins.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    details.group.add(mesh);
  }

  details.benchCount = benches.length;
  details.binCount = bins.length;
}

/* ------------------------------------------------------------
   入口
   ------------------------------------------------------------ */

export function createStreetDetails({
  data,
  islandAt,
  roads = [],
  riverRings = [],
  islandRings = [],
  intersections = [],
}) {
  const group = new THREE.Group();
  const rand = mulberry32(20241207);
  const details = { group, update() {} };

  addSidewalks(details, roads, islandAt);
  addCrosswalks(details, roads, intersections, islandAt);
  addStreetlights(details, roads, islandAt, rand);
  addRailings(details, riverRings);
  addBenches(details, riverRings, islandRings);

  details.stats = {
    sidewalks: roads.length,
    intersections: intersections.length,
    benches: details.benchCount || 0,
  };

  return details;
}
