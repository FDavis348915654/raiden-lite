/* ============================================================
 * 腕上雷电 · Raiden Lite
 * config.js —— 全局常量、敌机属性表、5 关波次数据
 * 目标运行环境：浏览器（后续移植到小米手环 Vela 快应用）
 * ============================================================ */

const VERSION = '3.20.4';                 // 每次迭代递增，标题页左下角显示

/* 开发开关：发布正式版时改成 false。
 * false 时调试面板完全不创建（不注册按钮、不响应触摸、不绘制），
 * 主循环的异常兜底仍然保留，但只在控制台记录，不在画面显示。 */
const DEBUG = true;

const VIEW = { w: 480, h: 854 };
const PLAY_TOP = 70;        // HUD 之下才是可活动区域
const PLAY_BOTTOM = VIEW.h - 30;

/* BOSS 前的收尾编队段
 * 痛点：波次按时间生成，而玩家打小 BOSS 要 15~25 秒，这期间后面的兵已经按时间全部出完，
 * 于是"小 BOSS 一死就进 BOSS 预警"——实测第 2/3/5/6/8/9 关的间隔只有 1.1~6.2 秒。
 * 现在小 BOSS 清空后强制再打一段编队，按 gap 持续投放，撑满 span 才允许进 BOSS。
 */
const OUTRO = {
  span: 12,          // 收尾段时长（秒）：小 BOSS 打完且波次放完后，必须再打这么久
  gap: 1.8,          // 每组编队的间隔（约 4 组）
  tail: 6,           // 最后这么多秒不再补兵，留给场上的人飞完 / 被清掉
  minN: 5,           // 每组数量下限
  maxN: 7,           // 上限（还会乘关卡 density）
  firstDelay: 0.3    // 起算到第一组的延迟，给玩家一点喘息
};

/* 蛇形小 BOSS（第 9 关第二轮）
 * 沿屏幕四周的圆角矩形环路游荡，头难打、身脆，每个关节都会朝玩家发弹。
 * 打爆蛇头 → 整条崩解；只剪身体只能削掉发弹点，不能击杀。
 */
const SNAKE = {
  segs: 8,               // 身体节数
  headHp: 1000,          // 头：需要专注输出 6~7 秒
  segHp: 130,            // 每节：剪一节 1 秒左右
  spacing: 26,           // 相邻节沿路径的弧长间隔（要 ≤ 最细节的直径，否则尾巴会断成一节一节）
  speed: 152,            // 沿路径速度 px/s（一圈约 13 秒，玩家有追打时间）
  headR: 25,
  segR0: 19,             // 第一节半径
  segR1: 13,             // 最后一节（直径 26 = spacing，保证躯体连续）
  fireGap: 0.15,         // 每 0.15 秒由一个关节发一发（轮流，不是齐射）
  headFireGap: 2.1,      // 头部扇形三连的间隔
  bulletSpeed: 195,
  spawnGuard: 1.4,       // 出场保护，避免刚露面就被贴脸打
  inset: { x: 58, top: PLAY_TOP + 54, bottom: 76, radius: 46 },

  /* 暴走：蛇被剪掉几节、或头血量过半后提速加射速，
   * 让"先剪身体"这个选择有代价——削弱弹幕的同时把剩下的部分激怒。 */
  rage: {
    lostSegs: 3,         // 掉这么多节就暴走
    hpRatio: 0.5,        // 或者头血量低于这个比例
    speedMul: 1.55,      // 沿路径速度倍率（一圈 12.8s → 8.3s）
    fireMul: 0.62,       // 发弹间隔倍率（越小越快）
    headFireMul: 0.62,   // 头部扇形间隔倍率
    headFan: 5           // 头部扇形从 3 发变 5 发
  }
};

/* 调试面板布局：底部两列三行按钮（无敌/碰撞盒、上下关、补给/跳Boss），展开时从下往上排；
 * 右侧 x>330 留给保险按钮，避免重叠 */
const DEV_PANEL = {
  toggle: { x: 12, y: VIEW.h - 56, w: 58, h: 22 },   // 收起/展开把手
  bw: 96, bh: 24, gap: 6, rowGap: 6,
  baseX: 12
};

const PLAYER = {
  speed: 330,               // 键盘移动速度 px/s
  lives: 3,
  maxLives: 10,             // 生命上限（H 道具封顶）
  deathDelay: 1.5,          // 阵亡后停这么久再出结算页，留给爆炸和反应时间
  bombs: 5,                 // 初始保险（清屏炸弹）数量
  maxBombs: 10,             // 保险上限（清屏 + 2.4s 无敌，堆到 20 打起来没有取舍）
  invuln: 1.6,              // 受击后无敌时间
  bombInvuln: 2.4,          // 放保险后的无敌时间

  /* 普通保险：向前投掷高爆弹。按下瞬间只给无敌 + 音效，
   * 0.35 秒后落点爆炸：清空全屏敌弹 + 对半径内的敌人高额伤害。
   * 不再是"全屏秒杀"——爆炸圈外的敌人完全不受伤，保险才有站位取舍。 */
  bombThrow: 0.35,          // 投掷到引爆的时间（秒）
  bombVy: -680,             // 出膛初速（向上）
  bombAy: 700,              // 下坠加速度：让轨迹像抛物线，在顶点附近引爆
  bombRadius: 210,          // 爆炸半径（屏幕宽 480，横向约覆盖 88%）
  bombBossDmg: 160,         // BOSS 轮廓被罩住时的固定伤害
  bombSnakeDmg: 180,        // 蛇头只吃这些，避免一颗雷直接删掉整条蛇
  bombCd: 0.9,              // 普通保险冷却（从按下算）：比 0.35s 引信长，连点不会在上一颗还在飞时又扔一颗
  hitR: 9,                  // 判定半径（贴图宽 40，判定直径 18，接近弹幕游戏手感）
  startPower: 1,
  maxPower: 3,
  maxOptions: 2,            // 僚机上限（沙罗曼蛇式 Option）
  optionInvuln: 3.5,        // 僚机已满时再吃 O：短时无敌

  /* 激光保险（第二种保险）：向上打一条持续光束
   * 蓄力 0.8s → 发射 6s，全程无敌，能清掉路径上的敌弹 */
  laserBombs: 0,            // 初始数量（只能靠掉落）
  maxLaserBombs: 3,         // 上限（6 秒无敌 + 高伤害，3 颗已经能连穿三个 BOSS 阶段）
  laserCharge: 0.8,         // 蓄力时间
  laserFire: 6.0,           // 持续时间
  /* 激光冷却从按下开始算，所以取值 = 蓄力 + 发射 + 尾段空档。
   * 不能用「打完再冷却」：那等于让光束结束瞬间可以再按，两颗激光能无缝接成 13.6 秒无敌。 */
  laserCd: 7.4,             // 0.8 蓄力 + 6.0 发射 + 0.6 空档
  laserWidth: 44,           // 光束宽度（判定 = 宽度/2 + 目标半径）
  laserInvuln: 6.8,         // 蓄力+发射全程无敌
  laserDmgEnemy: 35,        // 每 tick 对敌机
  laserDmgBoss: 18,         // 每 tick 对 BOSS
  laserTick: 0.10,          // 伤害间隔

  /* 环绕机（帝国战机式二号机）：绕机身转，能撞掉敌机、抵消敌弹
   * 满两个后再吃 R 不再是"无效道具"，而是转得更快一段时间 */
  maxOrbits: 2,
  /* 绕行轨道：竖椭圆（上下长、左右稍窄）。
   * 竖版屏幕纵向空间更值钱：环绕机更多出现在机头/机尾方向，
   * 正前方和身后的挡弹更及时；横向收窄后也不会一直横在画面两侧抢视线。 */
  orbitRx: 58,              // 横向半径（短轴）
  orbitRy: 76,              // 纵向半径（长轴）
  orbitRef: 60,             // 里程参考半径：尾焰按这个半径折算落后弧长
  orbitSpeed: 5.24,         // 基础角速度 rad/s = 2π/1.2，1.2 秒转一圈（原来 1.5 秒，转得更有存在感）
  orbitBoostMul: 2.4,       // 超额吃 R 时的转速倍率
  orbitBoostT: 6,           // 加速持续时间
  orbitDmg: 3,              // 撞敌机的单次伤害
  orbitHitCd: 0.10,         // 对同一目标的伤害间隔（秒）
  orbitR2: 12,              // 环绕机判定半径（挡弹用）：和僚机球体同尺寸，太小会挡不住

  /* 环绕机尾焰：每台后面拖两粒更小的光点，沿同一条轨道落后一点点。
   * 既做视觉拖尾，也参与挡弹（hit 是挡弹半径）。
   * 只挡子弹、不伤敌机——尾焰要是也能撞敌人，等于白送一份 DPS。
   * da 是在 orbitRef 半径上的落后角（实际会按切向速度折算，见 _updateOrbits），
   * rr 是轨道半径倍率（略微内收更像彗尾）。
   * 尺寸取主球（半径 11）的 6~7 成：再小就只是两个火星，看不出是"小环绕机"；
   * 挡弹半径跟着视觉走，否则会出现"明明盖住了却没挡住"的手感落差。 */
  orbitTrail: [
    { da: 0.34, rr: 0.95, core: 7.6, hit: 8.6 },
    { da: 0.58, rr: 0.90, core: 5.0, hit: 6.0 }
  ],

  /* 后向火力倍率：朝下（vy>0）飞的子弹伤害 ×这个倍率。
   * 玩家长期待在屏幕下半部，机尾后面只有不到 100px 的可打区域，
   * 能命中的窗口通常 0.3 秒以内（逆火炮尾炮 / 环射炮朝下那几发）。
   * 按前向同等伤害算，实际打不掉一架 riser，等于没有输出。 */
  rearDmgMul: 4.0
};

/* ---------------- 武器表 ----------------
 * 4 种武器由道具 W 循环切换，火力等级 P 影响弹道数量与伤害
 * cd: 开火间隔（秒）
 */
const WEAPONS = [
  { id: 'vulcan',  name: 'VULCAN',  cn: '火神炮',   color: '#7fe0ff', cd: 0.100, from: 1 },
  /* 散射炮：一次 15 发的霰弹，射速刻意放慢（0.28s），靠"一片弹丸"而不是"持续泼水" */
  { id: 'spread',  name: 'SPREAD',  cn: '散射炮',   color: '#d8ff70', cd: 0.280, from: 1 },
  { id: 'laser',   name: 'LASER',   cn: '穿透激光', color: '#ff6b9d', cd: 0.120, from: 2 },
  { id: 'missile', name: 'MISSILE', cn: '追踪导弹', color: '#8dff9e', cd: 0.360, from: 3 },
  /* --- 后期解锁 --- */
  { id: 'plasma',  name: 'PLASMA',  cn: '等离子炮', color: '#c08cff', cd: 0.300, from: 4 },
  { id: 'flak',    name: 'FLAK',    cn: '散榴弹',   color: '#ff9a5c', cd: 0.420, from: 5 },
  { id: 'tesla',   name: 'TESLA',   cn: '电弧炮',   color: '#7dfaff', cd: 0.240, from: 6 },
  /* --- 带后向火力 --- */
  { id: 'backfire', name: 'BACKFIRE', cn: '逆火炮', color: '#5ce0b8', cd: 0.160, from: 3 },
  { id: 'omni',    name: 'OMNI',    cn: '环射炮',   color: '#ffb3e6', cd: 0.340, from: 6 }
];

/* 武器槽：吃到不同武器会占一个槽，多个槽同时开火
 * 第 2/3 槽伤害递减，避免叠满后一路碾压 */
const WEAPON_SLOTS = 3;
const SLOT_DMG = [1, 0.65, 0.5];

/* 散射炮射程（像素）：约 0.40 屏高，按"路径长度"算，不是垂直高度。
 * 它靠齐射铺开覆盖，不是靠打得远；射程拉满会和火神炮的持续压制撞定位，
 * 缩短之后才有取舍：贴脸时一片扇面清场，远处够不着只能靠别的武器补。
 * 单发伤害因此给得比火神炮高（2.6 vs 2），用"近身更痛"换"够不着远处"。 */
const SPREAD_RANGE = VIEW.h * 0.40;

/* ---------------- 全弹发射（OVERDRIVE） ----------------
 * 武器满级后再吃到同一把武器时触发。参照雷电的满级火力手感：
 *  - 一圈向外散射，弹数远多于常规射击（常规一轮 3~7 发，这里 30~50 发）
 *  - 单发伤害是普通子弹的 3~4 倍，打在身上"明显更痛"
 *  - 分两层：外圈快、内圈慢，层间速度差 ≥ 35%，
 *    飞出去会拉开成内外两圈，玩家一眼能看出这发不一样（散射炮三层）
 *
 * 单发为什么敢给到 6~9：360° 摊开之后，真正能命中 BOSS 的只有朝向它的
 * 那一小片（约 1/6），实际结算伤害只有总弹数的零头。
 * n=弹数 / sp=初速 / dmg=单发伤害 / r=弹体半径 / rot=整层起始角偏移
 */
const OVERDRIVE = {
  boostT: 2.6,        // 射速强化持续时间（秒）
  boostMul: 0.55,     // 期间冷却倍率：≈ 射速 ×1.82
  life: 1.5,          // 弹幕存活时间（够飞出屏幕，不会被中途掐断）
  shapes: {
    // 火神炮：经典双层环，外快内慢、内圈弹体更粗
    vulcan: [
      { n: 24, sp: 900, dmg: 7, r: 9 },
      { n: 17, sp: 520, dmg: 6, r: 11, rot: 0.11 }
    ],
    // 散射炮：三层，越靠内越慢、越密，像一记环形开屏
    spread: [
      { n: 26, sp: 880, dmg: 6, r: 8 },
      { n: 20, sp: 620, dmg: 5, r: 9, rot: 0.09 },
      { n: 14, sp: 430, dmg: 4, r: 10, rot: 0.19 }
    ],
    // 穿透激光：弹数少但一发穿一串，双环速度差拉大到 60%
    laser: [
      { n: 12, sp: 900, dmg: 8, r: 9, kind: 'laser', pierce: true },
      { n: 9, sp: 560, dmg: 6, r: 10, rot: 0.21, kind: 'laser', pierce: true }
    ],
    // 追踪导弹：外圈直飞、内圈慢速追踪，收尾时自己拐回来补刀
    missile: [
      { n: 14, sp: 700, dmg: 6, r: 8, kind: 'missile' },
      { n: 12, sp: 430, dmg: 6, r: 9, rot: 0.13, kind: 'missile', homing: 5.5 }
    ],
    // 等离子炮：大弹 + 命中炸开，两层都带爆炸
    plasma: [
      { n: 16, sp: 720, dmg: 9, r: 12, kind: 'plasma', boom: { r: 50, dmg: 4 } },
      { n: 12, sp: 440, dmg: 8, r: 13, rot: 0.15, kind: 'plasma', boom: { r: 44, dmg: 4 } }
    ],
    // 散榴弹：命中即炸（不用引信，向后飞的那几发引信炸开方向会不对）
    flak: [
      { n: 18, sp: 660, dmg: 7, r: 9, kind: 'flak', boom: { r: 46, dmg: 4 } },
      { n: 14, sp: 420, dmg: 6, r: 10, rot: 0.16, kind: 'flak', boom: { r: 40, dmg: 3 } }
    ],
    // 电弧炮：外圈跳 2 次、内圈跳 1 次
    tesla: [
      { n: 18, sp: 800, dmg: 6, r: 8, kind: 'tesla', chain: 2 },
      { n: 14, sp: 470, dmg: 6, r: 9, rot: 0.14, kind: 'tesla', chain: 1 }
    ],
    // 逆火炮：整圈同伤害，前向压 BOSS、后向顺手清爬上来 / 掠过机尾的敌机
    backfire: [
      { n: 20, sp: 860, dmg: 7, r: 9 },
      { n: 16, sp: 500, dmg: 6, r: 10, rot: 0.16 }
    ],
    // 环射炮：本来就是环形，全弹发射直接铺满内外两圈
    omni: [
      { n: 30, sp: 760, dmg: 6, r: 8 },
      { n: 22, sp: 480, dmg: 5, r: 9, rot: 0.09 }
    ]
  }
};

/** 当前关卡已解锁的武器索引 */
function unlockedWeapons(stageId) {
  const out = [];
  for (let i = 0; i < WEAPONS.length; i++) {
    if ((WEAPONS[i].from || 1) <= stageId) out.push(i);
  }
  return out.length ? out : [0];
}

/* 续关：死亡后进入限时续关窗口，最多续 3 次 */
const CONTINUE = {
  max: 3,          // 一局内最多续关次数
  window: 9,       // 每次续关倒计时（秒）
  lives: 3,        // 续关后恢复的命数
  invuln: 3.4      // 续关后的无敌时间
};

/* 精英变体：中小型机有概率强化出场，血厚、体积大、掉落好 */
const ELITE_KINDS = ['scout', 'fighter', 'diver', 'drone', 'flame', 'mirror', 'eel', 'torpedo'];
const ELITE_CHANCE = 0.09;
const ELITE_HP_MUL = 3.2;

/* 波次压缩系数：只放大数量不够，出场节奏不加快的话玩家会把它们逐个点掉
 * at 整体提前 15%，同一波内每架之间的间隔缩短 25%
 */
const WAVE_TUNE = { timeScale: 0.80, gapScale: 0.68 };

/* 掉落权重（累计区间） */
const DROPS = [
  { kind: 'P', upto: 0.060 },   // 火力 +1
  { kind: 'W', upto: 0.100 },   // 切换武器
  { kind: 'B', upto: 0.128 },   // 保险 +1
  { kind: 'H', upto: 0.145 },   // 生命 +1
  { kind: 'O', upto: 0.158 },   // 僚机 +1（稀有）
  { kind: 'R', upto: 0.180 },   // 环绕机 +1（稀有）
  { kind: 'L', upto: 0.193 }    // 激光保险 +1（更稀有）
];

const SCORE = { pickup: 50, bossKill: 5000, stageClear: 2000, bombKill: 60 };

/* ---------------- 敌机属性表 ----------------
 * sprite : sprites.json 里的帧名
 * hp     : 基础血量（关卡可覆盖）
 * speed  : 下落速度 px/s
 * score  : 击破得分
 * r      : 碰撞半径系数（相对贴图短边的一半）
 * ai     : 行为标识，见 entities.js
 *
 * 【3.3.0 血量重做】速度是节奏，血量是存在感。
 * 旧表里越慢的机越脆（bomber 62px/s 只有 15 血、heavy 42px/s 只有 32 血），
 * 结果是慢机在屏幕上飘半天、一枪就碎，既没威胁也没有打击反馈。
 * 现在按“慢 = 厚”重排：速度一个都没动，只改 hp（score 跟着血量上调）。
 * 慢速重装机的等效击杀时长从 0.2s 提到 1.5~2.5s，飞到底部前打不掉就是玩家的失误。
 *
 * 分档（玩家满级单槽约 70 DPS / 三槽约 150 DPS）：
 *   ≤50px/s   ×3.5~5  （heavy 155 / mineH 34 / jelly 38 / mine 12）
 *   51~75     ×3~3.5  （bomber 52 / eel 34 / shield 38 / diver 14）
 *   76~110    ×2~2.3  （fighter 11 / mirror 16 / flame 14 / looper 13）
 *   111~150   ×1.6~2  （scout 5 / formation 10 / riser 11 / drone 7 / kamikaze 8）
 *   >200      ×1.4    （torpedo 7，快到本来就不该耐打）
 *
 * 两个不能踩的坑：
 * 1) 快速机不要跟着加。用 tools/balance_sim.py 实测过：把 scout / drone / kamikaze
 *    一起拉到 2.5 倍时，典型配置的漏怪率 0% → 8%，同屏峰值 33 → 73 架，
 *    点掉小机的爽感也没了 —— 它们本来就不在“又慢又脆”这个问题里。
 * 2) shield 正面只吃 15% 伤害，等效血量 = 38/0.15 ≈ 253（改前 227）已经够厚，
 *    再往上堆等于逼玩家放弃从下方输出。
 */
const ENEMY_DEFS = {
  scout:     { sprite: 'e_scout',     hp: 5,   speed: 120, score: 110, r: 0.60, ai: 'straight' },
  fighter:   { sprite: 'e_fighter',   hp: 11,  speed: 95,  score: 190, r: 0.64, ai: 'shooter',  fire: 2.1 },
  bomber:    { sprite: 'e_bomber',    hp: 52,  speed: 62,  score: 420, r: 0.70, ai: 'bomber',   fire: 2.9 },
  diver:     { sprite: 'e_diver',     hp: 14,  speed: 75,  score: 210, r: 0.60, ai: 'diver' },
  mine:      { sprite: 'e_mine',      hp: 12,  speed: 42,  score: 180, r: 0.68, ai: 'drift',  deathBurst: 12 },
  formation: { sprite: 'e_formation', hp: 10,  speed: 105, score: 180, r: 0.64, ai: 'straight' },
  torpedo:   { sprite: 'e_torpedo',   hp: 7,  speed: 250, score: 240, r: 0.58, ai: 'straight' },
  eel:       { sprite: 'e_eel',       hp: 34,  speed: 74,  score: 480, r: 0.58, ai: 'worm',
               diveR: 150, diveSpeed: 430 },
  jelly:     { sprite: 'e_jelly',     hp: 38,  speed: 48,  score: 420, r: 0.64, ai: 'hover',   fire: 3.1 },
  drone:     { sprite: 'e_drone',     hp: 7,  speed: 135, score: 140, r: 0.58, ai: 'chase' },
  shield:    { sprite: 'e_shield',    hp: 38,  speed: 55,  score: 600, r: 0.68, ai: 'tank' },
  kamikaze:  { sprite: 'e_kamikaze',  hp: 8,  speed: 145, score: 260, r: 0.56, ai: 'kamikaze' },
  flame:     { sprite: 'e_flame',     hp: 14,  speed: 88,  score: 340, r: 0.62, ai: 'shooter',  fire: 1.7 },
  mirror:    { sprite: 'e_mirror',    hp: 16,  speed: 92,  score: 400, r: 0.64, ai: 'mirror' },
  heavy:     { sprite: 'e_heavy',     hp: 155, speed: 42,  score: 900, r: 0.76, ai: 'heavy',    fire: 2.5 },

  /* --- 进阶单位 --- */
  // 高级浮雷：同一贴图放大，血厚、爆散更多子弹
  mineH:     { sprite: 'e_mine',      hp: 34,  speed: 32,  score: 420, r: 0.68, ai: 'drift',
               deathBurst: 16, scale: 1.32 },
  // 回旋机：落到底部调头向上，边爬升边追着玩家打
  looper:    { sprite: 'e_fighter',   hp: 13,  speed: 108, score: 300, r: 0.64, ai: 'looper',   fire: 1.1 },
  // 潜伏者：从屏幕底部升起，出现前底部会有警示
  riser:     { sprite: 'e_diver',     hp: 11,  speed: 132, score: 260, r: 0.60, ai: 'riser',    fire: 1.4 },
  // 中型机：底部升起 → 顶部巡游 → 三向散射，带独立血条
  miniboss:  { sprite: 'e_heavy',     hp: 300, speed: 58,  score: 2400, r: 0.72, ai: 'miniboss',
               fire: 1.7, scale: 1.62 },

  /* 蛇形小 BOSS 的部件：不走自己的 AI，位置由 game._updateSnake 沿路径写入。
   * 复用 Enemy 是为了白嫖碰撞、受击闪白、死亡结算；绘制由 game._drawSnake 统一画，
   * 所以这里的 sprite 只用来取一个尺寸基准，实际不绘制。 */
  snakeHead: { sprite: 'e_heavy',     hp: 1000, speed: 0,   score: 3200, r: 0.9, ai: 'snake' },
  snakeBody: { sprite: 'e_mine',      hp: 130,  speed: 0,   score: 240,  r: 0.9, ai: 'snake' }
};

/* 分裂体：第 8 关 BOSS 分裂出来的分身，用 BOSS 精灵的小号版本 */
ENEMY_DEFS.splitling = {
  sprite: 'boss8', hp: 420, speed: 0, score: 2800, r: 0.62,
  ai: 'miniboss', fire: 2.2, scale: 0.58
};

/* 会从屏幕底部出现、需要提前警示的单位 */
const BOTTOM_SPAWN = ['riser', 'miniboss'];

/* 登场保护（秒）：只对从底部升起的单位生效，其余敌机出生即可打。
 * 作用仅仅是"别在还没冒出屏幕边缘时就白挨打"，所以只覆盖爬升那一段。
 * 之前两种单位统一 2.8 秒：riser 冒出底边约需 1.0 秒，剩下近 1.8 秒
 * 是露在画面里却打不动的，手感像子弹白打；miniboss 爬得快（220px/s），
 * 0.6 秒就露头，2.8 秒甚至能把整段爬升都罩住。
 */
const SPAWN_GUARD = {
  riser: 1.15,      // 冒出底边 1.0 秒 + 0.15 秒缓冲
  miniboss: 1.30   // 冒出底边 0.6 秒，多留 0.7 秒避免刚露头就被爆发掉
};

/* ---------------- 关卡 ----------------
 * waves[].at    : 关卡开始后第几秒生成
 * form          : line 横排 / vee V 字 / column 竖列 / sides 两侧 / arc 弧形
 * gap           : 同波内每架之间的出场延迟
 *
 * supply[]      : 关卡补给投放（除敌机掉落、BOSS 战空投之外的固定投放点）
 *   at          : 关卡开始后第几秒投放（跟波次一样乘 WAVE_TUNE.timeScale）
 *   ev          : 事件点触发，目前支持 'miniboss'（小 BOSS 被击破）+ delay 秒后投放
 *   kind        : P 火力 / W 武器 / B 保险 / H 生命 / O 僚机 / R 环绕机 / L 激光保险
 *   from        : top        自上飘下
 *                 rise       自下升起
 *                 bounce     自上落下，触底反弹再飘走
 *                 riseBounce 自下升起，触顶反弹再落下
 *   x           : 0~1 横向位置（省略则随机），用于"上下对开"这种呼应排布
 *   sway        : 横向摆幅 px/s（洋流、极光、失重漂移用）
 *   speed       : 飘移速度 px/s（默认 78，虚空/轨道关更慢）
 *
 * 入场方式按关卡主题选：云端/峡谷是气流托举，熔核与裂殖之巢从底部涌上来，
 * 深海是洋流上下、轨道残骸是失重慢漂，终焉星环上下对开。
 */
const LEVELS = [
  {
    id: 1,
    name: '云端哨戒',
    sub: 'STAGE 1 · CLOUD PATROL',
    bg: 'bg1',
    accent: '#7fd6ff',
    density: 1.35,
    boss: 'boss1',
    bossName: '苍鹰母舰',
    support: 'fighter',
    bossHp: 2200,
    // 云端哨戒：云层气流把补给往上托，主流仍是自上飘下，第 3 份落到底边被弹回去
    supply: [
      { at: 7,  kind: 'P', from: 'top' },
      { at: 14, kind: 'W', from: 'rise' },
      { at: 22, kind: 'P', from: 'bounce' },
      { at: 31, kind: 'B', from: 'rise' },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'bounce' }
    ],
    waves: [
      { at: 1.5,  kind: 'scout',     n: 5,  form: 'line',   speed: 115, gap: 0.16 },
      { at: 11.5, kind: 'scout',    n: 5,  side: 'left',  gap: 0.14 },   // 教学：第一次见到侧向来敌
      { at: 5.2,  kind: 'scout',     n: 6,  form: 'vee',    speed: 120, gap: 0.14 },
      { at: 9.2,  kind: 'fighter',   n: 3,  form: 'line',   speed: 95,  gap: 0.35 },
      { at: 13.8, kind: 'bomber',    n: 2,  form: 'sides',  speed: 66,  gap: 0.6 },
      { at: 18.2, kind: 'scout',     n: 8,  form: 'arc',    speed: 130, gap: 0.10 },
      { at: 22.8, kind: 'fighter',   n: 4,  form: 'vee',    speed: 100, gap: 0.30 },
      { at: 27.4, kind: 'bomber',    n: 3,  form: 'line',   speed: 70,  gap: 0.55 },
      { at: 32.4, kind: 'scout',     n: 10, form: 'line',   speed: 140, gap: 0.12 },
      { at: 36.8, kind: 'scout',   n: 9, form: 'diamond', speed: 138, gap: 0.10 },
      { at: 41.2, kind: 'fighter', n: 5, form: 'pincer',  speed: 105, gap: 0.30 }
    ]
  },
  {
    id: 2,
    name: '黄昏峡谷',
    sub: 'STAGE 2 · DUSK CANYON',
    bg: 'bg2',
    accent: '#ffb066',
    density: 1.42,
    boss: 'boss2',
    bossName: '岩甲巨蟹',
    support: null,
    bossHp: 2800,
    // 黄昏峡谷：峡谷热风横着刮，道具一路摆着下来；落底的会被风托回一段
    supply: [
      { at: 7,  kind: 'P', from: 'top', sway: 34 },
      { at: 15, kind: 'W', from: 'bounce', sway: 30 },
      { at: 23, kind: 'P', from: 'rise', sway: 40 },
      { at: 31, kind: 'H', from: 'top' },
      { ev: 'miniboss', delay: 1.4, kind: 'P', from: 'bounce' }
    ],
    waves: [
      { at: 1.5,  kind: 'diver',     n: 4,  form: 'line',   speed: 80,  gap: 0.30 },
      { at: 7.8,  kind: 'diver',    n: 4,  side: 'right', gap: 0.16 },   // 从右侧切入后俯冲
      { at: 16.8, kind: 'scout',    n: 6,  side: 'left',  gap: 0.12, arc: true },  // 弧线：左下 → 左上
      { at: 5.6,  kind: 'formation', n: 5,  form: 'vee',    speed: 110, gap: 0.14 },
      { at: 9.8,  kind: 'mine',      n: 5,  form: 'arc',    speed: 40,  gap: 0.44 },
      { at: 14.2, kind: 'diver',     n: 6,  form: 'sides',  speed: 90,  gap: 0.26 },
      { at: 18.4, kind: 'formation', n: 7,  form: 'arc',    speed: 115, gap: 0.12 },
      { at: 22.8, kind: 'mine',      n: 6,  form: 'line',   speed: 45,  gap: 0.40 },
      { at: 27.2, kind: 'diver',     n: 8,  form: 'vee',    speed: 95,  gap: 0.22 },
      { at: 32.0, kind: 'formation', n: 8,  form: 'line',   speed: 120, gap: 0.10 },
      { at: 36.4, kind: 'formation', n: 8, form: 'wave',   speed: 118, gap: 0.12 },
      { at: 40.8, kind: 'diver',     n: 6, form: 'pincer', speed: 95,  gap: 0.24 },
      { at: 12.6, kind: 'mineH',     n: 3, form: 'arc',    speed: 34,  gap: 0.55 },
      { at: 24.6, kind: 'looper',    n: 4, form: 'line',   speed: 112, gap: 0.45 },
      { at: 30.0, kind: 'miniboss',  n: 2, form: 'line',   speed: 58,  gap: 0.5 },
      { at: 21.0, kind: 'diver',    n: 5,  diag: 'ltr', gap: 0.14 },   // 对角：左下 → 右上
    ]
  },
  {
    id: 3,
    name: '深海要塞',
    sub: 'STAGE 3 · ABYSS FORTRESS',
    bg: 'bg3',
    accent: '#5cffd2',
    density: 1.50,
    boss: 'boss3',
    bossName: '深渊之眼',
    support: 'eel',
    bossHp: 3500,
    // 深海要塞：洋流慢，补给从深处浮上来；落到要塞底部会反弹
    supply: [
      { at: 7,  kind: 'P', from: 'rise', speed: 62 },
      { at: 14, kind: 'W', from: 'rise', speed: 62, sway: 22 },
      { at: 22, kind: 'P', from: 'bounce' },
      { at: 30, kind: 'B', from: 'riseBounce', sway: 24 },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'rise' }
    ],
    waves: [
      { at: 1.5,  kind: 'torpedo',   n: 4,  form: 'column', speed: 250, gap: 0.28 },
      { at: 15.5, kind: 'torpedo',  n: 6,  side: 'left',  gap: 0.16 },   // 高速从左侧掠过（6 架）
      { at: 5.2,  kind: 'eel',       n: 3,  form: 'line',   speed: 85,  gap: 0.42 },
      { at: 9.4,  kind: 'jelly',     n: 2,  form: 'sides',  speed: 50,  gap: 0.9 },
      { at: 13.6, kind: 'torpedo',   n: 6,  form: 'sides',  speed: 275, gap: 0.22 },
      { at: 17.8, kind: 'eel',       n: 4,  form: 'arc',    speed: 90,  gap: 0.36 },
      { at: 22.0, kind: 'jelly',     n: 3,  form: 'line',   speed: 55,  gap: 0.8 },
      { at: 26.4, kind: 'torpedo',   n: 8,  form: 'column', speed: 295, gap: 0.18 },
      { at: 31.0, kind: 'eel',       n: 5,  form: 'sides',  speed: 95,  gap: 0.32 },
      { at: 35.6, kind: 'torpedo', n: 6, form: 'wave',    speed: 272, gap: 0.20 },
      { at: 40.0, kind: 'eel',     n: 5, form: 'diamond', speed: 92,  gap: 0.34 },
      { at: 8.4,  kind: 'riser',   n: 3, form: 'line',    speed: 130, gap: 0.55 },
      { at: 21.0, kind: 'riser',   n: 4, form: 'sides',   speed: 140, gap: 0.42 },
      { at: 27.0, kind: 'miniboss', n: 2, form: 'line',    speed: 58,  gap: 0.5 }
    ]
  },
  {
    id: 4,
    name: '轨道残骸',
    sub: 'STAGE 4 · ORBITAL WRECK',
    bg: 'bg4',
    accent: '#b98cff',
    density: 1.58,
    boss: 'boss4',
    bossName: '轨道堡垒',
    support: null,
    bossHp: 4200,
    // 轨道残骸：失重，飘得慢、摆得大；两份补给在残骸之间来回弹
    supply: [
      { at: 6,  kind: 'P', from: 'top', speed: 58, sway: 46 },
      { at: 14, kind: 'W', from: 'top', speed: 58, sway: 46 },
      { at: 22, kind: 'P', from: 'rise', speed: 58, sway: 40 },
      { at: 30, kind: 'O', from: 'bounce', speed: 58 },
      { ev: 'miniboss', delay: 1.4, kind: 'P', from: 'bounce' }
    ],
    waves: [
      { at: 1.5,  kind: 'drone',     n: 8,  form: 'arc',    speed: 140, gap: 0.10 },
      { at: 12.2, kind: 'drone',    n: 7,  side: 'right', gap: 0.12 },   // 从右侧切入，进场后追玩家
      { at: 5.8,  kind: 'shield',    n: 2,  form: 'line',   speed: 60,  gap: 0.9 },
      { at: 10.2, kind: 'kamikaze',  n: 5,  form: 'sides',  speed: 160, gap: 0.24 },
      { at: 14.4, kind: 'drone',     n: 10, form: 'vee',    speed: 150, gap: 0.08 },
      { at: 18.6, kind: 'shield',    n: 3,  form: 'arc',    speed: 65,  gap: 0.7 },
      { at: 23.0, kind: 'kamikaze',  n: 7,  form: 'line',   speed: 170, gap: 0.20 },
      { at: 27.4, kind: 'drone',     n: 12, form: 'line',   speed: 160, gap: 0.06 },
      { at: 32.2, kind: 'shield',    n: 3,  form: 'sides',  speed: 70,  gap: 0.6 },
      { at: 36.8, kind: 'drone',    n: 10, form: 'diamond', speed: 150, gap: 0.09 },
      { at: 41.2, kind: 'kamikaze', n: 6,  form: 'wave',    speed: 165, gap: 0.22 },
      { at: 15.5, kind: 'miniboss', n: 3,  form: 'line',    speed: 58,  gap: 0.28, hp: 300 },
      { at: 30.0, kind: 'looper',   n: 5,  form: 'vee',     speed: 118, gap: 0.32 }
    ]
  },
  {
    id: 5,
    name: '熔核母舰',
    sub: 'STAGE 5 · CORE REACTOR',
    bg: 'bg5',
    accent: '#ff7a4d',
    density: 1.66,
    boss: 'boss5',
    bossName: '熔核核心',
    support: 'mirror',
    bossHp: 5200,
    // 熔核母舰：反应堆热流全往上走，补给全从底部升上来；顶上碰壁再落回来一份激光保险
    supply: [
      { at: 6,  kind: 'P', from: 'rise' },
      { at: 13, kind: 'P', from: 'rise' },
      { at: 21, kind: 'W', from: 'riseBounce' },
      { at: 29, kind: 'B', from: 'rise' },
      { ev: 'miniboss', delay: 1.4, kind: 'L', from: 'rise' }
    ],
    waves: [
      { at: 1.5,  kind: 'flame',     n: 3,  form: 'line',   speed: 90,  gap: 0.44 },
      { at: 8.4,  kind: 'flame',    n: 6,  side: 'left',  gap: 0.16 },   // 从左侧切入（6 架）
      { at: 17.2, kind: 'kamikaze', n: 5,  side: 'right', gap: 0.13, arc: true },  // 弧线：右下 → 右上
      { at: 6.0,  kind: 'mirror',    n: 4,  form: 'sides',  speed: 95,  gap: 0.36 },
      { at: 10.4, kind: 'heavy',     n: 2,  form: 'line',   speed: 45,  gap: 1.2 },
      { at: 15.0, kind: 'flame',     n: 5,  form: 'arc',    speed: 95,  gap: 0.30 },
      { at: 19.2, kind: 'mirror',    n: 6,  form: 'vee',    speed: 100, gap: 0.22 },
      { at: 23.6, kind: 'heavy',     n: 2,  form: 'sides',  speed: 50,  gap: 1.0 },
      { at: 28.2, kind: 'flame',     n: 6,  form: 'line',   speed: 100, gap: 0.26 },
      { at: 33.0, kind: 'mirror',    n: 8,  form: 'arc',    speed: 105, gap: 0.18 },
      { at: 37.6, kind: 'flame',  n: 6, form: 'pincer',  speed: 95,  gap: 0.28 },
      { at: 42.0, kind: 'mirror', n: 7, form: 'diamond', speed: 100, gap: 0.20 },
      { at: 12.5, kind: 'looper',  n: 5, form: 'vee',     speed: 120, gap: 0.28 },
      { at: 27.0, kind: 'riser',   n: 4, form: 'line',    speed: 145, gap: 0.35 },
      { at: 22.8, kind: 'miniboss', n: 2, form: 'line',   speed: 58,  gap: 0.5 }
    ]
  },
  {
    id: 6,
    name: '极光堡垒',
    sub: 'STAGE 6 · AURORA CITADEL',
    bg: 'bg6',
    accent: '#7dfff0',
    density: 1.70,
    boss: 'boss6',
    bossName: '极光母舰',
    bossHp: 5800,
    // 极光堡垒：极光像飘带一样左右摆，道具跟着摆；有一份从底部升起再落到顶盖
    supply: [
      { at: 6,  kind: 'P', from: 'top', sway: 52 },
      { at: 14, kind: 'W', from: 'bounce', sway: 48 },
      { at: 22, kind: 'P', from: 'rise', sway: 52 },
      { at: 30, kind: 'H', from: 'riseBounce', sway: 40 },
      { ev: 'miniboss', delay: 1.4, kind: 'O', from: 'bounce' }
    ],
    support: 'jelly',
    waves: [
      { at: 1.5,  kind: 'drone',  n: 8,  form: 'arc',     speed: 145, gap: 0.10 },
      { at: 12.8, kind: 'fighter',  n: 8,  side: 'right', gap: 0.12 },   // 从右侧切入（8 架）
      { at: 6.0,  kind: 'shield', n: 2,  form: 'line',    speed: 60,  gap: 0.8 },
      { at: 10.5, kind: 'eel',    n: 4,  form: 'wave',    speed: 95,  gap: 0.35 },
      { at: 15.0, kind: 'jelly',  n: 3,  form: 'sides',   speed: 52,  gap: 0.7 },
      { at: 19.5, kind: 'drone',  n: 10, form: 'diamond', speed: 150, gap: 0.08 },
      { at: 24.0, kind: 'shield', n: 3,  form: 'pincer',  speed: 65,  gap: 0.6 },
      { at: 28.5, kind: 'eel',    n: 6,  form: 'vee',     speed: 100, gap: 0.28 },
      { at: 33.0, kind: 'jelly',  n: 4,  form: 'line',    speed: 55,  gap: 0.65 },
      { at: 37.5, kind: 'drone',  n: 12, form: 'wave',    speed: 155, gap: 0.07 },
      { at: 42.0, kind: 'shield', n: 4,  form: 'arc',     speed: 70,  gap: 0.55 },
      { at: 21.5, kind: 'miniboss', n: 3, form: 'line',   speed: 58,  gap: 0.28, hp: 280 },
      { at: 22.0, kind: 'fighter',  n: 6,  diag: 'rtl', gap: 0.13 },   // 对角：右下 → 左上
    ]
  },
  {
    id: 7,
    name: '虚空王座',
    sub: 'STAGE 7 · VOID THRONE',
    bg: 'bg7',
    accent: '#ffc460',
    density: 1.80,
    boss: 'boss7',
    bossName: '虚空之主',
    bossHp: 6800,
    // 虚空王座：几乎没有重量，飘得最慢；环绕机从底部浮到王座边缘再落回来
    supply: [
      { at: 6,  kind: 'P', from: 'top', speed: 54, sway: 38 },
      { at: 13, kind: 'W', from: 'rise', speed: 54, sway: 38 },
      { at: 21, kind: 'P', from: 'bounce', speed: 60 },
      { at: 30, kind: 'R', from: 'riseBounce', speed: 54 },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'top' }
    ],
    support: null,
    waves: [
      { at: 1.5,  kind: 'kamikaze', n: 5,  form: 'line',    speed: 160, gap: 0.24 },
      { at: 12.8, kind: 'kamikaze', n: 5,  side: 'left',  gap: 0.15 },   // 从左侧切入后直扑
      { at: 20.5, kind: 'diver',    n: 4,  side: 'right', gap: 0.15, arc: true },  // 弧线：右下 → 右上
      { at: 6.0,  kind: 'mirror',   n: 5,  form: 'sides',   speed: 100, gap: 0.30 },
      { at: 10.5, kind: 'heavy',    n: 2,  form: 'line',    speed: 48,  gap: 1.0 },
      { at: 15.0, kind: 'flame',    n: 6,  form: 'arc',     speed: 100, gap: 0.25 },
      { at: 19.5, kind: 'kamikaze', n: 8,  form: 'wave',    speed: 170, gap: 0.20 },
      { at: 24.0, kind: 'mirror',   n: 7,  form: 'diamond', speed: 105, gap: 0.22 },
      { at: 28.5, kind: 'heavy',    n: 3,  form: 'pincer',  speed: 52,  gap: 0.9 },
      { at: 33.0, kind: 'flame',    n: 8,  form: 'vee',     speed: 105, gap: 0.22 },
      { at: 37.5, kind: 'kamikaze', n: 10, form: 'diamond', speed: 175, gap: 0.16 },
      { at: 42.0, kind: 'mirror',   n: 9,  form: 'wave',    speed: 110, gap: 0.18 },
      { at: 17.5, kind: 'miniboss', n: 3, form: 'line',     speed: 58,  gap: 0.28, hp: 310 }
    ]
  },
  {
    id: 8,
    name: '裂殖之巢',
    sub: 'STAGE 8 · MITOSIS NEST',
    bg: 'bg8',
    accent: '#b2ff60',
    density: 1.88,
    boss: 'boss8',
    bossName: '裂殖之核',
    bossHp: 7600,
    // 裂殖之巢：巢体脉动把补给从底部挤上来，越打越往上涌
    supply: [
      { at: 6,  kind: 'P', from: 'rise' },
      { at: 12, kind: 'P', from: 'rise' },
      { at: 19, kind: 'W', from: 'riseBounce' },
      { at: 27, kind: 'H', from: 'rise' },
      { ev: 'miniboss', delay: 1.4, kind: 'L', from: 'rise' }
    ],
    support: 'kamikaze',
    waves: [
      { at: 1.5,  kind: 'kamikaze', n: 6,  form: 'line',    speed: 168, gap: 0.20 },
      { at: 11.5, kind: 'mirror',   n: 8,  side: 'right', gap: 0.13 },   // 从右侧切入（8 架）
      { at: 5.5,  kind: 'drone',    n: 10, form: 'diamond', speed: 152, gap: 0.08 },
      { at: 9.5,  kind: 'flame',    n: 7,  form: 'arc',     speed: 102, gap: 0.22 },
      { at: 13.5, kind: 'mirror',   n: 7,  form: 'sides',   speed: 104, gap: 0.24 },
      { at: 17.5, kind: 'kamikaze', n: 9,  form: 'wave',    speed: 172, gap: 0.16 },
      { at: 21.5, kind: 'drone',    n: 12, form: 'diamond', speed: 158, gap: 0.07 },
      { at: 25.5, kind: 'miniboss', n: 3,  form: 'line',    speed: 58,  gap: 0.28, hp: 320 },
      { at: 30.0, kind: 'flame',    n: 9,  form: 'pincer',  speed: 106, gap: 0.20 },
      { at: 34.5, kind: 'mirror',   n: 9,  form: 'diamond', speed: 108, gap: 0.18 },
      { at: 39.0, kind: 'kamikaze', n: 11, form: 'diamond', speed: 178, gap: 0.14 },
      { at: 19.5, kind: 'kamikaze', n: 5,  diag: 'ltr', gap: 0.13 },   // 对角：左下 → 右上
    ]
  },
  {
    id: 9,
    name: '终焉星环',
    sub: 'STAGE 9 · FINAL RING',
    bg: 'bg9',
    accent: '#b4beff',
    density: 2.00,
    boss: 'boss9',
    bossName: '终焉星环',
    bossHp: 9000,
    // 终焉星环：星环上下两半同时投放，同一时刻一份自上落下、一份自下升起
    supply: [
      { at: 7,  kind: 'P', from: 'top',  x: 0.28 },
      { at: 7,  kind: 'P', from: 'rise', x: 0.72 },
      { at: 16, kind: 'W', from: 'top',  x: 0.72 },
      { at: 16, kind: 'W', from: 'rise', x: 0.28 },
      { at: 25, kind: 'B', from: 'bounce' },
      { at: 32, kind: 'O', from: 'riseBounce' },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'bounce' }
    ],
    phaseCuts: [0.8, 0.6, 0.4, 0.2],   // 五阶段
    support: null,
    waves: [
      { at: 1.5,  kind: 'shield',   n: 3,  form: 'line',    speed: 66,  gap: 0.6 },
      { at: 11.5, kind: 'shield',   n: 6,  side: 'left',  gap: 0.17 },   // 从左侧贴墙切入（6 架）
      { at: 17.2, kind: 'kamikaze', n: 5,  side: 'right', gap: 0.13, arc: true },  // 弧线：右下 → 右上
      { at: 5.5,  kind: 'heavy',    n: 2,  form: 'line',    speed: 50,  gap: 1.0 },
      { at: 9.5,  kind: 'eel',      n: 6,  form: 'wave',    speed: 100, gap: 0.26 },
      { at: 13.5, kind: 'kamikaze', n: 8,  form: 'pincer',  speed: 175, gap: 0.18 },
      { at: 17.5, kind: 'miniboss', n: 3,  form: 'line',    speed: 58,  gap: 0.28, hp: 340 },
      { at: 22.0, kind: 'mirror',   n: 9,  form: 'diamond', speed: 110, gap: 0.18 },
      { at: 26.5, kind: 'jelly',    n: 5,  form: 'arc',     speed: 54,  gap: 0.6 },
      { at: 31.0, kind: 'heavy',    n: 3,  form: 'pincer',  speed: 54,  gap: 0.8 },
      { at: 35.5, kind: 'shield',   n: 5,  form: 'wave',    speed: 74,  gap: 0.5 },
      { at: 40.0, kind: 'drone',    n: 14, form: 'diamond', speed: 162, gap: 0.06 },

      // 第二轮小 BOSS：蛇形，在杂兵段之后压轴出场（头 1000 血 / 8 节 × 130）
      { at: 43.5, kind: 'snake',    n: 1,  form: 'line' },
      { at: 22.5, kind: 'torpedo',  n: 6,  diag: 'rtl', gap: 0.10 },   // 对角：右下 → 左上
    ]
  }
];

/* ---------------- 小工具 ---------------- */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (x1, y1, x2, y2) => {
  const dx = x1 - x2, dy = y1 - y2;
  return dx * dx + dy * dy;
};
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - t, 3);
