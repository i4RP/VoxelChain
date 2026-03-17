/**
 * Blockchain sync layer for VoxelChain.
 * Handles WebSocket connection, RPC calls, and TX submission.
 */

const RECONNECT_DELAY = 3000;

export class BlockchainSync {
  constructor(rpcUrl = "") {
    this.rpcUrl = rpcUrl || window.location.origin;
    this.wsUrl = `ws://${window.location.host}/ws`;
    this.ws = null;
    this.connected = false;
    this.virtualBlock = 0;
    this.realBlock = 0;
    this.walletAddress = null;
    this.chainId = "0xbf829"; // 784201 testnet

    this._requestId = 0;
    this._listeners = new Map();
    this._chunkCallbacks = new Map();
  }

  /** Connect WebSocket to bridge */
  connect() {
    try {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.onopen = () => {
        this.connected = true;
        this._emit("connected");
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this._handleMessage(data);
        } catch (e) {
          console.warn("WS parse error:", e);
        }
      };

      this.ws.onclose = () => {
        this.connected = false;
        this._emit("disconnected");
        setTimeout(() => this.connect(), RECONNECT_DELAY);
      };

      this.ws.onerror = () => {
        this.ws.close();
      };
    } catch (e) {
      setTimeout(() => this.connect(), RECONNECT_DELAY);
    }
  }

  _handleMessage(data) {
    switch (data.type) {
      case "init":
        this.virtualBlock = data.virtualBlock || 0;
        this.realBlock = data.realBlock || 0;
        this._emit("blockUpdate", { virtual: this.virtualBlock, real: this.realBlock });
        if (data.worldInfo) {
          this._emit("worldInfo", data.worldInfo);
        }
        break;

      case "newBlock":
        this.virtualBlock = data.virtualBlock || this.virtualBlock;
        this.realBlock = data.realBlock || this.realBlock;
        this._emit("blockUpdate", { virtual: this.virtualBlock, real: this.realBlock });
        break;

      case "chunkData":
        this._emit("chunkData", data);
        const key = `${data.chunk.x},${data.chunk.y},${data.chunk.z}`;
        const cb = this._chunkCallbacks.get(key);
        if (cb) {
          cb(data);
          this._chunkCallbacks.delete(key);
        }
        break;

      case "pong":
        break;

      default:
        this._emit("message", data);
    }
  }

  /** Request chunk data from server */
  requestChunk(cx, cy, cz) {
    return new Promise((resolve) => {
      const key = `${cx},${cy},${cz}`;
      this._chunkCallbacks.set(key, resolve);

      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ type: "getChunk", cx, cy, cz }));
      }

      // Timeout fallback
      setTimeout(() => {
        if (this._chunkCallbacks.has(key)) {
          this._chunkCallbacks.delete(key);
          resolve(null);
        }
      }, 5000);
    });
  }

  /** Make JSON-RPC call to bridge */
  async rpcCall(method, params = []) {
    this._requestId++;
    const response = await fetch(this.rpcUrl + "/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this._requestId,
        method,
        params,
      }),
    });
    const data = await response.json();
    if (data.error) {
      throw new Error(data.error.message);
    }
    return data.result;
  }

  /** Place a block on-chain */
  async placeBlock(x, y, z, blockType, player = "") {
    try {
      const result = await this.rpcCall("voxel_placeBlock", [x, y, z, blockType, player]);
      this._emit("blockPlaced", { x, y, z, blockType, result });
      return result;
    } catch (e) {
      this._emit("error", { action: "placeBlock", error: e.message });
      throw e;
    }
  }

  /** Break a block on-chain */
  async breakBlock(x, y, z, player = "") {
    try {
      const result = await this.rpcCall("voxel_breakBlock", [x, y, z, player]);
      this._emit("blockBroken", { x, y, z, result });
      return result;
    } catch (e) {
      this._emit("error", { action: "breakBlock", error: e.message });
      throw e;
    }
  }

  /** Get world info */
  async getWorldInfo() {
    return this.rpcCall("voxel_getWorldInfo");
  }

  /** Get block types */
  async getBlockTypes() {
    return this.rpcCall("voxel_getBlockTypes");
  }

  /** Connect MetaMask wallet */
  async connectWallet() {
    if (typeof window.ethereum === "undefined") {
      throw new Error("MetaMask not detected");
    }

    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });
    this.walletAddress = accounts[0];

    // Switch to VoxelChain network
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: this.chainId }],
      });
    } catch (switchErr) {
      if (switchErr.code === 4902) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: this.chainId,
              chainName: "VoxelChain Testnet",
              rpcUrls: [this.rpcUrl],
              nativeCurrency: {
                name: "VoxelCoin",
                symbol: "VXL",
                decimals: 18,
              },
            },
          ],
        });
      }
    }

    this._emit("walletConnected", { address: this.walletAddress });
    return this.walletAddress;
  }

  /** Request faucet tokens */
  async requestFaucet(address) {
    const response = await fetch(this.rpcUrl + "/faucet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    });
    return response.json();
  }

  /** Event system */
  on(event, callback) {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, []);
    }
    this._listeners.get(event).push(callback);
  }

  off(event, callback) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      const idx = listeners.indexOf(callback);
      if (idx >= 0) listeners.splice(idx, 1);
    }
  }

  _emit(event, data) {
    const listeners = this._listeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(data);
        } catch (e) {
          console.error(`Event listener error (${event}):`, e);
        }
      }
    }
  }
}
