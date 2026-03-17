"""VoxelChain RPC Bridge HTTP Server.

Exposes an Ethereum JSON-RPC compatible HTTP endpoint plus
custom voxel_* methods for game world interaction.
"""

import asyncio
import json
import logging
import argparse
import os
import time
from collections import defaultdict
from typing import Any, Optional

import aiohttp
from aiohttp import web

from .config import BridgeConfig
from .handlers import EthRPCHandlers
from .node_client import RPCError, VoxelChainNodeClient
from .persistence import PersistenceLayer
from .virtual_blocks import VirtualBlockEngine
from .voxel_world import VoxelWorld

logger = logging.getLogger(__name__)

FAUCET_COOLDOWN = 3600
FAUCET_AMOUNT = 100.0

# Rate limiting: max requests per minute per IP
RATE_LIMIT_RPC = 120
RATE_LIMIT_WS_MSG = 60
RATE_LIMIT_WINDOW = 60  # seconds


class VoxelChainBridgeServer:
    """HTTP server exposing Ethereum JSON-RPC + voxel game API."""

    def __init__(self, config: BridgeConfig):
        self.config = config
        self.node_client = VoxelChainNodeClient(config)
        self.vblock_engine = VirtualBlockEngine(
            self.node_client, data_dir=config.vblock_data_dir,
        )
        self.persistence = PersistenceLayer(
            db_path=config.vblock_data_dir + "/voxelchain.db",
        )
        self.voxel_world = VoxelWorld(
            data_dir=config.vblock_data_dir + "/world",
            chunk_size=config.chunk_size,
            persistence=self.persistence,
        )
        self.handlers = EthRPCHandlers(
            config, self.node_client, self.vblock_engine, self.voxel_world,
            persistence=self.persistence,
        )
        self.app = web.Application()
        self._faucet_last_request: dict[str, float] = {}
        self._ws_clients: set = set()
        self._ws_last_block: int = 0
        self._rate_limits: dict[str, list] = defaultdict(list)
        self._setup_routes()

    def _setup_routes(self):
        self.app.router.add_post("/rpc", self.handle_rpc)
        self.app.router.add_post("/faucet", self.handle_faucet)
        self.app.router.add_get("/ws", self.handle_websocket)
        self.app.router.add_get("/health", self.handle_health)
        self.app.router.add_get("/api/info", self.handle_info)
        self.app.router.add_post("/", self.handle_rpc)

        # Serve explorer static files
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(__file__)))
        explorer_dir = os.path.join(project_root, "explorer")
        if os.path.isdir(explorer_dir):
            self.app.router.add_get("/explorer", self._serve_explorer)
            self.app.router.add_get("/explorer/{path:.*}", self._serve_explorer_static)
            self._explorer_dir = explorer_dir
            logger.info("Serving explorer from %s", explorer_dir)
        else:
            self._explorer_dir = None
            logger.warning("Explorer directory not found: %s", explorer_dir)

        # Serve landing page
        landing_dir = os.path.join(project_root, "landing")
        if os.path.isdir(landing_dir):
            self.app.router.add_get("/landing", self._serve_landing)
            self.app.router.add_get("/landing/{path:.*}", self._serve_landing_static)
            self._landing_dir = landing_dir
            logger.info("Serving landing page from %s", landing_dir)
        else:
            self._landing_dir = None

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
                    msg_type = data.get("type", "")
                    if msg_type == "ping":
                        await ws.send_json({"type": "pong"})
                    elif msg_type == "getChunk":
                        cx = data.get("cx", 0)
                        cy = data.get("cy", 0)
                        cz = data.get("cz", 0)
                        chunk_data = self.voxel_world.get_chunk_data(cx, cy, cz)
                        await ws.send_json({"type": "chunkData", **chunk_data})
                    elif msg_type == "getChunkBatch":
                        # Batch chunk request for efficient streaming
                        chunks = data.get("chunks", [])
                        for c in chunks[:16]:  # Max 16 chunks per batch
                            cx, cy, cz = c.get("x", 0), c.get("y", 0), c.get("z", 0)
                            chunk_data = self.voxel_world.get_chunk_data(cx, cy, cz)
                            await ws.send_json({"type": "chunkData", **chunk_data})
                    elif msg_type == "placeBlock":
                        # Direct block placement via WebSocket
                        try:
                            x, y, z = data.get("x", 0), data.get("y", 0), data.get("z", 0)
                            block_type = data.get("blockType", 1)
                            player = data.get("player", "")
                            old_block = self.voxel_world.get_block(x, y, z)
                            change = self.voxel_world.place_block(x, y, z, block_type, player)
                            await ws.send_json({"type": "blockPlaced", **change})
                            # Broadcast to all clients
                            await self._ws_broadcast({"type": "worldChange", **change})
                            # Log and award rewards
                            if self.persistence:
                                self.persistence.log_block_change(
                                    x, y, z, old_block.block_type, block_type, player
                                )
                            if player:
                                self.handlers.economy.process_block_place(block_type, player)
                        except ValueError as e:
                            await ws.send_json({"type": "error", "message": str(e)})
                    elif msg_type == "breakBlock":
                        try:
                            x, y, z = data.get("x", 0), data.get("y", 0), data.get("z", 0)
                            player = data.get("player", "")
                            old_block = self.voxel_world.get_block(x, y, z)
                            change = self.voxel_world.break_block(x, y, z, player)
                            await ws.send_json({"type": "blockBroken", **change})
                            await self._ws_broadcast({"type": "worldChange", **change})
                            # Log and award rewards
                            if self.persistence:
                                self.persistence.log_block_change(
                                    x, y, z, old_block.block_type, 0, player
                                )
                            if player:
                                self.handlers.economy.process_block_break(
                                    old_block.block_type, player
                                )
                        except ValueError as e:
                            await ws.send_json({"type": "error", "message": str(e)})
                    elif msg_type == "subscribe":
                        # Subscribe to chunk updates in a region
                        region = data.get("region", {})
                        cx, cy, cz = region.get("cx", 0), region.get("cy", 0), region.get("cz", 0)
                        radius = region.get("radius", 2)
                        player_addr = data.get("player", "")
                        if player_addr:
                            for dx in range(-radius, radius + 1):
                                for dz in range(-radius, radius + 1):
                                    self.handlers.multiplayer.subscribe_chunk(
                                        player_addr, cx + dx, cy, cz + dz
                                    )
                            await ws.send_json({"type": "subscribed", "region": region})
                    elif msg_type == "playerJoin":
                        address = data.get("address", "")
                        name = data.get("displayName", "")
                        pos = data.get("position")
                        result = self.handlers.multiplayer.player_join(address, name, pos)
                        await ws.send_json({"type": "joinResult", **result})
                        if result.get("success"):
                            await self._ws_broadcast({
                                "type": "playerJoined",
                                "player": result.get("session", {}),
                            })
                    elif msg_type == "playerLeave":
                        address = data.get("address", "")
                        result = self.handlers.multiplayer.player_leave(address)
                        await self._ws_broadcast({
                            "type": "playerLeft",
                            "address": address,
                        })
                    elif msg_type == "updatePosition":
                        address = data.get("address", "")
                        position = data.get("position", {})
                        look = data.get("lookDirection")
                        self.handlers.multiplayer.update_position(address, position, look)
                        await self._ws_broadcast({
                            "type": "playerMoved",
                            "address": address,
                            "position": position,
                        })
                    elif msg_type == "chat":
                        sender = data.get("sender", "")
                        message = data.get("message", "")
                        result = self.handlers.multiplayer.broadcast_chat(sender, message)
                        await self._ws_broadcast(result)
                    elif msg_type == "craft":
                        player_addr = data.get("player", "")
                        recipe_id = data.get("recipeId", "")
                        try:
                            result = self.handlers.game_craft([player_addr, recipe_id])
                            await ws.send_json({"type": "craftResult", **result})
                        except RPCError as e:
                            await ws.send_json({"type": "error", "message": e.message})
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
            "version": "0.2.0",
            "chainId": self.config.chain_id_hex,
            "network": self.config.network,
            "currency": "VXL",
            "supportedMethods": self.handlers.list_methods(),
            "voxelMethods": [m for m in self.handlers.list_methods() if m.startswith("voxel_")],
            "gameMethods": [m for m in self.handlers.list_methods() if m.startswith("game_")],
            "wsEndpoint": "/ws",
            "connectedClients": len(self._ws_clients),
        })

    async def _serve_explorer(self, request: web.Request) -> web.Response:
        """Serve explorer index.html."""
        if not self._explorer_dir:
            return web.Response(text="Explorer not available", status=404)
        index_path = os.path.join(self._explorer_dir, "index.html")
        if os.path.exists(index_path):
            return web.FileResponse(index_path)
        return web.Response(text="Explorer not found", status=404)

    async def _serve_explorer_static(self, request: web.Request) -> web.Response:
        """Serve explorer static assets."""
        if not self._explorer_dir:
            return web.Response(text="Explorer not available", status=404)
        rel_path = request.match_info.get("path", "")
        file_path = os.path.join(self._explorer_dir, rel_path)
        # Prevent directory traversal
        real_path = os.path.realpath(file_path)
        real_dir = os.path.realpath(self._explorer_dir)
        if not real_path.startswith(real_dir):
            return web.Response(text="Forbidden", status=403)
        if os.path.isfile(file_path):
            return web.FileResponse(file_path)
        return web.Response(text="Not found", status=404)

    async def _serve_landing(self, request: web.Request) -> web.Response:
        """Serve landing page index.html."""
        if not self._landing_dir:
            return web.Response(text="Landing page not available", status=404)
        index_path = os.path.join(self._landing_dir, "index.html")
        if os.path.exists(index_path):
            return web.FileResponse(index_path)
        return web.Response(text="Landing page not found", status=404)

    async def _serve_landing_static(self, request: web.Request) -> web.Response:
        """Serve landing page static assets."""
        if not self._landing_dir:
            return web.Response(text="Landing page not available", status=404)
        rel_path = request.match_info.get("path", "")
        file_path = os.path.join(self._landing_dir, rel_path)
        real_path = os.path.realpath(file_path)
        real_dir = os.path.realpath(self._landing_dir)
        if not real_path.startswith(real_dir):
            return web.Response(text="Forbidden", status=403)
        if os.path.isfile(file_path):
            return web.FileResponse(file_path)
        return web.Response(text="Not found", status=404)

    def _check_rate_limit(self, client_ip: str, limit: int = RATE_LIMIT_RPC) -> bool:
        """Check if client IP has exceeded rate limit. Returns True if allowed."""
        now = time.time()
        timestamps = self._rate_limits[client_ip]
        # Remove old timestamps outside the window
        cutoff = now - RATE_LIMIT_WINDOW
        self._rate_limits[client_ip] = [t for t in timestamps if t > cutoff]
        if len(self._rate_limits[client_ip]) >= limit:
            return False
        self._rate_limits[client_ip].append(now)
        return True

    async def handle_rpc(self, request: web.Request) -> web.Response:
        client_ip = request.headers.get("X-Real-IP", request.remote or "unknown")
        if not self._check_rate_limit(client_ip, RATE_LIMIT_RPC):
            return web.json_response(
                _error_response(None, -32000, "Rate limit exceeded"), status=429,
            )

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
