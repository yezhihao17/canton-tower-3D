import * as THREE from 'three';
import { accentMat, warmAccentMat, darkMetalMat, whiteSteelMat, concreteMat, redBeaconMat } from './materials.js';

/* ============================================================
   地标细节
   ============================================================ */

export function createEastTower(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const facade = (() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 512;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#2a4753';
    ctx.fillRect(0, 0, 128, 512);
    for (let y = 0; y < 512; y += 16) {
      for (let x = 0; x < 128; x += 8) {
        const lit = Math.random() > 0.52;
        ctx.fillStyle = lit
          ? `rgba(${150 + Math.random() * 80}, ${210 + Math.random() * 30}, 245, ${0.4 + Math.random() * 0.5})`
          : 'rgba(40, 70, 84, 0.85)';
        ctx.fillRect(x + 2, y + 3, 4, 9);
      }
    }
    ctx.strokeStyle = 'rgba(150, 230, 255, 0.28)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= 128; x += 8) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, 512);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 12);
    tex.anisotropy = 8;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  })();

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xdceef4,
    map: facade,
    emissive: 0xffffff,
    emissiveMap: facade,
    emissiveIntensity: 0.6,
    metalness: 0.5,
    roughness: 0.3,
  });

  // 裙楼
  const podium = new THREE.Mesh(new THREE.BoxGeometry(112, 26, 96), glassMat);
  podium.position.y = 13;
  group.add(podium);
  const podiumBand = new THREE.Mesh(new THREE.BoxGeometry(114, 1.4, 98), accentMat);
  podiumBand.position.y = 26.4;
  group.add(podiumBand);

  const sections = [
    { y0: 0, y1: 120, w: 68 },
    { y0: 120, y1: 360, w: 60 },
    { y0: 360, y1: 480, w: 51 },
    { y0: 480, y1: 522, w: 38 },
  ];
  const rFor = (w) => w / Math.SQRT2;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const next = sections[i + 1];
    const topW = next ? next.w : 30;
    const geo = new THREE.CylinderGeometry(
      rFor(topW),
      rFor(s.w),
      s.y1 - s.y0,
      4,
      1,
      false
    );
    const m = new THREE.Mesh(geo, glassMat);
    m.position.y = (s.y0 + s.y1) / 2;
    m.rotation.y = Math.PI / 4;
    group.add(m);
  }

  // 顶部冠部
  const crownMat = new THREE.MeshStandardMaterial({
    color: 0xcfeef7,
    emissive: 0x3a93a8,
    emissiveIntensity: 0.18,
    metalness: 0.3,
    roughness: 0.25,
    transparent: true,
    opacity: 0.55,
  });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(16, 26, 10, 4), crownMat);
  crown.position.y = 527;
  crown.rotation.y = Math.PI / 4;
  group.add(crown);

  const crownRing = new THREE.Mesh(new THREE.TorusGeometry(28, 0.7, 6, 32), accentMat);
  crownRing.rotation.x = Math.PI / 2;
  crownRing.position.y = 522;
  group.add(crownRing);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.7, 8, 6), redBeaconMat);
  beacon.position.y = 536;
  group.add(beacon);

  // 四角竖向灯带
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(1.1, 430, 1.1), accentMat);
    strip.position.set(sx * 25, 250, sz * 25);
    group.add(strip);
  }

  return group;
}

export function createWestTowerDetails(x, z, h) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const ring = new THREE.Mesh(new THREE.TorusGeometry(38, 0.8, 6, 48), accentMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = h - 14;
  group.add(ring);

  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(36, 0.5, 6, 48), accentMat);
  ring2.rotation.x = Math.PI / 2;
  ring2.position.y = h - 28;
  group.add(ring2);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(30, 38, 7, 48),
    new THREE.MeshStandardMaterial({
      color: 0xbfd6df,
      metalness: 0.6,
      roughness: 0.35,
      emissive: 0x1d4c5a,
      emissiveIntensity: 0.7,
    })
  );
  cap.position.y = h - 2;
  group.add(cap);

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.5, 8, 6), redBeaconMat);
  beacon.position.y = h + 5;
  group.add(beacon);

  return group;
}

export function createCitic() {
  const group = new THREE.Group();
  group.position.set(25, 0, -3975);

  const pod = new THREE.Mesh(new THREE.BoxGeometry(150, 20, 100), darkMetalMat);
  pod.position.y = 10;
  group.add(pod);

  const mat = new THREE.MeshStandardMaterial({
    color: 0x68747c,
    metalness: 0.55,
    roughness: 0.42,
    emissive: 0x122a34,
    emissiveIntensity: 0.45,
  });

  const tower = (ox, h, w) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    b.position.set(ox, h / 2 + 12, 0);
    group.add(b);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(2, w * 0.55, 26, 4), mat);
    top.position.set(ox, h + 12 + 13, 0);
    top.rotation.y = Math.PI / 4;
    group.add(top);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.6, 8, 6), redBeaconMat);
    beacon.position.set(ox, h + 12 + 28, 0);
    group.add(beacon);
  };

  tower(-55, 380, 46);
  tower(55, 350, 44);

  const band = new THREE.Mesh(new THREE.BoxGeometry(154, 1.5, 102), accentMat);
  band.position.y = 20.5;
  group.add(band);

  return group;
}

export function createOpera() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: 0xb8c3c7,
    metalness: 0.32,
    roughness: 0.4,
    emissive: 0x1b3a44,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
  });

  const a = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 24), mat);
  a.scale.set(72, 21, 54);
  a.position.set(-142, 8, -1004);
  a.rotation.y = -0.25;
  group.add(a);

  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 36, 20), mat);
  b.scale.set(54, 16, 42);
  b.position.set(-66, 6, -978);
  b.rotation.y = 0.35;
  group.add(b);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(1, 0.012, 4, 64), accentMat);
  rim.scale.set(64, 48, 1);
  rim.rotation.x = Math.PI / 2;
  rim.position.set(-142, 28, -1004);
  group.add(rim);

  return group;
}

export function createMuseum(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0x48201f,
    metalness: 0.25,
    roughness: 0.55,
    emissive: 0x2a0c0c,
    emissiveIntensity: 0.45,
  });
  const body = new THREE.Mesh(new THREE.BoxGeometry(108, 28, 108), bodyMat);
  body.position.y = 14;
  group.add(body);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(116, 2.2, 116), darkMetalMat);
  roof.position.y = 28.8;
  group.add(roof);

  // 金色横向与竖向饰带
  for (let y = 5; y < 28; y += 5.5) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(109, 0.45, 109), warmAccentMat);
    band.position.y = y;
    group.add(band);
  }
  for (let i = -4; i <= 4; i++) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.42, 22, 0.42), warmAccentMat);
    strip.position.set(i * 11, 15, 54.6);
    group.add(strip);
    const strip2 = strip.clone();
    strip2.position.z = -54.6;
    group.add(strip2);
    const strip3 = new THREE.Mesh(new THREE.BoxGeometry(0.42, 22, 0.42), warmAccentMat);
    strip3.position.set(54.6, 15, i * 11);
    group.add(strip3);
    const strip4 = strip3.clone();
    strip4.position.x = -54.6;
    group.add(strip4);
  }

  return group;
}

export function createLibrary(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);

  const mat = new THREE.MeshStandardMaterial({
    color: 0xb7c2c6,
    metalness: 0.28,
    roughness: 0.46,
    emissive: 0x1b353e,
    emissiveIntensity: 0.35,
  });
  const base = new THREE.Mesh(new THREE.BoxGeometry(136, 24, 88), mat);
  base.position.y = 12;
  base.rotation.y = -0.08;
  group.add(base);

  // 倾斜的屋面
  const roof = new THREE.Mesh(new THREE.BoxGeometry(148, 3.2, 98), darkMetalMat);
  roof.position.y = 27;
  roof.rotation.z = -0.09;
  roof.rotation.y = -0.08;
  group.add(roof);

  for (let y = 6; y < 24; y += 6) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(137, 0.5, 89), accentMat);
    band.position.y = y;
    band.rotation.y = -0.08;
    group.add(band);
  }

  const beacon = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), redBeaconMat);
  beacon.position.y = 31;
  group.add(beacon);

  return group;
}

export function createStadium(x, z) {
  const group = new THREE.Group();
  group.position.set(x, 1.28, z);

  const bowlMat = new THREE.MeshStandardMaterial({
    color: 0xb6c7ce,
    metalness: 0.4,
    roughness: 0.45,
    emissive: 0x16333d,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
  });
  const bowl = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.05, 17, 72, 1, true), bowlMat);
  bowl.scale.set(158, 1, 92);
  bowl.position.y = 8.5;
  group.add(bowl);

  const rim = new THREE.Mesh(new THREE.RingGeometry(0.955, 1, 96), accentMat);
  rim.rotation.x = -Math.PI / 2;
  rim.scale.set(158, 92, 1);
  rim.position.y = 17.2;
  group.add(rim);

  const field = new THREE.Mesh(
    new THREE.CircleGeometry(1, 64),
    new THREE.MeshStandardMaterial({
      color: 0x3f7a4d,
      roughness: 0.9,
      emissive: 0x1a4326,
      emissiveIntensity: 0.65,
    })
  );
  field.rotation.x = -Math.PI / 2;
  field.scale.set(128, 64, 1);
  field.position.y = 0.7;
  group.add(field);

  // 田径跑道
  const track = new THREE.Mesh(
    new THREE.RingGeometry(0.84, 0.99, 80),
    new THREE.MeshStandardMaterial({
      color: 0x8c5648,
      roughness: 0.92,
      emissive: 0x2c0f0b,
      emissiveIntensity: 0.45,
    })
  );
  track.rotation.x = -Math.PI / 2;
  track.scale.set(158, 92, 1);
  track.position.y = 0.62;
  group.add(track);

  // 四角灯柱
  for (const dx of [-1, 1]) {
    for (const dz of [-1, 1]) {
      const px = dx * 146;
      const pz = dz * 76;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 1.0, 34, 8), concreteMat);
      pole.position.set(px, 17, pz);
      group.add(pole);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(7, 2.2, 7), warmAccentMat);
      lamp.position.set(px, 34.5, pz);
      group.add(lamp);
    }
  }

  return group;
}

export function createCantonPier() {
  const group = new THREE.Group();
  group.position.set(260, 0.2, -185);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(54, 2, 14), concreteMat);
  deck.position.y = 1.5;
  group.add(deck);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(42, 1.2, 12), darkMetalMat);
  roof.position.y = 8;
  group.add(roof);

  for (const x of [-18, 0, 18]) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 6.5, 6), whiteSteelMat);
    col.position.set(x, 4.5, 0);
    group.add(col);
  }

  const glow = new THREE.Mesh(new THREE.BoxGeometry(40, 0.45, 0.5), warmAccentMat);
  glow.position.set(0, 8.7, 6.4);
  group.add(glow);

  // 停靠的小渡轮
  const boat = new THREE.Group();
  boat.position.set(0, 1.8, -12);
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(26, 2.2, 6),
    new THREE.MeshStandardMaterial({ color: 0xd6e3e8, metalness: 0.3, roughness: 0.5 })
  );
  hull.position.y = 1;
  boat.add(hull);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(16, 3.2, 4.6),
    new THREE.MeshStandardMaterial({ color: 0x8fb6c2, metalness: 0.35, roughness: 0.4 })
  );
  cabin.position.y = 3.2;
  boat.add(cabin);
  const windows = new THREE.Mesh(new THREE.BoxGeometry(17, 0.7, 4.8), warmAccentMat);
  windows.position.y = 3.7;
  boat.add(windows);
  group.add(boat);

  return group;
}
