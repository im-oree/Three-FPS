/**
 * PistolBuilder.js — low-poly service pistol (Document A §4.2: short slide +
 * barrel + grip, no stock/foregrip; Socket_GripSecondary at a wrist-support
 * point; gripStyle 'oneHanded' in its profile).
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildPistolPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const slideColor = 0x26262a, frameColor = 0x333430, metalColor = 0x1c1c1c;

  root.add(box([0.032, 0.05, 0.20], slideColor, [0, 0.045, -0.02], [0, 0, 0], 'Slide'));
  root.add(cyl(0.010, 0.06, metalColor, [0, 0.045, -0.14], [Math.PI / 2, 0, 0], 8, 'Barrel'));
  root.add(box([0.030, 0.045, 0.16], frameColor, [0, 0.005, 0.0], [0, 0, 0], 'Frame'));
  root.add(box([0.034, 0.11, 0.05], frameColor, [0, -0.06, 0.055], [0.25, 0, 0], 'PistolGrip'));
  const magazine = box([0.024, 0.09, 0.036], metalColor, [0, -0.075, 0.052], [0.25, 0, 0], 'Bone_Magazine');
  root.add(magazine);
  root.add(box([0.012, 0.012, 0.024], metalColor, [0.022, 0.06, 0.02], [0, 0, 0], 'Bone_ChargingHandle'));

  root.add(socket('Socket_Grip', [0, -0.075, 0.06]));
  root.add(socket('Socket_GripSecondary', [-0.05, -0.05, 0.04])); // wrist support
  root.add(socket('Socket_Muzzle', [0, 0.045, -0.18]));
  root.add(socket('Socket_Magazine', [0, -0.075, 0.052]));
  root.add(socket('Socket_Ejection', [0.03, 0.06, -0.02]));
  root.add(socket('Socket_Optic', [0, 0.085, -0.02]));

  validateSockets(root);
  return root;
}
