/* ============================================================
 * game.js —— 主循环、状态机、碰撞、渲染、HUD
 * ============================================================ */

const STEP = 1 / 60;
const BOMB_BTN = { x: VIEW.w - 34, y: VIEW.h - 28, r: 22 };
// 第二个保险按钮：和 BOMB 并排，避免右下角只有一个圆时左右不对称
const LASER_BTN = { x: VIEW.w - 92, y: VIEW.h - 28, r: 22 };
// 声音开关：放在两个保险按钮上方，竖着排，避免和手指操作区抢位置
const SOUND_BTN = { x: VIEW.w - 34, y: VIEW.h - 78, r: 18 };
// 通关页出现后锁定输入的秒数：最后一击常常是连点，不锁会直接跳过结算和致谢
const WIN_INPUT_LOCK = 2.0;

const input = {
  left: false, right: false, up: false, down: false,
  px: VIEW.w / 2, py: VIEW.h * 0.7, pointerActive: false,
  // 控制权归属：多指同按时只有这一根手指能拖动飞机。
  // 不记 id 的话，按保险的那根手指一抬起就会把拖动的状态一起清掉，表现为"飞机卡住，要重新触屏"
  pointerId: -1
};

class Game {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.state = 'title';
    this.last = 0;
    this.acc = 0;
    this.raf = null;

    this.levelIdx = 0;
    this.level = LEVELS[0];
    this.score = 0;
    this.stageT = 0;
    this.totalT = 0;

    this.player = new Player();
    this.boss = new Boss();
    this.bullets = Array.from({ length: 680 }, () => new Bullet());
    this.enemies = Array.from({ length: 90 }, () => new Enemy());
    this.particles = Array.from({ length: 520 }, () => new Particle());
    // 32 个：关卡定时补给 + 敌机掉落 + BOSS 爆一地会同时占位，24 个开始出现"掉了但没生成"
    this.pickups = Array.from({ length: 32 }, () => new Pickup());

    this.queue = [];
    this.waveIdx = 0;
    this.bgScroll = 0;
    this.stars = [];
    this.shakeT = 0;
    this.shakeAmp = 0;
    this.bannerT = 0;
    this.warnT = 0;
    this.clearT = 0;
    this.overT = 0;
    this.bossActive = false;
    this.paused = false;
    this.flashT = 0;
    this.wpnToastT = 0;
    this.wpnTitle = '';
    this.wpnSub = '';
    this.wpnColor = '#7fe0ff';
    this.supplyT = 9;
    this.continues = CONTINUE.max;   // 本局剩余续关次数
    this.contT = 0;                  // 续关倒计时（>0 表示可以续）
    this.contToastT = 0;             // 续关成功的提示
    this.deadT = 0;                  // 失败页已停留时间
    this.arcs = [];                  // 电弧特效线段
    this.optToastT = 0;              // 僚机提示
    this.orbitToastT = 0;            // 环绕机提示
    this.laserBeam = { state: 0, t: 0, tickT: 0 };   // 玩家激光保险
    this.deathDelayT = 0;            // 阵亡后到结算页的倒计时
    this.orbitBoostHint = false;     // 该提示是满员加速
    this.mirrorToastT = 0;           // 镜像武器提示
    this.splitToastT = 0;            // 分裂提示
    this.rearmToastT = 0;            // 炮塔重启提示
    this.bigToastT = 0;              // 通用大字提示
    this.bigToastTitle = '';
    this.bigToastSub = '';
    this.bigToastColor = '#ffffff';
    this.optFull = false;
    this.deathBoss = false;          // 是否死在 BOSS 战
    this.summonT = 0;
    this.warnings = [];       // 底部来敌的警示标记
    this._bombing = false;
    // 飞行中的高爆弹用数组：冷却基本不允许叠出第二颗，但"上一颗因为又按了一下就凭空消失"
    // 是最不能接受的失败模式，所以结构上就不给顶掉的机会
    this.bombDrops = [];
    this.bombCdT = 0;         // 普通保险冷却剩余（秒）
    this.laserCdT = 0;        // 激光保险冷却剩余（秒）
    this.bombFx = null;       // 爆炸冲击环（0.5 秒后自动清空）
    this.winT = 0;            // 通关页已停留时间（用于锁输入 + 提示渐显）
    // 声音总开关：持久化在 localStorage，进游戏前就生效（所以要在 SFX.init 之前读）
    this.soundOn = true;
    try {
      if (localStorage.getItem('raiden.sound') === '0') this.soundOn = false;
    } catch (e) { /* 隐私模式下 localStorage 会抛异常，忽略即可 */ }
    SFX.enabled = this.soundOn;

    this.god = /[?&]god=1/.test(location.search);
    this.demo = /[?&]auto=1/.test(location.search);
    this.debugBossFlag = /[?&]boss=1/.test(location.search);
    this.showHitbox = /[?&]hitbox=1/.test(location.search);   // 碰撞盒可视化
    this.infiniteBombs = /[?&]bombs=inf/.test(location.search);   // 无限保险（调试）
    this.demoT = 0;

    /* 调试面板（DEBUG=false 时完全不创建） */
    this.devOpen = false;
    this.devToastT = 0;
    this.devToastText = '';
    this._devButtons = [];
    this.lastError = '';
    this.crashCount = 0;
    this.reviveCount = 0;

    /* 帧率统计（调试面板显示） */
    this.fps = 0;
    this._fpsAcc = 0;
    this._fpsAt = 0;

    /* 帧循环看门狗：rAF 若因异常中断，1 秒内自动重启 */
    this.lastFrameAt = 0;
    this._watchdog = null;
    this._loop = null;

    this._initStars();
    this._bindInput();
    if (DEBUG) this._buildDevPanel();
    this.resize();
    window.addEventListener('resize', () => this.resize());

    const m = /[?&]stage=(\d+)/.exec(location.search);
    this.startIndex = m ? clamp(parseInt(m[1], 10) - 1, 0, LEVELS.length - 1) : 0;
    this.levelIdx = this.startIndex;
  }

  /* -------------------------------------------------- 基础设施 */
  resize() {
    const availW = window.innerWidth - 8;
    const availH = window.innerHeight - 8;
    const scale = Math.min(availW / VIEW.w, availH / VIEW.h);
    this.cv.style.width = Math.floor(VIEW.w * scale) + 'px';
    this.cv.style.height = Math.floor(VIEW.h * scale) + 'px';
    const s = Math.min(2, window.devicePixelRatio || 1);
    this.cv.width = Math.floor(VIEW.w * s);
    this.cv.height = Math.floor(VIEW.h * s);
    this.ctx.setTransform(s, 0, 0, s, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
  }

  _initStars() {
    this.stars = [];
    for (let i = 0; i < 70; i++) {
      this.stars.push({
        x: Math.random() * VIEW.w,
        y: Math.random() * VIEW.h,
        z: rand(0.25, 1),
        r: rand(0.5, 1.7)
      });
    }
  }

  /* ------------------------------------------------ 调试面板 */

  _buildDevPanel() {
    const P = DEV_PANEL;
    // 顺序刻意按功能分组：开关类一行、关卡类一行、道具/跳转一行
    const defs = [
      { id: 'god',     label: '无敌' },
      { id: 'infbomb', label: '无限保险' },
      { id: 'hitbox',  label: '碰撞盒' },
      { id: 'supply',  label: '补给' },
      { id: 'prev',    label: '上一关' },
      { id: 'next',    label: '下一关' },
      { id: 'boss',    label: '跳Boss' }
    ];
    const perRow = 2;
    const rows = Math.ceil(defs.length / perRow);
    const bottomY = P.toggle.y - P.rowGap - P.bh;

    this._devButtons = defs.map((d, i) => {
      const r = Math.floor(i / perRow);
      const c = i % perRow;
      return {
        id: d.id,
        label: d.label,
        x: P.baseX + c * (P.bw + P.gap),
        y: bottomY - (rows - 1 - r) * (P.bh + P.rowGap),
        w: P.bw,
        h: P.bh
      };
    });
  }

  /** 返回 true 表示这次点击被面板吃掉，不应传给游戏 */
  _devTap(x, y) {
    if (!DEBUG) return false;
    const T = DEV_PANEL.toggle;
    if (x >= T.x && x <= T.x + T.w && y >= T.y && y <= T.y + T.h) {
      this.devOpen = !this.devOpen;
      return true;
    }
    if (!this.devOpen) return false;

    for (const b of this._devButtons) {
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        this._devAction(b.id);
        return true;
      }
    }

    // 展开区域的空白也拦下来，避免点面板旁边把飞机拽过去
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    for (const b of this._devButtons) {
      x1 = Math.min(x1, b.x);
      x2 = Math.max(x2, b.x + b.w);
      y1 = Math.min(y1, b.y);
      y2 = Math.max(y2, b.y + b.h);
    }
    return x >= x1 - 4 && x <= x2 + 4 && y >= y1 - 4 && y <= y2 + 4;
  }

  _devAction(id) {
    this.devOpen = false;      // 操作完立刻收起，别一直挡住底部
    switch (id) {
      case 'god':
        this.god = !this.god;
        this._devToast(this.god ? '无敌 ON' : '无敌 OFF');
        break;
      case 'hitbox':
        this.showHitbox = !this.showHitbox;
        this._devToast(this.showHitbox ? '碰撞盒 ON' : '碰撞盒 OFF');
        break;
      case 'infbomb':
        this.infiniteBombs = !this.infiniteBombs;
        this._devToast(this.infiniteBombs ? '无限保险 ON（两种保险都不消耗）' : '无限保险 OFF');
        break;
      case 'next':
        this._devLevel(1);
        break;
      case 'prev':
        this._devLevel(-1);
        break;
      case 'supply':
        this._devSupply();
        break;
      case 'boss':
        if (this.state === 'title' || this.state === 'gameover' || this.state === 'win') this.beginRun();
        this.jumpToBoss();
        this._devToast('跳到 BOSS · ' + this.boss.name);
        break;
    }
    SFX.weaponSwitch();
  }

  _devLevel(dir) {
    const idx = clamp(this.levelIdx + dir, 0, LEVELS.length - 1);
    if (idx === this.levelIdx) {
      this._devToast(dir > 0 ? '已经是最后一关' : '已经是第一关');
      return;
    }
    this.startLevel(idx, true);
    this._devToast('第 ' + LEVELS[idx].id + ' 关 · ' + LEVELS[idx].name);
  }

  /** 调试补给：种类和数量都随机。
   *  固定发 P/W/B/H 各一个看着"齐全"，但和实战掉落分布完全不同，
   *  测火力成长、测道具磁吸都测不出真问题。 */
  _devSupply() {
    const p = this.player;
    // 大致参照 DROPS 表的比例感（火力最常见、僚机最稀有），但每种都留了足够的出现率，
    // 方便单独测某一种道具（比如连着点几次就能试出僚机上限）
    const pool = ['P', 'P', 'P', 'P', 'W', 'W', 'B', 'H', 'H', 'O', 'R', 'R', 'L'];
    const n = randInt(3, 6);
    const y = Math.max(120, p.y - 84);
    // 标题页也能点补给，此时 this.level 还没建
    const stageId = this.level ? this.level.id : ((this.levelIdx || 0) + 1);
    for (let i = 0; i < n; i++) {
      const k = pick(pool);
      const off = (i - (n - 1) / 2) * 36;
      this.spawnPickup(
        clamp(p.x + off, 40, VIEW.w - 40),
        y - Math.abs(off) * 0.35,     // V 形排开，避免几个道具叠成一个
        k,
        k === 'W' ? pick(unlockedWeapons(stageId)) : 0
      );
    }
    this._devToast('随机补给 ×' + n);
  }

  _devToast(text) {
    this.devToastText = text;
    this.devToastT = 1.5;
  }

  /** 异常兜底：记录但不让帧循环断掉 */
  _onCrash(err, where) {
    this.crashCount += 1;
    const msg = (err && err.message) ? err.message : String(err);
    this.lastError = where + ' · ' + msg;
    if (typeof console !== 'undefined') {
      console.error('[' + where + ']', err);
    }
  }

  _toLocal(e) {
    const r = this.cv.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * VIEW.w,
      y: ((e.clientY - r.top) / r.height) * VIEW.h
    };
  }

  _bindInput() {
    const onDown = e => {
      e.preventDefault();
      SFX.init();
      const p = this._toLocal(e);

      // 调试面板优先级最高（暂停时也能操作）
      if (this._devTap(p.x, p.y)) return;

      // 声音开关：标题页、暂停中、结算页都能切，所以放在暂停恢复之前
      if (dist2(p.x, p.y, SOUND_BTN.x, SOUND_BTN.y) < (SOUND_BTN.r + 12) * (SOUND_BTN.r + 12)) {
        this.toggleSound();
        return;
      }

      // 暂停中：任意点击/触摸都恢复，且不把飞机拽到点击处
      if (this.paused) {
        this.paused = false;
        return;
      }

      // 右下角保险按钮（清屏 / 激光两种）。状态条件直接复用 _canUseBomb，
      // 免得这里和 _pressBomb 各写一份、将来又漏掉某个状态（BOSS 预警就是这么漏的）
      if (this._canUseBomb()) {
        if (dist2(p.x, p.y, BOMB_BTN.x, BOMB_BTN.y) < 34 * 34) {
          this._pressBomb();
          return;
        }
        if (dist2(p.x, p.y, LASER_BTN.x, LASER_BTN.y) < 34 * 34) {
          this._pressLaser();
          return;
        }
      }

      // 失败页：还有续关机会就先续关，否则重开
      if (this.state === 'gameover') {
        if (this.contT > 0) this.continueRun();
        else this.beginRun();
        return;
      }

      input.pointerActive = true;
      input.pointerId = e.pointerId;
      input.px = p.x;
      input.py = p.y;
      if (this.state === 'title' || this.state === 'win') {
        this.beginRun();
      }
    };
    const onMove = e => {
      if (!input.pointerActive) return;
      // 只认掌握控制权的那根手指：按保险的指头在屏幕上滑动不该把飞机拽走
      if (e.pointerId !== input.pointerId) return;
      const p = this._toLocal(e);
      input.px = p.x;
      input.py = p.y;
    };
    // 只有控制权的那根手指抬起才算松开；按保险的手指抬起不能影响拖动
    const onUp = e => {
      if (e.pointerId !== input.pointerId) return;
      input.pointerActive = false;
      input.pointerId = -1;
    };

    this.cv.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);

    window.addEventListener('keydown', e => {
      SFX.init();
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') input.left = true;
      if (k === 'arrowright' || k === 'd') input.right = true;
      if (k === 'arrowup' || k === 'w') input.up = true;
      if (k === 'arrowdown' || k === 's') input.down = true;
      if (k === ' ' || k === 'enter') {
        if (this.state === 'gameover') {
          if (this.contT > 0) this.continueRun();
          else this.beginRun();
        } else if (this.state === 'title' || this.state === 'win') {
          this.beginRun();
        }
        e.preventDefault();
      }
      if (k === 'escape' || k === 'p') this.togglePause();
      // 两种保险：必须过滤 e.repeat，否则按住 X 会以系统重复率连放（0.7 秒后 30 次/秒）
      if (!e.repeat) {
        if (k === 'x' || k === 'b') this._pressBomb();
        if (k === 'c' || k === 'v' || k === 'l') this._pressLaser();
      }
      if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].indexOf(k) >= 0) e.preventDefault();
    });

    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      if (k === 'arrowleft' || k === 'a') input.left = false;
      if (k === 'arrowright' || k === 'd') input.right = false;
      if (k === 'arrowup' || k === 'w') input.up = false;
      if (k === 'arrowdown' || k === 's') input.down = false;
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play') this.paused = true;
    });
  }

  /* ------------------------------------------------ 保险的统一入口
   * 键盘和触屏按钮都走这里，避免两边行为不一致（键盘曾经能在暂停中偷偷吃掉保险）。
   */
  /** 声音总开关：点一下就切，状态存 localStorage，下次进来保持 */
  toggleSound() {
    this.soundOn = !this.soundOn;
    SFX.setEnabled(this.soundOn);
    try { localStorage.setItem('raiden.sound', this.soundOn ? '1' : '0'); } catch (e) { /* 忽略 */ }
    this._devToast(this.soundOn ? '声音 ON' : '声音 OFF');
  }

  _canUseBomb() {
    // 预警期（`warn`）玩家还能移动、开火，保险也必须能用：
    // 那是"BOSS 快来了"的过场提示，不是暂停，锁掉保险只会让玩家白按
    return (this.state === 'play' || this.state === 'boss' || this.state === 'warn') &&
      !this.paused && this.player.alive;
  }

  _pressBomb() {
    if (!this._canUseBomb()) return;
    // 冷却中不消耗保险、也不刷提示：按钮上有进度环，连点不该再听到/看到一堆反馈
    if (this.bombCdT > 0) return;
    if (!this.player.useBomb(this)) this._devToast('清屏保险已用完');
  }

  _pressLaser() {
    if (!this._canUseBomb()) return;
    if (this.laserCdT > 0) return;
    if (this.player.useLaser(this)) return;
    // 分清"没货"和"已经在打"：后者不是玩家的错，提示也不该一样
    if (this.laserBeam && this.laserBeam.state > 0) this._devToast('激光正在发射');
    else this._devToast('激光保险已用完');
  }

  togglePause() {
    if (this.state !== 'play' && this.state !== 'boss') return;
    this.paused = !this.paused;
  }

  /* -------------------------------------------------- 流程 */
  beginRun() {
    // 通关页刚出来的 2 秒内不接受重开：最后一击往往是连点，
    // 直接跳过去玩家根本看不清结算和致谢
    if (this.state === 'win' && this.winT < WIN_INPUT_LOCK) return;
    this.score = 0;
    this.continues = CONTINUE.max;
    this.contT = 0;
    this.startLevel(this.startIndex, false);
  }

  startLevel(idx, keepProgress) {
    this.levelIdx = idx;
    this.level = LEVELS[idx];
    // 重算波次时间轴，并为每波插入一支“补充波”（换编队、数量 60%）
    // 单纯放大单波数量会被玩家逐个点掉，波次变密才能真正堆出屏幕压力
    const ts = WAVE_TUNE.timeScale;
    const gs = WAVE_TUNE.gapScale;
    const altForm = {
      line: 'vee', vee: 'arc', column: 'sides', sides: 'line', arc: 'wave',
      diamond: 'pincer', wave: 'diamond', pincer: 'arc'
    };
    const arr = [];
    this.level.waves.forEach(w => {
      const gap = (w.gap || 0.16) * gs;
      arr.push({
        kind: w.kind, n: w.n, form: w.form, hp: w.hp, speed: w.speed,
        at: w.at * ts, gap: gap, side: w.side, arc: w.arc, diag: w.diag
      });
      // 中型机 / 蛇不吃补充波：否则 1 只会被自动加成 3 只，数量不可控
      if (w.kind !== 'miniboss' && w.kind !== 'snake') {
        arr.push({
          kind: w.kind,
          n: Math.max(2, Math.round(w.n * 0.6)),
          form: altForm[w.form] || 'line',
          hp: w.hp, speed: w.speed,
          at: w.at * ts + 1.05, gap: gap * 1.2,
          // 侧向波的补充波从对侧来：一左一右夹击，比同侧再来一批有变化
          side: w.side === 'left' ? 'right' : (w.side === 'right' ? 'left' : undefined),
          arc: w.arc,
          // 对角波同理：补充波从另一个角穿上来，形成 X 形交叉
          diag: w.diag === 'ltr' ? 'rtl' : (w.diag === 'rtl' ? 'ltr' : undefined)
        });
      }
    });
    arr.sort((a, b) => a.at - b.at);
    this.waves = arr;

    // 本关最后一轮小 BOSS 的时间点。只有过了这个点，"小 BOSS 清空"才算数——
    // 否则第 9 关第一轮 3 架一打完就记 miniGoneT，收尾段会在蛇出场前就白跑一遍。
    this.lastMiniAt = arr.reduce((m, w) =>
      (w.kind === 'miniboss' || w.kind === 'snake') ? Math.max(m, w.at) : m, 0);
    this.stageT = 0;
    this.waveIdx = 0;
    this.queue.length = 0;

    // 关卡补给：时间点的先排进队列，事件点的（小 BOSS 击破等）等触发时再入队。
    // at 跟波次一样吃 timeScale，否则波次压缩后补给会后半段才挤在一起。
    this._supplyQ = [];
    for (const s of (this.level.supply || [])) {
      if (s.at !== undefined) this._queueSupply(s.at * ts, s);
    }

    // 收尾编队段：小 BOSS 清空后要再打一段才允许进 BOSS
    this.miniSeen = false;          // 本关出过小 BOSS
    this.miniGoneT = undefined;     // 小 BOSS 清空时刻
    this.outroDone = false;         // 收尾段是否已撑满
    this.outroStartT = undefined;   // 收尾段起算时刻（波次放完后才起算）
    this.outroNextT = 0;
    this.outroPool = null;          // 机型/阵型池，惰性构建
    this.snake = null;              // 蛇形小 BOSS 的控制器

    this.bossActive = false;
    this.paused = false;
    this.flashT = 0;
    this.wpnToastT = 0;
    this.wpnTitle = '';
    this.wpnSub = '';
    this.wpnColor = '#7fe0ff';
    this.supplyT = 9;
    if (!keepProgress) this.continues = CONTINUE.max;   // 只有全新一局才重置续关次数
    this.contT = 0;                  // 续关倒计时（>0 表示可以续）
    this.contToastT = 0;             // 续关成功的提示
    this.deadT = 0;                  // 失败页已停留时间
    this.arcs = [];                  // 电弧特效线段
    this.optToastT = 0;              // 僚机提示
    this.orbitToastT = 0;            // 环绕机提示
    this.laserBeam = { state: 0, t: 0, tickT: 0 };   // 玩家激光保险
    this.deathDelayT = 0;            // 阵亡后到结算页的倒计时
    this.orbitBoostHint = false;     // 该提示是满员加速
    this.mirrorToastT = 0;           // 镜像武器提示
    this.splitToastT = 0;            // 分裂提示
    this.rearmToastT = 0;            // 炮塔重启提示
    this.bigToastT = 0;              // 通用大字提示
    this.bigToastTitle = '';
    this.bigToastSub = '';
    this.bigToastColor = '#ffffff';
    this.optFull = false;
    this.deathBoss = false;          // 是否死在 BOSS 战
    this.summonT = 0;
    this.warnings = [];       // 底部来敌的警示标记
    this._bombing = false;
    this.bombDrops.length = 0;     // 换关清空飞行中的炸弹
    this.bombCdT = 0;
    this.laserCdT = 0;
    this.bombFx = null;
    this.bullets.forEach(b => { b.active = false; });
    this.enemies.forEach(e => { e.active = false; });
    this.pickups.forEach(p => { p.active = false; });
    this.particles.forEach(p => { p.active = false; });
    this.boss.active = false;
    this._clearDelay = undefined;
    if (keepProgress) this.player.resetStage();
    else this.player.reset();
    this.player.x = VIEW.w / 2;
    this.state = 'intro';
    this.bannerT = 2.4;
  }

  startBossWarn() {
    this.state = 'warn';
    this.warnT = 2.2;
    SFX.warn();
  }

  spawnBoss() {
    this.boss.init(this.level);
    this.bossActive = true;
    this.state = 'boss';
    // 3.7.0：BOSS 相关演出不再震全局镜头，改成机身自己颤
    this.boss.jitter(14);
  }

  /** 致命伤：先播爆炸，PLAYER.deathDelay 秒后才真正进结算页 */
  onPlayerDying() {
    this.deathDelayT = PLAYER.deathDelay;
    this._dyingT = 0;
    this._dyingBurst = 0;
    this._dyingX = this.player.x;
    this._dyingY = this.player.y;
    this.shake(30);
    this.flashT = Math.max(this.flashT, 0.34);

    // 清掉在飞的自机子弹：否则会出现"死了之后子弹把 BOSS 打死"，
    // 结算页和通关页会同时被触发
    for (const b of this.bullets) {
      if (b.active && b.friendly) b.active = false;
    }
    // 在飞的高爆弹同理：死亡状态下不再推进，留着就会是一颗定格的炸弹挂在结算页后面
    this.bombDrops.length = 0;

    // 三层爆炸，制造"机体正在解体"的过程感
    this.explode(this.player.x, this.player.y, 2.4, '#8fe8ff', 42);
    this.explode(this.player.x + rand(-18, 18), this.player.y + rand(-14, 14), 1.4, '#ffffff', 20);
    SFX.explode(true);
  }

  onPlayerDead() {
    SFX.gameOver();
    this.state = 'gameover';
    this.overT = 0;
    this.deadT = 0;
    this.deathBoss = this.bossActive && !!this.boss && !this.boss.dead;
    if (this.boss && this.boss.laserState > 0) {
      this.boss.laserState = 0;
      this.boss.laserCd = 2.5;
    }
    // 注意：这里不能清 bossActive，否则续关回来 BOSS 就消失了
    this.contT = this.continues > 0 ? CONTINUE.window : 0;
    // 不再震屏：1.5 秒前的爆机已经给了 30，结算页再震一次像画面在抽搐
  }

  /** 续关：原地复活，BOSS 血量与波次进度全部保留 */
  continueRun() {
    if (this.continues <= 0 || this.contT <= 0) return;
    this.continues -= 1;
    this.contT = 0;
    this.paused = false;
    this.overT = 0;

    // 清空敌方弹幕，否则复活瞬间会被糊回失败页
    for (const b of this.bullets) {
      if (b.active && !b.friendly) {
        b.active = false;
        this.addParticle(b.x, b.y, {
          vx: rand(-60, 60), vy: rand(-60, 60), life: 0.3, r: 4, color: '#ffffff'
        });
      }
    }

    this.player.revive();
    input.pointerActive = false;
    input.pointerId = -1;
    // 复活给干净的一套状态：别让上一命的冷却/在飞的炸弹带到新一条命里
    this.bombDrops.length = 0;
    this.bombCdT = 0;
    this.laserCdT = 0;

    // 死在 BOSS 战就回到 BOSS 战，否则回到清杂兵
    this.state = this.bossActive ? 'boss' : 'play';
    if (this.bossActive && this.boss) this.boss.supportT = Math.max(this.boss.supportT, 3);

    this.flashT = 0.3;
    this.shake(12);
    SFX.continueRun();
    this.contToastT = 1.8;
  }

  /** 点到线段距离（激光命中判定） */
  _pointSegDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    const cx = x1 + dx * t;
    const cy = y1 + dy * t;
    return Math.hypot(px - cx, py - cy);
  }

  /** 通用大字提示（栅栏 / 中央弹幕等机制用） */
  _bigToast(title, sub, color) {
    this.bigToastT = 1.8;
    this.bigToastTitle = title;
    this.bigToastSub = sub;
    this.bigToastColor = color || '#ffffff';
  }

  onBossFence(boss) {
    this._bigToast('FENCE', '能量栅栏 · 活动范围收缩', '#b2ff60');
    this.shake(10);
    SFX.warn();
  }

  onBossCenter(boss) {
    this._bigToast('CORE OVERLOAD', '核心过载 · 绕着它飞', '#b2ff60');
    this.shake(14);
    SFX.warn();
  }

  onBossLaserCharge(boss) {
    SFX.laserCharge();
  }

  /** 蓄力结束、方向已锁定：给玩家一个明确的"要打了"信号 */
  onBossLaserLock(boss) {
    SFX.laserLock();
    this.shake(4);
  }

  onBossLaserFire(boss) {
    SFX.laserFire();
    this.shake(15);
    this.flashT = Math.max(this.flashT, 0.10);
  }

  onBossPhase(b) {
    b.jitter(18);
    this.explode(b.x, b.y, 1.6, this.level.accent, 28);
    SFX.explode(true);

    // 第 4 关：二阶段重启一部分被拆掉的浮游炮，逼玩家在"继续拆"和"抢输出"之间选
    if (b.phase === 1 && b.drones && b.drones.length) {
      const n = b.restoreDrones(0.6);
      if (n > 0) {
        this.rearmToastT = 1.8;
        for (const d of b.drones) {
          if (!d.alive) continue;
          this.explode(b.x + Math.cos(d.ang) * d.r, b.y + Math.sin(d.ang) * d.r,
            0.7, '#ffd166', 10);
        }
      }
    }
  }

  onBossDying(b) {
    b.jitter(26);
    // 注意：这里不能清 bossActive，否则 Boss.update 不再执行，死亡倒计时永远走不完
    SFX.explode(true);
    for (let i = 0; i < 10; i++) {
      const t = i * 0.16;
      setTimeout(() => {
        if (!this.boss || this.state === 'gameover') return;
        this.explode(b.x + rand(-90, 90), b.y + rand(-70, 70), rand(0.8, 1.5),
          pick([this.level.accent, '#ffffff', '#ffb066']), 18);
        SFX.explode(true);
      }, t * 1000);
    }
  }

  onBossKilled(b) {
    this.score += SCORE.bossKill;
    this.bossActive = false;
    this.state = 'clear';
    this.clearT = 5.5;
    this.player.invuln = Math.max(this.player.invuln, this.clearT + 0.5);
    this.player.canFire = false;          // 没有敌人了，停火让结算画面干净
    SFX.stageClear();
    // 掉落奖励
    for (let i = 0; i < 3; i++) this.spawnPickup(b.x + rand(-70, 70), b.y + rand(-30, 30), 'P');
    if (this.player.lives < 3) this.spawnPickup(b.x, b.y + 30, 'H');
  }

  /** 普通保险：向前投出一枚高爆弹。
   *  按下瞬间只给无敌（Player.useBomb 里设）+ 音效，真正的清弹与伤害在落点爆炸时结算——
   *  玩家有 0.35 秒的"看着炸弹飞出去"的预期，比瞬间全屏爆炸更有分量。 */
  onBomb(player) {
    this.bombDrops.push({
      x: player.x,
      y: player.y - 34,
      vy: PLAYER.bombVy,
      t: 0,
      rot: 0
    });
    this.bombCdT = PLAYER.bombCd;
    SFX.bomb();
    this.addParticle(player.x, player.y - 30, {
      life: 0.2, r: 24, color: '#bfffe0', drag: 1
    });
  }

  /** 保险相关的持续状态：激光、在飞的高爆弹、冲击环、两种冷却。
   *  单独抽出来是因为它必须在**所有"玩家还能动"的状态**里都跑一遍。
   *  逐个状态手抄一遍的代价是很具体的：BOSS 预警期间漏抄 `_updateBombDrop`，
   *  表现的画面就是"炸弹挂在半空、爆炸特效定住，等预警结束才继续"。
   *  以后新增状态（比如过场、演出）时，只要玩家能操作，就别忘了调这里。 */
  _updateBombSystems(dt) {
    this._updateLaser(dt);
    this._updateBombDrop(dt);
    if (this.bombFx) {
      this.bombFx.t += dt;
      if (this.bombFx.t > 0.5) this.bombFx = null;
    }
    if (this.bombCdT > 0) this.bombCdT = Math.max(0, this.bombCdT - dt);
    if (this.laserCdT > 0) this.laserCdT = Math.max(0, this.laserCdT - dt);
  }

  /** 炸弹飞行：抛物线上升 → 到点引爆 */
  _updateBombDrop(dt) {
    for (let i = this.bombDrops.length - 1; i >= 0; i--) {
      const b = this.bombDrops[i];
      b.t += dt;
      b.vy += PLAYER.bombAy * dt;
      b.y += b.vy * dt;
      b.rot += dt * 6;
      // 引信火花
      if (Math.random() < 0.7) {
        this.addParticle(b.x + rand(-3, 3), b.y + 9, {
          vx: rand(-24, 24), vy: rand(30, 80), life: 0.26, r: 3, color: '#ffd166'
        });
      }
      if (b.t >= PLAYER.bombThrow) {
        this.bombDrops.splice(i, 1);
        this._bombBoom(b);
      }
    }
  }

  /** 爆炸结算：清全屏敌弹（保命核心）+ 只伤爆炸圈内的敌人 */
  _bombBoom(b) {
    const R = PLAYER.bombRadius;

    // 1) 清空全部敌方弹幕。只清敌方：自机弹是我方输出，被自己人炸掉等于变相断火力
    for (const bu of this.bullets) {
      if (!bu.active || bu.friendly) continue;
      bu.active = false;
      this.addParticle(bu.x, bu.y, {
        vx: rand(-70, 70), vy: rand(-70, 70), life: 0.3, r: 4, color: '#ffffff'
      });
    }

    // 2) 圈内小怪：秒杀（血量再高也清），蛇头例外
    // _bombing 置位期间 onEnemyKilled 不掉道具，否则一颗雷能刷满地道具
    this._bombing = true;
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (dist2(b.x, b.y, e.x, e.y) > (R + e.r) * (R + e.r)) continue;
      if (e.kind === 'snakeHead') e.hit(PLAYER.bombSnakeDmg, null, this);
      else e.hit(9999, null, this);
    }
    // 3) BOSS：轮廓只要被爆炸圈罩住就吃固定伤害（用与撞机/子弹同一套轮廓判定）
    if (this.bossActive && !this.boss.dead && this._bossHits(this.boss, b.x, b.y, R)) {
      this.boss.hit(PLAYER.bombBossDmg, this);
    }
    this._bombing = false;

    // 4) 特效：大白闪 + 震屏 + 大爆炸 + 环形冲击
    this.flashT = 0.26;
    this.shake(16);
    this.explode(b.x, b.y, 2.4, '#ffd166', 36);
    for (let i = 0; i < 34; i++) {
      const a = (i / 34) * Math.PI * 2;
      const sp = 560 * (0.55 + Math.random() * 0.6);
      this.addParticle(b.x, b.y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 0.62, r: 6, color: i % 3 ? '#ffd166' : '#ffffff', drag: 0.87
      });
    }
    this.addParticle(b.x, b.y, {
      life: 0.2, r: 34, color: '#ffffff', drag: 1
    });
    // 冲击环单独用一个记录来画：粒子是"实心圆缩小"，半径两百时会变成一块灰饼
    this.bombFx = { x: b.x, y: b.y, t: 0 };
    SFX.explode(true);
  }

  /** 爆炸冲击环：半径向外扩、线条变细并渐隐，比实心圆更像爆炸 */
  _drawBombFx(ctx) {
    const fx = this.bombFx;
    if (!fx) return;
    const k = fx.t / 0.5;                       // 0 → 1
    if (k >= 1) return;
    const rr = PLAYER.bombRadius * (0.3 + k * 0.78);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = (1 - k) * 0.8;
    ctx.strokeStyle = '#ffe9a8';
    ctx.lineWidth = 12 * (1 - k) + 2;
    ctx.beginPath();
    ctx.arc(fx.x, fx.y, rr, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** 高爆弹外观：深色弹体 + 亮黄描边 + 引信火苗；越接近引爆闪得越快 */
  _drawBombDrop(ctx) {
    for (const b of this.bombDrops) this._drawOneBombDrop(ctx, b);
  }

  _drawOneBombDrop(ctx, b) {
    const k = b.t / PLAYER.bombThrow;                       // 0 → 1
    const blink = k > 0.6 && Math.floor(b.t * 26) % 2 === 0;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const gr = 26 + k * 18;
    const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, gr);
    g.addColorStop(0, blink ? 'rgba(255,255,255,0.72)' : 'rgba(255,209,102,' + (0.28 + k * 0.38) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.fillStyle = 'rgba(22,24,32,0.96)';
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = blink ? '#ffffff' : '#ffd166';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = blink ? '#ffffff' : '#fff2c4';
    ctx.beginPath();
    ctx.arc(0, -11, 3.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /** BOSS 呼叫支援：从机体两侧放出少量小怪（血量削弱到 55%） */
  callBossSupport(boss) {
    const kind = this.level.support;
    if (!kind) return;
    const baseHp = ENEMY_DEFS[kind].hp;
    for (let i = 0; i < 2; i++) {
      const e = this.enemies.find(o => !o.active);
      if (!e) break;
      e.init(kind, clamp(boss.x + (i === 0 ? -82 : 82), 46, VIEW.w - 46),
        boss.y + 34, { hp: Math.max(2, Math.round(baseHp * 0.55)) });
    }
    this.explode(boss.x, boss.y + 44, 0.55, '#ffffff', 10);
  }

  /** 等离子命中：小范围爆炸，波及周围小怪 */
  plasmaBoom(b, hitEnemy) {
    const { r, dmg } = b.boom;
    this.addParticle(b.x, b.y, { life: 0.3, r: r * 0.8, color: '#c08cff', drag: 1 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      this.addParticle(b.x, b.y, {
        vx: Math.cos(a) * 190, vy: Math.sin(a) * 190,
        life: 0.28, r: 4, color: '#e0c8ff', drag: 0.86
      });
    }
    for (const e of this.enemies) {
      if (!e.active || e === hitEnemy) continue;
      if (dist2(b.x, b.y, e.x, e.y) < (r + e.r) * (r + e.r)) e.hit(dmg, null, this);
    }
  }

  /** 电弧：从命中点向最近的敌机连跳，伤害逐跳衰减 */
  chainLightning(x, y, exclude, hops, dmg) {
    const chained = exclude ? [exclude] : [];
    let px = x;
    let py = y;
    let power = dmg;
    for (let k = 0; k < hops; k++) {
      let best = null;
      let bd = 175 * 175;
      for (const e of this.enemies) {
        if (!e.active || chained.indexOf(e) >= 0) continue;
        const d = dist2(px, py, e.x, e.y);
        if (d < bd) { bd = d; best = e; }
      }
      if (!best) break;
      chained.push(best);
      this.arcs.push({ x1: px, y1: py, x2: best.x, y2: best.y, life: 0.15, max: 0.15 });
      best.hit(power, null, this);
      px = best.x;
      py = best.y;
      power = Math.max(0.8, power - 0.6);
    }
  }

  /** 散榴弹炸开：向前方扇形抛出一圈破片。
   *  count 有值表示“撞上目标提前引爆”，碎片减半且不重复播音效 */
  burstFlak(b, count) {
    const n = count || 10;
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (i - (n - 1) / 2) * 0.17;
      this.spawnPlayerBullet(b.x, b.y, Math.cos(a) * 640, Math.sin(a) * 640, 2,
        { kind: 'flakFrag', r: 6, life: 0.55 });
    }
    this.addParticle(b.x, b.y, { life: 0.24, r: 26, color: '#ff9a5c', drag: 1 });
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      this.addParticle(b.x, b.y, {
        vx: Math.cos(a) * 150, vy: Math.sin(a) * 150,
        life: 0.24, r: 3, color: '#ffd0a0', drag: 0.85
      });
    }
    if (!count) SFX.hit();
  }

  /** 敌机死亡时向四周散射子弹（浮雷专用） */
  deathBurst(e) {
    const n = e.def.deathBurst;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + rand(-0.06, 0.06);
      const sp = 138 + rand(-16, 26);
      this.spawnEnemyBullet(e.x, e.y, Math.cos(a) * sp, Math.sin(a) * sp, {
        kind: 'enemyAlt',
        r: 7,
        life: 5
      });
    }
    this.addParticle(e.x, e.y, { life: 0.32, r: 44, color: '#c9a6ff', drag: 1 });
    SFX.enemyShoot();
  }

  /** BOSS 的侧翼武器被打掉 */
  onBossPartDestroyed(boss, part) {
    this.explode(boss.x + part.dx, boss.y + part.dy, 1.4, '#ffd166', 24);
    boss.jitter(15);
    SFX.explode(true);
    this.score += 800;
    this.spawnPickup(boss.x + part.dx, boss.y + part.dy + 24, 'P');
  }

  /** 浮游炮被打掉 */
  onDroneDestroyed(boss, drone, px, py) {
    this.explode(px, py, 1.0, '#ffd166', 16);
    boss.jitter(9);
    SFX.explode(false);
    this.score += 600;
  }

  /** 弹幕墙：整圈密排，留一个缓慢旋转的缺口 */
  bossWall(b) {
    const n = 40;                          // 40 发整圈才像"墙"，28 发是散点
    const gap = Math.floor(b.wallPhase) % n;
    b.wallPhase += 2.6;
    b.wallAng += 0.09;

    for (let i = 0; i < n; i++) {
      let d = Math.abs(i - gap);
      d = Math.min(d, n - d);
      if (d <= 1.5) continue;              // 缺口宽 4 发
      const a = (i / n) * Math.PI * 2 + b.wallAng;
      this.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 170, Math.sin(a) * 170,
        { kind: 'enemyAlt', r: 9, life: 7 });
    }
    SFX.enemyShoot();
  }

  /** 镜像武器：按玩家当前主武器换一种打法 */
  bossMirrorShot(b) {
    const p = this.player;
    const id = WEAPONS[p.weapons[0]].id;
    const base = Math.atan2(p.y - b.y, p.x - b.x);

    let n = 5, spread = 0.9, speed = 240, kind = 'enemy', r = 8;
    if (id === 'spread') { n = 9; spread = 1.5; speed = 212; }
    else if (id === 'laser') { n = 3; spread = 0.16; speed = 520; r = 9; }
    else if (id === 'missile') { n = 3; spread = 0.5; speed = 176; }
    else if (id === 'plasma') { n = 3; spread = 0.42; speed = 198; kind = 'big'; r = 13; }
    else if (id === 'flak') { n = 6; spread = 1.25; speed = 226; }
    else if (id === 'tesla') { n = 4; spread = 0.6; speed = 300; kind = 'enemyAlt'; }
    else if (id === 'backfire') { n = 4; spread = 0.7; speed = 262; }
    else if (id === 'omni') { n = 12; spread = Math.PI * 2; speed = 200; kind = 'enemyAlt'; }

    for (let i = 0; i < n; i++) {
      const ang = spread >= Math.PI * 2
        ? (i / n) * Math.PI * 2
        : base + (i / (n - 1) - 0.5) * spread;
      this.spawnEnemyBullet(b.x, b.y + 26, Math.cos(ang) * speed, Math.sin(ang) * speed,
        { kind, r, life: 4 });
    }
    this.mirrorToastT = 1.3;
    SFX.enemyShoot();
  }

  /** 分裂型 BOSS 退场，放出两个分身 */
  summonSplits(boss, count) {
    const n = count || 2;
    for (let i = 0; i < n; i++) {
      const e = this.enemies.find(o => !o.active);
      if (!e) break;
      const x = clamp(VIEW.w / 2 + (i === 0 ? -116 : 116), 92, VIEW.w - 92);
      e.init('splitling', x, 260, { summoned: true, centerX: x, sweep: 24 });
      this.explode(x, 260, 1.3, '#b2ff60', 20);
    }
    boss.jitter(22);
  }

  onBossSplit(boss) {
    this.splitToastT = 2.0;
    this.explode(boss.x, boss.y, 1.8, '#b2ff60', 26);
    boss.jitter(24);
    SFX.warn();
  }

  /** 召唤型 BOSS 退场，放出援军 */
  summonBossMinions(boss, count) {
    const n = count || 3;
    for (let i = 0; i < n; i++) {
      const e = this.enemies.find(o => !o.active);
      if (!e) break;
      const x = clamp(VIEW.w / 2 + (i - (n - 1) / 2) * 134, 76, VIEW.w - 76);
      e.init('miniboss', x, 208, {
        hp: 55, summoned: true,
        centerX: x, sweep: 34          // 各自在出生点小幅摆动，不会挤到中间叠一起
      });
      this.explode(x, 208, 0.9, '#ffd166', 14);
    }
    boss.jitter(18);
  }

  hasSummonedMinions() {
    return this.enemies.some(e => e.active && e.summoned);
  }

  onBossSummon(boss) {
    boss.jitter(24);
    this.explode(boss.x, boss.y, 1.8, '#ffffff', 26);
    this.summonT = 2.4;
    SFX.warn();
  }

  onWeaponChanged() {
    this.wpnTitle = WEAPONS[this.player.weapon].name;
    this.wpnSub = WEAPONS[this.player.weapon].cn + ' · Lv' + this.player.power;
    this.wpnColor = WEAPONS[this.player.weapon].color;
    this.wpnToastT = 1.5;
  }

  /** 占用一个空槽：多出一种同时开火的武器 */
  onWeaponAdded(p, idx) {
    this.wpnTitle = WEAPONS[idx].name;
    this.wpnSub = WEAPONS[idx].cn + ' · 槽位 ' + p.weapons.length + '/' + WEAPON_SLOTS;
    this.wpnColor = WEAPONS[idx].color;
    this.wpnToastT = 1.8;
    SFX.weaponSwitch();
  }

  /** 槽位已满：挤掉最旧的副武器 */
  onWeaponReplaced(p, out, idx) {
    this.wpnTitle = WEAPONS[idx].name;
    this.wpnSub = '替换 ' + WEAPONS[out].name + ' · 槽位已满';
    this.wpnColor = WEAPONS[idx].color;
    this.wpnToastT = 1.8;
    SFX.weaponSwitch();
  }

  /** 已有同款武器但未满级 */
  onWeaponDup(p, idx) {
    this.wpnTitle = WEAPONS[idx].name;
    this.wpnSub = '已装备 · 满级后再吃触发全弹发射';
    this.wpnColor = WEAPONS[idx].color;
    this.wpnToastT = 1.4;
  }

  onOptionGained(p) {
    this.optToastT = 1.6;
    this.flashT = Math.max(this.flashT, 0.14);
    SFX.optionGain();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const o = p.options[p.options.length - 1];
      this.addParticle(o.x, o.y, {
        vx: Math.cos(a) * 260, vy: Math.sin(a) * 260,
        life: 0.45, r: 4, color: '#9ff0ff', drag: 0.88
      });
    }
  }

  onOptionFull(p) {
    this.optToastT = 1.8;
    this.optFull = true;
    SFX.optionGain();
    // 满员转化成的无敌也要有反馈，否则玩家只会看到"吃了个没用的东西"
    this.flashT = Math.max(this.flashT, 0.16);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      this.addParticle(p.x, p.y, {
        vx: Math.cos(a) * 240, vy: Math.sin(a) * 240,
        life: 0.5, r: 4, color: '#ffe38a', drag: 0.9
      });
    }
  }

  onOrbitGained(p) {
    this.orbitToastT = 1.6;
    this.flashT = Math.max(this.flashT, 0.12);
    SFX.optionGain();
    const o = p.orbits[p.orbits.length - 1];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      this.addParticle(o.x, o.y, {
        vx: Math.cos(a) * 240, vy: Math.sin(a) * 240,
        life: 0.45, r: 4, color: '#ff8ce0', drag: 0.88
      });
    }
  }

  /** 环绕机满员后再吃 R：转速强化，要有明确反馈 */
  onOrbitFull(p) {
    this.orbitToastT = 1.6;
    this.orbitBoostHint = true;
    this.flashT = Math.max(this.flashT, 0.16);
    SFX.optionGain();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      this.addParticle(p.x, p.y, {
        vx: Math.cos(a) * 300, vy: Math.sin(a) * 300,
        life: 0.5, r: 4, color: '#ffd0f4', drag: 0.9
      });
    }
  }

  onOverdrive(p) {
    this.flashT = Math.max(this.flashT, 0.18);
    this.shake(10);
    this.overT = 1.5;
    this.overName = (WEAPONS[p.weapons[0]] || WEAPONS[0]).cn;   // 提示里带上武器名
    this.wpnToastT = 0;
    this.wpnTitle = '';
    this.wpnSub = '';
    this.wpnColor = '#7fe0ff';          // 两个提示别叠在一起
    SFX.overdrive();
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2;
      this.addParticle(p.x, p.y, {
        vx: Math.cos(a) * 360, vy: Math.sin(a) * 360,
        life: 0.5, r: 5, color: '#ffe38a', drag: 0.9
      });
    }
  }

  onEnemyKilled(e) {
    // 蛇头是整条蛇的命门：打爆它 → 整条崩解，而不是爆掉一个普通单位
    if (e.kind === 'snakeHead') {
      this.score += e.def.score;
      this.killSnake(e);
      return;
    }

    // 蛇身被剪掉：必须从控制器里摘掉。
    // 这些节是池子里的普通 Enemy，不摘的话会被 _spawnEnemy 复用成别的敌机，
    // controller 还拿着引用 → 会把"别人"当成自己的第 N 节，位置和血量全乱。
    if (e.kind === 'snakeBody' && this.snake) {
      const i = this.snake.segs.indexOf(e);
      if (i >= 0) this.snake.segs.splice(i, 1);
    }

    // 小 BOSS 击破 = 一个明确的"喘息点"：按关卡 supply 表里 ev:'miniboss' 的条目补一份道具
    if (e.kind === 'miniboss') this._fireSupplyEvent('miniboss');

    // 3.3.0 血量上调后阈值同步提高：否则连 fighter(11) 都算“大爆”，满屏震屏
    const big = e.maxHp >= 35 || e.elite;
    this.score += e.def.score * (e.elite ? 5 : 1);
    this.explode(e.x, e.y, big ? 1.25 : 0.7, e.elite ? '#ffd166' : this.level.accent, big ? 18 : 9);
    SFX.explode(big);
    // 击破敌机不震屏：一关打一百多架，震屏会变成持续噪音。
    // 这里只保留爆炸粒子 + 音效，反馈靠"炸开"本身。


    // 死亡散射：浮雷被打爆会朝四周溅射子弹
    // 保险清屏时不触发，否则一次炸出满屏弹幕，反而惩罚玩家
    if (e.def.deathBurst && !this._bombing) this.deathBurst(e);

    // 掉落（保险清屏时不掉，避免一次刷满屏）
    if (this._bombing) return;
    // 蛇身不掉落：一条蛇 8 节，每节都掉的话等于刷了 8 次道具
    if (e.kind === 'snakeBody') return;
    if (e.elite) {
      const k1 = pick(['P', 'W', 'B']);
      this.spawnPickup(e.x - 14, e.y, k1,
        k1 === 'W' ? pick(unlockedWeapons(this.level.id)) : 0);
      this.spawnPickup(e.x + 14, e.y, 'H');
      return;
    }
    const roll = Math.random();
    for (const d of DROPS) {
      if (roll < d.upto) {
        this.spawnPickup(e.x, e.y, d.kind,
          d.kind === 'W' ? pick(unlockedWeapons(this.level.id)) : 0);
        break;
      }
    }
  }

  /* -------------------------------------------------- 生成 */
  spawnPlayerBullet(x, y, vx, vy, dmg, opt) {
    const b = this.bullets.find(o => !o.active);
    if (!b) return;
    opt = opt || {};
    const mul = this._shotMul || 1;
    // 朝下打的子弹按后向火力结算：机尾可打区域极窄，命中窗口短，必须更高伤害才有存在感。
    // 全弹发射的环射已经按"超规格"给足伤害（noRear），不再叠这一层。
    const rear = (vy > 0 && !opt.noRear) ? PLAYER.rearDmgMul : 1;
    b.init(x, y, vx, vy, {
      friendly: true,
      dmg: (dmg || 1) * mul * rear,
      r: opt.r || 8,
      kind: opt.kind || 'player',
      pierce: opt.pierce,
      homing: opt.homing,
      boom: opt.boom,
      fuse: opt.fuse,
      chain: opt.chain,
      life: opt.life || 2.2
    });
  }

  /** 追踪弹用：找最近的敌机或 BOSS */
  nearestEnemy(x, y) {
    let best = null;
    let bd = Infinity;
    for (const e of this.enemies) {
      if (!e.active) continue;
      const d = dist2(x, y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    if (this.bossActive && !this.boss.dead) {
      const d = dist2(x, y, this.boss.x, this.boss.y);
      if (d < bd) best = this.boss;
    }
    return best;
  }

  spawnEnemyBullet(x, y, vx, vy, opt) {
    const b = this.bullets.find(o => !o.active);
    if (!b) return;
    opt = opt || {};
    b.init(x, y, vx, vy, {
      friendly: false,
      kind: opt.kind || 'enemy',
      r: opt.r || 6,
      ay: opt.ay || 0,
      life: 7
    });
  }

  queueEnemy(wave, x, y, delay, slot) {
    this.queue.push({
      at: this.stageT + delay,
      kind: wave.kind,
      x: x,
      y: y,
      hp: wave.hp,
      speed: wave.speed,
      slot: slot === undefined ? 0.5 : slot,   // 在编队中的位置比例 0~1
      side: wave.side,                         // 'left' / 'right'：从侧面入场
      arc: wave.arc,                           // true：侧下方 → 侧上方的弧线掠袭
      diag: wave.diag                          // 'ltr' / 'rtl'：对角穿越
    });
  }

  spawnPickup(x, y, kind, weapon, opt) {
    const p = this.pickups.find(o => !o.active);
    if (p) p.init(x, y, kind, weapon, opt);
  }

  /* ------------------------------------------------ 关卡补给投放
   * 道具不再只靠敌人掉：每关按主题在固定时间点 / 事件点投放，
   * 入场方式有自上飘下、自下升起、以及到底边（或顶边）反弹再飘走四种。
   * 数据见 config.js 每关的 supply 表。
   */

  /** 排进投放队列，按时间插入（事件触发的那几条也走这里） */
  _queueSupply(at, spec) {
    if (!this._supplyQ) this._supplyQ = [];
    const q = this._supplyQ;
    let i = q.length;
    while (i > 0 && q[i - 1].at > at) i--;
    q.splice(i, 0, { at: at, spec: spec });
  }

  /** 事件点补给：小 BOSS 被击破后隔 delay 秒再送一份 */
  _fireSupplyEvent(name) {
    const lv = this.level;
    if (!lv || !lv.supply) return;
    for (const s of lv.supply) {
      if (s.ev === name) this._queueSupply(this.stageT + (s.delay || 1.2), s);
    }
  }

  _updateSupply() {
    const q = this._supplyQ;
    if (!q || !q.length) return;
    while (q.length && this.stageT >= q[0].at) this.spawnSupply(q.shift().spec);
  }

  spawnSupply(spec) {
    const from = spec.from || 'top';
    const isTop = from === 'top' || from === 'bounce';
    // x 省略时随机；给了 0~1 比例则按屏宽换算，用来摆"上下对开"这种呼应位
    const x = spec.x === undefined
      ? rand(56, VIEW.w - 56)
      : clamp(spec.x * VIEW.w, 48, VIEW.w - 48);
    const kind = spec.kind || 'P';
    const weapon = kind === 'W'
      ? (spec.weapon === undefined ? pick(unlockedWeapons(this.level.id)) : spec.weapon)
      : 0;
    this.spawnPickup(x, isTop ? -22 : VIEW.h + 24, kind, weapon, {
      dir: isTop ? 1 : -1,
      bounce: (from === 'bounce' || from === 'riseBounce') ? 1 : 0,
      sway: spec.sway || 0,
      speed: spec.speed || 78
    });
  }

  addParticle(x, y, opt) {
    const p = this.particles.find(o => !o.active);
    if (p) p.init(x, y, opt);
  }

  shake(amp) {
    this.shakeAmp = Math.max(this.shakeAmp, amp);
    this.shakeT = 0.32;
  }

  explode(x, y, scale, color, count) {
    const n = count || 12;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(40, 260) * scale;
      this.addParticle(x, y, {
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.25, 0.70) * scale,
        r: rand(2, 5) * scale,
        color: i % 3 === 0 ? '#ffffff' : color
      });
    }
    // 冲击波
    this.addParticle(x, y, {
      vx: 0, vy: 0, life: 0.28, r: 26 * scale, color: '#ffffff', drag: 1
    });
  }

  /* -------------------------------------------------- 更新 */
  update(dt) {
    this.totalT += dt;

    if (this.shakeT > 0) {
      this.shakeT -= dt;
      if (this.shakeT <= 0) this.shakeAmp = 0;
    }
    if (this.flashT > 0) this.flashT -= dt;
    if (this.wpnToastT > 0) this.wpnToastT -= dt;
    if (this.overT > 0) this.overT -= dt;
    if (this.optToastT > 0) this.optToastT -= dt;
    else this.optFull = false;
    if (this.orbitToastT > 0) this.orbitToastT -= dt;
    else this.orbitBoostHint = false;
    if (this.mirrorToastT > 0) this.mirrorToastT -= dt;
    if (this.splitToastT > 0) this.splitToastT -= dt;
    if (this.rearmToastT > 0) this.rearmToastT -= dt;
    if (this.bigToastT > 0) this.bigToastT -= dt;
    if (this.contToastT > 0) this.contToastT -= dt;
    if (this.devToastT > 0) this.devToastT -= dt;
    for (let i = this.arcs.length - 1; i >= 0; i--) {
      this.arcs[i].life -= dt;
      if (this.arcs[i].life <= 0) this.arcs.splice(i, 1);
    }
    if (this.summonT > 0) this.summonT -= dt;
    for (let i = this.warnings.length - 1; i >= 0; i--) {
      this.warnings[i].t -= dt;
      if (this.warnings[i].t <= 0) this.warnings.splice(i, 1);
    }
    this.bgScroll += 62 * dt;

    if (this.paused) return;

    // 调试：无限保险——每帧补满，连按也不会消耗完（普通与激光两种一起管）
    if (this.infiniteBombs) {
      this.player.bombs = PLAYER.maxBombs;
      this.player.lasers = PLAYER.maxLaserBombs;
    }

    if (this.state === 'title') {
      this._updateStars(dt);
      return;
    }

    if (this.state === 'intro') {
      this.bannerT -= dt;
      this._updateParticles(dt);
      this._updateBullets(dt);          // 开场就能开火，子弹必须一起走
      this.player.update(dt, this._inputFor(dt), this);
      this._collectPickups();
      if (this.bannerT <= 0) this.state = 'play';
      return;
    }

    if (this.state === 'warn') {
      this.warnT -= dt;
      this._updateParticles(dt);
      this.player.update(dt, this._inputFor(dt), this);
      this._updateBullets(dt);
      this._updatePickups(dt);        // 预警不是暂停，掉落物要继续下落
      this._collectPickups();         // 也必须能捡
      this._updateBombSystems(dt);    // 预警不是暂停：在飞的炸弹/激光/冲击环照样走
      if (this.warnT <= 0) this.spawnBoss();
      return;
    }

    if (this.state === 'clear') {
      this.clearT -= dt;
      this._updateParticles(dt);
      this._updateBullets(dt);
      this._updatePickups(dt);
      this._updateBombSystems(dt);    // 同上：结算期的炸弹要能落地
      this.player.update(dt, this._inputFor(dt), this);   // 结算期间可自由移动吃道具
      this._collectPickups();
      if (this.clearT <= 0) {
        if (this.levelIdx + 1 < LEVELS.length) {
          this.startLevel(this.levelIdx + 1, true);
        } else {
          this.state = 'win';
          this.winT = 0;      // 刚进通关页：输入锁与提示渐显都从这里起算
        }
      }
      return;
    }

    if (this.state === 'gameover') {
      this.deadT += dt;
      if (this.contT > 0) this.contT -= dt;
      this._updateParticles(dt);
      this._updateBullets(dt);
      this._updateEnemies(dt);
      return;
    }

    if (this.state === 'win') {
      this.winT += dt;
      this._updateParticles(dt);
      return;
    }

    /* ---- play / boss ---- */
    const inp = this._inputFor(dt);
    this.player.update(dt, inp, this);
    this._updateBombSystems(dt);
    this._updateBullets(dt);
    this._updateSnake(dt);
    this._updateEnemies(dt);
    this._updateParticles(dt);
    this._updatePickups(dt);
    this._updateStars(dt);

    if (this.state === 'play') {
      this.stageT += dt;
      this._updateWaves();
      this._updateSupply();

      this._trackMiniBoss();
      this._updateOutro(dt);

      if (this.waveIdx >= this.waves.length && this.queue.length === 0) {
        const alive = this.enemies.some(e => e.active);
        // 收尾段没打完就不许进 BOSS：否则会出现"小 BOSS 一死就 BOSS 预警"
        if (!alive && !this._outroPending()) {
          if (this._clearDelay === undefined) this._clearDelay = 1.1;
          this._clearDelay -= dt;
          if (this._clearDelay <= 0) {
            this._clearDelay = undefined;
            this.startBossWarn();
          }
        } else {
          this._clearDelay = 1.1;
        }
      }
    }

    if (this.bossActive) {
      this.boss.update(dt, this);

      // BOSS 战定期空投补给：火力被打光后还有翻盘机会
      if (this.state === 'boss' && !this.boss.dead && !this.boss.enter) {
        this.supplyT -= dt;
        if (this.supplyT <= 0) {
          // BOSS 血量翻倍后战斗更长，补给要跟上，否则中后期只能刮痧
          this.supplyT = 7.0;
          const roll = Math.random();
          const kind = roll < 0.72 ? 'P' : roll < 0.88 ? 'B' : 'H';
          this.spawnPickup(rand(56, VIEW.w - 56), -18, kind);
        }
      }
    }

    this._collide();
    this._collectPickups();

    // 阵亡延迟：状态还是 play/boss，敌机与子弹继续跑，让爆炸演完再切结算页
    if (this.deathDelayT > 0) {
      this.deathDelayT -= dt;
      this._dyingT = (this._dyingT || 0) + dt;

      // 分段二次爆炸：一次大爆炸 0.3 秒就散完了，剩下 1.2 秒空白会像卡住
      const marks = [0.22, 0.46, 0.70, 0.94, 1.18];
      while (this._dyingBurst < marks.length && this._dyingT >= marks[this._dyingBurst]) {
        const k = this._dyingBurst++;
        this.explode(
          this._dyingX + rand(-30, 30),
          this._dyingY + rand(-26, 26),
          k % 2 ? 1.5 : 1.1,
          k % 2 ? '#ffd166' : '#8fe8ff',
          k % 2 ? 22 : 16
        );
        if (k % 2 === 0) SFX.explode(false);
      }

      if (this.deathDelayT <= 0) {
        this.deathDelayT = 0;
        this.onPlayerDead();
      }
    }
  }

  _inputFor(dt) {
    if (this.demo) {
      this.demoT += dt;
      input.pointerActive = true;
      input.px = VIEW.w / 2 + Math.sin(this.demoT * 0.9) * (VIEW.w * 0.34);
      input.py = VIEW.h * 0.78 + Math.sin(this.demoT * 1.7) * 40;
    }
    return input;
  }

  _updateStars(dt) {
    for (const s of this.stars) {
      s.y += (40 + s.z * 150) * dt;
      if (s.y > VIEW.h + 4) {
        s.y = -4;
        s.x = Math.random() * VIEW.w;
      }
    }
  }

  /* ------------------------------------------------ BOSS 前的收尾编队段
   * 波次是按时间生成的：玩家打小 BOSS 花 15~25 秒，这期间后面的兵已经全部出完，
   * 于是"小 BOSS 一死就直接进 BOSS 预警"（实测多关只隔 1.1~2 秒）。
   * 这里在小 BOSS 清空后强制续一段编队，撑满 OUTRO.span 才放 BOSS。
   */

  /** 记录本关小 BOSS 的出场与清空时刻 */
  _trackMiniBoss() {
    if (this.miniSeen && this.miniGoneT !== undefined) return;
    // 后面还有一轮小 BOSS 没出场，此刻的"清空"不算数（第 9 关有两轮）
    if (this.stageT < (this.lastMiniAt || 0)) return;

    const alive = this.enemies.some(e =>
      e.active && (e.kind === 'miniboss' || e.kind === 'snakeHead'));
    // 队列里还有没出生的小 BOSS 也算"没清空"：三架是隔 0.28 秒依次入场的
    const queued = this.queue.some(q => q.kind === 'miniboss' || q.kind === 'snake');
    if (alive || queued) {
      this.miniSeen = true;
      return;
    }
    // 清空的那一帧：记下时间，并给收尾段起个头
    if (this.miniSeen && this.miniGoneT === undefined) {
      this.miniGoneT = this.stageT;
      this.outroNextT = OUTRO.firstDelay;
    }
  }

  /** 收尾段是否还没撑满（没小 BOSS 的关卡直接返回 false，走原流程） */
  _outroPending() {
    return this.outroStartT !== undefined && !this.outroDone;
  }

  /**
   * 从小 BOSS 清空、且本关波次全部放完后开始，按 gap 投放编队。
   * 起算点定在"波次放完"而不是"小 BOSS 死"，是为了不和后半段的正常波次叠加——
   * 第 7 关小 BOSS 24 秒就死了，但正常波次一直到 42 秒，叠加会把密度顶到两倍。
   */
  _updateOutro(dt) {
    if (this.outroDone || this.miniGoneT === undefined) return;

    if (this.outroStartT === undefined) {
      if (!(this.waveIdx >= this.waves.length && this.queue.length === 0)) return;
      this.outroStartT = this.stageT;
      this.outroNextT = OUTRO.firstDelay;
    }

    const elapsed = this.stageT - this.outroStartT;
    if (elapsed >= OUTRO.span) {
      this.outroDone = true;
      return;
    }
    // 尾段不再补兵：否则最后一组刚出屏幕就 BOSS 预警，收尾段会被拖成 20 多秒
    if (elapsed >= OUTRO.span - OUTRO.tail) return;

    this.outroNextT -= dt;
    if (this.outroNextT > 0) return;
    this.outroNextT = OUTRO.gap;

    const pool = this._outroPool();
    if (!pool.kinds.length) return;

    // 同一组内统一机型 + 统一阵型，看起来才像"编队"而不是随机杂兵
    spawnFormation(this, {
      kind: pick(pool.kinds),
      form: pick(pool.forms),
      n: randInt(OUTRO.minN, OUTRO.maxN),
      at: 0,
      gap: 0.15
    });
  }

  /** 收尾段的机型/阵型池：从本关已有波次里取，风格自然一致 */
  _outroPool() {
    if (this.outroPool) return this.outroPool;
    // 排除：小 BOSS 本身、从底部升起的单位、漂雷（这几类不成编队）
    const skip = ['miniboss', 'snake', 'riser', 'looper', 'mine', 'mineH'];
    const kinds = [];
    const forms = [];
    for (const w of this.level.waves) {
      if (skip.indexOf(w.kind) >= 0) continue;
      if (kinds.indexOf(w.kind) < 0) kinds.push(w.kind);
      if (w.form && forms.indexOf(w.form) < 0) forms.push(w.form);
    }
    this.outroPool = {
      kinds: kinds.length ? kinds : ['fighter', 'formation'],
      forms: forms.length ? forms : ['line', 'vee', 'arc']
    };
    return this.outroPool;
  }

  _updateWaves() {
    // 兜底：任何让 state 提前变成 play 的路径（调试跳关、外部调用）都可能还没建波次表
    if (!Array.isArray(this.waves)) return;
    const waves = this.waves;
    while (this.waveIdx < waves.length && this.stageT >= waves[this.waveIdx].at) {
      spawnFormation(this, waves[this.waveIdx]);
      this.waveIdx++;
    }
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      if (this.stageT >= q.at) {
        this._spawnEnemy(q);
        this.queue.splice(i, 1);
      }
    }
  }

  _spawnEnemy(q) {
    // 蛇不是"一个敌人"，而是一串由控制器驱动的部件
    if (q.kind === 'snake') { this.spawnSnake(); return; }

    const e = this.enemies.find(o => !o.active);
    if (!e) return;
    // 精英变体：只在中小型机里出，大型机本身够硬不再强化
    const canElite = ELITE_KINDS.indexOf(q.kind) >= 0;
    const elite = canElite && Math.random() < ELITE_CHANCE;

    // 从屏幕底部来的单位：从画面外升起，并先给底部警告
    const fromBottom = BOTTOM_SPAWN.indexOf(q.kind) >= 0;
    const y = fromBottom ? VIEW.h + 130 : q.y;

    // 中型机：按编队位置分到 0.24W ~ 0.76W 的车道，否则三架会一起飞到屏幕中心叠成一架
    const isMini = q.kind === 'miniboss';
    const laneX = VIEW.w * (0.24 + (q.slot === undefined ? 0.5 : q.slot) * 0.52);

    // 警示标记也按车道放，不然三个红柱会叠在同一处
    if (fromBottom) {
      this.warnings.push({ x: isMini ? laneX : q.x, t: 1.6, max: 1.6 });
    }
    // 对角穿越从屏幕下角起，也属于"从背后上来"，给个短警示
    if (q.diag) {
      this.warnings.push({ x: clamp(q.x, 44, VIEW.w - 44), t: 1.0, max: 1.0 });
    }

    // 中型机直接出生在自己的车道上：编队 x 只用于顶部来敌，
    // 对从底部升起的单位没有意义，用了反而会斜着爬升
    e.init(q.kind, isMini ? laneX : q.x, y, {
      hp: q.hp,
      speed: q.speed,
      elite: elite,
      fromBottom: fromBottom,
      centerX: isMini ? laneX : undefined,
      sweep: isMini ? 40 : undefined,
      entry: q.side,
      arc: q.arc,
      diag: q.diag
    });
  }

  /* ------------------------------------------------ 激光保险 */

  /** 是否成功启动一条激光（同一时间只允许一条） */
  startLaser() {
    const L = this.laserBeam;
    if (!L || L.state !== 0) return false;
    L.state = 1;      // 蓄力
    L.t = 0;
    L.tickT = 0;
    this.laserCdT = PLAYER.laserCd;    // 和普通保险各算各的，互不影响
    SFX.laserCharge();
    return true;
  }

  _updateLaser(dt) {
    const L = this.laserBeam;
    if (!L || L.state === 0) return;

    L.t += dt;

    if (L.state === 1) {
      if (L.t < PLAYER.laserCharge) return;
      // 蓄满：开火
      L.state = 2;
      L.t = 0;
      L.tickT = 0;
      this.shake(14);
      this.flashT = Math.max(this.flashT, 0.24);
      SFX.laserFire();
      this.player.invuln = Math.max(this.player.invuln, PLAYER.laserInvuln);
      return;
    }

    // 发射中：按 tick 结算伤害
    L.tickT -= dt;
    if (L.tickT <= 0) {
      L.tickT = PLAYER.laserTick;
      this._laserDamage();
    }
    if (L.t >= PLAYER.laserFire) {
      L.state = 0;
      L.t = 0;
    }
  }

  /** 光束命中的一切：敌弹消失、敌机持续掉血、BOSS 掉血 */
  _laserDamage() {
    const p = this.player;
    if (!p.alive) return;
    const halfW = PLAYER.laserWidth / 2;

    // 敌弹：扫掉路径上的，这是"保险"该有的样子
    for (const b of this.bullets) {
      if (!b.active || b.friendly) continue;
      if (b.y > p.y) continue;
      if (Math.abs(b.x - p.x) > halfW + b.r) continue;
      b.active = false;
      this.addParticle(b.x, b.y, {
        vx: rand(-40, 40), vy: rand(-90, -20), life: 0.25, r: 4, color: '#c8a6ff'
      });
    }

    // 敌机
    for (const e of this.enemies) {
      if (!e.active) continue;
      if (e.y > p.y) continue;
      if (Math.abs(e.x - p.x) > halfW + e.r) continue;
      e.hit(PLAYER.laserDmgEnemy, null, this);
      this.addParticle(e.x + rand(-10, 10), e.y + rand(-8, 8), {
        vx: rand(-30, 30), vy: rand(-80, -20), life: 0.2, r: 3, color: '#e0ccff'
      });
    }

    // BOSS：用轮廓判定的横向范围近似"光束是否压在它身上"
    const bo = this.boss;
    if (this.bossActive && bo && !bo.dead && !bo.invuln && bo.y < p.y) {
      if (this._bossHits(bo, p.x, bo.y, halfW)) {
        bo.hit(PLAYER.laserDmgBoss, this);
        this.addParticle(p.x + rand(-14, 14), bo.y + rand(-30, 30), {
          vx: rand(-40, 40), vy: rand(-90, -30), life: 0.22, r: 4, color: '#e0ccff'
        });
        SFX.hit();
      }
    }
  }

  _updateBullets(dt) {
    for (const b of this.bullets) {
      if (b.active) b.update(dt, this);
    }
  }

  /* ------------------------------------------------ 蛇形小 BOSS
   * 一条蛇 = 1 个头 + N 节身体，每个部件都是普通 Enemy（碰撞、受击、死亡全复用），
   * 只是位置由这里沿"圆角矩形环路"的弧长统一写入，绘制也由这里整体画。
   * 设计意图：头难打（1000 血）但打爆即整条崩解；身体脆（130 血）而且每节都在发弹，
   * 所以玩家要在"剪发弹点"和"啃头"之间做选择。
   */

  spawnSnake() {
    if (this.snake) this._clearSnake();
    const head = this.enemies.find(o => !o.active);
    if (!head) return;

    head.init('snakeHead', VIEW.w / 2, -60, { hp: SNAKE.headHp });
    head.ai = 'snake';
    head.snakeLink = true;
    head.r = SNAKE.headR;
    head.spawnGuard = SNAKE.spawnGuard;

    const segs = [];
    for (let i = 0; i < SNAKE.segs; i++) {
      const e = this.enemies.find(o => !o.active);
      if (!e) break;
      e.init('snakeBody', VIEW.w / 2, -60, { hp: SNAKE.segHp });
      e.ai = 'snake';
      e.snakeLink = true;
      e.segIdx = i;
      const k = SNAKE.segs > 1 ? i / (SNAKE.segs - 1) : 0;
      e.r = SNAKE.segR0 + (SNAKE.segR1 - SNAKE.segR0) * k;   // 越靠尾巴越细
      e.off = (i + 1) * SNAKE.spacing;    // 沿路径的弧长偏移，断节后会重新收敛
      e.spawnGuard = SNAKE.spawnGuard;
      segs.push(e);
    }

    this.snake = {
      head, segs,
      total: segs.length,      // 初始节数，暴走判定用（segs 会被 splice 缩短）
      path: this._snakePath(),
      dist: 0,
      spawnT: 0,
      fireT: 0.9,
      fireIdx: 0,
      headFireT: 2.2,
      rage: false,        // 暴走：掉够节数或头血量过半后触发
      rageFlash: 0
    };
    this._bigToast('SERPENT', '蛇形单位 · 打掉头才算击杀', '#c9a6ff');
    SFX.warn();
  }

  /** 沿屏幕四周的圆角矩形环路采样成点列，并累计弧长 */
  _snakePath() {
    const P = SNAKE.inset;
    const l = P.x, r = VIEW.w - P.x;
    const t = P.top, b = VIEW.h - P.bottom, rad = P.radius;
    const pts = [];
    const line = (x0, y0, x1, y1) => {
      const n = Math.max(1, Math.round(Math.hypot(x1 - x0, y1 - y0) / 6));
      for (let i = 0; i < n; i++) {
        pts.push({ x: x0 + (x1 - x0) * i / n, y: y0 + (y1 - y0) * i / n });
      }
    };
    const arc = (cx, cy, a0, a1) => {
      const n = Math.max(2, Math.round(Math.abs(a1 - a0) * rad / 6));
      for (let i = 0; i < n; i++) {
        const a = a0 + (a1 - a0) * i / n;
        pts.push({ x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad });
      }
    };
    // 顺时针一圈：左上角 → 上边 → 右上角 → 右边 → 右下角 → 下边 → 左下角 → 左边
    arc(l + rad, t + rad, Math.PI, Math.PI * 1.5);
    line(l + rad, t, r - rad, t);
    arc(r - rad, t + rad, -Math.PI / 2, 0);
    line(r, t + rad, r, b - rad);
    arc(r - rad, b - rad, 0, Math.PI / 2);
    line(r - rad, b, l + rad, b);
    arc(l + rad, b - rad, Math.PI / 2, Math.PI);
    line(l, b - rad, l, t + rad);

    const acc = [0];
    for (let i = 1; i < pts.length; i++) {
      acc.push(acc[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
    }
    return { pts, acc, total: acc[acc.length - 1] };
  }

  /** 取环路上距起点 dist 弧长的位置（负值即往回走，身体节用） */
  _snakeAt(path, dist) {
    const total = path.total;
    let d = dist % total;
    if (d < 0) d += total;
    const acc = path.acc;
    let lo = 0, hi = acc.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (acc[mid] <= d) lo = mid; else hi = mid;
    }
    const span = (acc[hi] - acc[lo]) || 1;
    const k = (d - acc[lo]) / span;
    const a = path.pts[lo], b = path.pts[hi];
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
  }

  _updateSnake(dt) {
    const s = this.snake;
    if (!s) return;
    if (!s.head.active) { this._clearSnake(); return; }

    s.spawnT += dt;

    // 暴走判定：被剪掉足够多身体，或头血量过半 → 提速 + 加射速。
    // 这样"先剪身体削弱弹幕"就有代价了：剪得越多，剩下的部分越疯。
    if (!s.rage) {
      const lost = s.total - s.segs.length;   // 死掉的节已经被 splice 掉了
      if (lost >= SNAKE.rage.lostSegs || s.head.hp / s.head.maxHp <= SNAKE.rage.hpRatio) {
        s.rage = true;
        s.rageFlash = 0.6;
        this._bigToast('SERPENT ENRAGED', '蛇身被剪断 · 速度与射速提升', '#ff7a8a');
        this.flashT = Math.max(this.flashT, 0.16);
        SFX.warn();
      }
    }
    if (s.rageFlash > 0) s.rageFlash -= dt;

    s.dist += SNAKE.speed * (s.rage ? SNAKE.rage.speedMul : 1) * dt;

    const hp = this._snakeAt(s.path, s.dist);
    const ahead = this._snakeAt(s.path, s.dist + 8);
    s.head.x = hp.x;
    s.head.y = hp.y;
    // 菱形头的"前"是 -y，所以要 +90°
    s.head.rot = Math.atan2(ahead.y - hp.y, ahead.x - hp.x) + Math.PI / 2;

    // 身体按"还活着"重新排位：被打掉的节不留空位，后面的整段往前顶。
    // 用 lerp 收敛（约 0.1 秒）而不是直接赋值，看起来是蛇身收拢到断口，不会瞬移补位。
    const k = Math.min(1, dt * 10);
    let rank = 0;
    for (const e of s.segs) {
      if (!e.active) continue;
      rank++;
      const target = rank * SNAKE.spacing;
      if (e.off === undefined) e.off = target;
      e.off += (target - e.off) * k;
      const q = this._snakeAt(s.path, s.dist - e.off);
      e.x = q.x;
      e.y = q.y;
    }

    if (this.player.alive) this._snakeFire(dt, s);
  }

  _snakeFire(dt, s) {
    const p = this.player;
    const R = SNAKE.rage;
    const hot = s.rage;

    // 关节轮流发：9 个点齐射会糊屏，轮流才有"一串弹从蛇身上甩出来"的感觉
    s.fireT -= dt;
    if (s.fireT <= 0) {
      s.fireT = SNAKE.fireGap * (hot ? R.fireMul : 1);
      const alive = s.segs.filter(e => e.active);
      if (alive.length) {
        const e = alive[s.fireIdx % alive.length];
        s.fireIdx++;
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        this.spawnEnemyBullet(e.x, e.y,
          Math.cos(a) * SNAKE.bulletSpeed, Math.sin(a) * SNAKE.bulletSpeed,
          { kind: 'enemyAlt' });
      }
    }

    // 头部扇形：暴走时 3 发变 5 发、间隔也缩短
    s.headFireT -= dt;
    if (s.headFireT <= 0) {
      s.headFireT = SNAKE.headFireGap * (hot ? R.headFireMul : 1);
      const h = s.head;
      const base = Math.atan2(p.y - h.y, p.x - h.x);
      const n = hot ? R.headFan : 3;
      const step = n >= 5 ? 0.22 : 0.26;
      for (let i = 0; i < n; i++) {
        const a = base + (i - (n - 1) / 2) * step;
        this.spawnEnemyBullet(h.x, h.y, Math.cos(a) * 225, Math.sin(a) * 225);
      }
      SFX.enemyShoot();
    }
  }

  /** 蛇头被打爆：整条从头到尾依次崩解 */
  killSnake(head) {
    const s = this.snake;
    const segs = s ? s.segs : [];
    const stageIdx = this.levelIdx;

    for (let i = 0; i < segs.length; i++) {
      const e = segs[i];
      if (!e.active) continue;
      const x = e.x, y = e.y;
      e.active = false;
      setTimeout(() => {
        if (this.state === 'gameover' || this.levelIdx !== stageIdx) return;
        this.explode(x, y, 1.0, '#c9a6ff', 12);
        SFX.explode(false);
      }, (i + 1) * 70);
    }
    this.snake = null;

    this.explode(head.x, head.y, 2.1, '#e6d6ff', 36);
    this.flashT = Math.max(this.flashT, 0.24);
    this.shake(20);          // 小 BOSS 被击杀，这里震屏是合理的
    SFX.explode(true);

    const px = clamp(head.x, 60, VIEW.w - 60);
    const py = clamp(head.y + 34, 110, VIEW.h - 90);
    this.spawnPickup(px, py, 'P');
    this.spawnPickup(clamp(px + 30, 60, VIEW.w - 60), py, 'B');
  }

  _clearSnake() {
    const s = this.snake;
    if (s) {
      s.head.active = false;
      for (const e of s.segs) e.active = false;
    }
    this.snake = null;
  }

  _drawSnake(ctx) {
    const s = this.snake;
    if (!s || !s.head.active) return;
    const head = s.head;
    const fade = Math.min(1, s.spawnT / 0.7);
    const chain = [head].concat(s.segs);

    // 暴走后整条换成紫红配色，并让外发光呼吸得更快——玩家一眼能看出"它怒了"
    const hot = !!s.rage;
    const cRing = hot ? '255,130,160' : '201,166,255';
    const cBody = hot ? '#4a1c3e' : '#3a2a5e';
    const cCore = hot ? '255,206,218' : '232,216,255';
    const cBar = hot ? '#ff7a8a' : '#c9a6ff';
    const glowA = hot ? 0.13 + Math.abs(Math.sin(s.spawnT * 9)) * 0.10 : 0.13;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 1) 外发光：沿链逐段描边，宽度取两端半径之和 → 尾巴自然收细
    ctx.globalCompositeOperation = 'lighter';
    for (let i = chain.length - 1; i > 0; i--) {
      const a = chain[i], b = chain[i - 1];
      if (!a.active || !b.active) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = (a.r + b.r) * 1.45;
      ctx.strokeStyle = 'rgba(' + cRing + ',' + glowA.toFixed(3) + ')';
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';

    // 2) 躯体：同一条链再描一遍实色。lineWidth = 两端半径之和，
    //    正好等于两圆相切的宽度，节与节之间不会露出缝
    for (let i = chain.length - 1; i > 0; i--) {
      const a = chain[i], b = chain[i - 1];
      if (!a.active || !b.active) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineWidth = a.r + b.r;
      ctx.strokeStyle = (a.flash > 0 || b.flash > 0) ? '#efe6ff' : cBody;
      ctx.stroke();
    }

    // 3) 脊线：一条细亮线贯穿，给出"这是一条活物"的方向感，断口处自然断开
    ctx.beginPath();
    let started = false;
    for (const e of chain) {
      if (!e.active) { started = false; continue; }
      if (!started) { ctx.moveTo(e.x, e.y); started = true; }
      else ctx.lineTo(e.x, e.y);
    }
    ctx.strokeStyle = 'rgba(' + cRing + ',0.20)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // 4) 分节环：不填充，只画环 + 中心核，读作"一节一节的躯体"而不是一串珠子
    for (let i = s.segs.length - 1; i >= 0; i--) {
      const e = s.segs[i];
      if (!e.active) continue;
      const k = Math.max(0.2, e.hp / e.maxHp);        // 掉血越多越暗
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 0.84, 0, Math.PI * 2);
      ctx.strokeStyle = e.flash > 0 ? '#ffffff'
        : 'rgba(' + cRing + ',' + (0.32 + 0.50 * k).toFixed(2) + ')';
      ctx.lineWidth = 1.8;
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 0.28, 0, Math.PI * 2);
      ctx.fillStyle = e.flash > 0 ? '#ffffff'
        : 'rgba(' + cCore + ',' + (0.24 + 0.44 * k).toFixed(2) + ')';
      ctx.fill();
    }

    // 5) 头：前尖后圆的箭头形，和圆形躯体衔接更自然
    ctx.save();
    ctx.translate(head.x, head.y);
    ctx.rotate(head.rot);

    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hot ? 62 : 52);
    g.addColorStop(0, 'rgba(' + cRing + ',' + (hot ? 0.38 : 0.30) + ')');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, hot ? 62 : 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';

    ctx.beginPath();
    ctx.moveTo(0, -32);
    ctx.quadraticCurveTo(21, -13, 17, 9);
    ctx.lineTo(11, 21);
    ctx.lineTo(-11, 21);
    ctx.lineTo(-17, 9);
    ctx.quadraticCurveTo(-21, -13, 0, -32);
    ctx.closePath();
    ctx.fillStyle = head.flash > 0 ? '#ffffff' : (hot ? '#4a1c3e' : '#33204f');
    ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(255,196,212,0.95)' : 'rgba(228,208,255,0.95)';
    ctx.lineWidth = hot ? 2.8 : 2.4;
    ctx.stroke();

    // 双颚（V 形）与红眼
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(0, 15);
    ctx.lineTo(10, -4);
    ctx.strokeStyle = 'rgba(' + cRing + ',0.72)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    const eyeR = hot ? 4.6 : 3.8;
    for (const dx of [-9, 9]) {
      ctx.beginPath();
      ctx.arc(dx, -10, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = hot ? '#ff3d5e' : '#ff5d7a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(dx, -10, hot ? 2.0 : 1.7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffe6ef';
      ctx.fill();
    }
    ctx.restore();

    // 6) 头部血条：跟着头走，但放在"远离屏幕边缘"的一侧，不会被 HUD 或底边切掉
    const bw = 76;
    const by = head.y < VIEW.h * 0.5 ? head.y + 42 : head.y - 50;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(head.x - bw / 2 - 1, by - 1, bw + 2, 7);
    ctx.strokeStyle = 'rgba(' + cRing + ',0.35)';
    ctx.lineWidth = 1;
    ctx.strokeRect(head.x - bw / 2 - 1, by - 1, bw + 2, 7);
    ctx.fillStyle = cBar;
    ctx.fillRect(head.x - bw / 2, by, bw * Math.max(0, head.hp / head.maxHp), 5);

    // 7) 暴走瞬间：整条叠一层红白，强调"它变强了"
    if (s.rageFlash > 0) {
      const k = Math.min(1, s.rageFlash / 0.6);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = fade * k * 0.55;
      ctx.beginPath();
      started = false;
      for (const e of chain) {
        if (!e.active) { started = false; continue; }
        if (!started) { ctx.moveTo(e.x, e.y); started = true; }
        else ctx.lineTo(e.x, e.y);
      }
      ctx.lineWidth = SNAKE.headR * 2.2;
      ctx.strokeStyle = 'rgba(255,210,225,0.9)';
      ctx.stroke();
    }

    ctx.restore();
  }

  _updateEnemies(dt) {
    for (const e of this.enemies) {
      if (e.active) e.update(dt, this);
    }
  }

  _updateParticles(dt) {
    for (const p of this.particles) {
      if (p.active) p.update(dt);
    }
  }

  _updatePickups(dt) {
    for (const p of this.pickups) {
      if (p.active) p.update(dt, this.player);
    }
  }

  /** BOSS 的判定轮廓：由 tools/gen_boss_hull.py 从精灵 alpha 自动生成。
   *  每个圆是局部坐标（相对本体中心），运行时只做圆-圆距离。 */
  _bossHull(bo) {
    return (typeof BOSS_HULL !== 'undefined' && BOSS_HULL[bo.sprite]) || null;
  }

  /** 点(含半径 r)是否命中 BOSS；没有轮廓数据时退回旧的矩形判定。
   *  轮廓数组支持两种条目（可混用）：
   *    { dx, dy, r }       圆：dx/dy 圆心偏移，r 半径
   *    { dx, dy, w, h }    矩形：dx/dy 中心偏移，w/h 全宽全高（直角机身用它更贴）
   */
  _bossHits(bo, x, y, r, includeParts) {
    const hull = this._bossHull(bo);
    if (!hull) {
      return Math.abs(x - bo.x) < bo.w * 0.36 && Math.abs(y - bo.y) < bo.h * 0.32;
    }
    for (const c of hull) {
      const cx = bo.x + c.dx, cy = bo.y + c.dy;
      if (c.r !== undefined) {
        const dx = x - cx, dy = y - cy;
        const rr = c.r + r;
        if (dx * dx + dy * dy < rr * rr) return true;
      } else if (Math.abs(x - cx) < c.w / 2 + r && Math.abs(y - cy) < c.h / 2 + r) {
        return true;
      }
    }
    // 可破坏炮塔是伸到本体外的实体，轮廓圆只能近似它的一小截，
    // 所以按 BOSS_PARTS 的半径单独算，打掉后自然就不再有碰撞。
    // 子弹命中路径会在调用前单独处理部件（好让伤害记在炮塔上），传 false 跳过。
    if (includeParts === false) return false;
    for (const pt of bo.parts) {
      if (!pt.alive) continue;
      const dx = x - (bo.x + pt.dx);
      const dy = y - (bo.y + pt.dy);
      const rr = pt.r + r;
      if (dx * dx + dy * dy < rr * rr) return true;
    }
    return false;
  }

  _collide() {
    const p = this.player;

    // 玩家子弹 → 敌机 / BOSS
    for (const b of this.bullets) {
      if (!b.active || !b.friendly) continue;

      // 注意：invuln 必须放在外层条件里。
      // 之前写成 `if (bo.invuln) continue;`，会连下面打小怪的循环一起跳过，
      // 导致第 7 关 BOSS 退场召唤期间援军完全打不掉、BOSS 永远不回来。
      if (this.bossActive && !this.boss.dead && !this.boss.invuln) {
        const bo = this.boss;

        // 先判可破坏部件：打掉侧翼武器能实实在在削弱弹幕
        let hitPart = false;
        for (const pt of bo.parts) {
          if (!pt.alive) continue;
          const px = bo.x + pt.dx, py = bo.y + pt.dy;
          if (dist2(b.x, b.y, px, py) < (pt.r + b.r) * (pt.r + b.r)) {
            b.active = false;
            pt.hp -= b.dmg;
            pt.flash = 0.08;
            if (pt.hp <= 0) {
              pt.alive = false;
              this.onBossPartDestroyed(bo, pt);
            }
            this.addParticle(b.x, b.y, {
              vx: rand(-40, 40), vy: rand(-70, -10), life: 0.25, r: 4, color: '#ffe38a'
            });
            SFX.hit();
            hitPart = true;
            break;
          }
        }
        if (hitPart) continue;

        // 浮游炮：独立血条，打掉少一路火力
        let hitDrone = false;
        for (const d of bo.drones) {
          if (!d.alive) continue;
          const px = clamp(bo.x + Math.cos(d.ang) * d.r, 36, VIEW.w - 36);
          // 注意：不要在这里加纵向压缩。绘制、开火、退场爆炸全都用 sin*r，
          // 只有这一行曾经多乘了 0.62，导致判定比炮台实体高 40~67px，玩家打不中。
          const py = bo.y + Math.sin(d.ang) * d.r;
          if (dist2(b.x, b.y, px, py) < (13 + b.r) * (13 + b.r)) {
            b.active = false;
            d.hp -= b.dmg;
            d.flash = 0.08;
            if (d.hp <= 0) {
              d.alive = false;
              this.onDroneDestroyed(bo, d, px, py);
            }
            this.addParticle(b.x, b.y, {
              vx: rand(-40, 40), vy: rand(-70, -10), life: 0.25, r: 4, color: '#ffe38a'
            });
            SFX.hit();
            hitDrone = true;
            break;
          }
        }
        if (hitDrone) continue;

        // 本体命中也要走轮廓，否则会在贴图外的空白处"接住"子弹
        // （旧代码这里是 w×0.40 / h×0.36 的矩形，比玩家撞机的框还大）。
        // 给子弹留 2px 余量：轮廓是内切圆近似的，边缘小部件容易被漏掉。
        if (this._bossHits(bo, b.x, b.y, b.r + 2, false)) {
          // 穿透弹在 BOSS 体内会停留多帧，用 0.14s 的间隔限制重复结算
          if (b.pierce) {
            if (b.bossT > 0) continue;
            b.bossT = 0.14;
          } else {
            b.active = false;
          }
          bo.hit(b.dmg, this);
          this.addParticle(b.x, b.y, {
            vx: rand(-30, 30), vy: rand(-60, -10), life: 0.25, r: 4,
            color: '#ffffff'
          });
          SFX.hit();
          if (b.boom) this.plasmaBoom(b, null);
          if (b.fuse > 0) { b.fuse = 0; this.burstFlak(b, 5); }
          if (!b.pierce) continue;
        }
      }

      for (const e of this.enemies) {
        if (!e.active) continue;
        if (b.pierce && b.hits.indexOf(e) >= 0) continue;
        if (dist2(b.x, b.y, e.x, e.y) < (e.r + b.r) * (e.r + b.r)) {
          if (b.pierce) b.hits.push(e);
          else b.active = false;
          e.hit(b.dmg, b, this);
          this.addParticle(b.x, b.y, {
            vx: rand(-40, 40), vy: rand(-70, -10), life: 0.22, r: 3,
            color: '#ffffff'
          });
          SFX.hit();
          if (b.boom) this.plasmaBoom(b, e);
          if (b.fuse > 0) { b.fuse = 0; this.burstFlak(b, 5); }
          if (b.chain > 0) this.chainLightning(b.x, b.y, e, b.chain, Math.max(1, b.dmg - 0.5));
          if (!b.pierce) break;
        }
      }
    }

    if (!p.alive) return;

    // BOSS 蓄力激光：点到线段距离判定，接触宽度的一半即命中
    if (this.bossActive && this.boss.laserState === 2 && !this.god) {
      const b = this.boss;
      const ex = b.x + Math.cos(b.laserAng) * 1600;
      const ey = b.y + Math.sin(b.laserAng) * 1600;
      const d = this._pointSegDist(p.x, p.y, b.x, b.y, ex, ey);
      if (d < b.laserCfg.width * 0.5 + PLAYER.hitR) {
        p.hit(this);
        if (!p.alive) return;
      }
    }

    // 双栅栏：碰到垂直能量柱受伤
    if (this.bossActive && !this.god && this.boss.fenceOn > 0) {
      const fx = this.boss.fenceX;
      const halfW = 7 + PLAYER.hitR;
      if (Math.abs(p.x - fx) < halfW || Math.abs(p.x - (VIEW.w - fx)) < halfW) {
        p.hit(this);
        if (!p.alive) return;
      }
    }

    // 环绕机：先挡子弹，再撞敌机（顺序很重要——挡弹优先，否则会被同一颗弹先打死）
    if (p.orbits.length) {
      const orbR = PLAYER.orbitR2;

      for (const b of this.bullets) {
        if (!b.active || b.friendly) continue;
        // 主球优先，其次尾焰：尾焰也挡弹，但判定半径更小（见 PLAYER.orbitTrail）
        let hitO = null;
        let hitM = null;
        for (const o of p.orbits) {
          if (dist2(b.x, b.y, o.x, o.y) <= (orbR + b.r) * (orbR + b.r)) { hitO = o; break; }
          for (let i = 0; i < o.m.length; i++) {
            const m = o.m[i];
            const hr = PLAYER.orbitTrail[i].hit;
            if (dist2(b.x, b.y, m.x, m.y) <= (hr + b.r) * (hr + b.r)) { hitM = m; break; }
          }
          if (hitM) break;
        }
        if (!hitO && !hitM) continue;
        b.active = false;
        if (hitO) hitO.hitT = 0.02; else hitM.hit = 0.02;   // 谁挡的就让谁闪白
        this.addParticle(b.x, b.y, {
          vx: rand(-30, 30), vy: rand(-50, 0), life: 0.22, r: 4, color: '#ffb3e6'
        });
        SFX.hit();
      }

      // 撞小怪：不碰 BOSS，否则贴着 BOSS 站着就能白嫖输出
      for (const e of this.enemies) {
        if (!e.active) continue;
        if (e.fromBottom && e.y > VIEW.h) continue;
        for (const o of p.orbits) {
          if (o.hitT > 0) break;
          if (dist2(o.x, o.y, e.x, e.y) > (orbR + e.r) * (orbR + e.r)) continue;
          e.hit(PLAYER.orbitDmg, null, this);
          o.hitT = PLAYER.orbitHitCd;
          this.addParticle(o.x, o.y, {
            vx: rand(-50, 50), vy: rand(-70, -10), life: 0.2, r: 4, color: '#ffd0f4'
          });
          break;
        }
      }
    }

    // 敌方子弹 → 玩家
    for (const b of this.bullets) {
      if (!b.active || b.friendly) continue;
      if (dist2(b.x, b.y, p.x, p.y) < (PLAYER.hitR + b.r) * (PLAYER.hitR + b.r)) {
        b.active = false;
        if (this.god) continue;
        p.hit(this);
        if (!p.alive) return;
      }
    }

    // 敌机撞机
    for (const e of this.enemies) {
      if (!e.active) continue;
      // 从底部升起的单位在爬升阶段穿过屏幕，玩家常挡在路径上。
      // 不豁免的话 miniboss 会直接撞死自己，玩家也白掉命。
      if (e.fromBottom && e.y > 320) continue;
      if (dist2(p.x, p.y, e.x, e.y) < (PLAYER.hitR + e.r * 0.8) * (PLAYER.hitR + e.r * 0.8)) {
        e.hit(999, null, this);
        if (this.god) continue;
        p.hit(this);
        if (!p.alive) return;
      }
    }

    // BOSS 撞机：用 BOSS_HULL 的多圆轮廓，比单个矩形贴合实体形状
    if (this.bossActive && !this.boss.dead) {
      if (this._bossHits(this.boss, p.x, p.y, PLAYER.hitR) && !this.god) p.hit(this);
    }

  }

  /** 拾取判定：独立于战斗碰撞，结算期（clear）也必须能吃到掉落 */
  _collectPickups() {
    const p = this.player;
    if (!p.alive) return;
    for (const k of this.pickups) {
      if (!k.active) continue;
      if (dist2(k.x, k.y, p.x, p.y) < 32 * 32) {
        k.active = false;
        SFX.pickup();
        if (k.kind === 'P') {
          p.power = Math.min(PLAYER.maxPower, p.power + 1);
        } else if (k.kind === 'W') {
          p.addWeapon(k.weapon || 0, this);
        } else if (k.kind === 'B') {
          p.bombs = Math.min(PLAYER.maxBombs, p.bombs + 1);
        } else if (k.kind === 'O') {
          p.addOption(this);
        } else if (k.kind === 'R') {
          p.addOrbit(this);
        } else if (k.kind === 'L') {
          p.lasers = Math.min(PLAYER.maxLaserBombs, p.lasers + 1);
        } else {
          p.lives = Math.min(PLAYER.maxLives, p.lives + 1);
        }
        this.score += SCORE.pickup;
        for (let i = 0; i < 10; i++) {
          this.addParticle(k.x, k.y, {
            vx: rand(-90, 90), vy: rand(-90, 90), life: 0.4, r: 3,
            color: PICKUP_COLORS[k.kind]
          });
        }
      }
    }
  }

  /* -------------------------------------------------- 渲染 */
  draw() {
    const ctx = this.ctx;
    ctx.save();

    if (this.shakeT > 0) {
      const a = this.shakeAmp * (this.shakeT / 0.32);
      ctx.translate(rand(-a, a), rand(-a, a));
    }

    this._drawBg(ctx);

    if (this.state === 'title') {
      this._drawTitle(ctx);
      ctx.restore();
      this._drawSoundButton(ctx);   // 标题页也能提前关声音
      this._drawDevPanel(ctx);      // 标题页也能用调试面板（跳关测试）
      return;
    }

    // BOSS 战 / 结算时整体压暗，让弹幕、机体与文字分得开
    if (this.bossActive || this.state === 'clear') {
      ctx.fillStyle = this.state === 'clear' ? 'rgba(2,4,8,0.34)' : 'rgba(2,4,8,0.26)';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }

    // 拾取
    for (const k of this.pickups) if (k.active) k.draw(ctx);
    // 敌机
    for (const e of this.enemies) if (e.active) e.draw(ctx);
    // 蛇形小 BOSS（整体画成连续的一条）
    this._drawSnake(ctx);
    // BOSS
    if (this.boss.active) this.boss.draw(ctx);

    // 子弹
    for (const b of this.bullets) if (b.active) b.draw(ctx);
    // 保险投出的高爆弹（画在子弹之上，别被敌弹盖住）
    this._drawBombDrop(ctx);
    this._drawBombFx(ctx);
    // 粒子
    for (const p of this.particles) if (p.active) p.draw(ctx);
    // 阵亡残骸：一团逐渐冷却的光，填满 1.5 秒的空档
    if (this.deathDelayT > 0 && this._dyingX !== undefined) {
      const k = 1 - this.deathDelayT / PLAYER.deathDelay;      // 0 → 1
      // 0.7 秒内快速烧完：留太久会变成一颗"白色实心球"杵在那里
      const a = Math.max(0, 0.55 * (1 - k * 1.9));
      const r = 26 + k * 34;
      if (a > 0.01) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = a;
        const g = ctx.createRadialGradient(this._dyingX, this._dyingY, 0,
                                           this._dyingX, this._dyingY, r);
        g.addColorStop(0, 'rgba(235,250,255,0.95)');
        g.addColorStop(0.45, 'rgba(120,190,255,0.35)');
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(this._dyingX, this._dyingY, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }

    // 玩家
    this.player.draw(ctx);
    this._drawPlayerLaser(ctx);

    // 碰撞盒叠在最上层：要能盖住机身贴图才看得清判定
    this._drawHitboxes(ctx);

    ctx.restore();

    this._drawArcs(ctx);

    // 失败/通关页不画 HUD：分数已在中间显示，留着 HUD 会从暗底透出来显脏
    if (this.state !== 'gameover' && this.state !== 'win') {
      this._drawWarnings(ctx);
      this._drawHud(ctx);
    }
    this._drawOverlay(ctx);

    // 游戏内左下角也标版本号（标题页由 _drawTitle 负责）
    if (this.state !== 'gameover' && this.state !== 'win') {
      ctx.save();
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgba(150,190,220,0.5)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(VERSION, 12, VIEW.h - 10);
      ctx.restore();
    }

    this._drawSoundButton(ctx);
    this._drawDevPanel(ctx);

    // 保险白闪
    if (this.flashT > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (this.flashT / 0.26 * 0.42) + ')';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }
  }

  _drawBg(ctx) {
    const img = Assets.bg[this.level.bg];
    const h = 512;
    const y = this.bgScroll % h;
    if (img) {
      for (let i = -1; i * h - y < VIEW.h; i++) {
        ctx.drawImage(img, 0, i * h - y + h, VIEW.w, h);
      }
    } else {
      ctx.fillStyle = '#06090f';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    }

    // 星点
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of this.stars) {
      ctx.globalAlpha = 0.25 + s.z * 0.55;
      ctx.fillStyle = '#cfe8ff';
      ctx.fillRect(s.x, s.y, s.r, s.r * 2.2);
    }
    ctx.restore();

    // 中心提亮 + 四周压暗：不随滚动，用来压住背景平铺感
    const vg = ctx.createRadialGradient(VIEW.w / 2, VIEW.h * 0.46, 60,
                                        VIEW.w / 2, VIEW.h * 0.46, VIEW.h * 0.72);
    vg.addColorStop(0, 'rgba(120,180,230,0.07)');
    vg.addColorStop(0.55, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    // 顶部/底部氛围压暗
    const gTop = ctx.createLinearGradient(0, 0, 0, 150);
    gTop.addColorStop(0, 'rgba(3,6,10,0.85)');
    gTop.addColorStop(1, 'rgba(3,6,10,0)');
    ctx.fillStyle = gTop;
    ctx.fillRect(0, 0, VIEW.w, 150);

    const gBot = ctx.createLinearGradient(0, VIEW.h - 160, 0, VIEW.h);
    gBot.addColorStop(0, 'rgba(3,6,10,0)');
    gBot.addColorStop(1, 'rgba(3,6,10,0.9)');
    ctx.fillStyle = gBot;
    ctx.fillRect(0, VIEW.h - 160, VIEW.w, 160);
  }

  /** 电弧链特效：折线 + 白色内芯，每帧抖动 */
  _drawArcs(ctx) {
    if (!this.arcs.length) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const a of this.arcs) {
      const k = a.life / a.max;
      ctx.globalAlpha = k;
      ctx.beginPath();
      const seg = 5;
      for (let i = 0; i <= seg; i++) {
        const t = i / seg;
        const jitter = (i === 0 || i === seg) ? 0 : 13;
        const x = a.x1 + (a.x2 - a.x1) * t + (Math.random() - 0.5) * jitter;
        const y = a.y1 + (a.y2 - a.y1) * t + (Math.random() - 0.5) * jitter;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = 'rgba(125,250,255,0.9)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.restore();
  }

  /** 底部来敌警示：闪烁箭头 + 红色光柱 */
  _drawWarnings(ctx) {
    if (!this.warnings.length) return;
    const y = VIEW.h - 6;
    for (const w of this.warnings) {
      const blink = Math.sin(w.t * 18) > 0 ? 1 : 0.42;
      ctx.save();
      ctx.globalAlpha = blink * 0.85;

      const g = ctx.createLinearGradient(0, y - 110, 0, y);
      g.addColorStop(0, 'rgba(255,60,60,0)');
      g.addColorStop(1, 'rgba(255,60,60,0.42)');
      ctx.fillStyle = g;
      ctx.fillRect(w.x - 13, y - 110, 26, 110);

      ctx.fillStyle = '#ff4d4d';
      ctx.beginPath();
      ctx.moveTo(w.x, y - 34);
      ctx.lineTo(w.x - 12, y - 12);
      ctx.lineTo(w.x + 12, y - 12);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }
  }

  _drawHud(ctx) {
    ctx.save();

    // HUD 底板画在实体之后：敌机从顶部落下时钻到 UI 后面，不会糊住分数
    const hudBg = ctx.createLinearGradient(0, 0, 0, 96);
    hudBg.addColorStop(0, 'rgba(4,8,14,0.94)');
    hudBg.addColorStop(0.70, 'rgba(4,8,14,0.62)');
    hudBg.addColorStop(1, 'rgba(4,8,14,0)');
    ctx.fillStyle = hudBg;
    ctx.fillRect(0, 0, VIEW.w, 96);

    ctx.textBaseline = 'top';

    // 分数
    ctx.font = '600 20px ui-monospace, Menlo, monospace';
    ctx.fillStyle = '#cfe8ff';
    ctx.textAlign = 'left';
    ctx.fillText(String(this.score).padStart(7, '0'), 18, 20);

    ctx.font = '11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(140,180,210,0.75)';
    ctx.fillText(this.level.sub, 18, 44);

    // 生命（小飞机图标；上限 10 个会占满整行，超过 6 个就收尾成 ×N）
    ctx.textAlign = 'right';
    const shownLives = Math.min(this.player.lives, 6);
    for (let i = 0; i < shownLives; i++) {
      const x = VIEW.w - 24 - i * 26;
      ctx.save();
      ctx.translate(x, 28);
      ctx.scale(0.30, 0.30);
      Assets.draw(ctx, 'player', 0, 0, 1, 1);
      ctx.restore();
    }
    if (this.player.lives > shownLives) {
      ctx.fillStyle = 'rgba(165,215,245,0.9)';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText('×' + this.player.lives, VIEW.w - 24 - shownLives * 26 + 8, 33);
    }

    this._drawWeaponSlots(ctx, 18, 62);

    // BOSS 血条
    if (this.bossActive && !this.boss.dead && !this.boss.enter && !this.boss.invuln) {
      const b = this.boss;
      const w = VIEW.w - 96;
      const x = 48;
      const y = 92;
      const pct = Math.max(0, b.hp / b.maxHp);
      ctx.fillStyle = 'rgba(6,10,16,0.7)';
      ctx.fillRect(x - 2, y - 2, w + 4, 12);
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(x, y, w, 8);
      ctx.fillStyle = pct < 0.3 ? '#ff3d3d' : this.level.accent;
      ctx.fillRect(x, y, w * pct, 8);
      ctx.fillStyle = 'rgba(255,255,255,0.28)';
      ctx.fillRect(x, y, w * pct, 3);
      ctx.strokeStyle = 'rgba(160,220,255,0.35)';
      ctx.lineWidth = 1;
      ctx.strokeRect(x - 2, y - 2, w + 4, 12);

      ctx.textAlign = 'center';
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillStyle = 'rgba(200,230,255,0.85)';
      ctx.fillText(b.name, VIEW.w / 2, y + 16);
    }
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    this._drawBombButton(ctx);
    this._drawLaserButton(ctx);
  }

  /** 武器槽：3 个胶囊，已有武器上色，空槽虚线 */
  _drawWeaponSlots(ctx, x, y) {
    const w = 74;
    const h = 18;
    const gap = 5;
    ctx.save();
    ctx.textBaseline = 'middle';
    for (let i = 0; i < WEAPON_SLOTS; i++) {
      const bx = x + i * (w + gap);
      const idx = this.player.weapons[i];
      const has = idx !== undefined;
      const col = has ? WEAPONS[idx].color : 'rgba(120,150,180,0.30)';

      ctx.fillStyle = has ? 'rgba(8,20,30,0.80)' : 'rgba(8,16,24,0.42)';
      ctx.fillRect(bx, y, w, h);
      ctx.strokeStyle = col;
      ctx.lineWidth = i === 0 && has ? 1.6 : 1;
      if (has) {
        ctx.strokeRect(bx + 0.5, y + 0.5, w - 1, h - 1);
      } else {
        // 空槽用点线，一眼看出还能再装
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(bx + 0.5, y + 0.5, w - 1, h - 1);
        ctx.setLineDash([]);
      }

      ctx.fillStyle = col;
      ctx.font = '8px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(has ? WEAPONS[idx].name : '+', bx + w / 2, y + h / 2 + 0.5);
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(150,205,235,0.82)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('LV' + this.player.power, x + WEAPON_SLOTS * (w + gap) + 2, y + h / 2 + 0.5);
    ctx.restore();
    ctx.textAlign = 'left';   // textBaseline 由 restore 还原，别在这里改
  }

  /** 冷却进度环：从 12 点顺时针缩短，环消失 = 可以再按。
   *  不做整体遮罩，因为按钮中央还要显示剩余数量，盖住反而看不清剩几颗。 */
  _drawCdRing(ctx, x, y, r, t, max, color) {
    if (t <= 0 || max <= 0) return;
    const k = clamp(t / max, 0, 1);                 // 1 → 0
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();
  }

  _drawBombButton(ctx) {
    const { x, y, r } = BOMB_BTN;
    const n = this.player.bombs;
    const on = n > 0;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? 'rgba(16,44,32,0.85)' : 'rgba(26,30,38,0.7)';
    ctx.fill();
    ctx.strokeStyle = on ? '#7dff9e' : 'rgba(120,140,160,0.35)';
    ctx.lineWidth = 2;
    ctx.stroke();

    if (on) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
      g.addColorStop(0, 'rgba(125,255,158,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 冷却进度环：连点被吃掉时，玩家要能看出"是按不动"而不是"按键失灵"
    this._drawCdRing(ctx, x, y, r, this.bombCdT, PLAYER.bombCd, '#7dff9e');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? '#b7ffcd' : 'rgba(150,170,190,0.45)';
    ctx.font = '700 17px ui-monospace, monospace';
    ctx.fillText(String(n), x, y - 3);
    ctx.font = '7px ui-monospace, monospace';
    ctx.fillText('X·BOMB', x, y + 10);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawLaserButton(ctx) {
    const { x, y, r } = LASER_BTN;
    const n = this.player.lasers;
    const on = n > 0;
    const firing = this.laserBeam && this.laserBeam.state > 0;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = on ? (firing ? 'rgba(58,32,86,0.92)' : 'rgba(34,22,54,0.85)')
                       : 'rgba(26,30,38,0.7)';
    ctx.fill();
    ctx.strokeStyle = firing ? '#e8d8ff' : (on ? '#b48cff' : 'rgba(120,140,160,0.35)');
    ctx.lineWidth = firing ? 3 : 2;
    ctx.stroke();

    if (on) {
      ctx.globalCompositeOperation = 'lighter';
      const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2);
      g.addColorStop(0, 'rgba(180,140,255,0.24)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r * 2, y - r * 2, r * 4, r * 4);
      ctx.globalCompositeOperation = 'source-over';
    }

    // 激光冷却从按下算（含 6.8s 的蓄力+发射），环走完之前按了也不会生效
    this._drawCdRing(ctx, x, y, r, this.laserCdT, PLAYER.laserCd, '#b48cff');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = on ? '#ddd0ff' : 'rgba(150,170,190,0.45)';
    ctx.font = '700 17px ui-monospace, monospace';
    ctx.fillText(String(n), x, y - 3);
    ctx.font = '7px ui-monospace, monospace';
    ctx.fillText('C·LASER', x, y + 10);
    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawSoundButton(ctx) {
    const { x, y, r } = SOUND_BTN;
    const on = this.soundOn;

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(20,26,36,0.72)';
    ctx.fill();
    ctx.strokeStyle = on ? 'rgba(140,200,255,0.5)' : 'rgba(120,140,160,0.30)';
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // 喇叭主体
    ctx.fillStyle = on ? 'rgba(190,225,255,0.92)' : 'rgba(140,160,180,0.45)';
    ctx.beginPath();
    ctx.moveTo(x - 7, y - 3);
    ctx.lineTo(x - 3, y - 3);
    ctx.lineTo(x + 2, y - 8);
    ctx.lineTo(x + 2, y + 8);
    ctx.lineTo(x - 3, y + 3);
    ctx.lineTo(x - 7, y + 3);
    ctx.closePath();
    ctx.fill();

    if (on) {
      // 两道声波弧
      ctx.strokeStyle = 'rgba(190,225,255,0.85)';
      ctx.lineWidth = 1.5;
      for (const rr of [5, 9]) {
        ctx.beginPath();
        ctx.arc(x + 2, y, rr, -0.78, 0.78);
        ctx.stroke();
      }
    } else {
      // 关闭：一道斜杠划掉喇叭
      ctx.strokeStyle = 'rgba(255,110,130,0.92)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, y + 8);
      ctx.lineTo(x + 8, y - 8);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawGameOver(ctx, cx) {
    const canCont = this.contT > 0;
    const fade = clamp(this.deadT / 0.35, 0, 1);
    const t = this.totalT || 0;

    ctx.save();
    // 底色要够实：BOSS 战阵亡时残骸还在场上，太透会和标题叠在一起
    ctx.fillStyle = 'rgba(4,7,12,0.90)';
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.globalAlpha = fade;
    ctx.textAlign = 'center';

    ctx.fillStyle = '#ff5d5d';
    ctx.font = '700 38px ui-monospace, monospace';
    ctx.lineWidth = 5;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText('GAME OVER', cx, VIEW.h * 0.315);
    ctx.fillText('GAME OVER', cx, VIEW.h * 0.315);

    ctx.fillStyle = '#eaf6ff';
    ctx.font = '17px ui-monospace, monospace';
    ctx.fillText('SCORE  ' + this.score, cx, VIEW.h * 0.315 + 36);

    ctx.fillStyle = 'rgba(130,172,205,0.62)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.fillText('阵亡于  ' + this.level.sub, cx, VIEW.h * 0.315 + 58);

    if (this.deathBoss) {
      ctx.fillStyle = 'rgba(255,180,120,0.82)';
      ctx.font = '11px "PingFang SC", sans-serif';
      ctx.fillText('BOSS 战阵亡 · 续关保留 BOSS 血量', cx, VIEW.h * 0.315 + 80);
    }

    if (canCont) {
      const cy2 = VIEW.h * 0.545;
      const r = 44;
      const pct = clamp(this.contT / CONTINUE.window, 0, 1);
      const urgent = this.contT < 3;

      // CONTINUE? 标签
      ctx.fillStyle = urgent ? '#ff8a8a' : '#8fd8ff';
      ctx.font = '600 13px ui-monospace, monospace';
      ctx.fillText('C O N T I N U E ?', cx, cy2 - r - 16);

      // 底环
      ctx.strokeStyle = 'rgba(120,200,255,0.16)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(cx, cy2, r, 0, Math.PI * 2);
      ctx.stroke();

      // 进度环：剩余时间越少颜色越红
      ctx.strokeStyle = urgent ? '#ff6b6b' : '#7fe0ff';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy2, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct);
      ctx.stroke();
      ctx.lineCap = 'butt';

      // 倒计时数字（最后 3 秒呼吸放大）
      const pulse = urgent ? 1 + Math.sin(t * 12) * 0.08 : 1;
      ctx.save();
      ctx.translate(cx, cy2 + 2);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = urgent ? '#ffd0d0' : '#ffffff';
      ctx.font = '700 40px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.max(1, Math.ceil(this.contT))), 0, 0);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';

      // 剩余次数：实心圆点
      const n = CONTINUE.max;
      const gap = 22;
      const bx = cx - ((n - 1) * gap) / 2;
      for (let i = 0; i < n; i++) {
        const on = i < this.continues;
        ctx.beginPath();
        ctx.arc(bx + i * gap, cy2 + r + 24, 5, 0, Math.PI * 2);
        ctx.fillStyle = on ? '#7dffb0' : 'rgba(120,150,180,0.28)';
        ctx.fill();
      }

      ctx.fillStyle = 'rgba(160,205,235,0.8)';
      ctx.font = '11px "PingFang SC", sans-serif';
      ctx.fillText('剩余续关 ' + this.continues + ' 次', cx, cy2 + r + 48);

      ctx.fillStyle = 'rgba(150,190,220,0.6)';
      ctx.font = '11px "PingFang SC", sans-serif';
      ctx.fillText(this.deathBoss ? '保留火力 · 补满保险 · BOSS 血量不重置'
        : '保留火力 · 补满保险 · 关卡进度保留', cx, cy2 + r + 78);

      if (Math.floor(t * 1.8) % 2 === 0) {
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 15px "PingFang SC", sans-serif';
        ctx.fillText('点击屏幕 / 空格 续关', cx, cy2 + r + 124);
      }
      ctx.fillStyle = 'rgba(130,165,195,0.5)';
      ctx.font = '10px "PingFang SC", sans-serif';
      ctx.fillText('倒计时结束则本局结束', cx, cy2 + r + 150);
    } else {
      ctx.fillStyle = 'rgba(255,170,120,0.9)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText(this.continues > 0 ? '续关机会已错过' : '续关机会已用尽',
        cx, VIEW.h * 0.475);

      // 开始按钮：比闪烁文字更容易一眼看到
      const bw = 236;
      const bh = 50;
      const bx0 = cx - bw / 2;
      const by0 = VIEW.h * 0.545;
      const glow = 0.45 + Math.sin(t * 3) * 0.22;

      ctx.fillStyle = 'rgba(30,96,140,0.20)';
      ctx.fillRect(bx0, by0, bw, bh);
      ctx.strokeStyle = 'rgba(127,224,255,' + glow + ')';
      ctx.lineWidth = 1.6;
      ctx.strokeRect(bx0 + 0.5, by0 + 0.5, bw - 1, bh - 1);

      ctx.fillStyle = '#dff3ff';
      ctx.font = '600 16px "PingFang SC", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('重新开始', cx, by0 + bh / 2 + 1);
      ctx.textBaseline = 'alphabetic';

      ctx.fillStyle = 'rgba(140,175,205,0.6)';
      ctx.font = '10px "PingFang SC", sans-serif';
      ctx.fillText('点击屏幕 / 按空格', cx, by0 + bh + 22);
    }

    ctx.restore();
    ctx.textAlign = 'left';
  }

  /* ------------------------------------------------ 激光保险绘制 */

  _drawPlayerLaser(ctx) {
    const L = this.laserBeam;
    if (!L || L.state === 0) return;
    const p = this.player;
    if (!p.alive) return;

    const x = p.x;
    const y0 = p.y - 26;              // 从机头稍上方发出
    const halfW = PLAYER.laserWidth / 2;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    if (L.state === 1) {
      // 蓄力：一条越来越实的细线 + 炮口聚能光点
      const k = Math.min(1, L.t / PLAYER.laserCharge);
      ctx.globalAlpha = 0.30 + 0.45 * Math.abs(Math.sin(L.t * 26));
      ctx.strokeStyle = '#c8a6ff';
      ctx.lineWidth = 1 + k * 5;
      ctx.beginPath();
      ctx.moveTo(x, y0);
      ctx.lineTo(x, 0);
      ctx.stroke();

      ctx.globalAlpha = 0.55 + 0.35 * k;
      const g = ctx.createRadialGradient(x, y0, 0, x, y0, 8 + k * 12);
      g.addColorStop(0, 'rgba(240,225,255,0.95)');
      g.addColorStop(1, 'rgba(160,110,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y0, 8 + k * 12, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // 发射：外辉 + 白芯 + 流动能量段
      const fade = L.t > PLAYER.laserFire - 0.4
        ? Math.max(0, (PLAYER.laserFire - L.t) / 0.4)
        : 1;

      ctx.globalAlpha = 0.60 * fade;
      const g = ctx.createLinearGradient(x - halfW, 0, x + halfW, 0);
      g.addColorStop(0, 'rgba(150,100,255,0)');
      g.addColorStop(0.5, 'rgba(205,170,255,0.95)');
      g.addColorStop(1, 'rgba(150,100,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - halfW, 0, halfW * 2, y0);

      ctx.globalAlpha = 0.85 * fade;
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.fillRect(x - halfW * 0.26, 0, halfW * 0.52, y0);

      ctx.globalAlpha = 0.42 * fade;
      ctx.strokeStyle = '#e8d8ff';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i++) {
        const yy = ((L.t * 340 + i * 96) % (y0 + 90)) - 45;
        ctx.beginPath();
        ctx.moveTo(x - halfW * 0.78, yy);
        ctx.lineTo(x + halfW * 0.78, yy + 26);
        ctx.stroke();
      }

      // 炮口爆闪
      ctx.globalAlpha = 0.8 * fade;
      const g2 = ctx.createRadialGradient(x, y0, 0, x, y0, 26);
      g2.addColorStop(0, 'rgba(255,255,255,0.9)');
      g2.addColorStop(1, 'rgba(180,140,255,0)');
      ctx.fillStyle = g2;
      ctx.beginPath();
      ctx.arc(x, y0, 26, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  /* ------------------------------------------------ 碰撞盒可视化（调试） */

  /** 只画“真正参与判定”的形状，不画贴图轮廓：
   *  玩家 hitR(9) / 敌机 e.r / 敌弹 b.r / 道具 32 / BOSS 本体矩形 / 部件 / 浮游炮。
   *  每个形状都对应 `_collide()` 与 `_collectPickups()` 里的一条判定，
   *  改判定时必须同步改这里，否则这个调试开关就没有意义了。
   */
  _drawHitboxes(ctx) {
    if (!DEBUG || !this.showHitbox) return;
    const p = this.player;

    ctx.save();

    // 统一"先黑底后亮线"：BOSS 和敌机本身就很亮，单画一圈细线几乎看不见。
    // 双 pass 只在调试模式下跑，量级是每帧几百次 stroke，可忽略。
    const ring = (x, y, r, color, lw) => {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = lw + 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.stroke();
    };

    // 道具拾取范围（半径固定 32）
    for (const k of this.pickups) {
      if (!k.active) continue;
      ring(k.x, k.y, 32, 'rgba(125,255,158,0.95)', 1);
    }

    // 敌机
    for (const e of this.enemies) {
      if (!e.active) continue;
      ring(e.x, e.y, e.r, 'rgba(255,209,102,0.95)', 1);
    }

    // BOSS：本体是多圆轮廓（BOSS_HULL），部件与浮游炮也是圆
    const bo = this.boss;
    if (bo.active && !bo.dead) {
      const hull = this._bossHull(bo);
      if (hull) {
        for (const c of hull) {
          if (c.r !== undefined) {
            ring(bo.x + c.dx, bo.y + c.dy, c.r, 'rgba(214,177,255,1)', 1.3);
          } else {
            ctx.strokeStyle = 'rgba(214,177,255,1)';
            ctx.lineWidth = 1.3;
            ctx.strokeRect(bo.x + c.dx - c.w / 2, bo.y + c.dy - c.h / 2, c.w, c.h);
          }
        }
      } else {
        ctx.strokeStyle = 'rgba(214,177,255,1)';
        ctx.lineWidth = 1.3;
        const hw = bo.w * 0.36, hh = bo.h * 0.32;
        ctx.strokeRect(bo.x - hw, bo.y - hh, hw * 2, hh * 2);
      }

      for (const pt of bo.parts) {
        if (!pt.alive) continue;
        ring(bo.x + pt.dx, bo.y + pt.dy, pt.r, 'rgba(214,177,255,1)', 1.3);
      }

      // 浮游炮：判定半径固定 13
      for (const d of bo.drones) {
        if (!d.alive) continue;
        const px = clamp(bo.x + Math.cos(d.ang) * d.r, 36, VIEW.w - 36);
        const py = bo.y + Math.sin(d.ang) * d.r;
        ring(px, py, 13, 'rgba(125,250,255,1)', 1.2);
      }
    }

    // 敌方子弹（我方子弹不画：数量太大且判定半径就是贴图半径，没有调试价值）
    for (const b of this.bullets) {
      if (!b.active || b.friendly) continue;
      ring(b.x, b.y, b.r, 'rgba(255,110,110,0.9)', 1);
    }

    // 环绕机 + 尾焰的挡弹判定：尾焰半径比主球小，调试时必须画出来才对得上
    if (p.alive) {
      for (const o of p.orbits) {
        ring(o.x, o.y, PLAYER.orbitR2, 'rgba(255,140,220,0.95)', 1.2);
        for (let i = 0; i < o.m.length; i++) {
          ring(o.m[i].x, o.m[i].y, PLAYER.orbitTrail[i].hit, 'rgba(255,179,230,0.8)', 1);
        }
      }
    }

    // 玩家判定：全屏最关键的一个点，加粗 + 中心十字
    if (p.alive) {
      ring(p.x, p.y, PLAYER.hitR, 'rgba(255,77,109,1)', 1.8);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p.x - 3.5, p.y);
      ctx.lineTo(p.x + 3.5, p.y);
      ctx.moveTo(p.x, p.y - 3.5);
      ctx.lineTo(p.x, p.y + 3.5);
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ------------------------------------------------ 调试面板绘制 */

  _drawDevPanel(ctx) {
    if (!DEBUG) return;

    const P = DEV_PANEL;
    const T = P.toggle;
    const on = this.devOpen;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 把手
    ctx.fillStyle = on ? 'rgba(18,42,58,0.92)' : 'rgba(10,16,24,0.72)';
    ctx.fillRect(T.x, T.y, T.w, T.h);
    ctx.strokeStyle = on ? 'rgba(127,224,255,0.85)' : 'rgba(120,152,180,0.42)';
    ctx.lineWidth = 1;
    ctx.strokeRect(T.x + 0.5, T.y + 0.5, T.w - 1, T.h - 1);
    ctx.fillStyle = on ? '#c4f2ff' : 'rgba(150,185,210,0.72)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText(on ? 'DEV  ▾' : 'DEV  ▴', T.x + T.w / 2, T.y + T.h / 2 + 0.5);

    if (on) {
      for (const b of this._devButtons) {
        const active = (b.id === 'god' && this.god) ||
                       (b.id === 'infbomb' && this.infiniteBombs) ||
                       (b.id === 'hitbox' && this.showHitbox);
        ctx.fillStyle = active ? 'rgba(20,58,40,0.94)' : 'rgba(10,17,25,0.90)';
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.strokeStyle = active ? 'rgba(125,255,158,0.9)' : 'rgba(118,158,190,0.42)';
        ctx.strokeRect(b.x + 0.5, b.y + 0.5, b.w - 1, b.h - 1);
        ctx.fillStyle = active ? '#b7ffcd' : 'rgba(205,228,248,0.88)';
        ctx.font = '10px "PingFang SC", sans-serif';
        ctx.fillText(b.label, b.x + b.w / 2, b.y + b.h / 2 + 0.5);
      }

      // 运行状态摘要
      const line = 'FPS ' + this.fps + ' · ' + this.state +
        ' · 敌 ' + this.enemies.filter(e => e.active).length +
        ' · 弹 ' + this.bullets.filter(b => b.active).length;
      const sy = Math.min.apply(null, this._devButtons.map(b => b.y)) - 12;
      ctx.textAlign = 'left';
      ctx.font = '9px ui-monospace, monospace';
      const lw = ctx.measureText(line).width;
      ctx.fillStyle = 'rgba(4,9,14,0.72)';
      ctx.fillRect(P.baseX, sy - 7, lw + 8, 13);
      ctx.fillStyle = 'rgba(150,190,220,0.9)';
      ctx.fillText(line, P.baseX + 4, sy);

      // 崩溃信息
      if (this.lastError) {
        const txt = this.lastError.length > 46
          ? this.lastError.slice(0, 46) + '…'
          : this.lastError;
        const eline = 'ERR×' + this.crashCount + ' ' + txt;
        const ey = sy - 14;
        ctx.font = '9px ui-monospace, monospace';
        const ew = ctx.measureText(eline).width;
        ctx.fillStyle = 'rgba(40,6,6,0.82)';
        ctx.fillRect(P.baseX, ey - 7, ew + 8, 13);
        ctx.fillStyle = 'rgba(255,130,130,0.95)';
        ctx.fillText(eline, P.baseX + 4, ey);
      }
    }

    // 操作反馈
    if (this.devToastT > 0) {
      const a = Math.min(1, this.devToastT / 0.4);
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#b7ffcd';
      ctx.font = '600 12px "PingFang SC", sans-serif';
      ctx.fillText(this.devToastText, VIEW.w / 2, VIEW.h * 0.60);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }

  _drawOverlay(ctx) {
    const cx = VIEW.w / 2;

    if (this.state === 'intro') {
      const t = 1 - this.bannerT / 2.4;
      const a = t < 0.15 ? t / 0.15 : t > 0.8 ? (1 - t) / 0.2 : 1;
      ctx.save();
      ctx.globalAlpha = clamp(a, 0, 1);
      ctx.textAlign = 'center';
      ctx.fillStyle = this.level.accent;
      ctx.font = '700 40px ui-monospace, monospace';
      ctx.fillText('STAGE ' + this.level.id, cx, VIEW.h * 0.40);
      ctx.fillStyle = '#eaf6ff';
      ctx.font = '600 26px "PingFang SC", sans-serif';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(this.level.name, cx, VIEW.h * 0.40 + 44);
      ctx.fillText(this.level.name, cx, VIEW.h * 0.40 + 44);
      ctx.fillStyle = 'rgba(160,200,230,0.8)';
      ctx.font = '12px ui-monospace, monospace';
      ctx.fillText(this.level.sub, cx, VIEW.h * 0.40 + 80);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.state === 'warn') {
      const blink = Math.floor(this.warnT * 8) % 2 === 0;
      ctx.save();
      ctx.textAlign = 'center';
      if (blink) {
        ctx.fillStyle = 'rgba(255,70,70,0.92)';
        ctx.font = '700 34px ui-monospace, monospace';
        ctx.fillText('WARNING', cx, VIEW.h * 0.44);
      }
      ctx.fillStyle = 'rgba(255,180,180,0.9)';
      ctx.font = '14px ui-monospace, monospace';
      ctx.fillText(this.level.bossName + ' 接近中', cx, VIEW.h * 0.44 + 40);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.state === 'clear') {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = this.level.accent;
      ctx.font = '700 34px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText('STAGE CLEAR', cx, VIEW.h * 0.42);
      ctx.fillText('STAGE CLEAR', cx, VIEW.h * 0.42);
      ctx.fillStyle = '#eaf6ff';
      ctx.font = '16px ui-monospace, monospace';
      ctx.lineWidth = 4;
      ctx.strokeText('+' + SCORE.bossKill + ' BONUS', cx, VIEW.h * 0.42 + 36);
      ctx.fillText('+' + SCORE.bossKill + ' BONUS', cx, VIEW.h * 0.42 + 36);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.state === 'gameover') {
      this._drawGameOver(ctx, cx);
    }

    if (this.state === 'win') {
      ctx.save();
      ctx.fillStyle = 'rgba(4,7,12,0.78)';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.font = '700 34px ui-monospace, monospace';
      ctx.fillText('ALL CLEAR', cx, VIEW.h * 0.38);
      ctx.fillStyle = '#eaf6ff';
      ctx.font = '18px ui-monospace, monospace';
      ctx.fillText('SCORE  ' + this.score, cx, VIEW.h * 0.38 + 44);
      // 通关页前 2 秒锁输入：提示文字同步换成"请稍候"，否则玩家会以为点击失效
      if (this.winT >= WIN_INPUT_LOCK) {
        const a = Math.min(1, (this.winT - WIN_INPUT_LOCK) / 0.4);
        ctx.globalAlpha = a;
        ctx.fillStyle = 'rgba(150,200,230,0.75)';
        ctx.font = '13px "PingFang SC", sans-serif';
        ctx.fillText('点击 / 空格 再来一轮', cx, VIEW.h * 0.38 + 92);
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = 'rgba(120,150,175,0.5)';
        ctx.font = '13px "PingFang SC", sans-serif';
        ctx.fillText('请稍候…', cx, VIEW.h * 0.38 + 92);
      }

      // 通关致谢：原来贴在 0.80H，下方空出一大片、像掉在页面底部；
      // 现在 0.62H + 18px，和 SCORE 同级、和上面的操作提示留一段呼吸
      ctx.fillStyle = 'rgba(200,228,248,0.78)';
      ctx.font = '18px "PingFang SC", sans-serif';
      ctx.fillText('感谢你游玩本游戏', cx, VIEW.h * 0.62);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.summonT > 0) {
      const a = Math.min(1, this.summonT / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.font = '700 24px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText('REINFORCEMENTS', cx, VIEW.h * 0.35);
      ctx.fillText('REINFORCEMENTS', cx, VIEW.h * 0.35);
      ctx.fillStyle = 'rgba(255,240,200,0.95)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText('援军来袭', cx, VIEW.h * 0.35 + 24);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.bigToastT > 0) {
      const a = Math.min(1, this.bigToastT / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.bigToastColor;
      ctx.font = '700 22px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText(this.bigToastTitle, cx, VIEW.h * 0.30);
      ctx.fillText(this.bigToastTitle, cx, VIEW.h * 0.30);
      ctx.fillStyle = 'rgba(235,255,215,0.95)';
      ctx.font = '12px "PingFang SC", sans-serif';
      ctx.fillText(this.bigToastSub, cx, VIEW.h * 0.30 + 22);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.rearmToastT > 0) {
      const a = Math.min(1, this.rearmToastT / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffd166';
      ctx.font = '700 22px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('REARM', cx, VIEW.h * 0.33);
      ctx.fillText('REARM', cx, VIEW.h * 0.33);
      ctx.fillStyle = 'rgba(255,240,200,0.95)';
      ctx.font = '12px "PingFang SC", sans-serif';
      ctx.fillText('浮游炮重启', cx, VIEW.h * 0.33 + 22);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.splitToastT > 0) {
      const a = Math.min(1, this.splitToastT / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#b2ff60';
      ctx.font = '700 26px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('MITOSIS', cx, VIEW.h * 0.33);
      ctx.fillText('MITOSIS', cx, VIEW.h * 0.33);
      ctx.fillStyle = 'rgba(230,255,210,0.95)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText('本体分裂 · 消灭两个分身', cx, VIEW.h * 0.33 + 24);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.mirrorToastT > 0) {
      const a = Math.min(1, this.mirrorToastT / 0.5);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffb3e6';
      ctx.font = '700 22px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('MIRROR', cx, VIEW.h * 0.33);
      ctx.fillText('MIRROR', cx, VIEW.h * 0.33);
      ctx.fillStyle = 'rgba(255,225,245,0.95)';
      ctx.font = '12px "PingFang SC", sans-serif';
      ctx.fillText('它复制了你的武器', cx, VIEW.h * 0.33 + 22);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.optToastT > 0) {
      const a = Math.min(1, this.optToastT / 0.45);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.optFull ? '#ffc857' : '#a8f4ff';
      ctx.font = '700 24px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      const title = this.optFull ? 'OPTION MAX' : 'OPTION';
      ctx.strokeText(title, cx, VIEW.h * 0.32);
      ctx.fillText(title, cx, VIEW.h * 0.32);
      ctx.fillStyle = 'rgba(220,250,255,0.95)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText(this.optFull
        ? '僚机已满 · +800 分 + 无敌 ' + PLAYER.optionInvuln.toFixed(1) + 's'
        : '僚机 ' + this.player.options.length + ' / ' + PLAYER.maxOptions,
        cx, VIEW.h * 0.32 + 24);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.orbitToastT > 0) {
      const a = Math.min(1, this.orbitToastT / 0.45);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.orbitBoostHint ? '#ffd0f4' : '#ff8ce0';
      ctx.font = '700 24px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      const title = this.orbitBoostHint ? 'ORBIT OVERDRIVE' : 'ORBIT';
      ctx.strokeText(title, cx, VIEW.h * 0.365);
      ctx.fillText(title, cx, VIEW.h * 0.365);
      ctx.fillStyle = 'rgba(255,230,250,0.95)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText(this.orbitBoostHint
        ? '环绕机已满 · 转速强化 ' + PLAYER.orbitBoostT + 's · +600 分'
        : '环绕机 ' + this.player.orbits.length + ' / ' + PLAYER.maxOrbits,
        cx, VIEW.h * 0.365 + 24);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.contToastT > 0) {
      const a = Math.min(1, this.contToastT / 0.55);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#7dffb0';
      ctx.font = '700 28px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.72)';
      ctx.strokeText('CONTINUE', cx, VIEW.h * 0.30);
      ctx.fillText('CONTINUE', cx, VIEW.h * 0.30);
      ctx.fillStyle = 'rgba(210,255,230,0.95)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText('剩余续关 ' + this.continues + ' 次', cx, VIEW.h * 0.30 + 26);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.overT > 0) {
      const a = Math.min(1, this.overT / 0.45);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe38a';
      ctx.font = '700 26px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText('OVERDRIVE', cx, VIEW.h * 0.36);
      ctx.fillText('OVERDRIVE', cx, VIEW.h * 0.36);
      ctx.fillStyle = 'rgba(255,240,200,0.95)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText('全弹发射' + (this.overName ? ' · ' + this.overName : ''), cx, VIEW.h * 0.36 + 26);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.wpnToastT > 0) {
      const a = Math.min(1, this.wpnToastT / 0.45);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.textAlign = 'center';
      ctx.fillStyle = this.wpnColor || '#7fe0ff';
      ctx.font = '700 24px ui-monospace, monospace';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(this.wpnTitle || '', cx, VIEW.h * 0.29);
      ctx.fillText(this.wpnTitle || '', cx, VIEW.h * 0.29);
      ctx.fillStyle = 'rgba(225,242,255,0.92)';
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillText(this.wpnSub || '', cx, VIEW.h * 0.29 + 26);
      ctx.restore();
      ctx.textAlign = 'left';
    }

    if (this.paused) {
      ctx.save();
      ctx.fillStyle = 'rgba(4,7,12,0.65)';
      ctx.fillRect(0, 0, VIEW.w, VIEW.h);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#cfe8ff';
      ctx.font = '700 28px ui-monospace, monospace';
      ctx.fillText('PAUSED', cx, VIEW.h * 0.46);
      ctx.font = '13px "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(150,200,230,0.75)';
      ctx.fillText('按 ESC / P 继续', cx, VIEW.h * 0.46 + 36);
      ctx.restore();
      ctx.textAlign = 'left';
    }
  }

  _drawTitle(ctx) {
    const cx = VIEW.w / 2;
    const t = this.totalT;

    ctx.save();
    // 标题光晕
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(cx, VIEW.h * 0.27, 0, cx, VIEW.h * 0.27, 250);
    g.addColorStop(0, 'rgba(70,190,255,0.20)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);
    ctx.restore();

    // 主角机
    const shipY = VIEW.h * 0.255 + Math.sin(t * 1.6) * 7;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const fg = ctx.createLinearGradient(cx, shipY + 30, cx, shipY + 86);
    fg.addColorStop(0, 'rgba(160,240,255,0.7)');
    fg.addColorStop(1, 'rgba(40,120,255,0)');
    ctx.fillStyle = fg;
    ctx.beginPath();
    ctx.moveTo(cx - 8, shipY + 28);
    ctx.lineTo(cx + 8, shipY + 28);
    ctx.lineTo(cx, shipY + 84);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    Assets.draw(ctx, 'player', cx, shipY, 1.45);

    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#eaf8ff';
    ctx.font = '700 42px "PingFang SC", sans-serif';
    ctx.fillText('腕上雷电', cx, VIEW.h * 0.405);
    ctx.fillStyle = 'rgba(120,210,255,0.85)';
    ctx.font = '600 14px ui-monospace, monospace';
    ctx.fillText('R A I D E N   L I T E', cx, VIEW.h * 0.405 + 28);

    // 分隔线
    ctx.strokeStyle = 'rgba(110,200,255,0.32)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - 90, VIEW.h * 0.475);
    ctx.lineTo(cx + 90, VIEW.h * 0.475);
    ctx.stroke();

    const blink = Math.floor(t * 1.6) % 2 === 0;
    if (blink) {
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 16px "PingFang SC", sans-serif';
      ctx.fillText('点击屏幕 / 按空格 出击', cx, VIEW.h * 0.522);
    }

    ctx.fillStyle = 'rgba(130,175,205,0.68)';
    ctx.font = '11px "PingFang SC", sans-serif';
    ctx.fillText('方向键 / WASD 移动　·　自动开火　·　拖拽更跟手', cx, VIEW.h * 0.572);

    /* ---------- 道具说明 ---------- */
    const items = [
      { k: 'P', label: '火力 +1', color: '#66e0ff' },
      { k: 'W', label: '换武器', color: '#ffc857' },
      { k: 'O', label: '僚机 +1', color: '#a8f4ff' },
      { k: 'R', label: '环绕机+1', color: '#ff8ce0' },
      { k: 'L', label: '激光雷+1', color: '#b48cff' },
      { k: 'B', label: '保险 +1', color: '#7dff9e' },
      { k: 'H', label: '生命 +1', color: '#ff7a8a' }
    ];
    const gap = 62;
    const y0 = VIEW.h * 0.712;

    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(140,180,210,0.55)';
    ctx.fillText('击 破 敌 机 掉 落', cx, y0 - 40);

    items.forEach((it, i) => {
      const x = cx + (i - (items.length - 1) / 2) * gap;

      // 外发光
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const gg = ctx.createRadialGradient(x, y0, 0, x, y0, 30);
      gg.addColorStop(0, it.color);
      gg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.arc(x, y0, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // 圆底 + 描边
      ctx.fillStyle = 'rgba(8,14,22,0.92)';
      ctx.beginPath();
      ctx.arc(x, y0, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = it.color;
      ctx.lineWidth = 2;
      ctx.stroke();

      // 字母
      ctx.fillStyle = it.color;
      ctx.font = 'bold 15px ui-monospace, monospace';
      ctx.textBaseline = 'middle';
      ctx.fillText(it.k, x, y0 + 1);
      ctx.textBaseline = 'alphabetic';

      // 标签
      ctx.font = '11px "PingFang SC", sans-serif';
      ctx.fillStyle = 'rgba(205,228,248,0.82)';
      ctx.fillText(it.label, x, y0 + 34);
    });

    // 满级机制提示
    ctx.font = '10px "PingFang SC", sans-serif';
    ctx.fillStyle = 'rgba(255,210,120,0.72)';
    ctx.fillText('W：不同武器各占一槽（最多 3 个），同时开火', cx, y0 + 62);
    ctx.fillStyle = 'rgba(255,180,140,0.66)';
    ctx.fillText('W：满级后再吃同款 → 全弹发射', cx, y0 + 78);
    ctx.fillStyle = 'rgba(160,240,255,0.72)';
    ctx.fillText('O：僚机最多 2 架；满员后再吃 → 短暂无敌', cx, y0 + 94);
    ctx.fillStyle = 'rgba(255,140,220,0.75)';
    ctx.fillText('R：环绕机最多 2 台；能挡子弹、撞敌机', cx, y0 + 110);
    ctx.fillStyle = 'rgba(180,140,255,0.8)';
    ctx.fillText('L：激光保险 · X 清屏炸弹 / C 或 L 放激光', cx, y0 + 126);

    ctx.fillStyle = 'rgba(110,150,180,0.45)';
    ctx.font = '9px ui-monospace, monospace';
    ctx.fillText('9 STAGES · 9 BOSSES', cx, VIEW.h - 30);

    // 左下角版本号：每次迭代改 config.js 的 VERSION
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(150,190,220,0.85)';
    ctx.font = '12px ui-monospace, monospace';
    ctx.fillText(VERSION, 16, VIEW.h - 16);

    ctx.restore();
    ctx.textAlign = 'left';
  }

  /* -------------------------------------------------- 循环 */
  /* 调试：跳过波次直接进 BOSS */
  jumpToBoss() {
    // 标题页 / 素材刚加载完时 waves 还没生成，直接跳会抛 undefined.length
    if (!Array.isArray(this.waves)) this.startLevel(this.levelIdx || 0, false);
    this.waveIdx = this.waves.length;
    this.queue.length = 0;
    this.enemies.forEach(e => { e.active = false; });
    this.state = 'play';
    this._clearDelay = undefined;
    this.spawnBoss();
  }

  start() {
    if (this.demo) {
      setTimeout(() => {
        if (this.state === 'title') this.beginRun();
        if (this.debugBossFlag) setTimeout(() => this.jumpToBoss(), 600);
      }, 400);
    }
    this.last = performance.now();
    this.lastFrameAt = performance.now();

    // update / draw 各自兜底：任何一次异常都不允许让 rAF 断掉，
    // 否则整局会静止在一个画面上（表现为“游戏卡住”）。
    const loop = ts => {
      this.lastFrameAt = performance.now();

      // 每 0.5 秒更新一次帧率
      this._fpsAcc += 1;
      const nowMs = this.lastFrameAt;
      if (!this._fpsAt) this._fpsAt = nowMs;
      else if (nowMs - this._fpsAt >= 500) {
        this.fps = Math.round(this._fpsAcc * 1000 / (nowMs - this._fpsAt));
        this._fpsAcc = 0;
        this._fpsAt = nowMs;
      }

      const raw = (ts - this.last) / 1000;
      this.last = ts;
      const dt = Math.min(0.1, raw);
      this.acc += dt;
      let guard = 0;
      while (this.acc >= STEP && guard++ < 5) {
        try {
          this.update(STEP);
        } catch (err) {
          this._onCrash(err, 'update');
          this.acc = 0;          // 丢掉积压，避免每帧反复撞同一个错误
          break;
        }
        this.acc -= STEP;
      }
      try {
        this.draw();
      } catch (err) {
        this._onCrash(err, 'draw');
      }
      this.raf = requestAnimationFrame(loop);
    };
    this._loop = loop;
    this.raf = requestAnimationFrame(loop);

    // 看门狗：切后台、异常导致 rAF 静默停止时，1 秒内自动重启循环
    if (!this._watchdog) {
      this._watchdog = setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        if (!this._loop) return;
        if (performance.now() - this.lastFrameAt < 2000) return;
        cancelAnimationFrame(this.raf);
        this.last = performance.now();
        this.acc = 0;
        this.lastFrameAt = performance.now();
        this.reviveCount += 1;
        this.raf = requestAnimationFrame(this._loop);
      }, 1000);
    }
  }
}

/* -------------------------------------------------- 启动 */
window.addEventListener('load', () => {
  const boot = document.getElementById('boot');
  Assets.load().then(() => {
    const game = new Game(document.getElementById('game'));
    window.game = game;

    /* 全局异常：记进调试面板，别让它静默打断帧循环 */
    window.addEventListener('error', e => game._onCrash(e.error || e.message, 'window'));
    window.addEventListener('unhandledrejection', e => game._onCrash(e.reason, 'promise'));

    game.start();
    if (boot) boot.classList.add('hide');
  }).catch(err => {
    console.error(err);
    if (boot) boot.textContent = '素材加载失败：' + err.message;
  });
});
