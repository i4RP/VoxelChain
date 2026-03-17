"""VoxelChain RPC Bridge HTTP Server.

Exposes an Ethereum JSON-RPC compatible HTTP endpoint plus
custom voxel_* methods for game world interaction.
"""

import asyncio
import json
import logging
import argparse
import time
from typing import Any, Optional

import aiohttp
from aiohttp import web

from .config import BridgeConfig
from .handlers import EthRPCHandlers
from .node_client import RPCError, VoxelChainNodeClient
from .virtual_blocks import VirtualBlockEngine
from .voxel_world import VoxelWorld

logger = logging.getLogger(__name__)

FAUCET_COOLDOWN = 3600
FAUCET_AMOUNT = 100.0


class VoxelChainBridgeServer:
    """HTTP server exposing Ethereum JSON-RPC + voxel game API."""

    def __init__(self, config: BridgeConfig):
        self.config = config
        self.node_client = VoxelChainNodeClient(config)
        self.vblock_engine = VirtualBlockEngine(
            self.node_client, data_dir=config.vblock_data_dir,
        )
        self.voxel_world = VoxelWorld(
            data_dir=config.vblock_data_dir + "/world",
            chunk_size=config.chunk_size,
        )
        self.handlers = EthRPCHandlers(
            config, self.node_client, self.vblock_engine, self.voxel_world,
        )
        self.app = web.Application()
        self._faucet_last_request: dict[str, float] = {}
        self._ws_clients: set = set()
        self._ws_last_block: int = 0
        self._setup_routes()

    def _setup_routes(self):
        self.app.router.add_post("/", self.handle_rpc)
        self.app.router.add_post("/rpc", self.handle_rpc)
        self.app.router.add_post("/faucet", self.handle_faucet)
        self.app.router.add_get("/ws", self.handle_websocket)
        self.app.router.add_get("/health", self.handle_health)
        self.app.router.add_get("/", self.handle_info)

    async def handle_faucet(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return web.json_response({"error": "Invalid JSON"}, status=400)

        address = body.get("address", "").strip()
        if not address or not address.startswith("0x") or len(address) != 42:
            return web.json_response({"error": "Invalid Ethereum address"}, status=400)

        client_ip = request.headers.get("X-Real-IP", request.remote or "unknown")
        now = time.time()
        last_req = self._faucet_last_request.get(client_ip, 0)
        if now - last_req < FAUCET_COOLDOWN:
            remaining = int(FAUCET_COOLDOWN - (now - last_req))
            return web.json_response(
                {"error": f"Rate limited. Try again in {remaining} seconds."},
                status=429,
            )

        try:
            from .converter import eth_to_native_address
            native_addr = eth_to_native_address(address, testnet=True)
            try:
                self.node_client.importaddress(native_addr, "faucet_" + address[:10].lower(), False)
            except RPCError:
                pass
            txid = self.node_client.call("sendtoaddress", [native_addr, FAUCET_AMOUNT])
            self._faucet_last_request[client_ip] = now
            try:
                self.node_client.call("generate", [1])
            except RPCError:
                pass

            return web.json_response({
                "success": True,
                "txHash": "0x" + txid,
                "amount": f"{FAUCET_AMOUNT} VXL",
                "address": address,
            })
        except RPCError as e:
            return web.json_response({"error": f"Transaction failed: {e.message}"}, status=500)
        except Exception:
            return web.json_response({"error": "Internal server error"}, status=500)

    async def handle_websocket(self, request: web.Request) -> web.WebSocketResponse:
        ws = web.WebSocketResponse(heartbeat=30)
        await ws.prepare(request)
        self._ws_clients.add(ws)

        try:
            vblock = self.vblock_engine.get_block_number()
            real_height = self.vblock_engine.get_real_block_height()
            await ws.send_json({
                "type": "init",
                "virtualBlock": vblock,
                "realBlock": real_height,
                "blockTime": "0.01s",
                "worldInfo": self.voxel_world.get_world_info(),
            })

            async for msg in ws:
                if msg.type == aiohttp.WSMsgType.TEXT:
                    data = json.loads(msg.data)
                    if data.get("type") == "ping":
                        await ws.send_json({"type": "pong"})
                    elif data.get("type") == "getChunk":
                        cx = data.get("cx", 0)
                        cy = data.get("cy", 0)
                        cz = data.get("cz", 0)
                        chunk_data = self.voxel_world.get_chunk_data(cx, cy, cz)
                        await ws.send_json({"type": "chunkData", **chunk_data})
                elif msg.type in (aiohttp.WSMsgType.ERROR, aiohttp.WSMsgType.CLOSE):
                    break
        except Exception as e:
            logger.debug("WebSocket error: %s", e)
        finally:
            self._ws_clients.discard(ws)

        return ws

    async def _ws_broadcast(self, data: dict):
        if not self._ws_clients:
            return
        dead = set()
        for ws in self._ws_clients:
            try:
                await ws.send_json(data)
            except Exception:
                dead.add(ws)
        self._ws_clients -= dead

    async def _ws_stream_loop(self):
        while True:
            try:
                if self._ws_clients:
                    vblock = self.vblock_engine.get_block_number()
                    if vblock != self._ws_last_block:
                        await self._ws_broadcast({
                            "type": "newBlock",
                            "virtualBlock": vblock,
                            "realBlock": self.vblock_engine.get_real_block_height(),
                            "timestamp": int(time.time()),
                        })
                        self._ws_last_block = vblock
            except Exception:
                pass
            await asyncio.sleep(1)

    async def handle_health(self, request: web.Request) -> web.Response:
        return web.json_response({
            "status": "ok",
            "service": "voxelchain-rpc-bridge",
            "worldInfo": self.voxel_world.get_world_info(),
        })

    async def handle_info(self, request: web.Request) -> web.Response:
        return web.json_response({
            "service": "VoxelChain RPC Bridge",
            "version": "0.1.0",
            "chainId": self.config.chain_id_hex,
            "network": self.config.network,
            "currency": "VXL",
            "supportedMethods": self.handlers.list_methods(),
            "voxelMethods": [m for m in self.handlers.list_methods() if m.startswith("voxel_")],
        })

    async def handle_rpc(self, request: web.Request) -> web.Response:
        try:
            body = await request.json()
        except json.JSONDecodeError:
            return web.json_response(
                _error_response(None, -32700, "Parse error"), status=200,
            )

        if isinstance(body, list):
            responses = []
            for req in body:
                resp = self._process_single_request(req)
                if resp is not None:
                    responses.append(resp)
            return web.json_response(responses)

        response = self._process_single_request(body)
        return web.json_response(response)

    def _process_single_request(self, request_data: dict) -> Optional[dict]:
        request_id = request_data.get("id")
        method = request_data.get("method", "")
        params = request_data.get("params", [])

        logger.info("RPC: %s", method)

        handler = self.handlers.get_handler(method)
        if handler is None:
            return _error_response(request_id, -32601, f"Method not found: {method}")

        try:
            result = handler(params)
            return _success_response(request_id, result)
        except RPCError as e:
            return _error_response(request_id, e.code, e.message)
        except Exception as e:
            logger.exception("Error handling %s: %s", method, e)
            return _error_response(request_id, -32603, f"Internal error: {str(e)}")

    def run(self):
        logger.info("Starting VoxelChain RPC Bridge on %s:%d",
                     self.config.bridge_host, self.config.bridge_port)
        self.vblock_engine.start()

        async def start_ws(app):
            app["ws_task"] = asyncio.ensure_future(self._ws_stream_loop())

        async def stop_ws(app):
            app["ws_task"].cancel()
            try:
                await app["ws_task"]
            except asyncio.CancelledError:
                pass

        self.app.on_startup.append(start_ws)
        self.app.on_cleanup.append(stop_ws)

        try:
            web.run_app(self.app, host=self.config.bridge_host,
                        port=self.config.bridge_port, print=logger.info)
        finally:
            self.vblock_engine.stop()


def _success_response(request_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error_response(request_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def main():
    parser = argparse.ArgumentParser(description="VoxelChain RPC Bridge Server")
    parser.add_argument("--rpc-host", default=None)
    parser.add_argument("--rpc-port", type=int, default=None)
    parser.add_argument("--rpc-user", default=None)
    parser.add_argument("--rpc-pass", default=None)
    parser.add_argument("--chain-id", type=int, default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--host", default=None)
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    )

    config = BridgeConfig()
    if args.rpc_host:
        config.rpc_host = args.rpc_host
    if args.rpc_port:
        config.rpc_port = args.rpc_port
    if args.rpc_user:
        config.rpc_user = args.rpc_user
    if args.rpc_pass:
        config.rpc_pass = args.rpc_pass
    if args.chain_id:
        config.chain_id = args.chain_id
        config.network_id = args.chain_id
    if args.port:
        config.bridge_port = args.port
    if args.host:
        config.bridge_host = args.host

    server = VoxelChainBridgeServer(config)
    server.run()


if __name__ == "__main__":
    main()
