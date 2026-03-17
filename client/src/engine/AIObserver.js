/**
 * AIObserver - Structured game state output for AI agents.
 * Provides a JSON-serializable snapshot of the game state,
 * eliminating the need for image recognition.
 */

import { BlockType } from "./BlockRegistry.js";

export class AIObserver {
  constructor(game) {
    this._game = game;
    this._updateInterval = null;
    this._listeners = [];
    this._snapshotInterval = 1000; // ms between auto-snapshots
  }

  /**
   * Get a complete snapshot of the current game state.
   * This is the primary method for AI agents to perceive the world.
   */
  getSnapshot() {
    const input = this._game.input;
    const pos = input.position;
    const euler = input.euler;

    return {
      timestamp: Date.now(),
      player: {
        position: { x: pos.x, y: pos.y, z: pos.z },
        rotation: {
          yaw: (euler.y * 180) / Math.PI,
          pitch: (euler.x * 180) / Math.PI,
        },
        lookDirection: this._vec3ToObj(input.getLookDirection()),
        eyePosition: this._vec3ToObj(input.getEyePosition()),
        flyMode: input.flyMode,
        onGround: input.onGround,
        selectedSlot: input.selectedSlot,
        aiMode: input.aiMode,
      },
      world: this._getWorldState(),
      blockchain: this._getBlockchainState(),
      raycast: this._getRaycastResult(),
    };
  }

  /**
   * Get a lightweight snapshot (position + raycast only).
   * More efficient for high-frequency polling.
   */
  getQuickSnapshot() {
    const input = this._game.input;
    const pos = input.position;

    return {
      timestamp: Date.now(),
      position: { x: pos.x, y: pos.y, z: pos.z },
      rotation: {
        yaw: (input.euler.y * 180) / Math.PI,
        pitch: (input.euler.x * 180) / Math.PI,
      },
      selectedSlot: input.selectedSlot,
      raycast: this._getRaycastResult(),
    };
  }

  /**
   * Get blocks visible in the player's forward cone.
   * Returns blocks within radius that are roughly in front of the player.
   */
  getVisibleBlocks(radius = 10, fovDegrees = 90) {
    const pos = this._game.input.position;
    const lookDir = this._game.input.getLookDirection();
    const fovRad = (fovDegrees * Math.PI) / 180;
    const cosFov = Math.cos(fovRad / 2);
    const blocks = [];

    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const distSq = dx * dx + dy * dy + dz * dz;
          if (distSq > radius * radius || distSq === 0) continue;

          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const bt = this._game.world.getBlock(x, y, z);
          if (bt === 0) continue;

          // Check if in FOV
          const dist = Math.sqrt(distSq);
          const dirX = dx / dist;
          const dirY = dy / dist;
          const dirZ = dz / dist;
          const dot = dirX * lookDir.x + dirY * lookDir.y + dirZ * lookDir.z;

          if (dot >= cosFov) {
            blocks.push({
              x, y, z,
              blockType: bt,
              name: this._blockName(bt),
              distance: dist,
            });
          }
        }
      }
    }

    // Sort by distance
    blocks.sort((a, b) => a.distance - b.distance);
    return blocks;
  }

  /**
   * Get surface blocks around the player (ground-level blocks).
   * Useful for navigation and understanding terrain.
   */
  getSurfaceMap(radius = 16) {
    const pos = this._game.input.position;
    const cx = Math.floor(pos.x);
    const cz = Math.floor(pos.z);
    const baseY = Math.floor(pos.y);
    const surface = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dz = -radius; dz <= radius; dz++) {
        if (dx * dx + dz * dz > radius * radius) continue;
        const x = cx + dx;
        const z = cz + dz;

        // Scan from player height downward to find surface
        for (let y = baseY + 5; y >= baseY - 20; y--) {
          const block = this._game.world.getBlock(x, y, z);
          const above = this._game.world.getBlock(x, y + 1, z);
          if (block !== 0 && block !== 5 && (above === 0 || above === 5)) {
            surface.push({
              x, y, z,
              blockType: block,
              name: this._blockName(block),
            });
            break;
          }
        }
      }
    }

    return surface;
  }

  /**
   * Start auto-broadcasting snapshots at a regular interval.
   * Listeners receive the snapshot each interval.
   */
  startAutoSnapshot(intervalMs) {
    this.stopAutoSnapshot();
    this._snapshotInterval = intervalMs || this._snapshotInterval;
    this._updateInterval = setInterval(() => {
      const snapshot = this.getSnapshot();
      for (const listener of this._listeners) {
        try {
          listener(snapshot);
        } catch (e) {
          console.warn("[AIObserver] Listener error:", e);
        }
      }
    }, this._snapshotInterval);
  }

  /** Stop auto-broadcasting */
  stopAutoSnapshot() {
    if (this._updateInterval) {
      clearInterval(this._updateInterval);
      this._updateInterval = null;
    }
  }

  /** Add a snapshot listener */
  onSnapshot(callback) {
    this._listeners.push(callback);
  }

  /** Remove a snapshot listener */
  offSnapshot(callback) {
    const idx = this._listeners.indexOf(callback);
    if (idx >= 0) this._listeners.splice(idx, 1);
  }

  // ─── Internal Helpers ────────────────────────────────────

  _getWorldState() {
    return {
      loadedChunks: this._game.world.getChunkCount(),
    };
  }

  _getBlockchainState() {
    const bc = this._game.blockchain;
    return {
      connected: bc.connected,
      virtualBlock: bc.virtualBlock,
      realBlock: bc.realBlock,
      walletAddress: bc.walletAddress,
    };
  }

  _getRaycastResult() {
    try {
      const ray = this._game.world.raycast(
        this._game.input.getEyePosition(),
        this._game.input.getLookDirection()
      );
      if (ray.hit) {
        return {
          hit: true,
          blockPos: ray.blockPos,
          placePos: ray.placePos,
          blockType: ray.blockType,
          blockName: this._blockName(ray.blockType),
          distance: ray.distance,
        };
      }
    } catch (e) {
      // Raycast may fail if world not loaded
    }
    return { hit: false };
  }

  _blockName(typeId) {
    const entry = Object.entries(BlockType).find(([, v]) => v === typeId);
    return entry ? entry[0] : "UNKNOWN";
  }

  _vec3ToObj(v) {
    return { x: v.x, y: v.y, z: v.z };
  }
}
