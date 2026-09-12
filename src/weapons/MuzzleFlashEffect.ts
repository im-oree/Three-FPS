/**
 * MuzzleFlashEffect.ts — pooled additive flash quads (Document 3 §12).
 * POOL_SIZE sprites are allocated once; trigger() re-parents an inactive one
 * to the weapon's muzzle socket (so it tracks the animated gun exactly and
 * renders in the viewmodel pass), with randomized roll/scale per shot.
 * Listens to `weapon:fired`; never allocates at fire time.
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import eventBus from '../core/EventBus';
import { EFFECTS } from '../utils/Constants';
import type { WeaponViewmodel } from './WeaponViewmodel';

interface FlashInstance {
  sprite: THREE.Sprite;
  life: number;
  active: boolean;
}

export class MuzzleFlashEffect {
  private readonly pool: FlashInstance[] = [];
  private texture: THREE.Texture | null = null;

  constructor(assetLoader: AssetLoader, private readonly viewmodel: WeaponViewmodel) {
    assetLoader.loadTexture('effects/muzzle_flash.png').then((tex) => {
      this.texture = tex;
      for (let i = 0; i < EFFECTS.POOL_SIZE; i += 1) {
        const material = new THREE.SpriteMaterial({
          map: tex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthTest: true,
        });
        const sprite = new THREE.Sprite(material);
        sprite.visible = false;
        this.pool.push({ sprite, life: 0, active: false });
      }
    });
    eventBus.on('weapon:fired', () => this.trigger());
  }

  trigger(): void {
    const socket = this.viewmodel.getMuzzleSocket();
    if (!socket || !this.texture) return;
    const instance = this.pool.find((p) => !p.active);
    if (!instance) return; // pool exhausted: drop the flash, never allocate
    instance.active = true;
    instance.life = EFFECTS.MUZZLE_LIFETIME_SECONDS;
    const scale =
      EFFECTS.MUZZLE_SCALE_MIN + Math.random() * (EFFECTS.MUZZLE_SCALE_MAX - EFFECTS.MUZZLE_SCALE_MIN);
    instance.sprite.scale.setScalar(EFFECTS.MUZZLE_BASE_SCALE * scale);
    instance.sprite.material.rotation = Math.random() * Math.PI * 2;
    instance.sprite.material.opacity = 1;
    instance.sprite.position.set(0, 0, -EFFECTS.MUZZLE_SOCKET_INSET);
    instance.sprite.visible = true;
    socket.add(instance.sprite);
  }

  update(dt: number): void {
    for (const instance of this.pool) {
      if (!instance.active) continue;
      instance.life -= dt;
      instance.sprite.material.opacity = Math.max(0, instance.life / EFFECTS.MUZZLE_LIFETIME_SECONDS);
      if (instance.life <= 0) {
        instance.active = false;
        instance.sprite.visible = false;
        instance.sprite.parent?.remove(instance.sprite);
      }
    }
  }
}

export default MuzzleFlashEffect;
