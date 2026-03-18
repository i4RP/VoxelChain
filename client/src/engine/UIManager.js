/**
 * UI Manager for VoxelChain.
 * Manages HUD, hotbar, inventory, chat, and minimap.
 */

import { registry, BlockType } from "./BlockRegistry.js";

export class UIManager {
  constructor() {
    this.hotbarSlots = [];
    this.selectedSlot = 0;
    this.chatMessages = [];
    this.minimapCtx = null;
    this._survivalMode = false;

    this._initHotbar();
    this._initMinimap();
    this._initInventory();
    this._initCrafting();
  }

  /**
   * Build a 3D-looking block face preview using CSS gradients.
   * Inspired by Minecraft-Javascript-Edition toolbar icons (MIT).
   */
  _blockPreviewStyle(colorHex) {
    if (colorHex === "transparent") return { background: "transparent" };
    // Parse hex to RGB components
    const hex = colorHex.replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    // Top face (lighter)
    const topR = Math.min(255, r + 40);
    const topG = Math.min(255, g + 40);
    const topB = Math.min(255, b + 40);
    // Side face (darker)
    const sideR = Math.max(0, r - 30);
    const sideG = Math.max(0, g - 30);
    const sideB = Math.max(0, b - 30);
    return {
      background: `linear-gradient(135deg, rgb(${topR},${topG},${topB}) 0%, ${colorHex} 50%, rgb(${sideR},${sideG},${sideB}) 100%)`,
      boxShadow: `inset 1px 1px 0 rgba(255,255,255,0.25), inset -1px -1px 0 rgba(0,0,0,0.25)`,
    };
  }

  _initHotbar() {
    const hotbar = document.getElementById("hotbar");
    if (!hotbar) return;
    hotbar.innerHTML = "";

    const placeableBlocks = [
      BlockType.STONE, BlockType.DIRT, BlockType.GRASS,
      BlockType.SAND, BlockType.WOOD, BlockType.PLANKS,
      BlockType.BRICK, BlockType.GLASS, BlockType.COBBLESTONE,
    ];

    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("div");
      slot.className = "hotbar-slot" + (i === 0 ? " active" : "");
      slot.dataset.slot = i;

      const num = document.createElement("span");
      num.className = "slot-num";
      num.textContent = i + 1;
      slot.appendChild(num);

      const preview = document.createElement("div");
      preview.className = "block-preview";
      const blockType = placeableBlocks[i] || BlockType.STONE;
      const color = registry.getColor(blockType);
      const colorHex = color !== null ? `#${color.toString(16).padStart(6, "0")}` : "transparent";
      const style = this._blockPreviewStyle(colorHex);
      preview.style.background = style.background;
      if (style.boxShadow) preview.style.boxShadow = style.boxShadow;
      preview.dataset.blockType = blockType;
      slot.appendChild(preview);

      slot.addEventListener("click", () => this.selectSlot(i));
      hotbar.appendChild(slot);
      this.hotbarSlots.push({ element: slot, blockType });
    }
  }

  _initMinimap() {
    const canvas = document.getElementById("minimap-canvas");
    if (canvas) {
      this.minimapCtx = canvas.getContext("2d");
    }
  }

  _initInventory() {
    const grid = document.getElementById("inventory-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const allBlocks = registry.getAllPlaceable();
    for (const block of allBlocks) {
      const slot = document.createElement("div");
      slot.className = "inv-slot";
      slot.title = block.name;
      const colorHex = block.color !== null ? `#${block.color.toString(16).padStart(6, "0")}` : "transparent";
      const style = this._blockPreviewStyle(colorHex);
      slot.style.background = style.background;
      if (style.boxShadow) slot.style.boxShadow = style.boxShadow;
      slot.dataset.blockType = block.id;

      slot.addEventListener("click", () => {
        if (this.hotbarSlots[this.selectedSlot]) {
          this.hotbarSlots[this.selectedSlot].blockType = block.id;
          const preview = this.hotbarSlots[this.selectedSlot].element.querySelector(".block-preview");
          if (preview) {
            // Use texture atlas if available, otherwise CSS gradient
            if (this._textureAtlas) {
              const dataURL = this._textureAtlas.getTextureDataURL(block.id, "top");
              if (dataURL) {
                preview.style.background = `url(${dataURL})`;
                preview.style.backgroundSize = "cover";
                preview.style.imageRendering = "pixelated";
                preview.style.boxShadow = "none";
              }
            } else {
              const newStyle = this._blockPreviewStyle(colorHex);
              preview.style.background = newStyle.background;
              if (newStyle.boxShadow) preview.style.boxShadow = newStyle.boxShadow;
            }
            preview.dataset.blockType = block.id;
          }
        }
      });

      grid.appendChild(slot);
    }

    // Close button
    const closeBtn = document.getElementById("inventory-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        document.getElementById("inventory-panel")?.classList.add("hidden");
      });
    }
  }

  /** Update hotbar block previews with actual texture atlas images */
  updateHotbarTextures(textureAtlas) {
    if (!textureAtlas) return;
    for (const slot of this.hotbarSlots) {
      const preview = slot.element.querySelector(".block-preview");
      if (!preview) continue;
      const blockType = slot.blockType;
      const dataURL = textureAtlas.getTextureDataURL(blockType, "top");
      if (dataURL) {
        preview.style.background = `url(${dataURL})`;
        preview.style.backgroundSize = "cover";
        preview.style.imageRendering = "pixelated";
        preview.style.boxShadow = "none";
      }
    }
    this._textureAtlas = textureAtlas;
  }

  selectSlot(index) {
    this.hotbarSlots.forEach((slot, i) => {
      slot.element.classList.toggle("active", i === index);
    });
    this.selectedSlot = index;
  }

  getSelectedBlockType() {
    return this.hotbarSlots[this.selectedSlot]?.blockType || BlockType.STONE;
  }

  updateHUD(data) {
    if (data.virtualBlock !== undefined) {
      const el = document.getElementById("hud-vblock");
      if (el) el.textContent = data.virtualBlock;
    }
    if (data.realBlock !== undefined) {
      const el = document.getElementById("hud-rblock");
      if (el) el.textContent = data.realBlock;
    }
    if (data.fps !== undefined) {
      const el = document.getElementById("hud-fps");
      if (el) el.textContent = `FPS: ${data.fps}`;
    }
    if (data.position) {
      const el = document.getElementById("hud-pos");
      if (el) {
        el.textContent = `X: ${Math.floor(data.position.x)} Y: ${Math.floor(data.position.y)} Z: ${Math.floor(data.position.z)}`;
      }
    }
    if (data.walletAddress) {
      const el = document.getElementById("wallet-addr");
      if (el) {
        el.textContent = data.walletAddress.substring(0, 6) + "..." + data.walletAddress.substring(38);
      }
    }
  }

  /** Update block info tooltip when looking at a block */
  showBlockInfo(blockType, pos) {
    const info = document.getElementById("block-info");
    if (!info) return;
    if (blockType === 0 || blockType === undefined) {
      info.classList.add("hidden");
      return;
    }
    info.classList.remove("hidden");
    const nameEl = document.getElementById("block-info-name");
    const posEl = document.getElementById("block-info-pos");
    if (nameEl) nameEl.textContent = registry.getName(blockType);
    if (posEl) posEl.textContent = `(${pos.x}, ${pos.y}, ${pos.z})`;
  }

  /**
   * Add chat message with Minecraft-style fade animation.
   * Reference: minecraft-web-client Chat.css fade behavior (MIT).
   */
  addChatMessage(text, color = "#ffffff") {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    const msg = document.createElement("div");
    msg.className = "chat-msg";
    msg.style.color = color;
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;

    // Minecraft-style fade: visible 5s, then 3s fade, then hidden
    setTimeout(() => {
      msg.classList.add("fading");
    }, 5000);
    setTimeout(() => {
      msg.classList.remove("fading");
      msg.classList.add("faded");
    }, 8000);

    // Store
    this.chatMessages.push({ text, color, time: Date.now() });
    if (this.chatMessages.length > 100) {
      this.chatMessages.shift();
      const first = container.firstChild;
      if (first) container.removeChild(first);
    }
  }

  /** Update minimap based on world and player position */
  updateMinimap(worldManager, playerPos) {
    if (!this.minimapCtx) return;
    const ctx = this.minimapCtx;
    const size = 150;
    const blockSize = 2;
    const radius = Math.floor(size / (blockSize * 2));

    ctx.fillStyle = "#0a1a0a";
    ctx.fillRect(0, 0, size, size);

    const px = Math.floor(playerPos.x);
    const pz = Math.floor(playerPos.z);

    for (let dz = -radius; dz <= radius; dz++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const wx = px + dx;
        const wz = pz + dz;

        // Find top block
        let topBlock = 0;
        for (let y = 60; y >= 0; y--) {
          const block = worldManager.getBlock(wx, y, wz);
          if (block !== 0) {
            topBlock = block;
            break;
          }
        }

        if (topBlock !== 0) {
          const color = registry.getTopColor(topBlock);
          ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
          const sx = (dx + radius) * blockSize;
          const sy = (dz + radius) * blockSize;
          ctx.fillRect(sx, sy, blockSize, blockSize);
        }
      }
    }

    // Player dot
    ctx.fillStyle = "#ff0000";
    const centerX = size / 2;
    const centerY = size / 2;
    ctx.fillRect(centerX - 2, centerY - 2, 4, 4);
  }

  /** Set connection status indicator */
  setConnectionStatus(connected) {
    const indicator = document.getElementById("connection-status");
    if (indicator) {
      indicator.className = connected ? "conn-status connected" : "conn-status disconnected";
      indicator.title = connected ? "Connected to VoxelChain node" : "Disconnected";
    }
  }

  /** Set up chat input handler with a send callback */
  setupChatInput(onSendMessage) {
    const chatInput = document.getElementById("chat-input");
    if (!chatInput) return;
    chatInput.addEventListener("keydown", (e) => {
      if (e.code === "Enter" && chatInput.value.trim()) {
        const message = chatInput.value.trim();
        chatInput.value = "";
        chatInput.classList.add("hidden");
        if (onSendMessage) onSendMessage(message);
      }
      if (e.code === "Escape") {
        chatInput.value = "";
        chatInput.classList.add("hidden");
      }
      e.stopPropagation();
    });
  }

  /** Initialize crafting panel */
  _initCrafting() {
    const closeBtn = document.getElementById("crafting-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        document.getElementById("crafting-panel")?.classList.add("hidden");
      });
    }
  }

  /** Update crafting panel with recipes */
  updateCraftingPanel(craftingSystem) {
    const grid = document.getElementById("crafting-grid");
    if (!grid || !craftingSystem) return;
    grid.innerHTML = "";

    const recipes = craftingSystem.getRecipes();
    for (const recipe of recipes) {
      const row = document.createElement("div");
      const canCraft = craftingSystem.canCraft(recipe.id);
      row.className = "craft-recipe" + (canCraft ? "" : " disabled");

      // Build inputs text
      const inputsText = recipe.inputs
        .map((inp) => `<span class="craft-count">${inp.count}x</span> <span class="craft-input">${registry.getName(inp.type)}</span>`)
        .join(" + ");

      row.innerHTML = `${inputsText} <span class="craft-arrow">-></span> <span class="craft-count">${recipe.output.count}x</span> <span class="craft-output">${recipe.output.name}</span>`;

      if (canCraft) {
        row.addEventListener("click", () => {
          const result = craftingSystem.craft(recipe.id);
          if (result && result.success) {
            this.addChatMessage(`Crafted ${result.output.count}x ${result.recipe}`, "#10b981");
            this.updateCraftingPanel(craftingSystem);
          }
        });
      }
      grid.appendChild(row);
    }
  }

  /** Update survival HUD (HP bar, hunger bar) */
  updateSurvivalHUD(survivalSystem) {
    if (!survivalSystem) return;
    const isSurvival = survivalSystem.gameMode === "survival";

    // Show/hide survival HUD
    const survHud = document.getElementById("survival-hud");
    if (survHud) {
      if (isSurvival) {
        survHud.classList.remove("hidden");
      } else {
        survHud.classList.add("hidden");
      }
    }

    if (!isSurvival) return;

    // HP bar
    const hpFill = document.getElementById("hp-fill");
    const hpLabel = document.getElementById("hp-label");
    if (hpFill) hpFill.style.width = `${(survivalSystem.hp / survivalSystem.maxHp) * 100}%`;
    if (hpLabel) hpLabel.textContent = `${Math.ceil(survivalSystem.hp)}/${survivalSystem.maxHp}`;

    // Hunger bar
    const hungerFill = document.getElementById("hunger-fill");
    const hungerLabel = document.getElementById("hunger-label");
    if (hungerFill) hungerFill.style.width = `${(survivalSystem.hunger / survivalSystem.maxHunger) * 100}%`;
    if (hungerLabel) hungerLabel.textContent = `${Math.ceil(survivalSystem.hunger)}/${survivalSystem.maxHunger}`;

    // Damage flash
    const flash = document.getElementById("damage-flash");
    if (flash) {
      flash.style.opacity = survivalSystem.isDamageFlashing() ? survivalSystem.getDamageFlashIntensity() : 0;
    }

    // Death screen
    const deathScreen = document.getElementById("death-screen");
    if (deathScreen) {
      if (survivalSystem.isRespawning()) {
        deathScreen.classList.remove("hidden");
        const progressFill = document.getElementById("death-progress-fill");
        if (progressFill) progressFill.style.width = `${survivalSystem.getRespawnProgress() * 100}%`;
        const deathMsg = document.getElementById("death-message");
        if (deathMsg) deathMsg.textContent = `Deaths: ${survivalSystem.deathCount}`;
      } else {
        deathScreen.classList.add("hidden");
      }
    }
  }

  /** Update game mode display */
  updateGameModeDisplay(mode) {
    const el = document.getElementById("hud-gamemode");
    if (el) {
      el.textContent = mode === "survival" ? "Survival" : "Creative";
      el.style.color = mode === "survival" ? "#ff5555" : "#ffaa00";
    }
    const btn = document.getElementById("gamemode-btn");
    if (btn) {
      btn.textContent = mode === "survival" ? "Creative" : "Survival";
    }
  }

  /** Update inventory count overlay on hotbar */
  updateInventoryCounts(survivalSystem) {
    const overlay = document.getElementById("inv-count-overlay");
    if (!overlay) return;

    if (!survivalSystem || survivalSystem.gameMode !== "survival") {
      overlay.classList.add("hidden");
      return;
    }
    overlay.classList.remove("hidden");
    overlay.innerHTML = "";

    for (let i = 0; i < 9; i++) {
      const slot = document.createElement("div");
      slot.className = "inv-count-slot";
      const blockType = this.hotbarSlots[i]?.blockType;
      if (blockType !== undefined) {
        const count = survivalSystem.getInventoryCount(blockType);
        if (count > 0) {
          const num = document.createElement("span");
          num.className = "inv-count-num";
          num.textContent = count;
          slot.appendChild(num);
        }
      }
      overlay.appendChild(slot);
    }
  }

  /** Set loading progress */
  setLoadProgress(percent, status = "") {
    const fill = document.getElementById("load-progress");
    const statusEl = document.getElementById("load-status");
    if (fill) fill.style.width = `${percent}%`;
    if (statusEl && status) statusEl.textContent = status;
  }

  /** Hide loading screen */
  hideLoading() {
    const loading = document.getElementById("loading");
    if (loading) {
      loading.style.opacity = "0";
      loading.style.transition = "opacity 0.5s";
      setTimeout(() => {
        loading.style.display = "none";
      }, 500);
    }
  }
}
