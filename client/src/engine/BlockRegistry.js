/**
 * Block type registry for VoxelChain.
 * Defines all block types, their properties, and texture colors.
 */

export const BlockType = {
  AIR: 0,
  STONE: 1,
  DIRT: 2,
  GRASS: 3,
  SAND: 4,
  WATER: 5,
  WOOD: 6,
  LEAVES: 7,
  BRICK: 8,
  GLASS: 9,
  IRON_ORE: 10,
  GOLD_ORE: 11,
  DIAMOND_ORE: 12,
  BEDROCK: 13,
  COBBLESTONE: 14,
  PLANKS: 15,
  SNOW: 16,
  ICE: 17,
  LAVA: 18,
  OBSIDIAN: 19,
  CLAY: 20,
};

const BLOCK_DEFS = {
  [BlockType.AIR]: { name: "Air", solid: false, transparent: true, color: null },
  [BlockType.STONE]: { name: "Stone", solid: true, transparent: false, color: 0x808080, topColor: 0x909090, sideColor: 0x707070 },
  [BlockType.DIRT]: { name: "Dirt", solid: true, transparent: false, color: 0x8b4513, topColor: 0x9b5523, sideColor: 0x7b3503 },
  [BlockType.GRASS]: { name: "Grass", solid: true, transparent: false, color: 0x228b22, topColor: 0x32a632, sideColor: 0x8b5513, bottomColor: 0x7b3503 },
  [BlockType.SAND]: { name: "Sand", solid: true, transparent: false, color: 0xf4a460, topColor: 0xffb470, sideColor: 0xe49450 },
  [BlockType.WATER]: { name: "Water", solid: false, transparent: true, color: 0x4169e1, opacity: 0.6 },
  [BlockType.WOOD]: { name: "Wood", solid: true, transparent: false, color: 0x8b6914, topColor: 0x9b7924, sideColor: 0x7b5904 },
  [BlockType.LEAVES]: { name: "Leaves", solid: true, transparent: true, color: 0x006400, opacity: 0.85 },
  [BlockType.BRICK]: { name: "Brick", solid: true, transparent: false, color: 0xb22222 },
  [BlockType.GLASS]: { name: "Glass", solid: true, transparent: true, color: 0x87ceeb, opacity: 0.3 },
  [BlockType.IRON_ORE]: { name: "Iron Ore", solid: true, transparent: false, color: 0xa0522d, topColor: 0xb06030 },
  [BlockType.GOLD_ORE]: { name: "Gold Ore", solid: true, transparent: false, color: 0xffd700, topColor: 0xffe720 },
  [BlockType.DIAMOND_ORE]: { name: "Diamond Ore", solid: true, transparent: false, color: 0x00ced1, topColor: 0x10dee1 },
  [BlockType.BEDROCK]: { name: "Bedrock", solid: true, transparent: false, color: 0x2f4f4f, unbreakable: true },
  [BlockType.COBBLESTONE]: { name: "Cobblestone", solid: true, transparent: false, color: 0x696969 },
  [BlockType.PLANKS]: { name: "Planks", solid: true, transparent: false, color: 0xdeb887 },
  [BlockType.SNOW]: { name: "Snow", solid: true, transparent: false, color: 0xfffafa, topColor: 0xffffff },
  [BlockType.ICE]: { name: "Ice", solid: true, transparent: true, color: 0xb0e0e6, opacity: 0.7 },
  [BlockType.LAVA]: { name: "Lava", solid: false, transparent: false, color: 0xff4500, emissive: 0xff2200, emissiveIntensity: 0.8 },
  [BlockType.OBSIDIAN]: { name: "Obsidian", solid: true, transparent: false, color: 0x1c1c1c },
  [BlockType.CLAY]: { name: "Clay", solid: true, transparent: false, color: 0xbdb76b },
};

export class BlockRegistry {
  constructor() {
    this.blocks = new Map();
    for (const [id, def] of Object.entries(BLOCK_DEFS)) {
      this.blocks.set(Number(id), { id: Number(id), ...def });
    }
  }

  get(id) {
    return this.blocks.get(id) || this.blocks.get(BlockType.AIR);
  }

  getName(id) {
    const block = this.get(id);
    return block ? block.name : "Unknown";
  }

  isSolid(id) {
    const block = this.get(id);
    return block ? block.solid : false;
  }

  isTransparent(id) {
    const block = this.get(id);
    return block ? block.transparent : true;
  }

  getColor(id) {
    const block = this.get(id);
    return block ? block.color : null;
  }

  getTopColor(id) {
    const block = this.get(id);
    return block?.topColor || block?.color || 0x808080;
  }

  getSideColor(id) {
    const block = this.get(id);
    return block?.sideColor || block?.color || 0x808080;
  }

  getBottomColor(id) {
    const block = this.get(id);
    return block?.bottomColor || block?.sideColor || block?.color || 0x808080;
  }

  getAllPlaceable() {
    const list = [];
    for (const [id, block] of this.blocks) {
      if (id !== BlockType.AIR && id !== BlockType.BEDROCK) {
        list.push(block);
      }
    }
    return list;
  }
}

export const registry = new BlockRegistry();
