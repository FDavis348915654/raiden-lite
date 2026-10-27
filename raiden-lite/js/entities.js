/* ============================================================
 * entities.js —— 子弹 / 粒子 / 拾取物 / 玩家 / 敌机 / BOSS
 * ============================================================ */

class Bullet {
  constructor() {
    this.active = false;
  }

  init(x, y, vx, vy, opt) {
    opt = opt || {};
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.friendly = !!opt.friendly;
    this.dmg = opt.dmg === undefined ? 1 : opt.dmg;
    this.r = opt.r === undefined ? 7 : opt.r;
    this.kind = opt.kind || 'enemy';
    this.rot = opt.rot === undefined ? Math.atan2(vy, vx) + Math.PI / 2 : opt.rot;
    this.life = opt.life === undefined ? 5 : opt.life;
    this.ay = opt.ay || 0;          // 纵向加速度（抛石类弹幕用）
    this.pierce = !!opt.pierce;     // 穿透弹（激光）
    this.homing = opt.homing || 0;  // 追踪转向速率 rad/s
    this.boom = opt.boom || null;   // 命中后的范围爆炸 { r, dmg }
    this.fuse = opt.fuse === undefined ? 0 : opt.fuse;  // 引信：到时炸开
    this.chain = opt.chain || 0;    // 电弧链式跳数
    this.hits = opt.pierce ? [] : null;
    this.bossT = 0;                 // 穿透弹对 BOSS 的命中间隔
    this.active = true;
  }

  update(dt, game) {
    if (this.bossT > 0) this.bossT -= dt;

    // 引信：飞到时间就炸开（散榴弹）
    if (this.fuse > 0) {
      this.fuse -= dt;
      if (this.fuse <= 0) {
        this.fuse = 0;
        if (game) game.burstFlak(this);
        this.active = false;
        return;
      }
    }

    // 追踪：朝最近的敌机转向
    if (this.homing > 0 && game) {
      const t = game.nearestEnemy(this.x, this.y);
      if (t) {
        const cur = Math.atan2(this.vy, this.vx);
        const want = Math.atan2(t.y - this.y, t.x - this.x);
        let diff = want - cur;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        const sp = Math.hypot(this.vx, this.vy);
        const na = cur + clamp(diff, -this.homing * dt, this.homing * dt);
        this.vx = Math.cos(na) * sp;
        this.vy = Math.sin(na) * sp;
        this.rot = na + Math.PI / 2;
      }
    }

    if (this.ay) this.vy += this.ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
    this.life -= dt;
    if (this.life <= 0 || this.x < -50 || this.x > VIEW.w + 50 ||
        this.y < -70 || this.y > VIEW.h + 70) {
      this.active = false;
    }
  }

  draw(ctx) {
    Assets.drawBullet(ctx, this.kind, this.x, this.y, this.rot);
  }
}

class Particle {
  constructor() {
    this.active = false;
  }

  init(x, y, opt) {
    opt = opt || {};
    this.x = x;
    this.y = y;
    this.vx = opt.vx || 0;
    this.vy = opt.vy || 0;
    this.life = opt.life || 0.7;
    this.max = this.life;
    this.r = opt.r || 3;
    this.color = opt.color || '#ffffff';
    this.drag = opt.drag === undefined ? 0.90 : opt.drag;
    this.active = true;
  }

  update(dt) {
    this.life -= dt;
    if (this.life <= 0) { this.active = false; return; }
    const k = Math.pow(this.drag, dt * 60);
    this.vx *= k;
    this.vy *= k;
    this.x += this.vx * dt;
    this.y += this.vy * dt;
  }

  draw(ctx) {
    const a = this.life / this.max;
    ctx.globalAlpha = a;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, Math.max(0.4, this.r * a), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

class Pickup {
  constructor() {
    this.active = false;
  }

  /** opt 决定这个道具怎么"飘"：
   *  dir   +1 自上而下 / -1 自下而上
   *  bounce 可反弹次数（飘到底边或顶边翻向飘走）
   *  sway  横向摆幅 px/s（洋流的摆动感）
   *  speed 飘移速度 px/s */
  init(x, y, kind, weapon, opt) {
    opt = opt || {};
    this.x = x;
    this.y = y;
    this.kind = kind;                 // P 火力 / W 武器 / B 保险 / H 生命 / O 僚机
    this.weapon = weapon || 0;        // 仅 W 有效：这把道具固定对应的武器索引
    this.t = 0;
    this.age = 0;
    this.vx = rand(-40, 40);
    this.dir = opt.dir === -1 ? -1 : 1;
    this.speed = opt.speed || 78;
    this.sway = opt.sway || 0;
    this.phase = rand(0, Math.PI * 2);
    this.bounceLeft = opt.bounce || 0;
    this.pop = 0;                     // 反弹瞬间的冲击环计时
    this.active = true;
  }

  update(dt, player) {
    this.t += dt;
    this.age += dt;
    this.y += this.dir * this.speed * dt;
    if (this.sway) this.x += Math.sin(this.age * 2.1 + this.phase) * this.sway * dt;
    this.x += this.vx * dt;
    this.vx *= Math.pow(0.96, dt * 60);

    // 触边反弹：飘到底边（或顶边）翻向飘走，慢一档并侧推一下，
    // 否则会沿着原路线直上直下，看着像卡住
    if (this.bounceLeft > 0) {
      const topEdge = PLAY_TOP + 18;
      const botEdge = VIEW.h - 30;
      if (this.dir > 0 && this.y >= botEdge) {
        this.y = botEdge;
        this.dir = -1;
        this.bounceLeft -= 1;
        this.speed *= 0.78;
        this.vx += rand(-90, 90);
        this.pop = 0.35;
      } else if (this.dir < 0 && this.y <= topEdge) {
        this.y = topEdge;
        this.dir = 1;
        this.bounceLeft -= 1;
        this.speed *= 0.78;
        this.vx += rand(-90, 90);
        this.pop = 0.35;
      }
    }
    if (this.pop > 0) this.pop -= dt;

    // 靠近玩家时磁吸：BOSS 爆一地道具，不该让玩家贴着边角去接
    if (player && player.alive) {
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d < 230 && d > 0.5) {
        const pull = (1 - d / 230) * 560;
        this.x += (dx / d) * pull * dt;
        this.y += (dy / d) * pull * dt;
      }
    }

    this.x = clamp(this.x, 20, VIEW.w - 20);
    // 回收按当前方向判断：反弹后反向飞走的道具才不会一露头就被判出界
    if (this.dir > 0) {
      if (this.y > VIEW.h + 40) this.active = false;
    } else if (this.y < PLAY_TOP - 70) {
      this.active = false;
    }
  }

  draw(ctx) {
    // W 道具用武器自身的颜色，玩家看到粉色就知道是激光，不会“同一个道具变出不同武器”
    const c = this.kind === 'W'
      ? WEAPONS[this.weapon].color
      : (PICKUP_COLORS[this.kind] || '#ffffff');
    const pulse = 1 + Math.sin(this.t * 6) * 0.08;
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(pulse, pulse);
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 26);
    g.addColorStop(0, c);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, 26, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(8,14,22,0.9)';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = c;
    ctx.font = 'bold 13px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(this.kind === 'W' ? WEAPONS[this.weapon].name.charAt(0) : this.kind, 0, 1);
    ctx.restore();

    // 反弹瞬间的冲击环：让"撞到底边被弹回来"这件事看得见
    if (this.pop > 0) {
      const k = 1 - this.pop / 0.35;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - k) * 0.6;
      ctx.strokeStyle = c;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 12 + k * 20, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
}

const PICKUP_COLORS = { P: '#66e0ff', W: '#ffc857', B: '#7dff9e', H: '#ff7a8a', O: '#a8f4ff', R: '#ff8ce0', L: '#b48cff' };

/* ---------------------------------------------------------------- 玩家 */
class Player {
  constructor() {
    this.reset();
  }

  /** 全新一局：等级、武器、保险全部归零 */
  reset() {
    this.lives = PLAYER.lives;
    this.bombs = PLAYER.bombs;
    this.power = PLAYER.startPower;
    this.weapons = [0];              // 武器槽（索引到 WEAPONS），最多 WEAPON_SLOTS 个
    this.slotT = [0];                // 每个槽独立的开火冷却
    this.options = [];               // 全新一局清空僚机
    this.orbits = [];                // 环绕机
    this.orbitBoostT = 0;            // 超额吃 R 的加速剩余时间
    this.lasers = PLAYER.laserBombs; // 激光保险数量
    this.resetStage();
  }

  /** 进入下一关：只重置位置与状态，火力/武器/保险/剩余命数保留 */
  resetStage() {
    this.x = VIEW.w / 2;
    this.y = PLAY_BOTTOM - 80;
    this.canFire = true;             // 结算期关掉，避免空放子弹糊住 UI
    this.boostT = 0;                 // 全弹发射后的射速强化剩余时间
    this.invuln = 2.2;
    this.fireT = 0;
    this.alive = true;
    this.t = 0;
    // 僚机、环绕机跨关保留：只有 reset() 会清空
    if (!this.options) this.options = [];
    if (!this.orbits) this.orbits = [];
    if (!this.weapons) this.weapons = [0];
    this.slotT = this.weapons.map(() => 0);   // 换关清零冷却
    this.shotQ = [];                          // 错峰队列也清空，免得上一关的子弹跨关冒出
    for (const o of this.options) o.slotT = [0.12, 0.26];
  }

  /** 主武器（第一个槽），HUD 与僚机用 */
  get weapon() { return this.weapons[0]; }

  /** 吃 O 道具：加一架僚机；已满则折算分数 */
  addOption(game) {
    if (this.options.length >= PLAYER.maxOptions) {
      // 僚机满员后再吃：折算 800 分 + 短时无敌（当作一个保命道具）
      game.score += 800;
      this.invuln = Math.max(this.invuln, PLAYER.optionInvuln);
      game.onOptionFull(this);
      return false;
    }
    const n = this.options.length;
    this.options.push({
      x: this.x + (n === 0 ? -54 : 54),
      y: this.y + 42,
      slotT: [0.18, 0.30],   // 两个槽错开，避免同时开火糊成一片
      t: 0
    });
    game.onOptionGained(this);
    return true;
  }

  /** 吃 R 道具：加一台环绕机；满两台则转速加快一段时间 + 折算分数 */
  addOrbit(game) {
    if (this.orbits.length >= PLAYER.maxOrbits) {
      this.orbitBoostT = PLAYER.orbitBoostT;
      game.score += 600;
      game.onOrbitFull(this);
      return false;
    }
    // 两台反向旋转。交点位置 = 两台角度的中点（推导：
    //   a1 = a1₀ + ωt，a2 = a2₀ - ωt → 相撞时 a1 = a2 + 2πk，
    //   解得交点角 = (a1₀+a2₀)/2 + πk，即固定在中点、每隔半圈换个方向）。
    // 所以第二台的位置必须按第一台的当前角度反推：a2₀ = 2·mid − a1₀。
    // mid 取 π/2（正下方）→ 交点依次落在下、上、下、上，不会在左右夹住机身。
    const n = this.orbits.length;
    const ang = n === 0 ? 0 : Math.PI - this.orbits[0].ang;
    this.orbits.push({
      ang: ang,
      dir: n === 0 ? 1 : -1,
      t: 0,
      hitT: 0,
      x: this.x,
      y: this.y,
      // 尾焰光点（位置每帧由 _updateOrbits 写入，hit 是"这颗刚挡过子弹"的闪白计时）
      m: PLAYER.orbitTrail.map(() => ({ x: this.x, y: this.y, hit: 0 }))
    });
    game.onOrbitGained(this);
    return true;
  }

  update(dt, input, game) {
    this.t += dt;
    // 阵亡到结算页之间有 1.5 秒空档，这期间不能再开火/开僚机
    if (!this.alive) return;
    if (this.invuln > 0) this.invuln -= dt;

    // 指针拖拽优先（手指 / 鼠标）
    if (input.pointerActive) {
      const tx = input.px;
      const ty = input.py - 58;      // 抬高一截，避免手指遮住机身
      const dx = tx - this.x;
      const dy = ty - this.y;
      const d = Math.hypot(dx, dy);
      const step = 1600 * dt;
      if (d > 0.5) {
        const k = Math.min(1, step / d);
        this.x += dx * k;
        this.y += dy * k;
      }
    }

    let kx = 0, ky = 0;
    if (input.left) kx -= 1;
    if (input.right) kx += 1;
    if (input.up) ky -= 1;
    if (input.down) ky += 1;
    if (kx || ky) {
      const l = Math.hypot(kx, ky);
      this.x += (kx / l) * PLAYER.speed * dt;
      this.y += (ky / l) * PLAYER.speed * dt;
    }

    this.x = clamp(this.x, 28, VIEW.w - 28);
    this.y = clamp(this.y, PLAY_TOP + 40, PLAY_BOTTOM - 6);

    if (this.boostT > 0) this.boostT -= dt;

    // 每个武器槽独立冷却、独立开火
    for (let s2 = 0; s2 < this.weapons.length; s2++) {
      this.slotT[s2] -= dt;
      if (this.slotT[s2] <= 0 && this.canFire) {
        this.fireSlot(game, s2);
        // 射速由武器决定；全弹发射后一段时间内射速提升（见 OVERDRIVE.boostMul）
        this.slotT[s2] = WEAPONS[this.weapons[s2]].cd * (this.boostT > 0 ? OVERDRIVE.boostMul : 1);
      }
    }

    this._flushShots(dt, game);   // 错峰队列：火神炮的后续子弹在这一帧出膛
    this._updateOptions(dt, game);
    this._updateOrbits(dt);
  }

  /** 环绕机：绕机身匀速转；超额吃 R 时短暂加速 */
  _updateOrbits(dt) {
    if (!this.orbits.length) return;
    if (this.orbitBoostT > 0) this.orbitBoostT = Math.max(0, this.orbitBoostT - dt);
    const mul = this.orbitBoostT > 0 ? PLAYER.orbitBoostMul : 1;
    const spin = PLAYER.orbitSpeed * mul;

    for (const o of this.orbits) {
      o.t += dt;
      o.ang += spin * dt * (o.dir || 1);
      o.hitT = Math.max(0, o.hitT - dt);
      // 位置每帧直接跟随机身算：玩家瞬移/跟手拖拽时不会甩尾。
      // 轨道是横椭圆（横 76 / 纵 46），像帝国战机二号机那样左右铺得比上下宽。
      o.x = this.x + Math.cos(o.ang) * PLAYER.orbitRx;
      o.y = this.y + Math.sin(o.ang) * PLAYER.orbitRy;

      // 尾焰：沿椭圆"落后"一段固定弧长。椭圆上角速度恒定、线速度却在
      // 46(左右端)~76(上下端) 之间变化，直接按角度落后会让两粒球一会儿贴近、
      // 一会儿拉开；按切向速度折算后弧长恒定，间距才稳。
      const vt = Math.hypot(PLAYER.orbitRx * Math.sin(o.ang), PLAYER.orbitRy * Math.cos(o.ang));
      const k = PLAYER.orbitRef / (vt || 1);
      // 加速状态下拖得更长一点，和"转速变快"的观感对上
      const stretch = this.orbitBoostT > 0 ? 1.35 : 1;
      for (let i = 0; i < o.m.length; i++) {
        const T = PLAYER.orbitTrail[i];
        const m = o.m[i];
        const a = o.ang - (o.dir || 1) * T.da * k * stretch;
        const rx = PLAYER.orbitRx * T.rr;
        const ry = PLAYER.orbitRy * T.rr;
        m.x = this.x + Math.cos(a) * rx;
        m.y = this.y + Math.sin(a) * ry;
        if (m.hit > 0) m.hit = Math.max(0, m.hit - dt);
      }
    }
  }

  /** 僚机：指数平滑跟随，射速比主机慢 45%、伤害 55%、火力封顶 Lv2 */
  _updateOptions(dt, game) {
    if (!this.options.length) return;
    for (let i = 0; i < this.options.length; i++) {
      const o = this.options[i];
      o.t += dt;

      const tx = this.x + (i === 0 ? -54 : 54);
      const ty = this.y + 42;
      const k = Math.min(1, 7.5 * dt);
      o.x += (tx - o.x) * k;
      o.y += (ty - o.y) * k;

      // 两个武器槽：主槽跟 weapons[0]，副槽跟 weapons[1]（没解锁就只打主槽）
      if (!o.slotT) o.slotT = [0.15, 0.3];
      for (let s2 = 0; s2 < 2; s2++) {
        const wi = this.weapons[s2];
        if (wi === undefined) continue;
        o.slotT[s2] -= dt;
        if (o.slotT[s2] > 0 || !this.canFire) continue;
        // 副槽火力和射速都再压一档，否则两架僚机四个槽会盖过主机
        const mul = s2 === 0 ? 0.55 : 0.40;
        const pow = Math.min(s2 === 0 ? 2 : 1, this.power);
        this.fireFrom(game, o.x, o.y - 18, mul, pow, wi);
        o.slotT[s2] = WEAPONS[wi].cd * (s2 === 0 ? 1.45 : 1.9);
      }
    }
  }

  fire(game) {
    this.fireFrom(game, this.x, this.y - 34, 1);
  }

  /** 按槽位开火：第 2/3 槽左右微偏，伤害按 SLOT_DMG 递减 */
  fireSlot(game, s2) {
    const idx = this.weapons[s2];
    if (idx === undefined) return;
    const off = s2 === 0 ? 0 : (s2 === 1 ? -9 : 9);
    this.fireFrom(game, this.x + off, this.y - 34, SLOT_DMG[s2] || 1, null, idx, s2 > 0);
  }

  /** 错峰发射：把一轮里的后续子弹排进队列，到点才真正出膛。
   *  mul 必须在入队时捕获 —— fireFrom 结束会把 game._shotMul 复位成 1，
   *  等到出膛时再读就变成"主机伤害"了，僚机的 0.55/0.40 折扣会丢。 */
  _queueShot(game, x, y, vx, vy, dmg, opt, delay) {
    if (!this.shotQ) this.shotQ = [];
    this.shotQ.push({
      t: delay, x: x, y: y, vx: vx, vy: vy, dmg: dmg, opt: opt,
      mul: game._shotMul || 1
    });
  }

  /** 每帧推进错峰队列。暂停或阵亡时 update 不跑，队列自然停住，不会漏出子弹 */
  _flushShots(dt, game) {
    if (!this.shotQ || !this.shotQ.length) return;
    for (let i = 0; i < this.shotQ.length;) {
      const s = this.shotQ[i];
      s.t -= dt;
      if (s.t > 0) { i++; continue; }
      const prev = game._shotMul;
      game._shotMul = s.mul;
      game.spawnPlayerBullet(s.x, s.y, s.vx, s.vy, s.dmg, s.opt);
      game._shotMul = prev;
      this.shotQ.splice(i, 1);   // 不 i++：splice 后同位置是下一颗
    }
  }

  /** 从任意位置开火：僚机复用同一套弹道
   *  mul 缩放伤害（僚机 0.55），pow 覆盖火力等级（僚机封顶 Lv2） */
  fireFrom(game, bx, by, mul, pow, wIdx, quiet) {
    const wi = wIdx === undefined ? 0 : wIdx;
    const p = pow || this.power;
    const self = mul === undefined ? 1 : mul;
    game._shotMul = self;

    switch (WEAPONS[wi].id) {
      /* 火神炮：一轮多颗，但**错峰**出膛。
       * 同一帧全吐出来的话，三发会在屏幕上糊成一条粗线，和散射炮的齐射没区别；
       * 按 0.042 秒一颗逐次发射，看起来是连珠，也才立住"持续压制"这个定位。
       * 第一颗仍然立即出膛，保证按键/触屏的响应手感。 */
      case 'vulcan': {
        const gap = this.boostT > 0 ? 0.028 : 0.042;   // 全弹发射的射速强化期，连珠更密
        const shots = p <= 1 ? [[0, 0, 0, -980, 2]]
          : p === 2 ? [[-11, 0, 0, -980, 2], [11, 0, 0, -980, 2]]
            : [[0, -4, 0, -1020, 3], [-15, 8, -120, -980, 2], [15, 8, 120, -980, 2]];
        for (let i = 0; i < shots.length; i++) {
          const s = shots[i];
          if (i === 0) {
            game.spawnPlayerBullet(bx + s[0], by + s[1], s[2], s[3], s[4], { kind: 'player' });
          } else {
            this._queueShot(game, bx + s[0], by + s[1], s[2], s[3], s[4],
              { kind: 'player' }, i * gap);
          }
        }
        break;
      }

      /* 散射炮：一发齐射，扇面同时铺开，但射程只有 0.58 屏高。
       * 速度恒定 780，所以把 life 直接算成 路径长度/速度 ——
       * 这样扇形里每一发的路径长度一致，远端边界会连成一条干净的弧。
       * 单发 2.6（火神炮 2）：射程砍短之后命中窗口变少，靠单发更痛来补偿，
       * 否则多档火力下散弹会彻底被火神炮比下去。 */
      case 'spread': {
        const n = p === 1 ? 3 : p === 2 ? 5 : 7;
        const total = 0.62;
        const life = SPREAD_RANGE / 780;
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 - total / 2 + (i * total) / (n - 1);
          game.spawnPlayerBullet(bx, by, Math.cos(a) * 780, Math.sin(a) * 780, 2.6,
            { kind: 'spread', r: 7, life: life });
        }
        break;
      }

      case 'laser': {
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 13;
          game.spawnPlayerBullet(bx + off, by - 24, 0, -1500, 4,
            { kind: 'laser', pierce: true, r: 10, life: 1.0 });
        }
        break;
      }

      case 'missile': {
        for (let i = 0; i < p; i++) {
          const side = p === 1 ? 0 : (i === 0 ? -1 : i === 1 ? 1 : 0);
          game.spawnPlayerBullet(bx + side * 16, by + 6, side * 170, -560, 4,
            { kind: 'missile', homing: 6.2, r: 8, life: 3.2 });
        }
        break;
      }

      /* 等离子炮：慢速大弹，命中后小范围爆炸 */
      case 'plasma': {
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 22;
          game.spawnPlayerBullet(bx + off, by - 8, off * 1.1, -560, 6,
            { kind: 'plasma', r: 14, life: 2.6, boom: { r: 54, dmg: 4 } });
        }
        break;
      }

      /* 散榴弹：抛到前方固定时间后炸开，碎片向前扇开 */
      case 'flak': {
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 40;
          game.spawnPlayerBullet(bx + off, by, off * 0.55, -620, 4,
            { kind: 'flak', r: 9, life: 2, fuse: 0.78 - i * 0.035 });
        }
        break;
      }

      /* 电弧炮：命中小怪后向邻近目标跳 2 次 */
      case 'tesla': {
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 20;
          game.spawnPlayerBullet(bx + off, by, 0, -760, 3,
            { kind: 'tesla', r: 8, life: 1.5, chain: 2 });
        }
        break;
      }

      /* 逆火炮：前向直射 + 尾部向后扇形，专门应付从下方来的敌人
       * 尾炮出膛速度压到 470：原来 700 时从机尾到屏幕底边只要 0.23 秒，
       * 子弹基本还没飞到敌机身上就出屏了；压慢后在场时间约 0.34 秒，
       * 配合 PLAYER.rearDmgMul 的伤害加成，才打得掉爬上来的 riser。 */
      case 'backfire': {
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 15;
          game.spawnPlayerBullet(bx + off, by, 0, -940, 2, { kind: 'backfire' });
        }
        for (let i = 0; i < p; i++) {
          const a = Math.PI / 2 + (i - (p - 1) / 2) * 0.42;
          game.spawnPlayerBullet(bx, by + 52, Math.cos(a) * 470, Math.sin(a) * 470, 1.5,
            { kind: 'backfire', r: 8, life: 1.5 });
        }
        break;
      }

      /* 环射炮：四/六/八方向同时开火，被包围时能翻盘 */
      case 'omni': {
        const dirs = p === 1 ? 4 : p === 2 ? 6 : 8;
        for (let i = 0; i < dirs; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / dirs;
          game.spawnPlayerBullet(bx, by, Math.cos(a) * 610, Math.sin(a) * 610, 2,
            { kind: 'omni', r: 7, life: 1.35 });
        }
        break;
      }
    }

    game._shotMul = 1;
    if (!quiet && self >= 1) SFX.shoot();
  }

  /** 放激光保险：蓄力 → 向上持续光束；返回 false 表示没得放 */
  useLaser(game) {
    if (!this.alive || this.lasers <= 0) return false;
    if (!game.startLaser()) return false;      // 已经有一条在跑
    this.lasers -= 1;
    this.invuln = Math.max(this.invuln, PLAYER.laserInvuln);
    return true;
  }

  /** 放保险：清屏炸弹 */
  useBomb(game) {
    if (!this.alive || this.bombs <= 0) return false;
    this.bombs -= 1;
    this.invuln = Math.max(this.invuln, PLAYER.bombInvuln);
    game.onBomb(this);
    return true;
  }

  /** 吃到 W 道具：已有则看是否触发全弹发射，没有则占一个空槽 */
  addWeapon(idx, game) {
    idx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    const exist = this.weapons.indexOf(idx);

    if (exist >= 0) {
      if (this.power >= PLAYER.maxPower) {
        this.overdrive(game);        // 满级重复吃同款：全弹发射
        return 'overdrive';
      }
      game.onWeaponDup(this, idx);
      return 'dup';
    }

    if (this.weapons.length < WEAPON_SLOTS) {
      this.weapons.push(idx);
      this.slotT.push(0);
      game.onWeaponAdded(this, idx);
      return 'add';
    }

    // 槽满：挤掉最旧的副武器，主武器不动
    const out = this.weapons[1];
    this.weapons.splice(1, 1);
    this.weapons.push(idx);
    game.onWeaponReplaced(this, out, idx);
    return 'replace';
  }

  /** 调试用：循环切主武器 */
  switchWeapon(game) {
    this.weapons[0] = (this.weapons[0] + 1) % WEAPONS.length;
    this.slotT[0] = 0;
    game.onWeaponChanged(this);
  }

  /** 火力满级后再吃同款武器：按当前主武器打出一轮"超规格"环射 + 短时射速强化
   * 形状表见 config.js 的 OVERDRIVE.shapes：外层快、内层慢，
   * 弹数和单发伤害都远超常规射击，命中时才有"这发不一样"的实感。 */
  overdrive(game) {
    game._shotMul = 1;                 // 不吃僚机 / 副槽的伤害折扣
    const id = WEAPONS[this.weapons[0]].id;
    const layers = OVERDRIVE.shapes[id] || OVERDRIVE.shapes.vulcan;
    for (let L = 0; L < layers.length; L++) {
      const lay = layers[L];
      const rot = lay.rot || 0;
      for (let i = 0; i < lay.n; i++) {
        const a = (i / lay.n) * Math.PI * 2 + rot + rand(-0.03, 0.03);
        game.spawnPlayerBullet(this.x, this.y, Math.cos(a) * lay.sp, Math.sin(a) * lay.sp, lay.dmg, {
          kind: lay.kind || 'player',
          r: lay.r || 9,
          life: OVERDRIVE.life,
          pierce: lay.pierce,
          homing: lay.homing,
          boom: lay.boom,
          chain: lay.chain,
          noRear: true                   // 伤害已按"全弹发射"给足，不再叠后向倍率
        });
      }
    }
    this.boostT = OVERDRIVE.boostT;
    this.invuln = Math.max(this.invuln, 0.9);
    game.onOverdrive(this);
  }

  /** 续关复活：原地满血回来，保留火力/武器/保险 */
  revive() {
    this.alive = true;
    this.lives = CONTINUE.lives;
    // 保险补满：命是续关买的，进来时空着手等于逼玩家再死一次
    this.bombs = PLAYER.maxBombs;
    // 激光保险不补满（6 秒无敌 ×3 太强），只给一颗保底
    this.lasers = Math.max(this.lasers, 1);
    this.invuln = CONTINUE.invuln;
    this.canFire = true;
    this.boostT = 0;
    this.fireT = 0.25;
    this.shotQ = [];              // 阵亡前没发完的连珠子弹不要带进新命
    this.x = VIEW.w / 2;
    this.y = PLAY_BOTTOM - 80;
    this.t = 0;
  }

  hit(game) {
    if (this.invuln > 0 || !this.alive) return false;
    this.lives -= 1;
    this.invuln = PLAYER.invuln;
    // 致命一击不再额外降火力：命都没了，续关回来还得能打
    if (this.lives > 0) this.power = Math.max(1, this.power - 1);
    SFX.playerHit();
    game.shake(18);
    game.explode(this.x, this.y, 1.1, '#7fd6ff', 22);
    if (this.lives <= 0) {
      this.alive = false;
      this.canFire = false;
      game.onPlayerDying();
    }
    return true;
  }

  draw(ctx) {
    if (!this.alive) return;
    const blink = this.invuln > 0 && Math.floor(this.t * 22) % 2 === 0;

    // 引擎尾焰（随机体一起缩小：原 26px 长、±8 宽，比机身还抢眼，也更难看清判定）
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flick = 1 + Math.sin(this.t * 40) * 0.18;
    for (const dx of [-6, 6]) {
      const len = 17 * flick;
      const grd = ctx.createLinearGradient(this.x + dx, this.y + 16, this.x + dx, this.y + 16 + len);
      grd.addColorStop(0, 'rgba(180,250,255,0.95)');
      grd.addColorStop(0.5, 'rgba(90,200,255,0.45)');
      grd.addColorStop(1, 'rgba(40,120,255,0)');
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.moveTo(this.x + dx - 4, this.y + 16);
      ctx.lineTo(this.x + dx + 4, this.y + 16);
      ctx.lineTo(this.x + dx, this.y + 16 + len);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // 绘制时缩到 0.76（52 → 40），素材本身不动：
    // 改素材会重新排布整张图集，坐标一变、缓存没跟上就会全屏错位。
    Assets.draw(ctx, 'player', this.x, this.y, 0.76, blink ? 0.32 : 1);

    // 全弹发射强化状态
    if (this.boostT > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + Math.sin(this.t * 14) * 0.2;
      ctx.strokeStyle = '#ffe38a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 2; i++) {
        const r = 34 + i * 9;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, this.t * 6 + i * 1.6, this.t * 6 + i * 1.6 + 1.9);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 无敌护罩
    if (this.invuln > 0) {
      ctx.save();
      ctx.globalAlpha = 0.25 + Math.sin(this.t * 12) * 0.1;
      ctx.strokeStyle = '#8fe8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this._drawOptions(ctx);
    this._drawOrbits(ctx);
  }

  /** 环绕机：发光小球 + 拖尾，挡弹时闪白 */
  _drawOrbits(ctx) {
    if (!this.orbits.length) return;
    const boost = this.orbitBoostT > 0;

    // 尺寸和僚机保持一致（外发光 30 / 球体 11 / 核心 4.5）：
    // 之前 24/8.5 太小，视觉上像"挂了个装饰"，判定也只有 9，挡弹体感几乎没有
    for (const o of this.orbits) {
      const pulse = 1 + Math.sin(o.t * 12) * 0.08;

      // 尾焰光点：先画，再让主球的光晕盖上来，接缝才自然；
      // 刚挡下子弹的那一颗闪白（m.hit），玩家能看懂"是尾巴挡的"。
      // 不在主球与尾焰之间画弧/连线：那条线看着像"用绳子串着三个球"，
      // 靠尺寸逐级缩小 + 亮度递减已经足够读成尾焰。
      for (let i = 0; i < o.m.length; i++) {
        const m = o.m[i];
        const T = PLAYER.orbitTrail[i];
        const hot = m.hit > 0;
        const gr = T.core * 2.6;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        const gm = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, gr);
        gm.addColorStop(0, hot ? 'rgba(255,255,255,0.9)'
          : (boost ? 'rgba(255,190,255,0.5)' : 'rgba(255,140,220,0.38)'));
        gm.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gm;
        ctx.beginPath();
        ctx.arc(m.x, m.y, gr, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        ctx.fillStyle = hot ? '#ffffff' : (boost ? '#ffe8ff' : '#ffd0f0');
        ctx.beginPath();
        ctx.arc(m.x, m.y, T.core * (hot ? 1.25 : 1), 0, Math.PI * 2);
        ctx.fill();
      }

      // 外发光
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 30);
      g.addColorStop(0, boost ? 'rgba(255,190,255,0.52)' : 'rgba(255,140,220,0.42)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 球体
      ctx.fillStyle = 'rgba(26,10,26,0.92)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 11 * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = boost ? '#ffd0f4' : '#ff8ce0';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 核心
      ctx.fillStyle = boost ? '#ffffff' : '#ffe0f6';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // 与机身的连线（很淡，说明"这是挂在自机上的"）。
      // 轨道改成横椭圆后这条线被拉长到 76px，会横穿机身，
      // 所以透明度再压一档（0.18 → 0.10），只在静止时隐约能看出来。
      ctx.strokeStyle = 'rgba(255,140,220,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
    }
  }

  /** 僚机：发光球体 + 反向旋转弧，无敌、不参与碰撞 */
  _drawOptions(ctx) {
    if (!this.options.length) return;

    for (const o of this.options) {
      // 外发光
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, 30);
      g.addColorStop(0, 'rgba(130,235,255,0.42)');
      g.addColorStop(0.55, 'rgba(70,170,230,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(o.x, o.y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 尾焰
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const len = 12 + Math.sin(o.t * 34) * 3;
      const fg = ctx.createLinearGradient(o.x, o.y + 8, o.x, o.y + 8 + len);
      fg.addColorStop(0, 'rgba(170,245,255,0.85)');
      fg.addColorStop(1, 'rgba(60,150,255,0)');
      ctx.fillStyle = fg;
      ctx.beginPath();
      ctx.moveTo(o.x - 4, o.y + 8);
      ctx.lineTo(o.x + 4, o.y + 8);
      ctx.lineTo(o.x, o.y + 8 + len);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // 球体
      ctx.fillStyle = 'rgba(8,22,32,0.92)';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8fe8ff';
      ctx.lineWidth = 2;
      ctx.stroke();

      // 反向旋转的两段弧
      ctx.strokeStyle = 'rgba(190,246,255,0.9)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 2; i++) {
        const a0 = o.t * 5.2 * (i ? -1 : 1) + i * Math.PI;
        ctx.beginPath();
        ctx.arc(o.x, o.y, 15.5, a0, a0 + 1.35);
        ctx.stroke();
      }

      // 核心
      ctx.fillStyle = '#eafcff';
      ctx.beginPath();
      ctx.arc(o.x, o.y, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/* ---------------------------------------------------------------- 敌机 */
class Enemy {
  constructor() {
    this.active = false;
  }

  init(kind, x, y, opt) {
    opt = opt || {};
    const def = ENEMY_DEFS[kind];
    const sz = Assets.size(def.sprite);
    this.kind = kind;
    this.def = def;
    this.sprite = def.sprite;
    this.w = sz.w;
    this.h = sz.h;
    this.hp = opt.hp || def.hp;
    this.speed = opt.speed || def.speed;
    this.elite = !!opt.elite;
    this.scale = def.scale || 1;
    if (this.elite) {
      this.hp = Math.round(this.hp * ELITE_HP_MUL);
      this.speed *= 0.86;
      this.scale *= 1.22;
    }
    this.maxHp = this.hp;
    this.r = Math.min(sz.w, sz.h) * 0.5 * def.r * this.scale;
    this.ai = def.ai;
    this.x = x;
    this.y = y;
    this.baseX = x;
    this.t = 0;
    this.phase = Math.random() * Math.PI * 2;
    this.fireT = def.fire ? rand(0.7, def.fire) : 999;
    this.locked = false;
    this.vx = 0;
    this.vy = 0;
    this.flash = 0;
    this.rot = 0;
    this.hoverT = 0;
    this.arriveT = 0;
    this.entry = opt.entry || null;   // 'left' / 'right'：从屏幕侧面斜切进入
    this.entryIn = 0;                 // 已经进入视野的时长
    this.rotFix = 0;                  // 入场结束后的姿态回正计时

    // 弧线掠袭：从侧下方沿二次贝塞尔甩到侧上方，穿出屏幕后消失。
    // p0 出生点（侧下方、屏幕外）/ p2 控制点（鼓进屏幕内）/ p1 终点（侧上方、屏幕外）
    // 对角穿越：从左下 → 右上（ltr）或右下 → 左上（rtl），一条斜线横穿屏幕
    this.diag = opt.diag || null;
    if (this.diag) {
      this.dvx = this.diag === 'ltr' ? 218 : -218;
      this.dvy = -282;
    }

    this.arc = !!opt.arc;
    this.arcT = 0;
    this.arcDur = opt.arcDur || 1.45;
    if (this.arc && this.entry) {
      const dir = this.entry === 'left' ? 1 : -1;
      this.p0 = { x: this.x, y: this.y };
      this.p1 = { x: dir > 0 ? -78 : VIEW.w + 78, y: 168 };
      // 控制点横向鼓到屏幕内 190px，纵向取中点稍偏下 → 弧线"先上后回"
      this.p2 = { x: dir > 0 ? 210 : VIEW.w - 210, y: (this.y + 168) * 0.5 + 46 };
    }
    this.summoned = !!opt.summoned;   // BOSS 召唤出来的援军
    this.fromBottom = !!opt.fromBottom;   // 从屏幕底部升起（爬升阶段不参与撞机）
    // 登场无敌只覆盖"还没冒出屏幕边缘"那段，具体秒数按机型配（见 SPAWN_GUARD）
    this.spawnGuard = this.fromBottom ? (SPAWN_GUARD[this.kind] || 1.2) : 0;
    this.centerX = opt.centerX === undefined ? VIEW.w / 2 : opt.centerX;
    this.sweep = opt.sweep === undefined ? 132 : opt.sweep;
    this.chargeState = 0;    // 0 常态 / 1 蓄力 / 2 冲刺 / 3 收尾
    this.chargeT = 0;
    this.cvx = 0;
    this.cvy = 0;
    this.active = true;
  }

  update(dt, game) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.spawnGuard > 0) this.spawnGuard -= dt;

    // 蛇的部件：位置由 game._updateSnake 沿路径统一写入，
    // 这里要跳过 AI 和"越界即销毁"——蛇贴边走，边距判断会误杀它
    if (this.ai === 'snake') return;

    // 对角穿越：恒定速度斜穿屏幕，机头朝速度方向，飞出画面即销号。
    // 不做交棒——它本来就是"从下角窜到上角"的一次性通过。
    if (this.diag) {
      this.x += this.dvx * dt;
      this.y += this.dvy * dt;
      this.rot = Math.atan2(this.dvy, this.dvx) + Math.PI / 2;
      if (this.y < -130 || this.x < -150 || this.x > VIEW.w + 150) this.active = false;
      return;
    }

    // 弧线掠袭：沿贝塞尔曲线从侧下方甩到侧上方，全程不交棒，飞出屏幕即消失。
    // 机头取切线方向，看起来才是"甩"上去而不是平移上去。
    if (this.arc && this.p0) {
      this.arcT += dt;
      const t = Math.min(1, this.arcT / this.arcDur);
      if (t >= 1) {
        this.active = false;      // 终点在屏幕外，直接销号（视觉上已经飞出去了）
        return;
      }
      const it = 1 - t;
      this.x = it * it * this.p0.x + 2 * it * t * this.p2.x + t * t * this.p1.x;
      this.y = it * it * this.p0.y + 2 * it * t * this.p2.y + t * t * this.p1.y;
      const dx = 2 * it * (this.p2.x - this.p0.x) + 2 * t * (this.p1.x - this.p2.x);
      const dy = 2 * it * (this.p2.y - this.p0.y) + 2 * t * (this.p1.y - this.p2.y);
      this.rot = Math.atan2(dy, dx) + Math.PI / 2;
      return;
    }

    // 侧向入场：从屏幕外斜切进来，进入视野满 0.5 秒后交棒给本来的 AI。
    // 机头跟着速度方向转，看起来才是"斜着切进来"而不是平移。
    if (this.entry) {
      const dir = this.entry === 'left' ? 1 : -1;
      const vx = dir * 235;
      // 纵向下压压慢一点（原来 92 + 0.45·speed）：起点抬到上半屏之后，
      // 再按原来的角度俯冲，交棒时已经掉回屏幕中线，等于白抬
      const vy = 70 + this.speed * 0.32;
      this.x += vx * dt;
      this.y += vy * dt;
      this.rot = dir > 0
        ? Math.atan2(vy, vx) + Math.PI / 2
        : -Math.atan2(vy, -vx) - Math.PI / 2;
      if (this.x > 56 && this.x < VIEW.w - 56) this.entryIn += dt;
      if (this.entryIn > 0.5) {
        this.entry = null;
        this.baseX = this.x;    // 交棒：不设的话 x 会弹回出生点（屏幕外）
        this.locked = false;
        this.rotFix = 0.3;      // 用 0.3 秒把姿态转回朝上
      }
      return;
    }

    const p = game.player;

    switch (this.ai) {
      case 'straight':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 1.3 + this.phase) * 9;
        break;

      case 'shooter':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 1.1 + this.phase) * 14;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.y > PLAY_TOP && this.y < VIEW.h * 0.75) {
          this.fireT = this.def.fire;
          this.shoot(game, 'aim');
        }
        break;

      case 'bomber':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.8 + this.phase) * 26;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.y > PLAY_TOP && this.y < VIEW.h * 0.7) {
          this.fireT = this.def.fire;
          this.shoot(game, 'fan3');
        }
        break;

      case 'diver':
        if (this.t < 0.9) {
          this.y += this.speed * 0.45 * dt;
        } else {
          if (!this.locked) {
            this.locked = true;
            const a = Math.atan2(p.y - this.y, p.x - this.x);
            this.vx = Math.cos(a) * 430;
            this.vy = Math.sin(a) * 430;
            this.rot = 0;
          }
          this.x += this.vx * dt;
          this.y += this.vy * dt;
        }
        break;

      case 'drift':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.85 + this.phase) * 95;
        break;

      case 'sine':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 2.4 + this.phase) * 72;
        break;

      case 'hover':
        this.hoverT += dt;
        if (this.y < 210 && this.hoverT < 7) {
          this.y += this.speed * dt;
        } else if (this.hoverT < 10) {
          this.y = 210 + Math.sin(this.t * 1.6) * 10;
          this.x = this.baseX + Math.sin(this.t * 0.8 + this.phase) * 44;
        } else {
          this.y += this.speed * dt;
        }
        this.fireT -= dt;
        if (this.fireT <= 0 && this.y > PLAY_TOP && this.hoverT < 10) {
          this.fireT = this.def.fire;
          this.shoot(game, 'ring');
        }
        break;

      case 'chase':
        this.y += this.speed * 0.75 * dt;
        this.x += clamp(p.x - this.x, -130 * dt, 130 * dt);
        this.x = clamp(this.x, 20, VIEW.w - 20);
        break;

      case 'tank':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.6 + this.phase) * 30;
        break;

      /* 虫子（电鳗）：常态正弦爬行，玩家靠近就蓄力扑上来。
       * 三段：0 爬行 → 1 蓄力 0.42s（原地抖动，给反应窗口）→ 2 直冲 1s */
      case 'worm': {
        if (this.chargeState === 0) {
          this.y += this.speed * dt;
          this.x = this.baseX + Math.sin(this.t * 2.2 + this.phase) * 62;
          const d = Math.hypot(p.x - this.x, p.y - this.y);
          if (d < (this.def.diveR || 150) && this.y > PLAY_TOP + 40 && p.alive) {
            this.chargeState = 1;
            this.chargeT = 0.42;
          }
        } else if (this.chargeState === 1) {
          this.chargeT -= dt;
          this.x += Math.sin(this.t * 58) * 1.5;          // 抖动
          this.y += this.speed * 0.22 * dt;
          this.rot = Math.atan2(p.y - this.y, p.x - this.x) - Math.PI;
          if (this.chargeT <= 0) {
            this.chargeState = 2;
            this.chargeT = 1.0;
            const a = Math.atan2(p.y - this.y, p.x - this.x);
            const sp = this.def.diveSpeed || 430;
            this.cvx = Math.cos(a) * sp;
            this.cvy = Math.sin(a) * sp;
          }
        } else if (this.chargeState === 2) {
          this.chargeT -= dt;
          this.x += this.cvx * dt;
          this.y += this.cvy * dt;
          this.rot = Math.atan2(this.cvy, this.cvx) - Math.PI;
          this.x = clamp(this.x, 16, VIEW.w - 16);
          if (this.chargeT <= 0) {
            this.chargeState = 3;
            this.rot = 0;
            this.baseX = this.x;
          }
        } else {
          this.y += this.speed * 1.4 * dt;                // 冲完继续下坠离场
        }
        break;
      }

      case 'kamikaze':
        if (this.t < 0.55) {
          this.y += this.speed * 0.5 * dt;
        } else {
          const a = Math.atan2(p.y - this.y, p.x - this.x);
          this.vx += Math.cos(a) * 300 * dt;
          this.vy += Math.sin(a) * 300 * dt;
          const sp = Math.hypot(this.vx, this.vy);
          const max = this.speed * 1.9;
          if (sp > max) { this.vx *= max / sp; this.vy *= max / sp; }
          this.x += this.vx * dt;
          this.y += this.vy * dt;
        }
        break;

      case 'mirror': {
        // 镜像玩家 x，但保留 35% 的编队偏移——否则整队 mirror 会叠成一条竖线
        const target = VIEW.w - p.x + (this.baseX - VIEW.w / 2) * 0.35;
        this.x += (target - this.x) * Math.min(1, 3.0 * dt);
        this.y += this.speed * dt;
        break;
      }

      case 'heavy':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.5 + this.phase) * 22;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.y > PLAY_TOP && this.y < VIEW.h * 0.8) {
          this.fireT = this.def.fire;
          this.shoot(game, 'aim2');
        }
        break;

      // 落到底部调头向上，边爬升边追着玩家打
      case 'looper':
        if (!this.turned) {
          this.y += this.speed * dt;
          if (this.y > VIEW.h * 0.70) {
            this.turned = true;
            this.rot = Math.PI;             // 机头转向上
          }
        } else {
          this.y -= this.speed * 1.08 * dt;
          this.x += clamp(p.x - this.x, -150 * dt, 150 * dt) * 1.3;
          this.fireT -= dt;
          if (this.fireT <= 0 && this.y > 90) {
            this.fireT = this.def.fire;
            this.shoot(game, 'aim');
          }
        }
        break;

      // 从屏幕底部升起，边上升边射击
      case 'riser':
        this.rot = Math.PI;
        this.y -= this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 1.5 + this.phase) * 26;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.y < VIEW.h - 70) {
          this.fireT = this.def.fire;
          this.shoot(game, 'aim');
        }
        break;

      // 中型机：底部升到顶部后开始巡游 + 三向散射
      case 'miniboss':
        if (this.y > 216) {
          // 掉头用 0.45 秒旋转过渡：原先到顶那一帧 π → 0 直接翻转，看着很生硬
          const TURN_DUR = 0.55;
          const turnY = 216 + 220 * TURN_DUR;
          if (this.y > turnY) {
            this.rot = Math.PI;
          } else {
            // 线性匀速翻转：easeOut 开头太陡（70ms 能跳 80°），看着像闪一下
            const k = clamp((turnY - this.y) / (turnY - 216), 0, 1);
            this.rot = Math.PI * (1 - k);
          }
          this.y -= 220 * dt;               // 固定爬升速度，别让大个子慢吞吞挪上来
          // 爬升期间同步横向靠拢目标车道。
          // 到位那一帧才赋 x 的话，174 → 115 会横向瞬移 59px（看起来像跳了一下）。
          this.x += (this.centerX - this.x) * Math.min(1, 3.2 * dt);
          if (this.y <= 216) {
            this.y = 216;
            this.rot = 0;
            this.arriveT = this.t;          // 到位时刻，巡游相位从这里归零
            this.x = this.centerX;          // 此时已经收敛，赋值只是消除浮点误差
          }
        } else {
          const mt = this.t - this.arriveT;
          this.y = 216 + Math.sin(mt * 1.3) * 8;
          this.x = this.centerX + Math.sin(mt * 0.62) * this.sweep;
          this.fireT -= dt;
          if (this.fireT <= 0) {
            this.fireT = this.def.fire;
            this.shoot(game, 'fan5');
          }
        }
        break;
    }

    // 侧向入场结束后把机身姿态平滑转回朝上（0.3 秒内），避免"啪"地一下转过来
    if (this.rotFix > 0) {
      this.rotFix -= dt;
      this.rot *= 0.86;
      if (this.rotFix <= 0) this.rot = 0;
    }

    if (this.y > VIEW.h + 150 || this.y < -180 || this.x < -150 || this.x > VIEW.w + 150) {
      this.active = false;
    }
  }

  shoot(game, mode) {
    const p = game.player;
    if (!p || !p.alive) return;
    const ang = Math.atan2(p.y - this.y, p.x - this.x);
    const bx = this.x, by = this.y + this.h * 0.22;
    if (mode === 'aim') {
      game.spawnEnemyBullet(bx, by, Math.cos(ang) * 235, Math.sin(ang) * 235);
      SFX.enemyShoot();
    } else if (mode === 'aim2') {
      for (const off of [-16, 16]) {
        game.spawnEnemyBullet(bx + off, by, Math.cos(ang) * 250, Math.sin(ang) * 250);
      }
      SFX.enemyShoot();
    } else if (mode === 'fan3') {
      for (let i = -1; i <= 1; i++) {
        const a = ang + i * 0.30;
        game.spawnEnemyBullet(bx, by, Math.cos(a) * 195, Math.sin(a) * 195);
      }
      SFX.enemyShoot();
    } else if (mode === 'fan5') {
      for (let i = -2; i <= 2; i++) {
        const a = ang + i * 0.17;
        game.spawnEnemyBullet(bx, by, Math.cos(a) * 215, Math.sin(a) * 215,
          { kind: i % 2 ? 'enemyAlt' : 'enemy' });
      }
      SFX.enemyShoot();
    } else if (mode === 'ring') {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + this.t * 0.6;
        game.spawnEnemyBullet(bx, by, Math.cos(a) * 150, Math.sin(a) * 150, { kind: 'enemyAlt' });
      }
      SFX.enemyShoot();
    }
  }

  hit(dmg, bullet, game) {
    if (this.spawnGuard > 0) return;   // 登场保护期内免疫
    // 护盾机：从下方打过来的子弹（正面）只吃 15% 伤害
    if (this.kind === 'shield' && bullet && bullet.y > this.y + this.h * 0.12) {
      dmg *= 0.15;
      game.addParticle(this.x, this.y + this.h * 0.28, {
        vx: rand(-40, 40), vy: rand(-60, -20), life: 0.3, r: 5, color: '#c9a6ff'
      });
    }
    this.hp -= dmg;
    this.flash = 0.08;
    if (this.hp <= 0) {
      this.active = false;
      game.onEnemyKilled(this);
      return true;
    }
    return false;
  }

  draw(ctx) {
    // 蛇由 game._drawSnake 整体绘制（要画成连续的一条，不能一节一个精灵）
    if (this.snakeLink) return;
    const s = this.scale;

    // 精英光环：让玩家一眼认出“这个不一样”
    if (this.elite) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.40 + Math.sin(this.t * 5) * 0.16;
      ctx.strokeStyle = '#ffd166';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.45, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 3; i++) {
        const a0 = this.t * 2.2 + i * Math.PI * 2 / 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.r * 1.45, a0, a0 + 0.45);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 俯冲蓄力：红色收缩圈，明确告诉玩家"它要扑了"
    if (this.chargeState === 1) {
      const k = 1 - this.chargeT / 0.42;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + k * 0.4;
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * (2.4 - k * 0.9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 登场保护：青色护罩 + 呼吸
    if (this.spawnGuard > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.30 + Math.sin(this.t * 10) * 0.12;
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 2.0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    Assets.draw(ctx, this.sprite, this.x, this.y, s, 1, this.rot);
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      Assets.draw(ctx, this.sprite, this.x, this.y, s, 0.55);
      ctx.restore();
    }

    // 血条：坦型掉血后显示；精英和中型机常驻显示（多只同屏时要能分辨进度）
    // 阈值 35：3.3.0 血量上调后小机也有 5~16 血，全都画会糊成一片。
    // 只留给 bomber(52) / jelly(38) / shield(38) / heavy(155) 这类真需要看进度的单位，
    // eel(34) / mineH(34) 正好卡在下面。
    const showBar = this.kind === 'miniboss'
      ? this.y > PLAY_TOP + 12
      : ((this.maxHp >= 35 || this.elite) && this.hp < this.maxHp && this.y > PLAY_TOP + 12);
    if (showBar) {
      const w = Math.min(60, this.w * s * 0.82);   // 大型单位限宽，否则会横穿半个屏幕
      const x = this.x - w / 2;
      const y = this.y - this.h * s * 0.5 - 7;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(x - 1, y - 1, w + 2, 5);
      ctx.fillStyle = this.elite ? '#ffd166' : '#ff6b6b';
      ctx.fillRect(x, y, w * (this.hp / this.maxHp), 3);
    }
  }
}

/* ---------------------------------------------------------------- BOSS */
class Boss {
  constructor() {
    this.active = false;
  }

  init(stage) {
    this.stage = stage;
    this.sprite = stage.boss;
    this.name = stage.bossName;
    this.maxHp = stage.bossHp;
    this.hp = this.maxHp;
    this.x = VIEW.w / 2;
    this.y = -200;
    this.enterP = 0;      // 入场进度 0→1
    this.enterT = 0;      // 入场结束时刻
    this.swayT = 0;       // 巡游相位累加器：冻结期间不推进，避免解锁瞬间 x 跳回
    this.t = 0;
    this.phase = 0;
    this.enter = true;
    this.fireT = 1.4;
    this.supportT = 6.0;     // 入场后 6 秒第一次呼叫支援
    this.ang = 0;
    this.lungeX = 0;        // 钳击的横向偏移（叠加在巡游基座上）
    this.lungeTarget = 0;
    this.lungeHold = 0;     // 冲到位置后保持的时间
    this.lungeCd = 0;       // 钳击冷却

    // 专属机制
    const tr = (typeof BOSS_TRAITS !== 'undefined' && BOSS_TRAITS[stage.boss]) || {};

    // 蓄力激光
    this.laserCfg = tr.laser || null;
    this.laserState = 0;     // 0 空闲 / 1 蓄力 / 2 发射
    this.laserT = 0;
    this.laserAng = Math.PI / 2;
    this.laserAnchorX = undefined;
    this.laserCd = this.laserCfg ? this.laserCfg.cd * 0.55 : 0;

    // 护盾轮转
    this.shieldCfg = !!tr.shield;
    this.shieldPhase = 1;        // 0 右 / 1 下 / 2 左 / 3 上
    this.shieldT = 0;
    this.shieldFlash = 0;

    // 浮游炮：数量与血量都由 BOSS_TRAITS 给，血量按最大血量分摊
    const dr = tr.drones;
    const dCount = typeof dr === 'number' ? dr : (dr ? dr.count : 0);
    const dRatio = (dr && dr.ratio) || 0.5;
    const dHp = dCount ? Math.round(this.maxHp * dRatio / dCount) : 0;
    this.drones = dCount ? Array.from({ length: dCount }, (_, i) => {
      const baseAng = Math.PI / 2 + (i - (dCount - 1) / 2) * 0.54;
      return {
        baseAng: baseAng,
        ang: baseAng,
        r: 182, hp: dHp, maxHp: dHp, alive: true,
        fireT: 1.6 + i * 0.7, flash: 0
      };
    }) : [];

    // 镜像武器 / 弹幕墙 / 引力场
    this.mirrorCfg = !!tr.mirror;
    this.mirrorT = 5.0;
    this.wallCfg = !!tr.wall;
    this.wallT = 3.0;
    this.wallAng = 0;
    this.wallPhase = 0;
    this.gravityCfg = !!tr.gravity;
    this.gravityT = 9.0;
    this.gravityOn = 0;
    this.gravityR = 0;

    // 双栅栏（限制玩家活动范围）
    this.fenceCfg = !!tr.fence;
    this.fenceOn = 0;
    this.fenceCd = 10.5;
    this.fenceX = 40;

    // 中央弹幕束
    this.centerCfg = !!tr.center;
    this.centerCd = 15;
    this.centerDur = 0;
    this.centerAng = 0;
    this.centerFireT = 0;
    this.centerFromX = VIEW.w / 2;
    this.centerFromY = 232;

    // 分裂
    this.splitAt = tr.splitAt || 0;
    this.splitCount = tr.splitCount || 2;
    this.splitDone = false;


    this.dive = !!tr.dive;
    this.diveCd = tr.diveCd || 8.5;
    this.diveT = this.diveCd;
    this.summonAt = tr.summonAt || 0;
    this.summonCount = tr.summonCount || 0;
    this.summoned = false;
    this.retreatT = 0;
    this.finalPhase = false;
    this.mode = 'idle';          // idle | aim | dive | retreat | return
    this.modeT = 0;
    // 出场无敌：整段入场 + 到位后 0.6 秒都打不到
    this.invuln = true;
    this.guardT = 3.4;
    this.diveVY = 0;
    this.diveTX = VIEW.w / 2;

    // 可破坏的两侧武器
    const pd = (typeof BOSS_PARTS !== 'undefined' && BOSS_PARTS[stage.boss]) || null;
    if (pd) {
      const each = Math.round(this.maxHp * (pd.ratio || 0.5) / pd.items.length);
      this.parts = pd.items.map(q => ({
        dx: q.dx, dy: q.dy, r: q.r, hp: each, maxHp: each, alive: true, flash: 0
      }));
    } else {
      this.parts = [];
    }
    this.flash = 0;
    this.dead = false;
    this.deathT = 0;

    // 自身抖动（替代全局震屏）：只改绘制偏移，不动 this.x/this.y，
    // 所以判定、弹幕出膛点、激光瞄准全都不受影响。
    this.jx = 0;
    this.jy = 0;
    this.jitterT = 0;
    this.jitterAmp = 0;
    this.jitterDur = 0.36;

    const sz = Assets.size(this.sprite);
    this.w = sz.w;
    this.h = sz.h;
    this.active = true;
  }

  /** 机身震颤：amp 沿用原 game.shake 的量级，内部换算成像素偏移 */
  jitter(amp) {
    this.jitterAmp = Math.max(this.jitterAmp, amp * 0.34);
    this.jitterT = this.jitterDur;
  }

  update(dt, game) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;

    // 机身震颤：平方衰减，前几帧最猛，0.36 秒内收干净
    if (this.jitterT > 0) {
      this.jitterT = Math.max(0, this.jitterT - dt);
      const k = this.jitterT / this.jitterDur;
      const a = this.jitterAmp * k * k;
      this.jx = rand(-a, a);
      this.jy = rand(-a, a);
      if (this.jitterT === 0) this.jitterAmp = 0;
    } else if (this.jx || this.jy) {
      this.jx = 0;
      this.jy = 0;
    }

    if (this.dead) {
      this.deathT -= dt;
      if (this.deathT <= 0) {
        this.active = false;
        game.onBossKilled(this);
      }
      return;
    }

    if (this.enter) {
      // 缓入下降 + 轻微摆头（摆幅随进度收敛到 0，结束时正好对齐中心，不会“瞬移”到侧面）
      this.enterP = Math.min(1, this.enterP + dt / 2.8);
      const p = easeOut(this.enterP);
      this.y = -200 + (232 + 200) * p;
      this.x = VIEW.w / 2 + Math.sin(this.t * 2.1) * 16 * (1 - p);
      if (this.enterP >= 1) {
        this.enter = false;
        this.enterT = this.t;
        this.y = 232;
        this.x = VIEW.w / 2;
        this.guardT = 0.6;      // 到位后再给 0.6 秒缓冲
        this.invuln = this.guardT > 0;
      }
      return;
    }

    // 出场保护：没走完就一直无敌
    if (this.guardT > 0) {
      this.guardT -= dt;
      if (this.guardT <= 0 && this.mode === 'idle') this.invuln = false;
    }

    // 特种模式：瞄准 → 俯冲 / 退场 → 归位
    if (this.mode !== 'idle') {
      if (this.laserState > 0) {   // 切模式时立刻收束激光，避免卡在蓄力
        this.laserState = 0;
        this.laserCd = Math.max(this.laserCd, 2.5);
      }
      this._special(dt, game);
      return;
    }

    this._updateLaser(dt, game);

    // 钳击位移：0.18s 快速侧移到位 → 保持 0.45s → 缓动回位
    // 不能直接改 x（巡游每帧会覆盖），否则表现为“闪一下又弹回原位”
    if (this.lungeHold > 0) {
      this.lungeHold -= dt;
      if (this.lungeHold <= 0) this.lungeTarget = 0;
    }
    if (this.lungeCd > 0) this.lungeCd -= dt;
    const lk = this.lungeTarget !== 0 ? 13 : 4.2;      // 出击快、回收慢
    this.lungeX += (this.lungeTarget - this.lungeX) * Math.min(1, lk * dt);

    // 巡游相位用独立的 swayT：激光锁定期间不推进，解锁后从同一位置继续。
    // 之前用 this.t - enterT，冻结 2.3 秒再解锁，x 会瞬间跳回"本该在的位置"。
    if (this.laserState < 1.5) this.swayT += dt;
    const sway = Math.sin(this.swayT * 0.5) * 100;      // 幅度要小于 半屏宽−BOSS半宽，否则会被裁切
    this.x = clamp(VIEW.w / 2 + sway + this.lungeX, this.w * 0.5 + 6, VIEW.w - this.w * 0.5 - 6);
    this.y = 232 + Math.sin(this.swayT * 0.9) * 12;
    // 锁定与发射期间本体停在原地：否则 2.3 秒内巡游 115px，光束会跟着扫，
    // 玩家按“锁定时的位置”躲避反而会被扫到
    if (this.laserState >= 1.5 && this.laserAnchorX !== undefined) {
      this.x = this.laserAnchorX;
    }

    this._updateGimmicks(dt, game);

    // 阶段阈值由关卡配置：默认 3 段（66% / 33%），boss9 配 5 段
    const pct = this.hp / this.maxHp;
    const cuts = this.stage.phaseCuts || [0.66, 0.33];
    let ph = 0;
    for (let i = 0; i < cuts.length; i++) {
      if (pct <= cuts[i]) ph = i + 1;
    }
    if (this.finalPhase) ph = cuts.length;
    if (ph !== this.phase) {
      this.phase = ph;
      game.onBossPhase(this);
    }

    // 分裂型：血量到阈值 → 退场，分裂成两个分身
    if (this.splitAt && !this.splitDone && pct <= this.splitAt) {
      this.splitDone = true;
      this.mode = 'retreat';
      this.retreatT = 0;
      this.invuln = true;
      game.summonSplits(this, this.splitCount);
      game.onBossSplit(this);
      return;
    }

    // 召唤型：血量到阈值 → 退到幕后，叫援军
    if (this.summonAt && !this.summoned && pct <= this.summonAt) {
      this.summoned = true;
      this.mode = 'retreat';
      this.retreatT = 0;
      this.invuln = true;
      this.fenceOn = 0;          // 退场时收掉栅栏，否则玩家被夹在墙里清分身
      this.fenceCd = 9;
      game.summonBossMinions(this, this.summonCount);
      game.onBossSummon(this);
      return;
    }

    // 俯冲型：定时瞄准 → 冲向玩家
    if (this.dive) {
      this.diveT -= dt;
      if (this.diveT <= 0) {
        this.mode = 'aim';
        this.modeT = 0.85;
        return;
      }
    }

    this.fireT -= dt;
    if (this.fireT <= 0) {
      const pattern = BOSS_PATTERNS[this.sprite];
      const cd = pattern ? pattern(this, game) : 1.2;
      this.fireT = cd * 0.9;              // 整体提频 10%，配合血量提升
    }

    // 会呼叫支援的 BOSS
    if (this.stage.support) {
      this.supportT -= dt;
      if (this.supportT <= 0) {
        this.supportT = 10.5;
        game.callBossSupport(this);
      }
    }
  }

  /** 护盾轮转 / 浮游炮 / 镜像武器 / 弹幕墙 / 引力场 */
  _updateGimmicks(dt, game) {
    const p = game.player;

    // 护盾轮转：每 2.4 秒转一格
    if (this.shieldCfg) {
      this.shieldT += dt;
      if (this.shieldT >= 2.4) {
        this.shieldT -= 2.4;
        this.shieldPhase = (this.shieldPhase + 1) % 4;
      }
      if (this.shieldFlash > 0) this.shieldFlash -= dt;
    }

    // 浮游炮：每座围绕自己的 baseAng 小幅摆动，四座不会挤在一起
    let di = 0;
    for (const d of this.drones) {
      const idx = di++;
      if (!d.alive) continue;
      d.ang = d.baseAng + Math.sin(this.t * 0.75 + idx * 1.7) * 0.16;
      if (d.flash > 0) d.flash -= dt;
      d.fireT -= dt;
      if (d.fireT <= 0 && p.alive) {
        d.fireT = 2.4;
        const px = clamp(this.x + Math.cos(d.ang) * d.r, 36, VIEW.w - 36);
        const py = this.y + Math.sin(d.ang) * d.r;
        const a = Math.atan2(p.y - py, p.x - px);
        game.spawnEnemyBullet(px, py, Math.cos(a) * 235, Math.sin(a) * 235,
          { kind: 'big', r: 12 });
        SFX.enemyShoot();
      }
    }

    // 镜像武器：照着你当前的主武器打回来
    if (this.mirrorCfg) {
      this.mirrorT -= dt;
      if (this.mirrorT <= 0 && p.alive) {
        this.mirrorT = 6.5;
        game.bossMirrorShot(this);
      }
    }

    // 双栅栏：从两侧向中间收，把活动范围压到 300px 以内
    if (this.fenceCfg) {
      if (this.fenceOn > 0) {
        this.fenceOn -= dt;
        this.fenceX += (130 - this.fenceX) * Math.min(1, 1.5 * dt);
      } else {
        this.fenceCd -= dt;
        if (this.fenceCd <= 0 && p.alive) {
          this.fenceCd = 17;
          this.fenceOn = 6.5;
          this.fenceX = 40;
          game.onBossFence(this);
        }
      }
    }

    // 中央弹幕束：移到屏幕中央持续喷螺旋，逼玩家绕着飞
    if (this.centerCfg && this.mode === 'idle' && !this.splitDone && this.fenceOn <= 0) {
      this.centerCd -= dt;
      if (this.centerCd <= 0 && p.alive) {
        this.centerCd = 23;
        this.mode = 'center';
        this.centerDur = 5.4;
        this.modeT = 5.4;
        this.centerFromX = this.x;
        this.centerFromY = this.y;
        this.centerFireT = 0.35;
        game.onBossCenter(this);
      }
    }

    // 弹幕墙：整圈密排，留一个缓慢旋转的缺口
    if (this.wallCfg) {
      this.wallT -= dt;
      if (this.wallT <= 0) {
        this.wallT = 1.35;
        game.bossWall(this);
      }
    }

    // 引力场：持续把玩家往本体方向拽。
    // 激光锁定/发射期间暂停施力，否则玩家被吸着走，按锁定位置躲不掉
    if (this.gravityCfg && this.laserState < 1.5) {
      if (this.gravityOn > 0) {
        this.gravityOn -= dt;
        this.gravityR = 300 * (1 - Math.max(0, this.gravityOn) / 3.2);
        if (p.alive) {
          const dx = this.x - p.x;
          const dy = this.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          if (d > 2) {
            p.x += (dx / d) * 132 * dt;
            p.y += (dy / d) * 132 * dt;
            p.x = clamp(p.x, 28, VIEW.w - 28);
            p.y = clamp(p.y, PLAY_TOP + 40, PLAY_BOTTOM - 6);
          }
        }
      } else {
        this.gravityT -= dt;
        if (this.gravityT <= 0) {
          this.gravityT = 13;
          this.gravityOn = 3.2;
        }
      }
    }
  }

  /** 激光：蓄力时缓慢跟随玩家，开火瞬间锁定方向 */
  _updateLaser(dt, game) {
    const cfg = this.laserCfg;
    if (!cfg) return;
    const p = game.player;

    if (this.laserState === 0) {
      this.laserCd -= dt;
      if (this.laserCd <= 0 && p.alive) {
        this.laserState = 1;
        this.laserT = cfg.charge;
        this.laserAng = Math.atan2(p.y - this.y, p.x - this.x);
        game.onBossLaserCharge(this);
      }
      return;
    }

    if (this.laserState === 1) {
      this.laserT -= dt;
      // 蓄力期间缓慢跟随：速率由 cfg.track 决定（默认 0.5 rad/s）。
      // 原来的 1.15 rad/s 在 1.1 秒内能转 72°，玩家怎么跑都会被咬住。
      const want = Math.atan2(p.y - this.y, p.x - this.x);
      let diff = want - this.laserAng;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      const rate = cfg.track === undefined ? 0.5 : cfg.track;
      this.laserAng += clamp(diff, -rate * dt, rate * dt);
      if (this.laserT <= 0) {
        // 进入锁定：方向冻结，留出 cfg.lock 秒的反应窗口再发射
        this.laserState = 1.5;
        this.laserT = cfg.lock === undefined ? 0.8 : cfg.lock;
        this.laserAnchorX = this.x;    // 锁定期间本体不再巡游，光束才不会跟着扫
        game.onBossLaserLock(this);
      }
      return;
    }

    if (this.laserState === 1.5) {
      this.laserT -= dt;
      if (this.laserT <= 0) {
        this.laserState = 2;
        this.laserT = cfg.fire;
        game.onBossLaserFire(this);
      }
      return;
    }

    this.laserT -= dt;
    if (this.laserT <= 0) {
      this.laserState = 0;
      this.laserCd = cfg.cd;
    }
  }

  /** 瞄准 / 俯冲 / 退场 / 归位 四种特殊状态的推进 */
  _special(dt, game) {
    const p = game.player;

    if (this.mode === 'aim') {
      this.modeT -= dt;
      this.y = 232 - (1 - Math.max(0, this.modeT) / 0.85) * 26;   // 后仰蓄力
      if (this.modeT <= 0) {
        this.mode = 'dive';
        this.diveVY = 260;
        this.diveTX = game.player.x;
        SFX.enemyShoot();
      }
      return;
    }

    if (this.mode === 'dive') {
      this.diveVY += 1500 * dt;
      this.y += this.diveVY * dt;
      this.x += (this.diveTX - this.x) * Math.min(1, 3 * dt);
      if (this.y > VIEW.h + 220) {
        this.y = -240;
        this.x = VIEW.w / 2;
        this.mode = 'return';
        this.modeT = 0.9;
      }
      return;
    }

    if (this.mode === 'return') {
      this.modeT -= dt;
      const k = easeOut(clamp(1 - this.modeT / 0.9, 0, 1));
      this.y = -240 + (232 + 240) * k;
      if (this.modeT <= 0) {
        this.y = 232;
        this.x = VIEW.w / 2;
        this.swayT = 0;        // 相位归零：巡游从 sin(0)=0 接上，x 不会跳
        this.mode = 'idle';
        this.diveT = this.diveCd;
        this.fireT = 0.8;
      }
      return;
    }

    if (this.mode === 'center') {
      this.modeT -= dt;
      const el = this.centerDur - this.modeT;
      if (el < 0.6) {
        // 0.6 秒移到中央
        const k = easeOut(el / 0.6);
        this.x = this.centerFromX + (VIEW.w / 2 - this.centerFromX) * k;
        this.y = this.centerFromY + (380 - this.centerFromY) * k;
      } else if (this.modeT > 0.6) {
        // 4.2 秒驻留：四向螺旋，每 0.12s 转 0.30 rad
        this.x = VIEW.w / 2;
        this.y = 380;
        this.centerFireT -= dt;
        if (this.centerFireT <= 0) {
          this.centerFireT = 0.12;
          this.centerAng += 0.30;
          this.centerShot = (this.centerShot || 0) + 1;
          for (let i = 0; i < 4; i++) {
            const a = this.centerAng + i * Math.PI / 2;
            game.spawnEnemyBullet(this.x, this.y, Math.cos(a) * 212, Math.sin(a) * 212,
              { kind: 'enemyAlt' });
          }
          // 每 4 轮补一组瞄准弹：否则玩家只要蹲在正下方就安全
          if (this.centerShot % 4 === 0 && p.alive) {
            const aim = Math.atan2(p.y - this.y, p.x - this.x);
            for (const off of [-0.10, 0.10]) {
              game.spawnEnemyBullet(this.x, this.y,
                Math.cos(aim + off) * 305, Math.sin(aim + off) * 305,
                { kind: 'big', r: 10 });
            }
          }
        }
      } else {
        // 最后 0.6 秒回到巡游高度，x 留在中央（swayT 归零后正好对齐）
        const k = easeOut(1 - Math.max(0, this.modeT) / 0.6);
        this.x = VIEW.w / 2;
        this.y = 380 + (232 - 380) * k;
      }
      if (this.modeT <= 0) {
        this.mode = 'idle';
        this.x = VIEW.w / 2;
        this.y = 232;
        this.swayT = 0;
        this.fireT = 0.7;
      }
      return;
    }

    if (this.mode === 'retreat') {
      this.retreatT += dt;
      this.y = Math.max(-260, this.y - 330 * dt);
      if (this.y <= -260) {
        this.x = VIEW.w / 2;
        // 援军清完就回归；万一卡住（援军飞出屏幕等），15 秒后强制回归
        if (!game.hasSummonedMinions() || this.retreatT > 15) {
          this.mode = 'return';
          this.modeT = 0.9;
          this.invuln = false;
          this.finalPhase = true;  // 现身直接锁定最终阶段
          this.phase = (this.stage.phaseCuts || [0.66, 0.33]).length;
        }
      }
      return;
    }
  }

  /** 钳击：向指定 x 侧移一段（限量 + 限速，走出动画而不是瞬移） */
  lunge(tx, opts) {
    if (this.lungeCd > 0) return false;
    opts = opts || {};
    const base = VIEW.w / 2 + Math.sin((this.t - this.enterT) * 0.5) * 100;
    const maxOff = this.w * 0.5 > VIEW.w * 0.5 ? 60 : 90;
    const off = clamp(tx - base, -maxOff, maxOff);
    this.lungeTarget = off;
    this.lungeHold = opts.hold === undefined ? 0.45 : opts.hold;
    this.lungeCd = opts.cd === undefined ? 3.4 : opts.cd;
    this.lungeBurst = !!opts.burst;
    return true;
  }

  /** 二阶段重置：把已摧毁的浮游炮复活一部分（血量 70%） */
  restoreDrones(frac) {
    const dead = this.drones.filter(d => !d.alive);
    if (!dead.length) return 0;
    const n = Math.max(1, Math.ceil(dead.length * (frac === undefined ? 0.6 : frac)));
    for (let i = 0; i < n; i++) {
      const d = dead[i];
      d.alive = true;
      d.hp = Math.round(d.maxHp * 0.7);
      d.fireT = 1.2 + i * 0.5;
      d.flash = 0.2;
    }
    return n;
  }

  partsAlive() {
    let n = 0;
    for (const pt of this.parts) if (pt.alive) n++;
    return n;
  }

  hit(dmg, game) {
    if (this.dead) return;

    // 护盾轮转：只有弱点那半圈能打满伤害，其余方向大幅减免
    if (this.shieldCfg && game && game.player) {
      const a = Math.atan2(game.player.y - this.y, game.player.x - this.x);
      let quad = Math.round(a / (Math.PI / 2));
      quad = ((quad % 4) + 4) % 4;
      if (quad !== this.shieldPhase && quad !== (this.shieldPhase + 1) % 4) {
        dmg *= 0.28;
        this.shieldFlash = 0.18;
      }
    }

    this.hp -= dmg;
    this.flash = 0.06;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deathT = 1.8;
      game.onBossDying(this);
    }
  }

  /** 护盾轮转 / 浮游炮 / 引力场的绘制 */
  _drawGimmickFx(ctx) {
    // ---- 护盾：三段实弧 + 弱点段虚线缺口 ----
    if (this.shieldCfg) {
      const R = this.w * 0.47;
      for (let i = 0; i < 4; i++) {
        const a0 = i * Math.PI / 2 - Math.PI / 4;
        const weak = i === this.shieldPhase || i === (this.shieldPhase + 1) % 4;
        ctx.save();
        if (weak) {
          // 弱点：细虚线，视觉上像"缺口"
          ctx.globalAlpha = 0.30 + Math.sin(this.t * 7) * 0.12;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 7]);
        } else {
          ctx.globalCompositeOperation = 'lighter';
          ctx.globalAlpha = 0.55;
          ctx.strokeStyle = this.stage.accent;
          ctx.lineWidth = 4;
        }
        ctx.beginPath();
        ctx.arc(this.x, this.y, R, a0 + 0.08, a0 + Math.PI / 2 - 0.20);
        ctx.stroke();
        ctx.restore();
      }
      if (this.shieldFlash > 0) {
        ctx.save();
        ctx.globalAlpha = this.shieldFlash / 0.18 * 0.45;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(this.x, this.y, R + 3, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---- 浮游炮 ----
    for (const d of this.drones) {
      if (!d.alive) continue;
      const px = clamp(this.x + Math.cos(d.ang) * d.r, 36, VIEW.w - 36);
      const py = this.y + Math.sin(d.ang) * d.r;

      // 与本体连线
      ctx.save();
      ctx.globalAlpha = 0.22;
      ctx.strokeStyle = this.stage.accent;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(px, py, 0, px, py, 26);
      g.addColorStop(0, this.stage.accent);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = d.flash > 0 ? 0.9 : 0.5;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(px, py, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = 'rgba(10,14,22,0.94)';
      ctx.beginPath();
      ctx.arc(px, py, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = this.stage.accent;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = d.flash > 0 ? '#ffffff' : this.stage.accent;
      ctx.beginPath();
      ctx.arc(px, py, 4.5, 0, Math.PI * 2);
      ctx.fill();

      // 血条
      const bw = 34;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(px - bw / 2 - 1, py - 24, bw + 2, 5);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(px - bw / 2, py - 23, bw * (d.hp / d.maxHp), 3);
    }

    // ---- 双栅栏 ----
    if (this.fenceCfg && this.fenceOn > 0) {
      // 栅栏钉在屏幕左右边缘，不跟机身抖动
      const ox = this.jx || 0, oy = this.jy || 0;
      if (ox || oy) {
        ctx.save();
        ctx.translate(-ox, -oy);
      }
      const alpha = Math.min(1, this.fenceOn / 0.6);
      for (const fx of [this.fenceX, VIEW.w - this.fenceX]) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // 柱体
        const g = ctx.createLinearGradient(fx - 12, 0, fx + 12, 0);
        g.addColorStop(0, 'rgba(178,255,96,0)');
        g.addColorStop(0.5, 'rgba(178,255,96,' + (0.55 * alpha).toFixed(3) + ')');
        g.addColorStop(1, 'rgba(178,255,96,0)');
        ctx.fillStyle = g;
        ctx.fillRect(fx - 12, 0, 24, VIEW.h);
        // 中轴
        ctx.globalAlpha = 0.85 * alpha;
        ctx.strokeStyle = '#e6ffb8';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(fx, 0);
        ctx.lineTo(fx, VIEW.h);
        ctx.stroke();
        // 上下流动的能量段
        ctx.globalAlpha = 0.55 * alpha;
        ctx.strokeStyle = '#b2ff60';
        ctx.lineWidth = 4;
        for (let i = 0; i < 9; i++) {
          const y = ((this.t * 260 + i * 105) % (VIEW.h + 90)) - 45;
          ctx.beginPath();
          ctx.moveTo(fx, y);
          ctx.lineTo(fx, y + 34);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (ox || oy) ctx.restore();
    }

    // ---- 引力场 ----
    if (this.gravityCfg && this.gravityOn > 0) {
      const k = this.gravityOn / 3.2;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 3; i++) {
        const r = 90 + i * 46 + this.gravityR * 0.35;
        ctx.globalAlpha = 0.10 + 0.16 * k;
        ctx.strokeStyle = '#b4beff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, this.t * 1.6 + i, this.t * 1.6 + i + 4.2);
        ctx.stroke();
      }
      // 向心流线
      for (let i = 0; i < 10; i++) {
        const a = this.t * 1.1 + i * 0.63;
        const r1 = 210 - ((this.t * 120 + i * 40) % 210);
        const r2 = Math.max(20, r1 - 46);
        ctx.globalAlpha = 0.28 * k;
        ctx.strokeStyle = '#dfe4ff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(this.x + Math.cos(a) * r1, this.y + Math.sin(a) * r1);
        ctx.lineTo(this.x + Math.cos(a) * r2, this.y + Math.sin(a) * r2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** 粗激光：蓄力细线 → 发射三层光束 */
  _drawLaser(ctx) {
    const cfg = this.laserCfg;
    if (!cfg || this.laserState === 0) return;

    const len = 1600;
    const ex = this.x + Math.cos(this.laserAng) * len;
    const ey = this.y + Math.sin(this.laserAng) * len;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    if (this.laserState === 1) {
      const k = 1 - this.laserT / cfg.charge;
      ctx.globalAlpha = 0.32 + k * 0.42 + Math.sin(this.t * 38) * 0.13;
      ctx.strokeStyle = '#ff6b6b';
      ctx.lineWidth = 1.5 + k * 5;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 炮口充能球
      const r = 6 + k * 16;
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 2.2);
      g.addColorStop(0, 'rgba(255,120,120,0.9)');
      g.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.globalAlpha = 0.6 + k * 0.4;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 2.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 锁定：方向已冻结，红线变白并快速闪烁，提示"马上要打了，快离开这条线"
    if (this.laserState === 1.5) {
      const lockDur = cfg.lock === undefined ? 0.8 : cfg.lock;
      const k = 1 - this.laserT / lockDur;              // 0 → 1
      // 12Hz 闪烁 + 暗相位不完全熄灭：20Hz 在 60fps 下像抖动，读不出"锁定"的意思
      const blink = 0.55 + 0.45 * Math.sin(this.t * 26);

      // 红色外描边，和蓄力的细红线区分开
      ctx.globalAlpha = (0.30 + k * 0.40) * blink;
      ctx.strokeStyle = '#ff5d5d';
      ctx.lineWidth = 8 + k * 16;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      ctx.globalAlpha = (0.60 + k * 0.40) * blink;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3 + k * 9;
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();

      // 炮口聚能球
      const r = 18 + k * 14;
      const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, r * 1.8);
      g.addColorStop(0, 'rgba(255,255,255,0.95)');
      g.addColorStop(0.45, 'rgba(255,140,140,0.75)');
      g.addColorStop(1, 'rgba(255,60,60,0)');
      ctx.globalAlpha = 0.7 + k * 0.3;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 1.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    // 发射：起手 0.15s 由细变粗，末尾 0.2s 变淡
    const elapsed = cfg.fire - this.laserT;
    const grow = Math.min(1, elapsed / 0.15);
    const w = cfg.width * (0.55 + 0.45 * grow);
    const fade = this.laserT < 0.2 ? Math.max(0.15, this.laserT / 0.2) : 1;

    ctx.globalAlpha = 0.9 * fade;
    ctx.strokeStyle = this.stage.accent;
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.globalAlpha = 0.75 * fade;
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = w * 0.42;
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();

    ctx.globalAlpha = fade;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(2, w * 0.15);
    ctx.beginPath(); ctx.moveTo(this.x, this.y); ctx.lineTo(ex, ey); ctx.stroke();

    // 炮口光晕
    const rr = w * 1.1;
    const gg = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, rr);
    gg.addColorStop(0, 'rgba(255,255,255,0.95)');
    gg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gg;
    ctx.beginPath();
    ctx.arc(this.x, this.y, rr, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  _drawParts(ctx) {
    for (const pt of this.parts) {
      if (!pt.alive) continue;
      const x = this.x + pt.dx;
      const y = this.y + pt.dy;
      const accent = this.stage.accent;

      // 外发光
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, pt.r * 1.7);
      g.addColorStop(0, accent);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = pt.flash > 0 ? 0.85 : 0.5;
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, pt.r * 1.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 炮塔外壳
      ctx.fillStyle = 'rgba(10,14,22,0.92)';
      ctx.beginPath();
      ctx.arc(x, y, pt.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = accent;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 炮口
      ctx.fillStyle = pt.flash > 0 ? '#ffffff' : accent;
      ctx.beginPath();
      ctx.arc(x, y, pt.r * 0.36, 0, Math.PI * 2);
      ctx.fill();

      // 独立血条
      const w = pt.r * 2;
      const bx = x - pt.r;
      const by = y - pt.r - 9;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(bx - 1, by - 1, w + 2, 5);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(bx, by, w * (pt.hp / pt.maxHp), 3);
    }
  }

  draw(ctx) {
    if (this.dead) {
      // 死亡时抖动 + 逐渐透明
      const k = this.deathT / 1.8;
      const jx = rand(-6, 6), jy = rand(-6, 6);
      Assets.draw(ctx, this.sprite, this.x + jx, this.y + jy, 1, 0.35 + k * 0.65);
      return;
    }
    // 震颤偏移：整体平移，让本体 / 炮塔 / 护盾 / 浮游炮作为一体在颤
    const jx = this.jx || 0, jy = this.jy || 0;
    if (jx || jy) {
      ctx.save();
      ctx.translate(jx, jy);
    }

    // 暗影把 BOSS 从背景里托出来（背景与机体常同色系）
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 34;
    ctx.shadowOffsetY = 6;
    Assets.draw(ctx, this.sprite, this.x, this.y, 1, this.invuln ? 0.4 : 1);
    ctx.restore();

    this._drawParts(ctx);
    this._drawGimmickFx(ctx);

    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      Assets.draw(ctx, this.sprite, this.x, this.y, 1, 0.5);
      ctx.restore();
    }
    // 阶段护盾提示
    if (this.phase === 2) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.18 + Math.sin(this.t * 6) * 0.08;
      ctx.strokeStyle = this.stage.accent;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 132, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (jx || jy) ctx.restore();

    // 激光是长距离判定线，画在偏移之外：视觉和 _pointSegDist 必须严格对齐
    this._drawLaser(ctx);
  }
}
