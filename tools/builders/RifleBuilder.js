/**
 * RifleBuilder.js — detailed low-poly AK-pattern rifle (Document A §4.2 reference
 * implementation, engine -Z-forward metres).
 *
 * NOTE: All gameplay-critical object names and socket names/positions are
 * IDENTICAL to the original simplified version. Each named part is now a
 * THREE.Group positioned/rotated exactly where the old single mesh was,
 * containing multiple sub-meshes for visual detail. Any code that does
 * root.getObjectByName('Bone_Magazine') / ('Bone_ChargingHandle') / etc.
 * will still get an Object3D at the same local transform, so bone-driven
 * animation (reload, charging handle racking) and socket-based attachment
 * continue to work unchanged.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildRiflePattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x2b2b28;
  const woodColor     = 0x5b3a21;
  const metalColor    = 0x1c1c1c;
  const detailColor   = 0x111111; // slightly darker accents (pins, screws, springs)

  // ---------------------------------------------------------------------
  // RECEIVER — group replaces the single body box, keeps name/transform
  // ---------------------------------------------------------------------
  const receiver = new THREE.Group();
  receiver.name = 'Receiver';
  receiver.position.set(0, 0, -0.05);
  receiver.rotation.set(0, 0, 0);

  receiver.add(box([0.06, 0.05, 0.42], receiverColor, [0, 0.02, 0], [0, 0, 0], 'Receiver_UpperShell'));
  receiver.add(box([0.058, 0.04, 0.30], receiverColor, [0, -0.045, 0.05], [0, 0, 0], 'Receiver_LowerShell'));
  receiver.add(box([0.045, 0.02, 0.20], receiverColor, [0, 0.045, -0.05], [0, 0, 0], 'Receiver_DustCover'));
  receiver.add(box([0.006, 0.006, 0.20], detailColor, [0, 0.03, -0.05], [0, 0, 0], 'Receiver_DustCoverRib'));
  receiver.add(box([0.045, 0.006, 0.02], metalColor, [0, -0.07, 0.15], [0, 0, 0], 'Receiver_TriggerGuardFront'));
  receiver.add(box([0.006, 0.03, 0.02], metalColor, [-0.02, -0.055, 0.15], [0, 0, 0], 'Receiver_TriggerGuardL'));
  receiver.add(box([0.006, 0.03, 0.02], metalColor, [0.02, -0.055, 0.15], [0, 0, 0], 'Receiver_TriggerGuardR'));
  receiver.add(box([0.008, 0.03, 0.006], detailColor, [0, -0.055, 0.155], [0, 0, 0], 'Receiver_Trigger'));
  receiver.add(box([0.006, 0.008, 0.05], detailColor, [0.032, 0.0, 0.08], [0, 0, 0], 'Receiver_SelectorLever'));
  receiver.add(box([0.018, 0.012, 0.018], metalColor, [0, 0.05, 0.19], [0, 0, 0], 'Receiver_RearSightBase'));
  receiver.add(cyl(0.0015, 0.018, detailColor, [0, 0.058, 0.19], [0, 0, Math.PI / 2], 6, 'Receiver_RearSightLeaf'));
  receiver.add(box([0.01, 0.018, 0.05], receiverColor, [0.033, 0.02, -0.08], [0, 0, 0], 'Receiver_EjectionLip'));
  receiver.add(box([0.05, 0.008, 0.10], metalColor, [0, 0.047, -0.15], [0, 0, 0], 'Receiver_OpticRail'));
  receiver.add(box([0.062, 0.006, 0.42], detailColor, [0, -0.002, 0], [0, 0, 0], 'Receiver_SeamLine'));
  root.add(receiver);

  // ---------------------------------------------------------------------
  // BARREL — group replaces the single cylinder, keeps name/transform.
  // (local +Y = toward receiver/breech, local -Y = toward muzzle)
  // ---------------------------------------------------------------------
  const barrel = new THREE.Group();
  barrel.name = 'Barrel';
  barrel.position.set(0, 0.01, -0.55);
  barrel.rotation.set(Math.PI / 2, 0, 0);

  barrel.add(cyl(0.012, 0.5, metalColor, [0, 0, 0], [0, 0, 0], 8, 'Barrel_MainTube'));
  barrel.add(box([0.03, 0.03, 0.02], metalColor, [0, 0, 0.235], [0, 0, 0], 'Barrel_Trunnion'));
  barrel.add(box([0.026, 0.026, 0.03], metalColor, [0, 0.012, -0.10], [0, 0, 0], 'Barrel_GasBlock'));
  barrel.add(cyl(0.006, 0.16, metalColor, [0, 0.022, 0.05], [0, 0, 0], 6, 'Barrel_GasTube'));
  barrel.add(box([0.02, 0.03, 0.02], metalColor, [0, 0.02, -0.20], [0, 0, 0], 'Barrel_FrontSightBase'));
  barrel.add(cyl(0.003, 0.035, detailColor, [0, 0.005, -0.225], [Math.PI / 2, 0, 0], 6, 'Barrel_FrontSightPost'));
  barrel.add(cyl(0.015, 0.05, metalColor, [0, 0, -0.275], [0, 0, 0], 8, 'Barrel_MuzzleBrake'));
  barrel.add(cyl(0.017, 0.01, detailColor, [0, 0, -0.30], [0, 0, 0], 8, 'Barrel_MuzzleCap'));
  root.add(barrel);

  // ---------------------------------------------------------------------
  // STOCK
  // ---------------------------------------------------------------------
  const stock = new THREE.Group();
  stock.name = 'Stock';
  stock.position.set(0, -0.01, 0.28);
  stock.rotation.set(0, 0, 0);

  stock.add(box([0.05, 0.09, 0.28], woodColor, [0, -0.005, -0.01], [0, 0, 0], 'Stock_Body'));
  stock.add(box([0.045, 0.02, 0.12], woodColor, [0, 0.055, -0.06], [0, 0, 0], 'Stock_Comb'));
  stock.add(box([0.055, 0.10, 0.02], metalColor, [0, -0.005, 0.14], [0, 0, 0], 'Stock_Buttplate'));
  stock.add(box([0.025, 0.008, 0.006], metalColor, [0, -0.05, 0.05], [0, 0, 0], 'Stock_SlingLoop'));
  stock.add(box([0.002, 0.05, 0.20], detailColor, [0.026, -0.005, -0.01], [0, 0, 0], 'Stock_PanelLineR'));
  stock.add(box([0.002, 0.05, 0.20], detailColor, [-0.026, -0.005, -0.01], [0, 0, 0], 'Stock_PanelLineL'));
  root.add(stock);

  // ---------------------------------------------------------------------
  // FOREGRIP
  // ---------------------------------------------------------------------
  const foregrip = new THREE.Group();
  foregrip.name = 'Foregrip';
  foregrip.position.set(0, -0.05, -0.28);
  foregrip.rotation.set(0, 0, 0);

  foregrip.add(box([0.05, 0.035, 0.17], woodColor, [0, 0.017, 0], [0, 0, 0], 'Foregrip_Upper'));
  foregrip.add(box([0.05, 0.032, 0.17], woodColor, [0, -0.019, 0], [0, 0, 0], 'Foregrip_Lower'));
  foregrip.add(box([0.052, 0.006, 0.01], metalColor, [0, 0.0, 0.06], [0, 0, 0], 'Foregrip_Ridge1'));
  foregrip.add(box([0.052, 0.006, 0.01], metalColor, [0, 0.0, 0.0], [0, 0, 0], 'Foregrip_Ridge2'));
  foregrip.add(box([0.052, 0.006, 0.01], metalColor, [0, 0.0, -0.06], [0, 0, 0], 'Foregrip_Ridge3'));
  foregrip.add(box([0.01, 0.012, 0.02], detailColor, [0.03, -0.02, -0.08], [0, 0, 0], 'Foregrip_SlingSwivel'));
  root.add(foregrip);

  // ---------------------------------------------------------------------
  // BONE_MAGAZINE — group replaces single box, SAME name/position/rotation
  // so any code moving/animating this bone still works.
  // ---------------------------------------------------------------------
  const magazine = new THREE.Group();
  magazine.name = 'Bone_Magazine';
  magazine.position.set(0, -0.14, -0.02);
  magazine.rotation.set(0.35, 0, 0);

  magazine.add(box([0.044, 0.05, 0.088], metalColor, [0, 0.075, 0], [0, 0, 0], 'Magazine_Seg1'));
  magazine.add(box([0.046, 0.05, 0.09], metalColor, [0, 0.025, 0.006], [0, 0, 0], 'Magazine_Seg2'));
  magazine.add(box([0.048, 0.05, 0.09], metalColor, [0, -0.025, 0.008], [0, 0, 0], 'Magazine_Seg3'));
  magazine.add(box([0.044, 0.04, 0.086], metalColor, [0, -0.07, 0.002], [0, 0, 0], 'Magazine_Seg4'));
  magazine.add(box([0.05, 0.014, 0.09], detailColor, [0, -0.098, 0], [0, 0, 0], 'Magazine_Floorplate'));
  magazine.add(box([0.008, 0.18, 0.01], detailColor, [0, -0.01, 0.045], [0, 0, 0], 'Magazine_Rib'));
  magazine.add(box([0.01, 0.018, 0.018], detailColor, [0.023, 0.08, 0], [0, 0, 0], 'Magazine_Catch'));
  root.add(magazine);

  // ---------------------------------------------------------------------
  // PISTOL GRIP
  // ---------------------------------------------------------------------
  const pistolGrip = new THREE.Group();
  pistolGrip.name = 'PistolGrip';
  pistolGrip.position.set(0, -0.09, 0.10);
  pistolGrip.rotation.set(0.3, 0, 0);

  pistolGrip.add(box([0.04, 0.12, 0.048], woodColor, [0, 0, 0], [0, 0, 0], 'PistolGrip_Main'));
  pistolGrip.add(box([0.042, 0.02, 0.05], metalColor, [0, -0.07, 0], [0, 0, 0], 'PistolGrip_Cap'));
  pistolGrip.add(box([0.041, 0.006, 0.01], woodColor, [0, 0.02, 0.025], [0, 0, 0], 'PistolGrip_Ridge1'));
  pistolGrip.add(box([0.041, 0.006, 0.01], woodColor, [0, 0.0, 0.025], [0, 0, 0], 'PistolGrip_Ridge2'));
  pistolGrip.add(box([0.041, 0.006, 0.01], woodColor, [0, -0.02, 0.025], [0, 0, 0], 'PistolGrip_Ridge3'));
  pistolGrip.add(cyl(0.004, 0.01, detailColor, [0.021, 0.02, 0], [0, 0, Math.PI / 2], 6, 'PistolGrip_Screw'));
  root.add(pistolGrip);

  // ---------------------------------------------------------------------
  // BONE_CHARGINGHANDLE — group replaces single box, SAME name/transform.
  // ---------------------------------------------------------------------
  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'Bone_ChargingHandle';
  chargingHandle.position.set(0.04, 0.03, -0.10);
  chargingHandle.rotation.set(0, 0, 0);

  chargingHandle.add(box([0.015, 0.015, 0.03], metalColor, [0, 0, 0], [0, 0, 0], 'ChargingHandle_Shaft'));
  chargingHandle.add(cyl(0.012, 0.02, detailColor, [0, 0, -0.025], [Math.PI / 2, 0, 0], 8, 'ChargingHandle_Knob'));
  root.add(chargingHandle);

  // ---------------------------------------------------------------------
  // SOCKETS — unchanged names/positions, required for attachments/validation
  // ---------------------------------------------------------------------
  root.add(socket('Socket_Grip', [0, -0.10, 0.11]));
  root.add(socket('Socket_GripSecondary', [0, -0.03, -0.30]));
  root.add(socket('Socket_Muzzle', [0, 0.01, -0.80]));
  root.add(socket('Socket_Magazine', [0, -0.14, -0.02]));
  root.add(socket('Socket_Ejection', [0.05, 0.04, -0.05]));
  root.add(socket('Socket_Optic', [0, 0.06, -0.20]));

  validateSockets(root);
  return root;
}
