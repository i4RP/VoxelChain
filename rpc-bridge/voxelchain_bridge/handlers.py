"""Ethereum JSON-RPC + Voxel method handlers for VoxelChain RPC Bridge.

Handles standard Ethereum JSON-RPC methods plus custom voxel_* methods
for game world interaction.

Dual-layer architecture:
- Virtual blocks (0.01s) for instant wallet/game confirmation
- Real blocks (5s) for data permanence
"""

import hashlib
import logging
import time
from typing import Any, Optional

from .config import BridgeConfig, VOXEL_GAS
from .converter import (
    block_to_eth_block,
    to_hex,
    from_hex,
    tx_to_eth_receipt,
    tx_to_eth_transaction,
    ensure_hex_prefix,
    eth_to_native_address,
)
from .eth_tx_decoder import decode_raw_transaction
from .node_client import RPCError, VoxelChainNodeClient
from .virtual_blocks import VirtualBlockEngine
from .voxel_world import VoxelWorld, BLOCK_TYPES
from .crafting import CraftingSystem
from .economy import EconomySystem
from .multiplayer import MultiplayerManager

logger = logging.getLogger(__name__)


class EthRPCHandlers:
    """Handles Ethereum JSON-RPC + voxel game method calls."""

    def __init__(self, config: BridgeConfig, node_client: VoxelChainNodeClient,
                 vblock_engine: Optional[VirtualBlockEngine] = None,
                 voxel_world: Optional[VoxelWorld] = None):
        self.config = config
        self.node = node_client
        self.vblocks = vblock_engine
        self.world = voxel_world
        self._imported_addresses: set = set()
        self._nonces: dict[str, int] = {}
        self._pending_txs: dict[str, dict] = {}
        self._last_nonce_query_addr: str = ""

        # Game systems
        self.crafting = CraftingSystem()
        self.economy = EconomySystem()
        self.multiplayer = MultiplayerManager()

        self._handlers = {
            # Web3 methods
            "web3_clientVersion": self.web3_client_version,
            "web3_sha3": self.web3_sha3,
            # Net methods
            "net_version": self.net_version,
            "net_listening": self.net_listening,
            "net_peerCount": self.net_peer_count,
            # Eth methods
            "eth_chainId": self.eth_chain_id,
            "eth_protocolVersion": self.eth_protocol_version,
            "eth_syncing": self.eth_syncing,
            "eth_coinbase": self.eth_coinbase,
            "eth_mining": self.eth_mining,
            "eth_hashrate": self.eth_hashrate,
            "eth_gasPrice": self.eth_gas_price,
            "eth_accounts": self.eth_accounts,
            "eth_blockNumber": self.eth_block_number,
            "eth_getBalance": self.eth_get_balance,
            "eth_getStorageAt": self.eth_get_storage_at,
            "eth_getTransactionCount": self.eth_get_transaction_count,
            "eth_getBlockTransactionCountByHash": self.eth_get_block_tx_count_by_hash,
            "eth_getBlockTransactionCountByNumber": self.eth_get_block_tx_count_by_number,
            "eth_getCode": self.eth_get_code,
            "eth_sendRawTransaction": self.eth_send_raw_transaction,
            "eth_call": self.eth_call,
            "eth_estimateGas": self.eth_estimate_gas,
            "eth_getBlockByHash": self.eth_get_block_by_hash,
            "eth_getBlockByNumber": self.eth_get_block_by_number,
            "eth_getTransactionByHash": self.eth_get_transaction_by_hash,
            "eth_getTransactionReceipt": self.eth_get_transaction_receipt,
            "eth_getLogs": self.eth_get_logs,
            "eth_feeHistory": self.eth_fee_history,
            "eth_maxPriorityFeePerGas": self.eth_max_priority_fee,
            # Wallet methods
            "wallet_addEthereumChain": self.wallet_add_chain,
            "wallet_switchEthereumChain": self.wallet_switch_chain,
            # === VoxelChain Custom Methods ===
            "voxel_getWorldInfo": self.voxel_get_world_info,
            "voxel_getBlockTypes": self.voxel_get_block_types,
            "voxel_getChunk": self.voxel_get_chunk,
            "voxel_placeBlock": self.voxel_place_block,
            "voxel_breakBlock": self.voxel_break_block,
            "voxel_getBlock": self.voxel_get_block,
            "voxel_getChunkMerkleRoot": self.voxel_get_chunk_merkle_root,
            "voxel_getPendingChanges": self.voxel_get_pending_changes,
            # === Game System Methods ===
            "game_getRecipes": self.game_get_recipes,
            "game_craft": self.game_craft,
            "game_getInventory": self.game_get_inventory,
            "game_getEconomyStats": self.game_get_economy_stats,
            "game_getLeaderboard": self.game_get_leaderboard,
            "game_createListing": self.game_create_listing,
            "game_buyListing": self.game_buy_listing,
            "game_getListings": self.game_get_listings,
            "game_playerJoin": self.game_player_join,
            "game_playerLeave": self.game_player_leave,
            "game_updatePosition": self.game_update_position,
            "game_getOnlinePlayers": self.game_get_online_players,
            "game_chat": self.game_chat,
            "game_getEvents": self.game_get_events,
            "game_getServerInfo": self.game_get_server_info,
        }

    def get_handler(self, method: str):
        return self._handlers.get(method)

    def list_methods(self) -> list:
        return list(self._handlers.keys())

    # === Web3 Methods ===

    def web3_client_version(self, params: list) -> str:
        return "VoxelChain/v0.1.0/linux-amd64"

    def web3_sha3(self, params: list) -> str:
        data = params[0] if params else "0x"
        data_bytes = bytes.fromhex(data.replace("0x", ""))
        result = hashlib.sha256(data_bytes).hexdigest()
        return "0x" + result

    # === Net Methods ===

    def net_version(self, params: list) -> str:
        return str(self.config.network_id)

    def net_listening(self, params: list) -> bool:
        return True

    def net_peer_count(self, params: list) -> str:
        try:
            info = self.node.call("getnetworkinfo")
            return to_hex(info.get("connections", 0))
        except RPCError:
            return "0x0"

    # === Eth Methods ===

    def eth_chain_id(self, params: list) -> str:
        return self.config.chain_id_hex

    def eth_protocol_version(self, params: list) -> str:
        return "0x41"

    def eth_syncing(self, params: list) -> Any:
        try:
            info = self.node.call("getblockchaininfo")
            blocks = info.get("blocks", 0)
            headers = info.get("headers", 0)
            if blocks >= headers:
                return False
            return {
                "startingBlock": "0x0",
                "currentBlock": to_hex(blocks),
                "highestBlock": to_hex(headers),
            }
        except RPCError:
            return False

    def eth_coinbase(self, params: list) -> str:
        return "0x" + "00" * 20

    def eth_mining(self, params: list) -> bool:
        return False

    def eth_hashrate(self, params: list) -> str:
        return "0x0"

    def eth_gas_price(self, params: list) -> str:
        return to_hex(self.config.default_gas_price)

    def eth_accounts(self, params: list) -> list:
        return []

    def eth_block_number(self, params: list) -> str:
        if self.vblocks:
            return to_hex(self.vblocks.get_block_number())
        try:
            return to_hex(self.node.getblockcount())
        except RPCError:
            return "0x0"

    def eth_get_balance(self, params: list) -> str:
        eth_address = params[0] if params else ""
        try:
            native_addr = eth_to_native_address(eth_address, testnet=True)
            if native_addr not in self._imported_addresses:
                try:
                    self.node.importaddress(native_addr, "eth_" + eth_address[:10].lower(), True)
                    self._imported_addresses.add(native_addr)
                except RPCError:
                    self._imported_addresses.add(native_addr)
            utxos = self.node.listunspent(0, 9999999, [native_addr])
            total_wei = sum(int(round(u.get("amount", 0) * 10**18)) for u in utxos)
            return to_hex(total_wei)
        except RPCError:
            return "0x0"

    def eth_get_storage_at(self, params: list) -> str:
        return "0x0"

    def eth_get_transaction_count(self, params: list) -> str:
        eth_address = params[0].lower() if params else ""
        self._last_nonce_query_addr = eth_address
        if eth_address not in self._nonces:
            self._nonces[eth_address] = 0
        return to_hex(self._nonces[eth_address])

    def eth_get_block_tx_count_by_hash(self, params: list) -> Optional[str]:
        block_hash = params[0] if params else ""
        try:
            block = self.node.getblock(block_hash.replace("0x", ""), 1)
            return to_hex(len(block.get("tx", [])))
        except RPCError:
            return None

    def eth_get_block_tx_count_by_number(self, params: list) -> Optional[str]:
        block_num = params[0] if params else "latest"
        try:
            height = self._resolve_block_number(block_num)
            block_hash = self.node.getblockhash(height)
            block = self.node.getblock(block_hash, 1)
            return to_hex(len(block.get("tx", [])))
        except RPCError:
            return None

    def eth_get_code(self, params: list) -> str:
        return "0x"

    def eth_send_raw_transaction(self, params: list) -> str:
        raw_tx = params[0] if params else ""
        try:
            decoded = decode_raw_transaction(raw_tx)
            if not decoded.to_address:
                raise RPCError(-32000, "Contract creation not supported")
            if decoded.value == 0 and not decoded.data:
                raise RPCError(-32000, "Zero-value transaction with no data")

            to_native = eth_to_native_address(decoded.to_address, testnet=True)
            value_coins = decoded.value / 10**18
            if value_coins <= 0:
                raise RPCError(-32000, "Amount too small")

            txid = self.node.sendtoaddress(to_native, value_coins)

            from_addr = self._last_nonce_query_addr or "0x" + "00" * 20
            if from_addr in self._nonces:
                self._nonces[from_addr] = decoded.nonce + 1

            eth_tx_hash = ensure_hex_prefix(txid)
            self._pending_txs[txid.lower()] = {
                "from": from_addr,
                "to": decoded.to_address,
                "value": decoded.value,
                "nonce": decoded.nonce,
                "timestamp": int(time.time()),
            }

            if self.vblocks:
                self.vblocks.register_transaction(txid)

            return eth_tx_hash
        except RPCError:
            raise
        except Exception as e:
            raise RPCError(-32000, f"Transaction failed: {str(e)}")

    def eth_call(self, params: list) -> str:
        return "0x"

    def eth_estimate_gas(self, params: list) -> str:
        return to_hex(self.config.default_gas_limit)

    def eth_get_block_by_hash(self, params: list) -> Optional[dict]:
        block_hash = params[0] if params else ""
        full_tx = params[1] if len(params) > 1 else False
        if self.vblocks:
            block = self.vblocks.get_block_by_hash(block_hash, full_tx)
            if block:
                return block
        try:
            clean_hash = block_hash.replace("0x", "")
            verbosity = 2 if full_tx else 1
            block = self.node.getblock(clean_hash, verbosity)
            return block_to_eth_block(block, full_tx)
        except RPCError:
            return None

    def eth_get_block_by_number(self, params: list) -> Optional[dict]:
        block_num = params[0] if params else "latest"
        full_tx = params[1] if len(params) > 1 else False
        try:
            height = self._resolve_block_number(block_num)
            if self.vblocks:
                block = self.vblocks.get_block_by_number(height, full_tx)
                if block:
                    return block
            block_hash = self.node.getblockhash(height)
            verbosity = 2 if full_tx else 1
            block = self.node.getblock(block_hash, verbosity)
            return block_to_eth_block(block, full_tx)
        except RPCError:
            return None

    def eth_get_transaction_by_hash(self, params: list) -> Optional[dict]:
        tx_hash = params[0] if params else ""
        try:
            clean_hash = tx_hash.replace("0x", "")
            tx = self.node.getrawtransaction(clean_hash, True)
            block_hash = tx.get("blockhash", "")
            block_number = 0

            if self.vblocks:
                vblock_num = self.vblocks.get_tx_block_number(clean_hash)
                if vblock_num is not None:
                    block_number = vblock_num
                    vblock_hash = self.vblocks.get_tx_block_hash(clean_hash)
                    if vblock_hash:
                        block_hash = vblock_hash

            return tx_to_eth_transaction(tx, block_hash, block_number, 0)
        except RPCError:
            return None

    def eth_get_transaction_receipt(self, params: list) -> Optional[dict]:
        tx_hash = params[0] if params else ""
        try:
            clean_hash = tx_hash.replace("0x", "")
            tx = self.node.getrawtransaction(clean_hash, True)
            block_hash = tx.get("blockhash", "")
            block_number = 0

            if self.vblocks:
                vblock_num = self.vblocks.get_tx_block_number(clean_hash)
                if vblock_num is not None:
                    block_number = vblock_num

            return tx_to_eth_receipt(tx, block_hash, block_number, 0)
        except RPCError:
            return None

    def eth_get_logs(self, params: list) -> list:
        return []

    def eth_fee_history(self, params: list) -> dict:
        block_count = from_hex(params[0]) if params else 1
        return {
            "baseFeePerGas": [to_hex(self.config.default_gas_price)] * (block_count + 1),
            "gasUsedRatio": [0.5] * block_count,
            "oldestBlock": "0x1",
            "reward": [[to_hex(self.config.default_gas_price)]] * block_count,
        }

    def eth_max_priority_fee(self, params: list) -> str:
        return to_hex(self.config.default_gas_price)

    def wallet_add_chain(self, params: list) -> None:
        return None

    def wallet_switch_chain(self, params: list) -> None:
        return None

    # === VoxelChain Custom Methods ===

    def voxel_get_world_info(self, params: list) -> dict:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        info = self.world.get_world_info()
        info["chainId"] = self.config.chain_id
        info["network"] = self.config.network
        info["blockTime"] = "5s (real) / 0.01s (virtual)"
        return info

    def voxel_get_block_types(self, params: list) -> dict:
        return BLOCK_TYPES

    def voxel_get_chunk(self, params: list) -> dict:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        if len(params) < 3:
            raise RPCError(-32602, "Expected [cx, cy, cz]")
        cx, cy, cz = int(params[0]), int(params[1]), int(params[2])
        return self.world.get_chunk_data(cx, cy, cz)

    def voxel_place_block(self, params: list) -> dict:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        if len(params) < 4:
            raise RPCError(-32602, "Expected [x, y, z, blockType, player?]")
        x, y, z = int(params[0]), int(params[1]), int(params[2])
        block_type = int(params[3])
        player = params[4] if len(params) > 4 else ""
        try:
            change = self.world.place_block(x, y, z, block_type, player)
            change["gasUsed"] = VOXEL_GAS["place_block"]
            return change
        except ValueError as e:
            raise RPCError(-32000, str(e))

    def voxel_break_block(self, params: list) -> dict:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        if len(params) < 3:
            raise RPCError(-32602, "Expected [x, y, z, player?]")
        x, y, z = int(params[0]), int(params[1]), int(params[2])
        player = params[3] if len(params) > 3 else ""
        try:
            change = self.world.break_block(x, y, z, player)
            change["gasUsed"] = VOXEL_GAS["break_block"]
            return change
        except ValueError as e:
            raise RPCError(-32000, str(e))

    def voxel_get_block(self, params: list) -> dict:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        if len(params) < 3:
            raise RPCError(-32602, "Expected [x, y, z]")
        x, y, z = int(params[0]), int(params[1]), int(params[2])
        block = self.world.get_block(x, y, z)
        type_info = BLOCK_TYPES.get(block.block_type, {"name": "unknown"})
        return {
            "position": {"x": x, "y": y, "z": z},
            "type": block.block_type,
            "typeName": type_info["name"],
            "param1": block.param1,
            "param2": block.param2,
            "isAir": block.is_air(),
        }

    def voxel_get_chunk_merkle_root(self, params: list) -> str:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        if len(params) < 3:
            raise RPCError(-32602, "Expected [cx, cy, cz]")
        cx, cy, cz = int(params[0]), int(params[1]), int(params[2])
        chunk = self.world.get_chunk(cx, cy, cz)
        return chunk.merkle_root

    def voxel_get_pending_changes(self, params: list) -> list:
        if not self.world:
            raise RPCError(-32000, "Voxel world not initialized")
        return self.world.get_pending_changes()

    # === Game System Methods ===

    def game_get_recipes(self, params: list) -> list:
        category = params[0] if params else None
        if category:
            return self.crafting.get_recipes_by_category(category)
        return self.crafting.get_all_recipes()

    def game_craft(self, params: list) -> dict:
        if len(params) < 2:
            raise RPCError(-32602, "Expected [player_address, recipe_id]")
        player_addr = params[0]
        recipe_id = params[1]
        player = self.economy.get_player(player_addr)
        result = self.crafting.craft(recipe_id, player.items)
        if result is None:
            raise RPCError(-32000, "Cannot craft: missing ingredients or invalid recipe")
        result_type, result_count, new_inventory = result
        player.items = new_inventory
        return {
            "success": True,
            "resultType": result_type,
            "resultCount": result_count,
            "inventory": player.to_dict()["items"],
        }

    def game_get_inventory(self, params: list) -> dict:
        if not params:
            raise RPCError(-32602, "Expected [player_address]")
        player = self.economy.get_player(params[0])
        return player.to_dict()

    def game_get_economy_stats(self, params: list) -> dict:
        return self.economy.get_economy_stats()

    def game_get_leaderboard(self, params: list) -> list:
        limit = int(params[0]) if params else 10
        return self.economy.get_leaderboard(limit)

    def game_create_listing(self, params: list) -> dict:
        if len(params) < 4:
            raise RPCError(-32602, "Expected [seller, item_type, item_count, price_vxl]")
        seller, item_type, item_count, price = params[0], int(params[1]), int(params[2]), float(params[3])
        result = self.economy.create_listing(seller, item_type, item_count, price)
        if result is None:
            raise RPCError(-32000, "Cannot create listing: insufficient items")
        return result

    def game_buy_listing(self, params: list) -> dict:
        if len(params) < 2:
            raise RPCError(-32602, "Expected [buyer_address, listing_id]")
        result = self.economy.buy_listing(params[0], params[1])
        if result is None:
            raise RPCError(-32000, "Cannot buy: listing not found or insufficient VXL")
        return result

    def game_get_listings(self, params: list) -> list:
        listing_type = params[0] if params else "all"
        return self.economy.get_active_listings(listing_type)

    def game_player_join(self, params: list) -> dict:
        if not params:
            raise RPCError(-32602, "Expected [player_address, display_name?, position?]")
        address = params[0]
        display_name = params[1] if len(params) > 1 else ""
        position = params[2] if len(params) > 2 else None
        return self.multiplayer.player_join(address, display_name, position)

    def game_player_leave(self, params: list) -> dict:
        if not params:
            raise RPCError(-32602, "Expected [player_address]")
        return self.multiplayer.player_leave(params[0])

    def game_update_position(self, params: list) -> bool:
        if len(params) < 2:
            raise RPCError(-32602, "Expected [player_address, position]")
        look = params[2] if len(params) > 2 else None
        return self.multiplayer.update_position(params[0], params[1], look)

    def game_get_online_players(self, params: list) -> list:
        return self.multiplayer.get_online_players()

    def game_chat(self, params: list) -> dict:
        if len(params) < 2:
            raise RPCError(-32602, "Expected [sender_address, message]")
        return self.multiplayer.broadcast_chat(params[0], params[1])

    def game_get_events(self, params: list) -> list:
        since = float(params[0]) if params else 0
        limit = int(params[1]) if len(params) > 1 else 50
        return self.multiplayer.get_recent_events(since, limit)

    def game_get_server_info(self, params: list) -> dict:
        mp_info = self.multiplayer.get_server_info()
        economy_info = self.economy.get_economy_stats()
        world_info = self.world.get_world_info() if self.world else {}
        return {
            **mp_info,
            **economy_info,
            **world_info,
            "version": "0.2.0",
        }

    # === Internal ===

    def _resolve_block_number(self, block_num) -> int:
        if isinstance(block_num, str):
            if block_num in ("latest", "pending"):
                if self.vblocks:
                    return self.vblocks.get_block_number()
                return self.node.getblockcount()
            elif block_num == "earliest":
                return 0
            else:
                return from_hex(block_num)
        return int(block_num)
