/* ============================================================
 * 腕上雷电 · Raiden Lite
 * config.js —— 全局常量、敌机属性表、5 关波次数据
 * 目标运行环境：浏览器（后续移植到小米手环 Vela 快应用）
 * ============================================================ */

const VERSION = '3.38.0';                 // 每次迭代递增，标题页左下角显示

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

/* 蛇形小 BOSS（第 8 关教学 / 第 9 关双蛇）
 * 沿屏幕四周的圆角矩形环路游荡，每个关节都会朝玩家发弹。
 *
 * 3.31 起身体是"计分目标"而不是"顺手的软肋"：每节血量≈头（略少一成多），
 * 所以流弹不会再白捡几节，想拿身体分必须专门压着一节打上五六秒。
 *   · 打爆头 → 整条崩解、立即结束这场小 BOSS（击杀线最快，分最少）
 *   · 打爆关节 → 只掉这一节，蛇还在，但每节都给一份高分
 * 两条路的总分刻意做成"啃干净身体 > 直接爆头"，把"贪不贪"这个选择交给玩家；
 * 代价是蛇一直在开火，且身体掉到 30% 会暴走。
 */
const SNAKE = {
  segs: 8,               // 身体节数
  headHp: 1000,          // 头：需要专注输出 6~7 秒
  segHp: 860,            // 每节：≈ 头的 0.86，压着一节打完约 5~6 秒
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

  /* 暴走：身体累计掉血三成、或头血量过半后提速加射速。
   * 按"身体掉血比例"而不是"掉了几个关节"判定——关节血量提高之后，
   * 数节数等于要玩家先砍掉半条蛇才触发，那条分支就成了死代码。 */
  rage: {
    lostBody: 0.30,      // 身体累计掉血达到这个比例就暴走（8 节时约 2.4 节）
    hpRatio: 0.5,        // 或者头血量低于这个比例
    speedMul: 1.55,      // 沿路径速度倍率（一圈 12.8s → 8.3s）
    fireMul: 0.62,       // 发弹间隔倍率（越小越快）
    headFireMul: 0.62,   // 头部扇形间隔倍率
    headFan: 5           // 头部扇形从 3 发变 5 发
  },

  /* 双蛇（第 9 关压轴）：同一条环路上一正一反游走。
   * 两条蛇各自吃满血条会变成"打不完的墙"，所以把总量按 1.5 条单蛇控制：
   * 头 1250 × 2 = 2500（击杀门槛），节 1040 × 7 是可选的"刷分/削弹幕"开销。
   * 射速单条降 42%（0.15 → 0.26），两条合计 7.7 发/秒，只比原来单条 6.7 高一点；
   * 头扇形 2.1 → 3.2 秒，让玩家有真正的穿行窗口，而不是被两股扇形夹死。 */
  twin: {
    segs: 7,
    headHp: 1250,
    segHp: 1040,
    fireGap: 0.26,
    headFireGap: 3.2,
    speed: 150
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
  maxLives: 10,             // 生命上限（分数奖励与 E 道具共用这个封顶）
  deathDelay: 1.5,          // 被打爆后停这么久再重生（命数归零则进结算页）

  /* ---------------- 3.32 血量制 ----------------
   * 以前"中一发 = 掉一条命"，一颗流弹就能抹掉整局攒的火力；现在机身有独立血量，
   * 挨打先掉血，血掉完才炸机扣命。血量与伤害的换算目标：一架飞机约等于
   * 4 发子弹 / 2.5 次撞机，和旧的"3 条命"总体宽容度接近，但失误不再一刀切。
   * 中弹不再降武器等级（旧逻辑每次中弹全槽各 -1）：4 发子弹就能把满级火力打回 L1，
   * 等于把血量制给的缓冲又抵消掉。等级损失只发生在"飞机被打爆、武器散落"这一刻。 */
  hp: 100,                  // 满血
  /* 受击无敌 1.2 → 1.6（3.34）：血量制下一串子弹会在同一处叠着飞，
   * 1.2 秒常常只够挪开半个身位，玩家感觉"刚挨完又被同一串弹连着扣了两发"。
   * 1.6 秒刚好够横向绕出弹道，又短到不能拿来硬吃弹幕赶路。 */
  hitInvuln: 1.6,           // 单次受伤后的无敌时间
  respawnInvuln: 2.6,       // 重生/换关的无敌，比受伤长，够离开出生点
  bulletDmg: 26,            // 吃一发普通敌弹
  bulletDmgBig: 34,         // 大弹（判定半径 ≥ 9 的那批）
  /* 狙击弹（3.38）：0.62 秒红环蓄力 + 沿发射方向 720px/s 猛加速。
   * 它是全场唯一"瞄着你打、但给了 0.6 秒读招时间"的弹种：躲开是零成本，
   * 站着不动就该疼。所以伤害不能和普通弹一个价（26），否则玩家没有理由
   * 认真横移——这条弹道就退化成一堆普通弹里稍快的那颗。
   * 46 ≈ 普通弹的 1.8 倍：两发 92 几乎见底，第三发才带走——单发秒不掉人，
   * 但挨两发就必须去找 H，代价明显重于普通弹。 */
  snipeDmg: 46,             // 吃一发狙击弹
  ramDmg: 40,               // 撞敌机 / 撞 BOSS 机体
  ramEnemyDmg: 0.7,         // 撞机时敌机吃"自身最大血量的这个比例"（小机当场碎，重装剩三成）
  /* H 道具的回复量：半条血。
   * H 从 3.33 起只回血、不加命——命是"还能再来一次"的通关资源，
   * 一个随手就能捡到的道具直接 +1 会让"活着"这件事失去重量。
   * 半条 ≈ 扛两发普通弹，够玩家把一次失误补回来，不足以抵消一整套弹幕。 */
  healAmount: 50,
  /* P 的附带回血（3.35）：约半发普通弹（26）的一半。
   * P 是全表掉得最多的道具（击破 0.6 权重 + 每关结尾 2 瓶 + BOSS 空投 28%），
   * 一局能捡十几二十瓶，所以这里的量必须压得很低——回血的主力仍应是 H，
   * P 只负责"顺手把擦伤补一点"，让满级之后捡 P 不至于完全不痛不痒。 */
  pHealAmount: 12,

  /* 受击后无敌时间：1.6 → 2.8。
   * 玩家挨枪那一刻往往还站在弹幕里，1.6 秒常常撑不到离开危险区就再次被判定，
   * 手感上像"被同一条弹幕连吃两条命"。2.8 秒足够绕出包围，也不至于让失误无代价。
   * 血量制下这条只给"重生 / 续关"用（见上面 hitInvuln）。 */
  invuln: 2.8,
  bombInvuln: 2.4,          // 放保险后的无敌时间
  bombs: 5,                 // 初始保险（清屏炸弹）数量，重生时恢复到这么多
  maxBombs: 10,             // 保险上限（清屏 + 2.4s 无敌，堆到 20 打起来没有取舍）

  /* 普通保险：向前投掷高爆弹。按下瞬间只给无敌 + 音效，
   * 0.35 秒后落点爆炸：清空全屏敌弹 + 对半径内的敌人高额伤害。
   * 不再是"全屏秒杀"——爆炸圈外的敌人完全不受伤，保险才有站位取舍。 */
  bombThrow: 0.35,          // 投掷到引爆的时间（秒）
  bombVy: -680,             // 出膛初速（向上）
  bombAy: 700,              // 下坠加速度：让轨迹像抛物线，在顶点附近引爆
  bombRadius: 210,          // 爆炸半径（屏幕宽 480，横向约覆盖 88%）
  bombBossDmg: 160,         // BOSS 轮廓被罩住时的固定伤害
  bombSnakeDmg: 180,        // 蛇头只吃这些，避免一颗雷直接删掉整条蛇
  bombSnakeSegDmg: 90,      // 蛇身同理：一颗雷罩住三四节就白赚几千分，必须压低
  bombCd: 0.9,              // 普通保险冷却（从按下算）：比 0.35s 引信长，连点不会在上一颗还在飞时又扔一颗
  /* 判定半径：9 → 6（贴图宽 40，判定直径 12，只有机身的 30%）。
   * 第一版只缩到 7.5，玩家在调试层里量不出区别（18px → 15px），
   * 说明这个量级根本不足以改变手感——要"能擦过去"就得一次缩到位。
   * 子弹判定同步收窄，两者一起缩才不会出现"看着擦过去了却算中"的落差。 */
  hitR: 6,
  startPower: 1,
  /* 火力等级上限 3 → 5。
   * 多出来的两级**不抬高天花板**：L5 的总 DPS 仍按旧版三级封顶（单槽约 70）设计，
   * 只是把 1→满级拆成五段，让前期的每次 P 都能看见一小步。
   * 因此单发伤害逐级下调（枪数在涨、每颗更轻），见 entities.js fireFrom 的伤害表。
   * 升满要多捡两瓶 P，因为 P 掉落没变，实际满级时间点会往后挪半关左右。 */
  maxPower: 5,
  maxOptions: 2,            // 僚机上限（沙罗曼蛇式 Option）
  /* 僚机已满时再吃僚机道具（O / 已在场的 A）的无敌时间：3.5 → 5.5。
   * 冗余道具本来就是"没得选时的安慰奖"，给到 5.5 秒才真能当一次保命用。 */
  optionInvuln: 5.5,

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

/* 敌方子弹的**判定**收缩系数（不影响贴图尺寸）。
 * 子弹画多大是"看清弹幕形状"的需要，判定多大是"擦弹能不能过"的手感，
 * 这两件事本来就该分开：图不变、判定缩到 0.72（小弹 r6 → 4.3），
 * 玩家才敢从弹缝里穿。
 * 统一在 spawnEnemyBullet 里乘一次，避免几十处调用点各改一遍还漏。
 * BOSS 大弹（显式 r 10~14）同样受益，否则"大弹的判定比看起来大一圈"。
 * 0.82 那版实测只差 1px，玩家在调试层里根本看不出来，所以直接压到 0.72。 */
const ENEMY_BULLET_HIT_K = 0.72;

/* ---------------- 武器表 ----------------
 * 9 种武器由道具 W 循环切换，火力等级 P（1~5，见 PLAYER.maxPower）影响弹道数量与伤害
 * cd: 开火间隔（秒）
 */
/* 解锁节奏：**每关 +2 把，第 5 关集齐 9 把**（3.28 起）。
 * 原来每关只开一把、第 8 关才集齐，导致前中期每一关的可选武器只有 2~4 把，
 * 四个槽永远凑不出真正不同的组合，"换枪"这件事就没被玩到。
 * 现在前四关各开两把，第 5 关补上最后一把：第 3 关起池子就有 6 把，
 * 四槽的组合开始有取舍；后半程（6~9 关）用满池 + 掉落加权维持丰富度。
 * 代价是新枪在解锁关的"当关必见"概率被摊薄，所以 W 的权重同步上调（见 DROPS）。 */
const WEAPONS = [
  { id: 'vulcan',  name: 'VULCAN',  cn: '火神炮',   color: '#7fe0ff', cd: 0.100, from: 1 },
  /* 散射炮：一片扇面弹丸，射速刻意放慢（0.34s），靠"覆盖"而不是"持续泼水" */
  { id: 'spread',  name: 'SPREAD',  cn: '散射炮',   color: '#d8ff70', cd: 0.340, from: 1 },
  { id: 'laser',   name: 'LASER',   cn: '穿透激光', color: '#ff6b9d', cd: 0.120, from: 2 },
  { id: 'missile', name: 'MISSILE', cn: '追踪导弹', color: '#8dff9e', cd: 0.360, from: 2 },
  /* --- 中期：开始有"重火力 / 特殊弹道"的分工 --- */
  { id: 'backfire', name: 'BACKFIRE', cn: '逆火炮', color: '#5ce0b8', cd: 0.160, from: 3 },
  { id: 'plasma',  name: 'PLASMA',  cn: '等离子炮', color: '#c08cff', cd: 0.300, from: 3 },
  { id: 'flak',    name: 'FLAK',    cn: '散榴弹',   color: '#ff9a5c', cd: 0.420, from: 4 },
  /* --- 后期：清屏与覆盖 --- */
  { id: 'tesla',   name: 'TESLA',   cn: '电弧炮',   color: '#7dfaff', cd: 0.240, from: 4 },
  { id: 'omni',    name: 'OMNI',    cn: '环射炮',   color: '#ffb3e6', cd: 0.340, from: 5 }
];

/* 武器槽：吃到不同武器会占一个槽，多个槽同时开火
 * 副槽伤害递减，避免叠满后一路碾压。4 槽总输出上限 = 1 + 0.65 + 0.5 + 0.4 = 2.55 倍，
 * 第 4 槽给 0.40 是"再往下降就没人愿意为它花一个槽位"的临界：
 * 一把 0.4 倍的散射炮，实际收益还不如保持 3 槽、把道具让给主武器升级。 */
const WEAPON_SLOTS = 4;
const SLOT_DMG = [1, 0.65, 0.5, 0.4];

/* 散射炮射程（像素）：约 0.40 屏高，按"路径长度"算，不是垂直高度。
 * 它靠齐射铺开覆盖，不是靠打得远；射程拉满会和火神炮的持续压制撞定位，
 * 缩短之后才有取舍：贴脸时一片扇面清场，远处够不着只能靠别的武器补。
 * 单发伤害因此给得比火神炮高（2.6 vs 2），用"近身更痛"换"够不着远处"。 */
const SPREAD_RANGE = VIEW.h * 0.40;

/* ---------------- 全弹发射（OVERDRIVE） ----------------
 * 武器满级后再吃到同一把武器时触发，**形状取当前主武器的**（切枪决定打哪一套）。
 * 参照雷电的满级火力手感：
 *  - 弹数远多于常规射击（常规一轮 3~7 发，这里 24~64 发）
 *  - 单发伤害是普通子弹的 3~4 倍，打在身上"明显更痛"
 *  - 分 2~4 层：外圈快、内圈慢，层间速度差 ≥ 35%，
 *    飞出去会拉开成几圈，玩家一眼能看出这发不一样
 *
 * 每种武器都要有自己的"记忆点"，不能都是同一圈弹换个颜色：
 *   火神炮 双层满环 / 散射炮 前向弹墙 / 激光 前向光矛 / 导弹 螺旋涡流
 *   等离子 慢速大球 / 榴弹 抛射空爆 / 电弧 满环跳弹 / 逆火 前后对开 / 环射 三层铺满
 * 差异化靠三样东西叠加：层几何（arc/aim）、弹体贴图（kind）、结算行为
 * （pierce/homing/boom/chain/fuse）。
 *
 * n=弹数 / sp=初速 / dmg=单发伤害 / r=弹体半径 / rot=整层起始角偏移
 * arc=张角（默认 2π 整圈；小于整圈时两端都落在边界上，不会突然少一发）
 * aim=扇面中心方向（默认 -π/2 正上方）
 * kind=弹体贴图（跟常规射击同款，玩家靠颜色一眼认出是哪把枪）
 *
 * 单发为什么敢给到 6~10：命中面越窄的形态，能落到目标上的弹数越少
 * （整圈只有约 1/6 朝向前方），总伤害按 180~300 控制，不至于一颗雷炸穿 BOSS。
 */
const OVERDRIVE = {
  boostT: 2.6,        // 射速强化持续时间（秒）
  boostMul: 0.55,     // 期间冷却倍率：≈ 射速 ×1.82
  life: 1.5,          // 弹幕存活时间（够飞出屏幕，不会被中途掐断）
  shapes: {
    /* 火神炮：经典双层满环，外快内慢、内圈弹体更粗。
     * 唯一保留"完整一圈"的常规武器形态——它是一切的基准，也是被包围时的保命符。 */
    vulcan: [
      { n: 24, sp: 900, dmg: 7, r: 9, kind: 'player' },
      { n: 17, sp: 520, dmg: 6, r: 11, rot: 0.11, kind: 'player' }
    ],
    /* 散射炮：前向 150° 的三层弹墙，越外越快越宽、越内越慢越密。
     * 和常规的 60° 齐射同一个脾气：不铺满全屏，只把正前方压死。 */
    spread: [
      { n: 24, sp: 900, dmg: 6, r: 8, arc: 2.62, kind: 'spread' },
      { n: 18, sp: 620, dmg: 5, r: 9, arc: 2.10, rot: 0.04, kind: 'spread' },
      { n: 12, sp: 430, dmg: 4, r: 10, arc: 1.50, kind: 'spread' }
    ],
    /* 穿透激光：最窄的扇面（±55°）＋最快弹速＋穿透，三层叠成一束光矛。
     * 弹数最少，但打出去是一条能穿串的直线，和满环形成最强对比。 */
    laser: [
      { n: 10, sp: 1150, dmg: 9, r: 9, arc: 1.90, pierce: true, kind: 'laser' },
      { n: 8, sp: 820, dmg: 8, r: 10, arc: 1.25, rot: 0.05, pierce: true, kind: 'laser' },
      { n: 6, sp: 560, dmg: 7, r: 10, arc: 0.72, pierce: true, kind: 'laser' }
    ],
    /* 追踪导弹：三圈错开的角度 + 逐层变慢变强的追踪，
     * 飞出去是一支旋转的涡流，慢的那圈会拐回来补刀。 */
    missile: [
      { n: 12, sp: 820, dmg: 6, r: 8, homing: 3.2, kind: 'missile' },
      { n: 10, sp: 560, dmg: 6, r: 9, rot: 0.26, homing: 5.0, kind: 'missile' },
      { n: 8, sp: 360, dmg: 7, r: 9, rot: 0.52, homing: 7.0, kind: 'missile' }
    ],
    /* 等离子炮：最少的层数、最慢的弹速、最大的弹体，每颗命中都炸开。
     * 打出去像两颗行星炸开，靠范围和爆炸而不是弹数。 */
    plasma: [
      { n: 14, sp: 700, dmg: 10, r: 13, boom: { r: 58, dmg: 5 }, kind: 'plasma' },
      { n: 10, sp: 420, dmg: 9, r: 14, rot: 0.20, boom: { r: 50, dmg: 4 }, kind: 'plasma' }
    ],
    /* 散榴弹：前向扇面抛出去，**不撞也炸**——定时引信在敌阵上空开火。
     * 两层的引信错开 0.22 秒，前一片破片还没散完第二片就到，
     * 覆盖感是靠"延时"做出来的，不是靠弹数（所以只有 24 发）。 */
    flak: [
      { n: 14, sp: 720, dmg: 6, r: 9, arc: 2.44, fuse: 0.50, kind: 'flak' },
      { n: 10, sp: 500, dmg: 6, r: 10, arc: 1.70, rot: 0.05, fuse: 0.72, kind: 'flak' }
    ],
    /* 电弧炮：满环 + 高跳数，一颗弹能顺着敌阵连 3 个 */
    tesla: [
      { n: 18, sp: 820, dmg: 6, r: 8, chain: 3, kind: 'tesla' },
      { n: 14, sp: 500, dmg: 6, r: 9, rot: 0.13, chain: 2, kind: 'tesla' }
    ],
    /* 逆火炮：**前后对开**，上下各两三层，左右两侧留空。
     * 形状本身就是这把枪的性格：前面压 BOSS，后面顺手清爬上来 / 掠过机尾的敌机。 */
    backfire: [
      { n: 16, sp: 900, dmg: 7, r: 9, arc: 2.20, kind: 'backfire' },
      { n: 12, sp: 560, dmg: 6, r: 10, arc: 1.50, rot: 0.05, kind: 'backfire' },
      { n: 10, sp: 700, dmg: 6, r: 8, arc: 1.60, aim: Math.PI / 2, kind: 'backfire' },
      { n: 8, sp: 470, dmg: 6, r: 9, arc: 1.00, aim: Math.PI / 2, rot: 0.05, kind: 'backfire' }
    ],
    /* 环射炮：本来就以"全方位"立命，全弹发射直接三层铺满，弹数全场第一（64 发） */
    omni: [
      { n: 30, sp: 780, dmg: 6, r: 8, kind: 'omni' },
      { n: 22, sp: 500, dmg: 5, r: 9, rot: 0.09, kind: 'omni' },
      { n: 12, sp: 330, dmg: 5, r: 10, rot: 0.21, kind: 'omni' }
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

/** 掉落 / 补给里"这一瓶是哪把枪"的加权抽取。
 *  纯随机会让解锁失去意义：第 5 关武器池 9 把，刚解锁的环射炮只有 1/9 概率，
 *  一整关可能一次都见不到。权重按三档：
 *    本关新解锁 ×6  未拥有 ×3  已拥有 ×2
 *  既保证新枪在解锁关露脸，也不至于把玩家用顺手的枪彻底挤掉。
 *  「已拥有」从 ×1 提到 ×2：同款 W 现在会给那把枪单独 +1 级（见 Player.addWeapon），
 *  它是"专精一把枪"的唯一手段，权重太低这条成长线就等于不存在。 */
function pickWeaponIdx(stageId, owned) {
  const pool = unlockedWeapons(stageId);
  const own = owned || [];
  const w = pool.map(i => {
    if ((WEAPONS[i].from || 1) === stageId) return 6;
    return own.indexOf(i) >= 0 ? 2 : 3;
  });
  let total = 0;
  for (const k of w) total += k;
  let r = Math.random() * total;
  for (let j = 0; j < pool.length; j++) {
    r -= w[j];
    if (r <= 0) return pool[j];
  }
  return pool[pool.length - 1];
}

/** 精英率随关卡上升：第 1 关 4%，第 9 关 21%（原 5%~16%）。
 *  精英是"同一套机型、更高强度"的加压手段，越往后越该多；
 *  3.28 把斜率从 0.0125 提到 0.021：后期同屏经常同时挂着两只精英，
 *  它们 3.2 倍血 + 掉一份高价值道具（3.29.1 之前是双掉落，道具刷得太凶），
 *  是整个难度曲线里最直接的一档台阶。
 *  前期仍压得低——第 1 关就满屏精英会把"认机型"这件事盖掉。 */
function eliteChance(stageId) {
  return clamp(0.04 + (stageId - 1) * 0.021, 0.04, 0.21);
}

/* 续关：死亡后进入限时续关窗口，最多续 3 次 */
const CONTINUE = {
  max: 3,          // 一局内最多续关次数
  window: 9,       // 每次续关倒计时（秒）
  lives: 3,        // 续关后恢复的命数
  invuln: 3.4      // 续关后的无敌时间
};

/* 精英变体：中小型机有概率强化出场，血厚、体积大、掉落好。
 * 概率随关卡上升，见下面的 eliteChance()——固定 9% 会让前期资源过富、
 * 后期又嫌不够，这两个方向都不对。 */
const ELITE_KINDS = ['scout', 'fighter', 'diver', 'drone', 'flame', 'mirror', 'eel', 'torpedo'];
const ELITE_HP_MUL = 3.2;

/* 波次压缩系数：只放大数量不够，出场节奏不加快的话玩家会把它们逐个点掉
 * at 整体提前 15%，同一波内每架之间的间隔缩短 25%
 */
const WAVE_TUNE = { timeScale: 0.80, gapScale: 0.68 };

/* ---------------- 临时增益（吃到即生效，到时间自动消失） ----------------
 * 和武器槽的根本区别：**不占槽位、不吃 SLOT_DMG、不跨关保留**。
 * 定位是"短时改变打法"而不是"永久变强"——护盾让玩家敢往前压，
 * 宽头弹让玩家敢贴着弹幕打，追踪弹补单体输出，临时僚机补交叉火力。
 * 四者都带时限，所以不会把长期平衡拉偏，可以在关卡里放开掉。
 */
const TEMP = {
  /* 3.36 统一拉长了所有临时增益的持续时间（护盾 30→42、追踪 14→22、
   * 宽头 14→22、僚机 20→30）。理由是这些道具的"爽点"全在效果本身，
   * 而旧时长刚好卡在"刚发现自己在用、它就到点了"的位置：
   * 追踪弹一轮 14 秒只够打两三个编队，玩家记住的是"我捡了它，然后它没了"。
   * 拉长之后一件道具能覆盖一整段波次节奏（约 2~3 个编队 + 一次小 BOSS），
   * "这一关怎么打"的差别才真的能被感知到。 */
  /* 护盾：机头前方一块椭圆光罩，只吃子弹不吃撞机。
   * hp 按"颗"算而不是按伤害：子弹伤害 1~3 差异大，按伤害算会让
   * 高伤弹幕（BOSS 散射）几发就碎，玩家根本看不出护盾存在过。 */
  shield: {
    dur: 42,        // 持续时间（秒）
    hp: 30,         // 可挡子弹数
    rx: 30,         // 判定椭圆半径（横向）
    ry: 25,         // 判定椭圆半径（纵向）
    /* 护盾中心相对机身的抬高。半椭圆的截口就画在中心高度上，
     * 34 让截口离机头 14px：再高就像一块悬空的拱门，贴到机头又像顶了块牌子。 */
    oy: 34,
    /* 挡弹抖动：护盾每挡下一发，"盾面"自身左右抖一下（jit 秒内衰减到 0）。
     * 只抖盾、不抖飞机——飞机抖会让人以为自己在被弹幕推着走。
     * amp 3.2px / 0.16s 是"看得见但不会误读成受伤"的量级。 */
    jit: 0.16,
    jitAmp: 3.2
  },
  /* 高爆追踪弹：临时武器，自动开火，命中炸开。
   * 追踪速率 5.2 rad/s 比导弹武器（5.5）略低：这是"额外火力"，不该比专门
   * 玩追踪的导弹还灵，否则拿到它就没有换武器的理由。 */
  track: {
    dur: 22, cd: 0.62, dmg: 7, sp: 430, r: 13,
    homing: 5.2, boomR: 38, boomDmg: 3
  },
  /* 宽头弹：巨弹，沿途吸掉敌方子弹。
   * 射速 0.26s、单发只有 3 伤害——它的价值在"开路"，不在输出。 */
  wide: {
    dur: 22, cd: 0.26, dmg: 3, sp: 940, r: 17
  },
  /* 雷电（3.36）：和电弧炮同样是链式，但打法完全相反——
   * 电弧炮是"朝前打、打到谁算谁"，雷电是"先看周围有没有目标，有才落雷"，
   * 所以它不会像枪一样持续输出，而是"范围内有威胁就放电"——
   * 被包围时一串电弧能扫掉半个编队，屏幕空着的时候完全静默。
   *
   * range 是"第一次落雷的搜索半径"，按**玩家站位**算，不是按屏幕。
   * 这个数只能实测定：玩家守在屏幕底部，敌机巡航位在上半屏，常态距离 450~650，
   * 215 / 360 / 480 分别只落 1 / 6 / 8 次（8 秒），玩家会直接判定"这道具坏了"。
   * 560 能勾到主力编队、又够不到最顶端的零散单位（8 秒约 10 次、30+ 段电弧），
   * 读起来仍是"身边有威胁才炸"，而不是"全屏自动清怪"。
   * jumpR 是后续传递的距离（比首跳略小，链要一截一截递出去）。
   * hops 4 跳、每跳 -1.2，一串满打约 34 伤害，略低于满级电弧炮的持续输出——
   * 它是"临时"的，不能盖过正式武器。
   * cd 0.42 比电弧炮的 0.24 慢：一次落雷打一片，频率再高就变成自动清屏。 */
  thunder: {
    dur: 26, cd: 0.42, range: 560, jumpR: 190,
    dmg: 10, hops: 4, falloff: 1.2, minDmg: 3,
    color: 'rgba(198,162,255,0.95)',
    retry: 0.08       // 周围没敌人时的重试间隔：敌人一进圈就立刻落雷
  },
  /* 临时僚机：跟在机身正下方，主槽同款弹道、火力 0.6 倍 */
  ally: {
    dur: 30, mul: 0.6, powMax: 2, oy: 46
  }
};

/* 临时增益的提示文案：吃到时弹一次（复用武器提示位），到期再报一次。
 * 时间一律读 TEMP 的 dur，不再手写死——3.36 调时长时就是靠这条避免文案和实际不符。 */
const TEMP_INFO = {
  shield: { title: 'SHIELD',  sub: '护盾 · ' + TEMP.shield.dur + 's · 挡前方子弹 ' + TEMP.shield.hp + ' 发', color: '#9fe8ff' },
  track:  { title: 'TRACKER', sub: '高爆追踪弹 · ' + TEMP.track.dur + 's（不占武器槽）', color: '#ffa060' },
  wide:   { title: 'WIDE',    sub: '宽头弹 · ' + TEMP.wide.dur + 's · 途经敌方子弹一并吞掉', color: '#7bffcf' },
  ally:   { title: 'ALLY',    sub: '临时僚机 · ' + TEMP.ally.dur + 's · 重复吃补无敌', color: '#c9b0ff' },
  thunder:{ title: 'THUNDER', sub: '雷电 · ' + TEMP.thunder.dur + 's · 周围有敌才落雷，会传递', color: '#c6a2ff' }
};

/* 掉落权重（按关卡解锁）
 * from : 从第几关开始掉。前两关只留"火力 / 换枪 / 保险 / 回血"四条主线——
 *        玩家这时还在学走位，护盾、宽头弹这种"改变打法"的道具会盖住基础课，
 *        而且一上来就塞四件临时增益，等于没有一件能被记住。
 * w    : 权重，口径就是百分数（本关全部生效条目相加 = 总掉率）
 *
 * 设计取舍：击破掉落**不是**火力成长的主渠道，只管"打到的东西有点反馈"。
 * 3.29.1 之前这里有个换算 bug（见 dropTable），实际是 100% 掉 P；
 * 修好之后按"一个 4~8 架的编队掉 1~2 件"定总掉率：12% → 20%。
 *
 * P 的权重要**明显低于** W/B/H：4 瓶 P 就能把四把枪从 L1 顶到 L5，
 * 它是全表单位价值最高的条目，给成常客会让 5 级系统在半关内走完。
 */
const DROPS = [
  { kind: 'P', w: 0.6, from: 1 },   // 火力 +1（全槽）——最稀有：一瓶顶四瓶其他道具
  /* W 权重 6.0 → 3.0：3.29 之前它是"换枪 + 单枪升级"的唯一入口，给第一梯队；
   * 但实战里 W 和 P 一起把火力线喂得太快，编队还没成形就清空了。
   * 现在把这两条压下去，省出来的份额给临时增益（S/T/D/A）——
   * 那些是"这一关怎么打"的变化，不是"数值一直往上爬"。 */
  { kind: 'W', w: 3.0, from: 1 },   // 换武器 / 同款升级
  { kind: 'B', w: 2.6, from: 1 },   // 保险 +1
  /* 3.33：H 从"生命 +1"改为"回血（半条）"。
   * 命现在是稀缺资源（只来自分数奖励 + 极稀有的 E），所以 H 不再需要压到最低权重——
   * 它是"这一局还撑得住"的补给，不是"多一条命"。 */
  { kind: 'H', w: 1.8, from: 1 },   // 回血 +50
  /* 加命道具：全表最稀有，一整局平均只掉一件左右（0.05 / 22.25 ≈ 单次掉落里 0.2%）。
   * 第 3 关才解锁：前两关是教学段，那时候送命等于替玩家把"别撞弹"这课划掉。 */
  { kind: 'E', w: 0.05, from: 3 },  // 加命 +1（1UP）
  { kind: 'O', w: 1.8, from: 3 },   // 僚机 +1
  { kind: 'R', w: 2.2, from: 3 },   // 环绕机 +1
  { kind: 'L', w: 1.2, from: 5 },   // 激光保险 +1
  /* --- 临时增益：掉率最低的常驻条目之外，四条主力全部上调 ---
   * 解锁关整体提前两档（S 3 / T 4 / D 5 / A 6），
   * 否则前五六关只有 P/W/B/H，玩家感觉不到"打过的东西在变"。 */
  { kind: 'S', w: 2.4, from: 3 },   // 护盾（42s）
  { kind: 'T', w: 2.2, from: 4 },   // 高爆追踪弹（22s）
  { kind: 'D', w: 2.2, from: 5 },   // 宽头弹（22s）
  /* 雷电（3.36）：第 5 关起和宽头弹同档。
   * 前四关的道具位已经很挤（P/W/B/H + 三种临时增益），再早塞第五种，
   * 玩家一件都记不住；第 5 关起敌人开始成编队包夹，它的价值才显出来。 */
  { kind: 'Z', w: 2.2, from: 5 },   // 雷电（26s）
  { kind: 'A', w: 2.2, from: 6 }    // 临时僚机（30s）
];

/** 临时增益的解锁关：BOSS 空投 / 四周补给按它过滤，
 *  避免在第 3 关就空投一件"这一关根本不该出现"的宽头弹 */
const TEMP_FROM = { S: 3, T: 4, D: 5, Z: 5, A: 6 };

/** 按关卡过滤后的累计区间表。
 *  w 的口径是**百分数**（本关生效条目相加 = 总掉率，12.2 表示 12.2%），
 *  这里统一折成 0~1 的概率，调用方直接拿 Math.random() 比即可。
 *
 *  【3.29.1 修的坑】之前这里把百分数原样当概率返回（upto 直接是 3.0 / 12.2），
 *  而判定写的是 `Math.random() < d.upto`——随机数永远小于 3.0，
 *  于是"每一次击破都命中区间表的第一条"，也就是**每架敌机必掉一瓶 P**。
 *  表现就是满屏都是火力道具、两关全槽满级。百分数与本位概率必须只在一处换算。
 */
function dropTable(stageId) {
  const out = [];
  let acc = 0;
  for (const d of DROPS) {
    if ((d.from || 1) > stageId) continue;
    acc += d.w;
    out.push({ kind: d.kind, upto: acc / 100 });
  }
  return out;
}

/* ---------------- 四周补给 ----------------
 * 击破掉落压下来之后，道具的"底盘"由这里承担：每隔 edgeSupplyGap() 秒，
 * 从上下左右四条边随机挑一条送一份进场（左右两条边是横穿屏幕，见 Pickup.dirX）。
 *
 * 3.30：W / P 各砍一档，省下来的预算全给临时增益——
 * 这条路每关能送 6~10 份，是"临时道具出现频率"最有效的旋钮，
 * 而且它不参与击破掉落，调它不会连带改变"打爆一架掉什么"的手感。
 */
const EDGE_SUPPLY = [
  { kind: 'W', w: 2.6, from: 1 },
  { kind: 'P', w: 0.7, from: 1 },
  { kind: 'B', w: 2.2, from: 1 },
  { kind: 'H', w: 1.3, from: 1 },
  /* 四周补给里的加命：同样压到几乎看不见（≈ 每 40~50 份里才有一份） */
  { kind: 'E', w: 0.08, from: 3 },
  { kind: 'S', w: 2.2, from: 3 },
  { kind: 'O', w: 1.6, from: 4 },
  { kind: 'R', w: 1.8, from: 5 },
  { kind: 'T', w: 1.8, from: 4 },
  { kind: 'D', w: 1.8, from: 5 },
  { kind: 'Z', w: 1.8, from: 5 },
  { kind: 'A', w: 1.8, from: 6 }
];

/** 间隔随关卡收紧：13s → 7.4s。后期敌人多、屏幕挤，道具得来得更勤才追得上消耗 */
function edgeSupplyGap(stageId) {
  return clamp(13 - stageId * 0.7, 7.4, 13);
}

/** 抽这一份四周补给是什么（按关卡过滤权重） */
function pickEdgeSupply(stageId) {
  const pool = EDGE_SUPPLY.filter(d => (d.from || 1) <= stageId);
  let sum = 0;
  for (const d of pool) sum += d.w;
  let r = Math.random() * sum;
  for (const d of pool) {
    r -= d.w;
    if (r <= 0) return d.kind;
  }
  return pool[pool.length - 1].kind;
}

const SCORE = { pickup: 50, bossKill: 5000, stageClear: 2000, bombKill: 60 };

/* 分数奖励命（1UP）
 * 街机老规矩：攒够一档分数送一条命。这个口径是按实战分数量出来的——
 * 一整局全清约 60 万分，单关 6~11 万分（见 tools/balance_sim.py 的击杀量 × 机种分值）。
 * first 25000 落在第 1 关后段（第一次"我快打完了，再给我一次机会"的时机），
 * step 75000 ≈ 之后每关一条，后期死亡成本更高时补给也更密。
 *
 * 和道具的分工：H 只回血，命只有两条来源——这里（确定性、可预期）
 * 与 E 道具（极稀有、意外之喜）。分数是"打得好就该活得久"的唯一通路。 */
const SCORE_1UP = { first: 25000, step: 75000 };

/* 最高分持久化：只存在本机（localStorage），没有后端。
 * 键名带 -v1，将来换了计分口径可以直接改键、不用写迁移。 */
const HI_KEY = 'raiden-lite.hi.v1';

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

  /* 棱镜机：正面一张偏折面，把玩家子弹**拨偏**而不是吃掉。
   * 子弹始终是玩家的，被拨出去之后还能打到旁边的敌机——所以它的价值是
   * "保护身后的编队"，不是自己无敌。偏折面按"能拨几发"算耐久：
   * cap 14 发打空 → 过载 2.2 秒真实受击 → 自动充能。
   * 这带来一个明确的取舍：单点持续射击是"钝刀割肉"，齐射是一刀破盾。
   * arc 是护盾张角（±44°），从正下方斜着打进来（>44°）完全不吃偏折，
   * 所以"绕到侧面打"这条路必须留着，否则就只是换了个皮的无敌怪。 */
  deflect:   { sprite: 'e_mirror',    hp: 52,  speed: 50,  score: 640, r: 0.74, ai: 'straight',
               scale: 1.25,
               deflect: { aim: Math.PI / 2, arc: 1.54, cap: 14, down: 2.2, bend: 1.15 } },

  /* 狙击机：细长机身，飞得慢、血不厚，但会打"慢起快收"的狙击弹。
   * 发弹间隔 3.6 秒——它是气氛单位，不是弹幕单位。 */
  sniper:    { sprite: 'e_torpedo',   hp: 26,  speed: 60,  score: 520, r: 0.66, ai: 'sniper',
               fire: 3.6, scale: 1.22 },

  /* --- 小 BOSS 变体：都是 ai:'miniboss'（同一条"升起 → 巡游"宿主流程），
   * 差异在 mb 字段决定的开火/机动方式。这样不用复制三遍爬升与血条逻辑。 --- */
  // 狙击手：巡游时每 5.6 秒打一发狙击弹（频率必须低，否则整屏都是加速弹）
  mbSniper:  { sprite: 'e_torpedo',   hp: 380, speed: 58,  score: 2600, r: 0.72, ai: 'miniboss',
               fire: 5.6, scale: 2.15, mb: 'sniper' },
  // 棱镜：整块偏折面（±59°、26 发、过载 3.2 秒），正面硬顶，必须靠齐射破盾或绕后
  mbPrism:   { sprite: 'e_shield',    hp: 520, speed: 56,  score: 2800, r: 0.74, ai: 'miniboss',
               fire: 2.1, scale: 1.95, mb: 'prism',
               deflect: { aim: Math.PI / 2, arc: 2.06, cap: 26, down: 3.2, bend: 1.05 } },
  // 冲角：巡游 → 锁定（0.7s 红色预警线）→ 高速俯冲穿过玩家 → 爬回原位
  mbRam:     { sprite: 'e_diver',     hp: 340, speed: 60,  score: 2600, r: 0.72, ai: 'miniboss',
               fire: 4.8, scale: 1.98, mb: 'ram' },

  /* 蛇形小 BOSS 的部件：不走自己的 AI，位置由 game._updateSnake 沿路径写入。
   * 复用 Enemy 是为了白嫖碰撞、受击闪白、死亡结算；绘制由 game._drawSnake 统一画，
   * 所以这里的 sprite 只用来取一个尺寸基准，实际不绘制。
   *
   * 分账（3.31）：头 2800 / 每节 1000。8 节全啃干净 = 8000，比直接爆头多 2.9 倍；
   * 但一节 860 血、要压着一节打五六秒，还得顶着暴走后的加强弹幕——
   * "贪身体"必须是玩家自己算过账的选择，不是白送。 */
  snakeHead: { sprite: 'e_heavy',     hp: 1000, speed: 0,   score: 2800, r: 0.9, ai: 'snake' },
  snakeBody: { sprite: 'e_mine',      hp: 860,  speed: 0,   score: 1000, r: 0.9, ai: 'snake' }
};

/* 分裂体：第 8 关 BOSS 分裂出来的分身，用 BOSS 精灵的小号版本 */
ENEMY_DEFS.splitling = {
  sprite: 'boss8', hp: 420, speed: 0, score: 2800, r: 0.62,
  ai: 'miniboss', fire: 2.2, scale: 0.58
};

/* 小 BOSS 全家桶：因为 ai 全都是 'miniboss'（共用爬升/巡游/血条），
 * 凡是"按机型判断是不是小 BOSS"的地方都必须走这个列表，否则新变体会被当成杂兵：
 * 波次密度加成、车道分配、收尾段判定、击破补给。
 * 这几个点踩一次就会出"3 只变 6 只""小 BOSS 死了却不算清空"之类的怪问题。 */
const MINI_KINDS = ['miniboss', 'mbSniper', 'mbPrism', 'mbRam'];
const isMiniKind = k => MINI_KINDS.indexOf(k) >= 0;

/* 会从屏幕底部出现、需要提前警示的单位 */
const BOTTOM_SPAWN = ['riser', 'miniboss', 'mbSniper', 'mbPrism', 'mbRam'];

/* 登场保护（秒）：只对从底部升起的单位生效，其余敌机出生即可打。
 * 作用仅仅是"别在还没冒出屏幕边缘时就白挨打"，所以只覆盖爬升那一段。
 * 之前两种单位统一 2.8 秒：riser 冒出底边约需 1.0 秒，剩下近 1.8 秒
 * 是露在画面里却打不动的，手感像子弹白打；miniboss 爬得快（220px/s），
 * 0.6 秒就露头，2.8 秒甚至能把整段爬升都罩住。
 */
const SPAWN_GUARD = {
  riser: 1.15,      // 冒出底边 1.0 秒 + 0.15 秒缓冲
  miniboss: 1.30,   // 冒出底边 0.6 秒，多留 0.7 秒避免刚露头就被爆发掉
  mbSniper: 1.30,
  mbPrism: 1.45,    // 棱镜血最厚，多给 0.15 秒避免刚露头就被齐射压穿护盾再打死
  mbRam: 1.30
};

/* 入场保护：整只（含贴图）还没进入可活动区时免疫，进入后再给 buf 秒缓冲。
 * 起因是满配火力下"编队还没露头就被打散"——子弹一路飞到 y=-48 就结算，
 * 玩家只看到一串道具飘下来，看不到编队、也看不到它们开火。
 * 保护期内子弹**穿过**而不是被吃掉（见 game._updateBullets），所以不会变成"白打"。
 *
 * buf 按"露出速度与体型"分档：小快机几乎不需要，大慢机要长一点，
 * 从底部升起的（riser / 小 BOSS）已经有 SPAWN_GUARD 覆盖同一段时间，不再叠加。
 * max 是兜底：横穿/绕边的单位可能永远不满足"完全进入"，不能因此永久无敌。 */
const ENTRY_GUARD = {
  max: 3.0,
  def: 0.12,
  buf: {
    scout: 0.06, fighter: 0.06, diver: 0.08, drone: 0.06,
    kamikaze: 0.06, formation: 0.08, mine: 0.10, mineH: 0.10,
    torpedo: 0.12, eel: 0.14, flame: 0.12, mirror: 0.14, looper: 0,
    heavy: 0.22, bomber: 0.20, jelly: 0.18, shield: 0.22, deflect: 0.22,
    riser: 0, miniboss: 0, mbSniper: 0, mbPrism: 0, mbRam: 0,
    splitling: 0.15
  }
};

/* 出场护盾：给"有信息量、值得看清"的中型机和小 BOSS 罩一层限时能量盾。
 *
 * 和 ENTRY_GUARD 分工不同：入场保护管"贴图还没露出来"，护盾管"露出来之后
 * 至少还有一段可读时间"。后者是必要的——满配火力下，中型机刚进画面
 * 一轮连珠就没了，玩家记不住它长什么样、更看不到它开火。
 *
 * 两个条件谁先到都算结束：**血打空** 或 **时间到**。
 * 时间上限不是为了公平，而是为了不让后期"护盾变成纯血量"：
 * 玩家火力溢出时，护盾最多拖住 dur 秒，收尾速度不会被无限拖慢。
 *
 * hp 按"后期能吃半秒多、前期能吃一两秒"定，不是按本体血量的百分比——
 * 同一份配置在前后期读作"前期一道坎、后期一层纸"，正是想要的曲线。
 * 护盾期只吸收伤害、不让本体掉血，所以它挡的是"爆发"，不是"推进"。 */
const ENEMY_SHIELD = {
  /* 中型机：血条本来就短，护盾是唯一的"露头缓冲"。
   * 持续时间按体型给——大慢机在画面里待得久，小快机给长了会显得黏。 */
  bomber:  { hp: 32, dur: 4.0 },
  jelly:   { hp: 32, dur: 4.0 },
  eel:     { hp: 28, dur: 3.6 },
  flame:   { hp: 28, dur: 3.6 },
  mirror:  { hp: 30, dur: 3.8 },
  sniper:  { hp: 34, dur: 4.2 },
  mineH:   { hp: 32, dur: 4.0 },
  /* 重装：本体就厚，护盾只补"刚露头那一下"，量给大但相对本体仍是一小截 */
  heavy:   { hp: 80, dur: 5.5 },
  /* 坦型 / 棱镜：本身已经各有一套减伤和偏折，护盾刻意压薄，
   * 否则三种防御叠起来会变成"打不动的墙"，那就不是可读了而是烦。 */
  shield:  { hp: 36, dur: 4.0 },
  deflect: { hp: 32, dur: 4.0 },
  /* 小 BOSS：护盾期要够它完成"升起 → 转向 → 打出第一轮"。
   * 180 血在满配火力下约 2.5 秒，前期第一台小 BOSS（第 3 关）约 5 秒，
   * 正好落在"看得清它在干什么、又不至于打不动"的区间。 */
  miniboss: { hp: 140, dur: 7.0 },
  mbSniper: { hp: 150, dur: 7.0 },
  mbPrism:  { hp: 150, dur: 7.0 },
  mbRam:    { hp: 140, dur: 7.0 }
};

/* 护盾按关卡打折：上面的 hp 是"第 9 关满配玩家"的基准值。
 * 全关用同一个数会两头不讨好——第 1 关玩家只有一把 L1 枪（约 14 DPS），
 * 45 血盾要打三秒，实测漏怪率从 0% 直接顶到 20%（新手关直接劝退）；
 * 反之第 7 关以后满配 90 DPS，45 血不到半秒，护盾等于不存在。
 * 所以按关卡线性放大：前期是"看清"的缓冲，后期才是"抗一轮爆发"的硬壳。
 * 改这里要连带跑 balance_sim 的"下限 Lv1 单槽"那一组，它是最敏感的压力测试。 */
ENEMY_SHIELD.scale = [0.34, 0.40, 0.48, 0.58, 0.70, 0.80, 0.90, 0.96, 1.0];
const shieldMul = id => ENEMY_SHIELD.scale[Math.max(0, Math.min(8, (id || 9) - 1))];


/* ---------------- 关卡 ----------------
 * density       : 非小 BOSS 波次的数量倍率。3.28 起从 1.30 阶梯拉到 2.78
 *                 （原 1.35~2.00）。前四关只微调，第 5 关起每关跳一档，
 *                 让"后期明显更挤"成为曲线的主体，而不是靠血量慢慢堆。
 * bossHp        : BOSS 血量。3.28 起后四关各上调 15~25%，配合 bossRate。
 * bossRate      : BOSS 弹幕间隔倍率（乘在 pattern 返回值上）。1.0 = 原速，
 *                 0.84 = 出招快 19%。只给第 5 关以后，前期不给。
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
    density: 1.30,
    boss: 'boss1',
    bossName: '苍鹰母舰',
    support: 'fighter',
    bossHp: 2200,
    hint: '编队俯冲 · 侧向来袭',
    // 云端哨戒：云层气流把补给往上托，主流仍是自上飘下，第 3 份落到底边被弹回去
    supply: [
      { at: 6,  kind: 'P', from: 'top' },
      { at: 12, kind: 'W', from: 'rise' },
      { at: 19, kind: 'P', from: 'bounce' },
      { at: 24, kind: 'B', from: 'rise' }
    ],
    /* 教学关：全场只有 3 种机型，节奏是"单排出场 → V 字 → 侧向 → 慢速重装"。
     * 一架 bomber 要打 1.5 秒才碎，是玩家第一次体验"打不死的东西"；
     * 放在第 15 秒而不是开场，先让 scout 把射击手感立住。 */
    waves: [
      { at: 1.5,  kind: 'scout',   n: 4,  form: 'line',    speed: 112, gap: 0.16 },
      { at: 5.5,  kind: 'scout',   n: 5,  form: 'vee',     speed: 118, gap: 0.14 },
      { at: 9.0,  kind: 'fighter', n: 3,  form: 'line',    speed: 95,  gap: 0.36 },
      { at: 12.5, kind: 'scout',   n: 4,  side: 'left',   gap: 0.14 },   // 教学：第一次见到侧向来敌
      { at: 15.5, kind: 'bomber',  n: 2,  form: 'sides',   speed: 64,  gap: 0.7 },
      { at: 19.0, kind: 'scout',   n: 7,  form: 'arc',     speed: 126, gap: 0.11 },
      /* 第二次侧向：换成 fighter（会开火的机型），第一次只教"它们会从旁边来"，
       * 这一次教"从旁边来的东西也会朝你打"。3.31 起每关都补一条侧向波。 */
      { at: 20.7, kind: 'fighter', n: 3,  side: 'right',  gap: 0.34 },
      { at: 22.5, kind: 'fighter', n: 4,  form: 'vee',     speed: 100, gap: 0.30 },
      { at: 25.5, kind: 'bomber',  n: 2,  form: 'line',    speed: 68,  gap: 0.6 },
      { at: 27.0, kind: 'scout',   n: 8,  form: 'diamond', speed: 132, gap: 0.10 }
    ]
  },
  {
    id: 2,
    name: '黄昏峡谷',
    sub: 'STAGE 2 · DUSK CANYON',
    bg: 'bg2',
    accent: '#ffb066',
    density: 1.40,
    boss: 'boss2',
    bossName: '岩甲巨蟹',
    support: null,
    bossHp: 2800,
    hint: '俯冲机 · 浮雷',
    // 黄昏峡谷：峡谷热风横着刮，道具一路摆着下来；落底的会被风托回一段
    supply: [
      { at: 6,  kind: 'P', from: 'top', sway: 34 },
      { at: 13, kind: 'W', from: 'bounce', sway: 30 },
      { at: 21, kind: 'P', from: 'rise', sway: 40 },
      { at: 27, kind: 'H', from: 'top' },
      { ev: 'miniboss', delay: 1.4, kind: 'P', from: 'bounce' }
    ],
    /* 本关只教三件事：俯冲机的落点、编队机的密度、浮雷"打爆会溅射"。
     * 单只小 BOSS 放在最后 2 秒——它是第一个小 BOSS，必须单独出场，
     * 让玩家专心看清"从底部升起 → 顶部巡游 → 三向散射"这套流程，
     * 而不是像原来那样和 mbSniper 同时压上来（那时两种弹幕混在一起没法读）。 */
    waves: [
      { at: 1.5,  kind: 'diver',     n: 4, form: 'line',   speed: 78,  gap: 0.32 },
      { at: 5.0,  kind: 'formation', n: 5, form: 'vee',    speed: 108, gap: 0.15 },
      { at: 8.5,  kind: 'diver',     n: 4, form: 'sides',  speed: 88,  gap: 0.26 },
      { at: 12.0, kind: 'mine',      n: 3, form: 'arc',    speed: 40,  gap: 0.46 },
      { at: 15.5, kind: 'formation', n: 5, form: 'arc',    speed: 112, gap: 0.13 },
      { at: 18.5, kind: 'diver',     n: 4, side: 'right', gap: 0.15 },   // 从右侧切入后俯冲
      { at: 21.5, kind: 'mine',      n: 4, form: 'line',   speed: 44,  gap: 0.42 },
      { at: 24.5, kind: 'formation', n: 6, form: 'wave',   speed: 114, gap: 0.12 },
      { at: 26.2, kind: 'formation', n: 4, side: 'left',  gap: 0.16 },   // 侧向夹击：跟正面那排形成十字
      { at: 27.5, kind: 'diver',     n: 5, form: 'pincer', speed: 94,  gap: 0.24 },
      { at: 29.5, kind: 'miniboss',  n: 1, form: 'line',   speed: 58,  gap: 0.5, lane: 0.5 }
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
    hint: '高速鱼雷 · 电鳗摆尾',
    // 深海要塞：洋流慢，补给从深处浮上来；落到要塞底部会反弹
    supply: [
      { at: 6,  kind: 'P', from: 'rise', speed: 62 },
      { at: 13, kind: 'W', from: 'rise', speed: 62, sway: 22 },
      { at: 21, kind: 'P', from: 'bounce' },
      { at: 28, kind: 'B', from: 'riseBounce', sway: 24 },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'rise' }
    ],
    /* 本关两个新单位刚好是一对反义词：torpedo 快、脆、直线；
     * eel 慢、会潜到下方再窜上来、身体分段。所以段落也按"一快一慢"交替编，
     * 让玩家在两种节奏之间切换，而不是被同一种东西反复碾。 */
    waves: [
      { at: 1.5,  kind: 'torpedo', n: 4, form: 'column', speed: 250, gap: 0.30 },
      { at: 5.0,  kind: 'eel',     n: 3, form: 'line',   speed: 84,  gap: 0.44 },
      { at: 8.5,  kind: 'torpedo', n: 6, form: 'sides',  speed: 272, gap: 0.22 },
      { at: 12.0, kind: 'eel',     n: 4, form: 'arc',    speed: 88,  gap: 0.36 },
      { at: 15.5, kind: 'torpedo', n: 6, side: 'left',  gap: 0.16 },   // 高速从左侧掠过
      { at: 19.0, kind: 'eel',     n: 5, form: 'sides',  speed: 92,  gap: 0.32 },
      { at: 22.5, kind: 'torpedo', n: 7, form: 'column', speed: 288, gap: 0.18 },
      { at: 24.0, kind: 'eel',     n: 3, side: 'right', gap: 0.34 },   // 侧向游入后照旧潜到底再窜上来
      { at: 26.0, kind: 'eel',     n: 5, form: 'diamond', speed: 90, gap: 0.34 },
      { at: 29.5, kind: 'torpedo', n: 6, form: 'wave',   speed: 270, gap: 0.20 },
      { at: 32.0, kind: 'miniboss', n: 2, form: 'line',  speed: 58,  gap: 0.5 }
    ]
  },
  {
    id: 4,
    name: '轨道残骸',
    sub: 'STAGE 4 · ORBITAL WRECK',
    bg: 'bg4',
    accent: '#b98cff',
    density: 1.62,
    boss: 'boss4',
    bossName: '轨道堡垒',
    support: null,
    bossHp: 4200,
    hint: '追踪蜂群 · 正面护盾',
    // 轨道残骸：失重，飘得慢、摆得大；两份补给在残骸之间来回弹
    supply: [
      { at: 6,  kind: 'P', from: 'top', speed: 58, sway: 46 },
      { at: 13, kind: 'W', from: 'top', speed: 58, sway: 46 },
      { at: 21, kind: 'P', from: 'rise', speed: 58, sway: 40 },
      { at: 29, kind: 'O', from: 'bounce', speed: 58 },
      { ev: 'miniboss', delay: 1.4, kind: 'P', from: 'bounce' }
    ],
    /* 三个新单位各自考一个习惯：
     *   drone   追着玩家跑 —— 不能再"站桩输出"，得边走边打
     *   shield  正面只吃 15% 伤害 —— 必须绕到侧后方
     *   looper  到底部调头爬升 —— 机尾第一次变成危险方向
     * 冲角型小 BOSS 放在末尾单只出场：它是唯一会主动撞上来的单位，
     * 和两只普通小 BOSS 混在一起出场时，玩家根本分不清哪个在俯冲。 */
    waves: [
      { at: 1.5,  kind: 'looper', n: 3, form: 'line',   speed: 106, gap: 0.34 },
      { at: 5.0,  kind: 'drone',  n: 6, form: 'arc',    speed: 138, gap: 0.10 },
      { at: 9.0,  kind: 'shield', n: 2, form: 'line',   speed: 58,  gap: 0.9 },
      { at: 12.5, kind: 'drone',  n: 7, form: 'vee',    speed: 146, gap: 0.08 },
      { at: 16.0, kind: 'looper', n: 4, side: 'left',  gap: 0.14 },   // 侧向切入后落到下方再爬回来
      { at: 19.5, kind: 'shield', n: 3, form: 'arc',    speed: 64,  gap: 0.7 },
      { at: 21.0, kind: 'drone',  n: 4, side: 'left',  gap: 0.12 },   // 侧向切入后直接转入追击
      { at: 23.0, kind: 'drone',  n: 8, form: 'diamond', speed: 150, gap: 0.07 },
      { at: 26.5, kind: 'looper', n: 4, form: 'vee',    speed: 116, gap: 0.28 },
      { at: 30.0, kind: 'shield', n: 3, form: 'sides',  speed: 68,  gap: 0.6 },
      { at: 33.0, kind: 'drone',  n: 7, form: 'grid',   speed: 152, gap: 0.09 },
      { at: 34.5, kind: 'miniboss', n: 2, form: 'line', speed: 58,  gap: 0.28, hp: 290 },
      { at: 34.8, kind: 'mbRam',    n: 1, form: 'line', speed: 60,  gap: 0.28, lane: 0.5 }
    ]
  },
  {
    id: 5,
    name: '熔核母舰',
    sub: 'STAGE 5 · CORE REACTOR',
    bg: 'bg5',
    accent: '#ff7a4d',
    density: 1.74,
    boss: 'boss5',
    bossName: '熔核核心',
    support: 'mirror',
    bossHp: 5600,
    bossRate: 0.97,
    hint: '喷火机 · 镜像机 · 悬停水母',
    // 熔核母舰：反应堆热流全往上走，补给全从底部升上来；顶上碰壁再落回来一份激光保险
    supply: [
      { at: 5,  kind: 'P', from: 'rise' },
      { at: 12, kind: 'P', from: 'rise' },
      { at: 20, kind: 'W', from: 'riseBounce' },
      { at: 28, kind: 'B', from: 'rise' },
      { ev: 'miniboss', delay: 1.4, kind: 'L', from: 'rise' }
    ],
    /* 本关的基调是"慢而厚"：heavy 155 血、jelly 悬停不走、mirror 会复制你的火力。
     * 全是慢速单位时会犯困，所以用 flame（喷火、射速快）和中段密集的 flame 波
     * 把节奏顶起来——两种速度交替，才不会变成打靶场。 */
    waves: [
      { at: 1.5,  kind: 'flame',  n: 4, form: 'line',   speed: 88,  gap: 0.42 },
      { at: 5.0,  kind: 'jelly',  n: 2, form: 'sides',  speed: 50,  gap: 0.9 },
      { at: 8.5,  kind: 'mirror', n: 4, form: 'sides',  speed: 94,  gap: 0.36 },
      { at: 12.0, kind: 'heavy',  n: 2, form: 'line',   speed: 44,  gap: 1.2 },
      { at: 15.5, kind: 'flame',  n: 6, form: 'arc',    speed: 94,  gap: 0.30 },
      { at: 17.2, kind: 'flame',  n: 4, side: 'right', gap: 0.22 },   // 侧向压边：喷火机从右翼贴过来
      { at: 19.0, kind: 'jelly',  n: 3, form: 'line',   speed: 54,  gap: 0.8 },
      { at: 22.5, kind: 'mirror', n: 7, form: 'vee',    speed: 98,  gap: 0.22 },
      { at: 26.0, kind: 'heavy',  n: 2, form: 'sides',  speed: 48,  gap: 1.0 },
      { at: 29.5, kind: 'flame',  n: 7, form: 'line',   speed: 100, gap: 0.26 },
      { at: 33.0, kind: 'mirror', n: 8, form: 'cross',  speed: 102, gap: 0.20 },
      { at: 36.0, kind: 'flame',  n: 7, side: 'left',   gap: 0.16 },   // 从左侧切入：喷火机贴边压过来
      { at: 37.0, kind: 'miniboss', n: 2, form: 'line', speed: 58,  gap: 0.28, hp: 300 },
      { at: 37.3, kind: 'mbSniper', n: 1, form: 'line', speed: 56,  gap: 0.28, lane: 0.5 }
    ]
  },
  {
    id: 6,
    name: '极光堡垒',
    sub: 'STAGE 6 · AURORA CITADEL',
    bg: 'bg6',
    accent: '#7dfff0',
    density: 1.88,
    boss: 'boss6',
    bossName: '极光母舰',
    bossHp: 6300,
    bossRate: 0.95,
    hint: '潜伏者 · 狙击机 · 重型浮雷',
    // 极光堡垒：极光像飘带一样左右摆，道具跟着摆；有一份从底部升起再落到顶盖
    supply: [
      { at: 6,  kind: 'P', from: 'top', sway: 52 },
      { at: 13, kind: 'W', from: 'bounce', sway: 48 },
      { at: 21, kind: 'P', from: 'rise', sway: 52 },
      { at: 29, kind: 'H', from: 'riseBounce', sway: 40 },
      { ev: 'miniboss', delay: 1.4, kind: 'O', from: 'bounce' }
    ],
    support: 'jelly',
    /* 本关把"看警示"推到前台：
     *   riser  从屏幕底部升起，起之前底部有红柱警示
     *   sniper 打慢起快收的狙击弹，蓄力期有收缩红环
     *   mineH  浮雷的放大版，爆散 16 发
     * 三者都在考"提前读画面"，所以段落之间留了 3.5 秒的空档，
     * 让玩家有机会把视线从弹幕挪到底边/敌机机腹上。 */
    waves: [
      { at: 1.5,  kind: 'riser',  n: 5, form: 'line',   speed: 126, gap: 0.55 },
      { at: 5.0,  kind: 'sniper', n: 3, form: 'sides',  speed: 58,  gap: 0.8 },
      { at: 8.5,  kind: 'mineH',  n: 4, form: 'arc',    speed: 34,  gap: 0.55 },
      { at: 12.0, kind: 'riser',  n: 5, form: 'sides',  speed: 134, gap: 0.42 },
      { at: 15.5, kind: 'sniper', n: 4, form: 'arc',    speed: 60,  gap: 0.7 },
      { at: 17.3, kind: 'sniper', n: 3, side: 'left',   gap: 0.7 },   // 侧向滑入后照样悬停蓄力：狙击不再只从上面来
      { at: 19.0, kind: 'mineH',  n: 5, form: 'line',   speed: 36,  gap: 0.5 },
      { at: 22.5, kind: 'riser',  n: 5, form: 'line',   speed: 140, gap: 0.35 },
      { at: 26.0, kind: 'sniper', n: 4, form: 'sides',  speed: 62,  gap: 0.65 },
      { at: 29.5, kind: 'mineH',  n: 6, form: 'arc',    speed: 38,  gap: 0.45 },
      { at: 31.2, kind: 'mineH',  n: 3, side: 'right', gap: 0.5 },   // 侧向飘入的浮雷：打爆照样十六向溅射
      { at: 33.0, kind: 'riser',  n: 6, form: 'sides',  speed: 144, gap: 0.32 },
      { at: 36.5, kind: 'sniper', n: 5, form: 'arc',    speed: 64,  gap: 0.6 },
      { at: 39.5, kind: 'miniboss', n: 2, form: 'line', speed: 58,  gap: 0.28, hp: 310 },
      { at: 39.8, kind: 'mbPrism',  n: 1, form: 'line', speed: 56,  gap: 0.28, lane: 0.5 }
    ]
  },
  {
    id: 7,
    name: '虚空王座',
    sub: 'STAGE 7 · VOID THRONE',
    bg: 'bg7',
    accent: '#ffc460',
    density: 2.04,
    boss: 'boss7',
    bossName: '虚空之主',
    bossHp: 7500,
    bossRate: 0.93,
    hint: '自杀机 · 偏折机',
    // 虚空王座：几乎没有重量，飘得最慢；环绕机从底部浮到王座边缘再落回来
    supply: [
      { at: 6,  kind: 'P', from: 'top', speed: 54, sway: 38 },
      { at: 13, kind: 'W', from: 'rise', speed: 54, sway: 38 },
      { at: 21, kind: 'P', from: 'bounce', speed: 60 },
      { at: 30, kind: 'R', from: 'riseBounce', speed: 54 },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'top' }
    ],
    support: null,
    /* 前六关都是"敌人从上面下来打你"，本关换两个方向：
     *   kamikaze 直接朝机身撞（不再是躲弹幕，是躲机体）
     *   deflect  正面把子弹拨回去（第一次出现"越打越没用"的怪）
     * deflect 固定编在 kamikaze 前面 3.5 秒：先让它替后面的自杀机挡掉一路火力，
     * 玩家才会意识到"这家伙是保护伞"，而不是"又一个打不动的肉"。
     * 双小 BOSS 用一冲一狙的组合：一个逼你走位，一个逼你保持移动，不能站定输出。 */
    waves: [
      { at: 1.5,  kind: 'kamikaze', n: 5, form: 'line',    speed: 160, gap: 0.24 },
      { at: 5.0,  kind: 'mirror',   n: 5, form: 'sides',   speed: 100, gap: 0.30 },
      { at: 8.5,  kind: 'flame',    n: 5, form: 'arc',     speed: 100, gap: 0.25 },
      { at: 12.0, kind: 'deflect',  n: 2, form: 'line',    speed: 48,  gap: 0.6 },
      { at: 15.5, kind: 'kamikaze', n: 7, form: 'wave',    speed: 168, gap: 0.20 },
      { at: 19.0, kind: 'heavy',    n: 2, form: 'line',    speed: 48,  gap: 1.0 },
      { at: 22.5, kind: 'mirror',   n: 5, form: 'diamond', speed: 104, gap: 0.22 },
      { at: 24.5, kind: 'mirror',   n: 4, side: 'left',  gap: 0.3 },   // 侧向包抄：镜像机左右夹着复制火力
      { at: 26.0, kind: 'deflect',  n: 3, form: 'line',    speed: 50,  gap: 0.6 },
      { at: 29.5, kind: 'kamikaze', n: 5, side: 'right', gap: 0.13 },   // 从右侧切入后直扑机身
      { at: 33.0, kind: 'flame',    n: 6, form: 'vee',     speed: 104, gap: 0.22 },
      { at: 36.5, kind: 'heavy',    n: 3, form: 'pincer',  speed: 52,  gap: 0.9 },
      { at: 40.0, kind: 'kamikaze', n: 6, form: 'diamond', speed: 174, gap: 0.16 },
      { at: 42.0, kind: 'miniboss', n: 1, form: 'line',    speed: 58,  gap: 0.28, hp: 320, lane: 0.18 },
      { at: 42.3, kind: 'mbRam',    n: 1, form: 'line',    speed: 60,  gap: 0.28, lane: 0.5 },
      { at: 42.3, kind: 'mbSniper', n: 1, form: 'line',    speed: 56,  gap: 0.28, lane: 0.82 }
    ]
  },
  {
    id: 8,
    name: '裂殖之巢',
    sub: 'STAGE 8 · MITOSIS NEST',
    bg: 'bg8',
    accent: '#b2ff60',
    density: 2.20,
    boss: 'boss8',
    bossName: '裂殖之核',
    bossHp: 8600,
    bossRate: 0.89,
    hint: '精英潮 · 蛇形单位',
    // 裂殖之巢：巢体脉动把补给从底部挤上来，越打越往上涌
    supply: [
      { at: 6,  kind: 'P', from: 'rise' },
      { at: 13, kind: 'P', from: 'rise' },
      { at: 20, kind: 'W', from: 'riseBounce' },
      { at: 28, kind: 'H', from: 'rise' },
      { ev: 'miniboss', delay: 1.4, kind: 'L', from: 'rise' }
    ],
    support: 'kamikaze',
    /* 本关不引入新杂兵，改由"节奏"制造新鲜感：
     * 四种旧机型（蜂群/自杀机/喷火/镜像）全部上阵，段与段之间不超 3.5 秒，
     * 密度是全场最高的一关——它考的是"能不能在高密度下持续走位"，不是新知识。
     * 压轴给**单条蛇**：第 9 关是双蛇，这里必须先教一次"打头才算击杀、
     * 剪身体会让它暴走"，否则终局关两条蛇同时上来时没有学习窗口。 */
    waves: [
      { at: 1.5,  kind: 'drone',    n: 6, form: 'diamond', speed: 150, gap: 0.08 },
      { at: 5.0,  kind: 'kamikaze', n: 4, form: 'wave',    speed: 166, gap: 0.22 },
      { at: 8.5,  kind: 'flame',    n: 4, form: 'arc',     speed: 102, gap: 0.22 },
      { at: 12.0, kind: 'mirror',   n: 4, form: 'sides',   speed: 104, gap: 0.24 },
      { at: 15.5, kind: 'drone',    n: 7, form: 'diamond', speed: 156, gap: 0.07 },
      { at: 17.4, kind: 'drone',    n: 4, side: 'left',  gap: 0.12 },   // 侧向切入的蜂群：紧贴屏幕边缘绕半圈再扑人
      { at: 19.0, kind: 'kamikaze', n: 5, form: 'pincer',  speed: 170, gap: 0.18 },
      { at: 22.5, kind: 'flame',    n: 5, form: 'trail',   speed: 106, gap: 0.16 },
      { at: 26.0, kind: 'mirror',   n: 5, form: 'diamond', speed: 108, gap: 0.18 },
      { at: 29.5, kind: 'drone',    n: 5, diag: 'ltr',   gap: 0.12 },   // 对角：左下 → 右上
      { at: 33.0, kind: 'kamikaze', n: 6, form: 'diamond', speed: 174, gap: 0.14 },
      { at: 34.6, kind: 'mirror',   n: 4, side: 'right', gap: 0.2 },   // 侧向夹击：和正面的自杀机形成十字
      { at: 36.5, kind: 'flame',    n: 5, form: 'pincer',  speed: 106, gap: 0.20 },
      { at: 40.0, kind: 'mirror',   n: 6, form: 'wave',    speed: 110, gap: 0.18 },
      // 中段小 BOSS：波次放到一半时插一组，避免整关只有"蛇"一个记忆点；
      // 和末段蛇错开 21 秒，玩家有两段明确的"停下来打大目标"的窗口
      { at: 23.5, kind: 'miniboss', n: 1, form: 'line',    speed: 58,  gap: 0.28, hp: 330, lane: 0.32 },
      { at: 23.8, kind: 'mbPrism',  n: 1, form: 'line',    speed: 56,  gap: 0.28, lane: 0.68 },
      /* 第三只：小 BOSS 同屏上限就是 3，三路分 Lane 才算"能同时应付"，
       * 不给 lane 会挤在中线互相掩护，玩家连一个都打不穿。 */
      { at: 24.1, kind: 'mbSniper', n: 1, form: 'line',    speed: 56,  gap: 0.28, lane: 0.88 },
      { at: 45.0, kind: 'snake',    n: 1 }
    ]
  },
  {
    id: 9,
    name: '终焉星环',
    sub: 'STAGE 9 · FINAL RING',
    bg: 'bg9',
    accent: '#b4beff',
    density: 2.38,
    boss: 'boss9',
    bossName: '终焉星环',
    bossHp: 10400,
    bossRate: 0.84,
    hint: '全机型混编 · 双蛇',
    // 终焉星环：星环上下两半同时投放，同一时刻一份自上落下、一份自下升起
    supply: [
      { at: 7,  kind: 'P', from: 'top',  x: 0.28 },
      { at: 7,  kind: 'P', from: 'rise', x: 0.72 },
      { at: 16, kind: 'W', from: 'top',  x: 0.72 },
      { at: 16, kind: 'W', from: 'rise', x: 0.28 },
      { at: 26, kind: 'B', from: 'bounce' },
      { at: 35, kind: 'O', from: 'riseBounce' },
      { ev: 'miniboss', delay: 1.4, kind: 'B', from: 'bounce' }
    ],
    phaseCuts: [0.8, 0.6, 0.4, 0.2],   // 五阶段
    support: null,
    /* 终局关：前面八关的所有机制按"每段一个主题"轮着来，中间不留空地。
     * 顺序刻意排成"盾 → 重装 → 摆尾 → 自杀 → 镜像 → 悬停 → 偏折 → 重装 → 蜂群……"，
     * 让连续两段永远不是同一种应对方式（刚学会绕后打盾，下一段就要躲机体）。
     * 压轴双蛇：单条已打过一次，这里是"两条对向"的最终考核。 */
    waves: [
      { at: 1.5,  kind: 'shield',   n: 3,  form: 'line',    speed: 66,  gap: 0.6 },
      { at: 5.0,  kind: 'heavy',    n: 2,  form: 'line',    speed: 50,  gap: 1.0 },
      { at: 8.5,  kind: 'eel',      n: 5,  form: 'wave',    speed: 100, gap: 0.26 },
      { at: 12.0, kind: 'kamikaze', n: 6,  form: 'pincer',  speed: 175, gap: 0.18 },
      { at: 15.5, kind: 'mirror',   n: 6,  form: 'diamond', speed: 110, gap: 0.18 },
      { at: 19.0, kind: 'jelly',    n: 4,  form: 'arc',     speed: 54,  gap: 0.6 },
      { at: 22.5, kind: 'deflect',  n: 3,  form: 'line',    speed: 48,  gap: 0.6 },
      { at: 26.0, kind: 'heavy',    n: 3,  form: 'pincer',  speed: 54,  gap: 0.8 },
      { at: 27.8, kind: 'drone',    n: 5,  side: 'left',  gap: 0.08 },   // 侧向蜂群：贴左边缘切进来再追人
      { at: 29.5, kind: 'drone',    n: 11, form: 'diamond', speed: 162, gap: 0.06 },
      { at: 33.0, kind: 'shield',   n: 5,  form: 'wave',    speed: 74,  gap: 0.5 },
      { at: 36.5, kind: 'sniper',   n: 3,  side: 'right',  gap: 0.7 },   // 侧向滑入后悬停蓄力
      { at: 40.0, kind: 'kamikaze', n: 7,  form: 'diamond', speed: 178, gap: 0.14 },
      { at: 43.5, kind: 'eel',      n: 7,  form: 'cross',   speed: 104, gap: 0.24 },
      // 中段小 BOSS：和前八关一样"波次过半来一波"，双蛇仍然独占最后 10 秒
      { at: 24.0, kind: 'miniboss', n: 2,  form: 'line',    speed: 58,  gap: 0.28, hp: 360 },
      { at: 24.3, kind: 'mbRam',    n: 1,  form: 'line',    speed: 60,  gap: 0.28, lane: 0.5 },
      /* 尾段再加一只：终局关不能"打完中段小 BOSS 就只剩躲弹"，
       * 41 秒这只把压力续到双蛇登场，血量用普通 380（不用棱镜），
       * 免得它拖着 520 血活到 50 秒和双蛇叠在一起。 */
      { at: 41.0, kind: 'miniboss', n: 1,  form: 'line',    speed: 58,  gap: 0.28, hp: 380, lane: 0.5 },

      // 压轴：双蛇对向游走（各 1250 头血 / 7 节 × 160，单条射速降 42%）
      { at: 50.0, kind: 'snake',    n: 2 }
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
