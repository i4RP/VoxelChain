#!/usr/bin/env python3
"""Mine genesis block for VoxelChain network.

Usage:
    python3 scripts/mine-genesis.py --network regtest
    python3 scripts/mine-genesis.py --network testnet
    python3 scripts/mine-genesis.py --all
    python3 scripts/mine-genesis.py --message "Custom genesis message" --all
"""

import argparse
import hashlib
import struct
import time
import sys
import os

# Add parent dir to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_network_conf():
    """Load network.conf parameters."""
    conf = {}
    conf_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "network.conf")
    with open(conf_path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, value = line.split("=", 1)
                conf[key.strip()] = value.strip()
    return conf


def sha256d(data: bytes) -> bytes:
    """Double SHA-256 hash."""
    return hashlib.sha256(hashlib.sha256(data).digest()).digest()


def create_coinbase_tx(message: str, reward_satoshis: int) -> bytes:
    """Create a coinbase transaction with embedded message."""
    msg_bytes = message.encode("utf-8")

    # Version
    tx = struct.pack("<I", 1)
    # Input count
    tx += b"\x01"
    # Previous output (null for coinbase)
    tx += b"\x00" * 32  # txid
    tx += struct.pack("<I", 0xFFFFFFFF)  # vout
    # Script length + script (contains the message)
    script = bytes([len(msg_bytes)]) + msg_bytes
    tx += bytes([len(script)]) + script
    # Sequence
    tx += struct.pack("<I", 0xFFFFFFFF)
    # Output count
    tx += b"\x01"
    # Value
    tx += struct.pack("<q", reward_satoshis)
    # Output script (OP_TRUE - anyone can spend for genesis)
    tx += b"\x01\x51"
    # Locktime
    tx += struct.pack("<I", 0)

    return tx


def compute_merkle_root(tx_hashes: list) -> bytes:
    """Compute merkle root from transaction hashes."""
    if not tx_hashes:
        return b"\x00" * 32
    hashes = [h for h in tx_hashes]
    while len(hashes) > 1:
        new_hashes = []
        for i in range(0, len(hashes), 2):
            if i + 1 < len(hashes):
                combined = hashes[i] + hashes[i + 1]
            else:
                combined = hashes[i] + hashes[i]
            new_hashes.append(sha256d(combined))
        hashes = new_hashes
    return hashes[0]


def mine_genesis(message: str, timestamp: int, reward: int,
                 difficulty_bits: int = 0x1d00ffff, max_nonce: int = 2**32) -> dict:
    """Mine a genesis block."""
    # Create coinbase transaction
    reward_satoshis = reward * 10**8
    coinbase_tx = create_coinbase_tx(message, reward_satoshis)
    coinbase_hash = sha256d(coinbase_tx)
    merkle_root = compute_merkle_root([coinbase_hash])

    # Target from bits
    exponent = difficulty_bits >> 24
    coefficient = difficulty_bits & 0x00FFFFFF
    target = coefficient * (1 << (8 * (exponent - 3)))

    print("Mining genesis block...")
    print(f"  Message: {message}")
    print(f"  Timestamp: {timestamp}")
    print(f"  Reward: {reward} VXL")
    print(f"  Difficulty bits: {hex(difficulty_bits)}")
    print(f"  Target: {target:064x}")

    # Build block header
    version = struct.pack("<I", 1)
    prev_block = b"\x00" * 32
    merkle = merkle_root
    time_bytes = struct.pack("<I", timestamp)
    bits = struct.pack("<I", difficulty_bits)

    start_time = time.time()

    for nonce in range(max_nonce):
        header = version + prev_block + merkle + time_bytes + bits + struct.pack("<I", nonce)
        block_hash = sha256d(header)
        hash_int = int.from_bytes(block_hash, "little")

        if hash_int < target:
            elapsed = time.time() - start_time
            hash_hex = block_hash[::-1].hex()
            merkle_hex = merkle_root[::-1].hex()

            print(f"\n  Found! Nonce: {nonce} ({elapsed:.2f}s)")
            print(f"  Hash: {hash_hex}")
            print(f"  Merkle Root: {merkle_hex}")

            return {
                "nonce": nonce,
                "hash": hash_hex,
                "merkle_root": merkle_hex,
                "timestamp": timestamp,
                "message": message,
                "bits": difficulty_bits,
                "reward": reward,
                "elapsed": elapsed,
            }

        if nonce % 1000000 == 0 and nonce > 0:
            elapsed = time.time() - start_time
            rate = nonce / elapsed
            print(f"  ... {nonce:,} hashes ({rate:,.0f} H/s)")

    raise RuntimeError("Failed to find genesis block within nonce range")


def main():
    parser = argparse.ArgumentParser(description="Mine VoxelChain genesis block")
    parser.add_argument("--network", choices=["mainnet", "testnet", "regtest"],
                        help="Network to mine genesis for")
    parser.add_argument("--all", action="store_true", help="Mine for all networks")
    parser.add_argument("--message", help="Override genesis message")
    parser.add_argument("--timestamp", type=int, help="Override genesis timestamp")
    args = parser.parse_args()

    conf = load_network_conf()
    message = args.message or conf.get("GENESIS_MESSAGE", "VoxelChain Genesis")
    timestamp = args.timestamp or int(conf.get("GENESIS_TIME", str(int(time.time()))))
    reward = int(conf.get("GENESIS_REWARD", "100"))

    networks = []
    if args.all:
        networks = ["mainnet", "testnet", "regtest"]
    elif args.network:
        networks = [args.network]
    else:
        networks = ["regtest"]

    # Difficulty bits per network
    difficulty_map = {
        "mainnet": 0x1d00ffff,  # Standard Bitcoin difficulty
        "testnet": 0x1e0fffff,  # Easier
        "regtest": 0x207fffff,  # Very easy (instant)
    }

    results = {}
    for network in networks:
        print(f"\n{'=' * 60}")
        print(f"Mining genesis for {network.upper()}")
        print(f"{'=' * 60}")

        bits = difficulty_map[network]
        result = mine_genesis(message, timestamp, reward, bits)
        results[network] = result

    print(f"\n{'=' * 60}")
    print("GENESIS BLOCK PARAMETERS")
    print(f"{'=' * 60}")
    for network, result in results.items():
        print(f"\n[{network.upper()}]")
        print(f"  nonce     = {result['nonce']}")
        print(f"  hash      = {result['hash']}")
        print(f"  merkle    = {result['merkle_root']}")
        print(f"  timestamp = {result['timestamp']}")
        print(f"  message   = {result['message']}")

    # Output as configure-network.py args
    if results:
        print("\n# Apply with:")
        cmd = "python3 scripts/configure-network.py --apply"
        for network, result in results.items():
            cmd += f" \\\n  --genesis-nonce-{network} {result['nonce']}"
            cmd += f" \\\n  --genesis-hash-{network} {result['hash']}"
        print(cmd)


if __name__ == "__main__":
    main()
