/**
 * SMGBuilder.js — Document D §5.2: compact submachine gun.
 *
 * Design identity: the lightest two-handed weapon — short barrel, folding
 * stock, long straight box magazine forward of the grip, and a red-dot optic
 * sitting on the receiver rail (Socket_Optic is the RDS glass position, so
 * eye-relief alignment in Document C §8.2 lands the camera behind the dot).
 *
 * Axis convention (COORDINATE_CONVENTIONS.md): -Z is down the barrel, out the
 * muzzle. Every socket below follows that.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildSMGPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x24262a;
  const metalColor = 0x18191c;
  const polymerColor = 0x1f1f22;

  root.add(box([0.048, 0.078, 0.26], receiverColor, [0, 0, 0.01], [0, 0, 0], 'Receiver'));
  root.add(cyl(0.010, 0.17, metalColor, [0, 0.012, -0.21], [Math.PI / 2, 0, 0], 8, 'Barrel'));
  // Short muzzle device — visually distinguishes it from the rifle at a glance.
  root.add(cyl(0.015, 0.04, metalColor, [0, 0.012, -0.30], [Math.PI / 2, 0, 0], 8, 'MuzzleDevice'));
  // Skeletal folding stock: two thin rails rather than a solid block.
  root.add(box([0.012, 0.05, 0.20], metalColor, [0.019, 0.006, 0.22], [0, 0, 0], 'StockRailR'));
  root.add(box([0.012, 0.05, 0.20], metalColor, [-0.019, 0.006, 0.22], [0, 0, 0], 'StockRailL'));
  root.add(box([0.052, 0.055, 0.02], polymerColor, [0, 0.006, 0.33], [0, 0, 0], 'StockPad'));

  root.add(box([0.032, 0.052, 0.06], polymerColor, [0, -0.052, -0.10], [0, 0, 0], 'Foregrip'));
  root.add(box([0.036, 0.115, 0.05], polymerColor, [0, -0.082, 0.07], [0.30, 0, 0], 'PistolGrip'));
  root.add(box([0.030, 0.175, 0.048], polymerColor, [0, -0.115, -0.02], [0.30, 0, 0], 'Bone_Magazine'));
  root.add(box([0.013, 0.013, 0.026], metalColor, [0.032, 0.028, -0.03], [0, 0, 0], 'Bone_ChargingHandle'));

  // Red-dot optic body + glass, sat on the receiver rail.
  root.add(box([0.030, 0.030, 0.055], metalColor, [0, 0.053, -0.06], [0, 0, 0], 'OpticBody'));
  root.add(box([0.026, 0.026, 0.004], 0x101418, [0, 0.053, -0.088], [0, 0, 0], 'OpticGlass'));

  root.add(socket('Socket_Grip', [0, -0.082, 0.07]));
  root.add(socket('Socket_GripSecondary', [0, -0.052, -0.10]));
  root.add(socket('Socket_Muzzle', [0, 0.012, -0.325]));
  root.add(socket('Socket_Magazine', [0, -0.115, -0.02]));
  root.add(socket('Socket_Ejection', [0.038, 0.032, -0.01]));
  // Rear of the optic — where the shooter's eye lines up through the dot.
  root.add(socket('Socket_Optic', [0, 0.053, -0.033]));

  validateSockets(root);
  return root;
}
