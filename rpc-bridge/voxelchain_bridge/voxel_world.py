"""Voxel World State Management for VoxelChain.

Manages the 3D voxel world state with on-chain verification.
Uses a chunk-based system inspired by Luanti's MapBlock architecture.

Chunk System:
- World divided into 16x16x16 chunks (configurable)
- Each chunk has a Merkle root stored on-chain
- Full voxel data stored off-chain (IPFS or local)
- Land ownership tracked via NFT (chunk-group basis)

Block Types:
- Each voxel has a type ID (u16, max 4096 types)
- Types defined in a registry (expandable via governance)
"""

import hashlib
import logging
import os
import struct
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


@dataclass
class VoxelBlock:
    """A single voxel in the world."""
    block_type: int = 0  # 0 = air
    param1: int = 0      # light level
    param2: int = 0      # rotation / metadata

    def serialize(self) -> bytes:
        return struct.pack("<HBB", self.block_type, self.param1, self.param2)

    @classmethod
    def deserialize(cls, data: bytes) -> "VoxelBlock":
        block_type, param1, param2 = struct.unpack("<HBB", data[:4])
        return cls(block_type=block_type, param1=param1, param2=param2)

    def is_air(self) -> bool:
        return self.block_type == 0


@dataclass
class Chunk:
    """A 16x16x16 chunk of voxels (inspired by Luanti MapBlock)."""
    x: int
    y: int
    z: int
    size: int = 16
    blocks: Optional[bytearray] = None
    merkle_root: str = ""
    owner: str = ""  # Ethereum address of land owner
    last_modified: float = 0.0
    tx_hash: str = ""  # Last on-chain transaction hash

    def __post_init__(self):
        if self.blocks is None:
            # Initialize with air (all zeros)
            self.blocks = bytearray(self.size ** 3 * 4)
        if not self.merkle_root:
            self.merkle_root = self.compute_merkle_root()

    def _index(self, x: int, y: int, z: int) -> int:
        """Convert local coords to array index."""
        return (z * self.size * self.size + y * self.size + x) * 4

    def get_block(self, x: int, y: int, z: int) -> VoxelBlock:
        """Get voxel at local coordinates."""
        if not (0 <= x < self.size and 0 <= y < self.size and 0 <= z < self.size):
            return VoxelBlock()
        idx = self._index(x, y, z)
        return VoxelBlock.deserialize(bytes(self.blocks[idx:idx + 4]))

    def set_block(self, x: int, y: int, z: int, block: VoxelBlock) -> bool:
        """Set voxel at local coordinates."""
        if not (0 <= x < self.size and 0 <= y < self.size and 0 <= z < self.size):
            return False
        idx = self._index(x, y, z)
        data = block.serialize()
        self.blocks[idx:idx + 4] = data
        self.last_modified = time.time()
        self.merkle_root = self.compute_merkle_root()
        return True

    def compute_merkle_root(self) -> str:
        """Compute Merkle root hash of chunk data."""
        if not self.blocks:
            return "0x" + "00" * 32

        # Split chunk into 16 slices (one per Y layer)
        leaves = []
        slice_size = self.size * self.size * 4
        for i in range(self.size):
            start = i * slice_size
            end = start + slice_size
            layer_hash = hashlib.sha256(bytes(self.blocks[start:end])).digest()
            leaves.append(layer_hash)

        # Build Merkle tree
        while len(leaves) > 1:
            new_leaves = []
            for i in range(0, len(leaves), 2):
                if i + 1 < len(leaves):
                    combined = leaves[i] + leaves[i + 1]
                else:
                    combined = leaves[i] + leaves[i]
                new_leaves.append(hashlib.sha256(combined).digest())
            leaves = new_leaves

        return "0x" + leaves[0].hex()

    def is_empty(self) -> bool:
        """Check if chunk is entirely air."""
        return all(b == 0 for b in self.blocks)

    def serialize(self) -> bytes:
        """Serialize chunk for storage/transmission."""
        header = struct.pack("<iiiI", self.x, self.y, self.z, self.size)
        return header + bytes(self.blocks)

    @classmethod
    def deserialize(cls, data: bytes) -> "Chunk":
        """Deserialize chunk from storage."""
        x, y, z, size = struct.unpack("<iiiI", data[:16])
        blocks = bytearray(data[16:])
        chunk = cls(x=x, y=y, z=z, size=size, blocks=blocks)
        chunk.merkle_root = chunk.compute_merkle_root()
        return chunk

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict."""
        return {
            "position": {"x": self.x, "y": self.y, "z": self.z},
            "size": self.size,
            "merkleRoot": self.merkle_root,
            "owner": self.owner,
            "lastModified": self.last_modified,
            "txHash": self.tx_hash,
            "isEmpty": self.is_empty(),
        }


# Block type registry
BLOCK_TYPES = {
    0: {"name": "air", "solid": False, "transparent": True},
    1: {"name": "stone", "solid": True, "transparent": False, "color": "#808080"},
    2: {"name": "dirt", "solid": True, "transparent": False, "color": "#8B4513"},
    3: {"name": "grass", "solid": True, "transparent": False, "color": "#228B22"},
    4: {"name": "sand", "solid": True, "transparent": False, "color": "#F4A460"},
    5: {"name": "water", "solid": False, "transparent": True, "color": "#4169E1"},
    6: {"name": "wood", "solid": True, "transparent": False, "color": "#8B6914"},
    7: {"name": "leaves", "solid": True, "transparent": True, "color": "#006400"},
    8: {"name": "brick", "solid": True, "transparent": False, "color": "#B22222"},
    9: {"name": "glass", "solid": True, "transparent": True, "color": "#87CEEB"},
    10: {"name": "iron_ore", "solid": True, "transparent": False, "color": "#A0522D"},
    11: {"name": "gold_ore", "solid": True, "transparent": False, "color": "#FFD700"},
    12: {"name": "diamond_ore", "solid": True, "transparent": False, "color": "#00CED1"},
    13: {"name": "bedrock", "solid": True, "transparent": False, "color": "#2F4F4F"},
    14: {"name": "cobblestone", "solid": True, "transparent": False, "color": "#696969"},
    15: {"name": "planks", "solid": True, "transparent": False, "color": "#DEB887"},
    16: {"name": "snow", "solid": True, "transparent": False, "color": "#FFFAFA"},
    17: {"name": "ice", "solid": True, "transparent": True, "color": "#B0E0E6"},
    18: {"name": "lava", "solid": False, "transparent": False, "color": "#FF4500"},
    19: {"name": "obsidian", "solid": True, "transparent": False, "color": "#1C1C1C"},
    20: {"name": "clay", "solid": True, "transparent": False, "color": "#BDB76B"},
}


class VoxelWorld:
    """Manages the voxel world state with on-chain verification.

    World coordinate system:
    - Position (x, y, z) in world space
    - Chunk position = (x // chunk_size, y // chunk_size, z // chunk_size)
    - Local position within chunk = (x % chunk_size, y % chunk_size, z % chunk_size)
    """

    def __init__(self, data_dir: str = "/tmp/voxelchain-world",
                 chunk_size: int = 16, persistence=None):
        self.data_dir = data_dir
        self.chunk_size = chunk_size
        self.chunks: Dict[Tuple[int, int, int], Chunk] = {}
        self._pending_changes: List[dict] = []
        self._persistence = persistence
        os.makedirs(data_dir, exist_ok=True)

    def _chunk_key(self, x: int, y: int, z: int) -> Tuple[int, int, int]:
        """Convert world coords to chunk key."""
        return (x // self.chunk_size, y // self.chunk_size, z // self.chunk_size)

    def _local_coords(self, x: int, y: int, z: int) -> Tuple[int, int, int]:
        """Convert world coords to local chunk coords."""
        return (x % self.chunk_size, y % self.chunk_size, z % self.chunk_size)

    def get_chunk(self, cx: int, cy: int, cz: int) -> Chunk:
        """Get or create a chunk."""
        key = (cx, cy, cz)
        if key not in self.chunks:
            # Try load from database first, then disk
            chunk = self._load_chunk(cx, cy, cz)
            if chunk is None:
                chunk = Chunk(x=cx, y=cy, z=cz, size=self.chunk_size)
                self._generate_terrain(chunk)
                self._save_chunk(chunk)
            self.chunks[key] = chunk
        return self.chunks[key]

    def get_block(self, x: int, y: int, z: int) -> VoxelBlock:
        """Get voxel at world coordinates."""
        cx, cy, cz = self._chunk_key(x, y, z)
        lx, ly, lz = self._local_coords(x, y, z)
        chunk = self.get_chunk(cx, cy, cz)
        return chunk.get_block(lx, ly, lz)

    def set_block(self, x: int, y: int, z: int, block_type: int,
                  player: str = "") -> dict:
        """Set voxel at world coordinates. Returns change record."""
        cx, cy, cz = self._chunk_key(x, y, z)
        lx, ly, lz = self._local_coords(x, y, z)
        chunk = self.get_chunk(cx, cy, cz)

        old_block = chunk.get_block(lx, ly, lz)
        new_block = VoxelBlock(block_type=block_type)
        chunk.set_block(lx, ly, lz, new_block)

        change = {
            "action": "place" if block_type != 0 else "break",
            "position": {"x": x, "y": y, "z": z},
            "chunk": {"x": cx, "y": cy, "z": cz},
            "oldType": old_block.block_type,
            "newType": block_type,
            "player": player,
            "timestamp": time.time(),
            "merkleRoot": chunk.merkle_root,
        }
        self._pending_changes.append(change)
        self._save_chunk(chunk)
        return change

    def place_block(self, x: int, y: int, z: int, block_type: int,
                    player: str = "") -> dict:
        """Place a block at world coordinates."""
        if block_type == 0:
            raise ValueError("Use break_block to remove blocks")
        if block_type not in BLOCK_TYPES:
            raise ValueError(f"Unknown block type: {block_type}")
        return self.set_block(x, y, z, block_type, player)

    def break_block(self, x: int, y: int, z: int, player: str = "") -> dict:
        """Break (remove) a block at world coordinates."""
        current = self.get_block(x, y, z)
        if current.is_air():
            raise ValueError("Cannot break air")
        if current.block_type == 13:  # bedrock
            raise ValueError("Cannot break bedrock")
        return self.set_block(x, y, z, 0, player)

    def get_chunk_data(self, cx: int, cy: int, cz: int) -> dict:
        """Get chunk data for client rendering."""
        chunk = self.get_chunk(cx, cy, cz)
        blocks = []
        for z in range(self.chunk_size):
            for y in range(self.chunk_size):
                for x in range(self.chunk_size):
                    block = chunk.get_block(x, y, z)
                    if not block.is_air():
                        blocks.append({
                            "x": x, "y": y, "z": z,
                            "type": block.block_type,
                        })
        return {
            "chunk": {"x": cx, "y": cy, "z": cz},
            "blocks": blocks,
            "merkleRoot": chunk.merkle_root,
            "owner": chunk.owner,
        }

    def get_pending_changes(self) -> List[dict]:
        """Get and clear pending changes for on-chain submission."""
        changes = self._pending_changes[:]
        self._pending_changes = []
        return changes

    def _generate_terrain(self, chunk: Chunk):
        """Generate basic terrain for a new chunk."""
        # Simple flat terrain: bedrock at y=0 chunk, stone, dirt, grass
        if chunk.y < 0:
            # Underground: stone
            for z in range(chunk.size):
                for y in range(chunk.size):
                    for x in range(chunk.size):
                        chunk.set_block(x, y, z, VoxelBlock(block_type=1))
        elif chunk.y == 0:
            # Surface level
            for z in range(chunk.size):
                for x in range(chunk.size):
                    # Bedrock at bottom
                    chunk.set_block(x, 0, z, VoxelBlock(block_type=13))
                    # Stone layers
                    for y in range(1, 10):
                        chunk.set_block(x, y, z, VoxelBlock(block_type=1))
                    # Dirt layers
                    for y in range(10, 13):
                        chunk.set_block(x, y, z, VoxelBlock(block_type=2))
                    # Grass on top
                    chunk.set_block(x, 13, z, VoxelBlock(block_type=3))
        # y > 0: leave as air

    def _save_chunk(self, chunk: Chunk):
        """Save chunk to database (preferred) or disk (fallback)."""
        if self._persistence:
            try:
                self._persistence.save_chunk(
                    chunk.x, chunk.y, chunk.z,
                    bytes(chunk.blocks),
                    chunk.merkle_root, chunk.owner, chunk.tx_hash
                )
                return
            except Exception as e:
                logger.error("DB save failed, falling back to disk: %s", e)
        # Fallback to disk
        path = os.path.join(
            self.data_dir,
            f"chunk_{chunk.x}_{chunk.y}_{chunk.z}.bin"
        )
        try:
            with open(path, "wb") as f:
                f.write(chunk.serialize())
        except OSError as e:
            logger.error("Failed to save chunk: %s", e)

    def _load_chunk(self, cx: int, cy: int, cz: int) -> Optional[Chunk]:
        """Load chunk from database (preferred) or disk (fallback)."""
        if self._persistence:
            try:
                result = self._persistence.load_chunk(cx, cy, cz)
                if result:
                    blocks_data, merkle_root, owner = result
                    chunk = Chunk(x=cx, y=cy, z=cz, size=self.chunk_size,
                                  blocks=bytearray(blocks_data))
                    chunk.merkle_root = merkle_root or chunk.compute_merkle_root()
                    chunk.owner = owner
                    return chunk
            except Exception as e:
                logger.error("DB load failed, falling back to disk: %s", e)
        # Fallback to disk
        path = os.path.join(self.data_dir, f"chunk_{cx}_{cy}_{cz}.bin")
        if not os.path.exists(path):
            return None
        try:
            with open(path, "rb") as f:
                return Chunk.deserialize(f.read())
        except (OSError, struct.error) as e:
            logger.error("Failed to load chunk: %s", e)
            return None

    def get_block_types(self) -> dict:
        """Get the block type registry."""
        return BLOCK_TYPES

    def get_world_info(self) -> dict:
        """Get world information."""
        return {
            "chunkSize": self.chunk_size,
            "loadedChunks": len(self.chunks),
            "blockTypes": len(BLOCK_TYPES),
            "pendingChanges": len(self._pending_changes),
        }
