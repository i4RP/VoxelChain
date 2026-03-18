"""VoxelChain RPC Bridge - FastAPI Server.

FastAPI wrapper around the existing VoxelChain bridge logic for deployment.
"""

import asyncio
import json
import logging
import os
import sys
import time
from collections import defaultdict
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response, HTMLResponse
from fastapi.staticfiles import StaticFiles

# Add parent directory to path so we can import voxelchain_bridge
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from voxelchain_bridge.config import BridgeConfig
from voxelchain_bridge.handlers import EthRPCHandlers
from voxelchain_bridge.node_client import RPCError, VoxelChainNodeClient
from voxelchain_bridge.persistence import PersistenceLayer
from voxelchain_bridge.virtual_blocks import VirtualBlockEngine
from voxelchain_bridge.voxel_world import VoxelWorld

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger(__name__)

# --- Global state ---
config = BridgeConfig()

# Use /data for persistent volume on Fly.io, fallback to /tmp
data_dir = os.environ.get("VOXELCHAIN_DATA_DIR", config.vblock_data_dir)
if os.path.isdir("/data"):
    data_dir = "/data"
config.vblock_data_dir = data_dir
os.makedirs(data_dir, exist_ok=True)
os.makedirs(data_dir + "/world", exist_ok=True)

node_client = VoxelChainNodeClient(config)
vblock_engine = VirtualBlockEngine(node_client, data_dir=data_dir)
persistence = PersistenceLayer(db_path=data_dir + "/voxelchain.db")
voxel_world = VoxelWorld(
    data_dir=data_dir + "/world",
    chunk_size=config.chunk_size,
    persistence=persistence,
)
handlers = EthRPCHandlers(
    config, node_client, vblock_engine, voxel_world,
    persistence=persistence,
)

# Rate limiting
FAUCET_COOLDOWN = 3600
FAUCET_AMOUNT = 100.0
RATE_LIMIT_RPC = 120
RATE_LIMIT_WINDOW = 60
_faucet_last_request: dict[str, float] = {}
_ws_clients: set[WebSocket] = set()
_ws_last_block: int = 0
_rate_limits: dict[str, list] = defaultdict(list)


def _check_rate_limit(client_ip: str, limit: int = RATE_LIMIT_RPC) -> bool:
    now = time.time()
    timestamps = _rate_limits[client_ip]
    cutoff = now - RATE_LIMIT_WINDOW
    _rate_limits[client_ip] = [t for t in timestamps if t > cutoff]
    if len(_rate_limits[client_ip]) >= limit:
        return False
    _rate_limits[client_ip].append(now)
    return True


def _success_response(request_id: Any, result: Any) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def _error_response(request_id: Any, code: int, message: str) -> dict:
    return {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}


def _process_single_request(request_data: dict) -> Optional[dict]:
    request_id = request_data.get("id")
    method = request_data.get("method", "")
    params = request_data.get("params", [])
    logger.info("RPC: %s", method)
    handler = handlers.get_handler(method)
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


async def ws_broadcast(data: dict):
    global _ws_clients
    if not _ws_clients:
        return
    dead = set()
    for ws in _ws_clients:
        try:
            await ws.send_json(data)
        except Exception:
            dead.add(ws)
    _ws_clients -= dead


async def ws_stream_loop():
    global _ws_last_block
    while True:
        try:
            if _ws_clients:
                vblock = vblock_engine.get_block_number()
                if vblock != _ws_last_block:
                    await ws_broadcast({
                        "type": "newBlock",
                        "virtualBlock": vblock,
                        "realBlock": vblock_engine.get_real_block_height(),
                        "timestamp": int(time.time()),
                    })
                    _ws_last_block = vblock
        except Exception:
            pass
        await asyncio.sleep(1)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown events."""
    vblock_engine.start()
    task = asyncio.create_task(ws_stream_loop())
    logger.info("VoxelChain RPC Bridge started (FastAPI)")
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    vblock_engine.stop()


app = FastAPI(
    title="VoxelChain RPC Bridge",
    version="0.2.0",
    lifespan=lifespan,
)

# CORS - allow all origins for game client access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- HTTP Routes ---

@app.post("/rpc")
@app.post("/")
async def handle_rpc(request: Request):
    client_ip = request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")
    if not _check_rate_limit(client_ip, RATE_LIMIT_RPC):
        return JSONResponse(_error_response(None, -32000, "Rate limit exceeded"), status_code=429)
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse(_error_response(None, -32700, "Parse error"))

    if isinstance(body, list):
        responses = []
        for req in body:
            resp = _process_single_request(req)
            if resp is not None:
                responses.append(resp)
        return JSONResponse(responses)

    response = _process_single_request(body)
    return JSONResponse(response)


@app.post("/faucet")
async def handle_faucet(request: Request):
    try:
        body = await request.json()
    except json.JSONDecodeError:
        return JSONResponse({"error": "Invalid JSON"}, status_code=400)

    address = body.get("address", "").strip()
    if not address or not address.startswith("0x") or len(address) != 42:
        return JSONResponse({"error": "Invalid Ethereum address"}, status_code=400)

    client_ip = request.headers.get("X-Real-IP", request.client.host if request.client else "unknown")
    now = time.time()
    last_req = _faucet_last_request.get(client_ip, 0)
    if now - last_req < FAUCET_COOLDOWN:
        remaining = int(FAUCET_COOLDOWN - (now - last_req))
        return JSONResponse(
            {"error": f"Rate limited. Try again in {remaining} seconds."},
            status_code=429,
        )

    try:
        from voxelchain_bridge.converter import eth_to_native_address
        native_addr = eth_to_native_address(address, testnet=True)
        try:
            node_client.importaddress(native_addr, "faucet_" + address[:10].lower(), False)
        except RPCError:
            pass
        txid = node_client.call("sendtoaddress", [native_addr, FAUCET_AMOUNT])
        _faucet_last_request[client_ip] = now
        try:
            node_client.call("generate", [1])
        except RPCError:
            pass

        return JSONResponse({
            "success": True,
            "txHash": "0x" + txid,
            "amount": f"{FAUCET_AMOUNT} VXL",
            "address": address,
        })
    except RPCError as e:
        return JSONResponse({"error": f"Transaction failed: {e.message}"}, status_code=500)
    except Exception:
        return JSONResponse({"error": "Internal server error"}, status_code=500)


@app.get("/health")
async def handle_health():
    return JSONResponse({
        "status": "ok",
        "service": "voxelchain-rpc-bridge",
        "worldInfo": voxel_world.get_world_info(),
    })


@app.get("/api/info")
async def handle_info():
    return JSONResponse({
        "service": "VoxelChain RPC Bridge",
        "version": "0.2.0",
        "chainId": config.chain_id_hex,
        "network": config.network,
        "currency": "VXL",
        "supportedMethods": handlers.list_methods(),
        "voxelMethods": [m for m in handlers.list_methods() if m.startswith("voxel_")],
        "gameMethods": [m for m in handlers.list_methods() if m.startswith("game_")],
        "wsEndpoint": "/ws",
        "connectedClients": len(_ws_clients),
    })


# --- WebSocket ---

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    _ws_clients.add(websocket)

    try:
        # Send init message
        vblock = vblock_engine.get_block_number()
        real_height = vblock_engine.get_real_block_height()
        await websocket.send_json({
            "type": "init",
            "virtualBlock": vblock,
            "realBlock": real_height,
            "blockTime": "0.01s",
            "worldInfo": voxel_world.get_world_info(),
        })

        while True:
            raw = await websocket.receive_text()
            data = json.loads(raw)
            msg_type = data.get("type", "")

            if msg_type == "ping":
                await websocket.send_json({"type": "pong"})

            elif msg_type == "getChunk":
                cx = data.get("cx", 0)
                cy = data.get("cy", 0)
                cz = data.get("cz", 0)
                chunk_data = voxel_world.get_chunk_data(cx, cy, cz)
                await websocket.send_json({"type": "chunkData", **chunk_data})

            elif msg_type == "getChunkBatch":
                chunks = data.get("chunks", [])
                for c in chunks[:16]:
                    cx, cy, cz = c.get("x", 0), c.get("y", 0), c.get("z", 0)
                    chunk_data = voxel_world.get_chunk_data(cx, cy, cz)
                    await websocket.send_json({"type": "chunkData", **chunk_data})

            elif msg_type == "placeBlock":
                try:
                    x, y, z = data.get("x", 0), data.get("y", 0), data.get("z", 0)
                    block_type = data.get("blockType", 1)
                    player = data.get("player", "")
                    old_block = voxel_world.get_block(x, y, z)
                    change = voxel_world.place_block(x, y, z, block_type, player)
                    await websocket.send_json({"type": "blockPlaced", **change})
                    await ws_broadcast({"type": "worldChange", **change})
                    if persistence:
                        persistence.log_block_change(x, y, z, old_block.block_type, block_type, player)
                    if player:
                        handlers.economy.process_block_place(block_type, player)
                except ValueError as e:
                    await websocket.send_json({"type": "error", "message": str(e)})

            elif msg_type == "breakBlock":
                try:
                    x, y, z = data.get("x", 0), data.get("y", 0), data.get("z", 0)
                    player = data.get("player", "")
                    old_block = voxel_world.get_block(x, y, z)
                    change = voxel_world.break_block(x, y, z, player)
                    await websocket.send_json({"type": "blockBroken", **change})
                    await ws_broadcast({"type": "worldChange", **change})
                    if persistence:
                        persistence.log_block_change(x, y, z, old_block.block_type, 0, player)
                    if player:
                        handlers.economy.process_block_break(old_block.block_type, player)
                except ValueError as e:
                    await websocket.send_json({"type": "error", "message": str(e)})

            elif msg_type == "subscribe":
                region = data.get("region", {})
                cx, cy, cz = region.get("cx", 0), region.get("cy", 0), region.get("cz", 0)
                radius = region.get("radius", 2)
                player_addr = data.get("player", "")
                if player_addr:
                    for dx in range(-radius, radius + 1):
                        for dz in range(-radius, radius + 1):
                            handlers.multiplayer.subscribe_chunk(player_addr, cx + dx, cy, cz + dz)
                    await websocket.send_json({"type": "subscribed", "region": region})

            elif msg_type == "playerJoin":
                address = data.get("address", "")
                name = data.get("displayName", "")
                pos = data.get("position")
                result = handlers.multiplayer.player_join(address, name, pos)
                await websocket.send_json({"type": "joinResult", **result})
                if result.get("success"):
                    await ws_broadcast({"type": "playerJoined", "player": result.get("session", {})})

            elif msg_type == "playerLeave":
                address = data.get("address", "")
                handlers.multiplayer.player_leave(address)
                await ws_broadcast({"type": "playerLeft", "address": address})

            elif msg_type == "updatePosition":
                address = data.get("address", "")
                position = data.get("position", {})
                look = data.get("lookDirection")
                handlers.multiplayer.update_position(address, position, look)
                await ws_broadcast({"type": "playerMoved", "address": address, "position": position})

            elif msg_type == "chat":
                sender = data.get("sender", "")
                message = data.get("message", "")
                result = handlers.multiplayer.broadcast_chat(sender, message)
                await ws_broadcast(result)

            elif msg_type == "craft":
                player_addr = data.get("player", "")
                recipe_id = data.get("recipeId", "")
                try:
                    result = handlers.game_craft([player_addr, recipe_id])
                    await websocket.send_json({"type": "craftResult", **result})
                except RPCError as e:
                    await websocket.send_json({"type": "error", "message": e.message})

    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.debug("WebSocket error: %s", e)
    finally:
        _ws_clients.discard(websocket)


# --- Static file serving for client frontend ---
# Serve the built client from ../client/dist or /app/client_dist
_project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_client_dist = os.path.join(_project_root, "client", "dist")
if not os.path.isdir(_client_dist):
    _client_dist = os.path.join(_project_root, "client_dist")

if os.path.isdir(_client_dist):
    # Serve index.html for the root path
    @app.get("/game")
    @app.get("/game/{rest:path}")
    async def serve_game_index():
        index_path = os.path.join(_client_dist, "index.html")
        if os.path.exists(index_path):
            return FileResponse(index_path, media_type="text/html")
        return Response("Game client not found", status_code=404)

    # Mount static assets
    app.mount("/assets", StaticFiles(directory=os.path.join(_client_dist, "assets")), name="client-assets")

    # Serve index.html as the root fallback
    @app.get("/", response_class=HTMLResponse)
    async def serve_root():
        index_path = os.path.join(_client_dist, "index.html")
        if os.path.exists(index_path):
            with open(index_path) as f:
                return HTMLResponse(f.read())
        return HTMLResponse("<h1>VoxelChain RPC Bridge</h1><p>API is running. Client not built.</p>")

    logger.info("Serving client from %s", _client_dist)
else:
    @app.get("/", response_class=HTMLResponse)
    async def serve_root_no_client():
        return HTMLResponse("<h1>VoxelChain RPC Bridge</h1><p>API is running. Client not available.</p>")
