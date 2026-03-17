/**
 * Procedural terrain generator for VoxelChain.
 * Uses simplex-like noise for natural-looking terrain.
 */

import { CHUNK_SIZE } from "./Chunk.js";
import { BlockType } from "./BlockRegistry.js";

/**
 * Simple hash-based noise (no external dependency needed).
 * Produces deterministic pseudo-random values based on coordinates.
 */
function hash2D(x, z) {
  let h = x * 374761393 + z * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  h = h ^ (h >> 16);
  return (h & 0x7fffffff) / 0x7fffffff;
}

function smoothNoise2D(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;

  // Smoothstep
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);

  const n00 = hash2D(ix, iz);
  const n10 = hash2D(ix + 1, iz);
  const n01 = hash2D(ix, iz + 1);
  const n11 = hash2D(ix + 1, iz + 1);

  const nx0 = n00 + sx * (n10 - n00);
  const nx1 = n01 + sx * (n11 - n01);

  return nx0 + sz * (nx1 - nx0);
}

function fbm(x, z, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let value = 0;
  let amplitude = 1.0;
  let frequency = 1.0;
  let maxValue = 0;

  for (let i = 0; i < octaves; i++) {
    value += smoothNoise2D(x * frequency, z * frequency) * amplitude;
    maxValue += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }

  return value / maxValue;
}

/** Determine biome based on position */
function getBiome(wx, wz) {
  const temp = fbm(wx * 0.005 + 100, wz * 0.005 + 100, 3);
  const moisture = fbm(wx * 0.004 + 200, wz * 0.004 + 200, 3);

  if (temp > 0.65 && moisture < 0.35) return "desert";
  if (temp < 0.3) return "snow";
  if (moisture > 0.6) return "forest";
  return "plains";
}

export class TerrainGenerator {
  constructor(seed = 42) {
    this.seed = seed;
    this.seaLevel = 10;
  }

  /** Get terrain height at world XZ */
  getHeight(wx, wz) {
    const scale = 0.02;
    const base = fbm(wx * scale + this.seed, wz * scale + this.seed, 5, 2.0, 0.5);
    const detail = fbm(wx * 0.08 + this.seed + 50, wz * 0.08 + this.seed + 50, 3, 2.0, 0.4);

    // Mountain factor
    const mountain = fbm(wx * 0.008 + this.seed + 300, wz * 0.008 + this.seed + 300, 3);
    const mountainHeight = mountain > 0.6 ? (mountain - 0.6) * 80 : 0;

    return Math.floor(base * 20 + detail * 5 + mountainHeight + 8);
  }

  /** Generate terrain for a chunk */
  generateChunk(chunk) {
    const worldX = chunk.cx * CHUNK_SIZE;
    const worldY = chunk.cy * CHUNK_SIZE;
    const worldZ = chunk.cz * CHUNK_SIZE;

    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = worldX + lx;
        const wz = worldZ + lz;

        const height = this.getHeight(wx, wz);
        const biome = getBiome(wx, wz);

        for (let ly = 0; ly < CHUNK_SIZE; ly++) {
          const wy = worldY + ly;

          if (wy > height && wy > this.seaLevel) continue; // Air above terrain and sea

          let blockType = BlockType.AIR;

          if (wy === 0) {
            blockType = BlockType.BEDROCK;
          } else if (wy <= height) {
            if (wy === height) {
              // Surface block
              blockType = this._getSurfaceBlock(biome, height);
            } else if (wy >= height - 3) {
              // Sub-surface
              blockType = this._getSubSurfaceBlock(biome);
            } else {
              // Deep underground
              blockType = BlockType.STONE;

              // Ore generation
              const oreChance = hash2D(wx * 17 + wy * 31 + this.seed, wz * 23 + wy * 7);
              if (wy < 8 && oreChance > 0.97) {
                blockType = BlockType.DIAMOND_ORE;
              } else if (wy < 20 && oreChance > 0.94) {
                blockType = BlockType.GOLD_ORE;
              } else if (wy < 40 && oreChance > 0.90) {
                blockType = BlockType.IRON_ORE;
              }

              // Cave generation
              const caveNoise = fbm(wx * 0.06 + this.seed + 500, wz * 0.06 + wy * 0.08 + this.seed + 500, 3);
              if (caveNoise > 0.7 && wy > 2 && wy < height - 2) {
                blockType = BlockType.AIR;
              }
            }
          } else if (wy <= this.seaLevel) {
            // Water
            blockType = BlockType.WATER;
          }

          if (blockType !== BlockType.AIR) {
            chunk.setBlock(lx, ly, lz, blockType);
          }
        }

        // Trees
        if (height > this.seaLevel && (biome === "forest" || biome === "plains")) {
          const treeChance = hash2D(wx * 7 + this.seed + 1000, wz * 13 + this.seed + 1000);
          const treeThreshold = biome === "forest" ? 0.88 : 0.95;
          if (treeChance > treeThreshold) {
            this._placeTree(chunk, lx, height - worldY + 1, lz, worldY);
          }
        }
      }
    }
  }

  _getSurfaceBlock(biome) {
    switch (biome) {
      case "desert": return BlockType.SAND;
      case "snow": return BlockType.SNOW;
      default: return BlockType.GRASS;
    }
  }

  _getSubSurfaceBlock(biome) {
    switch (biome) {
      case "desert": return BlockType.SAND;
      case "snow": return BlockType.DIRT;
      default: return BlockType.DIRT;
    }
  }

  _placeTree(chunk, lx, ly, lz, worldY) {
    const trunkHeight = 4 + Math.floor(hash2D(lx + worldY, lz + worldY) * 3);

    // Only place if tree fits in chunk
    if (ly < 0 || ly + trunkHeight + 2 >= CHUNK_SIZE) return;
    if (lx < 2 || lx >= CHUNK_SIZE - 2 || lz < 2 || lz >= CHUNK_SIZE - 2) return;

    // Trunk
    for (let i = 0; i < trunkHeight; i++) {
      if (ly + i >= 0 && ly + i < CHUNK_SIZE) {
        chunk.setBlock(lx, ly + i, lz, BlockType.WOOD);
      }
    }

    // Leaves canopy
    const leafStart = ly + trunkHeight - 1;
    for (let dy = 0; dy <= 2; dy++) {
      const radius = dy === 2 ? 1 : 2;
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dz = -radius; dz <= radius; dz++) {
          if (dx === 0 && dz === 0 && dy < 2) continue; // Skip trunk position
          const tx = lx + dx;
          const ty = leafStart + dy;
          const tz = lz + dz;
          if (tx >= 0 && tx < CHUNK_SIZE && ty >= 0 && ty < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE) {
            if (chunk.getBlock(tx, ty, tz) === 0) {
              chunk.setBlock(tx, ty, tz, BlockType.LEAVES);
            }
          }
        }
      }
    }
  }
}
