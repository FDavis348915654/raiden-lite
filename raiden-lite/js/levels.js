/* ============================================================
 * levels.js —— 编队生成 + 5 个 BOSS 的弹幕模式
 * 每个 BOSS 函数返回「距下次开火的秒数」
 * ============================================================ */

/** 按编队形式把一波敌机排进生成队列
 *  - 数量按 level.density 放大
 *  - 超过 7 架自动拆成后续小队，避免横排挤出屏幕
 */
function spawnFormation(game, w) {
  // 蛇：一次投放就是"一整条"，n 表示同时放几条（第 9 关放 2 条）。
  // 不能走下面的 density 倍率——那会把 1 条加成 2 条，再乘 0.6 的补充波。
  if (w.kind === 'snake') {
    const cnt = Math.max(1, w.n || 1);
    for (let i = 0; i < cnt; i++) {
      game.queueEnemy({ kind: 'snake', twin: cnt > 1 }, VIEW.w / 2, -60, i * 1.1,
        cnt === 1 ? 0.5 : i / cnt);
    }
    return;
  }

  const mul = isMiniKind(w.kind) ? 1 : (game.level.density || 1);   // 中型机不吃密度加成
  const total = Math.max(1, Math.round(w.n * mul));
  const gap = w.gap || 0.16;
  const baseY = -48;

  // 对角穿越：从一侧下角斜穿到另一侧上角，整条斜线横跨屏幕。
  // 起点贴着屏幕底边（y ≈ H-24），所以玩家会看到它们从下方角落"窜"上来。
  if (w.diag) {
    const ltr = w.diag === 'ltr';
    const cnt = Math.min(8, total);
    for (let i = 0; i < cnt; i++) {
      const t = cnt === 1 ? 0.4 : i / (cnt - 1);
      const x = ltr ? -52 - t * 116 : VIEW.w + 52 + t * 116;
      const y = VIEW.h - 24 + t * 76;
      game.queueEnemy(w, x, y, i * gap * 1.5, cnt === 1 ? 0.5 : t);
    }
    return;
  }

  // 侧向入场：从屏幕外侧斜切进来，纵向依次铺开。
  // 不走下面 baseY = -48 那套几何——那是"从顶部成排压下来"的算法，
  // 侧面进入的坐标是 (屏幕外 x, 屏幕内 y)，完全是另一回事。
  if (w.side) {
    const dir = w.side === 'left' ? -1 : 1;
    const cnt = Math.min(10, total);
    for (let i = 0; i < cnt; i++) {
      const t = cnt === 1 ? 0.4 : i / (cnt - 1);
      // 弧线掠袭从"侧下方"（0.60H~0.82H）起，再甩到侧上方；
      // 直线斜切改为从上半屏切进来：起点抬到 94，整串在 94~333 铺开。
      // 原来从 152 起、一路铺到 476，正好压在屏幕中线附近，
      // 看着像"从中间横穿"，抬上来之后才有从侧翼俯冲入场的感觉。
      // 配合 Enemy 里压慢的入场下沉速度，交棒时仍在屏幕上半部。
      const y = w.arc
        ? VIEW.h * 0.60 + t * (VIEW.h * 0.22)
        : 94 + t * (VIEW.h * 0.28);
      // 越靠后的越靠屏幕外，配合 delay 形成"一串陆续切入"
      const x = dir < 0 ? -58 - i * 28 : VIEW.w + 58 + i * 28;
      game.queueEnemy(w, x, y, i * gap * (w.arc ? 1.7 : 1.4), cnt === 1 ? 0.5 : t);
    }
    return;
  }
  const perGroup = 7;
  const groups = Math.ceil(total / perGroup);

  let emitted = 0;
  for (let g = 0; g < groups; g++) {
    const count = Math.min(perGroup, total - emitted);
    const groupDelay = g * 0.70;
    const gapX = Math.min(66, (VIEW.w - 110) / Math.max(1, count - 1));
    const mid = (count - 1) / 2;

    for (let i = 0; i < count; i++) {
      let x = VIEW.w / 2;
      let y = baseY - g * 26;
      let delay = groupDelay + i * gap;

      if (w.form === 'line') {
        x = VIEW.w / 2 + (i - mid) * gapX;
      } else if (w.form === 'vee') {
        x = VIEW.w / 2 + (i - mid) * gapX * 0.92;
        y = baseY - Math.abs(i - mid) * 28 - g * 26;
        delay = groupDelay + Math.abs(i - mid) * gap * 0.75;
      } else if (w.form === 'column') {
        // 两列拉开距离，否则多组叠加会挤成一条“糖葫芦”
        x = VIEW.w / 2 + (i % 2 ? 1 : -1) * (108 + g * 34);
        y = baseY - i * 66;
        delay = groupDelay + i * gap;
      } else if (w.form === 'sides') {
        const side = i % 2 === 0 ? -1 : 1;
        x = VIEW.w / 2 + side * (VIEW.w * 0.33 - Math.floor(i / 2) * 10);
        y = baseY - Math.floor(i / 2) * 36 - g * 26;
        delay = groupDelay + i * gap;
      } else if (w.form === 'arc') {
        const t = count === 1 ? 0.5 : i / (count - 1);
        x = 58 + t * (VIEW.w - 116);
        y = baseY - Math.sin(t * Math.PI) * 64 - g * 26;
        delay = groupDelay + Math.abs(t - 0.5) * count * gap * 0.75;
      } else if (w.form === 'diamond') {
        // 菱形阵：8 个方位（4 正 + 4 斜），整体从上方压下
        const dia = [[0, -1], [1, 0], [0, 1], [-1, 0],
                     [0.66, -0.66], [0.66, 0.66], [-0.66, 0.66], [-0.66, -0.66]];
        const q = dia[i % 8];
        x = VIEW.w / 2 + q[0] * 96;
        y = baseY - 66 + q[1] * 78 - g * 26;
        delay = groupDelay + i * gap;
      } else if (w.form === 'wave') {
        // 波浪阵：整排横向铺开，纵向正弦起伏
        const t = count === 1 ? 0.5 : i / (count - 1);
        x = 52 + t * (VIEW.w - 104);
        y = baseY - Math.sin(t * Math.PI * 2) * 44 - g * 26;
        delay = groupDelay + i * gap * 1.15;
      } else if (w.form === 'pincer') {
        // 钳形阵：两侧同时压入，越靠后越向中间收
        const side = i % 2 === 0 ? -1 : 1;
        const rank = Math.floor(i / 2);
        x = VIEW.w / 2 + side * (VIEW.w * 0.46 - rank * 30);
        y = baseY - rank * 44 - g * 26;
        delay = groupDelay + rank * gap;
      } else if (w.form === 'grid') {
        // 方阵：等宽等高的网格压下来。和 line 的区别是"两排以上"，
        // 前排先到、后排错开半拍，玩家要横着扫过去而不是点掉一排
        const cols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(count))));
        const col = i % cols, row = Math.floor(i / cols);
        const gw = Math.min(84, (VIEW.w - 100) / Math.max(1, cols - 1));
        x = VIEW.w / 2 + (col - (cols - 1) / 2) * gw;
        y = baseY - row * 58 - g * 26;
        delay = groupDelay + row * gap * 1.6 + col * gap * 0.5;
      } else if (w.form === 'cross') {
        // 十字阵：中心 + 上下左右 + 四角，9 个点正好一架不浪费
        const cr = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0],
                    [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7], [-0.7, -0.7]];
        const q = cr[i % 9];
        x = VIEW.w / 2 + q[0] * 104;
        y = baseY - 54 + q[1] * 74 - g * 26;
        delay = groupDelay + (Math.abs(q[0]) + Math.abs(q[1])) * gap * 0.8;
      } else if (w.form === 'trail') {
        // 斜列：一条越来越靠外侧的斜线，像雁群侧身掠过，和 line 的横排错开
        const side = w.side === 'right' ? 1 : -1;
        x = VIEW.w / 2 + side * (i - mid) * 34;
        y = baseY - i * 30 - g * 26;
        delay = groupDelay + i * gap;
      }

      // lane：小 BOSS 专用的车道覆盖（0~1）。两个小 BOSS 波次挨着放时，
      // 不给 lane 的话两者都是 slot 0.5，会叠在屏幕正中间变成一架。
      const slot = total === 1 ? 0.5 : Math.min(1, (i + g * perGroup) / (total - 1));
      game.queueEnemy(w, clamp(x, 42, VIEW.w - 42), y, delay,
        w.lane !== undefined ? w.lane : slot);
      emitted++;
    }
  }
}

/* ---------------------------------------------------------------- BOSS 专属机制 */
/* 俯冲：蓄力瞄准后高速穿过屏幕；召唤：血量到阈值退场呼叫援军 */
const BOSS_TRAITS = {
  /* laser 参数说明：
   *   cd     冷却（秒）
   *   charge 蓄力跟随时长（方向以 track rad/s 追玩家）
   *   lock   蓄力结束后的锁定预警（方向冻结，给玩家反应窗口）
   *   fire   光束持续时长
   *   width  光束宽度（命中判定 = width/2 + 玩家判定半径）
   *   track  跟踪角速度 rad/s，越低越容易甩开
   */
  /* 护盾轮转：四面护盾只有一面是弱点，每 2.4 秒转一次 */
  boss3: { shield: true },
  /* 浮游炮：两座环绕炮台，可单独打掉 */
  boss4: { drones: { count: 4, ratio: 0.5 } },
  /* 激光 + 镜像武器 */
  boss5: { laser: { cd: 8.0, charge: 1.1, lock: 1.0, fire: 1.5, width: 38, track: 0.50 }, mirror: true },
  boss6: { dive: true, diveCd: 8.5, laser: { cd: 9.5, charge: 1.0, lock: 0.8, fire: 1.3, width: 32, track: 0.58 } },
  boss7: { summonAt: 0.55, summonCount: 3, laser: { cd: 9.5, charge: 1.2, lock: 0.9, fire: 1.4, width: 34, track: 0.55 } },
  /* 分裂 + 双栅栏 + 中央弹幕束 */
  boss8: { splitAt: 0.42, splitCount: 2, fence: true, center: true },
  /* 最终 BOSS：弹幕墙 + 引力场 + 激光 */
  boss9: { wall: true, gravity: true, laser: { cd: 7.5, charge: 1.0, lock: 0.8, fire: 1.6, width: 40, track: 0.62 } }
};

/* 可单独打掉的两侧武器（相对 BOSS 中心的偏移） */
/* 可破坏部件：血量按 BOSS 最大血量的 ratio 分摊到每个部件。
 * 0.5 的意思是"拆完所有部件 = 打掉 BOSS 一半血"，这样拆炮塔是真正的取舍，
 * 不是顺手带掉。原来写死 240/320，在第 6 关 5800 血的 BOSS 上几乎白送。 */
/* 可破坏炮塔：ratio 是"两座加起来占 BOSS 最大血量的比例"
 * 3.3.3 从 0.5 降到 0.18 —— 原来单座 1450/1700 血，满级 DPS 约 150 也要 10 秒专注输出，
 * 而 BOSS 全程在开火，实战几乎不可能打掉，等于这个战术目标不存在。
 * 现在单座 522（第 6 关）/ 612（第 7 关），专注 3~4 秒能拆，拆掉少一路火力。 */
const BOSS_PARTS = {
  boss6: { ratio: 0.18, items: [
    { dx: -104, dy: 14, r: 32 },
    { dx: 104, dy: 14, r: 32 }
  ]},
  boss7: { ratio: 0.18, items: [
    { dx: -104, dy: 32, r: 36 },
    { dx: 104, dy: 32, r: 36 }
  ]}
};

/* ---------------------------------------------------------------- BOSS 弹幕 */

const BOSS_PATTERNS = {

  /* 苍鹰母舰：扇形散射 → 双炮台瞄准 → 螺旋 */
  boss1(b, game) {
    const p = game.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    if (b.phase === 0) {
      for (let i = -3; i <= 3; i++) {
        const a = aim + i * 0.16;
        game.spawnEnemyBullet(b.x, b.y + 60, Math.cos(a) * 205, Math.sin(a) * 205);
      }
      SFX.enemyShoot();
      return 1.05;
    }
    if (b.phase === 1) {
      for (let i = -4; i <= 4; i++) {
        const a = aim + i * 0.15;
        game.spawnEnemyBullet(b.x, b.y + 60, Math.cos(a) * 220, Math.sin(a) * 220);
      }
      for (const off of [-92, 92]) {
        game.spawnEnemyBullet(b.x + off, b.y + 40,
          Math.cos(aim) * 265, Math.sin(aim) * 265, { kind: 'enemyAlt' });
      }
      SFX.enemyShoot();
      return 0.92;
    }
    b.ang += 0.42;
    for (let i = 0; i < 3; i++) {
      const a = b.ang + i * (Math.PI * 2 / 3);
      game.spawnEnemyBullet(b.x, b.y + 40, Math.cos(a) * 205, Math.sin(a) * 205,
        { kind: 'enemyAlt' });
    }
    return 0.16;
  },

  /* 岩甲巨蟹：抛石 → 钳击冲撞 → 落石 + 环形 */
  boss2(b, game) {
    const p = game.player;
    if (b.phase === 0) {
      for (let i = 0; i < 4; i++) {
        const vx = rand(-90, 90) + (p.x - b.x) * 0.4;
        game.spawnEnemyBullet(b.x + rand(-70, 70), b.y + 40, vx, -180,
          { kind: 'big', ay: 320, r: 14 });
      }
      SFX.enemyShoot();
      return 1.3;
    }
    if (b.phase === 1) {
      // 钳击：每 3.4 秒朝玩家所在侧冲出一次（有限位移 + 缓动，不是瞬移）
      if (b.lunge(p.x, { cd: 3.4, hold: 0.5 })) {
        for (let i = -2; i <= 2; i++) {
          const a = Math.PI / 2 + i * 0.26;
          game.spawnEnemyBullet(b.x, b.y + 55, Math.cos(a) * 230, Math.sin(a) * 230);
        }
        game.shake(8);
        SFX.enemyShoot();
        return 1.5;
      }
      // 冷却期：只在原地吐三向弹，位移完全停止
      for (let i = -1; i <= 1; i++) {
        const a = Math.PI / 2 + i * 0.3;
        game.spawnEnemyBullet(b.x, b.y + 50, Math.cos(a) * 205, Math.sin(a) * 205);
      }
      SFX.enemyShoot();
      return 1.0;
    }
    for (let i = 0; i < 2; i++) {
      game.spawnEnemyBullet(b.x + rand(-70, 70), b.y + 40, rand(-60, 60), -200,
        { kind: 'big', ay: 300, r: 14 });
    }
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.t;
      game.spawnEnemyBullet(b.x, b.y + 20, Math.cos(a) * 165, Math.sin(a) * 165);
    }
    SFX.enemyShoot();
    return 1.35;
  },

  /* 深渊之眼：环形 → 双向螺旋 → 环形 + 瞄准 */
  boss3(b, game) {
    const p = game.player;
    if (b.phase === 0) {
      const n = 18;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 165, Math.sin(a) * 165,
          { kind: 'enemyAlt' });
      }
      b.ang += 0.2;
      SFX.enemyShoot();
      return 1.35;
    }
    if (b.phase === 1) {
      b.ang += 0.30;
      for (let k = 0; k < 2; k++) {
        const a = b.ang + k * Math.PI;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 215, Math.sin(a) * 215);
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a + 0.2) * 215, Math.sin(a + 0.2) * 215,
          { kind: 'enemyAlt' });
      }
      return 0.10;
    }
    const n = 12;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.t * 0.8;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 190, Math.sin(a) * 190);
    }
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = -2; i <= 2; i++) {
      const a = aim + i * 0.14;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 300, Math.sin(a) * 300,
        { kind: 'enemyAlt' });
    }
    SFX.enemyShoot();
    return 1.2;
  },

  /* 轨道堡垒：六向散射 → 旋转射线 → 全向环 + 瞄准 */
  boss4(b, game) {
    const p = game.player;
    if (b.phase === 0) {
      for (let i = 0; i < 8; i++) {
        const a = b.ang + (i / 8) * Math.PI * 2;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 200, Math.sin(a) * 200);
      }
      b.ang += 0.24;
      SFX.enemyShoot();
      return 1.0;
    }
    if (b.phase === 1) {
      b.ang += 0.13;
      for (let k = 0; k < 2; k++) {
        const a = b.ang + k * Math.PI;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 330, Math.sin(a) * 330,
          { kind: 'enemyAlt' });
      }
      return 0.075;
    }
    const n = 14;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.ang;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 180, Math.sin(a) * 180);
    }
    b.ang += 0.32;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    for (let i = 0; i < 3; i++) {
      const a = aim + (i - 1) * 0.12;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 320, Math.sin(a) * 320,
        { kind: 'big', r: 11 });
    }
    SFX.enemyShoot();
    return 1.0;
  },

  /* 极光母舰：棱镜十字 → 环形 + 侧翼炮 → 螺旋；侧翼被打掉后弹幕变稀 */
  boss6(b, game) {
    const p = game.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    const alive = b.partsAlive();

    // 侧翼炮独立开火，打掉就少一路
    for (const pt of b.parts) {
      if (!pt.alive) continue;
      const px = b.x + pt.dx, py = b.y + pt.dy;
      const a = Math.atan2(p.y - py, p.x - px);
      game.spawnEnemyBullet(px, py, Math.cos(a) * 255, Math.sin(a) * 255,
        { kind: 'enemyAlt' });
    }

    if (b.phase === 0) {
      for (let i = 0; i < 4; i++) {
        const a = aim + i * Math.PI / 2;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 205, Math.sin(a) * 205);
      }
      SFX.enemyShoot();
      return 1.15;
    }
    if (b.phase === 1) {
      const n = alive ? 8 : 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.t * 0.5;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 190, Math.sin(a) * 190);
      }
      SFX.enemyShoot();
      return 1.25;
    }
    b.ang += 0.24;
    for (let i = 0; i < 3; i++) {
      const a = b.ang + i * Math.PI * 2 / 3;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 225, Math.sin(a) * 225,
        { kind: 'enemyAlt' });
    }
    return 0.16;
  },

  /* 虚空之主：单环 → 双环反向 → 狂暴全向 + 精准；召唤后进入狂暴 */
  boss7(b, game) {
    const p = game.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    const alive = b.partsAlive();

    if (b.phase === 0) {
      const n = 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 170, Math.sin(a) * 170);
      }
      b.ang += 0.18;
      SFX.enemyShoot();
      return 1.3;
    }
    if (b.phase === 1) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 150, Math.sin(a) * 150);
        const a2 = a + Math.PI / 12;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a2) * 240, Math.sin(a2) * 240,
          { kind: 'enemyAlt' });
      }
      b.ang -= 0.2;
      SFX.enemyShoot();
      return 1.5;
    }
    const n = alive ? 20 : 16;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.ang;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 200, Math.sin(a) * 200);
    }
    b.ang += 0.3;
    for (let i = -2; i <= 2; i++) {
      const a = aim + i * 0.12;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 330, Math.sin(a) * 330,
        { kind: 'big', r: 10 });
    }
    SFX.enemyShoot();
    return 1.0;
  },

  /* 裂殖之核：双核交替 → 环形 + 瞄准 → 双股反向螺旋 */
  boss8(b, game) {
    const p = game.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    const half = b.w * 0.20;

    if (b.phase === 0) {
      // 双核交替：左右两个细胞核轮流吐扇形，节奏是"左-右-左-右"
      b.alt = (b.alt || 0) + 1;
      const side = b.alt % 2 ? -1 : 1;
      const sx = b.x + side * half;
      const a0 = Math.atan2(p.y - b.y, p.x - sx);
      for (let i = -2; i <= 2; i++) {
        const a = a0 + i * 0.17;
        game.spawnEnemyBullet(sx, b.y + 18, Math.cos(a) * 228, Math.sin(a) * 228,
          { kind: i % 2 ? 'enemyAlt' : 'enemy' });
      }
      SFX.enemyShoot();
      return 0.62;
    }
    if (b.phase === 1) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 176, Math.sin(a) * 176);
      }
      b.ang += 0.2;
      for (let i = -1; i <= 1; i++) {
        const a = aim + i * 0.13;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 305, Math.sin(a) * 305,
          { kind: 'big', r: 11 });
      }
      SFX.enemyShoot();
      return 1.15;
    }
    // 终态：双股反向螺旋，越打越紧
    b.ang += 0.3;
    for (let k = 0; k < 2; k++) {
      const a = b.ang * (k ? -1 : 1) + k * Math.PI;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 235, Math.sin(a) * 235,
        { kind: k ? 'enemyAlt' : 'enemy' });
    }
    return 0.11;
  },

  /* 终焉星环：五阶段，每段换一种压迫方式 */
  boss9(b, game) {
    const p = game.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);

    // 0 环形（100~80%）
    if (b.phase === 0) {
      const n = 12;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 172, Math.sin(a) * 172);
      }
      b.ang += 0.16;
      for (let i = -1; i <= 1; i++) {
        const a = aim + i * 0.12;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 300, Math.sin(a) * 300,
          { kind: 'enemyAlt' });
      }
      SFX.enemyShoot();
      return 1.15;
    }

    // 1 双环反向（80~60%）
    if (b.phase === 1) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 165, Math.sin(a) * 165);
        const a2 = a + Math.PI / 10;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a2) * 235, Math.sin(a2) * 235,
          { kind: 'enemyAlt' });
      }
      b.ang -= 0.18;
      SFX.enemyShoot();
      return 1.35;
    }

    // 2 四股螺旋（60~40%）
    if (b.phase === 2) {
      b.ang += 0.27;
      for (let k = 0; k < 4; k++) {
        const a = b.ang + k * Math.PI / 2;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 215, Math.sin(a) * 215,
          { kind: k % 2 ? 'enemyAlt' : 'enemy' });
      }
      if (Math.random() < 0.35) {
        game.spawnEnemyBullet(b.x, b.y, Math.cos(aim) * 340, Math.sin(aim) * 340,
          { kind: 'big', r: 10 });
      }
      return 0.18;
    }

    // 3 全向爆散 + 精准（40~20%）
    if (b.phase === 3) {
      const n = 20;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + b.ang;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 195, Math.sin(a) * 195);
      }
      b.ang += 0.3;
      for (let i = -2; i <= 2; i++) {
        const a = aim + i * 0.10;
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 345, Math.sin(a) * 345,
          { kind: 'big', r: 10 });
      }
      SFX.enemyShoot();
      return 1.0;
    }

    // 4 终焉：24 全向 + 反向螺旋 + 双路精准
    const n = 24;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.ang;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 185, Math.sin(a) * 185);
    }
    b.ang2 = (b.ang2 || 0) - 0.36;
    for (let k = 0; k < 3; k++) {
      const a = b.ang2 + k * Math.PI * 2 / 3;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 250, Math.sin(a) * 250,
        { kind: 'enemyAlt' });
    }
    b.ang += 0.26;
    for (const off of [-0.22, 0.22]) {
      game.spawnEnemyBullet(b.x, b.y, Math.cos(aim + off) * 330, Math.sin(aim + off) * 330,
        { kind: 'big', r: 11 });
    }
    SFX.enemyShoot();
    return 0.92;
  },

  /* 熔核核心：三向扇形 → 双螺旋 + 抛石 → 狂暴全屏 */
  boss5(b, game) {
    const p = game.player;
    const aim = Math.atan2(p.y - b.y, p.x - b.x);
    if (b.phase === 0) {
      for (let i = -1; i <= 1; i++) {
        const a = aim + i * 0.22;
        for (let k = 0; k < 2; k++) {
          game.spawnEnemyBullet(b.x, b.y + 30, Math.cos(a) * (200 + k * 90),
            Math.sin(a) * (200 + k * 90), { kind: k ? 'big' : 'enemy', r: k ? 12 : 7 });
        }
      }
      SFX.enemyShoot();
      return 1.1;
    }
    if (b.phase === 1) {
      b.ang += 0.26;
      for (let k = 0; k < 3; k++) {
        const a = b.ang + k * (Math.PI * 2 / 3);
        game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 225, Math.sin(a) * 225,
          { kind: 'enemyAlt' });
      }
      if (Math.random() < 0.6) {
        game.spawnEnemyBullet(b.x + rand(-90, 90), b.y + 30, rand(-50, 50), -190,
          { kind: 'big', ay: 300, r: 14 });
      }
      return 0.14;
    }
    const n = 20;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + b.ang;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 195, Math.sin(a) * 195);
    }
    b.ang += 0.36;
    for (let i = -2; i <= 2; i++) {
      const a = aim + i * 0.10;
      game.spawnEnemyBullet(b.x, b.y, Math.cos(a) * 340, Math.sin(a) * 340,
        { kind: 'enemyAlt' });
    }
    game.shake(5);
    SFX.enemyShoot();
    return 0.95;
  }
};

const BOSS_HULL = {
  boss1: [{dx:-1,dy:-1,r:59.2}, {dx:-60,dy:-13,r:49.3}, {dx:59,dy:-13,r:49.3}, {dx:-1,dy:59,r:21.3}, {dx:-107,dy:-29,r:15.8}, {dx:106,dy:-29,r:15.8}, {dx:-1,dy:-61,r:13.5}, {dx:-81,dy:-58,r:12.0}, {dx:80,dy:-58,r:12.0}, {dx:-99,dy:-44,r:10.0}, {dx:98,dy:-44,r:10.0}],
  boss2: [{dx:-1,dy:-1,r:83.7}, {dx:-130,dy:-40,r:21.6}, {dx:129,dy:-40,r:21.6}, {dx:81,dy:-22,r:13.5}, {dx:-84,dy:-23,r:13.0}, {dx:94,dy:-29,r:12.5}, {dx:-96,dy:-29,r:11.7}, {dx:-130,dy:-18,r:11.2}, {dx:129,dy:-18,r:11.2}, {dx:42,dy:71,r:11.2}, {dx:-42,dy:72,r:10.8}],
  boss3: [{dx:-1,dy:-9,r:62.2}, {dx:61,dy:-15,r:16.3}, {dx:60,dy:4,r:15.5}, {dx:-63,dy:-3,r:15.0}, {dx:-62,dy:-22,r:14.3}, {dx:57,dy:-32,r:13.0}, {dx:-60,dy:12,r:12.5}, {dx:55,dy:19,r:12.0}, {dx:-57,dy:-37,r:10.6}, {dx:-54,dy:24,r:9.9}, {dx:51,dy:-44,r:9.4}, {dx:48,dy:30,r:8.6}],
  boss4: [{dx:-1,dy:-5,r:97.3}, {dx:97,dy:-5,r:22.3}, {dx:-99,dy:-5,r:21.4}, {dx:75,dy:56,r:15.6}, {dx:75,dy:-66,r:15.2}, {dx:94,dy:18,r:15.2}],
  boss5: [{dx:7,dy:-5,r:66.6}, {dx:-77,dy:-5,r:51.7}, {dx:55,dy:45,r:40.4}, {dx:15,dy:-74,r:40.1}, {dx:56,dy:-54,r:39.9}, {dx:11,dy:64,r:35.7}, {dx:-14,dy:-104,r:23.7}, {dx:96,dy:-43,r:20.8}, {dx:96,dy:34,r:20.8}, {dx:-88,dy:48,r:19.1}, {dx:-88,dy:-58,r:18.4}],
  boss6: [{dx:-1,dy:-5,r:62.3}, {dx:-89,dy:12,r:17.3}, {dx:88,dy:12,r:17.3}, {dx:-106,dy:17,r:15.5}, {dx:105,dy:17,r:15.5}, {dx:55,dy:23,r:12.5}, {dx:55,dy:-33,r:12.1}, {dx:-57,dy:23,r:12.0}, {dx:-57,dy:-33,r:11.7}, {dx:-61,dy:-22,r:8.0}, {dx:60,dy:-21,r:8.0}],
  boss7: [{dx:-8,dy:-10,r:78.0}, {dx:-115,dy:28,r:23.3}, {dx:114,dy:28,r:23.3}, {dx:67,dy:-32,r:22.6}, {dx:67,dy:12,r:22.6}, {dx:73,dy:-10,r:17.0}, {dx:58,dy:-53,r:12.7}, {dx:58,dy:33,r:12.7}, {dx:34,dy:56,r:11.2}, {dx:32,dy:-77,r:11.0}, {dx:50,dy:43,r:10.6}, {dx:42,dy:-70,r:10.0}],
  boss8: [{dx:0,dy:-7,r:88.2}, {dx:-88,dy:-13,r:21.0}, {dx:88,dy:-13,r:21.0}, {dx:-87,dy:8,r:20.2}, {dx:87,dy:8,r:20.2}, {dx:-84,dy:-34,r:18.0}, {dx:84,dy:-34,r:18.0}, {dx:81,dy:28,r:17.0}, {dx:-81,dy:28,r:16.6}, {dx:-76,dy:-52,r:13.5}, {dx:76,dy:-52,r:13.5}, {dx:-73,dy:43,r:12.7}],
  boss9: [{dx:0.5,dy:0.0,r:79.2}],
};
