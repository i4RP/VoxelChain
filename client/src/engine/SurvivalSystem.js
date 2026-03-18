/**
 * SurvivalSystem - HP, hunger, damage, death/respawn for VoxelChain.
 * Manages player health, hunger, fall damage, lava damage, and respawn.
 */

import { BlockType } from "./BlockRegistry.js";

const MAX_HP = 20;
const MAX_HUNGER = 20;
const HUNGER_DEPLETION_RATE = 0.015; // per second when moving
const HUNGER_IDLE_RATE = 0.003; // per second when idle
const HUNGER_SPRINT_RATE = 0.04; // per second when sprinting
const HP_REGEN_RATE = 0.5; // HP per second when hunger >= 18
const HP_REGEN_THRESHOLD = 18; // hunger must be >= this to regen
const STARVATION_RATE = 0.5; // HP lost per second when hunger == 0
const FALL_DAMAGE_THRESHOLD = 3.5; // blocks fallen before damage starts
const FALL_DAMAGE_PER_BLOCK = 1.0; // HP lost per block over threshold
const LAVA_DAMAGE_RATE = 4.0; // HP per second in lava
const RESPAWN_DELAY = 2000; // ms before respawn
const DAMAGE_FLASH_DURATION = 0.3; // seconds of red flash

export class SurvivalSystem {
  constructor(game) {
    this._game = game;
    this.hp = MAX_HP;
    this.maxHp = MAX_HP;
    this.hunger = MAX_HUNGER;
    this.maxHunger = MAX_HUNGER;
    this.alive = true;
    this.gameMode = "survival"; // "survival" or "creative"

    // Fall tracking
    this._lastGroundY = null;
    this._falling = false;
    this._highestY = 0;

    // Damage flash
    this._damageFlashTimer = 0;

    // Respawn
    this._respawnTimer = 0;
    this._respawning = false;
    this.spawnPoint = { x: 8, y: 30, z: 8 };

    // Inventory (simplified: maps blockType -> count)
    this.inventory = new Map();

    // Death count
    this.deathCount = 0;
  }

  /** Switch game mode */
  setGameMode(mode) {
    this.gameMode = mode;
    if (mode === "creative") {
      this.hp = MAX_HP;
      this.hunger = MAX_HUNGER;
      this.alive = true;
      this._respawning = false;
      this._game.input.flyMode = true;
    } else {
      this._game.input.flyMode = false;
    }
  }

  /** Main update loop - call every frame */
  update(dt) {
    if (this.gameMode === "creative") return;
    if (!this.alive) {
      this._handleDeath(dt);
      return;
    }

    this._updateFallDamage(dt);
    this._updateLavaDamage(dt);
    this._updateHunger(dt);
    this._updateRegeneration(dt);
    this._updateDamageFlash(dt);
  }

  /** Check fall damage based on Y position changes */
  _updateFallDamage(dt) {
    const input = this._game.input;
    if (input.flyMode) return;

    const currentY = input.position.y;

    if (input.onGround) {
      if (this._falling && this._highestY > 0) {
        const fallDist = this._highestY - currentY;
        if (fallDist > FALL_DAMAGE_THRESHOLD) {
          const damage = Math.floor((fallDist - FALL_DAMAGE_THRESHOLD) * FALL_DAMAGE_PER_BLOCK);
          if (damage > 0) {
            this.takeDamage(damage, "fall");
          }
        }
      }
      this._falling = false;
      this._highestY = currentY;
      this._lastGroundY = currentY;
    } else {
      // In air
      if (this._lastGroundY !== null && currentY < this._lastGroundY) {
        this._falling = true;
      }
      if (currentY > this._highestY || !this._falling) {
        this._highestY = currentY;
      }
    }
  }

  /** Check if player is in lava and apply damage */
  _updateLavaDamage(dt) {
    const pos = this._game.input.position;
    const bx = Math.floor(pos.x);
    const by = Math.floor(pos.y);
    const bz = Math.floor(pos.z);

    // Check feet and body position
    const feetBlock = this._game.world.getBlock(bx, by, bz);
    const bodyBlock = this._game.world.getBlock(bx, by + 1, bz);

    if (feetBlock === BlockType.LAVA || bodyBlock === BlockType.LAVA) {
      this.takeDamage(LAVA_DAMAGE_RATE * dt, "lava");
    }
  }

  /** Update hunger depletion */
  _updateHunger(dt) {
    const input = this._game.input;
    const isMoving = input.keys["KeyW"] || input.keys["KeyS"] ||
                     input.keys["KeyA"] || input.keys["KeyD"];
    const isSprinting = input.keys["ShiftLeft"] && isMoving;

    let rate = HUNGER_IDLE_RATE;
    if (isSprinting) {
      rate = HUNGER_SPRINT_RATE;
    } else if (isMoving) {
      rate = HUNGER_DEPLETION_RATE;
    }

    this.hunger = Math.max(0, this.hunger - rate * dt);

    // Starvation damage
    if (this.hunger <= 0) {
      this.takeDamage(STARVATION_RATE * dt, "starvation");
    }
  }

  /** Regenerate HP when hunger is high */
  _updateRegeneration(dt) {
    if (this.hunger >= HP_REGEN_THRESHOLD && this.hp < this.maxHp) {
      this.hp = Math.min(this.maxHp, this.hp + HP_REGEN_RATE * dt);
    }
  }

  /** Update damage flash effect */
  _updateDamageFlash(dt) {
    if (this._damageFlashTimer > 0) {
      this._damageFlashTimer = Math.max(0, this._damageFlashTimer - dt);
    }
  }

  /** Apply damage to player */
  takeDamage(amount, source = "unknown") {
    if (this.gameMode === "creative" || !this.alive) return;
    if (amount <= 0) return;

    this.hp = Math.max(0, this.hp - amount);
    this._damageFlashTimer = DAMAGE_FLASH_DURATION;

    // Play damage sound
    if (this._game.sound && amount >= 1) {
      this._game.sound.playDamage();
    }

    if (this.hp <= 0) {
      this._die(source);
    }
  }

  /** Handle player death */
  _die(cause) {
    this.alive = false;
    this._respawning = true;
    this._respawnTimer = RESPAWN_DELAY;
    this.deathCount++;

    const messages = {
      fall: "You fell to your death!",
      lava: "You burned in lava!",
      starvation: "You starved to death!",
      unknown: "You died!",
    };
    this._game.ui.addChatMessage(messages[cause] || messages.unknown, "#ef4444");
  }

  /** Handle death screen and respawn timer */
  _handleDeath(dt) {
    if (!this._respawning) return;
    this._respawnTimer -= dt * 1000;
    if (this._respawnTimer <= 0) {
      this._respawn();
    }
  }

  /** Respawn player at spawn point */
  _respawn() {
    this.hp = this.maxHp;
    this.hunger = this.maxHunger;
    this.alive = true;
    this._respawning = false;
    this._falling = false;
    this._highestY = 0;
    this._lastGroundY = null;
    this._damageFlashTimer = 0;

    // Teleport to spawn
    this._game.input.teleport(this.spawnPoint.x, this.spawnPoint.y, this.spawnPoint.z);
    this._game.ui.addChatMessage("Respawned!", "#10b981");
  }

  /** Eat food to restore hunger */
  eatFood(amount) {
    if (this.gameMode === "creative") return;
    this.hunger = Math.min(this.maxHunger, this.hunger + amount);
  }

  /** Add item to inventory */
  addToInventory(blockType, count = 1) {
    const current = this.inventory.get(blockType) || 0;
    this.inventory.set(blockType, current + count);
  }

  /** Remove item from inventory. Returns true if successful. */
  removeFromInventory(blockType, count = 1) {
    const current = this.inventory.get(blockType) || 0;
    if (current < count) return false;
    const remaining = current - count;
    if (remaining <= 0) {
      this.inventory.delete(blockType);
    } else {
      this.inventory.set(blockType, remaining);
    }
    return true;
  }

  /** Get count of a block type in inventory */
  getInventoryCount(blockType) {
    return this.inventory.get(blockType) || 0;
  }

  /** Get all inventory contents */
  getInventoryAll() {
    const items = [];
    for (const [blockType, count] of this.inventory) {
      items.push({ blockType, count });
    }
    return items;
  }

  /** Check if damage flash is active */
  isDamageFlashing() {
    return this._damageFlashTimer > 0;
  }

  /** Get normalized damage flash intensity (0-1) */
  getDamageFlashIntensity() {
    return this._damageFlashTimer / DAMAGE_FLASH_DURATION;
  }

  /** Check if player is dead and waiting to respawn */
  isRespawning() {
    return this._respawning;
  }

  /** Get respawn progress (0-1) */
  getRespawnProgress() {
    if (!this._respawning) return 0;
    return 1 - (this._respawnTimer / RESPAWN_DELAY);
  }
}
