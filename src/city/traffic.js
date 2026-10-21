import * as THREE from 'three';
import { clamp, smoothstep } from '../core/utils.js';
import { mergeGeometries } from '../core/geometry.js';
import { sampleRoad, curvatureAt } from './road-network.js';
import { signalStates } from './signals.js';

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
   车流
   ============================================================ */

export function createCars(roads, islandAt, rand) {
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
      // 与路面纹理的车道线对齐，避免车身骑在车道线上
      const laneIndex = (i + (rand() < 0.5 ? 0 : 1)) % road.laneCount;
      bodies.push({
        road,
        d: ((i + rand() * 0.55) / count) * road.total,
        dir,
        lane: -dir * road.width * road.laneOffsets[laneIndex],
        laneIndex,
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

      // 弯道限速：转角越大，目标速度越低
      const curve = curvatureAt(road, car.d, 10 + car.speed * 1.8);
      const curveFactor = clamp(1 - curve * 1.8, 0.34, 1);

      // 前方最近的红灯
      let target = car.cruise * curveFactor;
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
      // 折线在路口处仍可能有尖角，用相邻采样点的方向做一次短距离平滑
      const ahead = sampleRoad(road, car.d + car.dir * 3.2);
      const aheadX = ahead.dx * car.dir;
      const aheadZ = ahead.dz * car.dir;
      const yaw = Math.atan2(-(dz * 0.55 + aheadZ * 0.45), dx * 0.55 + aheadX * 0.45);

      // 道路两端缩放到 0 后再回到起点，避免瞬移被看见
      const edge = Math.min(car.d, road.total - car.d);
      const fade = smoothstep(0, 7, edge);

      dummy.position.set(x, y, z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(car.scaleX * fade, car.scaleY * fade, fade);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      const sideX = -dz;
      const sideZ = dx;
      const bob = Math.sin(time * 6 + car.phase) * 0.02 * (car.speed / 12);
      const yl = fade < 0.12 ? -20 : y + 0.62 + bob;
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

  mesh.userData.pickable = { type: 'car', label: '汽车', count: bodies.length };

  return { group, update, count: bodies.length, mesh, bodies };
}
