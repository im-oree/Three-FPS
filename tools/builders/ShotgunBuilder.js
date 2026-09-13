/**
 * ShotgunBuilder.js — low-poly pump shotgun (Document A §4.2: tube magazine
 * under the barrel; the pump foregrip is Bone_Pump, animated during cycling).
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildShotgunPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x2a2622, woodColor = 0x4f3420, metalColor = 0x1c1c1c;

  root.add(box([0.055, 0.09, 0.30], receiverColor, [0, 0, -0.02], [0, 0, 0], 'Receiver'));
  root.add(cyl(0.014, 0.62, metalColor, [0, 0.02, -0.50], [Math.PI / 2, 0, 0], 8, 'Barrel'));
  root.add(cyl(0.011, 0.48, metalColor, [0, -0.025, -0.42], [Math.PI / 2, 0, 0], 8, 'TubeMagazine'));
  root.add(box([0.05, 0.10, 0.26], woodColor, [0, -0.01, 0.24], [0, 0, 0], 'Stock'));
  const pump = box([0.05, 0.06, 0.14], woodColor, [0, -0.035, -0.36], [0, 0, 0], 'Bone_Pump');
  root.add(pump);
  root.add(box([0.04, 0.13, 0.05], woodColor, [0, -0.085, 0.08], [0.3, 0, 0], 'PistolGrip'));
  root.add(box([0.014, 0.014, 0.028], metalColor, [0.035, 0.03, -0.06], [0, 0, 0], 'Bone_ChargingHandle'));

  root.add(socket('Socket_Grip', [0, -0.09, 0.09]));
  root.add(socket('Socket_GripSecondary', [0, -0.035, -0.36]));
  root.add(socket('Socket_Muzzle', [0, 0.02, -0.82]));
  root.add(socket('Socket_Magazine', [0, -0.025, -0.42]));
  root.add(socket('Socket_Ejection', [0.045, 0.03, -0.04]));
  root.add(socket('Socket_Optic', [0, 0.055, -0.14]));

  validateSockets(root);
  return root;
}
