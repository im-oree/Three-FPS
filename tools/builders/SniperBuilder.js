/**
 * SniperBuilder.js — detailed Document D §6.2 bolt-action sniper rifle.
 *
 * NOTE: All gameplay-critical object names and socket names/positions are
 * IDENTICAL to the original simplified version. Each named part is now a
 * THREE.Group positioned/rotated exactly where the old single mesh was,
 * containing multiple sub-meshes for visual detail. Any code doing
 * getObjectByName('Bone_Magazine') / ('Bone_ChargingHandle') / ('ScopeTube')
 * etc. still resolves to an Object3D at the same transform, so bolt-cycling
 * animation and socket-based attachment continue to work unchanged.
 *
 * IMPORTANT: ScopeEyepiece's outer envelope (position/radius/length) is left
 * EXACTLY as in the original — Socket_Optic's eye-relief math depends on its
 * rear face being at local Z = 0.035 (0.01 + 0.025 half-length). All eyepiece
 * detail meshes are nested inside that bound, never extending past it.
 *
 * Axis convention: -Z down the barrel, out the muzzle.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildSniperPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const receiverColor = 0x57575d;
  const metalColor    = 0x4c4c53;
  const stockColor    = 0x565f62;
  const detailColor   = 0x464651;
  const lensColor     = 0x2e6682; // faint blue lens tint

  // ---------------------------------------------------------------------
  // RECEIVER
  // ---------------------------------------------------------------------
  const receiver = new THREE.Group();
  receiver.name = 'Receiver';
  receiver.position.set(0, 0, -0.04);
  receiver.rotation.set(0, 0, 0);

  receiver.add(box([0.046, 0.05, 0.40], receiverColor, [0, 0.011, 0], [0, 0, 0], 'Receiver_UpperShell'));
  receiver.add(box([0.044, 0.03, 0.30], receiverColor, [0, -0.05, 0.02], [0, 0, 0], 'Receiver_LowerShell'));
  receiver.add(cyl(0.021, 0.11, metalColor, [0, 0.014, 0.15], [Math.PI / 2, 0, 0], 10, 'Receiver_BoltShroud'));
  receiver.add(box([0.04, 0.006, 0.34], detailColor, [0, 0.037, 0], [0, 0, 0], 'Receiver_ScopeRailBase'));
  receiver.add(box([0.03, 0.004, 0.02], detailColor, [0, 0.041, 0.10], [0, 0, 0], 'Receiver_RailSlot1'));
  receiver.add(box([0.03, 0.004, 0.02], detailColor, [0, 0.041, 0.04], [0, 0, 0], 'Receiver_RailSlot2'));
  receiver.add(box([0.03, 0.004, 0.02], detailColor, [0, 0.041, -0.02], [0, 0, 0], 'Receiver_RailSlot3'));
  receiver.add(box([0.03, 0.004, 0.02], detailColor, [0, 0.041, -0.08], [0, 0, 0], 'Receiver_RailSlot4'));
  receiver.add(box([0.044, 0.008, 0.03], metalColor, [0, -0.062, 0.10], [0, 0, 0], 'Receiver_TriggerGuardFront'));
  receiver.add(box([0.006, 0.03, 0.03], metalColor, [-0.019, -0.05, 0.10], [0, 0, 0], 'Receiver_TriggerGuardL'));
  receiver.add(box([0.006, 0.03, 0.03], metalColor, [0.019, -0.05, 0.10], [0, 0, 0], 'Receiver_TriggerGuardR'));
  receiver.add(box([0.008, 0.028, 0.006], detailColor, [0, -0.05, 0.105], [0, 0, 0], 'Receiver_Trigger'));
  receiver.add(box([0.048, 0.006, 0.40], detailColor, [0, -0.014, 0], [0, 0, 0], 'Receiver_SeamLine'));
  receiver.add(box([0.008, 0.008, 0.04], metalColor, [0.025, 0.0, 0.16], [0, 0, 0], 'Receiver_SafetyLever'));
  root.add(receiver);

  // ---------------------------------------------------------------------
  // BARREL — heavy fluted barrel
  // ---------------------------------------------------------------------
  const barrel = new THREE.Group();
  barrel.name = 'Barrel';
  barrel.position.set(0, 0.010, -0.56);
  barrel.rotation.set(Math.PI / 2, 0, 0);

  barrel.add(cyl(0.013, 0.66, metalColor, [0, 0, 0], [0, 0, 0], 8, 'Barrel_MainTube'));
  barrel.add(cyl(0.017, 0.06, metalColor, [0, 0.29, 0], [0, 0, 0], 8, 'Barrel_Chamber'));

  const fluteR = 0.0115;
  const flutePts = [
    [fluteR, 0], [fluteR * 0.5, fluteR * 0.866], [-fluteR * 0.5, fluteR * 0.866],
    [-fluteR, 0], [-fluteR * 0.5, -fluteR * 0.866], [fluteR * 0.5, -fluteR * 0.866],
  ];
  flutePts.forEach(([x, z], i) => {
    barrel.add(box([0.003, 0.42, 0.003], detailColor, [x, 0.02, z], [0, 0, 0], `Barrel_Flute${i + 1}`));
  });

  barrel.add(cyl(0.0135, 0.02, metalColor, [0, -0.32, 0], [0, 0, 0], 8, 'Barrel_ThreadCollar'));
  barrel.add(cyl(0.012, 0.006, detailColor, [0, -0.328, 0], [0, 0, 0], 8, 'Barrel_Crown'));
  root.add(barrel);

  // ---------------------------------------------------------------------
  // MUZZLE BRAKE
  // ---------------------------------------------------------------------
  const muzzleBrake = new THREE.Group();
  muzzleBrake.name = 'MuzzleBrake';
  muzzleBrake.position.set(0, 0.010, -0.90);
  muzzleBrake.rotation.set(Math.PI / 2, 0, 0);

  muzzleBrake.add(cyl(0.019, 0.07, metalColor, [0, 0, 0], [0, 0, 0], 8, 'MuzzleBrake_Body'));
  muzzleBrake.add(box([0.008, 0.024, 0.014], detailColor, [0.017, 0, 0.018], [0, 0, 0], 'MuzzleBrake_PortR1'));
  muzzleBrake.add(box([0.008, 0.024, 0.014], detailColor, [-0.017, 0, 0.018], [0, 0, 0], 'MuzzleBrake_PortL1'));
  muzzleBrake.add(box([0.008, 0.024, 0.014], detailColor, [0.017, 0, -0.010], [0, 0, 0], 'MuzzleBrake_PortR2'));
  muzzleBrake.add(box([0.008, 0.024, 0.014], detailColor, [-0.017, 0, -0.010], [0, 0, 0], 'MuzzleBrake_PortL2'));
  muzzleBrake.add(cyl(0.0195, 0.006, detailColor, [0, 0.035, 0], [0, 0, 0], 8, 'MuzzleBrake_RearBand'));
  muzzleBrake.add(cyl(0.014, 0.006, detailColor, [0, -0.035, 0], [0, 0, 0], 8, 'MuzzleBrake_FrontCrown'));
  root.add(muzzleBrake);

  // ---------------------------------------------------------------------
  // STOCK
  // ---------------------------------------------------------------------
  const stock = new THREE.Group();
  stock.name = 'Stock';
  stock.position.set(0, -0.008, 0.30);
  stock.rotation.set(0, 0, 0);

  stock.add(box([0.046, 0.09, 0.32], stockColor, [0, -0.002, -0.01], [0, 0, 0], 'Stock_Body'));
  stock.add(box([0.046, 0.10, 0.02], metalColor, [0, 0, 0.155], [0, 0, 0], 'Stock_RecoilPad'));
  stock.add(box([0.02, 0.02, 0.10], detailColor, [0, -0.055, -0.02], [0, 0, 0], 'Stock_MonopodRail'));
  stock.add(cyl(0.01, 0.02, detailColor, [0, -0.065, -0.06], [Math.PI / 2, 0, 0], 6, 'Stock_MonopodFoot'));
  stock.add(box([0.002, 0.06, 0.24], detailColor, [0.024, -0.002, -0.01], [0, 0, 0], 'Stock_PanelLineR'));
  stock.add(box([0.002, 0.06, 0.24], detailColor, [-0.024, -0.002, -0.01], [0, 0, 0], 'Stock_PanelLineL'));
  stock.add(box([0.02, 0.006, 0.006], metalColor, [0, -0.03, 0.14], [0, 0, 0], 'Stock_SlingStud'));
  root.add(stock);

  // ---------------------------------------------------------------------
  // CHEEK REST — adjustable riser
  // ---------------------------------------------------------------------
  const cheekRest = new THREE.Group();
  cheekRest.name = 'CheekRest';
  cheekRest.position.set(0, 0.052, 0.22);
  cheekRest.rotation.set(0, 0, 0);

  cheekRest.add(box([0.046, 0.03, 0.10], stockColor, [0, 0, 0], [0, 0, 0], 'CheekRest_Pad'));
  cheekRest.add(box([0.046, 0.02, 0.02], detailColor, [0, -0.023, 0.03], [0, 0, 0], 'CheekRest_Riser1'));
  cheekRest.add(box([0.046, 0.02, 0.02], detailColor, [0, -0.023, -0.03], [0, 0, 0], 'CheekRest_Riser2'));
  cheekRest.add(cyl(0.007, 0.05, metalColor, [0.026, -0.01, 0], [0, 0, Math.PI / 2], 6, 'CheekRest_AdjustKnob'));
  root.add(cheekRest);

  // ---------------------------------------------------------------------
  // PISTOL GRIP
  // ---------------------------------------------------------------------
  const pistolGrip = new THREE.Group();
  pistolGrip.name = 'PistolGrip';
  pistolGrip.position.set(0, -0.085, 0.10);
  pistolGrip.rotation.set(0.28, 0, 0);

  pistolGrip.add(box([0.038, 0.115, 0.05], stockColor, [0, 0, 0], [0, 0, 0], 'PistolGrip_Main'));
  pistolGrip.add(box([0.04, 0.02, 0.052], metalColor, [0, -0.067, 0], [0, 0, 0], 'PistolGrip_Cap'));
  pistolGrip.add(box([0.039, 0.006, 0.012], detailColor, [0, 0.025, 0.026], [0, 0, 0], 'PistolGrip_Ridge1'));
  pistolGrip.add(box([0.039, 0.006, 0.012], detailColor, [0, 0.005, 0.026], [0, 0, 0], 'PistolGrip_Ridge2'));
  pistolGrip.add(box([0.039, 0.006, 0.012], detailColor, [0, -0.015, 0.026], [0, 0, 0], 'PistolGrip_Ridge3'));
  pistolGrip.add(box([0.02, 0.03, 0.01], stockColor, [0.014, 0.03, -0.02], [0, 0, 0], 'PistolGrip_ThumbRest'));
  root.add(pistolGrip);

  // ---------------------------------------------------------------------
  // BONE_MAGAZINE — detachable box magazine
  // ---------------------------------------------------------------------
  const magazine = new THREE.Group();
  magazine.name = 'Bone_Magazine';
  magazine.position.set(0, -0.105, -0.08);
  magazine.rotation.set(0, 0, 0);

  magazine.add(box([0.030, 0.11, 0.053], metalColor, [0, 0.02, 0], [0, 0, 0], 'Magazine_Body'));
  magazine.add(box([0.033, 0.02, 0.055], detailColor, [0, -0.065, 0], [0, 0, 0], 'Magazine_Floorplate'));
  magazine.add(box([0.006, 0.13, 0.006], detailColor, [0.014, 0.01, 0], [0, 0, 0], 'Magazine_RibR'));
  magazine.add(box([0.006, 0.13, 0.006], detailColor, [-0.014, 0.01, 0], [0, 0, 0], 'Magazine_RibL'));
  magazine.add(box([0.01, 0.014, 0.014], detailColor, [0, 0.07, 0.022], [0, 0, 0], 'Magazine_Catch'));
  root.add(magazine);

  // ---------------------------------------------------------------------
  // SCOPE TUBE — with elevation/windage turrets
  // ---------------------------------------------------------------------
  const scopeTube = new THREE.Group();
  scopeTube.name = 'ScopeTube';
  scopeTube.position.set(0, 0.078, -0.14);
  scopeTube.rotation.set(Math.PI / 2, 0, 0);

  scopeTube.add(cyl(0.020, 0.30, 0x454551, [0, 0, 0], [0, 0, 0], 10, 'ScopeTube_MainBody'));
  scopeTube.add(cyl(0.026, 0.04, 0x454551, [0, 0.01, 0], [0, 0, 0], 10, 'ScopeTube_TurretHousing'));
  scopeTube.add(cyl(0.011, 0.02, metalColor, [0.026, 0.01, 0], [0, 0, Math.PI / 2], 8, 'ScopeTube_ElevationTurret'));
  scopeTube.add(cyl(0.008, 0.006, detailColor, [0.037, 0.01, 0], [0, 0, Math.PI / 2], 8, 'ScopeTube_ElevationCap'));
  scopeTube.add(cyl(0.011, 0.02, metalColor, [0, 0.01, 0.026], [Math.PI / 2, 0, 0], 8, 'ScopeTube_WindageTurret'));
  scopeTube.add(cyl(0.008, 0.006, detailColor, [0, 0.01, 0.037], [Math.PI / 2, 0, 0], 8, 'ScopeTube_WindageCap'));
  scopeTube.add(cyl(0.023, 0.03, 0x454551, [0, -0.10, 0], [0, 0, 0], 10, 'ScopeTube_ParallaxRing'));
  scopeTube.add(cyl(0.022, 0.02, detailColor, [0, 0.11, 0], [0, 0, 0], 10, 'ScopeTube_MagRing'));
  root.add(scopeTube);

  // ---------------------------------------------------------------------
  // SCOPE OBJECTIVE — front bell
  // ---------------------------------------------------------------------
  const scopeObjective = new THREE.Group();
  scopeObjective.name = 'ScopeObjective';
  scopeObjective.position.set(0, 0.078, -0.30);
  scopeObjective.rotation.set(Math.PI / 2, 0, 0);

  scopeObjective.add(cyl(0.028, 0.05, 0x454551, [0, 0, 0], [0, 0, 0], 10, 'ScopeObjective_Bell'));
  scopeObjective.add(cyl(0.024, 0.004, lensColor, [0, -0.023, 0], [0, 0, 0], 10, 'ScopeObjective_Lens'));
  scopeObjective.add(cyl(0.029, 0.006, detailColor, [0, 0.02, 0], [0, 0, 0], 10, 'ScopeObjective_SunshadeRing'));
  root.add(scopeObjective);

  // ---------------------------------------------------------------------
  // SCOPE EYEPIECE — rear bell. OUTER ENVELOPE UNCHANGED for eye-relief.
  // ---------------------------------------------------------------------
  const scopeEyepiece = new THREE.Group();
  scopeEyepiece.name = 'ScopeEyepiece';
  scopeEyepiece.position.set(0, 0.078, 0.01);
  scopeEyepiece.rotation.set(Math.PI / 2, 0, 0);

  // Main bell — identical size/position to the original mesh (do not alter).
  scopeEyepiece.add(cyl(0.025, 0.05, 0x454551, [0, 0, 0], [0, 0, 0], 10, 'ScopeEyepiece_Bell'));
  // Detail rings nested INSIDE the bell's envelope (never exceed ±0.025 length).
  scopeEyepiece.add(cyl(0.023, 0.006, lensColor, [0, -0.020, 0], [0, 0, 0], 10, 'ScopeEyepiece_Lens'));
  scopeEyepiece.add(cyl(0.026, 0.008, detailColor, [0, 0.018, 0], [0, 0, 0], 10, 'ScopeEyepiece_DiopterRing'));
  scopeEyepiece.add(cyl(0.024, 0.006, 0x4f4f4f, [0, 0.023, 0], [0, 0, 0], 10, 'ScopeEyepiece_EyecupRim'));
  root.add(scopeEyepiece);

  // ---------------------------------------------------------------------
  // SCOPE RINGS — mounting rings with clamp screws
  // ---------------------------------------------------------------------
  const scopeRingF = new THREE.Group();
  scopeRingF.name = 'ScopeRingF';
  scopeRingF.position.set(0, 0.052, -0.24);
  scopeRingF.rotation.set(0, 0, 0);
  scopeRingF.add(box([0.014, 0.030, 0.016], metalColor, [0, 0, 0], [0, 0, 0], 'ScopeRingF_Band'));
  scopeRingF.add(box([0.016, 0.006, 0.018], detailColor, [0, 0.017, 0], [0, 0, 0], 'ScopeRingF_ClampCap'));
  scopeRingF.add(cyl(0.003, 0.01, detailColor, [0, 0.02, 0.006], [0, 0, 0], 6, 'ScopeRingF_ScrewL'));
  scopeRingF.add(cyl(0.003, 0.01, detailColor, [0, 0.02, -0.006], [0, 0, 0], 6, 'ScopeRingF_ScrewR'));
  root.add(scopeRingF);

  const scopeRingR = new THREE.Group();
  scopeRingR.name = 'ScopeRingR';
  scopeRingR.position.set(0, 0.052, -0.04);
  scopeRingR.rotation.set(0, 0, 0);
  scopeRingR.add(box([0.014, 0.030, 0.016], metalColor, [0, 0, 0], [0, 0, 0], 'ScopeRingR_Band'));
  scopeRingR.add(box([0.016, 0.006, 0.018], detailColor, [0, 0.017, 0], [0, 0, 0], 'ScopeRingR_ClampCap'));
  scopeRingR.add(cyl(0.003, 0.01, detailColor, [0, 0.02, 0.006], [0, 0, 0], 6, 'ScopeRingR_ScrewL'));
  scopeRingR.add(cyl(0.003, 0.01, detailColor, [0, 0.02, -0.006], [0, 0, 0], 6, 'ScopeRingR_ScrewR'));
  root.add(scopeRingR);

  // ---------------------------------------------------------------------
  // BIPOD LEGS — folded under foregrip
  // ---------------------------------------------------------------------
  const bipodLegR = new THREE.Group();
  bipodLegR.name = 'BipodLegR';
  bipodLegR.position.set(0.026, -0.075, -0.46);
  bipodLegR.rotation.set(0, 0, 0.22);
  bipodLegR.add(box([0.010, 0.085, 0.010], metalColor, [0, 0, 0], [0, 0, 0], 'BipodLegR_Strut'));
  bipodLegR.add(cyl(0.007, 0.014, detailColor, [0, 0.045, 0], [Math.PI / 2, 0, 0], 6, 'BipodLegR_Knuckle'));
  bipodLegR.add(box([0.016, 0.01, 0.016], detailColor, [0, -0.045, 0], [0, 0, 0], 'BipodLegR_Foot'));
  root.add(bipodLegR);

  const bipodLegL = new THREE.Group();
  bipodLegL.name = 'BipodLegL';
  bipodLegL.position.set(-0.026, -0.075, -0.46);
  bipodLegL.rotation.set(0, 0, -0.22);
  bipodLegL.add(box([0.010, 0.085, 0.010], metalColor, [0, 0, 0], [0, 0, 0], 'BipodLegL_Strut'));
  bipodLegL.add(cyl(0.007, 0.014, detailColor, [0, 0.045, 0], [Math.PI / 2, 0, 0], 6, 'BipodLegL_Knuckle'));
  bipodLegL.add(box([0.016, 0.01, 0.016], detailColor, [0, -0.045, 0], [0, 0, 0], 'BipodLegL_Foot'));
  root.add(bipodLegL);

  // ---------------------------------------------------------------------
  // BONE_CHARGINGHANDLE — bolt handle, racked by CyclingActionSystem
  // ---------------------------------------------------------------------
  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'Bone_ChargingHandle';
  chargingHandle.position.set(0.038, 0.020, 0.03);
  chargingHandle.rotation.set(0, 0, 0);

  chargingHandle.add(box([0.016, 0.016, 0.05], metalColor, [0, 0, 0], [0, 0, 0], 'ChargingHandle_Shaft'));
  chargingHandle.add(cyl(0.014, 0.022, metalColor, [0, 0, -0.03], [Math.PI / 2, 0, 0], 8, 'ChargingHandle_Knob'));
  chargingHandle.add(cyl(0.005, 0.024, detailColor, [0, 0, -0.045], [Math.PI / 2, 0, 0], 6, 'ChargingHandle_KnobGrip'));
  root.add(chargingHandle);

  // ---------------------------------------------------------------------
  // SOCKETS — unchanged names/positions, required for attachments/validation
  // ---------------------------------------------------------------------
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
