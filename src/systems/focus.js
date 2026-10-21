import * as THREE from 'three';

/* ============================================================
   点击跟随
   ------------------------------------------------------------
   · 点击汽车 / 行人 / 船只：镜头飞到目标附近并持续跟随
   · 跟随时仍可用鼠标环绕观察，目标移动会带着镜头一起走
   · 点击空白处、按 ESC 或点 HUD 上的「退出」结束跟随
   ============================================================ */

const CAR_DISTANCE = 19;
const PED_DISTANCE = 11;
const BOAT_DISTANCE = 52;

export function createFocus({ scene, camera, controls, renderer, env }) {
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const matrix = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  const current = new THREE.Vector3();
  const last = new THREE.Vector3();

  const cars = env.life.cars;
  const peds = env.life.peds;
  const boats = env.boats;

  /* ---------- 目标指示环 ---------- */
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7fe9ff,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(2.35, 3.05, 48), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  ring.renderOrder = 4;
  scene.add(ring);

  const chip = document.getElementById('focusChip');
  const chipName = document.getElementById('focusName');
  const chipExit = document.getElementById('focusExit');

  let active = null;
  let fly = null;
  let lastValid = false;
  let ringBase = 1;
  let savedAutoRotate = controls.autoRotate;
  let savedMinDistance = controls.minDistance;

  function setActiveClass(on) {
    if (chip) chip.classList.toggle('is-on', on);
    document.body.classList.toggle('is-following', on);
  }

  function setRingColor(hex) {
    ringMat.color.setHex(hex);
  }

  /* ---------- 目标姿态 ---------- */

  function applyTargetPose(target, out) {
    if (target.kind === 'car') {
      target.mesh.getMatrixAt(target.index, matrix);
      matrix.decompose(out, quat, scale);
      return scale.x;
    }
    if (target.kind === 'ped') {
      peds.bodyMesh.getMatrixAt(target.index, matrix);
      matrix.decompose(out, quat, scale);
      return scale.x;
    }
    out.copy(target.boat.obj.position);
    return 1;
  }

  function getRingY(target, y) {
    if (target.kind === 'boat') return 1.1;
    return y + 0.04;
  }

  function showChip(target) {
    if (!chip) return;
    if (chipName) chipName.textContent = target.label;
    setActiveClass(true);
  }

  function focusOn(target) {
    if (!active) {
      savedAutoRotate = controls.autoRotate;
      savedMinDistance = controls.minDistance;
    }
    active = target;

    // 跟随需要贴近目标，同时关闭自动旋转，避免镜头绕着目标打转
    controls.autoRotate = false;
    controls.minDistance = 3;

    applyTargetPose(target, current);
    last.copy(current);
    lastValid = true;
    ringBase = target.kind === 'car' ? 1 : target.kind === 'ped' ? 0.42 : 2.1;

    setRingColor(
      target.kind === 'car' ? 0x7fe9ff : target.kind === 'ped' ? 0xffc27a : 0x9fe8ff
    );
    showChip(target);

    const distance =
      target.kind === 'car'
        ? CAR_DISTANCE
        : target.kind === 'ped'
        ? PED_DISTANCE
        : BOAT_DISTANCE;

    // 保持当前观察方向，从目标附近重新进入
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target);
    dir.y = 0;
    if (dir.lengthSq() < 1) dir.set(0.6, 0, 0.8);
    dir.normalize();

    const lift = target.kind === 'car' ? 9 : target.kind === 'ped' ? 4.5 : 17;
    const toPos = current.clone().addScaledVector(dir, distance);
    toPos.y = current.y + lift;

    const toTarget = current.clone();
    toTarget.y += target.kind === 'ped' ? 1.3 : 1.0;

    fly = {
      t: 0,
      duration: 820,
      fromPos: camera.position.clone(),
      toPos,
      fromTarget: controls.target.clone(),
      toTarget,
    };
  }

  function cancelFly() {
    fly = null;
  }

  function clear() {
    if (!active) return;
    active = null;
    fly = null;
    lastValid = false;
    ring.visible = false;
    controls.autoRotate = savedAutoRotate;
    controls.minDistance = savedMinDistance;
    setActiveClass(false);
  }

  /* ---------- 点击拾取 ---------- */

  const CAR_LABEL = '汽车';
  const PED_LABEL = '行人';

  function resolveHit(hit) {
    const obj = hit.object;

    if (obj === cars.mesh) {
      return { kind: 'car', index: hit.instanceId, mesh: cars.mesh, label: CAR_LABEL };
    }
    if (obj === peds.bodyMesh || obj === peds.headMesh) {
      return { kind: 'ped', index: hit.instanceId, label: PED_LABEL };
    }

    // 船只是一组普通网格，需要沿父级找到 boat 记录
    let o = obj;
    while (o && o.parent !== boats.group) o = o.parent;
    if (o) {
      const boat = boats.boats.find((b) => b.obj === o);
      if (boat) return { kind: 'boat', boat, label: boat.type || '游船' };
    }
    return null;
  }

  function pick(clientX, clientY) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const hits = raycaster.intersectObjects(
      [cars.mesh, peds.bodyMesh, peds.headMesh, boats.group],
      true
    );

    for (const hit of hits) {
      const target = resolveHit(hit);
      if (target) return target;
    }
    return null;
  }

  /* ---------- 指针 / 键盘 ---------- */

  let down = null;

  function onPointerDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
  }

  function onPointerUp(e) {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const elapsed = performance.now() - down.t;
    down = null;
    if (moved > 7 || elapsed > 800) return;

    const target = pick(e.clientX, e.clientY);
    if (target) focusOn(target);
    else clear();
  }

  function onKey(e) {
    if (e.key === 'Escape') clear();
  }

  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  window.addEventListener('keydown', onKey);
  if (chipExit) chipExit.addEventListener('click', clear);

  /* ---------- 每帧跟随 ---------- */

  function update(time, dt) {
    if (!active) {
      ring.visible = false;
      return;
    }

    const s = applyTargetPose(active, current);

    // 汽车在道路两端会缩放消失后瞬移，船只跨越江面也会瞬移：
    // 这些时刻直接结束跟随，避免镜头被甩出去。
    if (active.kind === 'car' && s < 0.16) {
      clear();
      return;
    }

    ring.visible = true;
    ring.position.set(current.x, getRingY(active, current.y), current.z);
    const pulse = 1 + Math.sin(time * 4.2) * 0.07;
    ring.scale.setScalar(pulse * ringBase);

    if (fly) {
      fly.t += dt * 1000;
      const t = Math.min(1, fly.t / fly.duration);
      const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      camera.position.lerpVectors(fly.fromPos, fly.toPos, e);
      controls.target.lerpVectors(fly.fromTarget, fly.toTarget, e);
      if (t >= 1) {
        fly = null;
        last.copy(current);
        lastValid = true;
      }
      return;
    }

    if (!lastValid) {
      last.copy(current);
      lastValid = true;
      return;
    }

    const dx = current.x - last.x;
    const dz = current.z - last.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 160) {
      // 瞬移 / 跨江折返
      clear();
      return;
    }

    if (dist > 0.0001) {
      camera.position.x += dx;
      camera.position.z += dz;
      controls.target.x += dx;
      controls.target.z += dz;
    }
    last.copy(current);
  }

  return {
    update,
    clear,
    cancelFly,
    get target() {
      return active;
    },
    get following() {
      return !!active;
    },
  };
}
