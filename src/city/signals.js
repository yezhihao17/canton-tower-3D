import * as THREE from 'three';
import { mergeGeometries } from '../core/geometry.js';

/* ============================================================
   信号灯相位
   ============================================================ */

export const SIGNAL_CYCLE = 30;
export const SIGNAL_GREEN = 14;
export const SIGNAL_YELLOW = 2;

/* group 0 = 东西向（axis 0），group 1 = 南北向（axis 1） */
export const signalStates = ['green', 'green'];

export function updateSignalStates(time) {
  const offset = [0, SIGNAL_CYCLE * 0.5];
  for (let g = 0; g < 2; g++) {
    const t = (time + offset[g]) % SIGNAL_CYCLE;
    if (t < SIGNAL_GREEN) signalStates[g] = 'green';
    else if (t < SIGNAL_GREEN + SIGNAL_YELLOW) signalStates[g] = 'yellow';
    else signalStates[g] = 'red';
  }
}

/* ============================================================
   信号灯实体
   ============================================================ */

export function createSignals(roads, intersections) {
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
