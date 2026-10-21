import * as THREE from 'three';
import { clamp, lerp } from '../core/utils.js';
import { appendRibbon } from './roads.js';
import { accentMat, warmAccentMat, whiteSteelMat, concreteMat, redBeaconMat } from './materials.js';

/* ============================================================
   桥梁
   ============================================================ */

export function buildBridge({
  points,
  width,
  deckY,
  ramp,
  railingMat,
  name,
  pierMat = concreteMat,
}) {
  const group = new THREE.Group();
  const pts = points.map(([x, z]) => ({ x, z }));
  const n = pts.length;

  const dists = [0];
  for (let i = 1; i < n; i++) {
    dists.push(dists[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
  }
  const total = dists[n - 1];

  const yAt = (i) => {
    const d = dists[i];
    const a = clamp(d / ramp, 0, 1);
    const b = clamp((total - d) / ramp, 0, 1);
    return deckY * Math.min(a, b);
  };

  const deckArr = { position: [], uv: [], normal: [], index: [] };
  appendRibbon(deckArr, pts, width, (i) => yAt(i), false);

  const deckGeo = new THREE.BufferGeometry();
  deckGeo.setAttribute('position', new THREE.Float32BufferAttribute(deckArr.position, 3));
  deckGeo.setAttribute('uv', new THREE.Float32BufferAttribute(deckArr.uv, 2));
  deckGeo.setAttribute('normal', new THREE.Float32BufferAttribute(deckArr.normal, 3));
  deckGeo.setIndex(deckArr.index);
  deckGeo.computeBoundingSphere();

  const deckMat = new THREE.MeshStandardMaterial({
    color: 0x6c787d,
    metalness: 0.35,
    roughness: 0.55,
    emissive: 0x162e37,
    emissiveIntensity: 0.38,
    side: THREE.DoubleSide,
  });
  const deck = new THREE.Mesh(deckGeo, deckMat);
  group.add(deck);

  // 两侧灯带 / 护栏
  for (const side of [-1, 1]) {
    const edge = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len = Math.hypot(dx, dz) || 1e-6;
      const nx = -dz / len;
      const nz = dx / len;
      edge.push({
        x: pts[i].x + nx * (width * 0.5 - 0.4) * side,
        z: pts[i].z + nz * (width * 0.5 - 0.4) * side,
      });
    }
    const railArr = { position: [], uv: [], normal: [], index: [] };
    appendRibbon(railArr, edge, 0.5, (i) => yAt(i) + 1.15, false);
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.Float32BufferAttribute(railArr.position, 3));
    rg.setAttribute('uv', new THREE.Float32BufferAttribute(railArr.uv, 2));
    rg.setAttribute('normal', new THREE.Float32BufferAttribute(railArr.normal, 3));
    rg.setIndex(railArr.index);
    const rail = new THREE.Mesh(rg, railingMat);
    rail.frustumCulled = false;
    group.add(rail);
  }

  // 桥墩
  const pierGeo = new THREE.CylinderGeometry(1, 1, 1, 10);
  const piers = [];
  for (let i = 2; i < n - 2; i++) {
    const y = yAt(i);
    if (y < deckY * 0.6) continue;
    if (i > 2 && dists[i] - dists[i - 1] < 20 && piers.length) continue;
    piers.push({ x: pts[i].x, z: pts[i].z, y });
  }
  // 限制桥墩间距大致 70m
  const picked = [];
  let last = -1e9;
  for (const p of piers) {
    if (Math.abs(p.z - last) > 62) {
      picked.push(p);
      last = p.z;
    }
  }
  for (const p of picked) {
    for (const off of [-width * 0.28, width * 0.28]) {
      const m = new THREE.Mesh(pierGeo, pierMat);
      m.scale.set(2.1, Math.max(1, p.y), 2.1);
      m.position.set(p.x + off, p.y / 2, p.z);
      group.add(m);
    }
  }

  group.userData = { name, pts, dists, total, yAt, width, deckY };
  return group;
}

export function createBridges() {
  const group = new THREE.Group();
  const curves = [];
  const beacons = [];

  // ---------- 广州大桥 ----------
  {
    const pts = [
      [-866, 212], [-871, 120], [-884, 16], [-901, -79], [-937, -283],
      [-949, -365], [-953, -405], [-962, -574], [-963, -790],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 27,
      deckY: 10,
      ramp: 120,
      railingMat: warmAccentMat,
      name: '广州大桥',
    });
    group.add(bridge);
    curves.push({ bridge, color: 0xffd39a, speed: 0.000028, count: 34, id: 'gz' });
  }

  // ---------- 猎德大桥（独塔斜拉） ----------
  {
    const pts = [
      [964, -101], [960, -234], [955, -401], [952, -493], [950, -538],
      [946, -667], [940, -820], [939, -859], [937, -920], [935, -996],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 29,
      deckY: 13,
      ramp: 130,
      railingMat: accentMat,
      name: '猎德大桥',
    });
    group.add(bridge);

    const px = 950;
    const pz = -652;
    const pylon = new THREE.Group();
    pylon.position.set(px, 0, pz);

    const legMat = whiteSteelMat;
    const leftCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-16, 0, 6),
      new THREE.Vector3(-9, 38, 2),
      new THREE.Vector3(-2, 78, -3),
      new THREE.Vector3(-10, 116, -9),
      new THREE.Vector3(-4, 132, -4),
    ]);
    const rightCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(16, 0, 6),
      new THREE.Vector3(13, 38, 2),
      new THREE.Vector3(8, 78, -3),
      new THREE.Vector3(3, 116, -9),
      new THREE.Vector3(-4, 132, -4),
    ]);
    for (const curve of [leftCurve, rightCurve]) {
      const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 3.2, 8, false), legMat);
      pylon.add(mesh);
    }
    for (const y of [38, 76, 112]) {
      const brace = new THREE.Mesh(new THREE.BoxGeometry(22, 1.3, 2.2), whiteSteelMat);
      brace.position.set(0, y, -1);
      pylon.add(brace);
    }

    const topGlow = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 16, 6), accentMat);
    topGlow.position.set(-4, 138, -5);
    pylon.add(topGlow);

    const red = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), redBeaconMat);
    red.position.set(-4, 147, -4);
    pylon.add(red);
    beacons.push(red);

    group.add(pylon);

    // 斜拉索
    const cablePts = [];
    const anchorY = 12.5;
    for (let i = 0; i < 8; i++) {
      const t = i / 7;
      const topY = 58 + t * 70;
      const topZ = -9 - t * 2;
      const north = -800 + t * 280;
      const south = -500 + t * 340;
      cablePts.push(px - 4, topY, pz + topZ, px, anchorY, north);
      cablePts.push(px - 4, topY, pz + topZ, px, anchorY, south);
    }
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
    group.add(
      new THREE.LineSegments(
        cableGeo,
        new THREE.LineBasicMaterial({
          color: 0xb8f6ff,
          transparent: true,
          opacity: 0.4,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      )
    );

    curves.push({ bridge, color: 0xc8f4ff, speed: 0.000032, count: 40, id: 'ld' });
  }

  // ---------- 海心桥（步行拱桥） ----------
  {
    const pts = [
      [-382, -96], [-405, -132], [-440, -176], [-468, -220],
      [-486, -268], [-480, -316], [-454, -356], [-430, -382],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 8.5,
      deckY: 6.2,
      ramp: 65,
      railingMat: warmAccentMat,
      name: '海心桥',
    });
    group.add(bridge);

    const archCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-382, 6.2, -96),
      new THREE.Vector3(-420, 32, -160),
      new THREE.Vector3(-500, 58, -245),
      new THREE.Vector3(-478, 34, -330),
      new THREE.Vector3(-430, 6.2, -382),
    ]);
    const arch = new THREE.Mesh(
      new THREE.TubeGeometry(archCurve, 48, 2.6, 8, false),
      whiteSteelMat
    );
    group.add(arch);

    const archGlow = new THREE.Mesh(
      new THREE.TubeGeometry(archCurve, 48, 0.7, 6, false),
      accentMat
    );
    archGlow.position.y = 2.1;
    group.add(archGlow);

    const hangers = [];
    for (let i = 1; i < 12; i++) {
      const t = i / 12;
      const top = archCurve.getPoint(t);
      // Approximate the deck point under the arch.
      const deck = new THREE.Vector3(
        lerp(-382, -430, t),
        6.2,
        lerp(-96, -382, t)
      );
      hangers.push(top.x, top.y, top.z, deck.x, deck.y, deck.z);
    }
    const hangerGeo = new THREE.BufferGeometry();
    hangerGeo.setAttribute('position', new THREE.Float32BufferAttribute(hangers, 3));
    group.add(
      new THREE.LineSegments(
        hangerGeo,
        new THREE.LineBasicMaterial({
          color: 0xffe1b8,
          transparent: true,
          opacity: 0.5,
          depthWrite: false,
        })
      )
    );

    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), redBeaconMat);
    beacon.position.set(-500, 60, -245);
    group.add(beacon);
    beacons.push(beacon);
  }

  // ---------- 华南大桥（远景） ----------
  {
    const pts = [
      [2743, -80], [2741, -260], [2743, -470], [2741, -690], [2740, -820],
    ];
    const bridge = buildBridge({
      points: pts,
      width: 32,
      deckY: 15,
      ramp: 150,
      railingMat: warmAccentMat,
      name: '华南大桥',
    });
    group.add(bridge);

    const pylon = new THREE.Mesh(new THREE.BoxGeometry(10, 158, 10), whiteSteelMat);
    pylon.position.set(2742, 79, -560);
    group.add(pylon);
    const glow = new THREE.Mesh(new THREE.BoxGeometry(11, 1.8, 11), accentMat);
    glow.position.set(2742, 158, -560);
    group.add(glow);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.4, 8, 6), redBeaconMat);
    beacon.position.set(2742, 162, -560);
    group.add(beacon);
    beacons.push(beacon);

    const cables = [];
    for (let i = 0; i < 7; i++) {
      const t = i / 6;
      const y = 40 + t * 110;
      const z = -700 + t * 130;
      cables.push(2742, y, -560, 2742, 16, z);
      cables.push(2742, y, -560, 2742, 16, -420 - t * 130);
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    group.add(
      new THREE.LineSegments(
        cg,
        new THREE.LineBasicMaterial({
          color: 0xa9efff,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        })
      )
    );
  }

  return { group, curves, beacons };
}
