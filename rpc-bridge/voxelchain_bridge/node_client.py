"""VoxelChain Node RPC Client."""

import json
import logging
from typing import Any, List, Optional

import requests

logger = logging.getLogger(__name__)


class RPCError(Exception):
    """JSON-RPC error from the node."""

    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"RPC Error {code}: {message}")


class VoxelChainNodeClient:
    """Client for communicating with the VoxelChain node via JSON-RPC."""

    def __init__(self, config):
        self.config = config
        self._session = requests.Session()
        if config.rpc_user and config.rpc_pass:
            self._session.auth = (config.rpc_user, config.rpc_pass)
        self._request_id = 0

    def call(self, method: str, params: Any = None) -> Any:
        """Make a JSON-RPC call to the node."""
        self._request_id += 1
        payload = {
            "jsonrpc": "1.0",
            "id": self._request_id,
            "method": method,
            "params": params or [],
        }

        try:
            response = self._session.post(
                self.config.rpc_url,
                json=payload,
                timeout=30,
            )
            data = response.json()
        except requests.exceptions.ConnectionError:
            raise RPCError(-32000, "Cannot connect to VoxelChain node")
        except requests.exceptions.Timeout:
            raise RPCError(-32000, "Node RPC timeout")
        except json.JSONDecodeError:
            raise RPCError(-32700, "Invalid JSON response from node")

        if data.get("error"):
            err = data["error"]
            raise RPCError(err.get("code", -32000), err.get("message", "Unknown error"))

        return data.get("result")

    def getblockcount(self) -> int:
        return self.call("getblockcount")

    def getblockhash(self, height: int) -> str:
        return self.call("getblockhash", [height])

    def getblock(self, block_hash: str, verbosity: int = 1) -> dict:
        return self.call("getblock", [block_hash, verbosity])

    def getrawtransaction(self, txid: str, verbose: bool = True) -> dict:
        return self.call("getrawtransaction", [txid, verbose])

    def sendtoaddress(self, address: str, amount: float) -> str:
        return self.call("sendtoaddress", [address, amount])

    def listunspent(self, minconf: int = 0, maxconf: int = 9999999,
                    addresses: Optional[List[str]] = None) -> list:
        params: list = [minconf, maxconf]
        if addresses:
            params.append(addresses)
        return self.call("listunspent", params)

    def importaddress(self, address: str, label: str = "", rescan: bool = False):
        return self.call("importaddress", [address, label, rescan])
