/**
 * TrainingDummy.ts — TEMPORARY Document 3 validation target (deleted or
 * replaced in Document 4/5; AI enemies will implement the SAME takeDamage
 * contract against BallisticsSystem.registerHittable).
 * Torso + head mesh group with a health pool: on hit, an emissive red flash
 * decays over DUMMY.FLASH_DECAY_PER_SECOND; at zero health it logs a TEMP
 * line, hides, and respawns after DUMMY.RESPAWN_SECONDS with full health.
 * Deliberately NOT a movement collider — it is a hit target only, so Doc-2
 * locomotion validation lanes stay unaffected.
 */
import * as THREE from 'three';
import ballistics from '../weapons/BallisticsSystem';
import { DUMMY } from '../utils/Constants';

export class TrainingDummy extends THREE.Group {
  health: number = DUMMY.HEALTH;
  private readonly materials: THREE.MeshStandardMaterial[] = [];
  private flash = 0;
  private respawnTimer = 0;
  private dead = false;

  constructor(
    public readonly label: string,
    position: THREE.Vector3,
    faceTowards: THREE.Vector3,
  ) {
    super();
    this.position.copy(position);

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xb04040, roughness: 0.7 });
    const headMat = new THREE.MeshStandardMaterial({ color: 0xd8a090, roughness: 0.6 });
    this.materials.push(bodyMat, headMat);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.15, 0.32), bodyMat);
    torso.position.y = 0.575 + DUMMY.LEG_HEIGHT;
    torso.castShadow = true;
    this.add(torso);

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.45, DUMMY.LEG_HEIGHT, 0.28), bodyMat);
    legs.position.y = DUMMY.LEG_HEIGHT / 2;
    legs.castShadow = true;
    this.add(legs);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), headMat);
    head.position.y = DUMMY.LEG_HEIGHT + 1.15 + 0.2;
    head.castShadow = true;
    this.add(head);

    this.lookAt(faceTowards.x, this.position.y, faceTowards.z);

    // Generic hittable registration — the exact path future AI will use.
    ballistics.registerHittable(this, {
      surfaceType: 'dummy',
      takeDamage: (amount) => this.takeDamage(amount),
    });
  }

  takeDamage(amount: number): void {
    if (this.dead) return;
    this.health -= amount;
    this.flash = 1;
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.respawnTimer = DUMMY.RESPAWN_SECONDS;
      this.visible = false;
      // TEMP: Document 3 §15 validation logging (removed with the arena).
      console.info(`[TEMP][dummy] ${this.label} killed — respawning in ${DUMMY.RESPAWN_SECONDS}s`);
    } else {
      console.info(`[TEMP][dummy] ${this.label} hit for ${amount.toFixed(1)} (${this.health.toFixed(1)} HP left)`);
    }
  }

  update(dt: number): void {
    if (this.dead) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) {
        this.dead = false;
        this.health = DUMMY.HEALTH;
        this.flash = 0;
        this.visible = true;
        console.info(`[TEMP][dummy] ${this.label} respawned`);
      }
      return;
    }
    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * DUMMY.FLASH_DECAY_PER_SECOND);
      for (const material of this.materials) {
        material.emissive.setHex(0xff2200);
        material.emissiveIntensity = this.flash * 1.5;
      }
    }
  }
}

export default TrainingDummy;
