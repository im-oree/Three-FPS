/**
 * RocketLauncherBuilder.js — Document D §7.2: shoulder-fired launcher.
 *
 * Design identity: a large-diameter tube with a flared back-blast venturi at
 * the REAR, a simple optical sight on a rail, a forward carry handle and a
 * rear trigger grip.
 *
 * Two axis notes that are easy to get backwards and are called out explicitly
 * in Document D §7.2 / §7.8:
 *   - Socket_Muzzle is the FRONT launch end, so it is at -Z.
 *   - The back-blast venturi is the opposite end, so it is at +Z. Socket_Ejection
 *     is reused as the back-blast VFX spawn point and therefore also sits at +Z.
 *
 * Socket_ShoulderRest is a launcher-specific socket (Document D §7.5): the
 * shoulderMounted grip style locks this point against the shooter's shoulder
 * instead of IK-solving it, which is what gives the weapon its silhouette.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildRocketLauncherPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const tubeColor = 0x3a4632;
  const metalColor = 0x1a1a1c;
  const gripColor = 0x202022;

  // Main launch tube, running down -Z.
  root.add(cyl(0.050, 0.95, tubeColor, [0, 0, -0.10], [Math.PI / 2, 0, 0], 12, 'Tube'));
  // Front muzzle ring.
  root.add(cyl(0.056, 0.05, metalColor, [0, 0, -0.55], [Math.PI / 2, 0, 0], 12, 'MuzzleRing'));
  // Rear back-blast venturi — deliberately at +Z, the opposite end.
  root.add(cyl(0.060, 0.11, 0x202024, [0, 0, 0.43], [Math.PI / 2, 0, 0], 12, 'RearVent'));

  root.add(box([0.016, 0.034, 0.16], metalColor, [0, 0.062, -0.24], [0, 0, 0], 'SightRail'));
  root.add(box([0.026, 0.030, 0.05], metalColor, [0, 0.086, -0.22], [0, 0, 0], 'SightBody'));

  root.add(box([0.032, 0.095, 0.045], gripColor, [0, -0.078, -0.34], [0, 0, 0], 'Foregrip'));
  root.add(box([0.034, 0.115, 0.048], gripColor, [0, -0.080, 0.13], [0.28, 0, 0], 'TriggerGrip'));
  // Shoulder pad the tube actually rests on.
  root.add(box([0.070, 0.030, 0.12], gripColor, [0, 0.048, 0.33], [0, 0, 0], 'ShoulderPad'));
  // Loaded warhead, visible at the muzzle when the launcher is charged.
  root.add(cyl(0.044, 0.10, 0x6b5330, [0, 0, -0.52], [Math.PI / 2, 0, 0], 10, 'Bone_Magazine'));

  root.add(socket('Socket_Grip', [0, -0.080, 0.13]));
  root.add(socket('Socket_GripSecondary', [0, -0.078, -0.34]));
  root.add(socket('Socket_Muzzle', [0, 0, -0.60]));
  root.add(socket('Socket_Magazine', [0, 0, -0.52]));
  // Back-blast spawn point (Document D §7.8) — rear of the tube, +Z.
  root.add(socket('Socket_Ejection', [0, 0, 0.46]));
  root.add(socket('Socket_Optic', [0, 0.086, -0.19]));
  // Launcher-specific: where the tube meets the shoulder.
  root.add(socket('Socket_ShoulderRest', [0.06, 0.048, 0.33]));

  validateSockets(root);
  return root;
}

/**
 * The in-flight rocket projectile, spawned by ProjectileSystem. Exported as a
 * separate builder so the mesh is still produced by /tools rather than
 * constructed inside gameplay code (standing asset policy, tools/README.md).
 */
export function buildRocketProjectilePattern() {
  const root = new THREE.Group();
  root.name = 'Root_Projectile';
  root.add(cyl(0.030, 0.20, 0x6b5330, [0, 0, 0], [Math.PI / 2, 0, 0], 8, 'Warhead'));
  root.add(cyl(0.014, 0.10, 0x30302f, [0, 0, 0.14], [Math.PI / 2, 0, 0], 8, 'Motor'));
  root.add(box([0.004, 0.045, 0.05], 0x30302f, [0, 0, 0.17], [0, 0, 0], 'FinV'));
  root.add(box([0.045, 0.004, 0.05], 0x30302f, [0, 0, 0.17], [0, 0, 0], 'FinH'));
  return root;
}
