/* ============================================================
 * audio.js —— WebAudio 程序化音效（不依赖任何音频文件）
 * 注意：浏览器要求用户交互后才能播放，首次点击/按键时 init()
 * ============================================================ */

const SFX = {
  ctx: null,
  master: null,
  enabled: true,
  _last: {},

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    // 用户可能在 init 之前就把声音关了（HUD 按钮），这里要按当前开关状态来
    this.master.gain.value = this.enabled ? 0.22 : 0;
    this.master.connect(this.ctx.destination);
  },

  /** 声音总开关：用 master 增益做淡入淡出，已经在排程的音也会一起收掉 */
  setEnabled(on) {
    this.enabled = !!on;
    if (this.enabled) this.init();          // 没初始化过就顺手建上下文（必须有用户手势）
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.enabled ? 0.22 : 0, this.ctx.currentTime, 0.02);
    }
  },

  // 限流：同一音效 40ms 内不重复触发，避免密集射击糊成噪音
  _gate(key, ms) {
    const t = performance.now();
    if (this._last[key] && t - this._last[key] < ms) return false;
    this._last[key] = t;
    return true;
  },

  _tone(freq, dur, type, gain, slideTo, delay) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type || 'square';
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  },

  _noise(dur, gain, freq, q, delay) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + (delay || 0);
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(freq, t0);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t0 + dur);
    bp.Q.value = q || 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.master);
    src.start(t0);
  },

  shoot() {
    if (!this._gate('shoot', 55)) return;
    this._tone(880, 0.06, 'square', 0.10, 420);
  },

  enemyShoot() {
    if (!this._gate('eshoot', 90)) return;
    this._tone(320, 0.09, 'sawtooth', 0.06, 180);
  },

  hit() {
    if (!this._gate('hit', 45)) return;
    this._noise(0.06, 0.18, 2600, 2);
  },

  explode(big) {
    if (!this._gate(big ? 'expb' : 'exp', big ? 90 : 55)) return;
    this._noise(big ? 0.5 : 0.24, big ? 0.55 : 0.28, big ? 900 : 1500, 0.8);
    this._tone(big ? 90 : 150, big ? 0.35 : 0.16, 'triangle', 0.22, 40);
  },

  bomb() {
    this._noise(0.9, 0.62, 520, 0.6);
    this._tone(120, 0.8, 'sine', 0.40, 32);
    this._tone(60, 1.1, 'triangle', 0.30, 24, 0.06);
  },

  weaponSwitch() {
    this._tone(520, 0.06, 'square', 0.10, 780);
    this._tone(780, 0.07, 'square', 0.09, 1040, 0.06);
  },

  overdrive() {
    this._tone(300, 0.18, 'sawtooth', 0.20, 1400);
    this._tone(600, 0.32, 'square', 0.16, 1800, 0.05);
    this._noise(0.35, 0.30, 3200, 1.4);
  },

  playerHit() {
    this._noise(0.4, 0.5, 700, 1.2);
    this._tone(220, 0.4, 'sawtooth', 0.25, 60);
  },

  pickup() {
    this._tone(660, 0.08, 'square', 0.12, 880);
    this._tone(990, 0.10, 'square', 0.10, 1320, 0.07);
  },

  warn() {
    for (let i = 0; i < 3; i++) {
      this._tone(520, 0.16, 'square', 0.14, 520, i * 0.26);
      this._tone(390, 0.16, 'square', 0.14, 390, i * 0.26 + 0.13);
    }
  },

  stageClear() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.16, f, i * 0.11));
  },

  laserCharge() {
    this._tone(150, 0.9, 'sawtooth', 0.09, 520);
    this._tone(300, 0.9, 'triangle', 0.05, 700, 0.1);
  },

  laserLock() {
    // 两声急促的高频短音，和蓄力的低频嗡鸣区分开
    this._tone(1180, 0.05, 'square', 0.10, 1180);
    this._tone(1180, 0.05, 'square', 0.10, 1180, 0.10);
  },

  laserFire() {
    this._tone(88, 0.7, 'sine', 0.30, 56);
    this._tone(176, 0.5, 'square', 0.10, 120);
    this._noise(0.7, 0.30, 700, 0.5);
  },

  optionGain() {
    this._tone(660, 0.12, 'triangle', 0.14, 880);
    this._tone(990, 0.22, 'sine', 0.12, 1320, 0.10);
    this._tone(1320, 0.26, 'triangle', 0.09, 1760, 0.20);
  },

  continueRun() {
    // 上行琶音：和失败音效反向，听觉上立刻区分“又活了”
    const notes = [392, 523, 659, 880];
    notes.forEach((f, i) => this._tone(f, 0.16, 'square', 0.13, f * 1.02, i * 0.07));
    this._tone(1046, 0.34, 'triangle', 0.12, 1318, 0.30);
    this._noise(0.3, 0.18, 2400, 1.6);
  },

  gameOver() {
    const notes = [440, 392, 330, 262];
    notes.forEach((f, i) => this._tone(f, 0.34, 'triangle', 0.18, f * 0.94, i * 0.16));
  }
};
