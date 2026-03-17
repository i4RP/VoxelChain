"""Enhanced procedural terrain generator for VoxelChain server.

Uses hash-based noise for deterministic terrain generation.
Supports biomes, caves, ores, and tree placement.
"""

import logging

logger = logging.getLogger(__name__)


def _hash2d(x: int, z: int) -> float:
    """Deterministic hash-based pseudo-random value from coordinates."""
    h = x * 374761393 + z * 668265263
    h = (h ^ (h >> 13)) * 1274126177
    h = h ^ (h >> 16)
    return (h & 0x7FFFFFFF) / 0x7FFFFFFF


def _smooth_noise_2d(x: float, z: float) -> float:
    """Smooth interpolated noise."""
    ix = int(x) if x >= 0 else int(x) - 1
    iz = int(z) if z >= 0 else int(z) - 1
    fx = x - ix
    fz = z - iz

    # Smoothstep
    sx = fx * fx * (3 - 2 * fx)
    sz = fz * fz * (3 - 2 * fz)

    n00 = _hash2d(ix, iz)
    n10 = _hash2d(ix + 1, iz)
    n01 = _hash2d(ix, iz + 1)
    n11 = _hash2d(ix + 1, iz + 1)

    nx0 = n00 + sx * (n10 - n00)
    nx1 = n01 + sx * (n11 - n01)

    return nx0 + sz * (nx1 - nx0)


def _fbm(x: float, z: float, octaves: int = 4,
         lacunarity: float = 2.0, gain: float = 0.5) -> float:
    """Fractal Brownian Motion noise."""
    value = 0.0
    amplitude = 1.0
    frequency = 1.0
    max_value = 0.0

    for _ in range(octaves):
        value += _smooth_noise_2d(x * frequency, z * frequency) * amplitude
        max_value += amplitude
        amplitude *= gain
        frequency *= lacunarity

    return value / max_value


def get_biome(wx: int, wz: int) -> str:
    """Determine biome based on temperature and moisture."""
    temp = _fbm(wx * 0.005 + 100, wz * 0.005 + 100, 3)
    moisture = _fbm(wx * 0.004 + 200, wz * 0.004 + 200, 3)

    if temp > 0.65 and moisture < 0.35:
        return "desert"
    if temp < 0.3:
        return "snow"
    if moisture > 0.6:
        return "forest"
    return "plains"


# Block type constants (matching client)
AIR = 0
STONE = 1
DIRT = 2
GRASS = 3
SAND = 4
WATER = 5
WOOD = 6
LEAVES = 7
IRON_ORE = 10
GOLD_ORE = 11
DIAMOND_ORE = 12
BEDROCK = 13
SNOW = 16

SEA_LEVEL = 10
SEED = 42


def get_terrain_height(wx: int, wz: int) -> int:
    """Get terrain height at world XZ position."""
    scale = 0.02
    base = _fbm(wx * scale + SEED, wz * scale + SEED, 5, 2.0, 0.5)
    detail = _fbm(wx * 0.08 + SEED + 50, wz * 0.08 + SEED + 50, 3, 2.0, 0.4)

    # Mountain factor
    mountain = _fbm(wx * 0.008 + SEED + 300, wz * 0.008 + SEED + 300, 3)
    mountain_height = (mountain - 0.6) * 80 if mountain > 0.6 else 0

    return int(base * 20 + detail * 5 + mountain_height + 8)


def get_surface_block(biome: str) -> int:
    """Get surface block type for a biome."""
    if biome == "desert":
        return SAND
    if biome == "snow":
        return SNOW
    return GRASS


def get_subsurface_block(biome: str) -> int:
    """Get sub-surface block type for a biome."""
    if biome == "desert":
        return SAND
    return DIRT


def generate_chunk_blocks(cx: int, cy: int, cz: int,
                          chunk_size: int = 16) -> list:
    """Generate block data for a chunk.

    Returns list of (lx, ly, lz, block_type) tuples for non-air blocks.
    """
    world_x = cx * chunk_size
    world_y = cy * chunk_size
    world_z = cz * chunk_size
    blocks = []

    for lz in range(chunk_size):
        for lx in range(chunk_size):
            wx = world_x + lx
            wz = world_z + lz

            height = get_terrain_height(wx, wz)
            biome = get_biome(wx, wz)

            for ly in range(chunk_size):
                wy = world_y + ly

                if wy > height and wy > SEA_LEVEL:
                    continue  # Air above terrain and sea

                block_type = AIR

                if wy == 0:
                    block_type = BEDROCK
                elif wy <= height:
                    if wy == height:
                        block_type = get_surface_block(biome)
                    elif wy >= height - 3:
                        block_type = get_subsurface_block(biome)
                    else:
                        block_type = STONE

                        # Ore generation
                        ore_chance = _hash2d(wx * 17 + wy * 31 + SEED, wz * 23 + wy * 7)
                        if wy < 8 and ore_chance > 0.97:
                            block_type = DIAMOND_ORE
                        elif wy < 20 and ore_chance > 0.94:
                            block_type = GOLD_ORE
                        elif wy < 40 and ore_chance > 0.90:
                            block_type = IRON_ORE

                        # Cave generation
                        cave_noise = _fbm(
                            wx * 0.06 + SEED + 500,
                            wz * 0.06 + wy * 0.08 + SEED + 500, 3
                        )
                        if cave_noise > 0.7 and wy > 2 and wy < height - 2:
                            block_type = AIR
                elif wy <= SEA_LEVEL:
                    block_type = WATER

                if block_type != AIR:
                    blocks.append((lx, ly, lz, block_type))

            # Trees
            if height > SEA_LEVEL and biome in ("forest", "plains"):
                tree_chance = _hash2d(wx * 7 + SEED + 1000, wz * 13 + SEED + 1000)
                threshold = 0.88 if biome == "forest" else 0.95
                if tree_chance > threshold:
                    trunk_base = height - world_y + 1
                    trunk_height = 4 + int(_hash2d(lx + world_y, lz + world_y) * 3)

                    if 0 <= trunk_base < chunk_size and trunk_base + trunk_height + 2 < chunk_size:
                        if 2 <= lx < chunk_size - 2 and 2 <= lz < chunk_size - 2:
                            # Trunk
                            for i in range(trunk_height):
                                if 0 <= trunk_base + i < chunk_size:
                                    blocks.append((lx, trunk_base + i, lz, WOOD))

                            # Leaves
                            leaf_start = trunk_base + trunk_height - 1
                            for dy in range(3):
                                radius = 1 if dy == 2 else 2
                                for dx in range(-radius, radius + 1):
                                    for ddz in range(-radius, radius + 1):
                                        if dx == 0 and ddz == 0 and dy < 2:
                                            continue
                                        tx = lx + dx
                                        ty = leaf_start + dy
                                        tz = lz + ddz
                                        if (0 <= tx < chunk_size and
                                                0 <= ty < chunk_size and
                                                0 <= tz < chunk_size):
                                            blocks.append((tx, ty, tz, LEAVES))

    return blocks
