/**
 * SniperBuilder.js — Document D §6.2: bolt-action sniper rifle.
 *
 * Design identity: the longest weapon in the roster — heavy barrel, long
 * scope tube, bipod under the foregrip, and a prominent bolt handle
 * (Bone_ChargingHandle) that the shared CyclingActionSystem racks between
 * shots.
 *
 * Socket_Optic sits at the REAR of the scope tube, because Document C §8.2
 * places the camera `eyeRelief` metres behind that socket along its local -Z.
 * A sniper scope has the longest eye relief of any optic (~0.12 m here), so
 * getting this socket's position right is what makes scoping in feel correct.
 *
 * Axis convention: -Z down the barrel, out the muzzle.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildSniperPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x2b2b2e;
  const metalColor = 0x161618;
  const stockColor = 0x33383a;

  root.add(box([0.046, 0.072, 0.40], receiverColor, [0, 0, -0.04], [0, 0, 0], 'Receiver'));
  // Heavy fluted barrel.
  root.add(cyl(0.013, 0.66, metalColor, [0, 0.010, -0.56], [Math.PI / 2, 0, 0], 8, 'Barrel'));
  root.add(cyl(0.019, 0.07, metalColor, [0, 0.010, -0.90], [Math.PI / 2, 0, 0], 8, 'MuzzleBrake'));

  root.add(box([0.046, 0.092, 0.34], stockColor, [0, -0.008, 0.30], [0, 0, 0], 'Stock'));
  root.add(box([0.046, 0.045, 0.10], stockColor, [0, 0.052, 0.22], [0, 0, 0], 'CheekRest'));
  root.add(box([0.038, 0.115, 0.05], stockColor, [0, -0.085, 0.10], [0.28, 0, 0], 'PistolGrip'));
  root.add(box([0.032, 0.150, 0.055], metalColor, [0, -0.105, -0.08], [0, 0, 0], 'Bone_Magazine'));

  // Scope: tube + fore/rear bells, raised on two rings.
  root.add(cyl(0.020, 0.30, 0x0c0c0e, [0, 0.078, -0.14], [Math.PI / 2, 0, 0], 10, 'ScopeTube'));
  root.add(cyl(0.028, 0.05, 0x0c0c0e, [0, 0.078, -0.30], [Math.PI / 2, 0, 0], 10, 'ScopeObjective'));
  root.add(cyl(0.025, 0.05, 0x0c0c0e, [0, 0.078, 0.01], [Math.PI / 2, 0, 0], 10, 'ScopeEyepiece'));
  root.add(box([0.014, 0.030, 0.016], metalColor, [0, 0.052, -0.24], [0, 0, 0], 'ScopeRingF'));
  root.add(box([0.014, 0.030, 0.016], metalColor, [0, 0.052, -0.04], [0, 0, 0], 'ScopeRingR'));

  // Bipod legs, folded down under the foregrip.
  root.add(box([0.010, 0.085, 0.010], metalColor, [0.026, -0.075, -0.46], [0, 0, 0.22], 'BipodLegR'));
  root.add(box([0.010, 0.085, 0.010], metalColor, [-0.026, -0.075, -0.46], [0, 0, -0.22], 'BipodLegL'));

  // Bolt handle — racked by CyclingActionSystem (Document D §6.6).
  root.add(box([0.016, 0.016, 0.05], metalColor, [0.038, 0.020, 0.03], [0, 0, 0], 'Bone_ChargingHandle'));

  root.add(socket('Socket_Grip', [0, -0.085, 0.10]));
  root.add(socket('Socket_GripSecondary', [0, -0.035, -0.34]));
  root.add(socket('Socket_Muzzle', [0, 0.010, -0.94]));
  root.add(socket('Socket_Magazine', [0, -0.105, -0.08]));
  root.add(socket('Socket_Ejection', [0.040, 0.028, -0.02]));
  // Rear of the eyepiece: the eye-relief anchor for the scope.
  root.add(socket('Socket_Optic', [0, 0.078, 0.035]));

  validateSockets(root);
  return root;
}
