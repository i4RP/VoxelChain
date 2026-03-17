"""Conversion utilities between Ethereum and VoxelChain data formats."""

import hashlib
import logging

logger = logging.getLogger(__name__)


def to_hex(value: int) -> str:
    """Convert integer to hex string with 0x prefix."""
    return hex(value)


def from_hex(hex_str: str) -> int:
    """Convert hex string to integer."""
    if hex_str.startswith("0x") or hex_str.startswith("0X"):
        return int(hex_str, 16)
    return int(hex_str, 16)


def pad_hex(hex_str: str, length: int = 64) -> str:
    """Pad a hex string to a specific length."""
    clean = hex_str.replace("0x", "").replace("0X", "")
    return clean.zfill(length)


def ensure_hex_prefix(value: str) -> str:
    """Ensure a hex string has 0x prefix."""
    if not value.startswith("0x"):
        return "0x" + value
    return value


def block_to_eth_block(block_data: dict, full_transactions: bool = False) -> dict:
    """Convert VoxelChain block data to Ethereum-compatible format."""
    height = block_data.get("height", 0)
    block_hash = block_data.get("hash", "0" * 64)
    prev_hash = block_data.get("previousblockhash", "0" * 64)
    merkle_root = block_data.get("merkleroot", "0" * 64)
    timestamp = block_data.get("time", 0)
    nonce = block_data.get("nonce", 0)
    difficulty = block_data.get("difficulty", 0)
    size = block_data.get("size", 0)
    tx_list = block_data.get("tx", [])

    if full_transactions:
        transactions = []
        for i, tx in enumerate(tx_list):
            if isinstance(tx, str):
                transactions.append(ensure_hex_prefix(tx))
            elif isinstance(tx, dict):
                transactions.append(
                    tx_to_eth_transaction(tx, block_hash, height, i)
                )
    else:
        transactions = [
            ensure_hex_prefix(tx if isinstance(tx, str) else tx.get("txid", ""))
            for tx in tx_list
        ]

    return {
        "number": to_hex(height),
        "hash": ensure_hex_prefix(block_hash),
        "parentHash": ensure_hex_prefix(prev_hash),
        "nonce": to_hex(nonce),
        "sha3Uncles": "0x1dcc4de8dec75d7aab85b567b6ccd41ad312451b948a7413f0a142fd40d49347",
        "logsBloom": "0x" + "00" * 256,
        "transactionsRoot": ensure_hex_prefix(merkle_root),
        "stateRoot": "0x" + "00" * 32,
        "receiptsRoot": "0x" + "00" * 32,
        "miner": "0x" + "00" * 20,
        "difficulty": to_hex(int(difficulty * 10**9)) if difficulty else "0x0",
        "totalDifficulty": to_hex(int(difficulty * 10**9)) if difficulty else "0x0",
        "extraData": "0x",
        "size": to_hex(size),
        "gasLimit": to_hex(30000000),
        "gasUsed": to_hex(size * 16),
        "timestamp": to_hex(timestamp),
        "transactions": transactions,
        "uncles": [],
        "baseFeePerGas": to_hex(1000000000),
        "mixHash": "0x" + "00" * 32,
    }


def tx_to_eth_transaction(tx_data: dict, block_hash: str = "",
                          block_number: int = 0, tx_index: int = 0) -> dict:
    """Convert VoxelChain transaction to Ethereum-compatible format."""
    txid = tx_data.get("txid", tx_data.get("hash", "0" * 64))
    size = tx_data.get("size", 0)

    total_value = sum(
        int(round(vout.get("value", 0) * 10**18))
        for vout in tx_data.get("vout", [])
    )

    from_addr = "0x" + "00" * 20
    to_addr = None
    vin = tx_data.get("vin", [])
    vout = tx_data.get("vout", [])

    if vin and vin[0].get("txid"):
        from_addr = txid_to_eth_address(vin[0]["txid"])

    if vout:
        for output in vout:
            script_pub_key = output.get("scriptPubKey", {})
            addresses = script_pub_key.get("addresses", [])
            if addresses:
                to_addr = address_to_eth(addresses[0])
                break

    return {
        "hash": ensure_hex_prefix(txid),
        "nonce": "0x0",
        "blockHash": ensure_hex_prefix(block_hash) if block_hash else None,
        "blockNumber": to_hex(block_number) if block_number else None,
        "transactionIndex": to_hex(tx_index),
        "from": from_addr,
        "to": to_addr,
        "value": to_hex(total_value),
        "gas": to_hex(size * 16 + 21000),
        "gasPrice": to_hex(1000000000),
        "input": "0x",
        "v": "0x1b",
        "r": "0x" + "00" * 32,
        "s": "0x" + "00" * 32,
        "type": "0x0",
    }


def tx_to_eth_receipt(tx_data: dict, block_hash: str = "",
                      block_number: int = 0, tx_index: int = 0) -> dict:
    """Convert transaction to Ethereum receipt format."""
    txid = tx_data.get("txid", tx_data.get("hash", "0" * 64))
    size = tx_data.get("size", 0)

    tx_eth = tx_to_eth_transaction(tx_data, block_hash, block_number, tx_index)

    return {
        "transactionHash": ensure_hex_prefix(txid),
        "transactionIndex": to_hex(tx_index),
        "blockHash": ensure_hex_prefix(block_hash) if block_hash else None,
        "blockNumber": to_hex(block_number) if block_number else None,
        "from": tx_eth["from"],
        "to": tx_eth["to"],
        "cumulativeGasUsed": to_hex(size * 16 + 21000),
        "gasUsed": to_hex(size * 16 + 21000),
        "contractAddress": None,
        "logs": [],
        "logsBloom": "0x" + "00" * 256,
        "status": "0x1",
        "effectiveGasPrice": to_hex(1000000000),
        "type": "0x0",
    }


def txid_to_eth_address(txid: str) -> str:
    """Derive a deterministic pseudo-Ethereum address from a TXID."""
    txid_bytes = bytes.fromhex(txid.replace("0x", ""))
    addr_hash = hashlib.sha256(txid_bytes).hexdigest()[:40]
    return "0x" + addr_hash


def address_to_eth(address: str) -> str:
    """Convert a native address to Ethereum format."""
    try:
        decoded = base58_decode(address)
        if decoded and len(decoded) >= 21:
            hash160 = decoded[1:21]
            return "0x" + hash160.hex()
    except Exception:
        pass
    addr_hash = hashlib.sha256(address.encode()).hexdigest()[:40]
    return "0x" + addr_hash


def eth_to_native_address(eth_address: str, testnet: bool = True) -> str:
    """Convert Ethereum address to native Base58Check address."""
    addr_hex = eth_address.replace("0x", "").replace("0X", "")
    addr_bytes = bytes.fromhex(addr_hex)
    version = bytes([0x6f]) if testnet else bytes([0x00])
    payload = version + addr_bytes
    checksum = hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]
    raw = payload + checksum
    return base58_encode(raw)


def base58_decode(s: str) -> bytes:
    """Decode a Base58Check encoded string."""
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = 0
    for c in s:
        n = n * 58 + alphabet.index(c)
    pad = 0
    for c in s:
        if c == '1':
            pad += 1
        else:
            break
    result = n.to_bytes((n.bit_length() + 7) // 8, 'big') if n > 0 else b''
    return b'\x00' * pad + result


def base58_encode(data: bytes) -> str:
    """Encode bytes to Base58Check string."""
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(data, 'big')
    result = ''
    while n > 0:
        n, r = divmod(n, 58)
        result = alphabet[r] + result
    for b in data:
        if b == 0:
            result = '1' + result
        else:
            break
    return result
