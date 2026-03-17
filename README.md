# VoxelChain

A 3D voxel game world powered by an EVM-compatible blockchain. Combines the voxel engine architecture of [Luanti](https://github.com/minetest/minetest) with the EVM network capabilities of [TeraETH](https://github.com/i4RP/TeraETH).

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Browser Client (WebGL/Canvas)                  │
│  - Isometric voxel renderer                     │
│  - MetaMask wallet integration                  │
│  - Real-time chunk streaming                    │
├─────────────────────────────────────────────────┤
│  RPC Bridge (Python/aiohttp)                    │
│  - Ethereum JSON-RPC API                        │
│  - Voxel-specific RPC methods                   │
│  - Virtual Block Engine (0.01s)                 │
│  - Faucet & WebSocket                           │
├─────────────────────────────────────────────────┤
│  VoxelChain Node (TeraETH-based)                │
│  - Real blocks every 5 seconds                  │
│  - PoW consensus                                │
│  - UTXO + EVM hybrid                            │
├─────────────────────────────────────────────────┤
│  Smart Contracts (Solidity)                     │
│  - VoxelLand (ERC-721) - Land ownership         │
│  - VoxelItems (ERC-1155) - Game items           │
└─────────────────────────────────────────────────┘
```

### Dual-Layer Block System

| Layer | Interval | Purpose |
|-------|----------|---------|
| Virtual Blocks | 0.01s | Instant TX confirmation for MetaMask/wallets |
| Real Blocks | 5s | PoW-secured data permanence |

## Project Structure

```
VoxelChain/
├── network.conf              # Network configuration (chain IDs, gas, world params)
├── rpc-bridge/               # Ethereum JSON-RPC bridge
│   ├── requirements.txt
│   └── voxelchain_bridge/
│       ├── config.py         # Bridge configuration
│       ├── converter.py      # ETH <-> VoxelChain format conversion
│       ├── node_client.py    # Node JSON-RPC client
│       ├── virtual_blocks.py # Virtual block engine (0.01s)
│       ├── voxel_world.py    # Chunk-based voxel world state
│       ├── eth_tx_decoder.py # Raw ETH transaction decoder
│       ├── handlers.py       # RPC method handlers
│       └── server.py         # HTTP/WS server
├── contracts/                # Solidity smart contracts
│   ├── VoxelLand.sol         # Land ownership NFT (ERC-721)
│   ├── VoxelItems.sol        # Game items (ERC-1155)
│   └── hardhat.config.js
├── explorer/                 # Block explorer with 3D world viewer
│   └── index.html
├── client/                   # Browser-based voxel game client
│   └── index.html
└── scripts/
    ├── mine-genesis.py       # Genesis block miner
    └── configure-network.py  # Apply network.conf to source files
```

## Quick Start

### 1. Start the RPC Bridge

```bash
cd rpc-bridge
pip install -r requirements.txt

# Start with default settings (connects to local node)
python -m voxelchain_bridge

# Or with custom settings
python -m voxelchain_bridge \
  --rpc-host 127.0.0.1 \
  --rpc-port 8332 \
  --rpc-user rpcuser \
  --rpc-pass rpcpassword \
  --port 8545 \
  --chain-id 784201
```

### 2. Access the Explorer

Open `http://localhost:8545` in your browser to see the block explorer with:
- Real-time virtual/real block numbers
- Voxel operation history
- 3D world viewer (isometric)
- Testnet faucet

### 3. Connect MetaMask

Add VoxelChain to MetaMask:
- Network Name: `VoxelChain Testnet`
- RPC URL: `http://localhost:8545`
- Chain ID: `784201`
- Currency Symbol: `VXL`

### 4. Open the Game Client

Navigate to `http://localhost:8545/client/` for the browser-based voxel world:
- WASD to move
- 1-9 to select block types
- Connect wallet to place blocks on-chain

## Network Configuration

All network parameters are defined in `network.conf`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `CHAIN_ID_MAINNET` | 784200 | Mainnet chain ID |
| `CHAIN_ID_TESTNET` | 784201 | Testnet chain ID |
| `CHAIN_ID_REGTEST` | 784202 | Regtest chain ID |
| `BLOCK_TIME` | 5 | Real block time (seconds) |
| `CHUNK_SIZE` | 16 | Voxel chunk dimension |
| `LAND_PLOT_SIZE` | 4 | Chunks per land plot |

After editing `network.conf`, run:
```bash
python3 scripts/configure-network.py --apply
```

## RPC Methods

### Standard Ethereum JSON-RPC

Full Ethereum JSON-RPC compatibility for MetaMask and Web3 libraries:

- `eth_chainId`, `eth_blockNumber`, `eth_getBalance`
- `eth_sendRawTransaction`, `eth_getTransactionReceipt`
- `eth_getBlockByNumber`, `eth_getBlockByHash`
- `eth_estimateGas`, `eth_gasPrice`, `eth_feeHistory`
- `net_version`, `web3_clientVersion`

### Voxel Game Methods

Custom methods for game world interaction:

| Method | Params | Description |
|--------|--------|-------------|
| `voxel_getWorldInfo` | none | Get world configuration |
| `voxel_getBlockTypes` | none | Get block type registry |
| `voxel_getChunk` | `[cx, cy, cz]` | Get chunk data for rendering |
| `voxel_placeBlock` | `[x, y, z, type, player?]` | Place a block |
| `voxel_breakBlock` | `[x, y, z, player?]` | Break a block |
| `voxel_getBlock` | `[x, y, z]` | Get block at position |
| `voxel_getChunkMerkleRoot` | `[cx, cy, cz]` | Get chunk Merkle root |
| `voxel_getPendingChanges` | none | Get pending world changes |

## Smart Contracts

### VoxelLand (ERC-721)
Land ownership NFTs. Each plot covers 4x4 chunks (64x64 voxels).

- `claimLand(plotX, plotZ)` - Claim unclaimed land (10 VXL fee)
- `updateMerkleRoot(tokenId, newRoot)` - Update chunk Merkle root
- `getPlotOwnerAtWorldPos(x, z)` - Check land ownership

### VoxelItems (ERC-1155)
Multi-token for blocks, tools, and materials.

- Token IDs 1-4095: Block types (minted from mining, burned for placement)
- Token IDs 10000-19999: Tools
- Token IDs 20000-29999: Materials
- `mintFromMining(player, blockType, amount)` - Mint blocks from mining
- `burnForPlacement(player, blockType, amount)` - Burn blocks for building

## Voxel Gas Costs

| Operation | Gas |
|-----------|-----|
| Place Block | 50,000 |
| Break Block | 30,000 |
| Transfer Item | 40,000 |
| Claim Land | 100,000 |

## Development

### Mine Genesis Block

```bash
# Mine for regtest (instant)
python3 scripts/mine-genesis.py --network regtest

# Mine for all networks
python3 scripts/mine-genesis.py --all --message "VoxelChain Genesis - Build Your World On-Chain"
```

### Run Lint Checks

```bash
cd rpc-bridge
pip install ruff
ruff check voxelchain_bridge/
```

## License

MIT License - See [LICENSE](LICENSE) for details.
