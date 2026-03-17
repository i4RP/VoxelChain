"""Configuration for the VoxelChain RPC Bridge."""

import os

# Chain IDs for each network mode
CHAIN_IDS = {
    "mainnet": 784200,
    "testnet": 784201,
    "regtest": 784202,
}

# Voxel operation gas costs
VOXEL_GAS = {
    "place_block": 50000,
    "break_block": 30000,
    "transfer_item": 40000,
    "claim_land": 100000,
}

# World configuration
WORLD_CONFIG = {
    "chunk_size": 16,
    "world_height": 16,
    "world_radius": 1000,
    "max_block_types": 4096,
    "land_plot_size": 4,
    "max_blocks_per_tx": 64,
}


def _env(key: str, default: str) -> str:
    """Get environment variable with default."""
    return os.environ.get(key, default)


class BridgeConfig:
    """Configuration for the VoxelChain RPC bridge."""

    def __init__(self):
        # Node RPC connection
        self.rpc_host: str = _env("VOXELCHAIN_RPC_HOST", "127.0.0.1")
        self.rpc_port: int = int(_env("VOXELCHAIN_RPC_PORT", "8545"))
        self.rpc_user: str = _env("VOXELCHAIN_RPC_USER", "")
        self.rpc_pass: str = _env("VOXELCHAIN_RPC_PASS", "")

        # Network mode
        self.network: str = _env("VOXELCHAIN_NETWORK", "testnet")

        # Chain configuration
        default_chain_id = str(CHAIN_IDS.get(self.network, 784201))
        self.chain_id: int = int(_env("VOXELCHAIN_CHAIN_ID", default_chain_id))
        self.network_id: int = self.chain_id

        # Bridge server configuration
        self.bridge_host: str = _env("VOXELCHAIN_BRIDGE_HOST", "0.0.0.0")
        self.bridge_port: int = int(_env("VOXELCHAIN_BRIDGE_PORT", "8546"))

        # Gas configuration
        self.default_gas_price: int = int(_env("VOXELCHAIN_GAS_PRICE", "1000000000"))
        self.default_gas_limit: int = int(_env("VOXELCHAIN_GAS_LIMIT", "21000"))
        self.block_gas_limit: int = int(_env("VOXELCHAIN_BLOCK_GAS_LIMIT", "30000000"))

        # Virtual block engine
        self.vblock_data_dir: str = _env("VOXELCHAIN_VBLOCK_DIR", "/tmp/voxelchain-vblocks")

        # Voxel world configuration
        self.chunk_size: int = WORLD_CONFIG["chunk_size"]
        self.world_height: int = WORLD_CONFIG["world_height"]
        self.world_radius: int = WORLD_CONFIG["world_radius"]
        self.max_block_types: int = WORLD_CONFIG["max_block_types"]
        self.land_plot_size: int = WORLD_CONFIG["land_plot_size"]
        self.max_blocks_per_tx: int = WORLD_CONFIG["max_blocks_per_tx"]

    @property
    def rpc_url(self) -> str:
        """Full URL for the node RPC."""
        return f"http://{self.rpc_host}:{self.rpc_port}"

    @property
    def chain_id_hex(self) -> str:
        """Chain ID as hex string."""
        return hex(self.chain_id)
