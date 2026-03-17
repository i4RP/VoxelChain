"""Ethereum Transaction Decoder for VoxelChain.

Decodes RLP-encoded Ethereum transactions from MetaMask
to extract transfer details for the VoxelChain bridge.
"""

import logging
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DecodedTransaction:
    """Decoded Ethereum transaction."""
    tx_type: int = 0
    nonce: int = 0
    gas_price: int = 0
    max_fee_per_gas: int = 0
    max_priority_fee: int = 0
    gas_limit: int = 21000
    to_address: str = ""
    value: int = 0
    data: bytes = b""
    chain_id: int = 0
    v: int = 0
    r: bytes = b""
    s: bytes = b""

    @property
    def value_in_eth(self) -> str:
        """Value in VXL (18 decimals)."""
        whole = self.value // 10**18
        frac = self.value % 10**18
        if frac == 0:
            return str(whole)
        return f"{whole}.{frac:018d}".rstrip("0")


def _decode_rlp_length(data: bytes, offset: int) -> tuple:
    """Decode RLP length prefix. Returns (decoded_data, new_offset)."""
    if offset >= len(data):
        return b"", offset

    first = data[offset]

    if first < 0x80:
        return bytes([first]), offset + 1
    elif first <= 0xB7:
        length = first - 0x80
        start = offset + 1
        return data[start:start + length], start + length
    elif first <= 0xBF:
        len_of_len = first - 0xB7
        length = int.from_bytes(data[offset + 1:offset + 1 + len_of_len], "big")
        start = offset + 1 + len_of_len
        return data[start:start + length], start + length
    elif first <= 0xF7:
        length = first - 0xC0
        return data[offset + 1:offset + 1 + length], offset + 1 + length
    else:
        len_of_len = first - 0xF7
        length = int.from_bytes(data[offset + 1:offset + 1 + len_of_len], "big")
        start = offset + 1 + len_of_len
        return data[start:start + length], start + length


def _decode_rlp_list(data: bytes) -> list:
    """Decode an RLP-encoded list into its elements."""
    items = []
    offset = 0
    while offset < len(data):
        item, offset = _decode_rlp_length(data, offset)
        items.append(item)
    return items


def _bytes_to_int(b: bytes) -> int:
    """Convert bytes to integer."""
    if not b:
        return 0
    return int.from_bytes(b, "big")


def decode_raw_transaction(raw_hex: str) -> DecodedTransaction:
    """Decode a raw Ethereum transaction hex string."""
    raw = raw_hex.replace("0x", "")
    data = bytes.fromhex(raw)

    tx = DecodedTransaction()

    if data[0] == 0x02:
        # EIP-1559 (Type 2)
        tx.tx_type = 2
        items = _decode_rlp_list(data[1:])
        if len(items) < 9:
            # Need to re-decode the outer list
            outer, _ = _decode_rlp_length(data, 1)
            items = _decode_rlp_list(outer)

        if len(items) >= 9:
            tx.chain_id = _bytes_to_int(items[0])
            tx.nonce = _bytes_to_int(items[1])
            tx.max_priority_fee = _bytes_to_int(items[2])
            tx.max_fee_per_gas = _bytes_to_int(items[3])
            tx.gas_limit = _bytes_to_int(items[4])
            tx.to_address = "0x" + items[5].hex() if items[5] else ""
            tx.value = _bytes_to_int(items[6])
            tx.data = items[7]
            if len(items) > 9:
                tx.v = _bytes_to_int(items[9])
                tx.r = items[10] if len(items) > 10 else b""
                tx.s = items[11] if len(items) > 11 else b""
    elif data[0] == 0x01:
        # EIP-2930 (Type 1)
        tx.tx_type = 1
        outer, _ = _decode_rlp_length(data, 1)
        items = _decode_rlp_list(outer)
        if len(items) >= 8:
            tx.chain_id = _bytes_to_int(items[0])
            tx.nonce = _bytes_to_int(items[1])
            tx.gas_price = _bytes_to_int(items[2])
            tx.gas_limit = _bytes_to_int(items[3])
            tx.to_address = "0x" + items[4].hex() if items[4] else ""
            tx.value = _bytes_to_int(items[5])
            tx.data = items[6]
    else:
        # Legacy transaction (Type 0)
        tx.tx_type = 0
        outer, _ = _decode_rlp_length(data, 0)
        items = _decode_rlp_list(outer)
        if len(items) >= 6:
            tx.nonce = _bytes_to_int(items[0])
            tx.gas_price = _bytes_to_int(items[1])
            tx.gas_limit = _bytes_to_int(items[2])
            tx.to_address = "0x" + items[3].hex() if items[3] else ""
            tx.value = _bytes_to_int(items[4])
            tx.data = items[5]
            if len(items) > 6:
                tx.v = _bytes_to_int(items[6])
                tx.r = items[7] if len(items) > 7 else b""
                tx.s = items[8] if len(items) > 8 else b""
            # Derive chain_id from v
            if tx.v >= 35:
                tx.chain_id = (tx.v - 35) // 2

    logger.debug(
        "Decoded TX: type=%d nonce=%d to=%s value=%s chain=%d",
        tx.tx_type, tx.nonce, tx.to_address, tx.value_in_eth, tx.chain_id,
    )
    return tx
