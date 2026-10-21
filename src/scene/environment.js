import * as THREE from 'three';

import { flatPoints, pointInRing, mulberry32, lerp } from '../core/utils.js';
import { createSky, createStars } from './sky.js';
import { createGround, createParks, createWater, createRiverFront } from './terrain.js';
import { createRoadGeometry } from './roads.js';
import { createBuildings } from './building-mass.js';
import {
  createEastTower,
  createWestTowerDetails,
  createCitic,
  createOpera,
  createMuseum,
  createLibrary,
  createStadium,
  createCantonPier,
} from './landmarks.js';
import { createBridges } from './bridges.js';
import { createTrees } from './vegetation.js';
import { createCityLights, createTraffic } from './effects.js';
import { createBoats } from './boats.js';
import { accentMat } from './materials.js';
import { createStreetDetails } from './details.js';
import { createLife } from '../city/life.js';

/* ============================================================
   珠江新城 · 环境还原
   ------------------------------------------------------------
   几何来源：OpenStreetMap（见 src/data/city-data.js）。
   局部坐标：1 单位 = 1 米，x 向东，z 向南，y 向上；
   原点为广州塔中心。数据由 scripts/build_city_data.py 生成。

   场景按模块拆分：
   · sky / terrain / roads / building-mass / landmarks / bridges
   · vegetation / effects / boats / details
   · city/life 负责车流、行人、信号灯等动态元素
   ============================================================ */

export function createEnvironment(scene, data) {
  const islandPts = data.water.islands.map((flat) => flatPoints(flat));
  const islandAt = (x, z) => {
    for (const ring of islandPts) {
      if (pointInRing(x, z, ring)) return true;
    }
    return false;
  };

  /* ---------- 天空 / 星空 ---------- */
  const sky = createSky();
  scene.add(sky.mesh);
  const skyMat = sky.mat;

  const stars = createStars();
  scene.add(stars.points);

  /* ---------- 地面 ---------- */
  const ground = createGround();
  scene.add(ground.group);

  /* ---------- 公园 ---------- */
  const parks = createParks(data, islandAt);
  scene.add(parks.group);

  /* ---------- 珠江 ---------- */
  const water = createWater(data, islandAt);
  scene.add(water.group);

  const riverFront = createRiverFront(data);
  scene.add(riverFront.group);

  /* ---------- 道路 ---------- */
  const roads = createRoadGeometry(data, islandAt);
  for (const mesh of roads.meshes) scene.add(mesh);

  /* ---------- 建筑 ---------- */
  const buildings = createBuildings(data, islandAt);
  scene.add(buildings.mesh);

  const beaconGeo = new THREE.SphereGeometry(1.4, 6, 5);
  const beaconMesh = new THREE.InstancedMesh(
    beaconGeo,
    new THREE.MeshBasicMaterial({ color: 0xff4b5c, transparent: true, opacity: 0.85 }),
    Math.max(1, buildings.beacons.length)
  );
  const dummy = new THREE.Object3D();
  buildings.beacons.forEach((b, i) => {
    dummy.position.set(b.x, b.y, b.z);
    dummy.updateMatrix();
    beaconMesh.setMatrixAt(i, dummy.matrix);
  });
  beaconMesh.instanceMatrix.needsUpdate = true;
  beaconMesh.count = buildings.beacons.length;
  beaconMesh.frustumCulled = false;
  scene.add(beaconMesh);

  /* ---------- 地标 ---------- */
  const landmarks = data.landmarks;
  const east = createEastTower(landmarks.eastTower[0], landmarks.eastTower[1]);
  scene.add(east);
  scene.add(
    createWestTowerDetails(
      landmarks.westTower[0],
      landmarks.westTower[1],
      landmarks.westTower[2]
    )
  );
  scene.add(createCitic());
  scene.add(createOpera());
  scene.add(createMuseum(landmarks.museum[0], landmarks.museum[1]));
  scene.add(createLibrary(landmarks.library[0], landmarks.library[1]));
  scene.add(createStadium(-48, -552));
  scene.add(createCantonPier());

  /* ---------- 桥梁 ---------- */
  const bridges = createBridges();
  scene.add(bridges.group);

  /* ---------- 树木 ---------- */
  const trees = createTrees(data, islandAt, data.water.rivers.map(flatPoints));
  scene.add(trees.group);

  /* ---------- 城市灯火 / 桥上车流 / 游船 ---------- */
  const cityLights = createCityLights(
    data,
    data.water.rivers.map(flatPoints),
    islandAt
  );
  scene.add(cityLights);

  const traffic = createTraffic(bridges.curves);
  for (const t of traffic) scene.add(t.points);

  const boats = createBoats();
  scene.add(boats.group);

  /* ---------- 城市生命：车流 / 行人 / 信号灯 ---------- */
  const life = createLife({
    data,
    islandAt,
    riverRings: data.water.rivers.map((flat) => flatPoints(flat)),
    islandRings: data.water.islands.map((flat) => flatPoints(flat)),
  });
  scene.add(life.group);

  /* ---------- 街道细节：路缘石、人行道、斑马线、路灯、长椅、栏杆 ---------- */
  const details = createStreetDetails({
    data,
    islandAt,
    roads: life.roads,
    intersections: life.intersections,
    riverRings: data.water.rivers.map(flatPoints),
    islandRings: islandPts,
  });
  scene.add(details.group);

  /* ---------- 水面倒影光源 ---------- */
  const waterLights = [
    { x: -930, z: -450, width: 80, strength: 0.5, color: 0xffd39a },
    { x: 950, z: -650, width: 70, strength: 0.55, color: 0xbff4ff },
    { x: -468, z: -240, width: 45, strength: 0.35, color: 0xffe1b8 },
    { x: 2743, z: -650, width: 80, strength: 0.4, color: 0xffd39a },
    { x: 70, z: -555, width: 100, strength: 0.35, color: 0x9fe8ff },
    { x: 0, z: -138, width: 80, strength: 0.2, color: 0xffc27a },
    { x: -700, z: -731, width: 100, strength: 0.25, color: 0xffc27a },
    { x: 180, z: -270, width: 40, strength: 0.4, color: 0xffd08a },
    { x: -300, z: -500, width: 50, strength: 0.2, color: 0x9fe8ff },
    { x: 900, z: -450, width: 50, strength: 0.2, color: 0xffc27a },
  ];
  const lightVecs = water.uniforms.uLights.value;
  const lightCols = water.uniforms.uLightColors.value;
  for (let i = 0; i < lightVecs.length; i++) {
    const l = waterLights[i];
    if (!l) continue;
    lightVecs[i].set(l.x, l.z, l.width, l.strength);
    lightCols[i].setHex(l.color);
  }
  const boatLight = lightVecs[7];
  const boatLight2 = lightVecs[9];

  /* ---------- 灯光 ---------- */
  const ambient = new THREE.HemisphereLight(0x6fa8c4, 0x04070b, 0.55);
  scene.add(ambient);

  const key = new THREE.DirectionalLight(0x9fdcff, 1.1);
  key.position.set(180, 300, 200);
  scene.add(key);

  const rim = new THREE.DirectionalLight(0x6a5cff, 0.9);
  rim.position.set(-220, 140, -240);
  scene.add(rim);

  const warm = new THREE.PointLight(0xffb56b, 2.2, 420, 2);
  warm.position.set(0, 150, 0);
  scene.add(warm);

  const deckLight = new THREE.PointLight(0x7fe9ff, 3.0, 260, 2);
  deckLight.position.set(0, 340, 0);
  scene.add(deckLight);

  scene.fog = new THREE.FogExp2(0x0e2838, 0.00022);

  /* ---------- 动画 ---------- */
  function update(time, dt) {
    skyMat.uniforms.uTime.value = time;
    water.uniforms.uTime.value = time;
    stars.mat.uniforms.uTime.value = time;
    ground.plazaMat.uniforms.uTime.value = time;
    stars.points.rotation.y = time * 0.003;

    // 游船
    for (const b of boats.boats) {
      const period = 1800;
      const x = ((time * b.speed + b.offset + 900) % period) - 900;
      b.obj.position.x = x;
      b.obj.position.z = b.laneZ + Math.sin(time * 0.3 + b.offset) * 1.5;
      b.obj.position.y = 1.05 + Math.sin(time * 1.4 + b.offset) * b.bob;
      b.obj.rotation.x = Math.sin(time * 0.9 + b.offset) * 0.004;
      b.obj.rotation.y = b.heading;
      b.obj.rotation.z = Math.sin(time * 1.1 + b.offset) * 0.006;
    }

    // 珠江夜游船的倒影跟随
    if (boatLight) {
      boatLight.x = boats.cruise.position.x;
      boatLight.y = boats.cruise.position.z;
    }
    if (boatLight2) {
      boatLight2.x = boats.cruise2.position.x;
      boatLight2.y = boats.cruise2.position.z;
    }

    // 桥上车流
    for (const t of traffic) {
      const { bridge, data: cars, pos, dists, total, yAt } = t;
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i];
        let d = (car.offset + time * car.speed * 60) % total;
        if (d < 0) d += total;
        let j = 1;
        while (j < dists.length - 1 && dists[j] < d) j++;
        const a = bridge.userData.pts[j - 1];
        const b = bridge.userData.pts[j];
        const seg = Math.max(0.001, dists[j] - dists[j - 1]);
        const u = (d - dists[j - 1]) / seg;
        const x = lerp(a.x, b.x, u);
        const z = lerp(a.z, b.z, u);
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const len = Math.hypot(dx, dz) || 1;
        const nx = -dz / len;
        const nz = dx / len;
        pos[i * 3] = x + nx * car.lane;
        pos[i * 3 + 1] = yAt(j - 1) + 1.2;
        pos[i * 3 + 2] = z + nz * car.lane;
      }
      t.points.geometry.attributes.position.needsUpdate = true;
    }

    // 街道车流 / 行人 / 信号灯
    life.update(time, dt);

    // 轻微的水面灯光呼吸
    if (lightVecs[0]) {
      const s = 0.72 + Math.sin(time * 0.9) * 0.08;
      lightVecs[0].w = s;
    }
  }

  return {
    update,
    sky: sky.mesh,
    skyMat,
    water: { mat: water.mat, uniforms: water.uniforms, group: water.group },
    cityMats: [buildings.mat],
    cityLights,
    bridgeLightMat: accentMat,
    stars,
    lights: { ambient, key, rim, warm, deckLight },
    ground,
    parks,
    trees,
    boats,
    traffic,
    life,
    details,
    beaconMesh,
    landmarks,
  };
}
