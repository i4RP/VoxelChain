/**
 * GameCommandAPI - Programmatic command interface for VoxelChain.
 * Allows AI agents and scripts to control the game without mouse/keyboard.
 *
 * Usage:
 *   game.api.moveTo(10, 30, 15)
 *   game.api.placeBlock(10, 31, 15, 8)
 *   game.api.lookAt(0, 30, 0)
 */

import { BlockType } from "./BlockRegistry.js";

export class GameCommandAPI {
  constructor(game) {
    this._game = game;
    this._commandLog = [];
    this._maxLogSize = 1000;
  }

  // ─── Movement ────────────────────────────────────────────

  /** Teleport player to exact coordinates */
  teleport(x, y, z) {
    this._log("teleport", { x, y, z });
    this._game.input.teleport(x, y, z);
    return { success: true, position: { x, y, z } };
  }

  /** Move toward target position (smooth, async). Resolves when arrived. */
  async moveTo(x, y, z) {
    this._log("moveTo", { x, y, z });
    if (!this._game.input.aiMode) {
      return { success: false, error: "AI mode not enabled. Call game.api.enableAI() first." };
    }
    const result = await this._game.input.moveToward(x, y, z);
    return { success: result.arrived, ...result };
  }

  /**
   * Move forward by N blocks in the current look direction.
   * Uses fly mode for simplicity.
   */
  async moveForward(blocks = 1) {
    const dir = this._game.input.getLookDirection();
    const pos = this._game.input.position;
    const target = {
      x: pos.x + dir.x * blocks,
      y: pos.y + dir.y * blocks,
      z: pos.z + dir.z * blocks,
    };
    return this.moveTo(target.x, target.y, target.z);
  }

  /** Move backward by N blocks */
  async moveBackward(blocks = 1) {
    return this.moveForward(-blocks);
  }

  /** Cancel current movement */
  cancelMove() {
    this._game.input.cancelMove();
    return { success: true };
  }

  // ─── Camera ──────────────────────────────────────────────

  /** Look at a world position */
  lookAt(x, y, z) {
    this._log("lookAt", { x, y, z });
    this._game.input.lookAtPosition(x, y, z);
    return { success: true };
  }

  /** Set yaw (horizontal rotation) in degrees */
  setYaw(degrees) {
    const rad = (degrees * Math.PI) / 180;
    this._game.input.setLookEuler(rad, this._game.input.euler.x);
    return { success: true, yaw: degrees };
  }

  /** Set pitch (vertical rotation) in degrees. -90 = straight down, 90 = straight up */
  setPitch(degrees) {
    const rad = (degrees * Math.PI) / 180;
    this._game.input.setLookEuler(this._game.input.euler.y, rad);
    return { success: true, pitch: degrees };
  }

  /** Set both yaw and pitch in degrees */
  setRotation(yaw, pitch) {
    const yawRad = (yaw * Math.PI) / 180;
    const pitchRad = (pitch * Math.PI) / 180;
    this._game.input.setLookEuler(yawRad, pitchRad);
    return { success: true, yaw, pitch };
  }

  // ─── Block Operations ────────────────────────────────────

  /** Place a block at world coordinates */
  async placeBlock(x, y, z, blockType) {
    this._log("placeBlock", { x, y, z, blockType });
    const typeId = typeof blockType === "string" ? BlockType[blockType] : blockType;
    if (typeId === undefined || typeId === BlockType.AIR) {
      return { success: false, error: `Invalid block type: ${blockType}` };
    }

    // Place locally (optimistic)
    this._game.world.setBlock(x, y, z, typeId);

    // Submit to blockchain
    try {
      const player = this._game.blockchain.walletAddress || "";
      await this._game.blockchain.placeBlock(x, y, z, typeId, player);
      return { success: true, x, y, z, blockType: typeId };
    } catch (e) {
      // Rollback on failure
      this._game.world.setBlock(x, y, z, 0);
      return { success: false, error: e.message };
    }
  }

  /** Break/remove a block at world coordinates */
  async breakBlock(x, y, z) {
    this._log("breakBlock", { x, y, z });
    const currentBlock = this._game.world.getBlock(x, y, z);
    if (currentBlock === 0) {
      return { success: false, error: "No block at that position" };
    }

    // Remove locally (optimistic)
    this._game.world.setBlock(x, y, z, 0);

    // Submit to blockchain
    try {
      const player = this._game.blockchain.walletAddress || "";
      await this._game.blockchain.breakBlock(x, y, z, player);
      return { success: true, x, y, z, previousType: currentBlock };
    } catch (e) {
      // Rollback
      this._game.world.setBlock(x, y, z, currentBlock);
      return { success: false, error: e.message };
    }
  }

  /** Get block type at world coordinates */
  getBlock(x, y, z) {
    const blockType = this._game.world.getBlock(x, y, z);
    const name = this._game.world.terrain
      ? Object.entries(BlockType).find(([, v]) => v === blockType)?.[0] || "UNKNOWN"
      : "UNKNOWN";
    return { blockType, name, x, y, z };
  }

  /** Get blocks in a region (inclusive) */
  getBlocksInRegion(x1, y1, z1, x2, y2, z2) {
    const blocks = [];
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const bt = this._game.world.getBlock(x, y, z);
          if (bt !== 0) {
            blocks.push({ x, y, z, blockType: bt });
          }
        }
      }
    }
    return blocks;
  }

  // ─── Inventory / Hotbar ──────────────────────────────────

  /** Select a hotbar slot (0-8) */
  selectSlot(n) {
    if (n < 0 || n > 8) {
      return { success: false, error: "Slot must be 0-8" };
    }
    this._game.input.selectedSlot = n;
    if (this._game.input.onSlotChange) {
      this._game.input.onSlotChange(n);
    }
    return { success: true, slot: n };
  }

  /** Get current selected slot */
  getSelectedSlot() {
    return { slot: this._game.input.selectedSlot };
  }

  // ─── World Info ──────────────────────────────────────────

  /** Get player position */
  getPosition() {
    const p = this._game.input.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** Get player look direction */
  getLookDirection() {
    const d = this._game.input.getLookDirection();
    return { x: d.x, y: d.y, z: d.z };
  }

  /** Get camera rotation in degrees */
  getRotation() {
    const e = this._game.input.euler;
    return {
      yaw: (e.y * 180) / Math.PI,
      pitch: (e.x * 180) / Math.PI,
    };
  }

  /** Get blocks near player within radius */
  getNearbyBlocks(radius = 5) {
    const pos = this._game.input.position;
    const cx = Math.floor(pos.x);
    const cy = Math.floor(pos.y);
    const cz = Math.floor(pos.z);
    const blocks = [];

    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;
          const x = cx + dx;
          const y = cy + dy;
          const z = cz + dz;
          const bt = this._game.world.getBlock(x, y, z);
          if (bt !== 0) {
            blocks.push({ x, y, z, blockType: bt });
          }
        }
      }
    }
    return blocks;
  }

  /** Raycast from player's eye in look direction */
  raycast(maxDist = 8) {
    const ray = this._game.world.raycast(
      this._game.input.getEyePosition(),
      this._game.input.getLookDirection(),
      maxDist
    );
    return ray;
  }

  // ─── Game Systems ────────────────────────────────────────

  /** Send a chat message */
  chat(message) {
    this._log("chat", { message });
    this._game.ui.addChatMessage(message, "#ffffff");
    return { success: true };
  }

  /** Get blockchain info */
  async getWorldInfo() {
    try {
      const info = await this._game.blockchain.getWorldInfo();
      return { success: true, ...info };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /** Get available block types */
  getBlockTypes() {
    return { ...BlockType };
  }

  // ─── AI Mode Control ────────────────────────────────────

  /** Enable AI mode */
  enableAI() {
    this._game.input.enableAIMode();
    return { success: true, aiMode: true };
  }

  /** Disable AI mode */
  disableAI() {
    this._game.input.disableAIMode();
    return { success: true, aiMode: false };
  }

  /** Check if AI mode is active */
  isAIMode() {
    return this._game.input.aiMode;
  }

  // ─── Scripting Helpers ───────────────────────────────────

  /** Wait for N milliseconds */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Build a structure from a 3D array of block types.
   * array[y][z][x] = blockType (0 = skip)
   * origin is bottom-south-west corner.
   */
  async buildStructure(originX, originY, originZ, structure) {
    const results = [];
    for (let y = 0; y < structure.length; y++) {
      const layer = structure[y];
      for (let z = 0; z < layer.length; z++) {
        const row = layer[z];
        for (let x = 0; x < row.length; x++) {
          const bt = row[x];
          if (bt && bt !== 0) {
            const r = await this.placeBlock(originX + x, originY + y, originZ + z, bt);
            results.push(r);
          }
        }
      }
    }
    return results;
  }

  /**
   * Fill a rectangular region with a single block type.
   */
  async fillRegion(x1, y1, z1, x2, y2, z2, blockType) {
    const results = [];
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const r = await this.placeBlock(x, y, z, blockType);
          results.push(r);
        }
      }
    }
    return results;
  }

  /**
   * Clear a rectangular region (set all blocks to air).
   */
  async clearRegion(x1, y1, z1, x2, y2, z2) {
    const results = [];
    const minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
    const minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
    const minZ = Math.min(z1, z2), maxZ = Math.max(z1, z2);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const bt = this._game.world.getBlock(x, y, z);
          if (bt !== 0) {
            const r = await this.breakBlock(x, y, z);
            results.push(r);
          }
        }
      }
    }
    return results;
  }

  // ─── Command Log ─────────────────────────────────────────

  /** Get recent command log */
  getCommandLog(limit = 50) {
    return this._commandLog.slice(-limit);
  }

  /** Clear command log */
  clearCommandLog() {
    this._commandLog = [];
  }

  _log(command, params) {
    this._commandLog.push({
      time: Date.now(),
      command,
      params,
    });
    if (this._commandLog.length > this._maxLogSize) {
      this._commandLog.shift();
    }
  }

  // ─── Help ────────────────────────────────────────────────

  /** List all available API methods */
  help() {
    return {
      movement: [
        "teleport(x, y, z) - Instant teleport",
        "moveTo(x, y, z) - Smooth move (async, AI mode)",
        "moveForward(blocks) - Move forward N blocks (async)",
        "moveBackward(blocks) - Move backward N blocks (async)",
        "cancelMove() - Cancel current movement",
      ],
      camera: [
        "lookAt(x, y, z) - Look at world position",
        "setYaw(degrees) - Set horizontal rotation",
        "setPitch(degrees) - Set vertical rotation",
        "setRotation(yaw, pitch) - Set both rotations",
      ],
      blocks: [
        "placeBlock(x, y, z, type) - Place block (async)",
        "breakBlock(x, y, z) - Break block (async)",
        "getBlock(x, y, z) - Get block info",
        "getBlocksInRegion(x1,y1,z1,x2,y2,z2) - Get blocks in region",
      ],
      inventory: [
        "selectSlot(n) - Select hotbar slot 0-8",
        "getSelectedSlot() - Get current slot",
      ],
      world: [
        "getPosition() - Player position",
        "getLookDirection() - Camera direction vector",
        "getRotation() - Camera rotation in degrees",
        "getNearbyBlocks(radius) - Blocks near player",
        "raycast(maxDist) - Raycast from eye",
      ],
      building: [
        "buildStructure(x, y, z, array3D) - Build from array",
        "fillRegion(x1,y1,z1,x2,y2,z2,type) - Fill region",
        "clearRegion(x1,y1,z1,x2,y2,z2) - Clear region",
      ],
      ai: [
        "enableAI() - Enable AI mode",
        "disableAI() - Disable AI mode",
        "isAIMode() - Check AI mode status",
      ],
      system: [
        "chat(message) - Send chat message",
        "getWorldInfo() - Blockchain info (async)",
        "getBlockTypes() - All block type IDs",
        "wait(ms) - Delay (async)",
        "getCommandLog(limit) - Recent commands",
        "help() - This help text",
      ],
    };
  }
}
