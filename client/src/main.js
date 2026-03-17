/**
 * VoxelChain Game Client - Main Entry Point
 * Three.js WebGL voxel renderer with blockchain integration.
 */

import * as THREE from "three";
import { WorldManager } from "./engine/WorldManager.js";
import { InputController } from "./engine/InputController.js";
import { BlockchainSync } from "./engine/BlockchainSync.js";
import { UIManager } from "./engine/UIManager.js";
import { registry } from "./engine/BlockRegistry.js";
import { GameCommandAPI } from "./engine/GameCommandAPI.js";
import { Pathfinder } from "./engine/Pathfinder.js";
import { AIObserver } from "./engine/AIObserver.js";
import { AICommandServer } from "./engine/AICommandServer.js";

class VoxelChainGame {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.world = null;
    this.input = null;
    this.blockchain = null;
    this.ui = null;

    // AI agent support
    this.api = null;
    this.pathfinder = null;
    this.observer = null;
    this.commandServer = null;

    this.clock = new THREE.Clock();
    this.frameCount = 0;
    this.fpsTimer = 0;
    this.currentFps = 0;
    this.running = false;
  }

  async init() {
    this.ui = new UIManager();
    this.ui.setLoadProgress(10, "Creating renderer...");

    // Three.js setup
    this._setupRenderer();
    this.ui.setLoadProgress(20, "Setting up scene...");

    this._setupScene();
    this.ui.setLoadProgress(30, "Building world...");

    // World
    this.world = new WorldManager(this.scene);
    this.ui.setLoadProgress(40, "Initializing controls...");

    // Input
    this.input = new InputController(this.camera, this.renderer.domElement, this.world);
    this.input.onBlockPlace = () => this._handleBlockPlace();
    this.input.onBlockBreak = () => this._handleBlockBreak();
    this.input.onSlotChange = (slot) => this.ui.selectSlot(slot);
    this.ui.setLoadProgress(60, "Connecting to blockchain...");

    // Blockchain
    this.blockchain = new BlockchainSync();
    this._setupBlockchainListeners();
    this.blockchain.connect();
    this.ui.setLoadProgress(70, "Generating terrain...");

    // Load initial chunks around spawn
    this.world.update(this.input.position);
    this.ui.setLoadProgress(90, "Finalizing...");

    // Wallet button
    const walletBtn = document.getElementById("wallet-btn");
    if (walletBtn) {
      walletBtn.addEventListener("click", async () => {
        try {
          const addr = await this.blockchain.connectWallet();
          this.ui.updateHUD({ walletAddress: addr });
          walletBtn.textContent = "Connected";
          walletBtn.disabled = true;
          this.ui.addChatMessage(`Wallet connected: ${addr.substring(0, 8)}...`, "#10b981");
        } catch (e) {
          this.ui.addChatMessage(`Wallet error: ${e.message}`, "#ef4444");
        }
      });
    }

    // Window resize
    window.addEventListener("resize", () => this._onResize());

    // Chat input - press T to open, Enter to send, Escape to cancel
    this.ui.setupChatInput((message) => {
      if (this.blockchain.connected && this._playerAddress) {
        this.blockchain.sendWS({
          type: "chat",
          sender: this._playerAddress,
          message: message,
        });
      }
    });
    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyT" && !e.ctrlKey && !e.metaKey) {
        const chatInput = document.getElementById("chat-input");
        if (chatInput && chatInput.classList.contains("hidden")) {
          e.preventDefault();
          chatInput.classList.remove("hidden");
          chatInput.focus();
          if (this.input) this.input.release();
        }
      }
    });

    // AI Agent Support
    this.ui.setLoadProgress(85, "Setting up AI systems...");
    this._setupAISupport();

    // Start
    this.ui.setLoadProgress(100, "Ready!");
    await new Promise((r) => setTimeout(r, 400));
    this.ui.hideLoading();

    if (this.input.aiMode) {
      this.ui.addChatMessage("VoxelChain AI Mode active. Use game.api.help() for commands.", "#7c3aed");
    } else {
      this.ui.addChatMessage("Welcome to VoxelChain! Click to enter, WASD to move, F to toggle fly.", "#7c3aed");
      this.ui.addChatMessage("Left-click to break, right-click to place. 1-9 for blocks.", "#666");
    }
    this.running = true;
    this._animate();
  }

  _setupAISupport() {
    // GameCommandAPI - programmatic interface
    this.api = new GameCommandAPI(this);

    // Pathfinder - A* navigation
    this.pathfinder = new Pathfinder(this.world);

    // AIObserver - structured state output
    this.observer = new AIObserver(this);

    // AICommandServer - external process communication
    this.commandServer = new AICommandServer(this, this.api, this.observer);
    this.commandServer.start();

    // Extended API methods that require pathfinder
    this.api.findPath = (sx, sy, sz, gx, gy, gz, options) => {
      return this.pathfinder.findPath(sx, sy, sz, gx, gy, gz, options);
    };

    this.api.navigateTo = async (x, y, z, options = {}) => {
      const pos = this.input.position;
      const result = this.pathfinder.findPath(
        Math.floor(pos.x), Math.floor(pos.y), Math.floor(pos.z),
        Math.floor(x), Math.floor(y), Math.floor(z),
        { allowFly: this.input.flyMode, ...options }
      );

      if (!result.found) {
        return { success: false, error: "No path found", iterations: result.iterations };
      }

      // Follow the path step by step
      for (const step of result.path) {
        const moveResult = await this.input.moveToward(step.x, step.y, step.z);
        if (!moveResult.arrived) {
          return { success: false, error: "Movement interrupted", reachedStep: step };
        }
      }

      return { success: true, pathLength: result.path.length };
    };

    // Expose to global scope for console / Playwright access
    window.game = this;

    console.log("[VoxelChain] AI support initialized. Access via window.game.api");
  }

  _setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById("game-canvas"),
      antialias: true,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x87ceeb);

    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
  }

  _setupScene() {
    this.scene = new THREE.Scene();

    // Fog
    this.scene.fog = new THREE.Fog(0x87ceeb, 40, 120);

    // Ambient light
    const ambient = new THREE.AmbientLight(0x606080, 0.6);
    this.scene.add(ambient);

    // Sun (directional light)
    const sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(50, 80, 30);
    sun.castShadow = true;
    sun.shadow.mapSize.width = 2048;
    sun.shadow.mapSize.height = 2048;
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 200;
    sun.shadow.camera.left = -80;
    sun.shadow.camera.right = 80;
    sun.shadow.camera.top = 80;
    sun.shadow.camera.bottom = -80;
    this.scene.add(sun);

    // Hemisphere light for sky/ground
    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x4a7c4a, 0.3);
    this.scene.add(hemi);

    // Sky gradient using a large sphere
    const skyGeometry = new THREE.SphereGeometry(400, 32, 15);
    const skyMaterial = new THREE.ShaderMaterial({
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPos = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPos.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 skyTop = vec3(0.3, 0.55, 0.95);
          vec3 skyBottom = vec3(0.7, 0.85, 0.95);
          vec3 color = mix(skyBottom, skyTop, max(h, 0.0));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide,
    });
    const sky = new THREE.Mesh(skyGeometry, skyMaterial);
    this.scene.add(sky);

    // Block highlight
    this.highlightMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.01, 1.01, 1.01),
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        wireframe: true,
        transparent: true,
        opacity: 0.5,
      })
    );
    this.highlightMesh.visible = false;
    this.scene.add(this.highlightMesh);
  }

  _setupBlockchainListeners() {
    this.blockchain.on("connected", () => {
      this.ui.addChatMessage("Connected to VoxelChain node", "#10b981");
      this.ui.setConnectionStatus(true);
      // Auto-join multiplayer session
      this._joinMultiplayer();
    });

    this.blockchain.on("disconnected", () => {
      this.ui.setConnectionStatus(false);
    });

    this.blockchain.on("reconnecting", (data) => {
      this.ui.addChatMessage(
        `Reconnecting... (attempt ${data.attempt})`,
        "#f59e0b"
      );
    });

    this.blockchain.on("blockUpdate", (data) => {
      this.ui.updateHUD({
        virtualBlock: data.virtual,
        realBlock: data.real,
      });
    });

    this.blockchain.on("chunkData", (data) => {
      this.world.loadChunkFromServer(data);
    });

    this.blockchain.on("blockPlaced", (data) => {
      this.ui.addChatMessage(
        `Block placed at (${data.x}, ${data.y}, ${data.z})`,
        "#10b981"
      );
    });

    this.blockchain.on("blockBroken", (data) => {
      this.ui.addChatMessage(
        `Block broken at (${data.x}, ${data.y}, ${data.z})`,
        "#f59e0b"
      );
    });

    this.blockchain.on("error", (data) => {
      this.ui.addChatMessage(`Error: ${data.error}`, "#ef4444");
    });

    // Multiplayer events
    this.blockchain.on("message", (data) => {
      this._handleServerMessage(data);
    });
  }

  /** Join multiplayer session */
  _joinMultiplayer() {
    const address = this.blockchain.walletAddress || "0x" + Math.random().toString(16).slice(2, 14);
    const pos = this.input.position;
    this.blockchain.sendWS({
      type: "playerJoin",
      address: address,
      displayName: address.substring(0, 8) + "...",
      position: { x: pos.x, y: pos.y, z: pos.z },
    });
    this._playerAddress = address;

    // Start position update interval
    if (this._posUpdateInterval) clearInterval(this._posUpdateInterval);
    this._posUpdateInterval = setInterval(() => {
      if (this.blockchain.connected) {
        const p = this.input.position;
        this.blockchain.sendWS({
          type: "updatePosition",
          address: this._playerAddress,
          position: { x: p.x, y: p.y, z: p.z },
          lookDirection: {
            yaw: this.input.euler.y,
            pitch: this.input.euler.x,
          },
        });
      }
    }, 200);
  }

  /** Handle multiplayer and game messages from server */
  _handleServerMessage(data) {
    switch (data.type) {
      case "joinResult":
        if (data.success) {
          this.ui.addChatMessage(
            `Joined world (${data.onlinePlayers} online)`,
            "#7c3aed"
          );
        }
        break;

      case "playerJoined":
        if (data.player && data.player.address !== this._playerAddress) {
          this.ui.addChatMessage(
            `${data.player.displayName} joined the world`,
            "#10b981"
          );
          this._updatePlayerAvatar(data.player);
        }
        break;

      case "playerLeft":
        if (data.address !== this._playerAddress) {
          this._removePlayerAvatar(data.address);
          this.ui.addChatMessage(`Player left`, "#666");
        }
        break;

      case "playerMoved":
        if (data.address !== this._playerAddress) {
          this._updatePlayerAvatar({
            address: data.address,
            position: data.position,
          });
        }
        break;

      case "chat":
        this.ui.addChatMessage(
          `<${data.displayName}> ${data.message}`,
          "#e0e0e0"
        );
        break;

      case "worldChange":
        if (data.x !== undefined && data.y !== undefined && data.z !== undefined) {
          this.world.setBlock(data.x, data.y, data.z, data.blockType || 0);
        }
        break;
    }
  }

  /** Update or create player avatar mesh */
  _updatePlayerAvatar(player) {
    if (!this._playerAvatars) this._playerAvatars = new Map();

    let avatar = this._playerAvatars.get(player.address);
    if (!avatar) {
      // Create simple avatar mesh (colored box)
      const bodyGeo = new THREE.BoxGeometry(0.6, 1.6, 0.6);
      const bodyMat = new THREE.MeshLambertMaterial({ color: this._playerColor(player.address) });
      avatar = new THREE.Mesh(bodyGeo, bodyMat);

      // Name tag
      const headGeo = new THREE.BoxGeometry(0.5, 0.5, 0.5);
      const headMat = new THREE.MeshLambertMaterial({ color: 0xffcc99 });
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.y = 1.05;
      avatar.add(head);

      this.scene.add(avatar);
      this._playerAvatars.set(player.address, avatar);
    }

    if (player.position) {
      avatar.position.set(
        player.position.x,
        player.position.y + 0.8,
        player.position.z
      );
    }
  }

  /** Remove player avatar */
  _removePlayerAvatar(address) {
    if (!this._playerAvatars) return;
    const avatar = this._playerAvatars.get(address);
    if (avatar) {
      this.scene.remove(avatar);
      avatar.geometry.dispose();
      avatar.material.dispose();
      this._playerAvatars.delete(address);
    }
  }

  /** Generate a deterministic color from an address string */
  _playerColor(address) {
    let hash = 0;
    for (let i = 0; i < address.length; i++) {
      hash = address.charCodeAt(i) + ((hash << 5) - hash);
    }
    return (hash & 0x00FFFFFF);
  }

  _handleBlockPlace() {
    const ray = this.world.raycast(
      this.input.getEyePosition(),
      this.input.getLookDirection()
    );
    if (ray.hit) {
      const pos = ray.placePos;
      const blockType = this.ui.getSelectedBlockType();

      // Place locally first (optimistic)
      this.world.setBlock(pos.x, pos.y, pos.z, blockType);

      // Submit to blockchain
      const player = this.blockchain.walletAddress || "";
      this.blockchain.placeBlock(pos.x, pos.y, pos.z, blockType, player).catch(() => {
        // Rollback on failure
        this.world.setBlock(pos.x, pos.y, pos.z, 0);
      });
    }
  }

  _handleBlockBreak() {
    const ray = this.world.raycast(
      this.input.getEyePosition(),
      this.input.getLookDirection()
    );
    if (ray.hit) {
      const pos = ray.blockPos;
      const oldBlock = ray.blockType;

      // Remove locally first (optimistic)
      this.world.setBlock(pos.x, pos.y, pos.z, 0);

      // Submit to blockchain
      const player = this.blockchain.walletAddress || "";
      this.blockchain.breakBlock(pos.x, pos.y, pos.z, player).catch(() => {
        // Rollback on failure
        this.world.setBlock(pos.x, pos.y, pos.z, oldBlock);
      });
    }
  }

  _animate() {
    if (!this.running) return;
    requestAnimationFrame(() => this._animate());

    const dt = Math.min(this.clock.getDelta(), 0.1);

    // FPS counter
    this.frameCount++;
    this.fpsTimer += dt;
    if (this.fpsTimer >= 1.0) {
      this.currentFps = this.frameCount;
      this.frameCount = 0;
      this.fpsTimer = 0;
    }

    // Update
    this.input.update(dt);
    this.world.update(this.input.position);

    // Block highlight (raycast)
    const ray = this.world.raycast(
      this.input.getEyePosition(),
      this.input.getLookDirection()
    );
    if (ray.hit) {
      this.highlightMesh.visible = true;
      this.highlightMesh.position.set(
        ray.blockPos.x + 0.5,
        ray.blockPos.y + 0.5,
        ray.blockPos.z + 0.5
      );
      this.ui.showBlockInfo(ray.blockType, ray.blockPos);
    } else {
      this.highlightMesh.visible = false;
      this.ui.showBlockInfo(0);
    }

    // HUD
    this.ui.updateHUD({
      fps: this.currentFps,
      position: this.input.position,
    });

    // Minimap (every 10 frames)
    if (this.frameCount % 10 === 0) {
      this.ui.updateMinimap(this.world, this.input.position);
    }

    // Render
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}

// Start game
const game = new VoxelChainGame();
game.init().catch((e) => {
  console.error("Failed to initialize VoxelChain:", e);
  const status = document.getElementById("load-status");
  if (status) status.textContent = `Error: ${e.message}`;
});
