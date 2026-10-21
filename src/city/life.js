import * as THREE from 'three';

import { mulberry32 } from '../core/utils.js';
import { collectRoads, findIntersections } from './road-network.js';
import { updateSignalStates, createSignals } from './signals.js';
import { createCars } from './traffic.js';
import { collectWalkPaths, createPedestrians } from './pedestrians.js';

/* ============================================================
   城市生命：车流 / 行人 / 信号灯
   ------------------------------------------------------------
   · 车辆：沿主干道 / 快速路的车道行驶，路口遇红灯减速停车；
   · 行人：滨江步道、海心沙环岛、花城广场轴线与塔基广场的
     步行人流，按路径往返 / 环绕；
   · 信号灯：主要路口的两相位灯组，红 / 黄 / 绿循环，
     与车流共用同一套相位状态；
   · 全部元素使用 InstancedMesh / Points 合批，保持低绘制次数。
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
    cars,
    peds,
    signals,
    roads,
    intersections,
    stats: {
      cars: cars.count,
      pedestrians: peds.count,
      signals: signals.count,
      roads: roads.length,
      intersections: intersections.length,
    },
  };
}
