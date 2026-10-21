import * as THREE from 'three';
import { mulberry32, flatPoints, clamp, lerp } from '../core/utils.js';

/* ============================================================
   灯光 / 车流 / 游船
   ============================================================ */

export function makeGlowTexture() {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.22, 'rgba(255,240,210,0.7)');
  g.addColorStop(0.6, 'rgba(255,210,150,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createCityLights(data, riverRings, islandAt) {
  const rand = mulberry32(5117);
  const pos = [];
  const col = [];
  const c = new THREE.Color();

  const push = (x, y, z, warm = true, strength = 1) => {
    pos.push(x, y, z);
    if (warm) c.setHSL(0.075, 0.8, 0.55 + rand() * 0.15);
    else c.setHSL(0.52, 0.55, 0.58 + rand() * 0.18);
    col.push(c.r * strength, c.g * strength, c.b * strength);
  };

  for (const [kind, width, flat] of data.roads) {
    if (kind === 3) continue;
    const pts = flatPoints(flat);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      acc += len;
      const step = kind === 2 ? 28 : kind === 1 ? 36 : 58;
      if (acc < step) continue;
      acc = 0;
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);
      for (const s of [-1, 1]) {
        const x = b.x + nx * (width * 0.5 + 3) * s;
        const z = b.z + nz * (width * 0.5 + 3) * s;
        const y = islandAt(x, z) ? 8.8 : 7.5;
        push(x, y, z, rand() > 0.18, 0.8);
      }
    }
  }

  // 江岸暖灯
  for (const ring of riverRings) {
    let acc = 0;
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1];
      const b = ring[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      acc += len;
      if (acc < 26) continue;
      acc = 0;
      push(b.x, 3.2, b.z, true, 0.9);
    }
  }

  // 花城广场轴线灯
  for (let z = -760; z > -2280; z -= 24) {
    push(-9, 3.4, z, true, 0.9);
    push(9, 3.4, z, true, 0.9);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));

  const mat = new THREE.PointsMaterial({
    size: 7.5,
    map: makeGlowTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    alphaTest: 0.01,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  return points;
}

export function createTraffic(curves) {
  const groups = [];
  for (const item of curves) {
    const bridge = item.bridge;
    const pts = bridge.userData.pts;
    const dists = bridge.userData.dists;
    const total = bridge.userData.total;
    const width = bridge.userData.width;
    const yAt = bridge.userData.yAt;
    const count = item.count;

    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const c = new THREE.Color();
    const data = [];

    for (let i = 0; i < count; i++) {
      const lane = i % 2 === 0 ? -width * 0.22 : width * 0.22;
      data.push({
        offset: (i / count + (i % 2) * 0.003) * total,
        speed: (i % 3 === 0 ? -1 : 1) * (0.012 + Math.random() * 0.008),
        lane,
        lateral: Math.random(),
      });
      c.setHex(i % 4 === 0 ? 0xff5a4a : 0xfff2ce);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size: 2.5,
      map: makeGlowTexture(),
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;

    groups.push({ points, bridge, data, pos, dists, total, yAt, width });
  }
  return groups;
}
