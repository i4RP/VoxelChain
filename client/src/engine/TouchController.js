/**
 * Touch Controller for VoxelChain mobile support.
 * Provides virtual joystick, look controls, and action buttons.
 */

export class TouchController {
  constructor(inputController) {
    this.input = inputController;
    this.enabled = false;

    // Joystick state
    this._joystickActive = false;
    this._joystickStartX = 0;
    this._joystickStartY = 0;
    this._joystickDX = 0;
    this._joystickDY = 0;
    this._joystickId = null;

    // Look state
    this._lookActive = false;
    this._lookLastX = 0;
    this._lookLastY = 0;
    this._lookId = null;
    this._lookSensitivity = 0.004;

    // UI elements
    this._overlay = null;
    this._joystickBase = null;
    this._joystickKnob = null;

    // Detect touch device
    if ("ontouchstart" in window || navigator.maxTouchPoints > 0) {
      this._setup();
    }
  }

  _setup() {
    this.enabled = true;

    // Enable AI-like mode to bypass pointer lock on mobile
    this.input.aiMode = true;
    this.input.isLocked = true;

    this._createOverlay();
    this._bindTouchEvents();
  }

  _createOverlay() {
    this._overlay = document.createElement("div");
    this._overlay.id = "touch-overlay";
    this._overlay.innerHTML = `
      <div id="touch-joystick-zone">
        <div id="touch-joystick-base">
          <div id="touch-joystick-knob"></div>
        </div>
      </div>
      <div id="touch-look-zone"></div>
      <div id="touch-buttons">
        <button id="touch-btn-place" class="touch-btn">Place</button>
        <button id="touch-btn-break" class="touch-btn">Break</button>
        <button id="touch-btn-jump" class="touch-btn">Jump</button>
        <button id="touch-btn-fly" class="touch-btn touch-btn-small">Fly</button>
        <button id="touch-btn-chat" class="touch-btn touch-btn-small">Chat</button>
        <button id="touch-btn-inv" class="touch-btn touch-btn-small">Inv</button>
      </div>
    `;
    document.body.appendChild(this._overlay);

    this._joystickBase = document.getElementById("touch-joystick-base");
    this._joystickKnob = document.getElementById("touch-joystick-knob");

    // Button events
    this._bindButton("touch-btn-place", () => {
      if (this.input.onBlockPlace) this.input.onBlockPlace();
    });
    this._bindButton("touch-btn-break", () => {
      if (this.input.onBlockBreak) this.input.onBlockBreak();
    });
    this._bindButton("touch-btn-jump", () => {
      this.input.keys["Space"] = true;
      setTimeout(() => { this.input.keys["Space"] = false; }, 100);
    });
    this._bindButton("touch-btn-fly", () => {
      this.input.flyMode = !this.input.flyMode;
      this.input.velocity.y = 0;
      const btn = document.getElementById("touch-btn-fly");
      if (btn) btn.classList.toggle("active", this.input.flyMode);
    });
    this._bindButton("touch-btn-chat", () => {
      const chatInput = document.getElementById("chat-input");
      if (chatInput) {
        chatInput.classList.toggle("hidden");
        if (!chatInput.classList.contains("hidden")) chatInput.focus();
      }
    });
    this._bindButton("touch-btn-inv", () => {
      const panel = document.getElementById("inventory-panel");
      if (panel) panel.classList.toggle("hidden");
    });
  }

  _bindButton(id, handler) {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.addEventListener("touchstart", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handler();
    }, { passive: false });
  }

  _bindTouchEvents() {
    const joystickZone = document.getElementById("touch-joystick-zone");
    const lookZone = document.getElementById("touch-look-zone");
    if (!joystickZone || !lookZone) return;

    // Joystick touch
    joystickZone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      this._joystickActive = true;
      this._joystickId = touch.identifier;
      this._joystickStartX = touch.clientX;
      this._joystickStartY = touch.clientY;

      // Position joystick base at touch point
      if (this._joystickBase) {
        this._joystickBase.style.left = (touch.clientX - 50) + "px";
        this._joystickBase.style.top = (touch.clientY - 50) + "px";
        this._joystickBase.style.opacity = "1";
      }
    }, { passive: false });

    joystickZone.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (touch.identifier === this._joystickId) {
          const dx = touch.clientX - this._joystickStartX;
          const dy = touch.clientY - this._joystickStartY;
          const maxR = 40;
          const dist = Math.sqrt(dx * dx + dy * dy);
          const clampedDist = Math.min(dist, maxR);
          const angle = Math.atan2(dy, dx);

          this._joystickDX = (clampedDist / maxR) * Math.cos(angle);
          this._joystickDY = (clampedDist / maxR) * Math.sin(angle);

          // Move knob visual
          if (this._joystickKnob) {
            this._joystickKnob.style.transform =
              `translate(${this._joystickDX * maxR}px, ${this._joystickDY * maxR}px)`;
          }

          // Map joystick to keyboard keys
          this.input.keys["KeyW"] = this._joystickDY < -0.3;
          this.input.keys["KeyS"] = this._joystickDY > 0.3;
          this.input.keys["KeyA"] = this._joystickDX < -0.3;
          this.input.keys["KeyD"] = this._joystickDX > 0.3;
          this.input.keys["ShiftLeft"] = dist > maxR * 0.8;
        }
      }
    }, { passive: false });

    const endJoystick = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === this._joystickId) {
          this._joystickActive = false;
          this._joystickId = null;
          this._joystickDX = 0;
          this._joystickDY = 0;
          this.input.keys["KeyW"] = false;
          this.input.keys["KeyS"] = false;
          this.input.keys["KeyA"] = false;
          this.input.keys["KeyD"] = false;
          this.input.keys["ShiftLeft"] = false;

          if (this._joystickKnob) {
            this._joystickKnob.style.transform = "translate(0, 0)";
          }
          if (this._joystickBase) {
            this._joystickBase.style.opacity = "0.5";
          }
        }
      }
    };
    joystickZone.addEventListener("touchend", endJoystick, { passive: false });
    joystickZone.addEventListener("touchcancel", endJoystick, { passive: false });

    // Look touch (right half of screen)
    lookZone.addEventListener("touchstart", (e) => {
      e.preventDefault();
      const touch = e.changedTouches[0];
      this._lookActive = true;
      this._lookId = touch.identifier;
      this._lookLastX = touch.clientX;
      this._lookLastY = touch.clientY;
    }, { passive: false });

    lookZone.addEventListener("touchmove", (e) => {
      e.preventDefault();
      for (const touch of e.changedTouches) {
        if (touch.identifier === this._lookId) {
          const dx = touch.clientX - this._lookLastX;
          const dy = touch.clientY - this._lookLastY;
          this._lookLastX = touch.clientX;
          this._lookLastY = touch.clientY;

          // Apply look rotation
          this.input.euler.y -= dx * this._lookSensitivity;
          this.input.euler.x -= dy * this._lookSensitivity;
          this.input.euler.x = Math.max(
            -Math.PI / 2 + 0.01,
            Math.min(Math.PI / 2 - 0.01, this.input.euler.x)
          );
          this.input.camera.quaternion.setFromEuler(this.input.euler);
        }
      }
    }, { passive: false });

    const endLook = (e) => {
      for (const touch of e.changedTouches) {
        if (touch.identifier === this._lookId) {
          this._lookActive = false;
          this._lookId = null;
        }
      }
    };
    lookZone.addEventListener("touchend", endLook, { passive: false });
    lookZone.addEventListener("touchcancel", endLook, { passive: false });
  }
}
