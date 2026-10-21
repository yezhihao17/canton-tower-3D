import * as THREE from 'three';
import { warmAccentMat, accentMat, darkMetalMat, whiteSteelMat } from './materials.js';

function makeWakeTexture() {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, s, 0);
  g.addColorStop(0, 'rgba(180,230,255,0)');
  g.addColorStop(0.55, 'rgba(210,242,255,0.22)');
  g.addColorStop(0.86, 'rgba(238,250,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0.62)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(s, 10);
  ctx.lineTo(s, s - 10);
  ctx.lineTo(0, s * 0.5);
  ctx.closePath();
  ctx.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function createBoats() {
  const group = new THREE.Group();
  const boats = [];

  const wakeMat = new THREE.MeshBasicMaterial({
    map: makeWakeTexture(),
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  // 统一登记：位置 / 航向 / 尾迹
  const addBoat = (obj, { laneZ, speed, offset, bob, length, trail, type }) => {
    group.add(obj);
    if (trail) {
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      geo.translate(-0.5, 0, 0);
      const wake = new THREE.Mesh(geo, wakeMat);
      wake.scale.set(trail, 1, length * 0.52);
      wake.position.set(-length * 0.5 + 1.5, -0.02, 0);
      wake.renderOrder = 2;
      obj.add(wake);
    }
    boats.push({
      obj,
      laneZ,
      speed,
      offset,
      bob,
      type: type || '游船',
      heading: speed >= 0 ? 0 : Math.PI,
    });
  };

  const makeHull = (len, wid, color) => {
    const shape = new THREE.Shape();
    shape.moveTo(-len / 2, -wid / 2);
    shape.lineTo(len / 2 - 4, -wid / 2);
    shape.lineTo(len / 2, 0);
    shape.lineTo(len / 2 - 4, wid / 2);
    shape.lineTo(-len / 2, wid / 2);
    shape.lineTo(-len / 2 + 3, 0);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 2.2,
      bevelEnabled: false,
      steps: 1,
    });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 2.2, 0);
    const mat = new THREE.MeshStandardMaterial({
      color,
      metalness: 0.3,
      roughness: 0.45,
      emissive: 0x0a1a22,
      emissiveIntensity: 0.25,
    });
    return new THREE.Mesh(geo, mat);
  };

  const makeCruise = () => {
    const b = new THREE.Group();
    const hull = makeHull(30, 9, 0xd9e5ea);
    b.add(hull);

    const deck1 = new THREE.Mesh(
      new THREE.BoxGeometry(24, 2.8, 7.2),
      new THREE.MeshStandardMaterial({
        color: 0x9fc7d3,
        metalness: 0.35,
        roughness: 0.35,
        emissive: 0x122c36,
        emissiveIntensity: 0.4,
      })
    );
    deck1.position.y = 4;
    b.add(deck1);

    const windows1 = new THREE.Mesh(new THREE.BoxGeometry(24.5, 1.0, 7.4), warmAccentMat);
    windows1.position.y = 4.6;
    b.add(windows1);

    const deck2 = new THREE.Mesh(
      new THREE.BoxGeometry(18, 2.4, 5.8),
      new THREE.MeshStandardMaterial({
        color: 0xcfe2e8,
        metalness: 0.3,
        roughness: 0.35,
        emissive: 0x17343e,
        emissiveIntensity: 0.45,
      })
    );
    deck2.position.y = 6.8;
    b.add(deck2);

    const windows2 = new THREE.Mesh(new THREE.BoxGeometry(18.4, 0.8, 6), accentMat);
    windows2.position.y = 7.3;
    b.add(windows2);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(19, 0.5, 6.2), darkMetalMat);
    roof.position.y = 8.2;
    b.add(roof);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6, 5), whiteSteelMat);
    mast.position.set(0, 11, 0);
    b.add(mast);
    const mastLight = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 5), warmAccentMat);
    mastLight.position.set(0, 14, 0);
    b.add(mastLight);

    return b;
  };

  const makeFerry = () => {
    const b = new THREE.Group();
    const hull = makeHull(17, 6, 0xe2edf1);
    b.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(12, 2.6, 4.6),
      new THREE.MeshStandardMaterial({
        color: 0xa7c5cf,
        metalness: 0.25,
        roughness: 0.45,
      })
    );
    cabin.position.y = 3.6;
    b.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(12.4, 0.8, 4.8), warmAccentMat);
    win.position.y = 4.05;
    b.add(win);
    return b;
  };

  const makeBarge = () => {
    const b = new THREE.Group();
    const hull = makeHull(24, 7, 0x6b7378);
    b.add(hull);
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(12, 3.2, 5.4),
      new THREE.MeshStandardMaterial({ color: 0x6c4c34, roughness: 0.9 })
    );
    cargo.position.set(-1, 3.8, 0);
    b.add(cargo);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.35, 6, 5), warmAccentMat);
    light.position.set(9, 4.2, 0);
    b.add(light);
    return b;
  };

  const makeWaterTaxi = () => {
    const b = new THREE.Group();
    const hull = makeHull(11, 4, 0xf0f4f5);
    b.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(6.4, 1.8, 3.2),
      new THREE.MeshStandardMaterial({
        color: 0xb7d2da,
        metalness: 0.3,
        roughness: 0.4,
      })
    );
    cabin.position.y = 3;
    b.add(cabin);
    const win = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.6, 3.4), accentMat);
    win.position.y = 3.3;
    b.add(win);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.24, 3), darkMetalMat);
    canopy.position.set(-2.4, 3.9, 0);
    b.add(canopy);
    return b;
  };

  const makeSpeedboat = () => {
    const b = new THREE.Group();
    const hull = makeHull(9, 3.2, 0xe6eef1);
    b.add(hull);
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(4, 1.2, 2.6),
      new THREE.MeshStandardMaterial({ color: 0x7d9aa5, metalness: 0.35, roughness: 0.35 })
    );
    cabin.position.set(-0.6, 2.6, 0);
    b.add(cabin);
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 6, 5), warmAccentMat);
    light.position.set(4, 2.9, 0);
    b.add(light);
    return b;
  };

  const cruise = makeCruise();
  addBoat(cruise, { laneZ: -270, speed: 4.4, offset: 0, bob: 0.06, length: 30, trail: 26, type: '珠江游船' });

  const cruise2 = makeCruise();
  addBoat(cruise2, { laneZ: -372, speed: -3.8, offset: 760, bob: 0.05, length: 30, trail: 24, type: '珠江游船' });

  const ferry1 = makeFerry();
  addBoat(ferry1, { laneZ: -312, speed: -5.2, offset: 240, bob: 0.04, length: 17, trail: 16, type: '过江轮渡' });

  const ferry2 = makeFerry();
  addBoat(ferry2, { laneZ: -238, speed: 4.9, offset: 780, bob: 0.045, length: 17, trail: 15, type: '过江轮渡' });

  const ferry3 = makeFerry();
  addBoat(ferry3, { laneZ: -566, speed: 3.6, offset: 420, bob: 0.045, length: 17, trail: 14, type: '过江轮渡' });

  const taxi1 = makeWaterTaxi();
  addBoat(taxi1, { laneZ: -208, speed: 6.6, offset: 1180, bob: 0.035, length: 11, trail: 12, type: '水上巴士' });

  const taxi2 = makeWaterTaxi();
  addBoat(taxi2, { laneZ: -642, speed: -5.8, offset: 340, bob: 0.035, length: 11, trail: 11, type: '水上巴士' });

  const barge = makeBarge();
  addBoat(barge, { laneZ: -690, speed: 2.9, offset: 1600, bob: 0.03, length: 24, trail: 18, type: '货运驳船' });

  const speedboat = makeSpeedboat();
  addBoat(speedboat, { laneZ: -452, speed: -8.2, offset: 980, bob: 0.03, length: 9, trail: 15, type: '快艇' });

  return { group, boats, cruise, cruise2 };
}
