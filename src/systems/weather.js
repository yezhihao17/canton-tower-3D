import * as THREE from 'three';

/* ============================================================
   天气系统
   ------------------------------------------------------------
   · 晴朗 / 细雨 / 暴雨 / 浓雾 四种可切换天气
   · 雨丝、闪电为独立粒子 / 灯光，雾与天空通过 snapshot 叠加，
     因此任意天气都能和夜景 / 白昼 / 霓虹外观组合
   ============================================================ */

export const WEATHER_PRESETS = {
  clear: {
    label: '晴朗',
    rain: 0,
    mist: 0,
    fog: 1,
    dim: 1,
    exposure: 1,
    bloom: 1,
    tint: 0x7f8f96,
    stars: 1,
  },
  drizzle: {
    label: '细雨',
    rain: 0.45,
    mist: 0.32,
    fog: 2.3,
    dim: 0.84,
    exposure: 0.94,
    bloom: 0.9,
    tint: 0x687a83,
    stars: 0.25,
  },
  storm: {
    label: '暴雨',
    rain: 1,
    mist: 0.72,
    fog: 5.4,
    dim: 0.6,
    exposure: 0.82,
    bloom: 0.85,
    tint: 0x435159,
    stars: 0,
  },
  fog: {
    label: '浓雾',
    rain: 0,
    mist: 1,
    fog: 9.5,
    dim: 0.92,
    exposure: 0.97,
    bloom: 0.55,
    tint: 0x8b989e,
    stars: 0,
  },
};

const _tint = new THREE.Color();
const _fog = new THREE.Color();

/* 把天气叠加到某个外观模式的 snapshot 上（原地修改） */
export function applyWeatherToSnapshot(snapshot, key) {
  const p = WEATHER_PRESETS[key];
  if (!p || key === 'clear') return snapshot;

  _fog.copy(snapshot.fogColor);
  _tint.setHex(p.tint);
  _fog.lerp(_tint, 0.45 * p.mist);
  snapshot.fogColor.copy(_fog);

  // 雾越浓，天空越接近地面雾色
  snapshot.skyTop.lerp(_fog, 0.72 * p.mist);
  snapshot.skyMid.lerp(_fog, 0.78 * p.mist);
  snapshot.skyBottom.lerp(_fog, 0.86 * p.mist);
  const skyDim = 0.68 + 0.32 * p.dim;
  snapshot.skyTop.multiplyScalar(skyDim);
  snapshot.skyMid.multiplyScalar(skyDim);
  snapshot.skyBottom.multiplyScalar(skyDim);

  snapshot.fogDensity *= p.fog;
  snapshot.exposure *= p.exposure;
  snapshot.bloomStrength *= p.bloom;

  snapshot.ambientIntensity *= 0.72 + 0.28 * p.dim;
  snapshot.keyIntensity *= p.dim;
  snapshot.rimIntensity *= p.dim;

  snapshot.waterDeep.lerp(_fog, 0.24 * p.mist);
  snapshot.waterShallow.lerp(_fog, 0.2 * p.mist);
  snapshot.landEmissive.lerp(_fog, 0.15 * p.mist);

  snapshot.stars *= p.stars;
  snapshot.cityLights *= 0.75 + 0.25 * p.dim;

  return snapshot;
}

function makeRain(count) {
  const positions = new Float32Array(count * 2 * 3);
  const drops = [];
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  for (let i = 0; i < count; i++) {
    drops.push({
      ox: (Math.random() * 2 - 1) * 135,
      oz: (Math.random() * 2 - 1) * 135,
      y: Math.random() * 170,
      speed: 58 + Math.random() * 38,
      len: 1.4 + Math.random() * 2.6,
    });
  }

  const mat = new THREE.LineBasicMaterial({
    color: 0xa8c9dd,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.visible = false;
  lines.renderOrder = 6;

  return { lines, geo, mat, positions, drops };
}

export function createWeather({ scene, camera, env }) {
  let presetKey = 'clear';
  let rainLevel = 0;
  let flash = 0;
  let nextFlash = 5;

  const rain = makeRain(2300);
  scene.add(rain.lines);

  // 闪电用一盏独立方向光，不参与外观 snapshot
  const flashLight = new THREE.DirectionalLight(0xdceeff, 0);
  flashLight.position.set(240, 620, 280);
  scene.add(flashLight);

  function setPreset(key) {
    if (!WEATHER_PRESETS[key] || key === presetKey) return;
    presetKey = key;
    if (key === 'storm') nextFlash = 2.5;
  }

  function update(time, dt) {
    const p = WEATHER_PRESETS[presetKey];

    // 雨量渐变
    rainLevel += (p.rain - rainLevel) * Math.min(1, dt * 1.4);
    const on = rainLevel > 0.012;
    rain.lines.visible = on;
    if (on) {
      rain.mat.opacity = 0.42 * rainLevel;
      const camX = camera.position.x;
      const camZ = camera.position.z;
      const pos = rain.positions;
      const drops = rain.drops;
      const count = drops.length;

      for (let i = 0; i < count; i++) {
        const d = drops[i];
        d.y -= d.speed * dt;
        if (d.y < 0) d.y += 170;

        const x = camX + d.ox;
        const z = camZ + d.oz;
        const i6 = i * 6;
        pos[i6] = x;
        pos[i6 + 1] = d.y;
        pos[i6 + 2] = z;
        // 带一点风的斜度
        pos[i6 + 3] = x + 0.32 * d.len;
        pos[i6 + 4] = d.y + d.len;
        pos[i6 + 5] = z + 0.16 * d.len;
      }
      rain.geo.attributes.position.needsUpdate = true;
    }

    // 暴雨闪电
    if (presetKey === 'storm') {
      nextFlash -= dt;
      if (nextFlash <= 0) {
        flash = 1;
        nextFlash = 4.5 + Math.random() * 7;
      }
    }
    if (flash > 0.001) {
      flash *= Math.exp(-dt * 4.6);
      const flicker = 0.72 + 0.28 * Math.sin(time * 47.0);
      flashLight.intensity = flash * 7.5 * flicker;
    } else {
      flash = 0;
      flashLight.intensity = 0;
    }
  }

  return {
    setPreset,
    update,
    applyToSnapshot: (snapshot) => applyWeatherToSnapshot(snapshot, presetKey),
    get preset() {
      return presetKey;
    },
    get isActive() {
      return presetKey !== 'clear';
    },
    get rainLevel() {
      return rainLevel;
    },
  };
}
