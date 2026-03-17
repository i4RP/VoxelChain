/**
 * World Manager for VoxelChain.
 * Manages chunk loading/unloading, terrain generation, and mesh building.
 */

import * as THREE from "three";
import { Chunk, CHUNK_SIZE } from "./Chunk.js";
import { TerrainGenerator } from "./TerrainGenerator.js";

const VIEW_DISTANCE = 4; // chunks
const UNLOAD_DISTANCE = 6; // chunks

export class WorldManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.terrain = new TerrainGenerator();
    this._loadQueue = [];
    this._buildQueue = [];
  }

  /** Get chunk key string */
  _key(cx, cy, cz) {
    return `${cx},${cy},${cz}`;
  }

  /** Get or create chunk */
  getChunk(cx, cy, cz) {
    const key = this._key(cx, cy, cz);
    if (!this.chunks.has(key)) {
      const chunk = new Chunk(cx, cy, cz);
      this.terrain.generateChunk(chunk);
      chunk.loaded = true;
      this.chunks.set(key, chunk);
      this._buildQueue.push(key);
    }
    return this.chunks.get(key);
  }

  /** Get block at world position */
  getBlock(wx, wy, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const key = this._key(cx, cy, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return 0;
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk.getBlock(lx, ly, lz);
  }

  /** Set block at world position */
  setBlock(wx, wy, wz, type) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cy = Math.floor(wy / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const chunk = this.getChunk(cx, cy, cz);
    const lx = ((wx % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const ly = ((wy % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((wz % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk.setBlock(lx, ly, lz, type);
    this._buildQueue.push(this._key(cx, cy, cz));

    // Rebuild neighbors if on chunk boundary
    if (lx === 0) this._markDirty(cx - 1, cy, cz);
    if (lx === CHUNK_SIZE - 1) this._markDirty(cx + 1, cy, cz);
    if (ly === 0) this._markDirty(cx, cy - 1, cz);
    if (ly === CHUNK_SIZE - 1) this._markDirty(cx, cy + 1, cz);
    if (lz === 0) this._markDirty(cx, cy, cz - 1);
    if (lz === CHUNK_SIZE - 1) this._markDirty(cx, cy, cz + 1);
  }

  _markDirty(cx, cy, cz) {
    const key = this._key(cx, cy, cz);
    if (this.chunks.has(key)) {
      this.chunks.get(key).dirty = true;
      if (!this._buildQueue.includes(key)) {
        this._buildQueue.push(key);
      }
    }
  }

  /** Load chunk data from server */
  loadChunkFromServer(data) {
    const cx = data.chunk.x;
    const cy = data.chunk.y;
    const cz = data.chunk.z;
    const key = this._key(cx, cy, cz);
    let chunk = this.chunks.get(key);
    if (!chunk) {
      chunk = new Chunk(cx, cy, cz);
      this.chunks.set(key, chunk);
    }
    chunk.loadFromData(data);
    this._buildQueue.push(key);
  }

  /** Update chunks around player position */
  update(playerPos) {
    const pcx = Math.floor(playerPos.x / CHUNK_SIZE);
    const pcy = Math.floor(playerPos.y / CHUNK_SIZE);
    const pcz = Math.floor(playerPos.z / CHUNK_SIZE);

    // Load chunks within view distance
    for (let dy = -1; dy <= 2; dy++) {
      for (let dz = -VIEW_DISTANCE; dz <= VIEW_DISTANCE; dz++) {
        for (let dx = -VIEW_DISTANCE; dx <= VIEW_DISTANCE; dx++) {
          const cx = pcx + dx;
          const cy = pcy + dy;
          const cz = pcz + dz;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= VIEW_DISTANCE) {
            this.getChunk(cx, cy, cz);
          }
        }
      }
    }

    // Build dirty chunks (limit per frame for performance)
    const maxBuildsPerFrame = 3;
    let built = 0;
    while (this._buildQueue.length > 0 && built < maxBuildsPerFrame) {
      const key = this._buildQueue.shift();
      const chunk = this.chunks.get(key);
      if (chunk && chunk.dirty) {
        this._buildChunkMesh(chunk);
        built++;
      }
    }

    // Unload distant chunks
    for (const [key, chunk] of this.chunks) {
      const dx = chunk.cx - pcx;
      const dy = chunk.cy - pcy;
      const dz = chunk.cz - pcz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist > UNLOAD_DISTANCE || Math.abs(dy) > 3) {
        chunk.dispose();
        this.chunks.delete(key);
      }
    }
  }

  _buildChunkMesh(chunk) {
    const getNeighborBlock = (wx, wy, wz) => this.getBlock(wx, wy, wz);
    chunk.buildMesh(getNeighborBlock);

    if (chunk.mesh) {
      this.scene.add(chunk.mesh);
    }
    if (chunk.transparentMesh) {
      this.scene.add(chunk.transparentMesh);
    }
  }

  /** Raycast to find targeted block */
  raycast(origin, direction, maxDist = 8) {
    const step = 0.05;
    const pos = origin.clone();
    const dir = direction.clone().normalize().multiplyScalar(step);
    let prevX = Math.floor(pos.x);
    let prevY = Math.floor(pos.y);
    let prevZ = Math.floor(pos.z);

    for (let i = 0; i < maxDist / step; i++) {
      pos.add(dir);
      const bx = Math.floor(pos.x);
      const by = Math.floor(pos.y);
      const bz = Math.floor(pos.z);

      if (bx !== prevX || by !== prevY || bz !== prevZ) {
        const block = this.getBlock(bx, by, bz);
        if (block !== 0) {
          return {
            hit: true,
            blockPos: { x: bx, y: by, z: bz },
            placePos: { x: prevX, y: prevY, z: prevZ },
            blockType: block,
            distance: origin.distanceTo(pos),
          };
        }
        prevX = bx;
        prevY = by;
        prevZ = bz;
      }
    }
    return { hit: false };
  }

  getChunkCount() {
    return this.chunks.size;
  }
}
