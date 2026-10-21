import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import { createTower } from './scene/tower.js?v=25';
import { createEnvironment } from './scene/environment.js?v=25';
import { CITY_DATA } from './data/city-data.js?v=25';
import { createFocus } from './systems/focus.js?v=25';
import { createWeather, WEATHER_PRESETS } from './systems/weather.js?v=25';
import { VIEWS } from './config/views.js?v=25';
import { MODES } from './config/modes.js?v=25';

/* ============================================================
   基础设置
   ============================================================ */

const app = document.getElementById('app');
const labelLayer = document.getElementById('labels');

const scene = new THREE.Scene();
const clock = new THREE.Clock();

// near 从 2 提高到 10：在 far=16000 的场景里，深度精度提升约 5 倍，
// 可显著减少地面、道路、水面等薄贴片的远景 z-fighting（闪烁）。
const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  10,
  16000
);

const MAX_PIXEL_RATIO = 2;
const pixelRatio = () => Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(pixelRatio());
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;
app.appendChild(renderer.domElement);

/* ---------- 控制器 ---------- */

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.55;
controls.zoomSpeed = 0.75;
controls.panSpeed = 0.6;
controls.minDistance = 120;
controls.maxDistance = 5600;
controls.minPolarAngle = 0.12;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.32;
controls.target.set(0, 292, 0);

/* ---------- 后期处理 ---------- */

// renderer 的 antialias 对 EffectComposer 的离屏渲染目标无效。
// 给 composer 的场景目标开启 MSAA，否则塔身钢架、城市窗格在旋转时会持续抖动 / 闪烁。
const sceneSamples = Math.min(
  window.innerWidth < 700 ? 2 : 4,
  renderer.capabilities.maxSamples || 0
);
const sceneTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  samples: sceneSamples,
});
sceneTarget.texture.name = 'CantonTower.scene';

const composer = new EffectComposer(renderer, sceneTarget);
composer.setPixelRatio(pixelRatio());
composer.setSize(window.innerWidth, window.innerHeight);

composer.addPass(new RenderPass(scene, camera));

const bloom = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.72,
  0.62,
  0.68
);
composer.addPass(bloom);
composer.addPass(new OutputPass());

/* ============================================================
   场景构建
   ============================================================ */

const env = createEnvironment(scene, CITY_DATA);
const tower = createTower();
scene.add(tower.group);

/* ---------- 天气 / 点击跟随 ---------- */
const weather = createWeather({ scene, camera, env });
const focus = createFocus({ scene, camera, controls, renderer, env });

/* ============================================================
   结构标注
   ============================================================ */

const LABELS = [
  { cn: '天线桅杆', en: 'ANTENNA MAST', alt: '600 M', y: 592, side: 1 },
  { cn: '摩天轮', en: 'BUBBLE TRAM', alt: '450 M', y: 452, side: -1, hideNarrow: true },
  { cn: '顶部观景台', en: 'SKY DECK', alt: '428 M', y: 428, side: 1 },
  { cn: '观光平台', en: 'OBSERVATION DECK', alt: '339 M', y: 339, side: -1 },
  { cn: '塔身腰线', en: 'WAIST · 280 M', alt: '最细处 15.4 M', y: 282, side: 1 },
];

const labelItems = LABELS.map((item) => {
  const el = document.createElement('div');
  el.className = 'tag';
  el.innerHTML = `
    <span class="tag-line"></span>
    <span class="tag-body">
      <span class="tag-cn">${item.cn}</span>
      <span class="tag-en">${item.en}</span>
      <span class="tag-alt">${item.alt}</span>
    </span>
  `;
  labelLayer.appendChild(el);

  return { el, y: item.y, side: item.side, visible: true, hideNarrow: item.hideNarrow };
});

/* 珠江新城地标标注（“江景”“新城”视角显示） */
const ENV_LABELS = [
  { cn: '广州周大福金融中心', en: 'CTF FINANCE CENTRE · 530 M', x: 166, y: 552, z: -1280, p: 10 },
  { cn: '广州国际金融中心', en: 'IFC · 440 M', x: -128, y: 456, z: -1252, p: 9 },
  { cn: '中信广场', en: 'CITIC PLAZA · 390 M', x: 25, y: 405, z: -3975, p: 8 },
  { cn: '猎德大桥', en: 'LIEDE BRIDGE', x: 950, y: 165, z: -650, p: 7 },
  { cn: '海心沙 · 亚运场馆', en: 'HAIXINSHA ISLAND', x: 70, y: 40, z: -555, p: 6 },
  { cn: '海心桥', en: 'HAIXIN BRIDGE', x: -468, y: 72, z: -240, p: 6 },
  { cn: '广州大桥', en: 'GUANGZHOU BRIDGE', x: -930, y: 38, z: -450, p: 5 },
  { cn: '花城广场', en: 'HUACHENG SQUARE', x: 3, y: 24, z: -1508, p: 5 },
  { cn: '广州大剧院', en: 'OPERA HOUSE', x: -118, y: 58, z: -995, p: 4 },
  { cn: '广东省博物馆', en: 'GUANGDONG MUSEUM', x: 232, y: 44, z: -934, p: 4 },
  { cn: '广州图书馆', en: 'GUANGZHOU LIBRARY', x: 147, y: 47, z: -1093, p: 3 },
  { cn: '天河体育中心', en: 'TIANHE SPORTS CENTRE', x: 0, y: 50, z: -3400, p: 3 },
  { cn: '华南大桥', en: 'HUANAN BRIDGE', x: 2743, y: 165, z: -650, p: 2 },
];

const envLabelItems = ENV_LABELS.map((item) => {
  const el = document.createElement('div');
  el.className = 'env-tag';
  el.innerHTML = `
    <span class="env-name">${item.cn}</span>
    <span class="env-en">${item.en}</span>
    <span class="env-dot"></span>
  `;
  labelLayer.appendChild(el);

  return {
    el,
    pos: new THREE.Vector3(item.x, item.y, item.z),
    priority: item.p,
    w: el.offsetWidth || 110,
    h: el.offsetHeight || 30,
    _on: false,
    _tf: '',
  };
});

let showEnvLabels = false;
let showStructureLabels = true;

const _v = new THREE.Vector3();
const _camDir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();

function projectToScreen(p, out) {
  _v.copy(p).project(camera);
  out.x = (_v.x * 0.5 + 0.5) * window.innerWidth;
  out.y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
  out.behind = _v.z > 1;
  return out;
}

const _s1 = { x: 0, y: 0, behind: false };
const _s2 = { x: 0, y: 0, behind: false };

function updateLabels() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  // 朝向相机一侧的塔身方向
  _camDir.set(camera.position.x, 0, camera.position.z);
  if (_camDir.lengthSq() < 1) _camDir.set(0, 0, -1);
  _camDir.normalize();
  _right.set(-_camDir.z, 0, _camDir.x);

  for (const item of labelItems) {
    if (!item.visible || !showStructureLabels || (w < 640 && item.hideNarrow)) {
      item.el.style.opacity = '0';
      item._off = true;
      continue;
    }

    const rx = tower.profile.rxAt(item.y);
    const rz = tower.profile.rzAt(item.y);

    // 塔轴中心与屏幕右方向上的轮廓点
    _a.set(0, item.y, 0);
    _b.set(_right.x * rx, item.y, _right.z * rz);

    projectToScreen(_a, _s1);
    projectToScreen(_b, _s2);

    if (_s1.behind) {
      item.el.style.opacity = '0';
      item._off = true;
      continue;
    }

    const radiusPx = Math.abs(_s2.x - _s1.x) + 14;
    const margin = Math.min(250, Math.max(96, w * 0.26));
    let side = item.side;
    if (w < 900 && _s1.y < 130) side = -1;
    if (side > 0 && _s1.x + radiusPx > w - margin) side = -1;
    if (side < 0 && _s1.x - radiusPx < margin) side = 1;

    const x = _s1.x + radiusPx * side;
    const y = _s1.y;

    const offscreen = x < -80 || x > w + 80 || y < -60 || y > h + 60;
    if (item._off !== offscreen) {
      item.el.style.opacity = offscreen ? '0' : '1';
      item._off = offscreen;
    }
    if (offscreen) continue;

    const base = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    const next = side < 0
      ? `${base} translate(-100%, -50%)`
      : `${base} translateY(-50%)`;
    if (item._tf !== next) {
      item.el.style.transform = next;
      item._tf = next;
    }
    item.el.classList.toggle('is-flipped', side < 0);
  }

  const candidates = [];
  if (showEnvLabels) {
    for (const item of envLabelItems) {
      projectToScreen(item.pos, _s2);
      const off =
        _s2.behind ||
        _s2.x < -70 ||
        _s2.x > w + 70 ||
        _s2.y < -50 ||
        _s2.y > h + 50;

      if (off) {
        if (item._on) {
          item.el.style.opacity = '0';
          item._on = false;
        }
        continue;
      }
      candidates.push({ item, x: _s2.x, y: _s2.y });
    }
  } else {
    for (const item of envLabelItems) {
      if (item._on) {
        item.el.style.opacity = '0';
        item._on = false;
      }
    }
  }

  // 按重要度依次放置，重叠的次级标注自动隐藏
  candidates.sort((a, b) => b.item.priority - a.item.priority);
  const placed = [];
  for (const cand of candidates) {
    const item = cand.item;
    const hw = item.w * 0.5 + 7;
    // 边缘处平移标注，避免文字被裁切
    const cx = Math.min(Math.max(cand.x, hw + 4), w - hw - 4);
    const cy = Math.max(cand.y, item.h + 12);
    const top = cy - item.h - 9;
    const rect = {
      x1: cx - hw,
      x2: cx + hw,
      y1: top,
      y2: cy + 4,
    };
    const overlap = placed.some(
      (r) =>
        rect.x2 > r.x1 &&
        rect.x1 < r.x2 &&
        rect.y2 > r.y1 &&
        rect.y1 < r.y2
    );
    if (overlap) {
      if (item._on) {
        item.el.style.opacity = '0';
        item._on = false;
      }
      continue;
    }
    placed.push(rect);

    const tf = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(
      1
    )}px, 0) translate(-50%, -100%)`;
    if (item._tf !== tf) {
      item.el.style.transform = tf;
      item._tf = tf;
    }
    if (!item._on) {
      item.el.style.opacity = '1';
      item._on = true;
    }
  }
}

/* ============================================================
   高度标尺
   ============================================================ */

const rulerTicks = document.getElementById('rulerTicks');
const rulerMarks = [];
for (let m = 600; m >= 0; m -= 50) {
  const el = document.createElement('div');
  const major = m % 100 === 0;
  el.className = `ruler-tick${major ? ' is-major' : ''}`;
  el.style.top = `${((600 - m) / 600) * 100}%`;
  el.innerHTML = major ? `<em>${m}</em>` : '';
  rulerTicks.appendChild(el);
  rulerMarks.push({ el, m });
}

/* ============================================================
   镜头预设
   ============================================================ */


let camTween = null;

function flyTo(viewKey, duration = 1900) {
  const view = VIEWS[viewKey];
  if (!view) return;
  const v =
    window.innerWidth < 700 && view.mobile ? view.mobile : view;

  camTween = {
    t: 0,
    duration,
    fromPos: camera.position.clone(),
    toPos: v.pos.clone(),
    fromTarget: controls.target.clone(),
    toTarget: v.target.clone(),
    fromFov: camera.fov,
    toFov: v.fov,
  };
}

const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/* ============================================================
   外观模式
   ============================================================ */


let currentMode = 'night';
const colorTween = {
  active: false,
  t: 0,
  duration: 1100,
  from: null,
  to: null,
};

function snapshotMode() {
  return {
    exposure: renderer.toneMappingExposure,
    bloomStrength: bloom.strength,
    bloomRadius: bloom.radius,
    bloomThreshold: bloom.threshold,
    skyTop: env.skyMat.uniforms.uTop.value.clone(),
    skyMid: env.skyMat.uniforms.uMid.value.clone(),
    skyBottom: env.skyMat.uniforms.uBottom.value.clone(),
    skyGlow: env.skyMat.uniforms.uGlow.value.clone(),
    fogColor: scene.fog.color.clone(),
    fogDensity: scene.fog.density,
    ambientSky: env.lights.ambient.color.clone(),
    ambientGround: env.lights.ambient.groundColor.clone(),
    ambientIntensity: env.lights.ambient.intensity,
    keyColor: env.lights.key.color.clone(),
    keyIntensity: env.lights.key.intensity,
    keyPos: env.lights.key.position.clone(),
    sunDir: env.skyMat.uniforms.uSunDir.value.clone(),
    rimColor: env.lights.rim.color.clone(),
    rimIntensity: env.lights.rim.intensity,
    steelEmissive: tower.materials.steel.emissive.clone(),
    steelIntensity: tower.materials.steel.emissiveIntensity,
    ringEmissive: tower.materials.ring.emissive.clone(),
    ringIntensity: tower.materials.ring.emissiveIntensity,
    glassColor: tower.materials.glass.uniforms.uColor.value.clone(),
    glassAccent: tower.materials.glass.uniforms.uAccent.value.clone(),
    glassOpacity: tower.materials.glass.uniforms.uOpacity.value,
    waterDeep: env.water.mat.uniforms.uDeep.value.clone(),
    waterShallow: env.water.mat.uniforms.uShallow.value.clone(),
    waterGlow: env.water.mat.uniforms.uGlow.value.clone(),
    stars: env.stars.mat.uniforms.uOpacity.value,
    capsule: tower.materials.capsule.emissiveIntensity,
    // 线材当前透明度带有相机距离衰减，基准值单独保存，避免切换外观时越切越淡
    line: tower.materials.line.userData.baseOpacity ?? tower.materials.line.opacity,
    cityColor: env.cityMats[0].color.clone(),
    cityEmissive: env.cityMats[0].emissiveIntensity,
    steelColor: tower.materials.steel.color.clone(),
    ringColor: tower.materials.ring.color.clone(),
    steelMetal: tower.materials.steel.metalness,
    steelRough: tower.materials.steel.roughness,
    coreColor: tower.materials.core.uniforms.uColor.value.clone(),
    coreGlow: tower.materials.core.uniforms.uGlow.value.clone(),
    deckColor: tower.materials.deck.color.clone(),
    deckEmissive: tower.materials.deck.emissive.clone(),
    deckIntensity: tower.materials.deck.emissiveIntensity,
    deckEdge: tower.materials.deckEdge.opacity,
    sun: env.skyMat.uniforms.uSunColor.value.clone(),
    sunIntensity: env.skyMat.uniforms.uSunIntensity.value,
    plazaColor: env.ground.plazaMat.uniforms.uColor.value.clone(),
    plazaLine: env.ground.plazaMat.uniforms.uLine.value.clone(),
    landEmissive: env.ground.landMat.emissive.clone(),
    landIntensity: env.ground.landMat.emissiveIntensity,
    cityLights: env.cityLights.material.opacity,
    bridgeLights: env.bridgeLightMat.opacity,
  };
}

function modeSnapshot(mode) {
  const m = MODES[mode];
  return {
    exposure: m.exposure,
    bloomStrength: m.bloom.strength,
    bloomRadius: m.bloom.radius,
    bloomThreshold: m.bloom.threshold,
    skyTop: new THREE.Color(m.sky.top),
    skyMid: new THREE.Color(m.sky.mid),
    skyBottom: new THREE.Color(m.sky.bottom),
    skyGlow: new THREE.Color(m.sky.glow),
    fogColor: new THREE.Color(m.fog.color),
    fogDensity: m.fog.density,
    ambientSky: new THREE.Color(m.ambient.sky),
    ambientGround: new THREE.Color(m.ambient.ground),
    ambientIntensity: m.ambient.intensity,
    keyColor: new THREE.Color(m.key.color),
    keyIntensity: m.key.intensity,
    keyPos: new THREE.Vector3(...m.keyPos),
    sunDir: new THREE.Vector3(...m.sunDir),
    rimColor: new THREE.Color(m.rim.color),
    rimIntensity: m.rim.intensity,
    steelEmissive: new THREE.Color(m.steel.emissive),
    steelIntensity: m.steel.intensity,
    ringEmissive: new THREE.Color(m.ring.emissive),
    ringIntensity: m.ring.intensity,
    glassColor: new THREE.Color(m.glass.color),
    glassAccent: new THREE.Color(m.glass.accent),
    glassOpacity: m.glass.opacity,
    waterDeep: new THREE.Color(m.water.deep),
    waterShallow: new THREE.Color(m.water.shallow),
    waterGlow: new THREE.Color(m.water.glow),
    stars: m.stars,
    capsule: m.capsule,
    line: m.line,
    cityColor: new THREE.Color(m.cityColor),
    cityEmissive: m.cityEmissive,
    steelColor: new THREE.Color(m.steelColor),
    ringColor: new THREE.Color(m.ringColor),
    steelMetal: m.steelMetal,
    steelRough: m.steelRough,
    coreColor: new THREE.Color(m.coreColor),
    coreGlow: new THREE.Color(m.coreGlow),
    deckColor: new THREE.Color(m.deckColor),
    deckEmissive: new THREE.Color(m.deckEmissive),
    deckIntensity: m.deckIntensity,
    deckEdge: m.deckEdge,
    sun: new THREE.Color(m.sun),
    sunIntensity: m.sunIntensity,
    plazaColor: new THREE.Color(m.plazaColor),
    plazaLine: new THREE.Color(m.plazaLine),
    landEmissive: new THREE.Color(m.landEmissive),
    landIntensity: m.landIntensity,
    cityLights: m.cityLights,
    bridgeLights: m.bridgeLights,
  };
}

function applySnapshot(s) {
  renderer.toneMappingExposure = s.exposure;
  bloom.strength = s.bloomStrength;
  bloom.radius = s.bloomRadius;
  bloom.threshold = s.bloomThreshold;

  env.skyMat.uniforms.uTop.value.copy(s.skyTop);
  env.skyMat.uniforms.uMid.value.copy(s.skyMid);
  env.skyMat.uniforms.uBottom.value.copy(s.skyBottom);
  env.skyMat.uniforms.uGlow.value.copy(s.skyGlow);

  scene.fog.color.copy(s.fogColor);
  scene.fog.density = s.fogDensity;

  env.lights.ambient.color.copy(s.ambientSky);
  env.lights.ambient.groundColor.copy(s.ambientGround);
  env.lights.ambient.intensity = s.ambientIntensity;
  env.lights.key.color.copy(s.keyColor);
  env.lights.key.intensity = s.keyIntensity;
  env.lights.key.position.copy(s.keyPos);
  env.skyMat.uniforms.uSunDir.value.copy(s.sunDir).normalize();
  env.lights.rim.color.copy(s.rimColor);
  env.lights.rim.intensity = s.rimIntensity;

  tower.materials.steel.emissive.copy(s.steelEmissive);
  tower.materials.steel.emissiveIntensity = s.steelIntensity;
  tower.materials.steel.color.copy(s.steelColor);
  tower.materials.steel.metalness = s.steelMetal;
  tower.materials.steel.roughness = s.steelRough;
  tower.materials.ring.emissive.copy(s.ringEmissive);
  tower.materials.ring.emissiveIntensity = s.ringIntensity;
  tower.materials.ring.color.copy(s.ringColor);
  tower.materials.ring.metalness = s.steelMetal;
  tower.materials.ring.roughness = s.steelRough;

  tower.materials.core.uniforms.uColor.value.copy(s.coreColor);
  tower.materials.core.uniforms.uGlow.value.copy(s.coreGlow);
  tower.materials.deck.color.copy(s.deckColor);
  tower.materials.deck.emissive.copy(s.deckEmissive);
  tower.materials.deck.emissiveIntensity = s.deckIntensity;
  tower.materials.deckEdge.opacity = s.deckEdge;

  env.skyMat.uniforms.uSunColor.value.copy(s.sun);
  env.skyMat.uniforms.uSunIntensity.value = s.sunIntensity;

  env.ground.plazaMat.uniforms.uColor.value.copy(s.plazaColor);
  env.ground.plazaMat.uniforms.uLine.value.copy(s.plazaLine);
  env.ground.landMat.emissive.copy(s.landEmissive);
  env.ground.landMat.emissiveIntensity = s.landIntensity;
  env.cityLights.material.opacity = s.cityLights;
  env.bridgeLightMat.opacity = s.bridgeLights;

  tower.materials.glass.uniforms.uColor.value.copy(s.glassColor);
  tower.materials.glass.uniforms.uAccent.value.copy(s.glassAccent);
  tower.materials.glass.uniforms.uOpacity.value = s.glassOpacity;

  env.water.mat.uniforms.uDeep.value.copy(s.waterDeep);
  env.water.mat.uniforms.uShallow.value.copy(s.waterShallow);
  env.water.mat.uniforms.uGlow.value.copy(s.waterGlow);

  env.stars.mat.uniforms.uOpacity.value = s.stars;
  tower.materials.capsule.emissiveIntensity = s.capsule;
  tower.materials.line.userData.baseOpacity = s.line;
  tower.materials.line.opacity = s.line;

  // 城市楼体亮度
  for (const mat of env.cityMats) {
    mat.color.copy(s.cityColor);
    mat.emissiveIntensity = s.cityEmissive;
  }

  env.water.mat.uniforms.uFog.value.copy(s.fogColor);
}

function setMode(mode) {
  if (mode === currentMode) return;
  currentMode = mode;

  colorTween.from = snapshotMode();
  colorTween.to = weather.applyToSnapshot(modeSnapshot(mode));
  colorTween.t = 0;
  colorTween.active = true;

  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.mode === mode);
  });
  document.body.classList.toggle('is-day', mode === 'day');
}

/* 切换天气：在当前外观模式的基础上叠加雨雾，并平滑过渡 */
function setWeather(key) {
  if (!WEATHER_PRESETS[key] || weather.preset === key) return;
  weather.setPreset(key);

  colorTween.from = snapshotMode();
  colorTween.to = weather.applyToSnapshot(modeSnapshot(currentMode));
  colorTween.t = 0;
  colorTween.active = true;

  document.querySelectorAll('.weather-btn').forEach((b) => {
    b.classList.toggle('is-active', b.dataset.weather === key);
  });
}

function lerpColor(target, a, b, t) {
  target.setRGB(
    a.r + (b.r - a.r) * t,
    a.g + (b.g - a.g) * t,
    a.b + (b.b - a.b) * t
  );
}

/* ============================================================
    HUD 入场动画结束后清除，避免长期占用合成层
   ============================================================ */

document.querySelectorAll('.hud *').forEach((el) => {
  el.addEventListener('animationend', (e) => {
    if (e.animationName === 'fadeUp' || e.animationName === 'fadeIn') {
      e.currentTarget.style.animation = 'none';
    }
  });
});

/* ============================================================
   交互
   ============================================================ */

document.querySelectorAll('.mode-btn').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode));
});

document.querySelectorAll('.weather-btn').forEach((btn) => {
  btn.addEventListener('click', () => setWeather(btn.dataset.weather));
});

const envTip = document.getElementById('envTip');

document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.view-btn').forEach((b) =>
      b.classList.remove('is-active')
    );
    btn.classList.add('is-active');
    focus.clear();
    showEnvLabels = btn.dataset.view === 'orbit' || btn.dataset.view === 'city';
    showStructureLabels =
      btn.dataset.view !== 'city' && btn.dataset.view !== 'orbit';
    flyTo(btn.dataset.view);
    if (envTip) envTip.classList.add('is-hidden');
  });
});

if (envTip) {
  setTimeout(() => envTip.classList.add('is-hidden'), 14000);
}

let showLabels = true;
let shellVisible = true;

document.querySelectorAll('.toggle').forEach((btn) => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.toggle;
    const on = !btn.classList.contains('is-on');
    btn.classList.toggle('is-on', on);

    if (key === 'rotate') {
      controls.autoRotate = on;
    } else if (key === 'shell') {
      shellVisible = on;
      tower.shell.visible = on;
    } else if (key === 'labels') {
      showLabels = on;
      labelLayer.style.opacity = on ? '1' : '0';
      labelItems.forEach((i) => (i.visible = on));
    } else if (key === 'life') {
      env.life.group.visible = on;
      if (!on) focus.clear();
    }
  });
});

// 用户手动操作时终止镜头过渡，交出控制权
controls.addEventListener('start', () => {
  camTween = null;
  focus.cancelFly();
});

/* ============================================================
   数据计数动画
   ============================================================ */

function animateCounters() {
  const nodes = document.querySelectorAll('[data-count]');
  const start = performance.now();
  const duration = 1800;

  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    nodes.forEach((n) => {
      const target = Number(n.dataset.count);
      n.textContent = Math.round(target * e);
    });
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/* ============================================================
   加载进度
   ============================================================ */

const loader = document.getElementById('loader');
const loaderPct = document.getElementById('loaderPct');
const loaderBar = document.getElementById('loaderBar');
const ringFg = document.getElementById('ringFg');
const loaderSub = document.getElementById('loaderSub');

const CIRC = 2 * Math.PI * 54;
ringFg.style.strokeDasharray = `${CIRC}`;

const SUBTITLES = [
  '正在读取珠江新城地理数据',
  '构建 3,489 座建筑体量',
  '梳理珠江与桥梁岸线',
  '点亮广州塔与城市灯火',
  '准备就绪',
];

let loadProgress = 0;
let loadTarget = 0;
let loadStart = performance.now();

function setLoadTarget(v) {
  loadTarget = v;
}

function tickLoader(now) {
  const elapsed = now - loadStart;
  // 自动推进到目标值
  const auto = Math.min(loadTarget, (elapsed / 2400) * 100);
  loadProgress += (auto - loadProgress) * 0.12;
  if (loadTarget >= 100 && loadProgress > 99.2) loadProgress = 100;

  const p = Math.min(100, loadProgress);
  loaderPct.textContent = Math.round(p);
  loaderBar.style.width = `${p}%`;
  ringFg.style.strokeDashoffset = `${CIRC * (1 - p / 100)}`;

  const idx = Math.min(SUBTITLES.length - 1, Math.floor((p / 100) * SUBTITLES.length));
  if (loaderSub.textContent !== SUBTITLES[idx]) {
    loaderSub.style.opacity = '0';
    setTimeout(() => {
      loaderSub.textContent = SUBTITLES[idx];
      loaderSub.style.opacity = '1';
    }, 180);
  }

  if (p >= 100) {
    loader.classList.add('is-done');
    animateCounters();
    flyTo('hero', 2600);
    return;
  }
  requestAnimationFrame(tickLoader);
}

/* ============================================================
   启动
   ============================================================ */

// 初始机位（远景，自南岸望向珠江新城）
camera.position.set(1480, 960, 2560);
camera.lookAt(0, 280, -900);
controls.target.set(0, 280, -900);

setLoadTarget(100);
requestAnimationFrame(tickLoader);

/* ============================================================
   自适应
   ============================================================ */

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();

  const pr = pixelRatio();
  renderer.setPixelRatio(pr);
  renderer.setSize(w, h);

  // setSize 会同步把物理像素尺寸传给 bloom 等各个 pass，无需再手动设置 resolution。
  composer.setPixelRatio(pr);
  composer.setSize(w, h);

  env.stars.mat.uniforms.uPixelRatio.value = pr;
}

window.addEventListener('resize', onResize);

/* ============================================================
   主循环
   ============================================================ */

let time = 0;

function animate() {
  requestAnimationFrame(animate);

  const dt = Math.min(clock.getDelta(), 0.05);
  time += dt;

  // 镜头过渡
  if (camTween) {
    camTween.t += dt * 1000;
    const t = Math.min(1, camTween.t / camTween.duration);
    const e = easeInOutCubic(t);

    camera.position.lerpVectors(camTween.fromPos, camTween.toPos, e);
    controls.target.lerpVectors(camTween.fromTarget, camTween.toTarget, e);
    camera.fov = camTween.fromFov + (camTween.toFov - camTween.fromFov) * e;
    camera.updateProjectionMatrix();

    if (t >= 1) camTween = null;
  }

  // 外观模式过渡
  if (colorTween.active) {
    colorTween.t += dt * 1000;
    const t = Math.min(1, colorTween.t / colorTween.duration);
    const e = easeInOutCubic(t);
    const a = colorTween.from;
    const b = colorTween.to;

    renderer.toneMappingExposure = a.exposure + (b.exposure - a.exposure) * e;
    bloom.strength = a.bloomStrength + (b.bloomStrength - a.bloomStrength) * e;
    bloom.radius = a.bloomRadius + (b.bloomRadius - a.bloomRadius) * e;
    bloom.threshold = a.bloomThreshold + (b.bloomThreshold - a.bloomThreshold) * e;

    lerpColor(env.skyMat.uniforms.uTop.value, a.skyTop, b.skyTop, e);
    lerpColor(env.skyMat.uniforms.uMid.value, a.skyMid, b.skyMid, e);
    lerpColor(env.skyMat.uniforms.uBottom.value, a.skyBottom, b.skyBottom, e);
    lerpColor(env.skyMat.uniforms.uGlow.value, a.skyGlow, b.skyGlow, e);

    lerpColor(scene.fog.color, a.fogColor, b.fogColor, e);
    scene.fog.density = a.fogDensity + (b.fogDensity - a.fogDensity) * e;

    lerpColor(env.lights.ambient.color, a.ambientSky, b.ambientSky, e);
    lerpColor(env.lights.ambient.groundColor, a.ambientGround, b.ambientGround, e);
    env.lights.ambient.intensity =
      a.ambientIntensity + (b.ambientIntensity - a.ambientIntensity) * e;

    lerpColor(env.lights.key.color, a.keyColor, b.keyColor, e);
    env.lights.key.intensity =
      a.keyIntensity + (b.keyIntensity - a.keyIntensity) * e;
    env.lights.key.position.lerpVectors(a.keyPos, b.keyPos, e);
    env.skyMat.uniforms.uSunDir.value
      .lerpVectors(a.sunDir, b.sunDir, e)
      .normalize();

    lerpColor(env.lights.rim.color, a.rimColor, b.rimColor, e);
    env.lights.rim.intensity =
      a.rimIntensity + (b.rimIntensity - a.rimIntensity) * e;

    lerpColor(tower.materials.steel.emissive, a.steelEmissive, b.steelEmissive, e);
    tower.materials.steel.emissiveIntensity =
      a.steelIntensity + (b.steelIntensity - a.steelIntensity) * e;

    lerpColor(tower.materials.steel.color, a.steelColor, b.steelColor, e);
    tower.materials.steel.metalness =
      a.steelMetal + (b.steelMetal - a.steelMetal) * e;
    tower.materials.steel.roughness =
      a.steelRough + (b.steelRough - a.steelRough) * e;
    lerpColor(tower.materials.ring.emissive, a.ringEmissive, b.ringEmissive, e);
    tower.materials.ring.emissiveIntensity =
      a.ringIntensity + (b.ringIntensity - a.ringIntensity) * e;
    lerpColor(tower.materials.ring.color, a.ringColor, b.ringColor, e);
    tower.materials.ring.metalness =
      a.steelMetal + (b.steelMetal - a.steelMetal) * e;
    tower.materials.ring.roughness =
      a.steelRough + (b.steelRough - a.steelRough) * e;

    lerpColor(tower.materials.core.uniforms.uColor.value, a.coreColor, b.coreColor, e);
    lerpColor(tower.materials.core.uniforms.uGlow.value, a.coreGlow, b.coreGlow, e);
    lerpColor(tower.materials.deck.color, a.deckColor, b.deckColor, e);
    lerpColor(tower.materials.deck.emissive, a.deckEmissive, b.deckEmissive, e);
    tower.materials.deck.emissiveIntensity =
      a.deckIntensity + (b.deckIntensity - a.deckIntensity) * e;
    tower.materials.deckEdge.opacity =
      a.deckEdge + (b.deckEdge - a.deckEdge) * e;

    lerpColor(env.skyMat.uniforms.uSunColor.value, a.sun, b.sun, e);
    env.skyMat.uniforms.uSunIntensity.value =
      a.sunIntensity + (b.sunIntensity - a.sunIntensity) * e;

    lerpColor(env.ground.plazaMat.uniforms.uColor.value, a.plazaColor, b.plazaColor, e);
    lerpColor(env.ground.plazaMat.uniforms.uLine.value, a.plazaLine, b.plazaLine, e);
    lerpColor(env.ground.landMat.emissive, a.landEmissive, b.landEmissive, e);
    env.ground.landMat.emissiveIntensity =
      a.landIntensity + (b.landIntensity - a.landIntensity) * e;
    env.cityLights.material.opacity =
      a.cityLights + (b.cityLights - a.cityLights) * e;
    env.bridgeLightMat.opacity =
      a.bridgeLights + (b.bridgeLights - a.bridgeLights) * e;

    lerpColor(tower.materials.glass.uniforms.uColor.value, a.glassColor, b.glassColor, e);
    lerpColor(tower.materials.glass.uniforms.uAccent.value, a.glassAccent, b.glassAccent, e);
    tower.materials.glass.uniforms.uOpacity.value =
      a.glassOpacity + (b.glassOpacity - a.glassOpacity) * e;

    lerpColor(env.water.mat.uniforms.uDeep.value, a.waterDeep, b.waterDeep, e);
    lerpColor(env.water.mat.uniforms.uShallow.value, a.waterShallow, b.waterShallow, e);
    lerpColor(env.water.mat.uniforms.uGlow.value, a.waterGlow, b.waterGlow, e);

    env.stars.mat.uniforms.uOpacity.value = a.stars + (b.stars - a.stars) * e;
    tower.materials.capsule.emissiveIntensity =
      a.capsule + (b.capsule - a.capsule) * e;
    tower.materials.line.userData.baseOpacity = a.line + (b.line - a.line) * e;
    tower.materials.line.opacity = tower.materials.line.userData.baseOpacity;

    for (const mat of env.cityMats) {
      lerpColor(mat.color, a.cityColor, b.cityColor, e);
      mat.emissiveIntensity =
        a.cityEmissive + (b.cityEmissive - a.cityEmissive) * e;
    }

    if (t >= 1) {
      colorTween.active = false;
      applySnapshot(b);
    }
  }

  controls.update();

  // 相机不要钻到水面以下（跟随时允许贴近行人和车辆）
  const minY = focus.following ? 2.2 : 12;
  if (camera.position.y < minY) camera.position.y = minY;

  tower.update(time, dt, camera);
  env.update(time, dt);
  focus.update(time, dt);
  weather.update(time, dt);

  composer.render();
  updateLabels();
}

/* ---------- 应用夜景外观，与模式定义保持一致 ---------- */

applySnapshot(weather.applyToSnapshot(modeSnapshot('night')));

animate();

/* ---------- 开发调试接口 ---------- */
window.__CANTON__ = {
  THREE,
  scene,
  camera,
  controls,
  renderer,
  composer,
  env,
  tower,
  focus,
  weather,
  setWeather,
  flyTo,
  setMode,
  applyWeatherNow: () => applySnapshot(weather.applyToSnapshot(modeSnapshot(currentMode))),
  get currentMode() {
    return currentMode;
  },
  get time() {
    return time;
  },
};
