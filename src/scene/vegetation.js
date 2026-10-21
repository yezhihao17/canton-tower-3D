import * as THREE from 'three';
import { TAU, mulberry32, flatPoints, pointInRing, ringArea } from '../core/utils.js';

/* ============================================================
   树木
   ============================================================ */

export function createTrees(data, islandAt, riverRings) {
  const rand = mulberry32(90210);
  const items = [];
  const palms = [];

  const isWater = (x, z) => {
    for (const ring of riverRings) {
      if (pointInRing(x, z, ring)) {
        let onIsland = false;
        for (const isl of data.water.islands) {
          if (pointInRing(x, z, flatPoints(isl))) {
            onIsland = true;
            break;
          }
        }
        if (!onIsland) return true;
      }
    }
    return false;
  };

  const addTree = (x, z, y, scale = 1) => {
    if (isWater(x, z)) return;
    const s = scale * (0.7 + rand() * 0.6);
    items.push({ x, z, y, s, ry: rand() * TAU });
  };

  // 滨江步道树列
  for (const ring of riverRings) {
    for (let i = 0; i < ring.length; i += 3) {
      const a = ring[i];
      const b = ring[(i + 1) % ring.length];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1;
      const nx = -dz / len;
      const nz = dx / len;
      for (const s of [-1, 1]) {
        const x = a.x + nx * 13 * s;
        const z = a.z + nz * 13 * s;
        if (isWater(x, z)) continue;
        if (islandAt(x, z)) {
          if (rand() > 0.45) palms.push({ x, z, y: 1.3, s: 0.8 + rand() * 0.4 });
        } else if (rand() > 0.4) {
          addTree(x, z, 1.24, 0.9);
        }
      }
    }
  }

  // 海心沙环岛
  for (const isl of data.water.islands) {
    const pts = flatPoints(isl);
    for (let i = 0; i < pts.length; i += 2) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const cx = (a.x + b.x) * 0.5;
      const cz = (a.z + b.z) * 0.5;
      if (Math.abs(cx - 70) > 600 || Math.abs(cz + 555) > 180) continue;
      addTree(cx, cz, 1.3, 0.8);
    }
  }

  // 花城广场整齐的行道树
  for (let z = -760; z > -2270; z -= 27) {
    for (const x of [-132, -105, -42, 42, 105, 132]) {
      if (rand() < 0.12) continue;
      addTree(x + (rand() - 0.5) * 4, z + (rand() - 0.5) * 4, 0.36, 0.85);
    }
  }

  // 公园里的散植树
  let parkCount = 0;
  for (const [kind, flat] of data.parks) {
    if (kind !== 0) continue;
    const pts = flatPoints(flat);
    const area = Math.abs(ringArea(pts));
    if (area < 600) continue;
    const n = Math.min(7, Math.floor(area / 4500));
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    for (let i = 0; i < n; i++) {
      for (let attempt = 0; attempt < 8; attempt++) {
        const x = minX + rand() * (maxX - minX);
        const z = minZ + rand() * (maxZ - minZ);
        if (pointInRing(x, z, pts)) {
          addTree(x, z, islandAt(x, z) ? 1.3 : 0.28, 0.9);
          parkCount++;
          break;
        }
      }
    }
  }

  // 主要道路行道树
  for (const [kind, width, flat] of data.roads) {
    if (kind < 1) continue;
    const pts = flatPoints(flat);
    let acc = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz);
      acc += len;
      if (acc < 55) continue;
      acc = 0;
      const nx = -dz / (len || 1);
      const nz = dx / (len || 1);
      for (const s of [-1, 1]) {
        const x = b.x + nx * (width * 0.5 + 7) * s;
        const z = b.z + nz * (width * 0.5 + 7) * s;
        if (isWater(x, z)) continue;
        if (rand() < 0.55) addTree(x, z, islandAt(x, z) ? 1.3 : 0.3, 0.75);
      }
    }
  }

  // 树的数量上限，保持实例化网格轻量
  const maxTrees = 2200;
  const treeItems = items.slice(0, maxTrees);
  const palmItems = palms.slice(0, 180);

  const trunkGeo = new THREE.CylinderGeometry(0.55, 0.85, 5.6, 5);
  trunkGeo.translate(0, 2.8, 0);
  const canopyGeo = new THREE.IcosahedronGeometry(4.4, 0);
  canopyGeo.translate(0, 8.3, 0);

  const trunkMat = new THREE.MeshStandardMaterial({
    color: 0x3a2b21,
    roughness: 0.95,
    metalness: 0.02,
  });
  const canopyMat = new THREE.MeshStandardMaterial({
    color: 0x315f3e,
    roughness: 0.9,
    metalness: 0.02,
    emissive: new THREE.Color(0x08180e),
    emissiveIntensity: 0.5,
  });

  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeItems.length);
  const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, treeItems.length);
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  for (let i = 0; i < treeItems.length; i++) {
    const t = treeItems[i];
    dummy.position.set(t.x, t.y, t.z);
    dummy.rotation.set(0, t.ry, 0);
    dummy.scale.set(t.s, t.s, t.s);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    canopies.setMatrixAt(i, dummy.matrix);
    col.setHSL(0.28 + rand() * 0.06, 0.32 + rand() * 0.14, 0.26 + rand() * 0.12);
    canopies.setColorAt(i, col);
  }
  trunks.instanceMatrix.needsUpdate = true;
  canopies.instanceMatrix.needsUpdate = true;
  if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;

  const group = new THREE.Group();
  group.add(trunks, canopies);

  // 棕榈树
  if (palmItems.length) {
    const pTrunkGeo = new THREE.CylinderGeometry(0.28, 0.52, 9.5, 5);
    pTrunkGeo.translate(0, 4.75, 0);
    const pCanopyGeo = new THREE.ConeGeometry(4.2, 2.5, 7, 1, true);
    pCanopyGeo.translate(0, 9.8, 0);
    const pTrunkMat = new THREE.MeshStandardMaterial({
      color: 0x6b5940,
      roughness: 0.95,
    });
    const pCanopyMat = new THREE.MeshStandardMaterial({
      color: 0x2f6b42,
      roughness: 0.9,
      emissive: 0x08180e,
      emissiveIntensity: 0.4,
      side: THREE.DoubleSide,
    });
    const pTrunks = new THREE.InstancedMesh(pTrunkGeo, pTrunkMat, palmItems.length);
    const pCanopies = new THREE.InstancedMesh(pCanopyGeo, pCanopyMat, palmItems.length);
    for (let i = 0; i < palmItems.length; i++) {
      const t = palmItems[i];
      dummy.position.set(t.x, t.y, t.z);
      dummy.rotation.set(0, rand() * TAU, 0);
      dummy.scale.set(t.s, t.s, t.s);
      dummy.updateMatrix();
      pTrunks.setMatrixAt(i, dummy.matrix);
      pCanopies.setMatrixAt(i, dummy.matrix);
    }
    pTrunks.instanceMatrix.needsUpdate = true;
    pCanopies.instanceMatrix.needsUpdate = true;
    group.add(pTrunks, pCanopies);
  }

  return { group, count: treeItems.length + palmItems.length, trunks, canopies };
}
