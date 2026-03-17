/**
 * Sound Manager for VoxelChain.
 * Procedural audio using Web Audio API - no external sound files needed.
 */

export class SoundManager {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._enabled = true;
    this._volume = 0.3;
    this._ambientSource = null;
    this._ambientGain = null;
    this._initialized = false;
  }

  /** Initialize audio context (must be called after user gesture) */
  init() {
    if (this._initialized) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = this._volume;
      this._masterGain.connect(this._ctx.destination);
      this._initialized = true;
    } catch (e) {
      console.warn("[SoundManager] Web Audio API not available:", e.message);
    }
  }

  /** Resume audio context (needed after user interaction) */
  resume() {
    if (this._ctx && this._ctx.state === "suspended") {
      this._ctx.resume();
    }
  }

  /** Set master volume (0-1) */
  setVolume(v) {
    this._volume = Math.max(0, Math.min(1, v));
    if (this._masterGain) {
      this._masterGain.gain.value = this._volume;
    }
  }

  /** Toggle sound on/off */
  toggle() {
    this._enabled = !this._enabled;
    if (this._masterGain) {
      this._masterGain.gain.value = this._enabled ? this._volume : 0;
    }
    return this._enabled;
  }

  /** Play block place sound - short percussive thud */
  playBlockPlace() {
    if (!this._ctx || !this._enabled) return;
    this.resume();
    const now = this._ctx.currentTime;

    // Low thud oscillator
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(180, now);
    osc.frequency.exponentialRampToValueAtTime(80, now + 0.08);
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.12);

    // Click noise
    this._playNoiseBurst(now, 0.03, 0.2, 2000, 8000);
  }

  /** Play block break sound - crumbly noise */
  playBlockBreak() {
    if (!this._ctx || !this._enabled) return;
    this.resume();
    const now = this._ctx.currentTime;

    // Downward sweep
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(300, now);
    osc.frequency.exponentialRampToValueAtTime(60, now + 0.15);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.2);

    // Crumble noise
    this._playNoiseBurst(now, 0.15, 0.25, 800, 4000);
  }

  /** Play footstep sound */
  playFootstep() {
    if (!this._ctx || !this._enabled) return;
    this.resume();
    const now = this._ctx.currentTime;

    // Soft thump
    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(100 + Math.random() * 40, now);
    osc.frequency.exponentialRampToValueAtTime(50, now + 0.06);
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** Play jump sound - upward sweep */
  playJump() {
    if (!this._ctx || !this._enabled) return;
    this.resume();
    const now = this._ctx.currentTime;

    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(400, now + 0.1);
    gain.gain.setValueAtTime(0.15, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.15);
  }

  /** Play chat receive blip */
  playChatReceive() {
    if (!this._ctx || !this._enabled) return;
    this.resume();
    const now = this._ctx.currentTime;

    const osc = this._ctx.createOscillator();
    const gain = this._ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.setValueAtTime(1100, now + 0.05);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(now);
    osc.stop(now + 0.12);
  }

  /** Start ambient wind/nature loop */
  startAmbient() {
    if (!this._ctx || !this._enabled || this._ambientSource) return;
    this.resume();

    // Create brown noise for wind ambience
    const bufferSize = this._ctx.sampleRate * 4;
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let lastOut = 0;
    for (let i = 0; i < bufferSize; i++) {
      const white = Math.random() * 2 - 1;
      // Brown noise filter
      lastOut = (lastOut + 0.02 * white) / 1.02;
      data[i] = lastOut * 3.5;
    }

    this._ambientSource = this._ctx.createBufferSource();
    this._ambientSource.buffer = buffer;
    this._ambientSource.loop = true;

    this._ambientGain = this._ctx.createGain();
    this._ambientGain.gain.value = 0.04;

    // Low-pass filter for wind effect
    const filter = this._ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 400;

    this._ambientSource.connect(filter);
    filter.connect(this._ambientGain);
    this._ambientGain.connect(this._masterGain);
    this._ambientSource.start();
  }

  /** Stop ambient sound */
  stopAmbient() {
    if (this._ambientSource) {
      this._ambientSource.stop();
      this._ambientSource = null;
      this._ambientGain = null;
    }
  }

  /** Play a filtered noise burst (used internally) */
  _playNoiseBurst(startTime, duration, volume, lowFreq, highFreq) {
    const bufferSize = Math.ceil(this._ctx.sampleRate * duration);
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }

    const source = this._ctx.createBufferSource();
    source.buffer = buffer;

    const bandpass = this._ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = (lowFreq + highFreq) / 2;
    bandpass.Q.value = 1;

    const gain = this._ctx.createGain();
    gain.gain.setValueAtTime(volume, startTime);
    gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

    source.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(this._masterGain);
    source.start(startTime);
    source.stop(startTime + duration);
  }
}
