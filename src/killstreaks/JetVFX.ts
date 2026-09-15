/**
 * JetVFX.ts — Document M §4 (adapted to this repo's VFX inventory).
 *
 * The document reuses a generic muzzle-flash pool + smoke-trail factory.
 * THIS repo's MuzzleFlashEffect is hard-bound to the weapon viewmodel's
 * layer-1 pass, and no smoke-trail factory exists — so the jet owns two
 * additive world-layer flame sprites on its afterburner sockets, flickering
 * per engine. Contrails are deliberately skipped (the sequence reads clean
 * without them, and there is no pooled trail infrastructure to reuse; adding
 * one here would duplicate systems).
 */
import * as THREE from 'three';
import type { AssetLoader } from '../core/AssetLoader';
import { LAYER } from '../core/RenderLayers';

const _pos = new THREE.Vector3();

export class JetVFX {
  private readonly flames: THREE.Sprite[] = [];
  private readonly sockets: (THREE.Object3D | null)[] = [];
  private time = 0;

  constructor(jetModel: THREE.Object3D, assetLoader: AssetLoader) {
    this.sockets = [
      jetModel.getObjectByName('Socket_Afterburner_L') ?? null,
      jetModel.getObjectByName('Socket_Afterburner_R') ?? null,
    ];
    void assetLoader.loadTexture('effects/muzzle_flash.png').then((tex) => {
      for (const socket of this.sockets) {
        if (!socket) continue;
        const material = new THREE.SpriteMaterial({
          map: tex,
          blending: THREE.AdditiveBlending,
          transparent: true,
          depthWrite: false,
          color: 0x4aa3ff, // blue-white jet exhaust tint
        });
        const sprite = new THREE.Sprite(material);
        sprite.scale.setScalar(2.2);
        sprite.layers.set(LAYER.WORLD);
        socket.add(sprite);
        this.flames.push(sprite);
      }
    });
  }

  update(dt: number): void {
    this.time += dt;
    const flicker = 0.85 + Math.sin(this.time * 31) * 0.12 + Math.sin(this.time * 73) * 0.05;
    for (const flame of this.flames) {
      flame.scale.setScalar(2.2 * flicker);
    }
  }

  /** World positions of the nozzles (sound emitters track the jet). */
  nozzleWorldPositions(out: THREE.Vector3[] = []): THREE.Vector3[] {
    out.length = 0;
    for (const socket of this.sockets) {
      if (socket) out.push(socket.getWorldPosition(_pos.clone()));
    }
    return out;
  }

  dispose(): void {
    for (const flame of this.flames) {
      flame.parent?.remove(flame);
      flame.material.dispose();
    }
    this.flames.length = 0;
  }
}

export default JetVFX;
