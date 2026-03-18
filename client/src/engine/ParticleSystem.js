/**
 * Particle system for VoxelChain.
 * Creates block-break particle effects using instanced meshes.
 */

import * as THREE from "three";
import { registry } from "./BlockRegistry.js";

const MAX_PARTICLES = 200;
const PARTICLE_LIFETIME = 0.8; // seconds
const PARTICLE_SIZE = 0.12;
const GRAVITY = -15;
const SPREAD = 3;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
    this._dummy = new THREE.Object3D();

    // Single instanced mesh for all particles
    const geo = new THREE.BoxGeometry(PARTICLE_SIZE, PARTICLE_SIZE, PARTICLE_SIZE);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this._instancedMesh = new THREE.InstancedMesh(geo, mat, MAX_PARTICLES);
    this._instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._instancedMesh.count = 0;
    this._instancedMesh.frustumCulled = false;
    this.scene.add(this._instancedMesh);

    // Color buffer
    this._colors = new Float32Array(MAX_PARTICLES * 3);
    this._instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(this._colors, 3);
    this._instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  }

  /** Spawn block-break particles at position */
  spawnBlockBreak(x, y, z, blockType) {
    const color = registry.getColor(blockType);
    if (color === null) return;

    const baseColor = new THREE.Color(color);
    const count = 6 + Math.floor(Math.random() * 4);

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        // Remove oldest
        this.particles.shift();
      }

      // Vary color slightly per particle
      const c = baseColor.clone();
      c.offsetHSL(0, 0, (Math.random() - 0.5) * 0.15);

      this.particles.push({
        x: x + 0.5 + (Math.random() - 0.5) * 0.6,
        y: y + 0.5 + (Math.random() - 0.5) * 0.6,
        z: z + 0.5 + (Math.random() - 0.5) * 0.6,
        vx: (Math.random() - 0.5) * SPREAD,
        vy: Math.random() * SPREAD * 0.8 + 1,
        vz: (Math.random() - 0.5) * SPREAD,
        life: PARTICLE_LIFETIME,
        maxLife: PARTICLE_LIFETIME,
        r: c.r,
        g: c.g,
        b: c.b,
        scale: 0.8 + Math.random() * 0.4,
      });
    }
  }

  /** Spawn block-place particles (smaller, upward) */
  spawnBlockPlace(x, y, z, blockType) {
    const color = registry.getColor(blockType);
    if (color === null) return;

    const baseColor = new THREE.Color(color);
    const count = 3;

    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) {
        this.particles.shift();
      }

      const c = baseColor.clone();
      c.offsetHSL(0, 0, 0.1);

      this.particles.push({
        x: x + 0.5 + (Math.random() - 0.5) * 0.4,
        y: y + (Math.random() * 0.3),
        z: z + 0.5 + (Math.random() - 0.5) * 0.4,
        vx: (Math.random() - 0.5) * 1,
        vy: Math.random() * 2 + 0.5,
        vz: (Math.random() - 0.5) * 1,
        life: 0.5,
        maxLife: 0.5,
        r: c.r,
        g: c.g,
        b: c.b,
        scale: 0.5 + Math.random() * 0.3,
      });
    }
  }

  /** Update all particles (call each frame) */
  update(dt) {
    let alive = 0;

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // Physics
      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      // Friction
      p.vx *= 0.98;
      p.vz *= 0.98;

      // Scale down as particle dies
      const lifeRatio = p.life / p.maxLife;
      const s = PARTICLE_SIZE * p.scale * lifeRatio;

      this._dummy.position.set(p.x, p.y, p.z);
      this._dummy.scale.set(s / PARTICLE_SIZE, s / PARTICLE_SIZE, s / PARTICLE_SIZE);
      this._dummy.rotation.set(
        p.life * 5 + i,
        p.life * 3 + i * 0.7,
        0
      );
      this._dummy.updateMatrix();
      this._instancedMesh.setMatrixAt(alive, this._dummy.matrix);

      // Color
      this._colors[alive * 3] = p.r;
      this._colors[alive * 3 + 1] = p.g;
      this._colors[alive * 3 + 2] = p.b;

      alive++;
    }

    this._instancedMesh.count = alive;
    if (alive > 0) {
      this._instancedMesh.instanceMatrix.needsUpdate = true;
      this._instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  dispose() {
    this._instancedMesh.geometry.dispose();
    this._instancedMesh.material.dispose();
    this.scene.remove(this._instancedMesh);
  }
}
