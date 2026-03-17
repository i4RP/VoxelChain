/**
 * Chunk class for VoxelChain.
 * Represents a 16x16x16 volume of voxels with optimized mesh generation.
 */

import * as THREE from "three";
import { registry } from "./BlockRegistry.js";

export const CHUNK_SIZE = 16;

export class Chunk {
  constructor(cx, cy, cz) {
    this.cx = cx;
    this.cy = cy;
    this.cz = cz;
    this.blocks = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE);
    this.mesh = null;
    this.transparentMesh = null;
    this.dirty = true;
    this.merkleRoot = "";
    this.owner = "";
    this.loaded = false;
  }

  /** Convert local coords to array index */
  _index(x, y, z) {
    return (z * CHUNK_SIZE * CHUNK_SIZE + y * CHUNK_SIZE + x);
  }

  /** Get block at local position */
  getBlock(x, y, z) {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
      return 0;
    }
    return this.blocks[this._index(x, y, z)];
  }

  /** Set block at local position */
  setBlock(x, y, z, type) {
    if (x < 0 || x >= CHUNK_SIZE || y < 0 || y >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) {
      return;
    }
    this.blocks[this._index(x, y, z)] = type;
    this.dirty = true;
  }

  /** Load chunk data from server response */
  loadFromData(data) {
    // Reset all blocks to air
    this.blocks.fill(0);
    if (data.blocks) {
      for (const b of data.blocks) {
        this.setBlock(b.x, b.y, b.z, b.type);
      }
    }
    this.merkleRoot = data.merkleRoot || "";
    this.owner = data.owner || "";
    this.loaded = true;
    this.dirty = true;
  }

  /** Build mesh using greedy meshing for performance */
  buildMesh(getNeighborBlock) {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      if (this.transparentMesh.parent) this.transparentMesh.parent.remove(this.transparentMesh);
    }

    const positions = [];
    const normals = [];
    const colors = [];
    const indices = [];
    const tPositions = [];
    const tNormals = [];
    const tColors = [];
    const tIndices = [];

    let vertexCount = 0;
    let tVertexCount = 0;

    const worldX = this.cx * CHUNK_SIZE;
    const worldY = this.cy * CHUNK_SIZE;
    const worldZ = this.cz * CHUNK_SIZE;

    // Face definitions: [dx, dy, dz, vertices, normal]
    const faces = [
      { dir: [0, 1, 0], vertices: [[0,1,0],[1,1,0],[1,1,1],[0,1,1]], normal: [0,1,0], face: "top" },
      { dir: [0, -1, 0], vertices: [[0,0,1],[1,0,1],[1,0,0],[0,0,0]], normal: [0,-1,0], face: "bottom" },
      { dir: [1, 0, 0], vertices: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]], normal: [1,0,0], face: "side" },
      { dir: [-1, 0, 0], vertices: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]], normal: [-1,0,0], face: "side" },
      { dir: [0, 0, 1], vertices: [[0,0,1],[1,0,1],[1,1,1],[0,1,1]], normal: [0,0,1], face: "side" },
      { dir: [0, 0, -1], vertices: [[1,0,0],[0,0,0],[0,1,0],[1,1,0]], normal: [0,0,-1], face: "side" },
    ];

    for (let z = 0; z < CHUNK_SIZE; z++) {
      for (let y = 0; y < CHUNK_SIZE; y++) {
        for (let x = 0; x < CHUNK_SIZE; x++) {
          const blockType = this.getBlock(x, y, z);
          if (blockType === 0) continue;

          const blockDef = registry.get(blockType);
          const isTransparent = blockDef.transparent;

          for (const face of faces) {
            const nx = x + face.dir[0];
            const ny = y + face.dir[1];
            const nz = z + face.dir[2];

            let neighborType;
            if (nx < 0 || nx >= CHUNK_SIZE || ny < 0 || ny >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
              neighborType = getNeighborBlock
                ? getNeighborBlock(worldX + nx, worldY + ny, worldZ + nz)
                : 0;
            } else {
              neighborType = this.getBlock(nx, ny, nz);
            }

            // Skip face if neighbor is opaque (or same transparent type)
            const neighborDef = registry.get(neighborType);
            if (neighborType !== 0 && !neighborDef.transparent) continue;
            if (isTransparent && neighborType === blockType) continue;

            // Choose color based on face direction
            let color;
            if (face.face === "top") {
              color = new THREE.Color(registry.getTopColor(blockType));
            } else if (face.face === "bottom") {
              color = new THREE.Color(registry.getBottomColor(blockType));
            } else {
              color = new THREE.Color(registry.getSideColor(blockType));
            }

            // Add ambient occlusion darkening
            const ao = face.dir[1] === -1 ? 0.7 : face.dir[1] === 0 ? 0.85 : 1.0;
            color.multiplyScalar(ao);

            const targetPos = isTransparent ? tPositions : positions;
            const targetNorm = isTransparent ? tNormals : normals;
            const targetCol = isTransparent ? tColors : colors;
            const targetIdx = isTransparent ? tIndices : indices;
            const vc = isTransparent ? tVertexCount : vertexCount;

            for (const v of face.vertices) {
              targetPos.push(x + v[0], y + v[1], z + v[2]);
              targetNorm.push(face.normal[0], face.normal[1], face.normal[2]);
              targetCol.push(color.r, color.g, color.b);
            }

            targetIdx.push(vc, vc + 1, vc + 2, vc, vc + 2, vc + 3);

            if (isTransparent) {
              tVertexCount += 4;
            } else {
              vertexCount += 4;
            }
          }
        }
      }
    }

    // Build opaque mesh
    if (positions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.setIndex(indices);

      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      this.mesh = new THREE.Mesh(geometry, material);
      this.mesh.position.set(worldX, worldY, worldZ);
      this.mesh.castShadow = true;
      this.mesh.receiveShadow = true;
    }

    // Build transparent mesh
    if (tPositions.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(tPositions, 3));
      geometry.setAttribute("normal", new THREE.Float32BufferAttribute(tNormals, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(tColors, 3));
      geometry.setIndex(tIndices);

      const material = new THREE.MeshLambertMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
      });
      this.transparentMesh = new THREE.Mesh(geometry, material);
      this.transparentMesh.position.set(worldX, worldY, worldZ);
      this.transparentMesh.renderOrder = 1;
    }

    this.dirty = false;
  }

  /** Dispose of chunk resources */
  dispose() {
    if (this.mesh) {
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    }
    if (this.transparentMesh) {
      this.transparentMesh.geometry.dispose();
      this.transparentMesh.material.dispose();
      if (this.transparentMesh.parent) this.transparentMesh.parent.remove(this.transparentMesh);
    }
  }
}
