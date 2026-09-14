/**
 * PistolBuilder.js — detailed low-poly service pistol (Document A §4.2: short
 * slide + barrel + grip, no stock/foregrip; Socket_GripSecondary at a
 * wrist-support point; gripStyle 'oneHanded' in its profile).
 *
 * NOTE: All gameplay-critical object names and socket names/positions match
 * the original simplified version exactly. Each named part is now a
 * THREE.Group at the same local transform as the old single mesh, containing
 * sub-meshes for visual detail. getObjectByName('Bone_Magazine') /
 * ('Bone_ChargingHandle') / etc. still resolves to an Object3D at the correct
 * transform, so animation (slide racking, mag release, reload) and socket
 * attachment continue to work unchanged.
 */
import * as THREE from 'three';
import { box, cyl, socket, validateSockets } from './WeaponBuilderKit.js';

export function buildPistolPattern() {
  const root = new THREE.Group();
  root.name = 'Root_Weapon';

  const slideColor  = 0x55555e;
  const frameColor  = 0x5b5d55;
  const metalColor  = 0x505050;
  const detailColor = 0x484848; // dark accents: sights, texture, small hardware

  // ---------------------------------------------------------------------
  // SLIDE — group replaces the single box, keeps name/transform
  // ---------------------------------------------------------------------
  const slide = new THREE.Group();
  slide.name = 'Slide';
  slide.position.set(0, 0.045, -0.02);
  slide.rotation.set(0, 0, 0);

  slide.add(box([0.032, 0.048, 0.20], slideColor, [0, 0, 0], [0, 0, 0], 'Slide_Body'));
  slide.add(box([0.006, 0.006, 0.006], detailColor, [0, 0.027, -0.095], [0, 0, 0], 'Slide_FrontSight'));
  slide.add(box([0.01, 0.008, 0.012], detailColor, [0, 0.027, 0.09], [0, 0, 0], 'Slide_RearSight'));
  slide.add(box([0.004, 0.003, 0.014], slideColor, [0, 0.032, 0.09], [0, 0, 0], 'Slide_RearSightNotch'));
  slide.add(box([0.024, 0.022, 0.05], metalColor, [0.006, 0.005, 0.02], [0, 0, 0], 'Slide_EjectionPort'));
  slide.add(box([0.034, 0.046, 0.004], detailColor, [0, 0, 0.062], [0, 0, 0], 'Slide_Serration1'));
  slide.add(box([0.034, 0.046, 0.004], detailColor, [0, 0, 0.070], [0, 0, 0], 'Slide_Serration2'));
  slide.add(box([0.034, 0.046, 0.004], detailColor, [0, 0, 0.078], [0, 0, 0], 'Slide_Serration3'));
  slide.add(box([0.034, 0.046, 0.004], detailColor, [0, 0, 0.086], [0, 0, 0], 'Slide_Serration4'));
  slide.add(box([0.034, 0.046, 0.004], detailColor, [0, 0, -0.062], [0, 0, 0], 'Slide_FrontSerration1'));
  slide.add(box([0.034, 0.046, 0.004], detailColor, [0, 0, -0.070], [0, 0, 0], 'Slide_FrontSerration2'));
  slide.add(cyl(0.011, 0.004, metalColor, [0, 0, -0.098], [Math.PI / 2, 0, 0], 8, 'Slide_MuzzleCrown'));
  slide.add(box([0.006, 0.008, 0.01], detailColor, [0.017, 0, 0.07], [0, 0, 0], 'Slide_ExtractorBump'));
  root.add(slide);

  // ---------------------------------------------------------------------
  // BARREL — group replaces the single cylinder, keeps name/transform.
  // (local Z used for along-barrel placement, consistent with rifle pattern)
  // ---------------------------------------------------------------------
  const barrel = new THREE.Group();
  barrel.name = 'Barrel';
  barrel.position.set(0, 0.045, -0.14);
  barrel.rotation.set(Math.PI / 2, 0, 0);

  barrel.add(cyl(0.010, 0.06, metalColor, [0, 0, 0], [0, 0, 0], 8, 'Barrel_MainTube'));
  barrel.add(box([0.022, 0.018, 0.012], metalColor, [0, 0.006, 0.024], [0, 0, 0], 'Barrel_Hood'));
  barrel.add(box([0.014, 0.01, 0.01], detailColor, [0, -0.004, 0.026], [0, 0, 0], 'Barrel_FeedRamp'));
  barrel.add(cyl(0.011, 0.006, metalColor, [0, 0, -0.03], [0, 0, 0], 8, 'Barrel_Bushing'));
  barrel.add(cyl(0.0085, 0.004, detailColor, [0, 0, -0.033], [0, 0, 0], 8, 'Barrel_Crown'));
  root.add(barrel);

  // ---------------------------------------------------------------------
  // FRAME — group replaces the single box, keeps name/transform
  // ---------------------------------------------------------------------
  const frame = new THREE.Group();
  frame.name = 'Frame';
  frame.position.set(0, 0.005, 0.0);
  frame.rotation.set(0, 0, 0);

  frame.add(box([0.030, 0.045, 0.16], frameColor, [0, 0, 0], [0, 0, 0], 'Frame_Body'));
  frame.add(box([0.026, 0.006, 0.02], metalColor, [0, -0.026, 0.03], [0, 0, 0], 'Frame_TriggerGuardFront'));
  frame.add(box([0.026, 0.006, 0.02], metalColor, [0, -0.026, 0.06], [0, 0, 0], 'Frame_TriggerGuardBack'));
  frame.add(box([0.004, 0.02, 0.05], metalColor, [-0.013, -0.02, 0.045], [0, 0, 0], 'Frame_TriggerGuardL'));
  frame.add(box([0.004, 0.02, 0.05], metalColor, [0.013, -0.02, 0.045], [0, 0, 0], 'Frame_TriggerGuardR'));
  frame.add(box([0.006, 0.02, 0.006], detailColor, [0, -0.01, 0.045], [0, 0, 0], 'Frame_Trigger'));
  frame.add(box([0.003, 0.006, 0.15], metalColor, [-0.015, 0.023, 0], [0, 0, 0], 'Frame_SlideRailL'));
  frame.add(box([0.003, 0.006, 0.15], metalColor, [0.015, 0.023, 0], [0, 0, 0], 'Frame_SlideRailR'));
  frame.add(box([0.026, 0.005, 0.04], detailColor, [0, -0.024, -0.05], [0, 0, 0], 'Frame_AccessoryRail'));
  frame.add(cyl(0.004, 0.012, detailColor, [0.017, 0.01, 0.02], [0, 0, Math.PI / 2], 6, 'Frame_TakedownLever'));
  frame.add(box([0.006, 0.006, 0.015], detailColor, [0.016, 0.018, 0.01], [0, 0, 0], 'Frame_SlideStop'));
  root.add(frame);

  // ---------------------------------------------------------------------
  // PISTOL GRIP
  // ---------------------------------------------------------------------
  const pistolGrip = new THREE.Group();
  pistolGrip.name = 'PistolGrip';
  pistolGrip.position.set(0, -0.06, 0.055);
  pistolGrip.rotation.set(0.25, 0, 0);

  pistolGrip.add(box([0.034, 0.11, 0.05], frameColor, [0, 0, 0], [0, 0, 0], 'Grip_Core'));
  pistolGrip.add(box([0.034, 0.11, 0.014], frameColor, [0, 0, 0.018], [0, 0, 0], 'Grip_Backstrap'));
  pistolGrip.add(box([0.006, 0.09, 0.04], detailColor, [-0.017, 0, -0.003], [0, 0, 0], 'Grip_PanelL'));
  pistolGrip.add(box([0.006, 0.09, 0.04], detailColor, [0.017, 0, -0.003], [0, 0, 0], 'Grip_PanelR'));
  pistolGrip.add(box([0.03, 0.004, 0.03], frameColor, [0, 0.03, -0.003], [0, 0, 0], 'Grip_Texture1'));
  pistolGrip.add(box([0.03, 0.004, 0.03], frameColor, [0, 0.01, -0.003], [0, 0, 0], 'Grip_Texture2'));
  pistolGrip.add(box([0.03, 0.004, 0.03], frameColor, [0, -0.01, -0.003], [0, 0, 0], 'Grip_Texture3'));
  pistolGrip.add(box([0.03, 0.004, 0.03], frameColor, [0, -0.03, -0.003], [0, 0, 0], 'Grip_Texture4'));
  pistolGrip.add(cyl(0.004, 0.01, detailColor, [0.018, 0.02, 0.005], [0, 0, Math.PI / 2], 6, 'Grip_MagRelease'));
  pistolGrip.add(box([0.036, 0.01, 0.05], metalColor, [0, -0.055, 0], [0, 0, 0], 'Grip_BaseCap'));
  root.add(pistolGrip);

  // ---------------------------------------------------------------------
  // BONE_MAGAZINE — group replaces single box, SAME name/position/rotation
  // ---------------------------------------------------------------------
  const magazine = new THREE.Group();
  magazine.name = 'Bone_Magazine';
  magazine.position.set(0, -0.075, 0.052);
  magazine.rotation.set(0.25, 0, 0);

  magazine.add(box([0.023, 0.07, 0.035], metalColor, [0, 0.01, 0], [0, 0, 0], 'Magazine_Body'));
  magazine.add(box([0.026, 0.014, 0.038], detailColor, [0, -0.038, 0], [0, 0, 0], 'Magazine_Base'));
  magazine.add(box([0.006, 0.006, 0.006], detailColor, [0.013, 0.04, 0], [0, 0, 0], 'Magazine_FollowerButton'));
  magazine.add(box([0.002, 0.004, 0.004], detailColor, [0.012, 0.02, 0.01], [0, 0, 0], 'Magazine_WitnessHole1'));
  magazine.add(box([0.002, 0.004, 0.004], detailColor, [0.012, 0.005, 0.01], [0, 0, 0], 'Magazine_WitnessHole2'));
  magazine.add(box([0.002, 0.004, 0.004], detailColor, [0.012, -0.01, 0.01], [0, 0, 0], 'Magazine_WitnessHole3'));
  root.add(magazine);

  // ---------------------------------------------------------------------
  // BONE_CHARGINGHANDLE — group replaces single box, SAME name/transform.
  // (serrated slide-grasping reference point / slide-stop lever bone)
  // ---------------------------------------------------------------------
  const chargingHandle = new THREE.Group();
  chargingHandle.name = 'Bone_ChargingHandle';
  chargingHandle.position.set(0.022, 0.06, 0.02);
  chargingHandle.rotation.set(0, 0, 0);

  chargingHandle.add(box([0.012, 0.012, 0.024], metalColor, [0, 0, 0], [0, 0, 0], 'ChargingHandle_Base'));
  chargingHandle.add(box([0.013, 0.013, 0.003], detailColor, [0, 0, -0.008], [0, 0, 0], 'ChargingHandle_Grip1'));
  chargingHandle.add(box([0.013, 0.013, 0.003], detailColor, [0, 0, 0], [0, 0, 0], 'ChargingHandle_Grip2'));
  chargingHandle.add(box([0.013, 0.013, 0.003], detailColor, [0, 0, 0.008], [0, 0, 0], 'ChargingHandle_Grip3'));
  root.add(chargingHandle);

  // ---------------------------------------------------------------------
  // SOCKETS — unchanged names/positions, required for attachments/validation
  // ---------------------------------------------------------------------
  root.add(socket('Socket_Grip', [0, -0.075, 0.06]));
  root.add(socket('Socket_GripSecondary', [-0.05, -0.05, 0.04])); // wrist support
  root.add(socket('Socket_Muzzle', [0, 0.045, -0.18]));
  root.add(socket('Socket_Magazine', [0, -0.075, 0.052]));
  root.add(socket('Socket_Ejection', [0.03, 0.06, -0.02]));
  root.add(socket('Socket_Optic', [0, 0.085, -0.02]));

  validateSockets(root);
  return root;
}
