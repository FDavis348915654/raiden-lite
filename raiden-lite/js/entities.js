/* ============================================================
 * entities.js —— 子弹 / 粒子 / 拾取物 / 玩家 / 敌机 / BOSS
 * ============================================================ */

/* 敌机实例的出生序号（3.65）。追踪弹靠它判断"锁住的还是不是原来那一只"：
 * Enemy 是池对象，一只被打掉后会被**立刻复用**成新敌机，只比对引用会把
 * 复用后的新单位当成旧目标继续追，表现为子弹突然拐个大弯飞向别处。 */
let ENEMY_SPAWN_SEQ = 0;

class Bullet {
  constructor() {
    this.active = false;
  }

  init(x, y, vx, vy, opt) {
    opt = opt || {};
    this.x = x;
    this.y = y;
    /* 上一帧位置（3.55）：给"跨过一层膜"的判定用。
     * 只靠当前位置判不出"是从外面进来的"还是"早就在里面"——
     * 护盾挡弹必须认前者，否则从缺口穿进去的子弹会被后面某一帧补判成命中盾。 */
    this.px = x;
    this.py = y;
    this.vx = vx;
    this.vy = vy;
    this.friendly = !!opt.friendly;
    this.dmg = opt.dmg === undefined ? 1 : opt.dmg;
    this.r = opt.r === undefined ? 7 : opt.r;
    this.kind = opt.kind || 'enemy';
    this.rot = opt.rot === undefined ? Math.atan2(vy, vx) + Math.PI / 2 : opt.rot;
    /* 尾焰的"实际朝向"，独立于弹体 rot（3.44）。
     * 弹体是刚体，转向必须立刻；但喷出去的火是空气里的东西，转不回来那么快。
     * 两者分开存，转弯时火焰才会被甩成一道弯、而不是跟着贴图整体硬转一圈。
     * 池对象：必须按发射方向复位，否则复用时会带着上一颗弹的残留角度开局。 */
    this.trailA = Math.atan2(vy, vx);
    this.life = opt.life === undefined ? 5 : opt.life;
    this.ay = opt.ay || 0;          // 纵向加速度（抛石类弹幕用）
    this.pierce = !!opt.pierce;     // 穿透弹（激光）
    this.homing = opt.homing || 0;  // 追踪转向速率 rad/s
    /* 锁定目标（3.65）：发射时选一次、之后一路追到底，不再是"每帧找最近"。
     * 池对象字段，必须复位——否则复用时会带着上一颗弹的目标引用先飞一帧。
     * targetSeq 用来识别"目标已被击破、池对象又被复用成新的一只"。 */
    this.target = null;
    this.targetSeq = 0;
    this.boom = opt.boom || null;   // 命中后的范围爆炸 { r, dmg }
    this.fuse = opt.fuse === undefined ? 0 : opt.fuse;  // 引信：到时炸开
    this.chain = opt.chain || 0;    // 电弧链式跳数
    this.wideBlock = !!opt.wideBlock;  // 宽头弹：飞行途中吸掉敌方子弹
    this.suckT = 0;                 // 宽头弹刚吞掉一颗敌弹：刃体闪一下（池对象，必须复位）
    /* 狙击弹：两段速度。前半段几乎"悬停"滑行（96px/s），snipe.delay 秒后
     * 沿**发射瞬间**的方向猛加速到 snipe.speed。
     * 不做跟踪是有意的：跟踪弹玩家只能靠躲，狙击弹可以靠"看红环 → 横移"破。 */
    this.snipe = opt.snipe || null;
    this.snipeMax = this.snipe ? this.snipe.delay : 0;
    this.snipeT = this.snipeMax;
    this.boostFx = 0;               // 加速瞬间的白光残影
    this.defT = 0;                  // 刚被偏折过：短期内不再吃第二次偏折
    this.hits = opt.pierce ? [] : null;
    this.bossT = 0;                 // 穿透弹对 BOSS 的命中间隔
    this.active = true;
  }

  update(dt, game) {
    this.px = this.x;
    this.py = this.y;
    if (this.bossT > 0) this.bossT -= dt;
    if (this.defT > 0) this.defT -= dt;
    if (this.boostFx > 0) this.boostFx -= dt;
    if (this.suckT > 0) this.suckT -= dt;

    // 狙击弹的"起爆"：只改速度大小，方向沿用发射时算好的那一条
    if (this.snipeT > 0) {
      this.snipeT -= dt;
      if (this.snipeT <= 0) {
        const sp = this.snipe.speed;
        const a = Math.atan2(this.vy, this.vx);
        this.vx = Math.cos(a) * sp;
        this.vy = Math.sin(a) * sp;
        this.rot = a + Math.PI / 2;
        this.snipeT = 0;
        this.snipe = null;
        this.boostFx = 0.18;
        SFX.snipeFire();
      }
    }

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

    /* 追踪：**发射时锁一个目标，之后一路追到它消失**。
     * 3.65 之前是每帧取"当前最近的敌机"——同一次开火的两三颗弹从同一个
     * 机头射出、锁的是同一只，视觉上叠成一坨；目标在弹道侧面掠过时还会
     * 让弹"反复改主意"，看起来在抖。现在锁定后不再重算，只有目标被击破
     * 才换下一个（nearestEnemy 会避开别的追踪弹已锁的目标，见 game.js）。 */
    if (this.homing > 0 && game) {
      let t = this.target;
      if (t && (t.seq !== this.targetSeq || !t.active || t.dead)) { this.target = null; t = null; }
      if (!t) {
        this.target = t = game.nearestEnemy(this.x, this.y, this);
        this.targetSeq = t ? t.seq : 0;
      }
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

    /* 尾焰朝向的低通跟随（3.44）：弹体一帧能转 5.2×dt≈0.087 rad，尾焰只肯
     * 转它的一部分，于是转弯时两者夹角能拉到 0.6~0.9 rad——
     * 火焰被"落在弯道内侧"，形状上就是一条向后甩的火舌，而不是贴在机尾的纸片。
     * 系数 6 是手感值：再小火焰像断在半空，再大就跟弹体一起硬转了。 */
    if (this.homing > 0) {
      let td = Math.atan2(this.vy, this.vx) - this.trailA;
      while (td > Math.PI) td -= Math.PI * 2;
      while (td < -Math.PI) td += Math.PI * 2;
      this.trailA += td * Math.min(1, dt * 6);
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
    this._tempFx(ctx);
    Assets.drawBullet(ctx, this.kind, this.x, this.y, this.rot);

    // 狙击弹的蓄力段：一圈从外向内收的红色准星环 + 一小段方向线。
    // 没有这个提示，玩家只能"看到弹突然变快"，那是纯惩罚而不是机制。
    if (this.snipeT > 0) {
      const k = 1 - this.snipeT / this.snipeMax;      // 0 → 1
      const r = 26 - k * 16;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,90,90,' + (0.45 + k * 0.5).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // 准星的四条刻度，说明"这是瞄着你来的"
      const a0 = Math.atan2(this.vy, this.vx);
      for (let i = 0; i < 4; i++) {
        const a = a0 + i * Math.PI / 2;
        ctx.beginPath();
        ctx.moveTo(this.x + Math.cos(a) * (r + 3), this.y + Math.sin(a) * (r + 3));
        ctx.lineTo(this.x + Math.cos(a) * (r + 9), this.y + Math.sin(a) * (r + 9));
        ctx.stroke();
      }
      ctx.strokeStyle = 'rgba(255,120,120,0.18)';
      ctx.beginPath();
      ctx.moveTo(this.x, this.y);
      ctx.lineTo(this.x + Math.cos(a0) * 110, this.y + Math.sin(a0) * 110);
      ctx.stroke();
      ctx.restore();
    } else if (this.boostFx > 0) {
      // 加速瞬间的白光：让"突然变快"有一帧可见的因果
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.boostFx / 0.18;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.4;
      const a0 = Math.atan2(this.vy, this.vx);
      ctx.beginPath();
      ctx.moveTo(this.x - Math.cos(a0) * 26, this.y - Math.sin(a0) * 26);
      ctx.lineTo(this.x, this.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(this.x, this.y, 15, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  /* 临时武器的动态表现（3.42）。贴图只有一帧，动起来才有"能量弹"的分量——
   * 之前追踪弹和宽头弹各自就一张静态小图，射速又快，玩家看到的是两条
   * 凭空的色带，读不出"这是花了一个道具换来的火力"。
   * 全程只用路径 + 已烘焙贴图，**不建任何新渐变**：这两类弹同屏最多十来颗，
   * 但每帧 createLinearGradient 是这类特效最容易悄悄吃掉帧数的写法。 */
  _tempFx(ctx) {
    if (this.kind !== 'track' && this.kind !== 'wide') return;
    // 宽头弹的残影要复用贴图本体，资源没就绪就整段跳过（别让 draw 依赖外层 try-catch）
    const sp = this.kind === 'wide' ? Assets.bulletSprites.wide : null;
    if (this.kind === 'wide' && !sp) return;
    const a = Math.atan2(this.vy, this.vx);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.rotate(a + Math.PI / 2);        // 本地 -y = 前进方向，+y = 拖尾
    ctx.globalCompositeOperation = 'lighter';

    if (this.kind === 'track') {
      /* 尾焰要和弹体**分开转**（3.44）。以前整段火焰跟着 rot 刚性旋转，
       * 追踪弹一拐弯就是"尾巴原地甩一圈"，一眼就假。
       * 现在末端按 trailA（滞后朝向）落点：本地 (-len·sinδ, len·cosδ)，
       * δ = 火焰与弹体的夹角。直线飞行时 δ=0，和以前一样笔直；
       * 转弯时末端被拖到弯道内侧，中间用二次贝塞尔连起来——一道被甩弯的火舌。
       * 长度自然乘了 cosδ：火焰甩到侧面时正投影本来就该变短。 */
      const ta = this.trailA === undefined ? a : this.trailA;
      let dlt = ta - a;
      while (dlt > Math.PI) dlt -= Math.PI * 2;
      while (dlt < -Math.PI) dlt += Math.PI * 2;
      /* 三层各甩各的：最外那层是低速的余焰，被甩得最开；内芯是刚从喷口出来的
       * 高速火焰，几乎还贴着弹体走。同一个 δ 三层各自乘 1.35 / 1.0 / 0.6，
       * 转弯时火舌会"撕开"成扇形——这是它读起来像流体而不是像一块布的关键。
       * 顺带：外层甩开时补一点长度，否则 cos 一收缩就只剩个短疙瘩。 */
      const bendK = [1.35, 1.0, 0.6];
      const growK = [1.30, 1.12, 1.0];
      const sw = Math.abs(Math.sin(dlt));
      /* 尾焰三层：暗橙铺长度、亮橙做主体、近白短芯。长度按 life 做相位抖动——
       * 一条长度恒定的火焰看起来像贴在机身后面的纸片。
       * 长宽比按 46:9 取：短而宽的火焰读作"桃形光斑"，只有拉长才像在推进。 */
      const f = 1 + Math.sin(this.life * 52) * 0.16;
      /* 三层要"越外越透、越内越实"：三层给同一个 alpha 会叠成一块实心橙色，
       * 看起来像弹体后面拖着一坨颜料，而不是在燃烧。 */
      const flame = [
        [62 * f, 10.5, 'rgba(255,96,32,0.20)'],
        [44 * f, 7.2, 'rgba(255,165,64,0.42)'],
        [26 * f, 4.2, 'rgba(255,246,220,0.85)']
      ];
      for (let i = 0; i < flame.length; i++) {
        const [base, w, col] = flame[i];
        const len = base * (1 + (growK[i] - 1) * sw);
        const bd = clamp(dlt * bendK[i], -1.2, 1.2);
        const ex = -len * Math.sin(bd), ey = len * Math.cos(bd);
        ctx.beginPath();
        ctx.moveTo(-w, 0);
        ctx.quadraticCurveTo(-w * 0.5 + ex * 0.16, ey * 0.74, ex, ey);
        ctx.quadraticCurveTo(w * 0.5 + ex * 0.16, ey * 0.74, w, 0);
        ctx.closePath();
        ctx.fillStyle = col;
        ctx.fill();
      }
      // 尾端飘散的碎火：让"喷出来"这件事一直有东西在收尾，不至于一刀切在光晕边缘
      // 碎火走同一条弯线（二次贝塞尔取点），不然火焰弯了珠子还在直线上飞
      const outer = clamp(dlt * bendK[0], -1.2, 1.2);
      const oLen = 62 * f * (1 + (growK[0] - 1) * sw);
      const bx = -oLen * Math.sin(outer), by = oLen * Math.cos(outer);
      for (let i = 0; i < 3; i++) {
        const p = (this.life * 3.1 + i / 3) % 1;      // 0→1 循环
        const t = 0.29 + p * 0.71;
        const px = t * t * bx;
        const py = by * (1.48 * t * (1 - t) + t * t);
        ctx.globalAlpha = (1 - p) * 0.55;
        ctx.fillStyle = 'rgba(255,150,60,1)';
        ctx.beginPath();
        ctx.arc(px + Math.sin(p * 9 + i) * 5, py, 2.6 * (1 - p * 0.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = 'rgba(255,150,70,1)';
      ctx.beginPath();
      ctx.arc(0, 2, 13.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    } else {
      /* 宽头弹：一道横向能量刃。拖尾直接复用**同一张刃的贴图**做两帧残影
       * （递减横向缩放 + 递减 alpha）——同形状的残影读作运动模糊，
       * 换成椭圆或方块就会变成"子弹后面挂着个东西"。
       * 两端各点一颗亮核：它的判定只有圆 r17，视觉横向却有 54px，
       * 端点亮度是玩家判断"这条刃扫到哪了"的唯一参照。 */
      const breath = 1 + Math.sin(this.life * 26) * 0.06;
      const hw = 27 * breath;
      for (const [off, k, al] of [[15, 1.0, 0.26], [29, 0.84, 0.13]]) {
        ctx.globalAlpha = al;
        ctx.drawImage(sp, -sp.width * k / 2, off - sp.height / 2, sp.width * k, sp.height * k);
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(210,255,245,0.85)';
      for (const sx of [-1, 1]) {
        ctx.beginPath();
        ctx.arc(sx * hw, 0, 2.8, 0, Math.PI * 2);
        ctx.fill();
      }
      if (this.suckT > 0) {
        // 吞弹的一瞬间整条刃外扩亮一下：没有这个反馈，玩家根本不知道它在吃弹，
        // 只会觉得"这波弹幕怎么自己少了"
        ctx.globalAlpha = Math.min(1, this.suckT / 0.10) * 0.7;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(0, 0, hw * 1.14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
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
   *  dirX  +1 自左横穿 / -1 自右横穿（给了 dirX 就忽略 dir）
   *  bounce 可反弹次数（飘到底边或顶边翻向飘走）
   *  sway  横向摆幅 px/s（洋流的摆动感；横穿时改成纵向摆动）
   *  speed 飘移速度 px/s */
  init(x, y, kind, weapon, opt) {
    opt = opt || {};
    this.x = x;
    this.y = y;
    this.kind = kind;                 // P 火力 / W 武器 / B 保险 / H 生命 / O 僚机
    this.weapon = weapon || 0;        // 仅 W 有效：这把道具固定对应的武器索引
    /* 仅 W 有效：接回来时的等级（0 = 不指定，按"接主武器等级"的常规规则）。
     * 玩家被打爆时散落的武器会带 lv-1，捡回来比原来低一级。 */
    this.lv = opt.lv || 0;
    this.t = 0;
    this.age = 0;
    this.vx = rand(-40, 40);
    this.dir = opt.dir === -1 ? -1 : 1;
    this.dirX = opt.dirX === -1 ? -1 : (opt.dirX === 1 ? 1 : 0);
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
    if (this.dirX) {
      // 横穿补给：只走横向，纵向用 sway 做一点起伏，看起来像被气流斜着推过来。
      // 注意不能复用 dir —— 出界回收和反弹都按 dir 判定，混用会让横穿的道具
      // 一露头就被判成"飘出底边"而回收。
      this.x += this.dirX * this.speed * dt;
      if (this.sway) this.y += Math.sin(this.age * 2.1 + this.phase) * this.sway * dt;
    } else {
      this.y += this.dir * this.speed * dt;
      if (this.sway) this.x += Math.sin(this.age * 2.1 + this.phase) * this.sway * dt;
      this.x += this.vx * dt;
      this.vx *= Math.pow(0.96, dt * 60);
    }

    // 触边反弹：飘到底边（或顶边）翻向飘走，慢一档并侧推一下，
    // 否则会沿着原路线直上直下，看着像卡住
    if (this.bounceLeft > 0 && this.dirX === 0) {
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

    // 横穿的道具从屏幕外进场，不能夹到 20~W-20，否则第一帧就被拉到边上"瞬移"进来
    if (this.dirX === 0) this.x = clamp(this.x, 20, VIEW.w - 20);
    // 回收按当前方向判断：反弹后反向飞走的道具才不会一露头就被判出界
    if (this.dirX > 0) {
      if (this.x > VIEW.w + 40) this.active = false;
    } else if (this.dirX < 0) {
      if (this.x < -40) this.active = false;
    } else if (this.dir > 0) {
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
    // 临时增益画成菱形，其余是圆形：它们的强度是"一段时间的战术优势"，
    // 到期就没了，不该和 P/B/H 这些永久成长看起来一样
    const isTemp = this.kind === 'S' || this.kind === 'T' ||
      this.kind === 'D' || this.kind === 'A';
    const shape = () => {
      ctx.beginPath();
      if (isTemp) {
        const s = 12;
        ctx.moveTo(0, -s);
        ctx.lineTo(s, 0);
        ctx.lineTo(0, s);
        ctx.lineTo(-s, 0);
        ctx.closePath();
      } else {
        ctx.arc(0, 0, 11, 0, Math.PI * 2);
      }
    };
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
    shape();
    ctx.fill();
    ctx.strokeStyle = c;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = c;
    /* 单字符的走 13px，多字符（1UP）缩到 8px：半径 11 的圆里
     * 三字符按 9px 排会顶到描边上，糊成一团。 */
    const label = this.kind === 'W' ? WEAPONS[this.weapon].name.charAt(0)
      : (this.kind === 'E' ? '1UP' : this.kind);
    ctx.font = 'bold ' + (label.length > 1 ? 8 : 13) + 'px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, 1);
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

const PICKUP_COLORS = {
  P: '#66e0ff', W: '#ffc857', B: '#7dff9e', H: '#ff7a8a',
  O: '#a8f4ff', R: '#ff8ce0', L: '#b48cff',
  // 加命：白金。全场唯一的"多一条命"，配色要比其它道具亮一档才对得起稀有度
  E: '#fff2b0',
  // 临时增益：统一走冷色/暖色两套，和上面的"永久成长"道具区分开
  // 雷电单独给紫白：它是"落雷"不是"射击"，玩家得一眼认出和电弧炮不是一回事
  S: '#9fe8ff', T: '#ffa060', D: '#7bffcf', A: '#c9b0ff', Z: '#c6a2ff'
};

/* ---------------------------------------------------------------- 玩家 */
class Player {
  constructor() {
    this.reset();
  }

  /** 全新一局：等级、武器、保险全部归零 */
  reset() {
    this.lives = PLAYER.lives;
    this.bombs = PLAYER.bombs;
    this.maxHp = PLAYER.hp;
    this.hp = this.maxHp;
    /* 火力等级改为**按槽独立**：lv[i] 和 weapons[i]/slotT[i] 并行，长度必须一致。
     * 三条会改变它的路径：
     *   P 道具  → 所有已装武器各 +1（不占玩家决策，成长主线）
     *   同款 W  → 只有那一把 +1（想专精某把枪就盯着吃它，满级后转成全弹发射）
     *   中弹    → 所有槽各 -1（死亡要能真的打疼）
     * 新枪入场时接主武器等级，避免"第 7 关捡到新枪却是 L1"这种拿不起来的情况。 */
    this.lv = [PLAYER.startPower];
    this.weapons = [0];              // 武器槽（索引到 WEAPONS），最多 WEAPON_SLOTS 个
    this.slotT = [0];                // 每个槽独立的开火冷却
    this.options = [];               // 全新一局清空僚机
    this.orbits = [];                // 环绕机
    this.orbitBoostT = 0;            // 超额吃 R 的加速剩余时间
    this.lasers = PLAYER.laserBombs; // 激光保险数量
    this.shield = null;              // 临时护盾 { hp, max, t, hitT }
    /* 临时武器是**一组**（3.47）：三把（追踪 / 宽头 / 雷电）各自独立计时、独立冷却，
     * 吃到第二把不再顶掉第一把。以前这里是单个对象，玩家吃到宽头弹追踪弹就消失，
     * 而这两件都是 35 秒的实验武器——"我明明刚捡的"是最伤手感的一种丢失。 */
    this.tempWpns = [];              // [{ id:'track'|'wide'|'thunder', t, cd }]
    this.tempAlly = null;            // 临时僚机 { t, x, y, slotT }
    this.resetStage();
  }

  /** 进入下一关：只重置位置与状态，火力/武器/保险/剩余命数保留 */
  resetStage() {
    this.x = VIEW.w / 2;
    this.y = PLAY_BOTTOM - 80;
    this.canFire = true;             // 结算期关掉，避免空放子弹糊住 UI
    this.boostT = 0;                 // 全弹发射后的射速强化剩余时间
    this.invuln = PLAYER.respawnInvuln;
    this.hp = this.maxHp;            // 换关补满血：新关开场就被上一关的残血拖死太难读
    this.fireT = 0;
    this.alive = true;
    this.t = 0;
    // 僚机、环绕机跨关保留：只有 reset() 会清空
    if (!this.options) this.options = [];
    if (!this.orbits) this.orbits = [];
    if (!this.weapons) this.weapons = [0];
    /* 等级表与武器槽必须等长：调试面板会直接改 weapons，长度对不上就整表重建，
     * 否则 lv[i] 读到 undefined，那一槽会退化成 L1（看起来像"换关掉级"）。 */
    if (!this.lv || this.lv.length !== this.weapons.length) {
      const old = this.lv || [];
      this.lv = this.weapons.map((_, i) =>
        clamp(old[i] || PLAYER.startPower, 1, PLAYER.maxPower));
    }
    this.slotT = this.weapons.map(() => 0);   // 换关清零冷却
    this.shotQ = [];                          // 错峰队列也清空，免得上一关的子弹跨关冒出
    for (const o of this.options) o.slotT = [0.12, 0.26];
    // 临时效果跨关保留（剩余时间继续走），只把位置拉回机身旁边，
    // 否则换关后临时僚机会从上一关的位置一路飘过来
    if (this.tempAlly) {
      this.tempAlly.x = this.x;
      this.tempAlly.y = this.y + TEMP.ally.oy;
      this.tempAlly.slotT = 0.2;
    }
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
    this._updateTemp(dt, game);   // 临时增益：计时、自动开火、临时僚机跟随
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
        const pow = Math.min(s2 === 0 ? 2 : 1, this.lv[wi] || PLAYER.startPower);
        this.fireFrom(game, o.x, o.y - 18, mul, pow, wi);
        o.slotT[s2] = WEAPONS[wi].cd * (s2 === 0 ? 1.45 : 1.9);
      }
    }
  }

  /* ---------------- 临时增益（护盾 / 临时武器 / 临时僚机） ----------------
   * 三类都不占武器槽：临时武器直接由这里开火，玩家无法（也不需要）切到它。
   * 计时统一在这里推进，到期清空并通知 game 播一次提示，免得"道具突然没了"。
   */

  /** 吃 S：护盾。重复吃 → **时间累加（封顶 `maxDur`）+ 耐久补满**。
   *  耐久不累加：它的单位是"颗"，叠到 60 发等于把"什么时候该冲"变成"随便冲"，
   *  时长可以叠、强度不能叠。 */
  gainShield(game) {
    const C = TEMP.shield;
    if (this.shield) {
      this.shield.t = Math.min(C.maxDur, this.shield.t + C.dur);
      this.shield.hp = C.hp;
    } else {
      this.shield = { hp: C.hp, max: C.hp, t: C.dur, hitT: 0, jit: 0 };
    }
    game.onTempGain(this, 'shield');
  }

  /** 吃 T / D / Z：临时武器。三把**可以同时在手**（3.47），
   *  重复吃同一把 → **时间累加（封顶 `maxDur`）**、冷却压到最短，不新建第二条。 */
  gainTempWpn(game, id) {
    const C = TEMP[id];
    const cur = this._tempWpnOf(id);
    if (cur) {
      cur.t = Math.min(C.maxDur, cur.t + C.dur);
      cur.cd = Math.min(cur.cd, 0.1);
    } else {
      this.tempWpns.push({ id, t: C.dur, cd: 0.1 });
    }
    game.onTempGain(this, id);
  }

  /** 按 id 取当前在手的临时武器，没有就返回 null */
  _tempWpnOf(id) {
    for (const tw of this.tempWpns) if (tw.id === id) return tw;
    return null;
  }

  /** 吃 A：临时僚机。已在场时再吃 → 时间累加（封顶 `maxDur`），并补一段无敌
   *  （和正式僚机满员吃 O 同待遇：冗余的僚机道具别只剩"刷新计时"这一件事） */
  gainTempAlly(game) {
    if (this.tempAlly) {
      this.tempAlly.t = Math.min(TEMP.ally.maxDur, this.tempAlly.t + TEMP.ally.dur);
      this.invuln = Math.max(this.invuln, PLAYER.optionInvuln);
    } else {
      this.tempAlly = { t: TEMP.ally.dur, x: this.x, y: this.y + TEMP.ally.oy, slotT: 0.12 };
    }
    game.onTempGain(this, 'ally');
  }

  /** 推进三种临时状态；到期各自清空 */
  _updateTemp(dt, game) {
    // 护盾：时间到或被打穿就消失
    const sh = this.shield;
    if (sh) {
      sh.t -= dt;
      if (sh.hitT > 0) sh.hitT -= dt;
      if (sh.jit > 0) sh.jit -= dt;      // 挡弹抖动的衰减（只影响绘制，不影响判定）
      if (sh.t <= 0 || sh.hp <= 0) {
        /* 被打穿 ≠ 时间到（3.45）：只有"耐久没了但时间还在"才算打穿，
         * 这时补一口血。时间到就正常消失，不给白送的血——
         * 否则玩家会把护盾当成"dur 秒后的回血包"，主动留着不打弹。 */
        const broke = sh.hp <= 0 && sh.t > 0;
        this.shield = null;
        if (broke && TEMP.shield.breakHeal > 0) {
          this.hp = Math.min(this.maxHp, this.hp + TEMP.shield.breakHeal);
          game.onShieldBreak(this, TEMP.shield.breakHeal);
        } else {
          game.onTempEnd(this, 'shield');
        }
      }
    }

    /* 临时武器：每把独立计时、独立冷却。canFire 在结算/死亡时为 false，这里跟着停，
     * 否则结算页上还在喷弹幕。
     * 倒序遍历 + splice：正序删元素会跳过下一个（三把同时在场时只掉一把）。 */
    for (let i = this.tempWpns.length - 1; i >= 0; i--) {
      const tw = this.tempWpns[i];
      tw.t -= dt;
      if (tw.t <= 0) {
        this.tempWpns.splice(i, 1);
        game.onTempEnd(this, tw.id);
      } else if (this.canFire) {
        tw.cd -= dt;
        if (tw.cd <= 0) {
          /* _fireTemp 返回"下一次可开火要等多久"：追踪/宽头弹是固定射速，
           * 雷电在周围没敌人时会返回一个极短的 retry——它不该空转一整个 cd，
           * 否则敌人刚飞进圈也得干等 0.4 秒才挨第一下。 */
          tw.cd = this._fireTemp(game, tw);
        }
      }
    }

    // 临时僚机：到点消失
    const ta = this.tempAlly;
    if (ta) {
      ta.t -= dt;
      if (ta.t <= 0) {
        this.tempAlly = null;
        game.onTempEnd(this, 'ally');
      } else {
        this._updateTempAlly(dt, game, ta);
      }
    }
  }

  /** 临时武器开火：不占槽、不吃 SLOT_DMG，也不进错峰队列（本身射速就慢）。
   *  返回下一次开火的等待时间，见 _updateTemp。 */
  _fireTemp(game, tw) {
    if (tw.id === 'track') {
      const C = TEMP.track;
      game.spawnPlayerBullet(this.x, this.y - 40, 0, -C.sp, C.dmg, {
        kind: 'track', r: C.r, homing: C.homing, life: 3,
        boom: { r: C.boomR, dmg: C.boomDmg }
      });
      SFX.shoot();
      return C.cd;
    }
    if (tw.id === 'thunder') {
      const C = TEMP.thunder;
      /* 雷电和另外两把临时武器的根本区别：**不是"到点就放"**。
       * 它先问"周围有没有敌人"，没有就静默，连音效都不出——
       * 否则满屏都是雷声，玩家分不清"现在真的在打"还是"它自己在响"。
       * 目标判定交给 `nearestChainTarget`（3.66）：BOSS 本体和它的炮塔/浮游炮
       * 都算目标。以前这里只扫 `enemies`，BOSS 战没有小怪时雷电**一次都不触发**，
       * 玩家看到的是"这件道具捡了等于没捡"。 */
      const best = game.nearestChainTarget(this.x, this.y, C.range, null);
      if (!best) return C.retry;
      game.chainLightning(this.x, this.y - 16, null, C.hops, C.dmg, {
        first: best, firstR: C.range, radius: C.jumpR,
        falloff: C.falloff, minDmg: C.minDmg, color: C.color
      });
      SFX.thunder();
      return C.cd;
    }
    const C = TEMP.wide;
    game.spawnPlayerBullet(this.x, this.y - 40, 0, -C.sp, C.dmg, {
      kind: 'wide', r: C.r, life: 1.6, wideBlock: true
    });
    SFX.shoot();
    return C.cd;
  }

  /** 临时僚机（3.45）：第二把满级主武器——火力 1.0 倍、等级跟随主槽、
   *  射速只压 1.15 倍间隔。它不再"不能盖过正式僚机"：正牌 O 是永久的，
   *  这一件只亮 35 秒，限时本身就是它的平衡。 */
  _updateTempAlly(dt, game, ta) {
    const C = TEMP.ally;
    const k = Math.min(1, 7.5 * dt);
    ta.x += (this.x - ta.x) * k;
    ta.y += (this.y + C.oy - ta.y) * k;

    const wi = this.weapons[0];
    if (wi === undefined) return;
    ta.slotT -= dt;
    if (ta.slotT > 0 || !this.canFire) return;
    this.fireFrom(game, ta.x, ta.y - 18, C.mul, Math.min(C.powMax, this.lv[0] || PLAYER.startPower), wi);
    ta.slotT = WEAPONS[wi].cd * 1.15;
  }

  fire(game) {
    this.fireFrom(game, this.x, this.y - 34, 1);
  }

  /** 按槽位开火：副槽在机身上左右分开，伤害按 SLOT_DMG 递减。
   *  主槽（0）必须居中：切枪是"换掉主槽的武器"，出膛点要是跟着变，
   *  每次切枪弹流都会横向跳一下，手感像飞机被推了一把。
   *  4 号槽没有第 5 个横向位置可用，改为抬高 8px —— 同一横坐标上两条弹流
   *  会被误认成一条，纵向错开才能一眼数出"现在是四路火力"。 */
  fireSlot(game, s2) {
    const idx = this.weapons[s2];
    if (idx === undefined) return;
    const off = s2 === 0 ? 0 : (s2 === 1 ? -14 : (s2 === 2 ? 14 : 0));
    const up = s2 === 3 ? 8 : 0;
    // 等级按槽取：副槽的枪可能比主槽低（新枪入场 / 专精养成），不能共用一个 power
    this.fireFrom(game, this.x + off, this.y - 34 - up, SLOT_DMG[s2] || 1,
      this.lv[s2] || PLAYER.startPower, idx, s2 > 0);
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
   *  mul 缩放伤害（僚机 0.55），pow 覆盖火力等级（僚机封顶 Lv2）
   *
   *  火力 1~5 级（PLAYER.maxPower = 5）。数值口径是"L5 与旧版三级封顶持平"：
   *  下面每把枪都按 单发伤害递减 / 弹数递增 排，满级总 DPS 约等于旧 L3，
   *  中间三级各自更弱。这样加等级不会把已经调好的敌机血量与 BOSS 时长推翻，
   *  玩家的成长曲线却从三段变五段。 */
  fireFrom(game, bx, by, mul, pow, wIdx, quiet) {
    const wi = wIdx === undefined ? 0 : wIdx;
    const p = Math.min(PLAYER.maxPower, pow || this.lv[0] || PLAYER.startPower);
    const self = mul === undefined ? 1 : mul;
    game._shotMul = self;

    switch (WEAPONS[wi].id) {
      /* 火神炮：一轮多颗，但**错峰**出膛。
       * 同一帧全吐出来的话，三发会在屏幕上糊成一条粗线，和散射炮的齐射没区别；
       * 按 0.042 秒一颗逐次发射，看起来是连珠，也才立住"持续压制"这个定位。
       * 第一颗仍然立即出膛，保证按键/触屏的响应手感。
       * 5 级按 1/2/3/4/5 路铺开，单发从 2.4 降到 1.45：满级 5×1.45 ≈ 旧三发的 7 点，
       * 视觉上是"弹流变宽"而不是"每颗变重"。
       * 每路的横向速度取自身出膛偏移的 4 倍，于是弹流是**向外微微张开**的扇形（最外一路约 5.6°），
       * 不再是五条并行直线。张角压得很小：火神炮的定位是持续压制 + 瞄准感，
       * 张到 10° 以上远处就打不中同一条线，手感会退化成第二把散射炮。 */
      case 'vulcan': {
        const gap = this.boostT > 0 ? 0.028 : 0.042;   // 全弹发射的射速强化期，连珠更密
        const dmg = [2.4, 1.8, 1.6, 1.45, 1.45][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 12;
          // 外侧两路略低 8px：同一横坐标上的两条弹流会被误认成一条
          const oy = Math.abs(off) > 12 ? 8 : 0;
          const vx = off * 4;
          if (i === 0) {
            game.spawnPlayerBullet(bx + off, by + oy, vx, -980, dmg, { kind: 'player' });
          } else {
            this._queueShot(game, bx + off, by + oy, vx, -980, dmg, { kind: 'player' }, i * gap);
          }
        }
        break;
      }

      /* 散射炮：一次齐射，扇面同时铺开，射程只有 0.40 屏高、张角 60°。
       * 速度恒定 780，所以把 life 直接算成 路径长度/速度 ——
       * 这样扇形里每一发的路径长度一致，远端边界会连成一条干净的弧。
       * 单发比同级的火神炮重（2.8 vs 2.4）：射程砍短之后命中窗口变少，
       * 靠单发更痛来补偿，否则多档火力下散弹会彻底被火神炮比下去。 */
      case 'spread': {
        // 5 级齐射 5 / 8 / 11 / 14 / 17 发，铺满 60°（1.047 rad）；
        // 单发 2.8 → 2.3，满级弹数比旧版多两成但总伤害持平，
        // 射速在 config 里压到 0.34s，避免"弹数翻倍 + 高频"直接把 DPS 拉爆
        const n = [5, 8, 11, 14, 17][p - 1];
        const dmg = [2.8, 2.55, 2.4, 2.4, 2.3][p - 1];
        const total = 1.047;                 // 60°
        const life = SPREAD_RANGE / 780;
        for (let i = 0; i < n; i++) {
          const a = -Math.PI / 2 - total / 2 + (i * total) / (n - 1);
          game.spawnPlayerBullet(bx, by, Math.cos(a) * 780, Math.sin(a) * 780, dmg,
            { kind: 'spread', r: 7, life: life });
        }
        break;
      }

      /* 穿透激光：几条细光柱并排，弹数跟等级走（1~5 条）。
       * 单发 4.4 → 2.45，五条并排时总伤与旧版三条持平，
       * 视觉上是"光束变粗"，判定仍是各自独立的细柱（r10）。 */
      case 'laser': {
        const dmg = [4.4, 3.2, 2.8, 2.6, 2.45][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 11;
          game.spawnPlayerBullet(bx + off, by - 24, 0, -1500, dmg,
            { kind: 'laser', pierce: true, r: 10, life: 1.0 });
        }
        break;
      }

      case 'missile': {
        const dmg = [4.3, 3.1, 2.75, 2.55, 2.45][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 13;
          game.spawnPlayerBullet(bx + off, by + 6, off * 7, -560, dmg,
            { kind: 'missile', homing: 6.2, r: 8, life: 3.2 });
        }
        break;
      }

      /* 等离子炮：慢速大弹，命中后小范围爆炸
       * 5 级时五颗并排，单发 6.3 → 3.65；爆炸伤害同步从 4 压到 2.5 ——
       * 每级多一颗弹，爆伤不压的话群伤会按"颗数"线性放大，五级的实际收益
       * 会远超表上的单体 DPS。 */
      case 'plasma': {
        const dmg = [6.3, 4.65, 4.1, 3.8, 3.65][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 26;
          game.spawnPlayerBullet(bx + off, by - 8, off * 1.1, -560, dmg,
            { kind: 'plasma', r: 14, life: 2.6, boom: { r: 54, dmg: 2.5 } });
        }
        break;
      }

      /* 散榴弹：抛到前方固定时间后炸开，碎片向前扇开 */
      case 'flak': {
        const dmg = [4.2, 3.0, 2.7, 2.5, 2.4][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 34;
          game.spawnPlayerBullet(bx + off, by, off * 0.55, -620, dmg,
            { kind: 'flak', r: 9, life: 2, fuse: 0.78 - i * 0.035 });
        }
        break;
      }

      /* 电弧炮：命中小怪后向邻近目标跳 2 次 */
      case 'tesla': {
        const dmg = [3.25, 2.35, 2.05, 1.9, 1.8][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 18;
          game.spawnPlayerBullet(bx + off, by, 0, -760, dmg,
            { kind: 'tesla', r: 8, life: 1.5, chain: 2 });
        }
        break;
      }

      /* 逆火炮：前向直射 + 尾部向后扇形，专门应付从下方来的敌人
       * 尾炮出膛速度压到 470：原来 700 时从机尾到屏幕底边只要 0.23 秒，
       * 子弹基本还没飞到敌机身上就出屏了；压慢后在场时间约 0.34 秒，
       * 配合 PLAYER.rearDmgMul 的伤害加成，才打得掉爬上来的 riser。
       * 前后两路都按等级加弹数（各级 1~5 发），单发各自下调：尾炮还吃
       * rearDmgMul ×4，所以它的单发压得比前向更狠（1.55 → 0.9）。 */
      case 'backfire': {
        const fwdDmg = [2.1, 1.65, 1.45, 1.35, 1.25][p - 1];
        const rearDmg = [1.55, 1.2, 1.05, 0.98, 0.9][p - 1];
        for (let i = 0; i < p; i++) {
          const off = (i - (p - 1) / 2) * 14;
          game.spawnPlayerBullet(bx + off, by, 0, -940, fwdDmg, { kind: 'backfire' });
        }
        for (let i = 0; i < p; i++) {
          const a = Math.PI / 2 + (i - (p - 1) / 2) * 0.38;
          game.spawnPlayerBullet(bx, by + 52, Math.cos(a) * 470, Math.sin(a) * 470, rearDmg,
            { kind: 'backfire', r: 8, life: 1.5 });
        }
        break;
      }

      /* 环射炮：4/6/8/10/12 方向同时开火，被包围时能翻盘。
       * 方向数涨到 12 时单发降到 1.25：满级总伤与旧版 8 向 ×2 基本持平，
       * 但覆盖面密一倍——它的价值本来就在"哪儿都有弹"，不在单点爆发。 */
      case 'omni': {
        const dirs = [4, 6, 8, 10, 12][p - 1];
        const dmg = [1.45, 1.35, 1.35, 1.3, 1.25][p - 1];
        for (let i = 0; i < dirs; i++) {
          const a = -Math.PI / 2 + (i * Math.PI * 2) / dirs;
          game.spawnPlayerBullet(bx, by, Math.cos(a) * 610, Math.sin(a) * 610, dmg,
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

  /** 吃到 W 道具：已有的那把**自己升一级**，没有则占一个空槽
   *  （满级再吃同款 → 全弹发射）。这是"独立等级"里的主动成长线：
   *  P 只能全槽齐涨，想把这把枪先推到满级、先解锁它的全弹发射，就得专喂它 W。 */
  addWeapon(idx, game, lv) {
    idx = ((idx % WEAPONS.length) + WEAPONS.length) % WEAPONS.length;
    const exist = this.weapons.indexOf(idx);

    if (exist >= 0) {
      const cur = this.lv[exist] || PLAYER.startPower;
      /* 带 lv 的 W 只来自"爆机散落"：直接回到那一档，不再叠 +1。
       * 否则主武器（散落时必然还在 0 号位）会被当成"又吃到一把同款"，
       * 捡回来只回到 L(原-2)，玩家会觉得捡了个寂寞。已经更高就不动。 */
      if (lv) {
        this.lv[exist] = Math.max(cur, clamp(lv, 1, PLAYER.maxPower));
        game.onWeaponDup(this, idx, this.lv[exist]);
        return 'dup';
      }
      if (cur >= PLAYER.maxPower) {
        this.overdrive(game);        // 满级重复吃同款：全弹发射
        return 'overdrive';
      }
      this.lv[exist] = Math.min(PLAYER.maxPower, cur + 1);
      game.onWeaponDup(this, idx, this.lv[exist]);
      return 'dup';
    }

    /* 新枪一律从 L1 开始（3.36）。
     * 以前入场直接接主武器等级，结果是"捡到新枪 = 白捡一把满级枪"：
     * 换枪没有任何养成成本，9 把武器只是 9 个换着玩的皮肤，
     * 每把枪独立的等级系统也就形同虚设。
     * 现在新枪得自己吃 W 慢慢升——想用一把枪就得一直用它，
     * "专精"这件事才第一次成立。
     * 唯一的例外是 `lv` 有值：那来自"爆机散落的自己的枪"，
     * 要按掉落时的档位直接接上（散落已经降过一级，再回到 L1 等于双倍惩罚）。 */
    const entry = lv ? clamp(lv, 1, PLAYER.maxPower) : 1;
    if (this.weapons.length < WEAPON_SLOTS) {
      this.weapons.push(idx);
      this.slotT.push(0);
      this.lv.push(entry);
      game.onWeaponAdded(this, idx, entry);
      return 'add';
    }

    // 槽满：挤掉最旧的副武器，主武器不动（主武器换不换由玩家点槽位决定）
    const out = this.weapons[1];
    this.weapons.splice(1, 1);
    this.weapons.push(idx);
    // 冷却表必须跟着一起挪：只搬 weapons 的话，新武器会继承被挤掉那把的剩余冷却，
    // 而被前移到 1 号位的武器又换了个计时器，表现为"刚拿到就打不出来"
    if (this.slotT && this.slotT.length === WEAPON_SLOTS) {
      this.slotT.splice(1, 1);
      this.slotT.push(0);
    }
    // 等级表同理：被挤掉那把的等级要跟着走，新枪按入场等级接上
    if (this.lv && this.lv.length === WEAPON_SLOTS) {
      this.lv.splice(1, 1);
      this.lv.push(entry);
    }
    game.onWeaponReplaced(this, out, idx);
    return 'replace';
  }

  /** 切主武器：把目标槽的武器轮转到 0 号位。
   *  伤害与冷却都按"位置"算（SLOT_DMG / slotT），所以必须整条轮转、把冷却一起搬走；
   *  只改索引的话，新主武器会继承上一把的剩余冷却，手感上像"切了但没准备好"。
   *  slot 省略 → 依次切下一把（循环）；指定 slot → 直接把它调到主位。 */
  switchWeapon(game, slot) {
    const n = this.weapons.length;
    if (n <= 1) return false;                       // 只有一把，没什么可切
    // 槽位与冷却表必须等长：调试面板可能直接改 weapons，长度对不上时整表重建，
    // 不然 shift/push 会把 undefined 塞进冷却表，之后减 dt 变成 NaN 永不开火
    if (!this.slotT || this.slotT.length !== n) this.slotT = this.weapons.map(() => 0);
    // 等级表同样要跟着整条轮转：只搬 weapons 的话，主位会拿到上一把枪的等级
    if (!this.lv || this.lv.length !== n) {
      this.lv = this.weapons.map(() => PLAYER.startPower);
    }
    const to = (slot === undefined || slot < 0 || slot >= n) ? 1 : slot;
    if (to === 0) return false;
    for (let k = 0; k < to; k++) {
      this.weapons.push(this.weapons.shift());
      this.slotT.push(this.slotT.shift());
      this.lv.push(this.lv.shift());
    }
    // 切上来的武器立刻能开火：还要等 0.3 秒才出声，会被当成"切枪卡顿"
    this.slotT[0] = Math.min(this.slotT[0], 0.06);
    game.onWeaponChanged(this, to);
    return true;
  }

  /** 火力满级后再吃同款武器：按**当前主武器**打出一轮"超规格"弹幕 + 短时射速强化
   * 形状表见 config.js 的 OVERDRIVE.shapes，9 种武器各有各的几何：
   * 整圈 / 前向扇面 / 前后对开，靠 arc + aim 描述，见下方取值方式。 */
  overdrive(game) {
    game._shotMul = 1;                 // 不吃僚机 / 副槽的伤害折扣
    const id = WEAPONS[this.weapons[0]].id;
    const layers = OVERDRIVE.shapes[id] || OVERDRIVE.shapes.vulcan;
    for (let L = 0; L < layers.length; L++) {
      const lay = layers[L];
      const rot = lay.rot || 0;
      const arc = lay.arc === undefined ? Math.PI * 2 : lay.arc;
      const aim = lay.aim === undefined ? -Math.PI / 2 : lay.aim;
      const full = arc >= Math.PI * 2 - 0.001;
      for (let i = 0; i < lay.n; i++) {
        // 整圈按 i/n 均分（首尾不重合）；扇面按 i/(n-1)，两端都落在边界上——
        // 扇面用 i/n 的话最后总会缺一角，151° 的"弹墙"会变成一边空一边密。
        const a = full
          ? (i / lay.n) * Math.PI * 2 + rot
          : aim - arc / 2 + (lay.n === 1 ? arc / 2 : (i * arc) / (lay.n - 1)) + rot;
        game.spawnPlayerBullet(this.x, this.y, Math.cos(a) * lay.sp, Math.sin(a) * lay.sp, lay.dmg, {
          kind: lay.kind || 'player',
          r: lay.r || 9,
          life: OVERDRIVE.life,
          pierce: lay.pierce,
          homing: lay.homing,
          boom: lay.boom,
          chain: lay.chain,
          // 榴弹引信按发射顺序错开：同时炸成一片会更像"一发大爆炸"，
          // 错开 0.12 秒才是"一片弹陆续在空中开花"
          fuse: lay.fuse ? lay.fuse + (i / lay.n) * 0.12 : undefined,
          noRear: true                   // 伤害已按"全弹发射"给足，不再叠后向倍率
        });
      }
    }
    this.boostT = OVERDRIVE.boostT;
    this.invuln = Math.max(this.invuln, 0.9);
    game.onOverdrive(this);
  }

  /** 续关复活：满血回来，保留火力/武器/保险 */
  revive() {
    this.alive = true;
    this.lives = CONTINUE.lives;
    // 保险补满：命是续关买的，进来时空着手等于逼玩家再死一次
    this.bombs = PLAYER.maxBombs;
    // 激光保险不补满（4 秒无敌 ×3 太强），只给一颗保底
    this.lasers = Math.max(this.lasers, 1);
    this.invuln = CONTINUE.invuln;
    this.hp = this.maxHp;
    this.canFire = true;
    this.boostT = 0;
    this.fireT = 0.25;
    this.shotQ = [];              // 阵亡前没发完的连珠子弹不要带进新命
    this.x = VIEW.w / 2;
    this.y = PLAY_BOTTOM - 80;
    this.t = 0;
  }

  /** 重生：被打爆后重新放一架"裸机"回战场（剩余命数不在这里改，扣命是 _destroy 做的）。
   *  火力/武器/保险全部回到开局状态（装备已经作为道具散落在爆机点了，
   *  接不接得回来靠玩家自己跑过去），僚机与环绕机同理。 */
  respawn() {
    this.alive = true;
    this.canFire = true;
    this.hp = this.maxHp;
    this.invuln = PLAYER.respawnInvuln;
    this.boostT = 0;
    this.fireT = 0.25;
    this.shotQ = [];
    this.x = VIEW.w / 2;
    this.y = PLAY_BOTTOM - 80;
    this.t = 0;
    this.weapons = [0];
    this.lv = [PLAYER.startPower];
    this.slotT = [0];
    this.options = [];
    this.orbits = [];
    this.orbitBoostT = 0;
    this.bombs = PLAYER.bombs;
    this.lasers = 0;
    this.shield = null;
    this.tempWpns = [];
    this.tempAlly = null;
  }

  /** 挨打：先掉血，血掉完才炸机扣命。
   *  dmg 由调用点按来源给（普通弹 26 / 大弹 34 / 撞机 40），不传就按普通弹算。 */
  hit(game, dmg) {
    if (this.invuln > 0 || !this.alive) return false;
    this.hp -= (dmg === undefined ? PLAYER.bulletDmg : dmg);
    this.invuln = PLAYER.hitInvuln;
    SFX.playerHit();
    /* 受击反馈：震屏给到 0.46 秒（默认 0.32 太短，玩家还没意识到挨枪就结束了），
     * 半径 18 震不出"被撞了一下"的重量感；爆炸也放大一圈，让机位一眼可见。 */
    game.shake(26, 0.46);
    game.onPlayerHurt();
    // 掉血也要有机体反馈：小爆炸 + 闪白，否则玩家只看 HUD 血条会"不知道自己挨了"
    game.explode(this.x, this.y, 0.9, '#7fd6ff', 14);
    /* 受击惩罚（3.42）：1 号位（主武器槽）火力 **-1 级**。
     * 3.40 写的是"一次到底"（直接按回 L1），实测太狠：血量制下 1.6 秒无敌只挡住
     * 连扣，挡不住"一发弹把三关攒的火力线抹平"，中弹一次就得重新捡一路 W 回来。
     * 现在改成只掉一级——代价仍然明确（L5 挨一发变 L4，掉到 L1 要挨四下），
     * 但不会因为一次走位失误把整局节奏推翻。
     * 只动 `lv[0]`：惩罚落在"主武器这个位置"上，副位原样，玩家可以切枪继续打。
     * 已经是 L1 就不扣（没有可降的空间），也不弹提示。
     * 这一发致命时跳过：爆机本来就有"扣命 + 散落降 1 级"两重代价，
     * 再叠一次等于同一颗弹罚两遍。 */
    if (this.hp > 0 && this.lv && this.lv.length > 0) {
      const cur = this.lv[0] || PLAYER.startPower;
      if (cur > PLAYER.startPower) {
        const next = Math.max(PLAYER.startPower, cur - 1);
        this.lv[0] = next;
        game.onWeaponLevelDrop(this, 0, cur, next);
      }
    }
    if (this.hp <= 0) {
      this.hp = 0;
      this._destroy(game);
    }
    return true;
  }

  /** 血掉光：扣命 + 把身上的装备变成道具散落，机体交给 Game 走"爆炸 → 重生/结算" */
  _destroy(game) {
    this.alive = false;
    this.canFire = false;
    this.lives -= 1;
    /* 最后一架不散落：这一局已经结束，掉落没人能捡，只会在结算页后面飘着；
     * 而且续关（revive）按老规矩保留火力，散落了反而变成"原地多出一份装备"。 */
    if (this.lives > 0) game.dropLoadout(this);
    // 临时增益不跟到新命：护盾/临时武器/临时僚机是"这一段战斗的战术优势"
    this.shield = null;
    this.tempWpns = [];
    this.tempAlly = null;
    this.options = [];
    this.orbits = [];
    game.onPlayerDying();
  }

  draw(ctx) {
    if (!this.alive) return;
    /* 血量制之后每次中弹只有 hitInvuln（1.2s）无敌，若每次都按 22Hz 闪，
     * 弹幕密的时候机身在半秒里"半隐身"，反而看不清自己的位置。
     * 所以只有"重生 / 续关 / 保险"这种长无敌才闪，短无敌靠下面那圈护罩表达。 */
    const blink = this.invuln > PLAYER.hitInvuln && Math.floor(this.t * 22) % 2 === 0;

    /* 引擎尾焰：**一条**（3.56）。
     * 原来按 [-6, +6] 画两条，读起来是双发——但贴图的喷口只有一个（`nozzle(0.50)`，
     * 居中的 0.035 宽），两条焰没有对应的机体结构；而且标题页那架是居中单条锥形，
     * 同一架飞机在标题页和在游戏里长得不一样，是最容易被察觉的一种"不对劲"。
     * 长度/宽度回到标题页的比例（宽约贴图宽的 1/4、长约 2/3 机高），
     * 起点仍然贴住喷口（贴图高度 0.95 处，缩放 0.76 后是 y+16）。 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flick = 1 + Math.sin(this.t * 40) * 0.16;
    const flameLen = 23 * flick;
    const grd = ctx.createLinearGradient(this.x, this.y + 16, this.x, this.y + 16 + flameLen);
    grd.addColorStop(0, 'rgba(180,250,255,0.95)');
    grd.addColorStop(0.5, 'rgba(90,200,255,0.45)');
    grd.addColorStop(1, 'rgba(40,120,255,0)');
    ctx.fillStyle = grd;
    ctx.beginPath();
    ctx.moveTo(this.x - 4.6, this.y + 16);
    ctx.lineTo(this.x + 4.6, this.y + 16);
    ctx.lineTo(this.x, this.y + 16 + flameLen);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // 绘制时缩到 0.76（52 → 40），素材本身不动：
    // 改素材会重新排布整张图集，坐标一变、缓存没跟上就会全屏错位。
    Assets.draw(ctx, 'player', this.x, this.y, 0.76, blink ? 0.32 : 1);

    /* 判定核心（3.56）：真正会吃伤害的只有以 `(x, y)` 为心、`PLAYER.hitR`（6px）为半径的
     * 那一小块，可是正常游戏里除了调试层（`_drawHitboxes` 的红圈）没人看得见它——
     * 玩家只能靠"机身边缘好像算"这种印象去躲弹，挨打时会觉得"明明擦过去了"。
     *
     * 这里把这块直接画成机身上的亮核，三个目的：
     *  · **亮 = 会掉血**，弹幕贴上来时能看清"子弹已经进了判定圈"；
     *  · 尺寸直接取 `PLAYER.hitR`，判定改了视觉自动跟着改，不再有两套尺寸；
     *  · 边界给一圈实线——玩家能量出"刚好擦过去"的余量，而不是凭感觉。
     * 不用 createRadialGradient：玩家只有一个，但每帧新建渐变是这套代码里
     * 最容易悄悄吃掉帧数的写法，三层同心圆的观感已经够柔。 */
    {
      const r = PLAYER.hitR;
      const A = blink ? 0.32 : 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      /* 分三层，全部压得很淡：机身本身是浅青，`lighter` 下稍微重一点就整块洗白，
       * 读起来不是"核心亮"而是"贴图掉了一块"。 */
      ctx.fillStyle = '#8fdcff';
      for (const [k, a] of [[1.75, 0.055], [1.15, 0.10]]) {
        ctx.globalAlpha = A * a;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r * k, 0, Math.PI * 2);
        ctx.fill();
      }
      // 边界：这一圈是"量尺寸"的，比填充重，但要细
      ctx.globalAlpha = A * 0.55;
      ctx.strokeStyle = '#d8f6ff';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.stroke();
      // 中心一点白：脉动，提示"这里是会掉血的那一点"
      ctx.globalAlpha = A * (0.42 + Math.sin(this.t * 5.5) * 0.10);
      ctx.fillStyle = '#f4feff';
      ctx.beginPath();
      ctx.arc(this.x, this.y, r * 0.40, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

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

    /* 无敌护罩：受击 / 重生 / 保险期间，玩家必须能一眼看出"现在吃弹不疼"。
     * 单圈细线在弹幕里会被误当成背景装饰，改成内实外虚的双层环 + 反向旋转；
     * 最后 0.6 秒开始闪烁，提示无敌即将结束（否则玩家会按"还在无敌"去撞弹）。 */
    if (this.invuln > 0) {
      const fade = this.invuln < 0.6 && Math.floor(this.t * 18) % 2 === 0 ? 0.3 : 1;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (0.45 + Math.sin(this.t * 14) * 0.16) * fade;
      ctx.strokeStyle = '#8fe8ff';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 26, 0, Math.PI * 2);
      ctx.stroke();

      ctx.globalAlpha = (0.34 + Math.sin(this.t * 9 + 1) * 0.10) * fade;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([9, 9]);
      ctx.lineDashOffset = -this.t * 26;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 33, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    this._drawShield(ctx);
    this._drawOptions(ctx);
    this._drawTempAlly(ctx);
    this._drawOrbits(ctx);
  }

  /** 护盾：机头前方的半椭圆挡板。耐久越低越红，挡下子弹的瞬间整片闪白。
   *  画半椭圆而不是整只椭圆：整只读起来像"包住机头的气泡"，玩家会以为背后也安全；
   *  只留上半个 + 一条平的截口，才读作"一面朝向弹幕的盾"。
   *  判定是 TEMP.shield 的 rx/ry（上半个），这里画得略大一圈，视觉上"罩住"机头。 */
  _drawShield(ctx) {
    const s = this.shield;
    if (!s) return;
    const C = TEMP.shield;
    /* 挡弹抖动：盾面整体抖，机身不动。
     * 判定用的是 Player.x/y 原值，这里只挪画面——所以"抖"不会让玩家的
     * 手感边界发生变化（差 3px 就躲过/没躲过一颗弹，是这套玩法最不能漂移的东西）。 */
    let jx = 0, jy = 0;
    if (s.jit > 0) {
      const k = s.jit / C.jit;
      jx = rand(-1, 1) * C.jitAmp * k;
      jy = rand(-1, 1) * C.jitAmp * k * 0.55;   // 纵向收一半：横向"震"，纵向"晃"
    }
    const cx = this.x + jx;
    const cy = this.y - C.oy + jy;
    const k = Math.max(0, s.hp / s.max);            // 1 → 0
    const hot = s.hitT > 0;
    const rgb = hot ? '255,255,255'
      : (k > 0.5 ? '150,226,255' : (k > 0.25 ? '255,208,120' : '255,110,110'));
    const rx = C.rx * 1.16;
    const ry = C.ry * 1.12;
    const A0 = Math.PI, A1 = Math.PI * 2;          // canvas 的 0 在右侧，上半圈是 π→2π

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // 内部辉光：只填上半个。closePath 补出的那条直线就是盾的截口
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    g.addColorStop(0, 'rgba(' + rgb + ',' + (hot ? 0.55 : 0.24 + k * 0.12).toFixed(2) + ')');
    g.addColorStop(0.7, 'rgba(' + rgb + ',0.06)');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, A0, A1);
    ctx.closePath();
    ctx.fill();

    // 外缘：剩余时间不足 5 秒开始闪，提醒"要过期了"
    const blink = s.t < 5 ? (0.45 + Math.sin(this.t * 18) * 0.35) : 0.85;
    ctx.globalAlpha = hot ? 1 : blink;
    ctx.strokeStyle = 'rgba(' + rgb + ',0.95)';
    ctx.lineWidth = hot ? 2.6 : 1.8;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, A0, A1);
    ctx.stroke();

    // 截口：没有这条平线，半椭圆会被读成"拱门"或"半个气泡"，
    // 有了它才是"一面挡在前方的板"——也正是玩家该理解的功能边界
    ctx.globalAlpha = (hot ? 0.95 : blink) * 0.6;
    ctx.lineWidth = hot ? 2.2 : 1.4;
    ctx.beginPath();
    ctx.moveTo(cx - rx, cy);
    ctx.lineTo(cx + rx, cy);
    ctx.stroke();

    // 内侧弧：做出"能量层有厚度"的感觉（原来是气泡的赤道线）
    ctx.globalAlpha = (hot ? 0.9 : blink) * 0.5;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx * 0.84, ry * 0.6, 0, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.restore();
  }

  /** 临时僚机：紫色光球，配色和正式僚机（青色）区分开 */
  _drawTempAlly(ctx) {
    const a = this.tempAlly;
    if (!a) return;
    // 剩不到 3 秒开始闪，提示"这架要走了"
    const blink = a.t < 3 ? (0.4 + Math.sin(this.t * 20) * 0.35) : 1;

    ctx.save();
    ctx.globalAlpha = blink;
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(a.x, a.y, 0, a.x, a.y, 30);
    g.addColorStop(0, 'rgba(190,150,255,0.42)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(a.x, a.y, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = blink;
    // 尾焰
    ctx.globalCompositeOperation = 'lighter';
    const len = 12 + Math.sin(this.t * 34) * 3;
    const fg = ctx.createLinearGradient(a.x, a.y + 8, a.x, a.y + 8 + len);
    fg.addColorStop(0, 'rgba(220,190,255,0.85)');
    fg.addColorStop(1, 'rgba(120,80,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(a.x - 4, a.y + 8);
    ctx.lineTo(a.x + 4, a.y + 8);
    ctx.lineTo(a.x, a.y + 8 + len);
    ctx.closePath();
    ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(16,8,30,0.92)';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c9b0ff';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#f0e8ff';
    ctx.beginPath();
    ctx.arc(a.x, a.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
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

/* ---------------------------------------------------------------- 队友 */
/* 由 AI 驾驶的第二架飞机（3.73）。它不是"第二条命"：
 * 不进武器 / 道具体系、带不进下一关、玩家不能操作，只在命数封顶后出现。
 *
 * 为什么直接复用 `Player.prototype.fireFrom`：队友换一把枪的手感必须和玩家
 * 换一把枪一致——弹道、错峰、每级伤害表全部同一套。自己再写一份简化弹道，
 * "队友的散射炮"和"玩家的散射炮"就会长得不一样，玩家一眼能看出来。
 * 代价只有两个：补上 fireFrom 会读的 `shotQ` / `boostT` 两个字段
 * （方法直接指向 Player 的原型实现，见类尾）。
 */
class Ally {
  constructor() {
    this.active = false;
  }

  /** 性格色：机身环、血条、爆机粒子共用这一份，避免三处各写一个色值 */
  get col() { return ALLY.color[this.kind] || '#9fe8ff'; }

  init(game, kind) {
    this.active = true;
    this.alive = true;
    this.kind = kind || pick(ALLY.kinds);
    /* camp 守哪一边用随机而不是"按召唤顺序左右交替"：
     * 交替的话连点三次调试按钮永远得到 左 / 右 / 左，右侧的表现根本测不到。 */
    this.side = this.kind === 'camp' ? (Math.random() < 0.5 ? -1 : 1) : 0;

    this.maxHp = PLAYER.hp * ALLY.hpMul;
    this.hp = this.maxHp;

    // 从屏幕下方飞入：x 贴着玩家但不重合，否则一出来就叠在机身上
    this.x = clamp(game.player.x + rand(-100, 100), 56, VIEW.w - 56);
    this.y = VIEW.h + 56;

    this.t = 0;
    this.phase = rand(0, Math.PI * 2);
    this.hitT = 0;              // 白闪计时（绘制用）
    this.invT = 0;              // 受击短无敌（判定用），两者刻意分开
    this.ramT = 0;              // 撞机冷却（3.76）：和受击无敌分开，见 ALLY.ramT
    this.entered = false;       // 还没升进画面：这一阶段只走"从下往上"
    this.boostT = 0;            // fireFrom 会读它（全弹发射的射速强化），队友永远没有
    this.roamDir = Math.random() < 0.5 ? -1 : 1;

    const pool = ALLY.loadout[this.kind] || ALLY.loadout.follow;
    this.weapons = pool.slice();
    this.lv = pool.map(() => randInt(1, ALLY.maxPower));
    this.slotT = pool.map(() => rand(0.15, 0.5));
    this.shotQ = [];            // fireFrom 的错峰队列
  }

  update(dt, game) {
    if (!this.alive) return;
    this.t += dt;
    if (this.hitT > 0) this.hitT -= dt;
    if (this.invT > 0) this.invT -= dt;
    if (this.ramT > 0) this.ramT -= dt;
    this._move(dt, game);
    this._fire(dt, game);
  }

  /* ---------------- 走位 ----------------
   * 三种性格共用同一套"朝目标点按速度移动"，区别只在目标点怎么算。
   * 不用 lerp：lerp 的速度与距离成正比，玩家冲起来时队友会被甩掉，
   * 而 follow 的全部价值就是"一直在你旁边"。 */
  _move(dt, game) {
    const p = game.player;
    let tx = this.x, ty = this.y;

    if (!this.entered) {
      /* 入场段：先从屏幕下方升到工作高度，再切性格走位。
       * 直接切的话，camp 型会在屏幕外就横着飘到角落去，
       * 玩家只看到"我招了个队友，然后它没了"。 */
      tx = clamp(p.x + (this.x < p.x ? -90 : 90), 56, VIEW.w - 56);
      ty = PLAY_BOTTOM - 120;
      if (this.y <= ty + 6) this.entered = true;
    } else if (this.kind === 'follow') {
      // 绕玩家慢慢公转：半径为 followDist，圆心略高于机身
      const ang = this.t * 0.85 + this.phase;
      tx = p.x + Math.cos(ang) * ALLY.followDist;
      ty = p.y - 34 + Math.sin(ang) * 30;
    } else if (this.kind === 'roam') {
      // 横向匀速扫，碰到近边反弹：它要主动"迎上"弹幕，而不是躲
      this.x += this.roamDir * ALLY.roamSpeed * dt;
      if (this.x < 74) { this.x = 74; this.roamDir = 1; }
      if (this.x > VIEW.w - 74) { this.x = VIEW.w - 74; this.roamDir = -1; }
      tx = this.x;
      ty = ALLY.roamY + Math.sin(this.t * 0.7 + this.phase) * ALLY.roamAmp;
    } else {
      // camp：飞到自己那一侧的角落，之后只做小幅呼吸
      tx = this.side < 0 ? ALLY.campX + 40 : VIEW.w - ALLY.campX - 40;
      ty = PLAY_BOTTOM - ALLY.campY + Math.sin(this.t * 1.1 + this.phase) * 10;
    }

    const dx = tx - this.x, dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d > 0.6) {
      const sp = (this.entered ? ALLY.speed : ALLY.enterSpeed) * dt;
      const step = Math.min(d, sp);
      this.x += (dx / d) * step;
      this.y += (dy / d) * step;
    }
    this.x = clamp(this.x, 24, VIEW.w - 24);
    // 下界给到屏幕外一点：入场那一段本来就在画面外，夹进画面会变成"瞬移出现"
    this.y = clamp(this.y, PLAY_TOP + 52, VIEW.h + 70);
  }

  /* ---------------- 开火 ---------------- */
  _fire(dt, game) {
    for (let i = 0; i < this.weapons.length; i++) {
      this.slotT[i] -= dt;
      if (this.slotT[i] > 0) continue;
      const wi = this.weapons[i];
      this.slotT[i] = WEAPONS[wi].cd * ALLY.cdMul;
      /* `_shotMul` 必须在调用前后存 / 取：fireFrom 会把它设成队友的倍率且不还原，
       * 之后玩家那些**不经过 fireFrom** 的子弹（三把临时武器）就会吃到 0.6 折扣。
       * 队列入队时已经把倍率捕获进 `s.mul`，所以这里恢复外层值不影响到队友自己。 */
      const prev = game._shotMul;
      Player.prototype.fireFrom.call(this, game, this.x, this.y - 18,
        ALLY.dmgMul, this.lv[i], wi, true);
      game._shotMul = prev;
    }
    this._flushShots(dt, game);
  }

  /* ---------------- 受伤 / 阵亡 ---------------- */
  hit(game, dmg) {
    if (!this.alive) return false;
    /* 短无敌期（3.74）：子弹仍然被吃掉、但不扣血。
     * 吃弹是队友存在的意义（"吸引火力"的物理形式），所以这里不能像玩家那样
     * 把判定放到碰撞层去 `continue`；只扣血那一半跳过。
     *
     * 无敌期必须留一点火花：碰撞层已经把 `b.active = false`，什么都不画的话
     * 子弹撞上去凭空消失，读起来像判定卡了。用冷青色和扣血的白色区分——
     * "这一发被盾弹开了"和"这一发真打进去了"是玩家要能分开的两件事。 */
    if (this.invT > 0) {
      game.addParticle(this.x, this.y, {
        vx: rand(-30, 30), vy: rand(-40, -6), life: 0.16, r: 2.2, color: '#cfefff'
      });
      return false;
    }
    this.hp -= dmg;
    this.invT = ALLY.hitInvuln;
    this.hitT = ALLY.flashT;
    game.addParticle(this.x, this.y, {
      vx: rand(-40, 40), vy: rand(-60, -10), life: 0.22, r: 3, color: '#ffffff'
    });
    if (this.hp <= 0) this.destroy(game);
    return true;
  }

  destroy(game) {
    if (!this.alive) return;
    this.alive = false;
    this.active = false;
    game.explode(this.x, this.y, 1.5, this.col, 26);
    game.explode(this.x, this.y, 0.8, '#ffffff', 12);
    SFX.explode(false);
    game.onAllyLost(this);
  }

  /* ---------------- 绘制 ---------------- */
  draw(ctx) {
    if (!this.active) return;
    const col = this.col;

    // 尾焰：比玩家的短一截，机身也比玩家小一圈——同款飞机也要能一眼分出"这不是我"
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const flick = 1 + Math.sin(this.t * 38 + this.phase) * 0.16;
    const len = 16 * flick;
    const g = ctx.createLinearGradient(this.x, this.y + 12, this.x, this.y + 12 + len);
    g.addColorStop(0, 'rgba(200,245,255,0.8)');
    g.addColorStop(1, 'rgba(60,140,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(this.x - 3.2, this.y + 12);
    ctx.lineTo(this.x + 3.2, this.y + 12);
    ctx.lineTo(this.x, this.y + 12 + len);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    Assets.draw(ctx, 'player', this.x, this.y, 0.62, this.hitT > 0 ? 0.55 : 1);

    /* 性格色细环：三种队友在混战里只靠机身是分不出来的（贴图完全一样）。
     * 环压在机身外圈、alpha 0.35 上下，和护盾 / 蓄力环不会重样。 */
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.30 + Math.sin(this.t * 3.2 + this.phase) * 0.08;
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(this.x, this.y, 19, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    /* 无敌环（3.74）：向外扩散一圈冷白，读作"刚挨了一下、正在弹开"。
     * 光靠机身闪一帧不够——弹幕密的时候玩家注意不到，
     * 而"它现在打不动"正是决定"能不能往它身后躲"的信息。
     * 半径 22→30、alpha 同步衰减，是一圈推开的冲击波；
     * 起点必须**明显大于性格色环（19）**，否则两环重合，
     * 挨打只表现为"环忽然亮了一点"，玩家分不出"它现在打不动"。 */
    if (this.invT > 0) {
      const k = this.invT / ALLY.hitInvuln;      // 1 → 0
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.85 * k;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.arc(this.x, this.y, 22 + (1 - k) * 8, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* 血条画在机身上方：队友是"替玩家挨打"的单位，看不见它还剩多少血，
     * 玩家就没法判断"该不该往它身后躲"。宽度只有 34px——它是参照物，不是 HUD。 */
    const w = 34, k = Math.max(0, this.hp / this.maxHp);
    const by = this.y - 26;
    ctx.fillStyle = 'rgba(6,14,22,0.72)';
    ctx.fillRect(this.x - w / 2, by, w, 3);
    ctx.fillStyle = k > 0.35 ? col : '#ff7a7a';
    ctx.fillRect(this.x - w / 2, by, w * k, 3);
  }
}

/* fireFrom 依赖这两个方法把连发弹排进错峰队列，直接指向 Player 的实现，
 * 不复制代码——以后改错峰节奏（比如火神炮的 0.042s）队友会自动跟上。 */
Ally.prototype._queueShot = Player.prototype._queueShot;
Ally.prototype._flushShots = Player.prototype._flushShots;

/* ---------------------------------------------------------------- 敌机 */
class Enemy {
  constructor() {
    this.active = false;
  }

  init(kind, x, y, opt) {
    opt = opt || {};
    const def = ENEMY_DEFS[kind];
    const sz = Assets.size(def.sprite);
    this.seq = ++ENEMY_SPAWN_SEQ;   // 追踪弹靠它识别"这只还是不是原来那一只"
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
      // 机型可以覆盖倍率：电鳗基数只有 34，全局 3.2 倍撑不起"精英"这个身份（见 config 注释）
      this.hp = Math.round(this.hp * (def.eliteHpMul || ELITE_HP_MUL));
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
    /* 射速可被**单只覆盖**（opt.fire，3.62）：BOSS 召唤的小 BOSS 要和巡逻的同名机型
     * 打不同的节奏，改 ENEMY_DEFS.miniboss.fire 会把第 3~5 关的整波小 BOSS 一起改掉。
     * 存成实例字段而不是去拼 def 副本：下面 9 处开火分支都读 this.fireCd，
     * 只改 def 的话这些分支还读着旧值，表现为"配了没生效"。 */
    this.fireCd = opt.fire || def.fire || 0;
    this.fireT = this.fireCd ? rand(0.7, this.fireCd) : 999;
    /* 敌机激光（3.68）：模式参数取 ENEMY_LASER.modes[mode]，机型可以逐字段覆盖
     * （laser.fire / width / dmg / charge），这样"某只的光柱更粗"不用改全局档位。
     *
     * **池对象，五个字段必须逐项复位**：laserState 留成 2 会让新复用的敌机
     * 一出生就顶着上一只的光柱（判定还真的算数）；laserCd 留成负数会立刻开火。
     * 冷却起点给随机：同批轰炸机同时进屏时，一起蓄力会变成一排同时落下的栅栏，
     * 读不出"谁在瞄我"。 */
    /* 光柱按关卡**点名**开启（3.81）：`laser.stages` 是关卡白名单。
     *
     * 3.69 用的 `from`（从第几关起解锁）有个静默放大的问题：一旦解锁，
     * 这只机型**后面每一关出场都带光柱**——第 2 关教完轰炸机，第 3~9 关
     * 只要出轰炸机就是满屏竖线，光柱从"高级武器"变成了每关的背景。
     * 现在改成白名单：jelly [5,9] / heavy [5,7,9] / shield [9] / sniper [9]。
     * 同一只机型照样可以在别的关登场，只是不带光柱。
     *
     * 判据仍是"关卡信息缺失就放行"：BOSS 召唤的援军、测试脚本直接 `init()`
     * 都不传 stage，那些路径要维持原本行为（否则会在没传 stage 的地方
     * 静默失去激光）；只有主生成路径 `_spawnEnemy` 会传，配置才真正生效。
     * 反过来"缺省按第 1 关算"同样会让这些路径全部失去激光。 */
    const lz = def.laser;
    const unlocked = !lz ? false
      : (lz.stages
          ? (!opt.stage || lz.stages.indexOf(opt.stage) >= 0)
          : (!opt.stage || !lz.from || opt.stage >= lz.from));
    const ml = unlocked ? ENEMY_LASER.modes[lz.mode] : null;
    this.laserCfg = ml ? Object.assign({}, ml, def.laser) : null;
    this.laserState = 0;      // 0 空闲 / 1 蓄力 / 1.5 锁定 / 2 发射
    this.laserT = 0;
    this.laserAng = Math.PI / 2;
    this.laserCd = 0;
    if (this.laserCfg) {
      const lcd = this.laserCfg.cd || 6;   // 没配冷却也能量出来，别留 NaN（NaN 比较恒 false = 永不冷却）
      /* 首发冷却（3.71）：原来取 `rand(0.45cd, cd)`——狙击机 cd 7.6 秒，
       * 最快也要 3.4 秒后才开始蓄力，再加蓄力锁定发射 1.6 秒，5 秒才见光；
       * 而它从出生到能被玩家打到只用 0.9 秒，2.8 秒就被打碎了，
       * 光柱永远打不出来（实测 90 架里只有 1 架成功发射）。
       * 改成"1.8 秒 + 0~0.5 秒随机"：一露头两秒内就开始蓄力。
       * 随机量只用来错开同批几架，避免同时亮成一片栅栏。 */
      /* 教学波（`opt.intro`）仍用固定初值：首秀的两架要能**同时亮着**
       * 才有对照——一条在打、一条在预警。随机初值会让两架错开两三秒，
       * 结果画面里永远只有一条线，"两条并排"等于没做（3.70）。 */
      this.laserCd = opt.intro ? 1.4 : Math.min(lcd, 1.8) + rand(0, 0.5);
    }
    this.locked = false;
    this.vx = 0;
    this.vy = 0;
    this.flash = 0;
    this.rot = 0;
    /* 直射型（def.nonAim）的"前方"就是机头方向：只有从底部升起的单位朝上，
     * looper 掉头后由 _update 置 true。不要用 rot 反推——侧向入场时 rot 是斜的。 */
    this.faceUp = def.ai === 'riser';
    /* 双 U 巡航（3.54）：pathS 是沿路径走过的弧长，pathDir 是第一次转弯的方向。
     * 这两个必须逐项复位——池对象复用时会带着上一只的进度，表现为"刚出生就
     * 从屏幕中间拐弯"。 */
    this.pathS = 0;
    this.pathDir = opt.pathDir === 'left' ? -1 : 1;
    this.pathR = opt.pathR || 72;
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
    // 入场保护：还没完全进画面时不参与命中（见 ENTRY_GUARD）。
    // 与 spawnGuard 分工不同——spawnGuard 管"从底部升上来、已经在画面里但还没露头"，
    // 这一条管"从顶部/侧边刚生成、整队可能连贴图都没进画面"。
    this.entryT = 0;
    /* 蛇的部件不参与入场保护：位置由 game._updateSnake 沿路径统一写入，
     * 不满足"整只进入画面"的几何判定，会被判成永久免疫、整条打不掉。
     * 它们各自的 SPAWN_GUARD 已经覆盖出场那一段。 */
    this.entryDone = this.ai === 'snake';
    this.entryBuf = 0;
    /* 池复用残留必须逐项清掉：snakeLink 由 game.spawnSnake 在 init 之后置 true，
     * 而 draw() 见到它就整只跳过绘制（蛇要整体画成连续一条）。
     * 不清的话，第 8 关先跑过一波蛇、蛇被击破，池子里那 8 个对象再被复用成
     * BOSS 分身时就成了"看不见但打得掉"的幽灵——3.30 就是这个问题。 */
    this.snakeLink = false;
    this.segIdx = 0;
    this.off = 0;
    // 偏折面：耐久按"还能拨几发"算，拨空后进入 down 秒的真实受击窗口。
    // 不用"无限偏折"是有意的——正面锁死等于逼玩家绕后，那只是换皮的无敌怪。
    this.deflectHp = def.deflect ? def.deflect.cap : 0;
    this.deflectDown = 0;
    this.dflash = 0;
    /* 出场护盾（见 ENEMY_SHIELD）。计时不从这里开始，而是等入场保护结束
     * （entryDone 且 entryBuf 归零）——否则从底部升起的单位会把护盾全烧在
     * 屏幕外那段爬升里，玩家看到的是"一冒头盾就没了"。
     * 池对象必须逐项复位：漏一个就会出现"这一只没配置护盾、却顶着上一只的盾"。 */
    /* BOSS 召唤的援军一律不给盾：它们是"量"不是"质"，
     * 每只都套一层 180 血的壳，会让整段召唤节奏变成一堵墙。 */
    const es = opt.summoned ? null : ENEMY_SHIELD[this.kind];
    const smul = opt.shieldMul === undefined ? 1 : opt.shieldMul;
    this.shieldMax = es ? Math.round(es.hp * smul) : 0;
    this.shieldHp = this.shieldMax;
    /* 首发保底（3.71）：带激光的机型，护盾在"第一次蓄力开始"之前打不穿
     * （停在 1 点，见 hit）。这里同时把护盾时长拉到覆盖首发光柱——
     * 否则计时先到、盾自然消散，保底也就跟着没了。 */
    this.shieldHoldFirst = !!(es && es.holdFirst && this.laserCfg);
    let sdur = es ? es.dur : 0;
    if (this.shieldHoldFirst) {
      const lc = this.laserCfg;
      sdur = Math.max(sdur,
        this.laserCd + (lc.charge || 0.6) + (lc.lock || 0.2) + (lc.fire || 0.5) + 0.4);
    }
    this.shieldDur = sdur;
    this.shieldT = sdur;
    this.shieldHit = 0;      // 吸收伤害后的白闪
    this.shieldBreak = 0;    // 破盾瞬间的爆闪
    /* 突袭者（3.71）：0 下压 / 1 悬停喷火 / 2 撤离。
     * 三个状态字段逐项复位——池对象复用会带着上一只的进度，
     * 表现为"刚出生就在喷火"或"直接倒着往上飞"。 */
    this.raidState = 0;
    this.raidT = 0;
    this.raidBurst = 0;
    this.raidY = opt.raidY === undefined ? 300 : opt.raidY;
    // 冲角型小 BOSS：0 巡游 / 1 锁定 / 2 俯冲 / 3 归位
    this.ramState = 0;
    this.ramT = 0;
    this.ramVX = 0;
    this.ramVY = 0;
    this.ramTX = 0;
    this.ramTY = 0;
    this.centerX = opt.centerX === undefined ? VIEW.w / 2 : opt.centerX;
    this.sweep = opt.sweep === undefined ? 132 : opt.sweep;
    this.chargeState = 0;    // 0 常态 / 1 蓄力 / 2 冲刺 / 3 回气 / 4 离场
    this.chargeT = 0;
    this.diveD = 0;          // 本次俯冲已飞距离
    this.diveMax = 0;        // 冲到这个距离就算到位（按锁定时的间距算）
    /* 俯冲次数上限：普通机 def.dives、精英机 def.eliteDives。没配就是不限次数，
     * 别默认 0——那会让"忘记配置"变成"一出生就离场"，这种静默失效最难查。 */
    this.diveLeft = this.elite ? (def.eliteDives || def.dives || Infinity) : (def.dives || Infinity);
    this.cvx = 0;
    this.cvy = 0;
    this.active = true;
  }

  update(dt, game) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    if (this.spawnGuard > 0) this.spawnGuard -= dt;
    if (this.ai !== 'snake') this._updateEntry(dt);
    if (this.dflash > 0) this.dflash -= dt;
    // 偏折面过载 → 计时结束自动充能。放在这里而不是判定里，
    // 否则一帧多颗子弹会把同一个计时器反复清零。
    if (this.deflectDown > 0) {
      this.deflectDown -= dt;
      if (this.deflectDown <= 0) {
        this.deflectDown = 0;
        this.deflectHp = this.def.deflect ? this.def.deflect.cap : 0;
      }
    }

    if (this.shieldHit > 0) this.shieldHit -= dt;
    if (this.shieldBreak > 0) this.shieldBreak -= dt;
    /* 出场护盾：入场保护（免疫 + 缓冲）彻底结束才开始倒计时。
     * 这样"保护 → 护盾"是连续的两段，玩家不会看到"能打了但盾已经没了"；
     * 从底部升起的单位也不会把整段护盾烧在屏幕外。 */
    if (this.shieldHp > 0 && !this.entryImmune && this.spawnGuard <= 0) {
      this.shieldT -= dt;
      if (this.shieldT <= 0) this._dropShield(game, false);
    }

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
    /* 激光蓄力/发射期间要压住机身（见下面的回写），先把 AI 跑之前的坐标记下来。
     * 用"把本帧位移缩到 hold 倍"而不是去改每个 AI 分支的移动量：
     * 这些分支各自推位置，逐个改等于九处都要记得这件事，迟早漏一处。 */
    const holdX = this.x;
    const holdY = this.y;

    switch (this.ai) {
      case 'straight':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 1.3 + this.phase) * 9;
        break;

      case 'shooter':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 1.1 + this.phase) * 14;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.inPlay(game) && this.y < VIEW.h * 0.75) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
          this.shoot(game, 'aim');
        }
        break;

      /* 狙击机：慢速下降、几乎不摆，只在屏幕上半部打一发狙击弹。
       * 比 shooter 更"稳"——它的威胁不在弹数，在你必须记住它在哪。 */
      case 'sniper':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.7 + this.phase) * 10;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.inPlay(game) && this.y < VIEW.h * 0.70) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
          this.shoot(game, 'snipe');
        }
        break;

      case 'bomber':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.8 + this.phase) * 26;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.inPlay(game) && this.y < VIEW.h * 0.7) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
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
        if (this.fireT <= 0 && this.inPlay(game) && this.hoverT < 10) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
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
       * 四段：0 爬行 → 1 蓄力 0.42s（原地抖动，给反应窗口）→ 2 直冲
       * → 3 回气 1s（上浮、机头回正），还有次数就再扑，次数用完顺着洋流离场。
       * 上限按 def.dives 走（精英用 eliteDives）：3.57 曾不设限，结果它贴着咬到死，
       * 玩家除了"先清掉它"没有第二种解法，节奏太赖。 */
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
            this.diveLeft--;                               // 蓄力结束、真的冲出去才记账
            const a = Math.atan2(p.y - this.y, p.x - this.x);
            const sp = this.def.diveSpeed || 430;
            this.cvx = Math.cos(a) * sp;
            this.cvy = Math.sin(a) * sp;
            /* 记下"冲到哪算冲到位"。原来固定飞满 1 秒，430px/s 会冲出去 430px——
             * 玩家只离它 150px 的话直接糊穿屏幕底边，收势时已经被判出场，
             * 于是永远只有第一扑。改成冲到目标点外一点点就收，才留得下第二次。 */
            this.diveD = 0;
            this.diveMax = Math.hypot(p.x - this.x, p.y - this.y) * 1.08 + 24;
          }
        } else if (this.chargeState === 2) {
          this.chargeT -= dt;
          const sp = Math.hypot(this.cvx, this.cvy);
          this.diveD += sp * dt;
          this.x += this.cvx * dt;
          this.y += this.cvy * dt;
          this.rot = Math.atan2(this.cvy, this.cvx) - Math.PI;
          this.x = clamp(this.x, 16, VIEW.w - 16);
          if (this.chargeT <= 0 || this.diveD >= this.diveMax || this.y > VIEW.h - 40) {
            this.chargeState = 3;
            this.chargeT = this.def.diveRest || 1.0;      // 两次俯冲之间的空档
            this.rot = 0;
          }
        } else if (this.chargeState === 3) {
          /* 回气：上浮而不是继续下坠。一是"冲完拉起来重新盘一圈"读得懂，
           * 二是冲刺常常一路冲到屏幕下半，继续下沉就再没有二次俯冲的空间。 */
          this.chargeT -= dt;
          this.y -= this.speed * 0.55 * dt;
          this.y = Math.max(this.y, PLAY_TOP + 40);
          this.rot = 0;
          if (this.chargeT <= 0) {
            if (this.diveLeft > 0 && p.alive && this.y < VIEW.h - 60) {
              this.chargeState = 0;
              this.baseX = clamp(this.x, 62, VIEW.w - 62);  // 摆幅 62，夹住才不会半个身子在屏外
              this.phase = -this.t * 2.2;                   // 正弦从 0 起步，复位瞬间不会横跳 62px
            } else {
              this.chargeState = 4;                        // 次数用完 / 玩家没了 / 到屏幕底边 → 离场
            }
          }
        } else {
          this.y += this.speed * 1.4 * dt;                // 离场
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

      /* 突袭者（3.71）：压到悬停高度 → 打四轮扇形弹 → 掉头撤离。
       * 不在悬停期加横向位移：那近两秒是玩家对着它倾泻火力的窗口，
       * 让它左右飘会把"能不能在窗口内打掉"变成运气，而不是火力分配。
       * 喷火节奏用 burst 计数而不是 fireCd——四轮打完就走，
       * 不需要"冷却"这个概念，也不需要 fireT 参与。
       * 四轮 × 5 发 = 20 发，1.4 秒打完，之后留 0.5 秒空窗再撤离：
       * "打完才走"必须留得住，否则玩家读到的是一串没有结尾的弹幕。 */
      case 'raider':
        if (this.raidState === 0) {
          this.y += this.speed * dt;
          if (this.y >= this.raidY) {
            this.y = this.raidY;
            this.raidState = 1;
            this.raidT = 0;
          }
        } else if (this.raidState === 1) {
          this.raidT += dt;
          // 每 0.35 秒一轮，第一轮在到位那一帧就打出去
          if (this.raidBurst < 4 && this.raidT >= this.raidBurst * 0.35) {
            this.shoot(game, 'fan5');
            this.raidBurst++;
          }
          if (this.raidT >= 1.9) {
            this.raidState = 2;
            this.rot = Math.PI;      // 机头翻转向上：撤离要看得出来是"掉头飞走"
          }
        } else {
          this.y -= this.speed * 1.5 * dt;
        }
        break;

      case 'heavy':
        this.y += this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 0.5 + this.phase) * 22;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.inPlay(game) && this.y < VIEW.h * 0.8) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
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
            this.faceUp = true;             // 直射型的"前方"跟着翻面（见 shoot）
          }
        } else {
          this.y -= this.speed * 1.08 * dt;
          this.x += clamp(p.x - this.x, -150 * dt, 150 * dt) * 1.3;
          this.fireT -= dt;
          if (this.fireT <= 0 && this.inPlay(game)) {
            this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
            this.shoot(game, 'aim');
          }
        }
        break;

      // 双 U 巡航（3.54）：压到底部掉头爬回上半屏，再掉头压下来。几何见 _patrolStep
      case 'patrol':
        this._patrolStep(dt, game);
        break;

      // 从屏幕底部升起，边上升边射击
      case 'riser':
        this.rot = Math.PI;
        this.y -= this.speed * dt;
        this.x = this.baseX + Math.sin(this.t * 1.5 + this.phase) * 26;
        this.fireT -= dt;
        if (this.fireT <= 0 && this.inPlay(game)) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
          this.shoot(game, 'aim');
        }
        break;

      // 中型机：底部升到顶部后开始巡游 + 三向散射
      case 'miniboss':
        // 冲撞型的状态机必须放在最前面：俯冲会让 y 越过 216，
        // 而下面那段 `y > 216` 是"还在从屏幕下方爬升"的判断，会把俯冲当成爬升拽回去，
        // 表现为原地上下抖动、永远冲不下来。
        if (this.def.mb === 'ram' && this.ramState !== 0) {
          this._ramMove(dt);
        } else if (this.y > 216) {
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
          if (this.fireT <= 0 && this.inPlay(game) && p.alive) {
            this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
            this._mbFire(game);
          }
        }
        break;
    }

    /* 敌机激光（3.68）：状态机排在 AI 之后——瞄准型的角度要用本帧坐标算；
     * 位移回写排在最后——蓄力/发射期间把机身吸回起点（发射期完全停），
     * 光柱才会停在一处形成"封锁线"，而不是跟着机身横扫成"扫射"。
     * 回写在状态推进之后：本帧刚进入蓄力也要立刻停住，否则第一帧仍会滑一小段。 */
    if (this.laserCfg) {
      this._laserStep(dt, game);
      if (this.laserState > 0) {
        const k = this.laserState === 2 ? 0 : (this.laserCfg.hold || 0);
        this.x = holdX + (this.x - holdX) * k;
        this.y = holdY + (this.y - holdY) * k;
      }
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
    /* 唯一的出手闸门（3.51）：所有开火路径都从这里出去，所以把"整只进画面"
     * 卡在这里，比在每个 AI 分支各写一份 `y > PLAY_TOP` 可靠——
     * 之前就是各写各的，新增机型时随手抄一个最松的门槛，弹幕又从 HUD 后面冒出来。 */
    if (!this.inPlay(game)) return;
    /* 直射型（3.53，`ENEMY_DEFS[].nonAim`）：不读玩家位置，只朝机头前方打。
     * 成排压过来的杂兵本来就该铺一堵墙；每发都拐向玩家的话，满屏子弹会拧成
     * 同一股流向，玩家横移一次就全躲开，也读不出"谁在瞄我"。
     * 追着打的留给 looper / riser / sniper / 小 BOSS —— 它们的定位就是"盯着你"。
     * 注意 snipe 不吃这个覆盖（狙击机没有配 nonAim，配了也会变成朝前打慢弹）。 */
    /* 敌人偶尔把枪口转向队友（3.75）：这是"吸引火力"的第二层——
     * 挡弹是被动吃掉打向玩家的弹，改瞄是**主动**把弹流引走。
     * 三条约束：
     *  1. 只给瞄准型（`!def.nonAim`）：直射型的语义是"成排压下来铺一堵墙"，
     *     让它拐弯去瞄队友，队形就读散了（那正是 3.53 加 nonAim 要解决的）；
     *  2. 狙击机（`snipe`）不参与：卖点是"慢起快收 + 看得见的准星"，
     *     拐向队友之后玩家根本不用躲，这套读招就废了；
     *  3. **每次开火 roll 一次**，不在弹与弹之间 roll —— 一组 fan3/fan5 是一次瞄准，
     *     逐发 roll 会让五发分裂成两个走向，读起来像乱打。
     * BOSS 的弹幕不在这里（走 `BOSS_PATTERNS` 的编排），刻意不参与：
     * 那是"读招"，不是"追人"。 */
    let tgt = p;
    if (!this.def.nonAim && mode !== 'snipe' && mode !== 'ring'
      && game.allies.length && Math.random() < ALLY.taunt) {
      const a = game.pickAllyTarget(this);
      if (a) tgt = a;
    }
    const ang = this.def.nonAim
      ? (this.faceUp ? -Math.PI / 2 : Math.PI / 2)
      : Math.atan2(tgt.y - this.y, tgt.x - this.x);
    const bx = this.x, by = this.y + this.h * 0.22;
    if (mode === 'aim') {
      game.spawnEnemyBullet(bx, by, Math.cos(ang) * 235, Math.sin(ang) * 235);
      SFX.enemyShoot();
    } else if (mode === 'aim2') {
      for (const off of [-16, 16]) {
        game.spawnEnemyBullet(bx + off, by, Math.cos(ang) * 250, Math.sin(ang) * 250);
      }
      SFX.enemyShoot();
    } else if (mode === 'snipe') {
      // 狙击弹：0.62 秒慢速滑行 + 沿发射方向猛加速。
      // 初速只有 96，这段时间足够玩家看清准星环并横移——
      // 它是"读招"型威胁，不是"反应不过来"型威胁。
      // 所以惩罚放在"站着不动"上：伤害单独走 PLAYER.snipeDmg（46），
      // 比普通弹重得多，躲开则零代价（3.38）。
      const sy = this.y + this.r * 0.72;
      game.spawnEnemyBullet(bx, sy, Math.cos(ang) * 96, Math.sin(ang) * 96, {
        kind: 'enemyAlt', r: 7, life: 9, dmg: PLAYER.snipeDmg,
        snipe: { delay: 0.62, speed: 720 }
      });
      SFX.snipeCharge();
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

  /** 敌机激光的三段状态机（3.68）。
   *
   *  0 空闲 → 1 蓄力（瞄准型缓慢跟随）→ 1.5 锁定（方向冻结 + 白闪）→ 2 发射
   *
   *  为什么不复用 `Boss._updateLaser`：那一套和护盾轮转、阶段切换、可破坏部件、
   *  退场全部缠在一起，硬抽出来会让两边都变脏；这里只有"方向 + 计时"两件事。
   *  但几条规矩是共通的：
   *    · 出手资格统一走 `inPlay()`，不在 AI 分支里另写 y 判断（3.51）；
   *    · 入场/登场保护期间不放——玩家还打不动它，光柱先落下来只会读成"作弊"；
   *    · 同屏条数有上限（`ENEMY_LASER.max`），否则一排轰炸机各来一条，
   *      屏幕变成栅栏，那不是"限制走位"而是"没有走位"。
   */
  _laserStep(dt, game) {
    const cfg = this.laserCfg;
    const p = game.player;

    if (this.laserState === 0) {
      this.laserCd -= dt;
      if (this.laserCd > 0) return;
      if (!p.alive || this.entryImmune || this.spawnGuard > 0) return;
      /* 但也不能在屏幕最顶上就开（3.71）：那时机身还压在 HUD 血条后面，
       * 玩家看得见光柱、看不见是谁放的。96px 约是 HUD 下沿，
       * 机身到这儿基本完整露出，光柱根部也对得上。
       * 狙击机 60px/s，从出生到 96px 约 2.6 秒，仍远早于它 7 秒的存活期。 */
      if (this.y < 96) return;
      /* 出手门槛（3.71）：这里**不再要求 `inPlay()`**（整只进可活动区）。
       * 光柱和弹幕不是一回事——它是一根从机身垂到屏幕底的线，机身还压在
       * HUD 后面时玩家照样看得见它封的是哪几列；而弹幕从 HUD 后面冒出来
       * 就完全读不出枪口在哪（那才是 3.51 要解决的问题）。
       * 实测差距：狙击机从出生飞到"整只进可活动区"要 4.5 秒，
       * 而它在满配火力下只活 2.8 秒——光柱永远打不出来。
       * 门槛收到 `entryImmune`（贴图露出四成 + 缓冲）为止：
       * 那正是"玩家已经能打到它"的时刻，不会出现"打不动的东西在放光柱"。 */

      /* 两道闸门（3.69）：同形态上限 + 全场总数上限。
       * 只留总数时，第 6 关十几架狙击机会把 3 个名额全占住——三条会转的
       * 瞄准线同时在场上，玩家找不到"站着就安全"的那一格。
       * 同形态上限按压迫强度分（ENEMY_LASER.modes[mode].max）。 */
      const load = game.enemyLaserLoad(cfg.mode);
      if (load.total >= ENEMY_LASER.max || load.same >= (cfg.max || ENEMY_LASER.max)) {
        this.laserCd = 0.5;      // 被限流：半秒后再问，别每帧扫一遍全场
        return;
      }
      this.laserState = 1;
      this.laserT = cfg.charge;
      /* 初始方向：瞄准型朝玩家；横向型朝玩家那一侧（side 实际是贯穿线，
       * 这个角度只影响蓄力光束从哪头亮起）；朝下型固定 +90°。 */
      if (cfg.mode === 'aim') this.laserAng = Math.atan2(p.y - this.y, p.x - this.x);
      else if (cfg.mode === 'side') this.laserAng = p.x >= this.x ? 0 : Math.PI;
      else this.laserAng = Math.PI / 2;
      SFX.laserCharge();
      return;
    }

    if (this.laserState === 1) {
      this.laserT -= dt;
      /* 蓄力跟随只有瞄准型会转，速率 cfg.track（rad/s）。
       * 0.9 rad/s 意味着 0.8 秒最多转 41°：斜着跑能甩开，站着不动一定被咬住。
       * 这就是"更高级一点"的全部内容——玩家必须读出它在转，再决定往哪让。 */
      if (cfg.mode === 'aim' && cfg.track > 0 && p.alive) {
        const want = Math.atan2(p.y - this.y, p.x - this.x);
        let diff = want - this.laserAng;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        this.laserAng += clamp(diff, -cfg.track * dt, cfg.track * dt);
      }
      if (this.laserT <= 0) {
        this.laserState = 1.5;
        this.laserT = cfg.lock;
        SFX.laserLock();
      }
      return;
    }

    if (this.laserState === 1.5) {
      this.laserT -= dt;
      if (this.laserT <= 0) {
        this.laserState = 2;
        this.laserT = cfg.fire;
        SFX.laserFire();
      }
      return;
    }

    this.laserT -= dt;
    if (this.laserT <= 0) {
      this.laserState = 0;
      this.laserCd = cfg.cd || 6;
    }
  }

  /** 激光线段：绘制、玩家判定、调试线框共用同一份坐标。
   *
   *  side 是从机身横贯到屏幕两侧的一整条——"把画面切一刀"才是它存在的意义；
   *  只朝一侧伸的话，玩家站在另一侧就完全不受影响，等于没放。 */
  laserSegs() {
    const cfg = this.laserCfg;
    if (!cfg || this.laserState <= 0) return null;
    if (cfg.mode === 'side') return [{ x1: 0, y1: this.y, x2: VIEW.w, y2: this.y }];
    return [{
      x1: this.x, y1: this.y,
      x2: this.x + Math.cos(this.laserAng) * ENEMY_LASER.range,
      y2: this.y + Math.sin(this.laserAng) * ENEMY_LASER.range
    }];
  }

  /** 敌机激光的绘制（3.68）：和 BOSS 激光同一套三段语法，但更细、更短、颜色不同。
   *
   *  颜色刻意取橙红而不是关卡色：玩家要能一眼分出"这是杂兵的光柱，可以硬顶"
   *  和"BOSS 那根又粗又长的得认真躲"。BOSS 用关卡的 accent，这里用固定暖色。
   *  不建渐变——同屏最多三条，纯色叠层已经够亮，省掉每帧几个 gradient 对象。 */
  _drawEnemyLaser(ctx) {
    const cfg = this.laserCfg;
    if (!cfg || this.laserState <= 0) return;
    const segs = this.laserSegs();
    if (!segs) return;
    const stroke = (w, style, alpha) => {
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style;
      ctx.lineWidth = w;
      for (const s of segs) {
        ctx.beginPath();
        ctx.moveTo(s.x1, s.y1);
        ctx.lineTo(s.x2, s.y2);
        ctx.stroke();
      }
    };

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    if (this.laserState === 1) {
      /* 蓄力：一根从炮口往外长出来的细线、而且是**虚线**。宽度只到 5px——
       * 它是"预告方向"，不是"已经在打"，所以不能和发射态一个量级。
       * 虚线是 3.70 补的：首秀波有两条并排的光柱（一条在打、一条要打），
       * 两条都是实线时玩家读不出差别，会以为"两列都已经封了"，
       * 于是不敢从中间那道缝里穿——而那道缝恰恰是唯一能站的地方。 */
      const k = 1 - this.laserT / cfg.charge;
      ctx.setLineDash([7, 9]);
      stroke(1.5 + k * 3.5, '#ff9a5a', 0.30 + k * 0.5);
      ctx.setLineDash([]);
      const r = 5 + k * 8;
      ctx.globalAlpha = 0.5 + k * 0.5;
      ctx.fillStyle = '#ffd2a8';
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }

    if (this.laserState === 1.5) {
      /* 锁定：白闪 + 快速脉动。这一段是玩家唯一的反应窗口，
       * 所以亮度必须明显高于蓄力，而且"闪"的节奏要快到不像呼吸。 */
      const k = 1 - this.laserT / cfg.lock;
      const blink = 0.55 + 0.45 * Math.sin(this.t * 30);
      stroke(3 + k * 5, '#ff5d5d', (0.35 + k * 0.45) * blink);
      stroke(1.2 + k * 2, '#ffffff', (0.60 + k * 0.40) * blink);
      ctx.restore();
      return;
    }

    /* 发射：0.1 秒由细变粗，末尾 0.16 秒淡出（和 BOSS 激光一致的做法——
     * 瞬间消失会像"判定漏了一帧"，快速淡出读作"能量收掉了"）。 */
    const elapsed = cfg.fire - this.laserT;
    const grow = Math.min(1, elapsed / 0.10);
    const w = cfg.width * (0.5 + 0.5 * grow);
    const fade = this.laserT < 0.16 ? Math.max(0.2, this.laserT / 0.16) : 1;

    /* 四层：外晕（让线在深色背景上有"能量"的外扩）+ 主体 + 暖芯 + 白芯。
     * 三层的时候线读起来像"贴了张橙色的纸条"，加一层低 alpha 的宽外晕才立起来。 */
    stroke(w * 1.9, 'rgba(255,90,40,0.55)', 0.26 * fade);
    stroke(w, 'rgba(255,120,70,0.90)', 0.72 * fade);
    stroke(w * 0.45, 'rgba(255,225,190,1)', 0.88 * fade);
    stroke(Math.max(1.5, w * 0.16), '#ffffff', fade);

    // 炮口光晕：两层实心圆，不用渐变
    ctx.globalAlpha = 0.5 * fade;
    ctx.fillStyle = 'rgba(255,180,120,0.9)';
    ctx.beginPath();
    ctx.arc(this.x, this.y, w * 0.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.9 * fade;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(this.x, this.y, w * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /** 双 U 巡航的路径推进（3.54）。
   *
   *  路径由 5 段拼成，**按弧长参数化**而不是按角度积分：积分的写法在掉帧时
   *  会画出半径不同的两个弯（每帧按 dt 转角，dt 抖动直接变成几何误差），
   *  按弧长走则"走过多少 px 就在第几段"，帧率只影响快慢、不影响轨迹。
   *
   *    1 直下    (x0, -72) → (x0, lowCy)
   *    2 下半圆  绕 (x0+dir·R, lowCy) 转 180°，出口朝上
   *    3 直上    (x0+dir·2R, lowCy) → (x0+dir·2R, highCy)
   *    4 上半圆  绕 (x0+dir·R, highCy) 转 180°，出口朝下
   *    5 直下    (x0, highCy) → 屏幕外
   *
   *  lowCy/highCy 是圆心：下弯最低点落在 0.78H、上弯最高点落在 0.24H。
   *  上弯顶点抬到 0.24H 而不是贴着 HUD，是因为 0.14H 附近会钻进血条下面——
   *  那一段玩家既打不到、也看不清它什么时候掉头。 */
  _patrolStep(dt, game) {
    const R = this.pathR;
    const dir = this.pathDir;
    const x0 = this.baseX;
    const lowCy = VIEW.h * 0.78 - R;       // 下弯圆心（最低点 = lowCy + R）
    const highCy = VIEW.h * 0.24 + R;      // 上弯圆心（最高点 = highCy - R）
    const L1 = lowCy + 72;                 // 屏幕顶外 72 → 下弯起点
    const L2 = Math.PI * R;
    const L3 = Math.max(0, lowCy - highCy);
    const s = (this.pathS += this.speed * dt);

    let x, y, dx, dy;
    if (s < L1) {                                   // 1 直下
      x = x0; y = -72 + s; dx = 0; dy = 1;
    } else if (s < L1 + L2) {                       // 2 下半圆
      const th = Math.PI - (s - L1) / R;
      x = x0 + dir * R * (1 + Math.cos(th));
      y = lowCy + R * Math.sin(th);
      dx = dir * Math.sin(th); dy = -Math.cos(th);
    } else if (s < L1 + L2 + L3) {                  // 3 直上
      x = x0 + dir * 2 * R;
      y = lowCy - (s - L1 - L2);
      dx = 0; dy = -1;
    } else if (s < L1 + L2 * 2 + L3) {              // 4 上半圆
      const th = -(s - L1 - L2 - L3) / R;
      x = x0 + dir * R * (1 + Math.cos(th));
      y = highCy + R * Math.sin(th);
      dx = dir * Math.sin(th); dy = -Math.cos(th);
    } else {                                        // 5 直下离场
      x = x0;
      y = highCy + (s - L1 - L2 * 2 - L3);
      dx = 0; dy = 1;
    }

    this.x = x;
    this.y = y;
    // 贴图默认机头朝下（rot=0），要让机头指向 (dx,dy)：rot = atan2(-dx, dy)
    this.rot = Math.atan2(-dx, dy);
    this.faceUp = dy < 0;

    /* 只在向下压的两段开火。拉起段枪口向上，从那儿吐弹看着像尾炮；
     * 转弯段枪口是横的，朝哪打都不对。留出这两段沉默，玩家能读出
     * "它冲下来才危险"，这套走位也不会变成一块持续输出的移动炮台。 */
    if (dy > 0.85) {
      const p = game && game.player;
      if (p && p.alive) {
        this.fireT -= dt;
        if (this.fireT <= 0 && this.inPlay(game)) {
          this.fireT = this.fireCd || 999;   // 没配射速的机型不开火（和之前的 undefined 等效，但不能留 0：0 会被判成"每帧都能开火"）
          this.shoot(game, 'aim');
        }
      }
    }
  }

  /** 小 BOSS 的开火分派：升起 / 巡游 / 血条都共用宿主流程，差异只在这里 */
  _mbFire(game) {
    const mb = this.def.mb;
    if (mb === 'sniper') { this.shoot(game, 'snipe'); return; }
    if (mb === 'prism') {
      // 棱镜：威胁来自"正面打不进去"，所以弹幕刻意做得很稀，只给慢速三向
      this.shoot(game, 'fan3');
      return;
    }
    if (mb === 'ram') {
      this.shoot(game, 'fan3');
      const p = game.player;
      this.ramState = 1;
      this.ramT = 0.7;
      this.ramTX = p.x;
      this.ramTY = p.y;
      SFX.laserLock();
      return;
    }
    this.shoot(game, 'fan5');
  }

  /** 冲角型小 BOSS 的机动：锁定 0.7s → 720px/s 俯冲 → 爬回原位。
   *  俯冲速度刻意高于玩家横移（330）的两倍：它必须逼玩家提前预判，
   *  而不是"看到冲下来再侧移"就能白躲。 */
  _ramMove(dt) {
    if (this.ramState === 1) {
      this.ramT -= dt;
      this.y -= 26 * dt;                 // 蓄势上抬，姿态上"退一步再撞"
      if (this.ramT <= 0) {
        const a = Math.atan2(this.ramTY - this.y, this.ramTX - this.x);
        this.ramVX = Math.cos(a) * 720;
        this.ramVY = Math.sin(a) * 720;
        this.ramState = 2;
        this.ramT = 1.3;
        SFX.enemyShoot();
      }
      return;
    }
    if (this.ramState === 2) {
      this.ramT -= dt;
      this.x = clamp(this.x + this.ramVX * dt, 30, VIEW.w - 30);
      this.y += this.ramVY * dt;
      if (this.ramT <= 0 || this.y > VIEW.h - 46) {
        this.ramState = 3;
        this.ramVX = 0;
        this.ramVY = 0;
      }
      return;
    }
    // 归位：300px/s 爬回去，比俯冲慢一截，留出"它要回来了"的反应时间
    this.y -= 300 * dt;
    this.x += (this.centerX - this.x) * Math.min(1, 4.0 * dt);
    if (this.y <= 216) {
      this.y = 216;
      this.x = this.centerX;
      this.ramState = 0;
      this.arriveT = this.t;             // 巡游相位归零，正好接回中心
      this.fireT = 2.2;
    }
  }

  /** 入场保护：整只（含贴图）进入可活动区之后，再按机型给一小段缓冲。
   *  缓冲的作用是"刚露头别立刻被爆发掉"——玩家满屏弹幕时，
   *  敌机往往在 y=-40 就被打死，编队永远排不出来，也看不到它们开火。
   *  entryT 有上限：横穿/绕边的单位可能一辈子不满足"完全进入"，不能因此永久无敌。 */
  _updateEntry(dt) {
    if (this.entryDone) {
      if (this.entryBuf > 0) this.entryBuf -= dt;
      return;
    }
    this.entryT += dt;
    const s = this.scale;
    const hh = this.h * s * 0.42;
    /* 判"已入场"的阈值取"贴图露出四成"，不是"整只进来"：
     * 顶部入场的单位在 y+hh>8 时横向本来就整只在屏内，所以下面这条只改到侧向入场的编队——
     * 它们原来要"整只横着进屏"才结束保护，那段贴边切入的时间里既打不动、
     * 又恰好是压制档允许开火的窗口（见 inPlay），就成了"打不到的敌机在铺弹幕"。
     * 用同一把尺子（露出 40%）把"打得到"和"能出手"对齐。
     * 仍保留 y 上的一条：从底部升起的单位在下沿进屏前不该被白打。 */
    const hwF = this.w * s * 0.5;
    const visW = Math.min(this.x + hwF, VIEW.w) - Math.max(this.x - hwF, 0);
    const inside = visW >= this.w * s * 0.40 &&
      this.y + hh > 8 && this.y + hh < VIEW.h + 40;
    if (inside || this.entryT >= ENTRY_GUARD.max) {
      this.entryDone = true;
      const b = ENTRY_GUARD.buf[this.kind];
      this.entryBuf = b === undefined ? ENTRY_GUARD.def : b;
    }
  }

  /** 入场保护期内免疫且不消耗子弹（子弹直接穿过，见 game._updateBullets） */
  get entryImmune() {
    return !this.entryDone || this.entryBuf > 0;
  }

  /** **出手资格**：默认要求整只（含贴图）都在可活动区里，才允许开火。
   *
   *  这条规则的来源：以前每个 AI 各写各的门槛，最松的一档是 `y > PLAY_TOP`——
   *  那只要求**圆心**越过 HUD 下沿，贴图上半截还压在血条后面。实测第 5 关的火焰机
   *  有 47/124 发、第 8 关有 43/83 发是在这种"半个身子还在 HUD 里"的状态下打出来的：
   *  玩家看到的就是"从我打不到的屏幕外射来一片弹幕"。
   *
   *  但"边缘铺弹幕墙"本身是有价值的关卡语言——它能把玩家往一侧挤，
   *  所以 3.52 起分两档，而不是一刀切：
   *    · 严格档（默认）：整只在可活动区内。
   *    · 压制档：`LEVELS[].edgeFire` 点名的机型，贴图探入可活动区达四成即可出手。
   *  压制档仍然守"看得见才打"：探入四成意味着枪口已经在视野里，
   *  弹不会从 HUD 后面凭空冒出来——这和原来的问题是两件事。
   *  白名单按关卡写，是因为这套打法只在"侧向压边"编排的关卡里成立；
   *  变成全场默认的话，每关顶部都挂着一层提前布好的弹，反而读不出谁在威胁你。 */
  inPlay(game) {
    const hw = this.w * this.scale * 0.5;
    const hh = this.h * this.scale * 0.5;
    if (this.x - hw >= 0 && this.x + hw <= VIEW.w &&
      this.y - hh >= PLAY_TOP && this.y + hh <= VIEW.h) return true;
    const lv = game && game.level;
    if (!lv || !lv.edgeFire || lv.edgeFire.indexOf(this.kind) < 0) return false;
    /* 打得到才允许出手：入场保护还没结束时不进这一档。
     * 否则又退回成"打不动的敌机在朝你铺弹幕"，那是 3.51 要解决的原问题。
     * 两边的判据都是"露出四成"，所以正常情况下这条只是兜底、不会真的卡住它。 */
    if (this.entryImmune) return false;
    /* 用"贴图与可活动区的重叠面积"而不是分别判上下左右：
     * 顶部入场看纵向探入、侧向入场看横向探入，同一段代码都对；
     * 对角切入（ltr/rtl）两个方向同时压着，面积比会自然更严格，不用另写一套。 */
    const x0 = Math.max(this.x - hw, 0), x1 = Math.min(this.x + hw, VIEW.w);
    const y0 = Math.max(this.y - hh, PLAY_TOP), y1 = Math.min(this.y + hh, VIEW.h);
    if (x1 <= x0 || y1 <= y0) return false;
    return (x1 - x0) * (y1 - y0) >= 4 * hw * hh * 0.40;
  }

  /** 卸下护盾。broken=true 是被打穿（给爆闪 + 碎裂音 + 轻震屏），
   *  false 是计时到点自然消散（只留一圈淡光）——否则玩家会觉得
   *  "我没打它，它自己炸了一下"，反而读不懂发生了什么。 */
  _dropShield(game, broken) {
    const x = this.x, y = this.y;
    this.shieldHp = 0;
    this.shieldT = 0;
    if (!broken) {
      this.shieldBreak = 0.18;
      return;
    }
    this.shieldBreak = 0.30;
    if (!game) return;
    game.explode(x, y, 1.0, '#a8ecff', 14);
    /* 震屏只给小 BOSS：后期同屏十几只中型机，每只破盾都震一下，
     * 屏幕会变成持续抖动，比"打不中"更难受。中型机的破盾靠粒子 + 音效就够了。 */
    if (isMiniKind(this.kind)) game.shake(5, 0.12);
    SFX.shieldBreak();
  }

  hit(dmg, bullet, game, opt) {
    if (this.spawnGuard > 0 || this.entryImmune) return false;   // 登场保护期内免疫
    /* 出场护盾：先吃伤害、本体不掉血，打空才轮到真伤。
     * 普通伤害**不溢出**：护盾的意义是"挡住一次爆发"，如果一发大弹能打穿薄盾
     * 顺带带走半条血，护盾在小 BOSS 身上就只剩一个延迟数字。
     *
     * 穿盾只认显式参数（3.39）。之前还额外用 `dmg >= 500` 兜底，本意是"防新调用点
     * 漏传参数"，实际却把保险（9999）永久钉成了穿透——一颗雷秒掉带盾小 BOSS，
     * 3.37 刚加的盾等于白加。这种"按数值大小偷偷改变规则"的兜底不能留：
     * 它不报错，只是让另一套机制静默失效。 */
    const pierce = !!(opt && opt.ignoreShield);
    if (this.shieldHp > 0 && !pierce) {
      const before = this.shieldHp;
      this.shieldHp -= dmg;
      this.shieldHit = 0.14;
      if (game) {
        // 火花打在盾面上而不是机体中心：玩家要能看出"打中的是盾"
        const a = Math.random() * Math.PI * 2;
        game.addParticle(this.x + Math.cos(a) * this.r * 0.9,
          this.y + Math.sin(a) * this.r * 0.9, {
            vx: rand(-50, 50), vy: rand(-70, -10), life: 0.22, r: 3,
            color: '#cdf4ff'
          });
      }
      if (this.shieldHp > 0) return false;
      /* 首发保底（3.71）：带激光的机型在**第一次蓄力开始之前**护盾不会被击穿，
       * 打空就停在 1 点。原因是实测过"光柱永远打不出来"——第 6 关 90 架
       * 狙击机里只有 1 架成功发射：它从出生到能出手要 4.5 秒，
       * 而满配火力 2.8 秒就能把它打碎。
       * 一旦 `laserState >= 1`（开始蓄力）这条就撤掉：蓄力/发射期间照样能被打断，
       * 否则它就成了一堵"无敌到放完招"的墙——那不是可读，是耍赖。
       * 视觉在 `draw()` 里单独画一个琥珀色"锁壳"，见 shieldHoldFirst。 */
      if (this.shieldHoldFirst && this.laserState === 0) {
        this.shieldHp = 1;
        return false;
      }
      this._dropShield(game, true);
      /* 溢出（3.39）：`opt.overflow` 是"破盾后本体最多吃多少比例的血"，
       * 目前只有保险传（bombShieldPass 0.30）。
       * 完全不给溢出 → 一颗雷打带盾单位只剩破盾，清场感全没；
       * 按剩余伤害全传 → 600 的雷能连盾带机一起带走，又回到"一发解决"。
       * 用比例封顶而不是绝对值：小怪（52 血）和小 BOSS（380 血）都被打掉三成，
       * 前者残血两枪收，后者不至于一发雷掉半条。 */
      const rest = Math.max(0, dmg - before);
      const cap = opt && opt.overflow ? this.maxHp * opt.overflow : 0;
      const spill = Math.min(rest, cap);
      if (spill <= 0) return false;
      this.hp -= spill;
      this.flash = 0.08;
      if (this.hp <= 0) {
        this.active = false;
        if (game) game.onEnemyKilled(this);
        return true;
      }
      return false;
    }
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

    /* 机型光环（def.aura）：高级电鳗用青环，和精英的金环分工明确——
     * 三档同族单位一眼分得开：无环 = 普通 / 青环 = 高级 / 金环 = 精英。
     * 只画细环不加填充，否则和护盾、蓄力环糊在一起。
     * 3.71 把亮度从 0.22 提到 0.34 并加粗到 2：突袭者的"金环 = 3600 分"
     * 是它唯一的价值提示，0.22 在密集弹幕里根本看不见（实测截图里读不出来）。 */
    if (this.def.aura) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.34 + Math.sin(this.t * 3.4) * 0.10;
      ctx.strokeStyle = this.def.aura;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.3, 0, Math.PI * 2);
      ctx.stroke();
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

    // 回气：冷色圈由外向内收，和红色蓄力圈一冷一热，预告"它还会再来一次"
    if (this.chargeState === 3) {
      const k = 1 - this.chargeT / (this.def.diveRest || 1.0);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.14 + k * 0.24;
      ctx.strokeStyle = '#7fe0ff';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * (3.1 - k * 1.0), 0, Math.PI * 2);
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

    // 入场保护：淡青光圈，告诉玩家"这一小会儿打不中"，
    // 否则子弹穿过去会被读成"判定漏了"。完全在画面外时不画——
    // 贴图都没露出来，画个圈反而像凭空冒光。
    const halfH = this.h * s * 0.5;
    if (this.entryImmune && this.y + halfH > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = this.entryBuf > 0
        ? Math.min(0.22, this.entryBuf * 0.9)
        : 0.16;
      ctx.strokeStyle = '#bfefff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(this.x, this.y, this.r * 1.35, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    Assets.draw(ctx, this.sprite, this.x, this.y, s, 1, this.rot);
    /* 激光画在贴图**之后**：蓄力期的炮口充能球是玩家唯一能提前看到的信号，
     * 压在贴图下面等于被自己的机身吃掉。压住机身中间一条也不难看——
     * 读起来就是"从炮口射出来的"。 */
    this._drawEnemyLaser(ctx);
    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      Assets.draw(ctx, this.sprite, this.x, this.y, s, 0.55);
      ctx.restore();
    }

    // 出场护盾：包住机体的六边形能量壳 + 外圈耐久弧。
    // 用六边形而不是圆，是为了和另外两圈区分开——入场保护是细圆环、
    // 玩家护盾是半椭圆，"能打穿的六边形壳"看一眼就知道是另一种东西。
    /* 入场保护期间不画护盾：那一段有自己的淡青细环，两圈叠在一起会读成噪点。
     * 护盾从"能被打中"的那一刻（entryImmune 结束）才出现，和计时起点一致——
     * 玩家看到的和判定用的是同一个时间点，不会出现"盾还没亮就先吸收了伤害"。 */
    if ((this.shieldHp > 0 && !this.entryImmune && this.spawnGuard <= 0) || this.shieldBreak > 0) {
      const alive = this.shieldHp > 0;
      const k = alive ? this.shieldHp / this.shieldMax : 0;
      const fade = alive ? 1 : clamp(this.shieldBreak / 0.30, 0, 1);
      /* 锁壳（3.71）：holdFirst 生效时（护盾被压到 1 点、还没开始蓄力），
       * 壳面从冷青转琥珀并脉动。不加这个表现的话，玩家看到的是
       * "盾已经空了却一直打不进去"，读起来像 bug；
       * 琥珀色同时是"它马上要放光柱"的提示，和光柱本身的暖色是同一套语言。 */
      const locked = alive && this.shieldHoldFirst && this.laserState === 0;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 9);
      // 半径取 r 而不是贴图外接盒：护盾是"能量壳"，跟着判定体走才对得上手感。
      // 纵向多给 18%，本作敌机多数是竖着的；正六边形套细长机身会横向撑得比机身宽，
      // 编队密集时十几个六边形连成一片，反而比不加盾更看不清机体。
      const R = this.r * 1.45 + 9;
      const RY = R * 1.18;
      const a0 = this.t * 0.8;
      const hexPath = (rx, ry) => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = a0 + i * Math.PI / 3;
          const px = this.x + Math.cos(a) * rx;
          const py = this.y + Math.sin(a) * ry;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
      };
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      // 壳面：越接近破碎越亮，读作"这层撑不住了"
      hexPath(R, RY);
      // 破盾瞬间整块转白并淡出，而不是"啪一下消失"
      ctx.fillStyle = alive
        ? (locked
          ? 'rgba(255,198,110,' + ((0.10 + 0.07 * pulse) * fade).toFixed(3) + ')'
          : 'rgba(130,220,255,' + ((0.05 + (1 - k) * 0.08) * fade).toFixed(3) + ')')
        : 'rgba(220,250,255,' + (0.20 * fade).toFixed(3) + ')';
      ctx.fill();

      // 棱边：受击那一下整圈闪白，比任何血条都直接
      /* 锁壳优先于白闪（3.71）：玩家会**持续**开火，`shieldHit` 每帧被重置，
       * 白闪会一直盖住琥珀色——实测截图里整个壳都是白的，
       * 读起来和普通护盾没区别，"打不穿"这件事就失去了提示。 */
      ctx.strokeStyle = locked
        ? 'rgba(255,205,120,' + (0.50 + 0.28 * pulse).toFixed(2) + ')'
        : (this.shieldHit > 0 ? '#ffffff'
          : (alive
            ? 'rgba(170,235,255,' + (0.22 + 0.30 * k).toFixed(2) + ')'
            : 'rgba(230,250,255,' + (0.50 * fade).toFixed(2) + ')'));
      ctx.lineWidth = this.shieldHit > 0 ? 2.2 : 1.3;
      ctx.stroke();

      // 耐久弧：外圈一段从 12 点顺时针的弧，长度就是剩余护盾量。
      // 它比六边形更该被看见——"还能撑多久"是玩家要不要换目标的唯一依据，
      // 所以画在棱边外面、加粗、alpha 下限也更高。
      if (alive && k > 0.02) {
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, R + 4, RY + 4, 0,
          -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
        ctx.strokeStyle = 'rgba(190,240,255,' + (0.34 + 0.40 * k).toFixed(2) + ')';
        ctx.lineWidth = 2.4;
        ctx.stroke();
      }
      ctx.restore();
    }

    // 偏折面：正面一段亮弧。
    // 画成"贴着机身的弧"而不是整圈，玩家才能一眼看出"只有正下方打不动"。
    const D = this.def.deflect;
    if (D) {
      const on = this.deflectHp > 0;
      const k = on ? this.deflectHp / D.cap : 0;      // 1 → 0
      // 半径取 r+9 而不是按贴图算：判定用的是 r + 弹半径(约4) + 6，
      // 画在同一个量级上，玩家才不会出现"看着挡住了却被穿透"的落差
      const rr = this.r + 9;
      const a0 = D.aim - D.arc / 2, a1 = D.aim + D.arc / 2;
      const hot = this.dflash > 0;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';

      if (on) {
        // 玻璃面：弧 + 弦围成一个"透镜"（圆弧与其两端连线的弓形），
        // 填实之后才像一块板；只描一条弧永远读成"一道白边"
        ctx.beginPath();
        ctx.arc(this.x, this.y, rr, a0, a1);
        ctx.closePath();
        const g = ctx.createRadialGradient(this.x, this.y, rr * 0.35, this.x, this.y, rr);
        g.addColorStop(0, 'rgba(120,220,255,0)');
        g.addColorStop(0.6, 'rgba(130,225,255,' + (0.16 + k * 0.16).toFixed(2) + ')');
        g.addColorStop(1, 'rgba(205,248,255,' + (0.42 + k * 0.34).toFixed(2) + ')');
        ctx.fillStyle = g;
        ctx.fill();

        // 棱面：三条从弦向弧顶的短刻线，读作"这块板在折射"
        ctx.strokeStyle = 'rgba(170,240,255,' + (0.22 + k * 0.26).toFixed(2) + ')';
        ctx.lineWidth = 1;
        for (let i = 1; i <= 3; i++) {
          const a = a0 + (a1 - a0) * i / 4;
          ctx.beginPath();
          ctx.moveTo(this.x + Math.cos(a) * rr * 0.66, this.y + Math.sin(a) * rr * 0.66);
          ctx.lineTo(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr);
          ctx.stroke();
        }

        // 外缘：挡下子弹时整条闪白
        ctx.strokeStyle = hot ? '#ffffff'
          : 'rgba(' + (k > 0.4 ? '170,240,255' : '255,200,120') + ',' + (0.60 + k * 0.40).toFixed(2) + ')';
        ctx.lineWidth = hot ? 4.5 : 2.6;
        ctx.beginPath();
        ctx.arc(this.x, this.y, rr, a0, a1);
        ctx.stroke();
      } else {
        // 过载：暗红的断弧，表示"这层刚被打穿，正在重新充能"
        ctx.strokeStyle = 'rgba(255,110,110,' + (0.34 + Math.sin(this.t * 30) * 0.14).toFixed(2) + ')';
        ctx.lineWidth = 2;
        ctx.setLineDash([7, 8]);
        ctx.beginPath();
        ctx.arc(this.x, this.y, rr, a0, a1);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 两端的小棱镜节点：让"这段弧是装备"这件事有实体感
      if (on) {
        for (const sgn of [-1, 1]) {
          const a = D.aim + sgn * D.arc / 2;
          ctx.fillStyle = hot ? '#ffffff' : 'rgba(210,250,255,0.95)';
          ctx.beginPath();
          ctx.arc(this.x + Math.cos(a) * rr, this.y + Math.sin(a) * rr, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 冲角锁定：一条从机头指向落点的红色预警线 + 收缩环，0.7 秒的读招窗口
    if (this.ramState === 1) {
      const k = 1 - this.ramT / 0.7;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = 'rgba(255,70,70,' + (0.35 + k * 0.5).toFixed(2) + ')';
      ctx.lineWidth = 2;
      ctx.setLineDash([9, 8]);
      ctx.beginPath();
      ctx.moveTo(this.x, this.y + this.r * 0.6);
      ctx.lineTo(this.ramTX, this.ramTY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(this.ramTX, this.ramTY, 34 - k * 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 血条：坦型掉血后显示；精英和中型机常驻显示（多只同屏时要能分辨进度）
    // 阈值 35：3.3.0 血量上调后小机也有 5~16 血，全都画会糊成一片。
    // 只留给 bomber(52) / jelly(38) / shield(38) / heavy(155) 这类真需要看进度的单位，
    // eel(34) / mineH(34) 正好卡在下面。
    const showBar = isMiniKind(this.kind)
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
      /* 小 BOSS 的护盾条单独一条，压在血量条上方：
       * 护盾期血量条一直是满格，只画血条会被读成"打了半天没反应"。
       * 中型机不画——它们平时不显示血条，为一道 4 秒的盾把整屏血条都点亮
       * 反而吵；那一档交给机体外面的六边形壳表达。 */
      if (isMiniKind(this.kind) && this.shieldHp > 0) {
        const sw = w * (this.shieldHp / this.shieldMax);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        ctx.fillRect(x - 1, y - 6, w + 2, 4);
        ctx.fillStyle = '#8fe0ff';
        ctx.fillRect(x, y - 5, sw, 2);
      }
    }
  }
}

/* ---------------------------------------------------------------- BOSS */
class Boss {
  constructor() {
    this.active = false;
  }

  init(stage) {
    this.seq = ++ENEMY_SPAWN_SEQ;   // 和 Enemy 共用一套序号，追踪弹不必分类型判断
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
    this.spiralN = 0;        // boss1 终段螺旋的轮次计数（每 6 轮插一次瞄准齐射）
    this.lastP = null;       // 上一轮的玩家位置，boss1 终段用来估速度做预判
    this.lastPT = 0;
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
    /* 刚被挡下的那一处（3.55）：挡弹时记下方向，0.25 秒内把那一段弧点亮。
     * 池对象，必须逐项复位——否则下一只没盾的 BOSS 会顶着上一只的亮弧。 */
    this.shieldHotAng = 0;
    this.shieldHotT = 0;
    /* 每格停留时长。3.53 起可配（盾面改成真挡之后，2.4 秒比子弹飞行时间还短，
     * 玩家"看到缺口开火"时子弹到时缺口已经转走了，只能靠猜）。 */
    this.shieldTurn = tr.shieldTurn || 2.4;

    // 浮游炮：数量与血量都由 BOSS_TRAITS 给，血量按最大血量分摊
    const dr = tr.drones;
    const dCount = typeof dr === 'number' ? dr : (dr ? dr.count : 0);
    const dRatio = (dr && dr.ratio) || 0.5;
    const dHp = dCount ? Math.round(this.maxHp * dRatio / dCount) : 0;
    this.drones = dCount ? Array.from({ length: dCount }, (_, i) => {
      const baseAng = Math.PI / 2 + (i - (dCount - 1) / 2) * 0.54;
      const d = {
        baseAng: baseAng,
        ang: baseAng,
        r: 182, hp: dHp, maxHp: dHp, alive: true,
        fireT: 1.6 + i * 0.7, flash: 0
      };
      this._makeSubTarget(d, 'drone');
      return d;
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
    /* 召唤援军的血量与射速（0 = 没配，由 summonBossMinions 用兜底值）。
     * 放在 trait 里而不是 ENEMY_DEFS：同一只 miniboss 在第 3~5 关是常规波次，
     * 在第 7 关是"BOSS 退场期间的全部压力"，两者该有不同强度。 */
    this.summonHp = tr.summonHp || 0;
    this.summonFire = tr.summonFire || 0;
    this.summoned = false;
    this.retreatT = 0;
    /* 退场时长上限（3.64）：默认 15 秒是"援军打不完也要回来"的兜底。
     * 召唤型/分裂型 BOSS 的援军血量一旦提上去，15 秒就不够用了——清不完
     * 只会触发兜底：BOSS 强行回场，分身还挂在屏幕上，玩家同时挨两套弹幕。
     * 所以由 BOSS_TRAITS 逐关给（boss7/boss8 各 24 秒），默认值保持不变。 */
    this.retreatMax = tr.retreatMax || 15;
    this.finalPhase = false;
    this.mode = 'idle';          // idle | aim | dive | retreat | return
    this.modeT = 0;
    /* 出场保护分两种（3.46，见 LEVELS[].bossEntry）：
     *   'invuln'（默认）入场全程 + 到位后 0.6 秒打不动，但子弹会**弹开**
     *            ——以前是整块跳过判定，子弹从舰体中间穿过去不留痕迹，
     *            玩家只会觉得"打了个寂寞 / BOSS 是张会动的贴图"。
     *            现在照常判定命中、消耗子弹、溅火花、护罩荡开一圈涟漪，
     *            只是不结算伤害。交互在，代价也要说清楚。
     *   'open'   前两关用：出场就能打（此时玩家火力线还没成型，空等 3 秒
     *            只会让第一场 BOSS 战变得很空）。
     */
    this.entryMode = stage.bossEntry === 'open' ? 'open' : 'invuln';
    this.invuln = this.entryMode !== 'open';
    this.guardT = 3.4;
    // 护罩被弹开的涟漪（绘制用，最多留几条）
    this.barrierHits = [];
    this.diveVY = 0;
    this.diveTX = VIEW.w / 2;

    // 可破坏的两侧武器
    const pd = (typeof BOSS_PARTS !== 'undefined' && BOSS_PARTS[stage.boss]) || null;
    if (pd) {
      const each = Math.round(this.maxHp * (pd.ratio || 0.5) / pd.items.length);
      this.parts = pd.items.map(q => {
        const pt = {
          dx: q.dx, dy: q.dy, r: q.r, hp: each, maxHp: each, alive: true, flash: 0
        };
        this._makeSubTarget(pt, 'part');
        return pt;
      });
    } else {
      this.parts = [];
    }
    /* 自动武器（追踪弹 / 雷电）的目标池：炮塔和浮游炮跟敌机、BOSS 本体一样，
     * 都是"能被打掉、打掉有收益"的东西，但它们不是独立实体，没有 x/y 字段
     * （坐标是相对舰体的偏移，跟着 BOSS 走）。这里统一包成可锁定目标，
     * 让 game 层的选目标逻辑只认一套坐标语义。 */
    this.subs = this.parts.concat(this.drones);
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

  /** 无敌期被子弹打中：在命中点留一圈涟漪。
   *  只留最近 6 条——密集弹幕下不封顶就是一张越画越慢的网。 */
  barrierHit(x, y) {
    if (this.barrierHits.length >= 6) this.barrierHits.shift();
    this.barrierHits.push({ x: x, y: y, t: 0.3 });
  }

  /* 无敌期的挡弹判定：走**画出来的那层膜**，而不是舰体轮廓。
   * 用舰体轮廓会让子弹穿过膜、在膜里面才消失，看起来像"打穿了但没炸"；
   * 只有停在膜上才对得上眼睛看到的东西。半径常量必须与 draw() 里一致。 */
  barrierHitTest(x, y, r) {
    const rx = this.shieldRx + r, ry = this.shieldRy + r;
    const dx = (x - this.x) / rx, dy = (y - this.y) / ry;
    return dx * dx + dy * dy <= 1;
  }

  update(dt, game) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;

    /* 护罩涟漪：每条独立计时，从命中点向外扩一圈就消失。
     * 它只活 0.3 秒，必须自己衰减 —— 挂在 flash 上会被 0.06 秒的命中闪盖掉。 */
    for (let i = this.barrierHits.length - 1; i >= 0; i--) {
      const h = this.barrierHits[i];
      h.t -= dt;
      if (h.t <= 0) this.barrierHits.splice(i, 1);
    }

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
        this.guardT = this.entryMode === 'open' ? 0 : 0.6;   // 到位后再给 0.6 秒缓冲
        this.invuln = this.entryMode !== 'open';
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
      /* 全局 0.9 提频 + 关卡自己的 bossRate。
       * bossRate 是 3.28 起给后四关的"出招更快"旋钮：只改这一个乘数，
       * 不用去动每个 pattern 里散落的 1.05/1.4/2.1 秒，
       * 也就不会出现"某一段忘了提速"的不一致。 */
      this.fireT = cd * 0.9 * (this.stage.bossRate || 1);
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

    // 护盾轮转：每 shieldTurn 秒转一格
    if (this.shieldCfg) {
      this.shieldT += dt;
      if (this.shieldT >= this.shieldTurn) {
        this.shieldT -= this.shieldTurn;
        this.shieldPhase = (this.shieldPhase + 1) % 4;
      }
      if (this.shieldFlash > 0) this.shieldFlash -= dt;
      if (this.shieldHotT > 0) this.shieldHotT -= dt;
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
        // x/y 都要夹进画面：只夹 x 的话，BOSS 贴顶巡游时浮游炮会从 HUD 上方开火
        const px = clamp(this.x + Math.cos(d.ang) * d.r, 36, VIEW.w - 36);
        const py = clamp(this.y + Math.sin(d.ang) * d.r, PLAY_TOP + 12, VIEW.h - 12);
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
        // 援军清完就回归；万一卡住（援军飞出屏幕等），到 retreatMax 强制回归
        if (!game.hasSummonedMinions() || this.retreatT > this.retreatMax) {
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

  /* ---------------- 可破坏部件的"可被锁定"包装（3.66） ----------------
   *
   * 炮塔（parts）和浮游炮（drones）一直是"打掉能削弱火力"的可攻击件，
   * 直射弹在 `_updateBullets` 里单独判它们，所以手动武器打得到。
   * 但自动武器（追踪弹、雷电）找目标走的是 `nearestEnemy` / `chainLightning`，
   * 那两个函数只遍历 `enemies` 数组，于是出现两种怪现象：
   *   · 追踪弹在 BOSS 战里永远只锁舰体中心，不去拆炮塔
   *   · 雷电在 BOSS 战没有小怪时**一次都不触发**（周围"没有敌人"）
   *
   * 修法不是给这两个函数各加一段 BOSS 分支（那样每加一种自动武器就要改一遍），
   * 而是把部件包成和敌机同构的目标：有实时坐标、有 seq、有 hit()。
   *
   * 坐标必须是 getter，不能是快照：炮塔跟着舰体移动、浮游炮还在公转，
   * 存成字段的话追踪弹会追着一块残影飞。
   *
   * `hostSeq` 是池复用的防线：Boss 是池对象，被换掉之后旧 part 对象仍然
   * 指着同一个实例，光看 `alive` 会变成"追着一个不存在的炮塔"。
   */
  _makeSubTarget(t, kind) {
    const bo = this;
    t.subKind = kind;
    t.seq = ++ENEMY_SPAWN_SEQ;
    t.hostSeq = bo.seq;
    Object.defineProperty(t, 'x', {
      get() {
        return kind === 'drone'
          ? clamp(bo.x + Math.cos(t.ang) * t.r, 36, VIEW.w - 36)   // 与判定、绘制同一口径
          : bo.x + t.dx;
      }
    });
    Object.defineProperty(t, 'y', {
      get() {
        return kind === 'drone' ? bo.y + Math.sin(t.ang) * t.r : bo.y + t.dy;
      }
    });
    Object.defineProperty(t, 'active', {
      get() { return t.alive && t.hostSeq === bo.seq && !bo.dead; }
    });
    /* 签名与 Enemy.hit 一致（dmg, bullet, game），这样 chainLightning
     * 里那句 `best.hit(power, null, this)` 不用为部件写分支。 */
    t.hit = (dmg, bullet, game) => bo.damageSub(t, dmg, game);
  }

  /** 部件 / 浮游炮的血量结算。火花与音效留在调用点——那是"子弹打中"的表现，
   *  雷电这种直接结算的伤害不该凭空多出一圈命中特效。 */
  damageSub(t, dmg, game) {
    if (!t.active) return false;
    /* 出场保护期打不动：雷电是直接结算，绕过了 `_updateBullets` 里那层
     * invuln 拦截，所以这道门必须开在结算点上。 */
    if (this.invuln) return false;
    t.hp -= dmg;
    t.flash = 0.08;
    if (t.hp <= 0) {
      t.hp = 0;
      t.alive = false;
      if (t.subKind === 'drone') game.onDroneDestroyed(this, t, t.x, t.y);
      else game.onBossPartDestroyed(this, t);
    }
    return true;
  }

  /** 轮转护盾的膜：半径与绘制共用这一对 getter。
   *  以前判定挂在本体轮廓（`_bossHits`）上、膜却画在 0.46 的椭圆上，
   *  两者差 40 多像素——子弹要穿进机体里才被拦。 */
  get shieldRx() { return this.w * 0.46; }
  get shieldRy() { return this.h * 0.46; }

  /** 轮转护盾（boss3）：这一点所在的方向是否被盾面盖住（true = 挡住，不结算伤害）。
   *
   *  只判方向、不判距离——距离由 `shieldHitTest()` 负责。
   *  象限口径与绘制完全一致：第 i 段弧的中心角就是 i×90°，`round(ang/90°)` 正好落在同一格。 */
  shieldBlocks(x, y) {
    if (!this.shieldCfg) return false;
    let quad = Math.round(Math.atan2(y - this.y, x - this.x) / (Math.PI / 2));
    quad = ((quad % 4) + 4) % 4;
    return quad !== this.shieldPhase && quad !== (this.shieldPhase + 1) % 4;
  }

  /** 轮转护盾的挡弹判定（3.55）：**这一帧是否跨过那层膜**，且跨入的方向被盾面盖住。
   *
   *  3.53 把判定挂在 `_bossHits` 之后，膜画在 0.46 的椭圆上、本体轮廓最远只到 78px
   *  （boss3 膜半径 119.6×95.7），子弹要穿进机体再飞 40 多像素才被拦下。
   *  玩家看到的是"子弹打进 Boss 身上，然后血条不动"——护盾读起来只是个数值惩罚。
   *
   *  现在改成"跨过膜的那一帧就挡"，弹开点落在膜上。判"刚跨过"必须用上一帧位置
   *  （`px/py` 由 `Bullet.update` 记）而不是"走到膜内就挡"：从缺口穿进来的子弹
   *  本来就在膜内，再往后走会被某一帧按当时的角度补判命中盾，等于缺口时有时无。 */
  shieldHitTest(x, y, px, py) {
    if (!this.shieldCfg) return false;
    const rx = this.shieldRx, ry = this.shieldRy;
    const dx = (x - this.x) / rx, dy = (y - this.y) / ry;
    if (dx * dx + dy * dy > 1) return false;          // 还在膜外
    if (px !== undefined) {
      const qx = (px - this.x) / rx, qy = (py - this.y) / ry;
      if (qx * qx + qy * qy <= 1) return false;       // 上一帧就在膜内：从缺口进来的，放行
    }
    return this.shieldBlocks(x, y);
  }

  /* opt.raw（3.49）：给"拆炮台连带掉血"和保险用——那不是一次命中，是舰体被撕开 / 一颗清屏雷。
   * 保险尤其不能被盾吃掉，它是玩家拿来破局的唯一手段。
   *
   * 3.53：盾面从"打错方向只吃 28%"改成**完全挡住**。28% 的版本里"等缺口转过来"
   * 只是多打三倍效率，玩家没有理由等，一直顶着盾打就行——轮转机制等于不存在。
   *
   * 3.55：**这里不再做挡弹判定**。挡弹统一由 `shieldHitTest()` 在命中路径上完成
   * （玩家子弹在 `game._collide`、激光在 `_fireBossLaser`），那两处拿得到真实命中点。
   * 这里若拿玩家坐标兜底，会跟命中点打架：玩家横移之后，一颗"从缺口打进去"的子弹
   * 会被按玩家当前所在方向补判成挡下，表现就是"缺口里打进去也不掉血"。 */
  hit(dmg, game, opt) {
    if (this.dead) return;

    this.hp -= dmg;
    this.flash = 0.06;
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.deathT = 1.8;
      game.onBossDying(this);
    }
  }

  /** 挡弹涟漪：一圈向外扩的环 + 迅速缩掉的亮核。
   *  出场护罩（`invuln`）与轮转护盾共用同一套反馈——两者都是"子弹停在一层膜上"，
   *  用同一种视觉语言，玩家才认得出这是同一件事。只有环会读成一个气泡，
   *  加一个一帧就收掉的亮核才像"弹开"。 */
  _drawBarrierRipples(ctx) {
    if (!this.barrierHits.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const h of this.barrierHits) {
      const k = h.t / 0.3;                     // 1 → 0
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = '#e8fbff';
      ctx.lineWidth = 0.8 + k * 2.2;
      ctx.beginPath();
      ctx.arc(h.x, h.y, (1 - k) * 13 + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = k * k * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(h.x, h.y, 1 + k * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** 护盾轮转 / 浮游炮 / 引力场的绘制 */
  _drawGimmickFx(ctx) {
    /* ---- 护盾：挡的那半圈画成实体光膜，缺口那半圈几乎不画 ----
     *
     *  3.53 是"两段实弧（挡）+ 两段白色虚线（缺口）"，而且实弧用的是 stage.accent
     *  ——深海主题的 accent 是墨青，压在深色背景上比缺口那圈白虚线**还暗**。
     *  玩家看到的是"下面这圈亮白线正对着我"，于是把缺口当成了盾：
     *  "护盾朝着我却打得进去"。方向读反了，机制再怎么改都白搭。
     *
     *  现在按"亮 = 有盾 = 打不进"排：
     *    · 挡面：180° 厚弧 + 扇形淡填充 + 三层描边（外光晕/主体/内高光），固定冷色不随主题变
     *    · 缺口：alpha 0.12 的细虚线，只留"膜还在、只是这半边薄"的暗示
     *  半径走 `shieldRx/shieldRy`，与 `shieldHitTest()` 完全同一口径：
     *  画在哪就在哪挡，是这套机制能被读懂的前提。 */
    if (this.shieldCfg && !this.invuln) {
      const rx = this.shieldRx, ry = this.shieldRy;
      // 缺口半圈的起止角：第 i 段弧覆盖 [i×90°-45°, i×90°+45°]
      const g0 = this.shieldPhase * Math.PI / 2 - Math.PI / 4;
      const g1 = g0 + Math.PI;
      const pulse = 0.5 + Math.sin(this.t * 3.4) * 0.5;

      // ---- 缺口：极淡细虚线 ----
      ctx.save();
      ctx.globalAlpha = 0.12 + pulse * 0.04;
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 9]);
      ctx.lineDashOffset = -this.t * 26;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rx, ry, 0, g0, g1);
      ctx.stroke();
      ctx.restore();

      // ---- 挡面 ----
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = '#7fe6ff';
      ctx.strokeStyle = '#9fe8ff';
      // 扇形淡填充：只有一条弧线读作"一道光"，有面才读作"盾"
      ctx.globalAlpha = 0.10 + pulse * 0.05;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rx, ry, 0, g1, g0 + Math.PI * 2);
      ctx.lineTo(this.x, this.y);
      ctx.closePath();
      ctx.fill();
      /* 三层描边代替 shadowBlur：这样既有"发光"的厚度，又不用每帧重算模糊
       * （boss3 从第二条血开始同屏还有一堆弹幕，模糊是最容易被它吃掉的）。 */
      const bands = [
        [12, 0.14, '#5fd8ff'],
        [5.5, 0.62, '#9fe8ff'],
        [1.8, 0.95, '#ffffff']
      ];
      for (const [w, a, col] of bands) {
        ctx.globalAlpha = a * (0.86 + pulse * 0.14);
        ctx.lineWidth = w;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, rx, ry, 0, g1, g0 + Math.PI * 2);
        ctx.stroke();
      }
      /* 内层一条流动虚线：把"能量膜"和"贴图描边"区分开——描边不会动。
       * 只画在挡的那半圈上，缺口那半圈保持干净。 */
      ctx.globalAlpha = 0.30 + pulse * 0.12;
      ctx.strokeStyle = '#c8f2ff';
      ctx.lineWidth = 1.4;
      ctx.setLineDash([10, 12]);
      ctx.lineDashOffset = -this.t * 40;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rx - 9, ry - 9, 0, g1, g0 + Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      // 刚被挡下的那一处：这一段弧亮一下，玩家能看出"弹是停在这层膜上"
      if (this.shieldHotT > 0) {
        const k = this.shieldHotT / 0.25;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k * 0.9;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2 + k * 6;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, rx, ry, 0,
          this.shieldHotAng - 0.42, this.shieldHotAng + 0.42);
        ctx.stroke();
        ctx.restore();
      }
      this._drawBarrierRipples(ctx);
      if (this.shieldFlash > 0) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = this.shieldFlash / 0.22 * 0.35;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.ellipse(this.x, this.y, rx + 3, ry + 3, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // ---- 浮游炮 ----
    for (const d of this.drones) {
      if (!d.alive) continue;
      const px = d.x;   // getter 里已含 36~W-36 夹边，与判定同口径
      const py = d.y;

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
      // 坐标走 getter（3.66），与判定、自动武器选目标完全同一口径
      const x = pt.x;
      const y = pt.y;
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
    /* 无敌期不再把机体画成半透明（3.46）：那读起来像"贴图没加载完"，
     * 而且与"子弹会弹开"这件事毫无关系。现在由护罩负责解释为什么打不动。 */
    Assets.draw(ctx, this.sprite, this.x, this.y, 1, 1);
    ctx.restore();

    this._drawParts(ctx);
    this._drawGimmickFx(ctx);

    if (this.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      Assets.draw(ctx, this.sprite, this.x, this.y, 1, 0.5);
      ctx.restore();
    }
    /* 入场护罩（3.46）：一圈能量膜 + 命中涟漪。
     * 它的职责只有一个：让"打不动"这件事有可见的原因。
     * 用叠加混合而不是普通描边，才能在一片弹幕里仍然读得出来。 */
    if (this.invuln && this.y > -this.h * 0.5) {
      const rx = this.w * 0.46, ry = this.h * 0.46;
      const pulse = 0.5 + Math.sin(this.t * 4.6) * 0.5;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      // 一层极淡的填充：让整块机体"在膜里面"，而不是被一圈线框住
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rx, ry, 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.05 + pulse * 0.05;
      ctx.fillStyle = '#8fe8ff';
      ctx.fill();
      ctx.globalAlpha = 0.16 + pulse * 0.10;
      ctx.strokeStyle = '#9fe8ff';
      ctx.lineWidth = 2;
      ctx.stroke();
      /* 外圈虚线转起来：静止的同心圆读作"光环"，只有带缺口且在动的东西
       * 才会被读成一层能量场。lineDashOffset 跟着 t 走，帧间连续。 */
      ctx.globalAlpha = 0.34 + pulse * 0.20;
      ctx.strokeStyle = '#c8f2ff';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([15, 13]);
      ctx.lineDashOffset = -this.t * 48;
      ctx.beginPath();
      ctx.ellipse(this.x, this.y, rx * 1.045, ry * 1.045, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      this._drawBarrierRipples(ctx);
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
