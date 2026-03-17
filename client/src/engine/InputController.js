/**
 * First-person input controller for VoxelChain.
 * Handles keyboard, mouse, and pointer lock for FPS movement.
 * Supports AI mode for programmatic control without pointer lock.
 */

import * as THREE from "three";

const MOVE_SPEED = 6.0;
const SPRINT_SPEED = 10.0;
const JUMP_VELOCITY = 8.0;
const GRAVITY = -20.0;
const MOUSE_SENSITIVITY = 0.002;
const FLY_SPEED = 10.0;

export class InputController {
  constructor(camera, canvas, worldManager) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = worldManager;

    this.position = new THREE.Vector3(8, 30, 8);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.euler = new THREE.Euler(0, 0, 0, "YXZ");

    this.keys = {};
    this.mouseButtons = {};
    this.isLocked = false;
    this.flyMode = true; // Start in fly mode
    this.onGround = false;
    this.selectedSlot = 0;

    // AI mode: bypasses pointer lock, allows programmatic control
    this.aiMode = false;
    this._aiMoveTarget = null; // {x,y,z} target for moveTo
    this._aiMoveCallback = null; // resolve when arrived
    this._aiMoveSpeed = FLY_SPEED;

    // Callbacks
    this.onBlockPlace = null;
    this.onBlockBreak = null;
    this.onSlotChange = null;

    // Check URL param for AI mode
    const params = new URLSearchParams(window.location.search);
    if (params.get("ai") === "true") {
      this.enableAIMode();
    }

    this._setupEventListeners();
  }

  /** Enable AI mode - bypasses pointer lock requirement */
  enableAIMode() {
    this.aiMode = true;
    this.isLocked = true; // Simulate locked state
    this.flyMode = true;
    console.log("[VoxelChain] AI mode enabled");
  }

  /** Disable AI mode - restores normal pointer lock behavior */
  disableAIMode() {
    this.aiMode = false;
    this.isLocked = document.pointerLockElement === this.canvas;
    this._aiMoveTarget = null;
    this._aiMoveCallback = null;
    console.log("[VoxelChain] AI mode disabled");
  }

  /** Set camera look direction by euler angles (radians) */
  setLookEuler(yaw, pitch) {
    this.euler.y = yaw;
    this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    this.camera.quaternion.setFromEuler(this.euler);
  }

  /** Look at a world position */
  lookAtPosition(x, y, z) {
    const eyePos = this.getEyePosition();
    const dx = x - eyePos.x;
    const dy = y - eyePos.y;
    const dz = z - eyePos.z;
    const yaw = Math.atan2(-dx, -dz);
    const dist = Math.sqrt(dx * dx + dz * dz);
    const pitch = Math.atan2(dy, dist);
    this.setLookEuler(yaw, pitch);
  }

  /** Teleport to exact position */
  teleport(x, y, z) {
    this.position.set(x, y, z);
    this.velocity.set(0, 0, 0);
    this.camera.position.copy(this.position);
    this.camera.position.y += 1.6;
  }

  /** Start moving toward a target position (AI mode) */
  moveToward(x, y, z) {
    return new Promise((resolve) => {
      this._aiMoveTarget = new THREE.Vector3(x, y, z);
      this._aiMoveCallback = resolve;
    });
  }

  /** Cancel current AI move */
  cancelMove() {
    if (this._aiMoveCallback) {
      this._aiMoveCallback({ arrived: false, reason: "cancelled" });
    }
    this._aiMoveTarget = null;
    this._aiMoveCallback = null;
  }

  _setupEventListeners() {
    // Keyboard
    document.addEventListener("keydown", (e) => {
      this.keys[e.code] = true;

      // Slot selection (1-9)
      if (e.code >= "Digit1" && e.code <= "Digit9") {
        this.selectedSlot = parseInt(e.key) - 1;
        if (this.onSlotChange) this.onSlotChange(this.selectedSlot);
      }

      // Toggle fly mode
      if (e.code === "KeyF") {
        this.flyMode = !this.flyMode;
        this.velocity.y = 0;
      }

      // Chat toggle
      if (e.code === "KeyT" && this.isLocked) {
        document.exitPointerLock();
        const chatInput = document.getElementById("chat-input");
        if (chatInput) {
          chatInput.classList.remove("hidden");
          chatInput.focus();
        }
      }

      // Inventory
      if (e.code === "KeyE") {
        const panel = document.getElementById("inventory-panel");
        if (panel) panel.classList.toggle("hidden");
      }

      // Escape handled by pointer lock
    });

    document.addEventListener("keyup", (e) => {
      this.keys[e.code] = false;
    });

    // Mouse
    this.canvas.addEventListener("click", () => {
      if (!this.isLocked) {
        this.canvas.requestPointerLock();
      }
    });

    document.addEventListener("pointerlockchange", () => {
      this.isLocked = document.pointerLockElement === this.canvas;
    });

    document.addEventListener("mousemove", (e) => {
      if (!this.isLocked) return;
      this.euler.y -= e.movementX * MOUSE_SENSITIVITY;
      this.euler.x -= e.movementY * MOUSE_SENSITIVITY;
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    });

    document.addEventListener("mousedown", (e) => {
      if (!this.isLocked) return;
      this.mouseButtons[e.button] = true;

      // Block interaction
      if (e.button === 0) {
        // Left click - break block
        if (this.onBlockBreak) this.onBlockBreak();
      } else if (e.button === 2) {
        // Right click - place block
        if (this.onBlockPlace) this.onBlockPlace();
      }
    });

    document.addEventListener("mouseup", (e) => {
      this.mouseButtons[e.button] = false;
    });

    // Prevent context menu
    this.canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    // Mouse wheel - slot selection
    document.addEventListener("wheel", (e) => {
      if (!this.isLocked) return;
      if (e.deltaY > 0) {
        this.selectedSlot = (this.selectedSlot + 1) % 9;
      } else {
        this.selectedSlot = (this.selectedSlot + 8) % 9;
      }
      if (this.onSlotChange) this.onSlotChange(this.selectedSlot);
    });

    // Chat input
    const chatInput = document.getElementById("chat-input");
    if (chatInput) {
      chatInput.addEventListener("keydown", (e) => {
        if (e.code === "Enter") {
          chatInput.classList.add("hidden");
          chatInput.value = "";
          this.canvas.requestPointerLock();
        }
        if (e.code === "Escape") {
          chatInput.classList.add("hidden");
          chatInput.value = "";
          this.canvas.requestPointerLock();
        }
        e.stopPropagation();
      });
    }
  }

  update(dt) {
    if (!this.isLocked && !this.aiMode) return;

    // AI move-toward logic
    if (this.aiMode && this._aiMoveTarget) {
      const target = this._aiMoveTarget;
      const dx = target.x - this.position.x;
      const dy = target.y - this.position.y;
      const dz = target.z - this.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (dist < 0.5) {
        this.position.copy(target);
        const cb = this._aiMoveCallback;
        this._aiMoveTarget = null;
        this._aiMoveCallback = null;
        if (cb) cb({ arrived: true, position: { x: target.x, y: target.y, z: target.z } });
      } else {
        const moveDir = new THREE.Vector3(dx, dy, dz).normalize();
        const step = Math.min(this._aiMoveSpeed * dt, dist);
        this.position.add(moveDir.multiplyScalar(step));
      }
      this.camera.position.copy(this.position);
      this.camera.position.y += 1.6;
      return;
    }

    const speed = this.keys["ShiftLeft"] ? SPRINT_SPEED : MOVE_SPEED;

    // Direction vectors
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);

    if (this.flyMode) {
      // Fly mode - no gravity
      const moveDir = new THREE.Vector3();
      if (this.keys["KeyW"]) moveDir.add(forward);
      if (this.keys["KeyS"]) moveDir.sub(forward);
      if (this.keys["KeyD"]) moveDir.add(right);
      if (this.keys["KeyA"]) moveDir.sub(right);
      if (this.keys["Space"]) moveDir.y += 1;
      if (this.keys["ControlLeft"]) moveDir.y -= 1;

      if (moveDir.lengthSq() > 0) {
        moveDir.normalize().multiplyScalar(FLY_SPEED * dt);
        this.position.add(moveDir);
      }
    } else {
      // Walking mode with gravity
      const moveDir = new THREE.Vector3();
      const flatForward = forward.clone();
      flatForward.y = 0;
      flatForward.normalize();
      const flatRight = right.clone();
      flatRight.y = 0;
      flatRight.normalize();

      if (this.keys["KeyW"]) moveDir.add(flatForward);
      if (this.keys["KeyS"]) moveDir.sub(flatForward);
      if (this.keys["KeyD"]) moveDir.add(flatRight);
      if (this.keys["KeyA"]) moveDir.sub(flatRight);

      if (moveDir.lengthSq() > 0) {
        moveDir.normalize().multiplyScalar(speed * dt);
      }

      // Apply horizontal movement with collision
      const newPos = this.position.clone().add(moveDir);
      if (!this._checkCollision(newPos.x, this.position.y, this.position.z)) {
        this.position.x = newPos.x;
      }
      if (!this._checkCollision(this.position.x, this.position.y, newPos.z)) {
        this.position.z = newPos.z;
      }

      // Gravity & jump
      if (this.keys["Space"] && this.onGround) {
        this.velocity.y = JUMP_VELOCITY;
        this.onGround = false;
      }
      this.velocity.y += GRAVITY * dt;
      const newY = this.position.y + this.velocity.y * dt;

      if (this._checkCollision(this.position.x, newY, this.position.z)) {
        if (this.velocity.y < 0) {
          this.onGround = true;
          // Snap to ground
          this.position.y = Math.ceil(newY) + 0.01;
        }
        this.velocity.y = 0;
      } else {
        this.position.y = newY;
        this.onGround = false;
      }
    }

    // Update camera
    this.camera.position.copy(this.position);
    this.camera.position.y += 1.6; // Eye height
  }

  _checkCollision(x, y, z) {
    // Player hitbox: 0.6 wide, 1.8 tall
    const hw = 0.3;
    const offsets = [
      [x - hw, y, z - hw],
      [x + hw, y, z - hw],
      [x - hw, y, z + hw],
      [x + hw, y, z + hw],
      [x - hw, y + 1.0, z - hw],
      [x + hw, y + 1.0, z - hw],
      [x - hw, y + 1.0, z + hw],
      [x + hw, y + 1.0, z + hw],
      [x - hw, y + 1.7, z - hw],
      [x + hw, y + 1.7, z + hw],
    ];

    for (const [ox, oy, oz] of offsets) {
      const bx = Math.floor(ox);
      const by = Math.floor(oy);
      const bz = Math.floor(oz);
      const block = this.world.getBlock(bx, by, bz);
      if (block !== 0 && block !== 5) {
        // Not air and not water
        return true;
      }
    }
    return false;
  }

  /** Get look direction for raycasting */
  getLookDirection() {
    return new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  /** Get eye position */
  getEyePosition() {
    return this.camera.position.clone();
  }
}
