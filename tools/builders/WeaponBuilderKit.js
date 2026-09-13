/**
 * WeaponBuilderKit.js — shared primitive helpers for the procedural weapon
 * builders (Document A §4.2). A new weapon is a new arrangement of boxes/
 * cylinders plus one socket pass — never new rendering code.
 */
import * as THREE from 'three';

export function box(size, color, pos = [0, 0, 0], rot = [0, 0, 0], name) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.4, flatShading: true }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  if (name) mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

export function cyl(radius, height, color, pos, rot = [0, 0, 0], segments = 8, name) {
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, segments),
    new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.6, flatShading: true }),
  );
  mesh.position.set(...pos);
  mesh.rotation.set(...rot);
  if (name) mesh.name = name;
  mesh.castShadow = true;
  return mesh;
}

export function socket(name, pos) {
  const s = new THREE.Object3D();
  s.name = name;
  s.position.set(...pos);
  return s;
}

export const SOCKET_NAMES = [
  'Socket_Grip', 'Socket_GripSecondary', 'Socket_Muzzle',
  'Socket_Magazine', 'Socket_Ejection', 'Socket_Optic',
];

/** Assert all six sockets exist with unique names (Document A §4.1). */
export function validateSockets(root) {
  const missing = SOCKET_NAMES.filter((n) => !root.getObjectByName(n));
  if (missing.length) throw new Error(`[WeaponBuilder] ${root.name || 'weapon'} missing sockets: ${missing.join(', ')}`);
  return true;
}
