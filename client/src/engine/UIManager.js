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

    this._initHotbar();
    this._initMinimap();
    this._initInventory();
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
      preview.style.background = color !== null ? `#${color.toString(16).padStart(6, "0")}` : "transparent";
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
      slot.style.background = colorHex;
      slot.dataset.blockType = block.id;

      slot.addEventListener("click", () => {
        if (this.hotbarSlots[this.selectedSlot]) {
          this.hotbarSlots[this.selectedSlot].blockType = block.id;
          const preview = this.hotbarSlots[this.selectedSlot].element.querySelector(".block-preview");
          if (preview) {
            preview.style.background = colorHex;
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

  /** Add chat message */
  addChatMessage(text, color = "#e0e0e0") {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    const msg = document.createElement("div");
    msg.className = "chat-msg";
    msg.style.color = color;
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;

    // Auto-fade after 10 seconds
    setTimeout(() => {
      msg.classList.add("faded");
    }, 10000);

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
