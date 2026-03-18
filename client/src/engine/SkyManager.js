/**
 * Sky Manager for VoxelChain.
 * Adds sun/moon meshes and animated cloud layer to the scene.
 */

import * as THREE from "three";

export class SkyManager {
  constructor(scene) {
    this.scene = scene;
    this.sunMesh = null;
    this.moonMesh = null;
    this.cloudGroup = null;
    this.starField = null;
    this._time = 0;

    this._createSun();
    this._createMoon();
    this._createStars();
    this._createClouds();
  }

  _createSun() {
    const geo = new THREE.SphereGeometry(8, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffee88,
      fog: false,
    });
    this.sunMesh = new THREE.Mesh(geo, mat);
    this.sunMesh.position.set(200, 150, 100);

    // Sun glow (sprite)
    const glowCanvas = document.createElement("canvas");
    glowCanvas.width = 64;
    glowCanvas.height = 64;
    const ctx = glowCanvas.getContext("2d");
    const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, "rgba(255,238,136,0.8)");
    gradient.addColorStop(0.3, "rgba(255,200,80,0.3)");
    gradient.addColorStop(1, "rgba(255,200,80,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 64, 64);

    const glowTex = new THREE.CanvasTexture(glowCanvas);
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex,
      blending: THREE.AdditiveBlending,
      fog: false,
      transparent: true,
    });
    const glow = new THREE.Sprite(glowMat);
    glow.scale.set(40, 40, 1);
    this.sunMesh.add(glow);

    this.scene.add(this.sunMesh);
  }

  _createMoon() {
    const geo = new THREE.SphereGeometry(5, 16, 16);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xddddee,
      fog: false,
    });
    this.moonMesh = new THREE.Mesh(geo, mat);
    this.moonMesh.position.set(-200, -100, -100);
    this.scene.add(this.moonMesh);
  }

  _createStars() {
    const count = 300;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Random positions on a large sphere
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const r = 350 + Math.random() * 30;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.5,
      fog: false,
      transparent: true,
      opacity: 0.15,
    });
    this.starField = new THREE.Points(geo, mat);
    this.scene.add(this.starField);
  }

  _createClouds() {
    this.cloudGroup = new THREE.Group();
    this.cloudGroup.position.y = 100;

    const cloudMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.6,
      fog: false,
      side: THREE.DoubleSide,
    });

    // Generate several cloud patches
    for (let i = 0; i < 20; i++) {
      const cloudPatch = new THREE.Group();
      const cx = (Math.random() - 0.5) * 400;
      const cz = (Math.random() - 0.5) * 400;
      const cy = (Math.random() - 0.5) * 10;
      cloudPatch.position.set(cx, cy, cz);

      // Each cloud patch = 3-6 overlapping flat boxes
      const puffCount = 3 + Math.floor(Math.random() * 4);
      for (let j = 0; j < puffCount; j++) {
        const w = 8 + Math.random() * 15;
        const h = 1.5 + Math.random() * 2;
        const d = 6 + Math.random() * 10;
        const geo = new THREE.BoxGeometry(w, h, d);
        const puff = new THREE.Mesh(geo, cloudMat);
        puff.position.set(
          (Math.random() - 0.5) * 10,
          (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 8
        );
        cloudPatch.add(puff);
      }

      this.cloudGroup.add(cloudPatch);
    }

    this.scene.add(this.cloudGroup);
  }

  /** Update sky elements each frame */
  update(dt) {
    this._time += dt;

    // Slowly drift clouds
    if (this.cloudGroup) {
      this.cloudGroup.position.x = Math.sin(this._time * 0.01) * 20;
      this.cloudGroup.position.z = Math.cos(this._time * 0.008) * 15;
    }

    // Subtle star twinkle
    if (this.starField) {
      this.starField.material.opacity = 0.12 + Math.sin(this._time * 0.5) * 0.03;
    }
  }

  dispose() {
    if (this.sunMesh) {
      this.sunMesh.geometry.dispose();
      this.sunMesh.material.dispose();
      this.scene.remove(this.sunMesh);
    }
    if (this.moonMesh) {
      this.moonMesh.geometry.dispose();
      this.moonMesh.material.dispose();
      this.scene.remove(this.moonMesh);
    }
    if (this.starField) {
      this.starField.geometry.dispose();
      this.starField.material.dispose();
      this.scene.remove(this.starField);
    }
    if (this.cloudGroup) {
      this.scene.remove(this.cloudGroup);
    }
  }
}
