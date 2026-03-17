/**
 * World Manager for VoxelChain.
 * Manages chunk loading/unloading, terrain generation, and mesh building.
 */

import * as THREE from "three";
import { Chunk, CHUNK_SIZE } from "./Chunk.js";
import { TerrainGenerator } from "./TerrainGenerator.js";
import { registry } from "./BlockRegistry.js";

const VIEW_DISTANCE = 4; // chunks
const UNLOAD_DISTANCE = 6; // chunks

export class WorldManager {
  constructor(scene) {
    this.scene = scene;
    this.chunks = new Map();
    this.terrain = new TerrainGenerator();
    this._loadQueue = [];
    this._buildQueue = [];
    this._meshWorker = null;
    this._pendingWorkerBuilds = new Set();
    this._initMeshWorker();
  }

  /** Initialize mesh generation WebWorker */
  _initMeshWorker() {
    try {
      this._meshWorker = new Worker(
        new URL("./MeshWorker.js", import.meta.url),
        { type: "module" }
      );
      this._meshWorker.onmessage = (e) => this._onWorkerMessage(e);
      this._meshWorker.onerror = (err) => {
        console.warn("[WorldManager] MeshWorker error, falling back to main thread:", err.message);
        this._meshWorker = null;
      };

      // Pre-serialize block definitions for the worker
      this._blockDefs = {};
      for (let i = 0; i <= 20; i++) {
        const def = registry.get(i);
        this._blockDefs[i] = {
          transparent: def.transparent,
          color: def.color,
          topColor: def.topColor || def.color,
          sideColor: def.sideColor || def.color,
          bottomColor: def.bottomColor || def.sideColor || def.color,
        };
      }
    } catch (err) {
      console.warn("[WorldManager] WebWorker not available:", err.message);
      this._meshWorker = null;
    }
  }

  /** Handle mesh data from worker */
  _onWorkerMessage(e) {
    const { type, chunkKey, opaque, transparent } = e.data;
    if (type !== "meshBuilt") return;

    this._pendingWorkerBuilds.delete(chunkKey);
    const chunk = this.chunks.get(chunkKey);
    if (!chunk) return;

    // Dispose old meshes
    if (chunk.mesh) {
      chunk.mesh.geometry.dispose();
      if (chunk.mesh.parent) chunk.mesh.parent.remove(chunk.mesh);
      chunk.mesh = null;
    }
    if (chunk.transparentMesh) {
      chunk.transparentMesh.geometry.dispose();
      if (chunk.transparentMesh.parent) chunk.transparentMesh.parent.remove(chunk.transparentMesh);
      chunk.transparentMesh = null;
    }

    const worldX = chunk.cx * CHUNK_SIZE;
    const worldY = chunk.cy * CHUNK_SIZE;
    const worldZ = chunk.cz * CHUNK_SIZE;

    if (opaque) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(opaque.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(opaque.normals, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(opaque.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(opaque.indices, 1));
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
      chunk.mesh = new THREE.Mesh(geo, mat);
      chunk.mesh.position.set(worldX, worldY, worldZ);
      chunk.mesh.castShadow = true;
      chunk.mesh.receiveShadow = true;
      this.scene.add(chunk.mesh);
    }

    if (transparent) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(transparent.positions, 3));
      geo.setAttribute("normal", new THREE.BufferAttribute(transparent.normals, 3));
      geo.setAttribute("color", new THREE.BufferAttribute(transparent.colors, 3));
      geo.setIndex(new THREE.BufferAttribute(transparent.indices, 1));
      const mat = new THREE.MeshLambertMaterial({
        vertexColors: true, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      });
      chunk.transparentMesh = new THREE.Mesh(geo, mat);
      chunk.transparentMesh.position.set(worldX, worldY, worldZ);
      chunk.transparentMesh.renderOrder = 1;
      this.scene.add(chunk.transparentMesh);
    }

    chunk.dirty = false;
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
    const key = this._key(chunk.cx, chunk.cy, chunk.cz);

    // Try WebWorker path for offloaded mesh generation
    if (this._meshWorker && !this._pendingWorkerBuilds.has(key)) {
      this._pendingWorkerBuilds.add(key);

      // Collect neighbor blocks at chunk boundaries for the worker
      const neighborBlocks = {};
      const worldX = chunk.cx * CHUNK_SIZE;
      const worldY = chunk.cy * CHUNK_SIZE;
      const worldZ = chunk.cz * CHUNK_SIZE;
      for (let z = -1; z <= CHUNK_SIZE; z++) {
        for (let y = -1; y <= CHUNK_SIZE; y++) {
          for (let x = -1; x <= CHUNK_SIZE; x++) {
            if (x >= 0 && x < CHUNK_SIZE && y >= 0 && y < CHUNK_SIZE && z >= 0 && z < CHUNK_SIZE) continue;
            const bt = this.getBlock(worldX + x, worldY + y, worldZ + z);
            if (bt !== 0) neighborBlocks[`${x},${y},${z}`] = bt;
          }
        }
      }

      const blocksBuffer = chunk.blocks.buffer.slice(0);
      this._meshWorker.postMessage({
        type: "buildMesh",
        chunkKey: key,
        blocks: blocksBuffer,
        neighborBlocks,
        blockDefs: this._blockDefs,
      }, [blocksBuffer]);
      return;
    }

    // Fallback: build on main thread
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
