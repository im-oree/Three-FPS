/**
 * RifleBuilder.js — low-poly AK-pattern rifle (Document A §4.2 reference
 * implementation, engine -Z-forward metres).
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildRiflePattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x2b2b28, woodColor = 0x5b3a21, metalColor = 0x1c1c1c;

  root.add(box([0.06, 0.09, 0.42], receiverColor, [0, 0, -0.05], [0, 0, 0], 'Receiver'));
  root.add(cyl(0.012, 0.5, metalColor, [0, 0.01, -0.55], [Math.PI / 2, 0, 0], 8, 'Barrel'));
  root.add(box([0.05, 0.10, 0.30], woodColor, [0, -0.01, 0.28], [0, 0, 0], 'Stock'));
  root.add(box([0.055, 0.07, 0.18], woodColor, [0, -0.05, -0.28], [0, 0, 0], 'Foregrip'));
  const magazine = box([0.045, 0.22, 0.09], metalColor, [0, -0.14, -0.02], [0.35, 0, 0], 'Bone_Magazine');
  root.add(magazine);
  root.add(box([0.04, 0.14, 0.05], woodColor, [0, -0.09, 0.10], [0.3, 0, 0], 'PistolGrip'));
  root.add(box([0.015, 0.015, 0.03], metalColor, [0.04, 0.03, -0.10], [0, 0, 0], 'Bone_ChargingHandle'));

  root.add(socket('Socket_Grip', [0, -0.10, 0.11]));
  root.add(socket('Socket_GripSecondary', [0, -0.03, -0.30]));
  root.add(socket('Socket_Muzzle', [0, 0.01, -0.80]));
  root.add(socket('Socket_Magazine', [0, -0.14, -0.02]));
  root.add(socket('Socket_Ejection', [0.05, 0.04, -0.05]));
  root.add(socket('Socket_Optic', [0, 0.06, -0.20]));

  validateSockets(root);
  return root;
}
