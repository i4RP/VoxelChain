#!/usr/bin/env python3
"""Apply network.conf parameters to VoxelChain source files.

Usage:
    python3 scripts/configure-network.py              # Dry run
    python3 scripts/configure-network.py --apply      # Apply changes
"""

import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def load_network_conf() -> dict:
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


def update_bridge_config(conf: dict, dry_run: bool = True) -> list:
    """Update rpc-bridge/voxelchain_bridge/config.py with network.conf values."""
    changes = []
    filepath = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "rpc-bridge", "voxelchain_bridge", "config.py"
    )

    if not os.path.exists(filepath):
        print(f"  [SKIP] {filepath} not found")
        return changes

    with open(filepath) as f:
        content = f.read()

    replacements = {
        r'"mainnet": \d+': f'"mainnet": {conf.get("CHAIN_ID_MAINNET", "784200")}',
        r'"testnet": \d+': f'"testnet": {conf.get("CHAIN_ID_TESTNET", "784201")}',
        r'"regtest": \d+': f'"regtest": {conf.get("CHAIN_ID_REGTEST", "784202")}',
        r'"place_block": \d+': f'"place_block": {conf.get("GAS_PLACE_BLOCK", "50000")}',
        r'"break_block": \d+': f'"break_block": {conf.get("GAS_BREAK_BLOCK", "30000")}',
        r'"transfer_item": \d+': f'"transfer_item": {conf.get("GAS_TRANSFER_ITEM", "40000")}',
        r'"claim_land": \d+': f'"claim_land": {conf.get("GAS_CLAIM_LAND", "100000")}',
        r'"chunk_size": \d+': f'"chunk_size": {conf.get("CHUNK_SIZE", "16")}',
        r'"world_height": \d+': f'"world_height": {conf.get("WORLD_HEIGHT", "16")}',
        r'"world_radius": \d+': f'"world_radius": {conf.get("WORLD_RADIUS", "1000")}',
        r'"max_block_types": \d+': f'"max_block_types": {conf.get("MAX_BLOCK_TYPES", "4096")}',
        r'"land_plot_size": \d+': f'"land_plot_size": {conf.get("LAND_PLOT_SIZE", "4")}',
        r'"max_blocks_per_tx": \d+': f'"max_blocks_per_tx": {conf.get("MAX_BLOCKS_PER_TX", "64")}',
    }

    new_content = content
    for pattern, replacement in replacements.items():
        match = re.search(pattern, new_content)
        if match and match.group() != replacement:
            changes.append(f"  config.py: {match.group()} -> {replacement}")
            new_content = re.sub(pattern, replacement, new_content)

    if not dry_run and changes:
        with open(filepath, "w") as f:
            f.write(new_content)
        print(f"  [UPDATED] {filepath}")

    return changes


def update_explorer(conf: dict, dry_run: bool = True) -> list:
    """Update explorer/index.html with network.conf values."""
    changes = []
    filepath = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "explorer", "index.html"
    )

    if not os.path.exists(filepath):
        print(f"  [SKIP] {filepath} not found")
        return changes

    with open(filepath) as f:
        content = f.read()

    replacements = {
        "VoxelChain": conf.get("NETWORK_NAME", "VoxelChain"),
        "VXL": conf.get("CURRENCY_SYMBOL", "VXL"),
        "784201": conf.get("CHAIN_ID_TESTNET", "784201"),
        "100 VXL": f'{conf.get("FAUCET_AMOUNT", "100")} {conf.get("CURRENCY_SYMBOL", "VXL")}',
    }

    for old, new in replacements.items():
        if old != new and old in content:
            changes.append(f"  explorer: {old} -> {new}")
            if not dry_run:
                content = content.replace(old, new)

    if not dry_run and changes:
        with open(filepath, "w") as f:
            f.write(content)
        print(f"  [UPDATED] {filepath}")

    return changes


def main():
    parser = argparse.ArgumentParser(description="Apply network.conf to VoxelChain source files")
    parser.add_argument("--apply", action="store_true", help="Apply changes (default: dry run)")
    parser.add_argument("--genesis-nonce-testnet", type=int, help="Genesis nonce for testnet")
    parser.add_argument("--genesis-hash-testnet", help="Genesis hash for testnet")
    parser.add_argument("--genesis-nonce-regtest", type=int, help="Genesis nonce for regtest")
    parser.add_argument("--genesis-hash-regtest", help="Genesis hash for regtest")
    parser.add_argument("--genesis-nonce-mainnet", type=int, help="Genesis nonce for mainnet")
    parser.add_argument("--genesis-hash-mainnet", help="Genesis hash for mainnet")
    args = parser.parse_args()

    conf = load_network_conf()
    dry_run = not args.apply

    if dry_run:
        print("DRY RUN - No files will be modified. Use --apply to apply changes.\n")
    else:
        print("APPLYING CHANGES\n")

    print(f"Network: {conf.get('NETWORK_NAME', 'VoxelChain')}")
    print(f"Chain IDs: mainnet={conf.get('CHAIN_ID_MAINNET')}, "
          f"testnet={conf.get('CHAIN_ID_TESTNET')}, "
          f"regtest={conf.get('CHAIN_ID_REGTEST')}")
    print()

    all_changes = []

    print("Updating bridge config...")
    changes = update_bridge_config(conf, dry_run)
    all_changes.extend(changes)
    for c in changes:
        print(c)

    print("\nUpdating explorer...")
    changes = update_explorer(conf, dry_run)
    all_changes.extend(changes)
    for c in changes:
        print(c)

    if not all_changes:
        print("\nNo changes needed - all files are up to date.")
    else:
        print(f"\nTotal changes: {len(all_changes)}")
        if dry_run:
            print("Run with --apply to apply these changes.")


if __name__ == "__main__":
    main()
