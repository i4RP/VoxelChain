"""Virtual Block Engine for VoxelChain.

Generates virtual blocks every 0.01s for instant transaction confirmation,
while actual blocks are mined every 5 seconds for data permanence.

Architecture:
- Surface layer (MetaMask/wallets): Virtual blocks every 0.01s
- Base layer (PoW): Real blocks every 5 seconds
- Voxel operations validated instantly via 0-conf
- Virtual blocks package validated TXs for wallet display
"""

import hashlib
import json
import logging
import os
import threading
import time
from collections import OrderedDict
from typing import Optional

logger = logging.getLogger(__name__)

VIRTUAL_BLOCK_TIME = 0.01  # 10ms
MAX_CACHED_BLOCKS = 100_000


class VirtualBlock:
    """A virtual block generated every 0.01s."""

    __slots__ = ("number", "parent_hash", "timestamp", "transactions", "hash")

    def __init__(self, number: int, parent_hash: str, timestamp: float,
                 transactions: list):
        self.number = number
        self.parent_hash = parent_hash
        self.timestamp = timestamp
        self.transactions = transactions
        self.hash = self._compute_hash()

    def _compute_hash(self) -> str:
        data = f"{self.number}:{self.parent_hash}:{self.timestamp:.6f}"
        if self.transactions:
            data += ":" + ",".join(self.transactions)
        return "0x" + hashlib.sha256(data.encode()).hexdigest()

    def to_eth_block(self, full_transactions: bool = False) -> dict:
        from .converter import ensure_hex_prefix, to_hex

        txs = [ensure_hex_prefix(tx) for tx in self.transactions]
        gas_used = len(self.transactions) * 21000

        return {
            "number": to_hex(self.number),
            "hash": self.hash,
            "parentHash": self.parent_hash,
            "nonce": "0x0000000000000000",
            "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
            "logsBloom": "0x" + "00" * 256,
            "transactionsRoot": "0x" + "00" * 32,
            "stateRoot": "0x" + "00" * 32,
            "receiptsRoot": "0x" + "00" * 32,
            "miner": "0x" + "00" * 20,
            "difficulty": "0x1",
            "totalDifficulty": "0x1",
            "extraData": "0x",
            "size": to_hex(max(len(self.transactions) * 250, 1000)),
            "gasLimit": "0x1c9c380",
            "gasUsed": to_hex(gas_used),
            "timestamp": to_hex(int(self.timestamp)),
            "transactions": txs,
            "uncles": [],
            "baseFeePerGas": "0x3b9aca00",
            "mixHash": "0x" + "00" * 32,
        }


class VirtualBlockEngine:
    """Generates virtual blocks every 0.01s for instant TX confirmation."""

    def __init__(self, node_client, data_dir: str = "/tmp/voxelchain-vblocks"):
        self.node = node_client
        self.data_dir = data_dir
        self._epoch: float = 0.0
        self._base_height: int = 0
        self._tx_vblock: dict = {}
        self._vblock_txs: dict = {}
        self._pending_txs: set = set()
        self._real_block_height: int = 0
        self._real_block_txs: dict = {}
        self._block_cache: OrderedDict = OrderedDict()
        self._lock = threading.RLock()
        self._running = False
        self._monitor_thread: Optional[threading.Thread] = None
        self._known_mempool: set = set()

    def start(self):
        os.makedirs(self.data_dir, exist_ok=True)
        epoch_file = os.path.join(self.data_dir, "epoch.json")
        if os.path.exists(epoch_file):
            try:
                with open(epoch_file) as f:
                    data = json.load(f)
                    self._epoch = data["epoch"]
                    self._base_height = data.get("base_height", 0)
            except (json.JSONDecodeError, KeyError):
                self._init_epoch()
        else:
            self._init_epoch()

        try:
            self._real_block_height = self.node.getblockcount()
        except Exception:
            pass

        self._running = True
        self._monitor_thread = threading.Thread(
            target=self._monitor_loop, daemon=True, name="vblock-monitor"
        )
        self._monitor_thread.start()
        logger.info("Virtual block engine started. base_height=%d", self._base_height)

    def _init_epoch(self):
        try:
            self._real_block_height = self.node.getblockcount()
        except Exception:
            self._real_block_height = 0
        self._base_height = self._real_block_height
        self._epoch = time.time()
        self._save_epoch()

    def stop(self):
        self._running = False
        if self._monitor_thread:
            self._monitor_thread.join(timeout=5)

    def _save_epoch(self):
        epoch_file = os.path.join(self.data_dir, "epoch.json")
        try:
            with open(epoch_file, "w") as f:
                json.dump({"epoch": self._epoch, "base_height": self._base_height}, f)
        except OSError as e:
            logger.error("Failed to save epoch: %s", e)

    def _monitor_loop(self):
        while self._running:
            try:
                self._poll_mempool()
                self._poll_real_blocks()
            except Exception as e:
                logger.debug("Monitor loop error: %s", e)
            time.sleep(0.1)

    def _poll_mempool(self):
        try:
            mempool = set(self.node.call("getrawmempool"))
        except Exception:
            return
        new_txs = mempool - self._known_mempool
        if new_txs:
            current_vblock = self.get_block_number()
            with self._lock:
                for txid in new_txs:
                    if txid not in self._tx_vblock:
                        self._tx_vblock[txid] = current_vblock
                        if current_vblock not in self._vblock_txs:
                            self._vblock_txs[current_vblock] = []
                        self._vblock_txs[current_vblock].append(txid)
                        self._pending_txs.add(txid)
        self._known_mempool = mempool

    def _poll_real_blocks(self):
        try:
            height = self.node.getblockcount()
        except Exception:
            return
        if height > self._real_block_height:
            for h in range(self._real_block_height + 1, height + 1):
                try:
                    block_hash = self.node.getblockhash(h)
                    block = self.node.getblock(block_hash, 1)
                    for txid in block.get("tx", []):
                        with self._lock:
                            self._real_block_txs[txid] = h
                            self._pending_txs.discard(txid)
                            self._known_mempool.discard(txid)
                            if txid not in self._tx_vblock:
                                current_vblock = self.get_block_number()
                                self._tx_vblock[txid] = current_vblock
                                if current_vblock not in self._vblock_txs:
                                    self._vblock_txs[current_vblock] = []
                                self._vblock_txs[current_vblock].append(txid)
                except Exception as e:
                    logger.debug("Error processing real block %d: %s", h, e)
            self._real_block_height = height

    def get_block_number(self) -> int:
        elapsed = time.time() - self._epoch
        return self._base_height + max(0, int(elapsed / VIRTUAL_BLOCK_TIME))

    def get_real_block_height(self) -> int:
        return self._real_block_height

    def get_block_by_number(self, number: int, full_transactions: bool = False) -> Optional[dict]:
        current = self.get_block_number()
        if number > current or number < 0:
            return None
        if number < self._base_height:
            return self._get_real_block(number, full_transactions)
        vblock = self._make_virtual_block(number)
        if vblock:
            return vblock.to_eth_block(full_transactions)
        return None

    def get_block_by_hash(self, block_hash: str, full_transactions: bool = False) -> Optional[dict]:
        with self._lock:
            for vblock in self._block_cache.values():
                if vblock.hash == block_hash:
                    return vblock.to_eth_block(full_transactions)
        try:
            clean_hash = block_hash.replace("0x", "")
            verbosity = 2 if full_transactions else 1
            block = self.node.getblock(clean_hash, verbosity)
            from .converter import block_to_eth_block
            return block_to_eth_block(block, full_transactions)
        except Exception:
            return None

    def register_transaction(self, txid: str) -> int:
        clean_txid = txid.replace("0x", "")
        current_vblock = self.get_block_number()
        with self._lock:
            self._tx_vblock[clean_txid] = current_vblock
            if current_vblock not in self._vblock_txs:
                self._vblock_txs[current_vblock] = []
            self._vblock_txs[current_vblock].append(clean_txid)
            self._pending_txs.add(clean_txid)
        return current_vblock

    def get_tx_block_number(self, txid: str) -> Optional[int]:
        clean_txid = txid.replace("0x", "")
        with self._lock:
            return self._tx_vblock.get(clean_txid)

    def get_tx_block_hash(self, txid: str) -> Optional[str]:
        clean_txid = txid.replace("0x", "")
        with self._lock:
            vblock_num = self._tx_vblock.get(clean_txid)
            if vblock_num is not None:
                vblock = self._block_cache.get(vblock_num)
                if vblock:
                    return vblock.hash
                vblock = self._make_virtual_block(vblock_num)
                if vblock:
                    return vblock.hash
        return None

    def _get_real_block(self, height: int, full_transactions: bool = False) -> Optional[dict]:
        try:
            block_hash = self.node.getblockhash(height)
            verbosity = 2 if full_transactions else 1
            block = self.node.getblock(block_hash, verbosity)
            from .converter import block_to_eth_block
            return block_to_eth_block(block, full_transactions)
        except Exception:
            return None

    def _make_virtual_block(self, number: int) -> Optional[VirtualBlock]:
        with self._lock:
            if number in self._block_cache:
                return self._block_cache[number]

        offset = number - self._base_height
        block_time = self._epoch + offset * VIRTUAL_BLOCK_TIME

        with self._lock:
            txs = list(self._vblock_txs.get(number, []))

        if number == 0:
            parent_hash = "0x" + "00" * 32
        else:
            parent_data = f"vblock-parent:{number - 1}"
            parent_hash = "0x" + hashlib.sha256(parent_data.encode()).hexdigest()

        vblock = VirtualBlock(
            number=number, parent_hash=parent_hash,
            timestamp=block_time, transactions=txs,
        )

        with self._lock:
            self._block_cache[number] = vblock
            while len(self._block_cache) > MAX_CACHED_BLOCKS:
                self._block_cache.popitem(last=False)

        return vblock
