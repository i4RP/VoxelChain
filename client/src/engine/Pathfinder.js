/**
 * Pathfinder - A* 3D voxel space navigation for VoxelChain.
 * Finds walkable paths through the voxel world, considering
 * solid blocks, gaps, and height differences.
 */

/** Priority queue (min-heap) for A* open set */
class MinHeap {
  constructor() {
    this._data = [];
  }

  push(item, priority) {
    this._data.push({ item, priority });
    this._bubbleUp(this._data.length - 1);
  }

  pop() {
    if (this._data.length === 0) return null;
    const top = this._data[0];
    const last = this._data.pop();
    if (this._data.length > 0) {
      this._data[0] = last;
      this._sinkDown(0);
    }
    return top.item;
  }

  get size() {
    return this._data.length;
  }

  _bubbleUp(idx) {
    while (idx > 0) {
      const parent = (idx - 1) >> 1;
      if (this._data[idx].priority < this._data[parent].priority) {
        [this._data[idx], this._data[parent]] = [this._data[parent], this._data[idx]];
        idx = parent;
      } else {
        break;
      }
    }
  }

  _sinkDown(idx) {
    const len = this._data.length;
    while (true) {
      let smallest = idx;
      const left = 2 * idx + 1;
      const right = 2 * idx + 2;
      if (left < len && this._data[left].priority < this._data[smallest].priority) {
        smallest = left;
      }
      if (right < len && this._data[right].priority < this._data[smallest].priority) {
        smallest = right;
      }
      if (smallest !== idx) {
        [this._data[idx], this._data[smallest]] = [this._data[smallest], this._data[idx]];
        idx = smallest;
      } else {
        break;
      }
    }
  }
}

export class Pathfinder {
  constructor(worldManager) {
    this.world = worldManager;
    this.maxIterations = 5000;
    this.maxPathLength = 200;
  }

  /**
   * Find a path from start to goal in the voxel world.
   * Coordinates are integer block positions (player stands ON the block at y-1).
   *
   * @param {number} sx - Start X (player foot position)
   * @param {number} sy - Start Y (player foot position)
   * @param {number} sz - Start Z (player foot position)
   * @param {number} gx - Goal X
   * @param {number} gy - Goal Y
   * @param {number} gz - Goal Z
   * @param {object} options - { allowFly: false, maxIterations: 5000 }
   * @returns {{ found: boolean, path: Array<{x,y,z}>, iterations: number }}
   */
  findPath(sx, sy, sz, gx, gy, gz, options = {}) {
    const allowFly = options.allowFly || false;
    const maxIter = options.maxIterations || this.maxIterations;

    // Round to integers
    sx = Math.floor(sx);
    sy = Math.floor(sy);
    sz = Math.floor(sz);
    gx = Math.floor(gx);
    gy = Math.floor(gy);
    gz = Math.floor(gz);

    const startKey = this._key(sx, sy, sz);
    const goalKey = this._key(gx, gy, gz);

    if (startKey === goalKey) {
      return { found: true, path: [{ x: sx, y: sy, z: sz }], iterations: 0 };
    }

    const openSet = new MinHeap();
    const cameFrom = new Map();
    const gScore = new Map();
    const inOpen = new Set();

    gScore.set(startKey, 0);
    openSet.push({ x: sx, y: sy, z: sz }, this._heuristic(sx, sy, sz, gx, gy, gz));
    inOpen.add(startKey);

    let iterations = 0;

    while (openSet.size > 0 && iterations < maxIter) {
      iterations++;
      const current = openSet.pop();
      const currentKey = this._key(current.x, current.y, current.z);
      inOpen.delete(currentKey);

      if (currentKey === goalKey) {
        return {
          found: true,
          path: this._reconstructPath(cameFrom, current),
          iterations,
        };
      }

      const neighbors = allowFly
        ? this._getFlyNeighbors(current.x, current.y, current.z)
        : this._getWalkNeighbors(current.x, current.y, current.z);

      for (const neighbor of neighbors) {
        const nKey = this._key(neighbor.x, neighbor.y, neighbor.z);
        const tentativeG = gScore.get(currentKey) + neighbor.cost;

        if (!gScore.has(nKey) || tentativeG < gScore.get(nKey)) {
          cameFrom.set(nKey, current);
          gScore.set(nKey, tentativeG);
          const f = tentativeG + this._heuristic(neighbor.x, neighbor.y, neighbor.z, gx, gy, gz);

          if (!inOpen.has(nKey)) {
            openSet.push({ x: neighbor.x, y: neighbor.y, z: neighbor.z }, f);
            inOpen.add(nKey);
          }
        }
      }
    }

    return { found: false, path: [], iterations };
  }

  /**
   * Get walkable neighbors (horizontal + step up/down + jump)
   * Player occupies 2 blocks tall (foot and head).
   */
  _getWalkNeighbors(x, y, z) {
    const neighbors = [];
    const directions = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1], // diagonals
    ];

    for (const [dx, dz] of directions) {
      const nx = x + dx;
      const nz = z + dz;
      const isDiag = dx !== 0 && dz !== 0;
      const cost = isDiag ? 1.414 : 1.0;

      // Walk on same level
      if (this._canStandAt(nx, y, nz)) {
        neighbors.push({ x: nx, y, z: nz, cost });
      }

      // Step up 1 block (if head space allows)
      if (this._canStandAt(nx, y + 1, nz) && this._isPassable(x, y + 2, z)) {
        neighbors.push({ x: nx, y: y + 1, z: nz, cost: cost + 0.5 });
      }

      // Step down 1 block
      if (this._canStandAt(nx, y - 1, nz)) {
        neighbors.push({ x: nx, y: y - 1, z: nz, cost: cost + 0.3 });
      }

      // Drop down 2 blocks
      if (this._canStandAt(nx, y - 2, nz) && this._isPassable(nx, y - 1, nz)) {
        neighbors.push({ x: nx, y: y - 2, z: nz, cost: cost + 1.0 });
      }
    }

    return neighbors;
  }

  /**
   * Get fly neighbors (all 26 adjacent positions).
   */
  _getFlyNeighbors(x, y, z) {
    const neighbors = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          const nz = z + dz;
          // In fly mode, just need the position to be passable (not solid)
          if (this._isPassable(nx, ny, nz) && this._isPassable(nx, ny + 1, nz)) {
            const cost = Math.sqrt(dx * dx + dy * dy + dz * dz);
            neighbors.push({ x: nx, y: ny, z: nz, cost });
          }
        }
      }
    }
    return neighbors;
  }

  /** Check if a player can stand at this position (foot=y, head=y+1, ground=y-1) */
  _canStandAt(x, y, z) {
    const footBlock = this.world.getBlock(x, y, z);
    const headBlock = this.world.getBlock(x, y + 1, z);
    const groundBlock = this.world.getBlock(x, y - 1, z);

    const footPassable = footBlock === 0 || footBlock === 5; // air or water
    const headPassable = headBlock === 0 || headBlock === 5;
    const groundSolid = groundBlock !== 0 && groundBlock !== 5;

    return footPassable && headPassable && groundSolid;
  }

  /** Check if a block position is passable (air or water) */
  _isPassable(x, y, z) {
    const block = this.world.getBlock(x, y, z);
    return block === 0 || block === 5;
  }

  _heuristic(x1, y1, z1, x2, y2, z2) {
    // 3D Euclidean distance
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dz = z2 - z1;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _key(x, y, z) {
    return `${x},${y},${z}`;
  }

  _reconstructPath(cameFrom, current) {
    const path = [{ x: current.x, y: current.y, z: current.z }];
    let key = this._key(current.x, current.y, current.z);
    while (cameFrom.has(key)) {
      const prev = cameFrom.get(key);
      path.unshift({ x: prev.x, y: prev.y, z: prev.z });
      key = this._key(prev.x, prev.y, prev.z);
    }
    return path;
  }
}
