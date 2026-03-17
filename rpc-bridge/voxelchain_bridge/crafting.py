"""Crafting system for VoxelChain.

Defines recipes and handles crafting operations.
Recipes are 3x3 grid patterns (like Minecraft) or shapeless.
"""

import logging
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class CraftingRecipe:
    """A crafting recipe definition."""
    recipe_id: str
    result_type: int
    result_count: int
    pattern: List[List[int]]  # 3x3 grid of block type IDs (0 = empty)
    shapeless: bool = False   # If True, pattern order doesn't matter
    category: str = "blocks"

    def get_ingredients(self) -> Dict[int, int]:
        """Get ingredient counts from pattern."""
        ingredients: Dict[int, int] = {}
        for row in self.pattern:
            for item in row:
                if item != 0:
                    ingredients[item] = ingredients.get(item, 0) + 1
        return ingredients


# Block type constants
STONE = 1
DIRT = 2
SAND = 4
WOOD = 6
COBBLESTONE = 14
PLANKS = 15
CLAY = 20

# Tool/material token ranges
WOODEN_PICKAXE = 10001
STONE_PICKAXE = 10002
IRON_PICKAXE = 10003
WOODEN_AXE = 10004
STONE_AXE = 10005
WOODEN_SHOVEL = 10006
STICK = 20001
IRON_INGOT = 20002
GOLD_INGOT = 20003
DIAMOND_GEM = 20004
BRICK_ITEM = 20005
GLASS_PANE = 20006

# Recipe definitions
RECIPES: List[CraftingRecipe] = [
    # Wood -> Planks (4)
    CraftingRecipe(
        recipe_id="wood_to_planks",
        result_type=PLANKS,
        result_count=4,
        pattern=[[WOOD, 0, 0], [0, 0, 0], [0, 0, 0]],
        shapeless=True,
        category="blocks",
    ),
    # Planks -> Sticks (4)
    CraftingRecipe(
        recipe_id="planks_to_sticks",
        result_type=STICK,
        result_count=4,
        pattern=[[PLANKS, 0, 0], [PLANKS, 0, 0], [0, 0, 0]],
        category="materials",
    ),
    # Wooden Pickaxe
    CraftingRecipe(
        recipe_id="wooden_pickaxe",
        result_type=WOODEN_PICKAXE,
        result_count=1,
        pattern=[
            [PLANKS, PLANKS, PLANKS],
            [0, STICK, 0],
            [0, STICK, 0],
        ],
        category="tools",
    ),
    # Stone Pickaxe
    CraftingRecipe(
        recipe_id="stone_pickaxe",
        result_type=STONE_PICKAXE,
        result_count=1,
        pattern=[
            [COBBLESTONE, COBBLESTONE, COBBLESTONE],
            [0, STICK, 0],
            [0, STICK, 0],
        ],
        category="tools",
    ),
    # Iron Pickaxe
    CraftingRecipe(
        recipe_id="iron_pickaxe",
        result_type=IRON_PICKAXE,
        result_count=1,
        pattern=[
            [IRON_INGOT, IRON_INGOT, IRON_INGOT],
            [0, STICK, 0],
            [0, STICK, 0],
        ],
        category="tools",
    ),
    # Wooden Axe
    CraftingRecipe(
        recipe_id="wooden_axe",
        result_type=WOODEN_AXE,
        result_count=1,
        pattern=[
            [PLANKS, PLANKS, 0],
            [PLANKS, STICK, 0],
            [0, STICK, 0],
        ],
        category="tools",
    ),
    # Stone Axe
    CraftingRecipe(
        recipe_id="stone_axe",
        result_type=STONE_AXE,
        result_count=1,
        pattern=[
            [COBBLESTONE, COBBLESTONE, 0],
            [COBBLESTONE, STICK, 0],
            [0, STICK, 0],
        ],
        category="tools",
    ),
    # Wooden Shovel
    CraftingRecipe(
        recipe_id="wooden_shovel",
        result_type=WOODEN_SHOVEL,
        result_count=1,
        pattern=[
            [0, PLANKS, 0],
            [0, STICK, 0],
            [0, STICK, 0],
        ],
        category="tools",
    ),
    # Smelting: iron ore -> iron ingot (simplified as crafting)
    CraftingRecipe(
        recipe_id="smelt_iron",
        result_type=IRON_INGOT,
        result_count=1,
        pattern=[[10, 0, 0], [WOOD, 0, 0], [0, 0, 0]],  # iron_ore + wood as fuel
        shapeless=True,
        category="smelting",
    ),
    # Smelting: gold ore -> gold ingot
    CraftingRecipe(
        recipe_id="smelt_gold",
        result_type=GOLD_INGOT,
        result_count=1,
        pattern=[[11, 0, 0], [WOOD, 0, 0], [0, 0, 0]],  # gold_ore + wood
        shapeless=True,
        category="smelting",
    ),
    # Smelting: sand -> glass
    CraftingRecipe(
        recipe_id="smelt_glass",
        result_type=9,  # glass
        result_count=1,
        pattern=[[SAND, 0, 0], [WOOD, 0, 0], [0, 0, 0]],
        shapeless=True,
        category="smelting",
    ),
    # Clay + fire -> brick
    CraftingRecipe(
        recipe_id="smelt_brick",
        result_type=8,  # brick
        result_count=1,
        pattern=[[CLAY, 0, 0], [WOOD, 0, 0], [0, 0, 0]],
        shapeless=True,
        category="smelting",
    ),
]


class CraftingSystem:
    """Manages crafting recipes and operations."""

    def __init__(self):
        self.recipes: Dict[str, CraftingRecipe] = {}
        for recipe in RECIPES:
            self.recipes[recipe.recipe_id] = recipe

    def get_all_recipes(self) -> List[dict]:
        """Get all recipes as JSON-serializable list."""
        result = []
        for recipe in self.recipes.values():
            result.append({
                "id": recipe.recipe_id,
                "result": {
                    "type": recipe.result_type,
                    "count": recipe.result_count,
                },
                "ingredients": recipe.get_ingredients(),
                "pattern": recipe.pattern,
                "shapeless": recipe.shapeless,
                "category": recipe.category,
            })
        return result

    def get_recipe(self, recipe_id: str) -> Optional[CraftingRecipe]:
        """Get a specific recipe by ID."""
        return self.recipes.get(recipe_id)

    def find_recipe(self, grid: List[List[int]]) -> Optional[CraftingRecipe]:
        """Find a recipe matching the given crafting grid."""
        for recipe in self.recipes.values():
            if recipe.shapeless:
                if self._match_shapeless(grid, recipe):
                    return recipe
            else:
                if self._match_shaped(grid, recipe):
                    return recipe
        return None

    def craft(self, recipe_id: str, inventory: Dict[int, int]) -> Optional[Tuple[int, int, Dict[int, int]]]:
        """Attempt to craft using a recipe.

        Args:
            recipe_id: The recipe to use
            inventory: Player's current inventory {item_type: count}

        Returns:
            (result_type, result_count, updated_inventory) or None if cannot craft
        """
        recipe = self.recipes.get(recipe_id)
        if not recipe:
            return None

        ingredients = recipe.get_ingredients()

        # Check if player has all ingredients
        for item_type, needed in ingredients.items():
            if inventory.get(item_type, 0) < needed:
                return None

        # Consume ingredients
        new_inventory = dict(inventory)
        for item_type, needed in ingredients.items():
            new_inventory[item_type] -= needed
            if new_inventory[item_type] <= 0:
                del new_inventory[item_type]

        # Add result
        new_inventory[recipe.result_type] = (
            new_inventory.get(recipe.result_type, 0) + recipe.result_count
        )

        return (recipe.result_type, recipe.result_count, new_inventory)

    def _match_shaped(self, grid: List[List[int]], recipe: CraftingRecipe) -> bool:
        """Check if grid matches a shaped recipe pattern."""
        if len(grid) != len(recipe.pattern):
            return False
        for r, (grid_row, recipe_row) in enumerate(zip(grid, recipe.pattern)):
            if len(grid_row) != len(recipe_row):
                return False
            for c, (g, p) in enumerate(zip(grid_row, recipe_row)):
                if g != p:
                    return False
        return True

    def _match_shapeless(self, grid: List[List[int]], recipe: CraftingRecipe) -> bool:
        """Check if grid matches a shapeless recipe (order doesn't matter)."""
        grid_items: Dict[int, int] = {}
        for row in grid:
            for item in row:
                if item != 0:
                    grid_items[item] = grid_items.get(item, 0) + 1

        return grid_items == recipe.get_ingredients()

    def get_recipes_by_category(self, category: str) -> List[dict]:
        """Get all recipes in a category."""
        return [
            r for r in self.get_all_recipes()
            if r["category"] == category
        ]
