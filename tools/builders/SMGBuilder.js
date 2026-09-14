/**
 * SMGBuilder.js — detailed Document D §5.2 compact submachine gun.
 *
 * NOTE: All gameplay-critical object names and socket names/positions match
 * the original simplified version exactly. Each named part is now a
 * THREE.Group at the same local transform as the old single mesh, containing
 * sub-meshes for visual detail. getObjectByName('Bone_Magazine') /
 * ('Bone_ChargingHandle') / etc. still resolves to an Object3D at the correct
 * transform, so cycling-action animation and socket-based attachment
 * continue to work unchanged.
 *
 * IMPORTANT: OpticBody's outer envelope (position [0,0.053,-0.06], depth
 * 0.055 along Z) is left EXACTLY as in the original — Socket_Optic sits at
 * its rear face (z = -0.06 + 0.0275 = -0.0325, socket at -0.033) per
 * Document C §8.2 eye-relief math. All optic detail meshes are nested inside
 * that envelope, never extending past the rear face.
 *
 * Axis convention (COORDINATE_CONVENTIONS.md): -Z is down the barrel, out the
 * muzzle. Every socket below follows that.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildSMGPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x51555e;
  const metalColor    = 0x4b4e57;
  const polymerColor  = 0x515159;
  const detailColor   = 0x464651;

  // ---------------------------------------------------------------------
  // RECEIVER
  // ---------------------------------------------------------------------
  const receiver = new THREE.Group();
  receiver.name = 'Receiver';
  receiver.position.set(0, 0, 0.01);
  receiver.rotation.set(0, 0, 0);

  receiver.add(box([0.048, 0.05, 0.26], receiverColor, [0, 0.014, 0], [0, 0, 0], 'Receiver_UpperShell'));
  receiver.add(box([0.046, 0.03, 0.20], receiverColor, [0, -0.038, 0.01], [0, 0, 0], 'Receiver_LowerShell'));
  receiver.add(box([0.038, 0.006, 0.24], detailColor, [0, 0.038, 0], [0, 0, 0], 'Receiver_TopRail'));
  receiver.add(box([0.028, 0.004, 0.02], detailColor, [0, 0.041, 0.06], [0, 0, 0], 'Receiver_RailSlot1'));
  receiver.add(box([0.028, 0.004, 0.02], detailColor, [0, 0.041, 0.02], [0, 0, 0], 'Receiver_RailSlot2'));
  receiver.add(box([0.028, 0.004, 0.02], detailColor, [0, 0.041, -0.02], [0, 0, 0], 'Receiver_RailSlot3'));
  receiver.add(box([0.044, 0.006, 0.06], metalColor, [0, -0.005, -0.14], [0, 0, 0], 'Receiver_EjectionLip'));
  receiver.add(box([0.046, 0.006, 0.02], metalColor, [0, -0.055, 0.02], [0, 0, 0], 'Receiver_TriggerGuardFront'));
  receiver.add(box([0.006, 0.028, 0.02], metalColor, [-0.02, -0.045, 0.02], [0, 0, 0], 'Receiver_TriggerGuardL'));
  receiver.add(box([0.006, 0.028, 0.02], metalColor, [0.02, -0.045, 0.02], [0, 0, 0], 'Receiver_TriggerGuardR'));
  receiver.add(box([0.008, 0.026, 0.006], detailColor, [0, -0.045, 0.025], [0, 0, 0], 'Receiver_Trigger'));
  receiver.add(box([0.05, 0.005, 0.26], detailColor, [0, -0.012, 0], [0, 0, 0], 'Receiver_SeamLine'));
  receiver.add(box([0.006, 0.008, 0.03], detailColor, [0.026, 0.01, 0.08], [0, 0, 0], 'Receiver_SelectorLever'));
  root.add(receiver);

  // ---------------------------------------------------------------------
  // BARREL
  // ---------------------------------------------------------------------
  const barrel = new THREE.Group();
  barrel.name = 'Barrel';
  barrel.position.set(0, 0.012, -0.21);
  barrel.rotation.set(Math.PI / 2, 0, 0);

  barrel.add(cyl(0.010, 0.17, metalColor, [0, 0, 0], [0, 0, 0], 8, 'Barrel_MainTube'));
  barrel.add(cyl(0.013, 0.03, metalColor, [0, 0.065, 0], [0, 0, 0], 8, 'Barrel_Trunnion'));
  barrel.add(cyl(0.0105, 0.006, detailColor, [0, -0.075, 0], [0, 0, 0], 8, 'Barrel_Crown'));
  root.add(barrel);

  // ---------------------------------------------------------------------
  // MUZZLE DEVICE
  // ---------------------------------------------------------------------
  const muzzleDevice = new THREE.Group();
  muzzleDevice.name = 'MuzzleDevice';
  muzzleDevice.position.set(0, 0.012, -0.30);
  muzzleDevice.rotation.set(Math.PI / 2, 0, 0);

  muzzleDevice.add(cyl(0.015, 0.04, metalColor, [0, 0, 0], [0, 0, 0], 8, 'MuzzleDevice_Body'));
  muzzleDevice.add(box([0.006, 0.02, 0.01], detailColor, [0.013, 0, 0.008], [0, 0, 0], 'MuzzleDevice_PortR'));
  muzzleDevice.add(box([0.006, 0.02, 0.01], detailColor, [-0.013, 0, 0.008], [0, 0, 0], 'MuzzleDevice_PortL'));
  muzzleDevice.add(cyl(0.0155, 0.005, detailColor, [0, 0.018, 0], [0, 0, 0], 8, 'MuzzleDevice_RearBand'));
  muzzleDevice.add(cyl(0.011, 0.004, detailColor, [0, -0.018, 0], [0, 0, 0], 8, 'MuzzleDevice_Crown'));
  root.add(muzzleDevice);

  // ---------------------------------------------------------------------
  // STOCK RAILS — skeletal folding stock
  // ---------------------------------------------------------------------
  const stockRailR = new THREE.Group();
  stockRailR.name = 'StockRailR';
  stockRailR.position.set(0.019, 0.006, 0.22);
  stockRailR.rotation.set(0, 0, 0);
  stockRailR.add(box([0.012, 0.05, 0.20], metalColor, [0, 0, 0], [0, 0, 0], 'StockRailR_Tube'));
  stockRailR.add(cyl(0.008, 0.012, detailColor, [0, 0.02, -0.09], [Math.PI / 2, 0, 0], 6, 'StockRailR_HingePin'));
  stockRailR.add(box([0.013, 0.01, 0.01], detailColor, [0, -0.015, 0.05], [0, 0, 0], 'StockRailR_LockTab'));
  root.add(stockRailR);

  const stockRailL = new THREE.Group();
  stockRailL.name = 'StockRailL';
  stockRailL.position.set(-0.019, 0.006, 0.22);
  stockRailL.rotation.set(0, 0, 0);
  stockRailL.add(box([0.012, 0.05, 0.20], metalColor, [0, 0, 0], [0, 0, 0], 'StockRailL_Tube'));
  stockRailL.add(cyl(0.008, 0.012, detailColor, [0, 0.02, -0.09], [Math.PI / 2, 0, 0], 6, 'StockRailL_HingePin'));
  stockRailL.add(box([0.013, 0.01, 0.01], detailColor, [0, -0.015, 0.05], [0, 0, 0], 'StockRailL_LockTab'));
  root.add(stockRailL);

  // ---------------------------------------------------------------------
  // STOCK PAD
  // ---------------------------------------------------------------------
  const stockPad = new THREE.Group();
  stockPad.name = 'StockPad';
  stockPad.position.set(0, 0.006, 0.33);
  stockPad.rotation.set(0, 0, 0);

  stockPad.add(box([0.052, 0.055, 0.02], polymerColor, [0, 0, 0], [0, 0, 0], 'StockPad_Main'));
  stockPad.add(box([0.052, 0.01, 0.02], detailColor, [0, 0.02, 0.002], [0, 0, 0], 'StockPad_RubberLip'));
  stockPad.add(box([0.006, 0.045, 0.005], detailColor, [0.02, 0, 0.011], [0, 0, 0], 'StockPad_TextureR'));
  stockPad.add(box([0.006, 0.045, 0.005], detailColor, [-0.02, 0, 0.011], [0, 0, 0], 'StockPad_TextureL'));
  root.add(stockPad);

  // ---------------------------------------------------------------------
  // FOREGRIP
  // ---------------------------------------------------------------------
  const foregrip = new THREE.Group();
  foregrip.name = 'Foregrip';
  foregrip.position.set(0, -0.052, -0.10);
  foregrip.rotation.set(0, 0, 0);

  foregrip.add(box([0.032, 0.052, 0.06], polymerColor, [0, 0, 0], [0, 0, 0], 'Foregrip_Main'));
  foregrip.add(box([0.033, 0.008, 0.01], detailColor, [0, 0.015, 0], [0, 0, 0], 'Foregrip_Ridge1'));
  foregrip.add(box([0.033, 0.008, 0.01], detailColor, [0, 0.0, 0], [0, 0, 0], 'Foregrip_Ridge2'));
  foregrip.add(box([0.033, 0.008, 0.01], detailColor, [0, -0.015, 0], [0, 0, 0], 'Foregrip_Ridge3'));
  foregrip.add(box([0.034, 0.01, 0.062], metalColor, [0, 0.026, 0], [0, 0, 0], 'Foregrip_RailClamp'));
  root.add(foregrip);

  // ---------------------------------------------------------------------
  // PISTOL GRIP
  // ---------------------------------------------------------------------
  const pistolGrip = new THREE.Group();
  pistolGrip.name = 'PistolGrip';
  pistolGrip.position.set(0, -0.082, 0.07);
  pistolGrip.rotation.set(0.30, 0, 0);

  pistolGrip.add(box([0.036, 0.115, 0.05], polymerColor, [0, 0, 0], [0, 0, 0], 'PistolGrip_Main'));
  pistolGrip.add(box([0.038, 0.02, 0.052], metalColor, [0, -0.067, 0], [0, 0, 0], 'PistolGrip_Cap'));
  pistolGrip.add(box([0.037, 0.006, 0.012], detailColor, [0, 0.025, 0.026], [0, 0, 0], 'PistolGrip_Ridge1'));
  pistolGrip.add(box([0.037, 0.006, 0.012], detailColor, [0, 0.005, 0.026], [0, 0, 0], 'PistolGrip_Ridge2'));
  pistolGrip.add(box([0.037, 0.006, 0.012], detailColor, [0, -0.015, 0.026], [0, 0, 0], 'PistolGrip_Ridge3'));
  root.add(pistolGrip);

  // ---------------------------------------------------------------------
  // BONE_MAGAZINE — long straight box magazine
  // ---------------------------------------------------------------------
  const magazine = new THREE.Group();
  magazine.name = 'Bone_Magazine';
  magazine.position.set(0, -0.115, -0.02);
  magazine.rotation.set(0.30, 0, 0);

  magazine.add(box([0.030, 0.08, 0.048], polymerColor, [0, 0.05, 0], [0, 0, 0], 'Magazine_Seg1'));
  magazine.add(box([0.030, 0.06, 0.048], polymerColor, [0, -0.01, 0], [0, 0, 0], 'Magazine_Seg2'));
  magazine.add(box([0.032, 0.025, 0.05], detailColor, [0, -0.075, 0], [0, 0, 0], 'Magazine_Floorplate'));
  magazine.add(box([0.006, 0.15, 0.006], detailColor, [0.013, 0, 0.02], [0, 0, 0], 'Magazine_RibR'));
  magazine.add(box([0.006, 0.15, 0.006], detailColor, [-0.013, 0, 0.02], [0, 0, 0], 'Magazine_RibL'));
  magazine.add(box([0.008, 0.012, 0.012], detailColor, [0, 0.075, 0.02], [0, 0, 0], 'Magazine_Catch'));
  root.add(magazine);

  // ---------------------------------------------------------------------
  // BONE_CHARGINGHANDLE
  // ---------------------------------------------------------------------
  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'Bone_ChargingHandle';
  chargingHandle.position.set(0.032, 0.028, -0.03);
  chargingHandle.rotation.set(0, 0, 0);

  chargingHandle.add(box([0.013, 0.013, 0.026], metalColor, [0, 0, 0], [0, 0, 0], 'ChargingHandle_Shaft'));
  chargingHandle.add(cyl(0.010, 0.016, detailColor, [0, 0, -0.017], [Math.PI / 2, 0, 0], 8, 'ChargingHandle_Knob'));
  root.add(chargingHandle);

  // ---------------------------------------------------------------------
  // OPTIC BODY — outer envelope UNCHANGED; Socket_Optic anchors to its rear
  // face at local Z = -0.06 + 0.0275 = -0.0325 (socket given as -0.033).
  // ---------------------------------------------------------------------
  const opticBody = new THREE.Group();
  opticBody.name = 'OpticBody';
  opticBody.position.set(0, 0.053, -0.06);
  opticBody.rotation.set(0, 0, 0);

  // Main housing — identical size/position to the original mesh (do not alter).
  opticBody.add(box([0.030, 0.030, 0.055], metalColor, [0, 0, 0], [0, 0, 0], 'OpticBody_Housing'));
  // Detail meshes nested INSIDE the housing's envelope (never exceed ±0.0275 on Z).
  opticBody.add(box([0.032, 0.008, 0.03], detailColor, [0, 0.017, -0.01], [0, 0, 0], 'OpticBody_TopStrap'));
  opticBody.add(box([0.006, 0.03, 0.045], detailColor, [0, -0.02, 0], [0, 0, 0], 'OpticBody_MountBase'));
  opticBody.add(cyl(0.005, 0.012, detailColor, [-0.017, 0.005, 0.01], [0, 0, Math.PI / 2], 6, 'OpticBody_WindageKnob'));
  opticBody.add(cyl(0.005, 0.012, detailColor, [0, 0.017, 0.01], [Math.PI / 2, 0, 0], 6, 'OpticBody_ElevationKnob'));
  opticBody.add(cyl(0.006, 0.02, detailColor, [0.014, -0.01, -0.02], [0, 0, 0], 6, 'OpticBody_BatteryCap'));
  root.add(opticBody);

  // ---------------------------------------------------------------------
  // OPTIC GLASS — unchanged position/size
  // ---------------------------------------------------------------------
  const opticGlass = new THREE.Group();
  opticGlass.name = 'OpticGlass';
  opticGlass.position.set(0, 0.053, -0.088);
  opticGlass.rotation.set(0, 0, 0);

  opticGlass.add(box([0.026, 0.026, 0.004], 0x3e4d5c, [0, 0, 0], [0, 0, 0], 'OpticGlass_Lens'));
  opticGlass.add(box([0.028, 0.028, 0.002], detailColor, [0, 0, 0.003], [0, 0, 0], 'OpticGlass_Bezel'));
  root.add(opticGlass);

  // ---------------------------------------------------------------------
  // SOCKETS — unchanged names/positions, required for attachments/validation
  // ---------------------------------------------------------------------
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
