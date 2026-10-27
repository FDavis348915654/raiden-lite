/* ============================================================
 * assets.js —— 图集与背景加载 + 常用绘制封装
 * 帧表来自 js/atlas.js（由 tools/gen_assets.py 生成）
 * ============================================================ */

const Assets = {
  sheet: null,
  frames: {},
  bg: {},
  ready: false,
  bulletSprites: {},

  load() {
    // 资源版本串：图集坐标（atlas.js）和图片必须同版本。
    // 之前这里没带版本，浏览器缓存了旧的 sprites.png 而 atlas.js 已经更新，
    // 结果是"新坐标裁旧图"，所有精灵都错位、看起来像坏图。
    const v = '?v=' + (typeof VERSION !== 'undefined' ? VERSION : '0');
    const jobs = [this._img('assets/sprites.png' + v).then(im => { this.sheet = im; })];

    LEVELS.forEach(lv => {
      jobs.push(this._img('assets/bg/' + lv.bg + '.png' + v).then(im => { this.bg[lv.bg] = im; }));
    });

    return Promise.all(jobs).then(() => {
      this.frames = ATLAS;
      this._buildBullets();
      this.ready = true;
    });
  },

  _img(src) {
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error('load fail: ' + src));
      im.src = src;
    });
  },

  /* 预先烘焙子弹贴图：每帧现画 radialGradient 在几百颗子弹下会明显掉帧 */
  _buildBullets() {
    const make = (w, h, core, glow) => {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const g = c.getContext('2d');
      const cx = w / 2, cy = h / 2;
      const grd = g.createRadialGradient(cx, cy, 0, cx, cy, w / 2);
      grd.addColorStop(0, core);
      grd.addColorStop(0.35, glow);
      grd.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.globalAlpha = 0.95;
      g.fillStyle = core;
      g.beginPath();
      g.ellipse(cx, cy, Math.max(1, w * 0.14), Math.max(1, h * 0.34), 0, 0, Math.PI * 2);
      g.fill();
      return c;
    };
    // 火神炮用冷青、散射炮用暖黄：两者的弹道形状本来就接近（都是直射），
    // 只靠光晕深浅区分在深色背景上几乎看不出，必须把冷暖彻底拉开。
    // 顺带把体型也分开：火神炮细长（点射感），散射炮短粗（散弹团）。
    this.bulletSprites.player = make(16, 36, '#e8fbff', 'rgba(40,200,255,0.95)');
    this.bulletSprites.spread = make(22, 24, '#fffbe0', 'rgba(255,205,60,0.95)');
    this.bulletSprites.laser = make(14, 64, '#ffffff', 'rgba(255,105,160,0.90)');
    this.bulletSprites.missile = make(16, 26, '#f2fff4', 'rgba(130,255,160,0.90)');
    this.bulletSprites.plasma = make(30, 30, '#f6ecff', 'rgba(190,130,255,0.95)');
    this.bulletSprites.flak = make(18, 22, '#fff4e2', 'rgba(255,154,92,0.92)');
    this.bulletSprites.flakFrag = make(11, 15, '#ffeacd', 'rgba(255,170,96,0.85)');
    this.bulletSprites.tesla = make(15, 32, '#f0ffff', 'rgba(125,250,255,0.95)');
    this.bulletSprites.backfire = make(14, 28, '#eafff8', 'rgba(92,224,184,0.92)');
    this.bulletSprites.omni = make(14, 14, '#fff0fa', 'rgba(255,179,230,0.92)');
    this.bulletSprites.enemy = make(16, 16, '#fff2c4', 'rgba(255,140,60,0.85)');
    this.bulletSprites.enemyAlt = make(16, 16, '#f0d8ff', 'rgba(180,120,255,0.85)');
    this.bulletSprites.big = make(30, 30, '#ffffff', 'rgba(255,90,60,0.9)');
  },

  frame(name) {
    return this.frames[name];
  },

  size(name) {
    const f = this.frames[name];
    return f ? { w: f[2], h: f[3] } : { w: 0, h: 0 };
  },

  /** 以中心点绘制精灵 */
  draw(ctx, name, cx, cy, scale, alpha, rot) {
    const f = this.frames[name];
    if (!f) return;
    const s = scale === undefined ? 1 : scale;
    const w = f[2] * s, h = f[3] * s;
    if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = alpha;
    if (rot) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.drawImage(this.sheet, f[0], f[1], f[2], f[3], -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(this.sheet, f[0], f[1], f[2], f[3], cx - w / 2, cy - h / 2, w, h);
    }
    if (alpha !== undefined && alpha !== 1) ctx.globalAlpha = 1;
  },

  drawBullet(ctx, kind, x, y, rot) {
    const c = this.bulletSprites[kind] || this.bulletSprites.enemy;
    if (rot) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(c, -c.width / 2, -c.height / 2);
      ctx.restore();
    } else {
      ctx.drawImage(c, x - c.width / 2, y - c.height / 2);
    }
  }
};
