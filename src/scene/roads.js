import * as THREE from 'three';
import { flatPoints } from '../core/utils.js';

/* ============================================================
   道路
   ============================================================ */

export function makeRoadTexture(kind) {
  const w = 128;
  const h = 256;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');

  if (kind === 3) {
    // 步行街 / 广场铺装
    ctx.fillStyle = '#6b6d68';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(35, 38, 38, 0.35)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 32) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255, 235, 200, 0.04)';
    for (let i = 0; i < 220; i++) {
      ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  } else {
    // 沥青
    ctx.fillStyle = '#41474c';
    ctx.fillRect(0, 0, w, h);

    // 人行道边缘
    const edge = kind === 2 ? 12 : kind === 1 ? 13 : 15;
    ctx.fillStyle = '#5d6468';
    ctx.fillRect(0, 0, edge, h);
    ctx.fillRect(w - edge, 0, edge, h);

    // 沥青颗粒
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let i = 0; i < 420; i++) {
      const x = edge + Math.random() * (w - edge * 2);
      const y = Math.random() * h;
      ctx.fillRect(x, y, 1.5, 1.5);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.035)';
    for (let i = 0; i < 260; i++) {
      const x = edge + Math.random() * (w - edge * 2);
      const y = Math.random() * h;
      ctx.fillRect(x, y, 1, 1);
    }

    const line = (x, width, color, dashed = false) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      if (!dashed) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      } else {
        ctx.setLineDash([18, 22]);
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    };

    // 道路边缘线
    line(edge + 3, 2, 'rgba(222, 224, 210, 0.72)');
    line(w - edge - 3, 2, 'rgba(222, 224, 210, 0.72)');

    if (kind === 2) {
      // 快速路：6 车道
      line(30, 2, 'rgba(230, 232, 220, 0.55)', true);
      line(53, 2, 'rgba(230, 232, 220, 0.55)', true);
      line(75, 2, 'rgba(230, 232, 220, 0.55)', true);
      line(98, 2, 'rgba(230, 232, 220, 0.55)', true);
    } else if (kind === 1) {
      // 主干道：4 车道，双黄线
      line(45, 2, 'rgba(230, 232, 220, 0.5)', true);
      line(83, 2, 'rgba(230, 232, 220, 0.5)', true);
      line(60, 2, 'rgba(240, 198, 95, 0.9)');
      line(68, 2, 'rgba(240, 198, 95, 0.9)');
    } else {
      // 支路：双向单车道
      line(64, 2, 'rgba(232, 232, 218, 0.78)', true);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function appendRibbon(arrays, pts, width, yAt, closed = false) {
  const n = pts.length;
  if (n < 2) return;

  const segN = [];
  const segLen = [];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1e-6;
    segLen.push(len);
    segN.push({ x: -dz / len, z: dx / len });
  }

  const left = [];
  const right = [];
  const ys = [];
  let dist = 0;
  const vDist = [];

  for (let i = 0; i < n; i++) {
    let nx;
    let nz;
    let miter = 1;

    if (closed) {
      const prev = segN[(i - 1 + segN.length) % segN.length];
      const next = segN[i % segN.length];
      const mx = prev.x + next.x;
      const mz = prev.z + next.z;
      const ml = Math.hypot(mx, mz) || 1e-6;
      nx = mx / ml;
      nz = mz / ml;
      const dot = nx * next.x + nz * next.z;
      miter = 1 / Math.max(0.35, dot);
    } else if (i === 0) {
      nx = segN[0].x;
      nz = segN[0].z;
    } else if (i === n - 1) {
      nx = segN[n - 2].x;
      nz = segN[n - 2].z;
    } else {
      const prev = segN[i - 1];
      const next = segN[i];
      const mx = prev.x + next.x;
      const mz = prev.z + next.z;
      const ml = Math.hypot(mx, mz) || 1e-6;
      nx = mx / ml;
      nz = mz / ml;
      const dot = nx * next.x + nz * next.z;
      miter = 1 / Math.max(0.35, dot);
    }

    miter = Math.min(miter, 2.6);
    const half = width * 0.5 * miter;
    const p = pts[i];
    const y = yAt(i, p);
    left.push({ x: p.x + nx * half, z: p.z + nz * half, y });
    right.push({ x: p.x - nx * half, z: p.z - nz * half, y });
    ys.push(y);
    vDist.push(dist);
    if (i < n - 1) {
      const a = pts[i];
      const b = pts[i + 1];
      dist += Math.hypot(b.x - a.x, b.z - a.z);
    }
  }
  if (closed) {
    const a = pts[n - 1];
    const b = pts[0];
    vDist.push(dist + Math.hypot(b.x - a.x, b.z - a.z));
  }

  const pos = arrays.position;
  const uvs = arrays.uv;
  const nor = arrays.normal;
  const idx = arrays.index;
  const base = pos.length / 3;

  const uvRepeat = 30;

  for (let i = 0; i < n; i++) {
    pos.push(left[i].x, left[i].y, left[i].z);
    uvs.push(0, vDist[i] / uvRepeat);
    nor.push(0, 1, 0);
    pos.push(right[i].x, right[i].y, right[i].z);
    uvs.push(1, vDist[i] / uvRepeat);
    nor.push(0, 1, 0);
  }

  if (closed) {
    const i0 = n - 1;
    const i1 = 0;
    const aL = base + i0 * 2;
    const aR = aL + 1;
    const bL = base + i1 * 2;
    const bR = bL + 1;
    idx.push(aL, bL, aR, aR, bL, bR);
  }

  for (let i = 0; i < n - 1; i++) {
    const aL = base + i * 2;
    const aR = aL + 1;
    const bL = base + (i + 1) * 2;
    const bR = bL + 1;
    idx.push(aL, bL, aR, aR, bL, bR);
  }
}

export function createRoadGeometry(data, islandAt) {
  const classes = [0, 1, 2, 3];
  const arrays = new Map();
  for (const k of classes) {
    arrays.set(k, {
      position: [],
      uv: [],
      normal: [],
      index: [],
    });
  }

  for (const [kind, width, flat] of data.roads) {
    const pts = flatPoints(flat);
    if (pts.length < 2) continue;
    const arr = arrays.get(kind) || arrays.get(0);
    const baseY = kind === 3 ? 0.36 : kind === 2 ? 0.32 : kind === 1 ? 0.3 : 0.28;
    const yAt = (i, p) => (islandAt(p.x, p.z) ? 1.3 : baseY);
    appendRibbon(arr, pts, Math.max(2.4, width), yAt, false);
  }

  const materials = {};
  const meshes = [];
  for (const k of classes) {
    const arr = arrays.get(k);
    if (!arr.position.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(arr.position, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(arr.normal, 3));
    geo.setIndex(arr.index);
    geo.computeBoundingSphere();

    const tex = makeRoadTexture(k);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: tex,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.18,
      metalness: 0.06,
      roughness: 0.9,
      side: THREE.DoubleSide,
      // 贴地薄片：固定深度偏移，避免和地面 / 其他道路共面时闪烁。
      polygonOffset: true,
      polygonOffsetFactor: 0,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    meshes.push(mesh);
    materials[k] = mat;
  }

  return { meshes, materials };
}
