/**
 * AICommandServer - WebSocket command protocol for external AI agents.
 * Opens a WebSocket server (via the game client) that accepts JSON commands
 * and returns structured responses, enabling external processes to control the game.
 *
 * Protocol:
 *   AI Agent → Game Client:
 *     { "id": 1, "cmd": "moveTo", "args": { "x": 10, "y": 30, "z": 15 } }
 *   Game Client → AI Agent:
 *     { "id": 1, "result": { "success": true, "arrived": true }, "type": "response" }
 *   Game Client → AI Agent (events):
 *     { "type": "event", "event": "snapshot", "data": { ... } }
 */

export class AICommandServer {
  constructor(game, api, observer) {
    this._game = game;
    this._api = api;
    this._observer = observer;
    this._ws = null;
    this._connections = new Set();
    this._port = 8787;
    this._running = false;

    // Map of command handlers
    this._handlers = this._buildHandlers();
  }

  /**
   * Start listening for AI agent connections.
   * In browser environment, we create a BroadcastChannel-based local protocol
   * and also accept commands via window.postMessage for cross-tab communication.
   */
  start() {
    if (this._running) return;
    this._running = true;

    // BroadcastChannel for same-origin tab communication
    try {
      this._channel = new BroadcastChannel("voxelchain-ai");
      this._channel.onmessage = (event) => {
        this._handleIncoming(event.data, (response) => {
          this._channel.postMessage(response);
        });
      };
    } catch (e) {
      console.warn("[AICommandServer] BroadcastChannel not available:", e.message);
    }

    // window.postMessage for cross-origin iframe/popup communication
    window.addEventListener("message", this._onWindowMessage);

    // Console API - direct function for Playwright/Puppeteer
    window.__voxelChainCommand = (cmdJson) => {
      return new Promise((resolve) => {
        const cmd = typeof cmdJson === "string" ? JSON.parse(cmdJson) : cmdJson;
        this._handleIncoming(cmd, resolve);
      });
    };

    // Observer auto-snapshot → broadcast events
    this._observer.onSnapshot((snapshot) => {
      this._broadcast({ type: "event", event: "snapshot", data: snapshot });
    });

    console.log("[AICommandServer] Started. Use window.__voxelChainCommand(cmd) or BroadcastChannel 'voxelchain-ai'");
  }

  stop() {
    this._running = false;
    if (this._channel) {
      this._channel.close();
      this._channel = null;
    }
    window.removeEventListener("message", this._onWindowMessage);
    delete window.__voxelChainCommand;
    this._observer.stopAutoSnapshot();
    console.log("[AICommandServer] Stopped");
  }

  _onWindowMessage = (event) => {
    if (event.data && event.data.__voxelchain) {
      this._handleIncoming(event.data, (response) => {
        event.source.postMessage({ __voxelchain: true, ...response }, event.origin);
      });
    }
  };

  async _handleIncoming(msg, respond) {
    if (!msg || !msg.cmd) {
      respond({ type: "error", error: "Missing 'cmd' field", id: msg?.id });
      return;
    }

    const handler = this._handlers[msg.cmd];
    if (!handler) {
      respond({
        type: "error",
        error: `Unknown command: ${msg.cmd}`,
        id: msg.id,
        availableCommands: Object.keys(this._handlers),
      });
      return;
    }

    try {
      const result = await handler(msg.args || {});
      respond({ type: "response", id: msg.id, cmd: msg.cmd, result });
    } catch (e) {
      respond({ type: "error", id: msg.id, cmd: msg.cmd, error: e.message });
    }
  }

  _broadcast(message) {
    if (this._channel) {
      try {
        this._channel.postMessage(message);
      } catch (e) {
        // Channel may be closed
      }
    }
  }

  _buildHandlers() {
    const api = this._api;
    const observer = this._observer;

    return {
      // Movement
      teleport: (args) => api.teleport(args.x, args.y, args.z),
      moveTo: (args) => api.moveTo(args.x, args.y, args.z),
      moveForward: (args) => api.moveForward(args.blocks || 1),
      moveBackward: (args) => api.moveBackward(args.blocks || 1),
      cancelMove: () => api.cancelMove(),

      // Camera
      lookAt: (args) => api.lookAt(args.x, args.y, args.z),
      setYaw: (args) => api.setYaw(args.degrees),
      setPitch: (args) => api.setPitch(args.degrees),
      setRotation: (args) => api.setRotation(args.yaw, args.pitch),

      // Blocks
      placeBlock: (args) => api.placeBlock(args.x, args.y, args.z, args.blockType),
      breakBlock: (args) => api.breakBlock(args.x, args.y, args.z),
      getBlock: (args) => api.getBlock(args.x, args.y, args.z),
      getBlocksInRegion: (args) =>
        api.getBlocksInRegion(args.x1, args.y1, args.z1, args.x2, args.y2, args.z2),

      // Inventory
      selectSlot: (args) => api.selectSlot(args.slot),
      getSelectedSlot: () => api.getSelectedSlot(),

      // World
      getPosition: () => api.getPosition(),
      getLookDirection: () => api.getLookDirection(),
      getRotation: () => api.getRotation(),
      getNearbyBlocks: (args) => api.getNearbyBlocks(args.radius || 5),
      raycast: (args) => api.raycast(args.maxDist || 8),

      // Building
      fillRegion: (args) =>
        api.fillRegion(args.x1, args.y1, args.z1, args.x2, args.y2, args.z2, args.blockType),
      clearRegion: (args) =>
        api.clearRegion(args.x1, args.y1, args.z1, args.x2, args.y2, args.z2),
      buildStructure: (args) =>
        api.buildStructure(args.x, args.y, args.z, args.structure),

      // AI Mode
      enableAI: () => api.enableAI(),
      disableAI: () => api.disableAI(),
      isAIMode: () => ({ aiMode: api.isAIMode() }),

      // Game Systems
      chat: (args) => api.chat(args.message),
      getWorldInfo: () => api.getWorldInfo(),
      getBlockTypes: () => api.getBlockTypes(),

      // Observer
      getSnapshot: () => observer.getSnapshot(),
      getQuickSnapshot: () => observer.getQuickSnapshot(),
      getVisibleBlocks: (args) =>
        observer.getVisibleBlocks(args.radius || 10, args.fov || 90),
      getSurfaceMap: (args) => observer.getSurfaceMap(args.radius || 16),
      startAutoSnapshot: (args) => {
        observer.startAutoSnapshot(args.interval || 1000);
        return { success: true };
      },
      stopAutoSnapshot: () => {
        observer.stopAutoSnapshot();
        return { success: true };
      },

      // Pathfinding (if available)
      findPath: (args) => {
        if (!this._game.pathfinder) {
          return { success: false, error: "Pathfinder not available" };
        }
        return this._game.pathfinder.findPath(
          args.sx, args.sy, args.sz,
          args.gx, args.gy, args.gz,
          { allowFly: args.allowFly || false }
        );
      },

      // Meta
      help: () => api.help(),
      getCommandLog: (args) => api.getCommandLog(args.limit || 50),
    };
  }
}
