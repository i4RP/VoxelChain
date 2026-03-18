/**
 * Procedural texture atlas generator for VoxelChain.
 * Generates 16x16 pixel-art textures for all block types
 * and packs them into a single atlas texture for GPU efficiency.
 */

import * as THREE from "three";
import { BlockType } from "./BlockRegistry.js";

const TEX_SIZE = 16; // pixels per texture
const ATLAS_COLS = 8; // textures per row in atlas

/**
 * Draw pixel art patterns on a canvas context at (ox, oy) offset.
 * Each texture is TEX_SIZE x TEX_SIZE pixels.
 */
function drawPixels(ctx, ox, oy, pixels) {
  for (const [x, y, color] of pixels) {
    ctx.fillStyle = color;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }
}

/** Fill a TEX_SIZE region with a base color */
function fillBase(ctx, ox, oy, color) {
  ctx.fillStyle = color;
  ctx.fillRect(ox, oy, TEX_SIZE, TEX_SIZE);
}

/** Add noise variation to a filled region */
function addNoise(ctx, ox, oy, baseR, baseG, baseB, intensity, seed) {
  const imageData = ctx.getImageData(ox, oy, TEX_SIZE, TEX_SIZE);
  const d = imageData.data;
  let h = seed;
  for (let i = 0; i < TEX_SIZE * TEX_SIZE; i++) {
    h = ((h * 1103515245 + 12345) & 0x7fffffff);
    const noise = ((h % 256) / 255 - 0.5) * intensity;
    const idx = i * 4;
    d[idx] = Math.max(0, Math.min(255, d[idx] + noise * 255));
    d[idx + 1] = Math.max(0, Math.min(255, d[idx + 1] + noise * 255));
    d[idx + 2] = Math.max(0, Math.min(255, d[idx + 2] + noise * 255));
  }
  ctx.putImageData(imageData, ox, oy);
}

// --- Individual texture drawing functions ---

function drawStone(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#808080");
  addNoise(ctx, ox, oy, 128, 128, 128, 0.12, 101);
  // Cracks
  const cracks = [
    [3, 5, "#6b6b6b"], [4, 5, "#6b6b6b"], [5, 6, "#6b6b6b"],
    [9, 3, "#6b6b6b"], [10, 3, "#6b6b6b"], [10, 4, "#6b6b6b"],
    [2, 11, "#6b6b6b"], [3, 11, "#6b6b6b"], [4, 12, "#6b6b6b"],
    [12, 9, "#707070"], [13, 10, "#707070"], [13, 11, "#707070"],
    [7, 13, "#6b6b6b"], [8, 14, "#6b6b6b"],
  ];
  drawPixels(ctx, ox, oy, cracks);
}

function drawDirt(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#8b6914");
  addNoise(ctx, ox, oy, 139, 105, 20, 0.15, 201);
  // Pebbles/spots
  const spots = [
    [3, 4, "#7a5a10"], [4, 4, "#7a5a10"],
    [10, 7, "#7a5a10"], [11, 7, "#7a5a10"],
    [6, 12, "#9b7924"], [7, 12, "#9b7924"],
    [2, 9, "#7a5a10"], [13, 3, "#9b7924"],
    [8, 2, "#7a5a10"], [5, 14, "#9b7924"],
  ];
  drawPixels(ctx, ox, oy, spots);
}

function drawGrassTop(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#5a9b2a");
  addNoise(ctx, ox, oy, 90, 155, 42, 0.1, 301);
  // Darker grass tufts
  const tufts = [
    [2, 3, "#4a8b1a"], [3, 3, "#4a8b1a"],
    [7, 1, "#4a8b1a"], [8, 1, "#4a8b1a"],
    [12, 5, "#4a8b1a"], [13, 5, "#4a8b1a"],
    [5, 9, "#4a8b1a"], [10, 11, "#4a8b1a"],
    [1, 13, "#4a8b1a"], [14, 8, "#4a8b1a"],
    [4, 7, "#6aab3a"], [9, 14, "#6aab3a"],
  ];
  drawPixels(ctx, ox, oy, tufts);
}

function drawGrassSide(ctx, ox, oy) {
  // Top 3 pixels = grass
  ctx.fillStyle = "#5a9b2a";
  ctx.fillRect(ox, oy, TEX_SIZE, 4);
  // Grass-dirt transition
  const transition = [
    [0, 4, "#5a9b2a"], [2, 4, "#8b6914"], [3, 4, "#5a9b2a"], [4, 4, "#8b6914"],
    [5, 4, "#5a9b2a"], [7, 4, "#8b6914"], [8, 4, "#8b6914"], [9, 4, "#5a9b2a"],
    [10, 4, "#8b6914"], [12, 4, "#5a9b2a"], [14, 4, "#8b6914"], [15, 4, "#8b6914"],
    [1, 4, "#8b6914"], [6, 4, "#8b6914"], [11, 4, "#8b6914"], [13, 4, "#5a9b2a"],
    [0, 5, "#8b6914"], [3, 5, "#5a9b2a"], [5, 5, "#8b6914"], [9, 5, "#8b6914"],
    [12, 5, "#8b6914"], [13, 5, "#8b6914"],
  ];
  // Bottom = dirt
  ctx.fillStyle = "#8b6914";
  ctx.fillRect(ox, oy + 4, TEX_SIZE, 12);
  drawPixels(ctx, ox, oy, transition);
  addNoise(ctx, ox, oy + 5, 139, 105, 20, 0.1, 302);
}

function drawSand(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#e8c872");
  addNoise(ctx, ox, oy, 232, 200, 114, 0.08, 401);
  const grains = [
    [3, 5, "#d4b462"], [7, 2, "#d4b462"], [12, 8, "#d4b462"],
    [5, 11, "#d4b462"], [10, 14, "#f0d882"], [1, 8, "#f0d882"],
    [14, 3, "#d4b462"], [8, 7, "#f0d882"],
  ];
  drawPixels(ctx, ox, oy, grains);
}

function drawWater(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#2856a8");
  addNoise(ctx, ox, oy, 40, 86, 168, 0.08, 501);
  // Wave highlights
  const waves = [
    [2, 3, "#3868c0"], [3, 3, "#3868c0"], [4, 3, "#3868c0"],
    [8, 7, "#3868c0"], [9, 7, "#3868c0"], [10, 7, "#3868c0"],
    [1, 11, "#3868c0"], [2, 11, "#3868c0"], [3, 11, "#3868c0"],
    [11, 14, "#3868c0"], [12, 14, "#3868c0"],
  ];
  drawPixels(ctx, ox, oy, waves);
}

function drawWoodSide(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#6b5020");
  addNoise(ctx, ox, oy, 107, 80, 32, 0.08, 601);
  // Bark lines (horizontal)
  for (let y = 0; y < TEX_SIZE; y += 3) {
    ctx.fillStyle = y % 6 === 0 ? "#5a4018" : "#7b6030";
    ctx.fillRect(ox, oy + y, TEX_SIZE, 1);
  }
  // Bark detail
  const bark = [
    [5, 1, "#5a4018"], [6, 2, "#5a4018"],
    [11, 4, "#5a4018"], [12, 5, "#5a4018"],
    [3, 8, "#5a4018"], [4, 9, "#5a4018"],
    [9, 11, "#5a4018"], [10, 12, "#5a4018"],
  ];
  drawPixels(ctx, ox, oy, bark);
}

function drawWoodTop(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#9b7924");
  addNoise(ctx, ox, oy, 155, 121, 36, 0.08, 602);
  // Tree rings (concentric)
  ctx.strokeStyle = "#7b5904";
  ctx.lineWidth = 1;
  const cx = ox + 8, cy = oy + 8;
  for (let r = 2; r <= 6; r += 2) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  // Center
  ctx.fillStyle = "#5a3a04";
  ctx.fillRect(ox + 7, oy + 7, 2, 2);
}

function drawLeaves(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#2d7a2d");
  addNoise(ctx, ox, oy, 45, 122, 45, 0.15, 701);
  // Leaf pattern - lighter spots
  const leaves = [
    [2, 2, "#3d8a3d"], [3, 2, "#3d8a3d"], [4, 3, "#3d8a3d"],
    [8, 1, "#3d8a3d"], [9, 2, "#3d8a3d"],
    [13, 4, "#3d8a3d"], [14, 5, "#3d8a3d"],
    [1, 7, "#3d8a3d"], [2, 8, "#3d8a3d"],
    [6, 9, "#1d6a1d"], [7, 10, "#1d6a1d"],
    [11, 12, "#3d8a3d"], [12, 11, "#3d8a3d"],
    [4, 14, "#1d6a1d"], [5, 13, "#1d6a1d"],
    [10, 6, "#3d8a3d"], [15, 9, "#1d6a1d"],
  ];
  drawPixels(ctx, ox, oy, leaves);
}

function drawBrick(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#8b3322");
  // Mortar lines
  ctx.fillStyle = "#b0a090";
  for (let y = 0; y < TEX_SIZE; y += 4) {
    ctx.fillRect(ox, oy + y + 3, TEX_SIZE, 1);
  }
  // Vertical mortar (offset every other row)
  for (let row = 0; row < 4; row++) {
    const baseY = row * 4;
    const offset = (row % 2) * 8;
    ctx.fillStyle = "#b0a090";
    ctx.fillRect(ox + offset, oy + baseY, 1, 3);
    if (offset + 8 < TEX_SIZE) {
      ctx.fillRect(ox + offset + 8, oy + baseY, 1, 3);
    }
  }
  addNoise(ctx, ox, oy, 139, 51, 34, 0.06, 801);
}

function drawGlass(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#c8e8f8");
  // Frame edges
  ctx.fillStyle = "#708898";
  ctx.fillRect(ox, oy, TEX_SIZE, 1);
  ctx.fillRect(ox, oy + 15, TEX_SIZE, 1);
  ctx.fillRect(ox, oy, 1, TEX_SIZE);
  ctx.fillRect(ox + 15, oy, 1, TEX_SIZE);
  // Shine highlight
  const shine = [
    [3, 3, "#e0f4ff"], [4, 3, "#e0f4ff"], [3, 4, "#e0f4ff"],
    [4, 4, "#e0f4ff"], [5, 5, "#d8ecf8"],
  ];
  drawPixels(ctx, ox, oy, shine);
}

function drawOre(ctx, ox, oy, oreColor, seed) {
  // Stone base
  drawStone(ctx, ox, oy);
  // Ore spots
  const spots = [
    [4, 3], [5, 3], [5, 4], [4, 4],
    [10, 7], [11, 7], [11, 8], [10, 8],
    [7, 11], [8, 11], [8, 12], [7, 12],
    [2, 9], [13, 5],
  ];
  for (const [x, y] of spots) {
    ctx.fillStyle = oreColor;
    ctx.fillRect(ox + x, oy + y, 1, 1);
  }
}

function drawBedrock(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#3a3a3a");
  addNoise(ctx, ox, oy, 58, 58, 58, 0.2, 1301);
  // Dark crevices
  const cracks = [
    [2, 3, "#1a1a1a"], [3, 4, "#1a1a1a"], [4, 3, "#2a2a2a"],
    [8, 7, "#1a1a1a"], [9, 8, "#1a1a1a"],
    [12, 2, "#1a1a1a"], [13, 3, "#2a2a2a"],
    [5, 12, "#1a1a1a"], [6, 11, "#2a2a2a"],
    [14, 10, "#1a1a1a"], [1, 14, "#2a2a2a"],
  ];
  drawPixels(ctx, ox, oy, cracks);
}

function drawCobblestone(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#7a7a7a");
  addNoise(ctx, ox, oy, 122, 122, 122, 0.1, 1401);
  // Stone edges
  ctx.fillStyle = "#606060";
  ctx.fillRect(ox + 0, oy + 4, 8, 1);
  ctx.fillRect(ox + 8, oy + 7, 8, 1);
  ctx.fillRect(ox + 0, oy + 11, 8, 1);
  ctx.fillRect(ox + 4, oy + 0, 1, 4);
  ctx.fillRect(ox + 12, oy + 4, 1, 3);
  ctx.fillRect(ox + 6, oy + 7, 1, 4);
  ctx.fillRect(ox + 10, oy + 11, 1, 5);
}

function drawPlanks(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#bc9451");
  addNoise(ctx, ox, oy, 188, 148, 81, 0.06, 1501);
  // Plank lines
  ctx.fillStyle = "#a07a3a";
  ctx.fillRect(ox, oy + 3, TEX_SIZE, 1);
  ctx.fillRect(ox, oy + 7, TEX_SIZE, 1);
  ctx.fillRect(ox, oy + 11, TEX_SIZE, 1);
  ctx.fillRect(ox, oy + 15, TEX_SIZE, 1);
  // Wood grain
  const grain = [
    [3, 1, "#c8a461"], [5, 5, "#c8a461"], [10, 2, "#c8a461"],
    [7, 9, "#c8a461"], [12, 13, "#c8a461"], [2, 14, "#a07a3a"],
  ];
  drawPixels(ctx, ox, oy, grain);
}

function drawSnow(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#f0f0f8");
  addNoise(ctx, ox, oy, 240, 240, 248, 0.03, 1601);
  // Slight blue shadows
  const shadows = [
    [3, 5, "#e0e0f0"], [4, 5, "#e0e0f0"],
    [10, 9, "#e0e0f0"], [11, 9, "#e0e0f0"],
    [6, 13, "#e0e0f0"], [7, 13, "#e0e0f0"],
  ];
  drawPixels(ctx, ox, oy, shadows);
}

function drawIce(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#98d0e8");
  addNoise(ctx, ox, oy, 152, 208, 232, 0.05, 1701);
  // Cracks
  const cracks = [
    [3, 2, "#80c0d8"], [4, 3, "#80c0d8"], [5, 4, "#80c0d8"],
    [10, 8, "#80c0d8"], [11, 9, "#80c0d8"],
    [7, 12, "#80c0d8"], [8, 13, "#80c0d8"],
  ];
  drawPixels(ctx, ox, oy, cracks);
  // Shine
  const shine = [
    [2, 1, "#b8e8ff"], [3, 1, "#b8e8ff"],
    [12, 5, "#b8e8ff"], [13, 5, "#b8e8ff"],
  ];
  drawPixels(ctx, ox, oy, shine);
}

function drawLava(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#d04000");
  addNoise(ctx, ox, oy, 208, 64, 0, 0.12, 1801);
  // Hot spots
  const hot = [
    [3, 3, "#ff6020"], [4, 3, "#ff6020"], [5, 4, "#ff8040"],
    [4, 4, "#ffa060"], [3, 4, "#ff6020"],
    [10, 8, "#ff6020"], [11, 8, "#ff6020"], [11, 9, "#ff8040"],
    [10, 9, "#ffa060"],
    [6, 12, "#ff6020"], [7, 12, "#ff8040"], [7, 13, "#ffa060"],
    [2, 8, "#ff4000"], [13, 3, "#ff4000"],
  ];
  drawPixels(ctx, ox, oy, hot);
}

function drawObsidian(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#1a0a2a");
  addNoise(ctx, ox, oy, 26, 10, 42, 0.08, 1901);
  // Purple sheen
  const sheen = [
    [4, 3, "#2a1a3a"], [5, 4, "#2a1a3a"],
    [10, 8, "#2a1a3a"], [11, 7, "#2a1a3a"],
    [7, 12, "#2a1a3a"], [3, 10, "#2a1a3a"],
    [13, 13, "#2a1a3a"],
  ];
  drawPixels(ctx, ox, oy, sheen);
}

function drawCite(ctx, ox, oy) {
  fillBase(ctx, ox, oy, "#a0967a");
  addNoise(ctx, ox, oy, 160, 150, 122, 0.08, 2001);
  const spots = [
    [3, 4, "#90866a"], [7, 2, "#90866a"],
    [11, 9, "#b0a68a"], [5, 12, "#b0a68a"],
    [13, 6, "#90866a"], [1, 10, "#b0a68a"],
  ];
  drawPixels(ctx, ox, oy, spots);
}

// --- Texture face types ---
// Each block can have: top, side, bottom (defaults to side if not specified)

const TEXTURE_FACES = {
  [BlockType.STONE]: { all: "stone" },
  [BlockType.DIRT]: { all: "dirt" },
  [BlockType.GRASS]: { top: "grass_top", side: "grass_side", bottom: "dirt" },
  [BlockType.SAND]: { all: "sand" },
  [BlockType.WATER]: { all: "water" },
  [BlockType.WOOD]: { top: "wood_top", side: "wood_side", bottom: "wood_top" },
  [BlockType.LEAVES]: { all: "leaves" },
  [BlockType.BRICK]: { all: "brick" },
  [BlockType.GLASS]: { all: "glass" },
  [BlockType.IRON_ORE]: { all: "iron_ore" },
  [BlockType.GOLD_ORE]: { all: "gold_ore" },
  [BlockType.DIAMOND_ORE]: { all: "diamond_ore" },
  [BlockType.BEDROCK]: { all: "bedrock" },
  [BlockType.COBBLESTONE]: { all: "cobblestone" },
  [BlockType.PLANKS]: { all: "planks" },
  [BlockType.SNOW]: { all: "snow" },
  [BlockType.ICE]: { all: "ice" },
  [BlockType.LAVA]: { all: "lava" },
  [BlockType.OBSIDIAN]: { all: "obsidian" },
  [BlockType.CLAY]: { all: "clay" },
};

// Map texture names to draw functions
const TEXTURE_DRAWERS = {
  stone: drawStone,
  dirt: drawDirt,
  grass_top: drawGrassTop,
  grass_side: drawGrassSide,
  sand: drawSand,
  water: drawWater,
  wood_side: drawWoodSide,
  wood_top: drawWoodTop,
  leaves: drawLeaves,
  brick: drawBrick,
  glass: drawGlass,
  iron_ore: (ctx, ox, oy) => drawOre(ctx, ox, oy, "#c8a882", 1001),
  gold_ore: (ctx, ox, oy) => drawOre(ctx, ox, oy, "#ffd700", 1101),
  diamond_ore: (ctx, ox, oy) => drawOre(ctx, ox, oy, "#4ae8e8", 1201),
  bedrock: drawBedrock,
  cobblestone: drawCobblestone,
  planks: drawPlanks,
  snow: drawSnow,
  ice: drawIce,
  lava: drawLava,
  obsidian: drawObsidian,
  clay: drawCite,
};

export class TextureAtlas {
  constructor() {
    this.texture = null;
    this.uvMap = {}; // blockType -> { top: [u0,v0,u1,v1], side: [...], bottom: [...] }
    this._texIndexMap = {}; // textureName -> atlas index
    this._atlasSize = 0;
    this._canvas = null;
  }

  /** Generate the texture atlas and UV mapping */
  generate() {
    // Collect unique texture names
    const texNames = new Set();
    for (const faces of Object.values(TEXTURE_FACES)) {
      if (faces.all) texNames.add(faces.all);
      if (faces.top) texNames.add(faces.top);
      if (faces.side) texNames.add(faces.side);
      if (faces.bottom) texNames.add(faces.bottom);
    }

    const texList = [...texNames];
    const count = texList.length;
    const cols = ATLAS_COLS;
    const rows = Math.ceil(count / cols);
    const atlasW = cols * TEX_SIZE;
    const atlasH = rows * TEX_SIZE;

    // Create canvas
    const canvas = document.createElement("canvas");
    canvas.width = atlasW;
    canvas.height = atlasH;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = false;

    // Draw each texture
    texList.forEach((name, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const ox = col * TEX_SIZE;
      const oy = row * TEX_SIZE;

      const drawer = TEXTURE_DRAWERS[name];
      if (drawer) {
        drawer(ctx, ox, oy);
      } else {
        // Fallback: magenta checkerboard (missing texture)
        for (let y = 0; y < TEX_SIZE; y++) {
          for (let x = 0; x < TEX_SIZE; x++) {
            ctx.fillStyle = (x + y) % 2 === 0 ? "#ff00ff" : "#000000";
            ctx.fillRect(ox + x, oy + y, 1, 1);
          }
        }
      }

      this._texIndexMap[name] = i;
    });

    this._atlasSize = { w: atlasW, h: atlasH, cols, rows };
    this._canvas = canvas;

    // Build UV map for each block type
    for (const [blockTypeStr, faces] of Object.entries(TEXTURE_FACES)) {
      const blockType = Number(blockTypeStr);
      const getUV = (texName) => {
        const idx = this._texIndexMap[texName];
        if (idx === undefined) return [0, 0, 1, 1];
        const col = idx % cols;
        const row = Math.floor(idx / cols);
        // UV coordinates (y-flipped for WebGL)
        const u0 = col * TEX_SIZE / atlasW;
        const v0 = 1.0 - (row + 1) * TEX_SIZE / atlasH;
        const u1 = (col + 1) * TEX_SIZE / atlasW;
        const v1 = 1.0 - row * TEX_SIZE / atlasH;
        return [u0, v0, u1, v1];
      };

      if (faces.all) {
        const uv = getUV(faces.all);
        this.uvMap[blockType] = { top: uv, side: uv, bottom: uv };
      } else {
        this.uvMap[blockType] = {
          top: getUV(faces.top || faces.side || "stone"),
          side: getUV(faces.side || "stone"),
          bottom: getUV(faces.bottom || faces.side || "stone"),
        };
      }
    }

    // Create Three.js texture
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.generateMipmaps = false;
    this.texture = tex;

    return this;
  }

  /** Get UV coordinates for a block face */
  getUV(blockType, face) {
    const entry = this.uvMap[blockType];
    if (!entry) return [0, 0, 1, 1]; // fallback
    return entry[face] || entry.side || [0, 0, 1, 1];
  }

  /** Get serializable UV map for WebWorker */
  getSerializableUVMap() {
    return JSON.parse(JSON.stringify(this.uvMap));
  }

  /** Get the canvas element (for hotbar previews) */
  getCanvas() {
    return this._canvas;
  }

  /** Extract a single texture image as data URL for UI use */
  getTextureDataURL(blockType, face) {
    if (!this._canvas) return null;
    const uv = this.getUV(blockType, face || "top");
    const atlasW = this._atlasSize.w;
    const atlasH = this._atlasSize.h;
    const sx = uv[0] * atlasW;
    const sy = (1.0 - uv[3]) * atlasH;

    const small = document.createElement("canvas");
    small.width = TEX_SIZE;
    small.height = TEX_SIZE;
    const sCtx = small.getContext("2d");
    sCtx.drawImage(this._canvas, sx, sy, TEX_SIZE, TEX_SIZE, 0, 0, TEX_SIZE, TEX_SIZE);
    return small.toDataURL();
  }
}
