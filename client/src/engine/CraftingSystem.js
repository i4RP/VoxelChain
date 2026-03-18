/**
 * CraftingSystem - Basic crafting recipes for VoxelChain survival mode.
 * Converts raw materials into processed items.
 */

import { BlockType } from "./BlockRegistry.js";

/** Each recipe: { inputs: [{type, count}], output: {type, count} } */
const RECIPES = [
  // Wood -> Planks (4)
  {
    id: "wood_to_planks",
    name: "Planks",
    inputs: [{ type: BlockType.WOOD, count: 1 }],
    output: { type: BlockType.PLANKS, count: 4 },
  },
  // Cobblestone -> Stone (smelting)
  {
    id: "cobble_to_stone",
    name: "Stone",
    inputs: [{ type: BlockType.COBBLESTONE, count: 1 }],
    output: { type: BlockType.STONE, count: 1 },
  },
  // Sand -> Glass (smelting)
  {
    id: "sand_to_glass",
    name: "Glass",
    inputs: [{ type: BlockType.SAND, count: 1 }],
    output: { type: BlockType.GLASS, count: 1 },
  },
  // Clay -> Brick
  {
    id: "clay_to_brick",
    name: "Brick",
    inputs: [{ type: BlockType.CLAY, count: 4 }],
    output: { type: BlockType.BRICK, count: 1 },
  },
  // Stone -> Cobblestone (chiseling)
  {
    id: "stone_to_cobble",
    name: "Cobblestone",
    inputs: [{ type: BlockType.STONE, count: 1 }],
    output: { type: BlockType.COBBLESTONE, count: 1 },
  },
  // Snow + Snow -> Ice
  {
    id: "snow_to_ice",
    name: "Ice",
    inputs: [{ type: BlockType.SNOW, count: 4 }],
    output: { type: BlockType.ICE, count: 1 },
  },
  // Obsidian from lava concept: cobblestone + ice
  {
    id: "cobble_ice_to_obsidian",
    name: "Obsidian",
    inputs: [
      { type: BlockType.COBBLESTONE, count: 4 },
      { type: BlockType.ICE, count: 1 },
    ],
    output: { type: BlockType.OBSIDIAN, count: 1 },
  },
];

/** Food items that can be consumed to restore hunger */
const FOOD_ITEMS = {
  // Using existing block types as food sources (simplified)
  // In a full game these would be separate item types
};

export class CraftingSystem {
  constructor(survivalSystem) {
    this._survival = survivalSystem;
  }

  /** Get all recipes */
  getRecipes() {
    return RECIPES;
  }

  /** Get recipes that can be crafted with current inventory */
  getAvailableRecipes() {
    return RECIPES.filter((recipe) => this.canCraft(recipe.id));
  }

  /** Check if a recipe can be crafted */
  canCraft(recipeId) {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe) return false;

    for (const input of recipe.inputs) {
      const count = this._survival.getInventoryCount(input.type);
      if (count < input.count) return false;
    }
    return true;
  }

  /** Craft a recipe. Returns output or null if cannot craft. */
  craft(recipeId) {
    const recipe = RECIPES.find((r) => r.id === recipeId);
    if (!recipe || !this.canCraft(recipeId)) return null;

    // Consume inputs
    for (const input of recipe.inputs) {
      this._survival.removeFromInventory(input.type, input.count);
    }

    // Add output
    this._survival.addToInventory(recipe.output.type, recipe.output.count);

    return {
      success: true,
      output: recipe.output,
      recipe: recipe.name,
    };
  }

  /** Get recipe by ID */
  getRecipe(recipeId) {
    return RECIPES.find((r) => r.id === recipeId) || null;
  }
}
