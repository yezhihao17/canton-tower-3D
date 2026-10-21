import * as THREE from 'three';

/* 全城共享材质 */

/* ============================================================
   共享材质
   ============================================================ */

export const accentMat = new THREE.MeshBasicMaterial({
  color: 0xa9efff,
  transparent: true,
  opacity: 0.7,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

export const warmAccentMat = new THREE.MeshBasicMaterial({
  color: 0xffc27a,
  transparent: true,
  opacity: 0.5,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
  side: THREE.DoubleSide,
});

export const redBeaconMat = new THREE.MeshBasicMaterial({
  color: 0xff4b5c,
  transparent: true,
  opacity: 0.85,
});

export const concreteMat = new THREE.MeshStandardMaterial({
  color: 0x5a6267,
  metalness: 0.18,
  roughness: 0.78,
  emissive: 0x0d1a21,
  emissiveIntensity: 0.25,
});

export const paleStoneMat = new THREE.MeshStandardMaterial({
  color: 0x8a9499,
  metalness: 0.12,
  roughness: 0.72,
  emissive: 0x16242b,
  emissiveIntensity: 0.22,
  polygonOffset: true,
  polygonOffsetFactor: 0,
  polygonOffsetUnits: -4,
});

export const darkMetalMat = new THREE.MeshStandardMaterial({
  color: 0x2b343a,
  metalness: 0.65,
  roughness: 0.42,
  emissive: 0x0b1f27,
  emissiveIntensity: 0.3,
});

export const whiteSteelMat = new THREE.MeshStandardMaterial({
  color: 0xdbe8ee,
  metalness: 0.55,
  roughness: 0.3,
  emissive: 0x1d4652,
  emissiveIntensity: 0.45,
});
