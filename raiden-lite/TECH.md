# TECH.md · 技术实现说明

> 这份文档回答一个问题：**这个游戏是怎么跑起来的**。
> 玩法、数值、关卡设计看 [README.md](README.md)；踩过的坑和硬性约定看 [../CODEBUDDY.md](../CODEBUDDY.md)。
> 本文只写"架构与实现"，数值一律引用 `js/config.js`，不在文档里重复抄。

---

## 1. 技术选型

**没有游戏引擎，没有框架，没有构建工具，没有运行时依赖。**

| 项 | 结论 |
|---|---|
| 引擎 | 无。渲染、循环、碰撞、粒子、存读档全部手写 |
| 框架 | 无。没有 React/Vue/Pixi/Phaser |
| 构建 | 无。没有 `package.json`、`node_modules`、bundler，也没有 `tsc` |
| 模块 | 无 ESM/CJS。7 个全局脚本靠 `<script>` 顺序加载 |
| 素材 | 无外部素材。美术由 Python 脚本生成，音效由 WebAudio 实时合成 |
| 第三方库 | 0（运行时）。工具链只用 Pillow / numpy / Playwright |

选这条路的**唯一理由**是目标平台：这个 Demo 最终要移植到小米手环 10（Vela 快应用），包体、内存、启动时间都卡得很紧，塞一个 JS 游戏引擎不现实。而 480×854 的竖版 STG 需要的渲染能力只有"贴图 + 半透明 + 叠加混合 + 少量径向渐变"，Canvas 2D 完全够用。

副作用是**所有轮子都得自己造**：图集打包、粒子系统、缓动、UI 热区、音效合成、崩溃兜底。这部分工作量的绝对值不小，但换来的是"打开 `index.html` 就能玩、改一行 JS 刷新即生效"的迭代速度。

如果哪天要做 3D、骨骼动画或联机，再评估迁到 Cocos / PixiJS 更划算——现在的代码是"按引擎的职责分层、但不依赖引擎"的写法，迁移成本主要在渲染层。

---

## 2. 运行时栈

| 层 | 用什么 | 关键实现 |
|---|---|---|
| 渲染 | **Canvas 2D** | `canvas.getContext('2d', { alpha: false })`，单画布，无 WebGL |
| 循环 | `requestAnimationFrame` | 固定步长累加器 `STEP = 1/60`，`dt` 夹到 0.1，单帧最多追 5 步 |
| 音频 | **WebAudio** | `OscillatorNode` + `GainNode` 包络做音效；噪声走 `AudioBufferSource` + `BiquadFilter` 带通 |
| 输入 | **Pointer Events** | `pointerdown/move/up` + `pointerId` 记录控制权归属；键盘为辅助 |
| 存档 | `localStorage` | 只有最高分，键 `raiden-lite.hi.v1` |
| 画布尺寸 | 逻辑分辨率 + CSS 缩放 | 逻辑坐标恒为 480×854，DPR 上限 2 |

---

## 3. 启动与加载

`index.html` 只有 27 行，本质上是一份"加载清单"：

```html
<script src="js/config.js?v=3.38.0"></script>   <!-- 1. 纯数据：所有数值表 -->
<script src="js/audio.js?v=3.38.0"></script>    <!-- 2. SFX 原语 -->
<script src="js/atlas.js?v=3.38.0"></script>    <!-- 3. 图集帧表（生成物） -->
<script src="js/assets.js?v=3.38.0"></script>   <!-- 4. 图片加载 + 绘制封装 -->
<script src="js/entities.js?v=3.38.0"></script> <!-- 5. 各对象自身行为 -->
<script src="js/levels.js?v=3.46.0"></script>   <!-- 6. 编队几何 + BOSS 弹幕 -->
<script src="js/game.js?v=3.38.0"></script>     <!-- 7. 主循环 + 状态机 + 碰撞 -->
```

**加载顺序就是隐式依赖链**，倒过来会立刻 `undefined`（比如 `assets.js` 里的 `ATLAS` 来自 `atlas.js`，`entities.js` 里的 `ENEMY_DEFS` 来自 `config.js`）。新增文件必须插在正确位置并带 `?v=`。

启动流程：`Assets.load()` 用 `Promise.all` 并行拉 `sprites.png` 与 9 张背景图 → 全部 `onload` 后标记 `ready` 并预烘焙子弹贴图 → 才能进标题页。加载期的 `LOADING…` 是 `index.html` 里的静态 `div`，不参与 Canvas。

**版本串（`?v=`）是硬性要求**：`index.html` 8 处 + `assets.js` 里拼一次。漏一处的症状不是报错，而是"版本号是新的、画出来还是旧的"——因为浏览器把 `sprites.png` 缓存住了，而 `atlas.js` 的帧坐标已经更新，表现为全屏精灵错位。

---

## 4. 主循环

`Game.start()` 里一个 `loop(ts)` 函数，结构是"固定步长更新 + 每帧绘制 + 异常隔离"：

```js
const raw = (ts - this.last) / 1000;
const dt = Math.min(0.1, raw);      // 单帧最大 0.1s，切回前台不追命
this.acc += dt;
while (this.acc >= STEP && guard++ < 5) {   // STEP = 1/60
  this.update(STEP);                        // 逻辑永远按 1/60 推进
  this.acc -= STEP;
}
this.draw();                                // 绘制跟着 rAF 的实际频率
```

四个设计点：

1. **逻辑与绘制解耦**。逻辑固定 1/60，物理/碰撞/计时不会因为掉帧而变速；绘制随 rAF，掉帧只影响画面流畅度。
2. **追帧上限 5 步**。一次卡顿后最多补 5 帧，剩下的直接丢弃（`acc` 继续累积到下一帧），避免"越卡越追、越追越卡"的死亡螺旋。
3. **`dt` 夹到 0.1**。切后台再回来，`raw` 可能是几十秒，不夹的话一帧要跑上千步。
4. **`update` / `draw` 各自 try-catch**。异常进 `_onCrash()` 记 `crashCount` 并继续跑，不白屏；冒烟脚本就是靠这个字段判失败。

另有 **1 秒看门狗**（`setInterval`）：切后台或异常导致 rAF 静默停掉时自动重启循环，`document.hidden` 期间跳过。

---

## 5. 渲染

### 5.1 分辨率与适配

- 逻辑坐标恒为 **480×854**（9:16），代码里所有坐标都按这个算，不写设备像素。
- `resize()` 做两件事：① 算 `scale = min((innerW-8)/480, (innerH-8)/854)` 设 CSS 尺寸；② 把 canvas 的 backing store 按 `min(2, devicePixelRatio)` 放大，再 `ctx.setTransform(s, 0, 0, s, 0, 0)`，这样绘制代码仍然用逻辑坐标，但输出是视网膜清晰度。
- DPR 封顶 2：3 倍屏上再往上加只多耗填充率，肉眼几乎无差。

### 5.2 绘制顺序

没有场景图、没有 zIndex。**顺序由 `Game.draw()` 里的显式调用顺序决定**，要调层就得改那几行的先后：

```
震屏 translate（包在 save/restore 内，只作用于世界层）
├─ _drawBg            滚动背景 + 70 颗视差星
├─ BOSS 战 / 通关压暗
├─ 拾取物 → 敌机 → 蛇 → BOSS
├─ 子弹 → 保险投掷物/特效 → 粒子 → 阵亡残骸
└─ 玩家 → 玩家激光 → 碰撞盒
restore（震屏结束）
├─ _drawArcs          电弧（画在震屏之外，避免长线条抖动时端点错位）
├─ 预警标记 + HUD
├─ 结算/标题 overlay
└─ 版本号 · 声音按钮 · 调试面板 · 受击红晕 · 保险白闪
```

**为什么"震屏只包世界层"**：HUD、版本号、按钮跟着晃会让人找不到按钮；而受击红晕、白闪这类全屏效果必须铺在最上面。

### 5.3 绘制预算

- 同屏活跃子弹通常几十颗（冒烟抽样 5~30），每颗一次 `drawImage`（预烘焙的小图），不做实时渐变。设计上限按 150 控——再往上单帧绘制会开始吃掉填充率。
- 粒子池 520，同屏活跃通常一两百以内，每个是一次 `arc` 填充或 `drawImage`。
- 背景是**单张 480×854 的 png 纵向平铺两次**（`drawImage` 两次 + 一个坐标取模），不是瓦片地图。
- 混合模式只在局部用 `globalCompositeOperation = 'lighter'`（发光、电弧、护盾），大面积叠加在低端设备上填充率吃不消。

---

## 6. 对象池

`Bullet` / `Particle` / `Pickup` / `Enemy` 全部是**定长数组 + 布尔 `active`** 的复用对象，没有真正的运行时分配：

| 池 | 容量 | 备注 |
|---|---|---|
| `bullets` | 680 | 玩家 + 敌方共用，靠 `b.friendly` 区分 |
| `enemies` | 120 | 3.28 从 90 上调：后期同屏峰值 70~80，池子见底会**静默少放怪** |
| `particles` | 520 | |
| `pickups` | 48 | 3.29 从 32 上调：四周补给放开后"掉了但没生成" |

取用是线性扫描 `arr.find(o => !o.active)`。定长数组 + 线性扫在这个量级（百级）比对象池索引管理更简单，也比每次 `new` 更便宜。

**代价是 `init()` 必须逐项复位**。池对象最典型的故障不是崩溃，而是"上一只的状态漏到下一只身上"：3.30 的"BOSS 分身隐形但打得掉"就是 `Enemy.init()` 漏清 `snakeLink`，而 `Enemy.draw()` 见到它就整只跳过。约定：**任何"外部置位、`draw`/`update` 里读"的字段，必须在 `init` 里给默认值**。

容量见底时的行为是**静默失败**（`spawn` 直接 return），不报错。所以调高同屏上限时必须同步加池子。

---

## 7. 资源系统

### 7.1 图集

所有精灵打在一张 `assets/sprites.png`（1907×474，25 帧）里，帧表是 `js/atlas.js` 的 `ATLAS`：`{ 名字: [x, y, w, h] }`。绘制走 `Assets.draw()`，内部是九参 `drawImage(sheet, sx, sy, sw, sh, dx, dy, dw, dh)`。

`atlas.js` 与 `sprites.json` 都是 `tools/gen_assets.py` 的输出，**不要手改**：手动改坐标会和 png 错位，而错位的表现是"整屏精灵都画错地方"，看起来像图坏了。

### 7.2 子弹贴图预烘焙

`Assets._buildBullets()` 在加载期用**离屏 canvas** 给每种子弹画一遍 `radialGradient`（核心亮斑 + 光晕 + 透明边），存成小图。运行时 `drawBullet()` 只做 `drawImage`。

为什么不实时画：一帧建 150 个渐变对象，在低端设备上直接掉到 30fps。这是本项目里唯一一处"空间换时间"的批量优化。

宽头弹（`wide`）走的是同一函数里的 `makeBar(54, 20)`：它是一道横向能量刃，通用 `make()` 的椭圆核铺在横向画布上仍像个扁球，所以单独用"横向线性渐变 + 两端收尖"烘焙。

**动感不靠贴图，靠 `Bullet._tempFx()`**（3.42）：追踪弹的三层尾焰、宽头弹的同形状残影与吞弹白闪都在这里画，调用点在 `Bullet.draw` 贴图之前。它只使用路径和**重复绘制已烘焙贴图**，全流程不新建渐变——每帧为十几颗子弹建渐变是这类特效最容易悄悄吃掉帧数的写法。

**尾焰有自己的一套朝向**（3.44）：`Bullet.rot` 是弹体，`Bullet.trailA` 是火焰。后者每帧朝实际速度方向做一阶低通（时间常数约 0.17s），转弯时两者夹角可达 0.6~0.9 rad。绘制时把这段夹角换算到弹体本地坐标——末端落在 `(-len·sinδ, len·cosδ)`，中间用二次贝塞尔连接——于是火焰从喷口出去、逐渐被甩向弯道内侧，成一条弧；三层再各乘 1.35/1.0/0.6 的滞后系数，外侧低速余焰甩得最开、内芯紧跟喷口，转弯瞬间看起来是"撕开成扇形"。若直接 `ctx.rotate(rot)` 后画一段直线锥形，火焰就会跟着弹体贴图整体刚性旋转，那是转弯"生硬"的唯一来源。

### 7.3 背景

9 张 512×512 的 png，每关一张，`_drawBg()` 里按 512px 高度纵向无缝平铺（`bgScroll % 512`，铺满 854 高需要 2~3 片），再叠 70 颗 `lighter` 混合的视差星点 + 一层中心提亮的径向渐变（用来压住平铺接缝）。滚速由关卡配置控制。

---

## 8. 音频

`js/audio.js` 是一个两百多行的 `SFX` 单例，**不含任何音频文件**，全部实时合成：

| 原语 | 实现 | 用途 |
|---|---|---|
| `_tone(freq, dur, type, gain, slideTo)` | `Oscillator` + `Gain` 包络（8ms 上冲、指数衰减） | 射击、拾取、UI、报警 |
| `_noise(dur, gain, freq, q)` | 白噪声 `AudioBuffer` + `BiquadFilter` 带通 | 爆炸、撞击、破盾 |

工程约束：

- **`master.gain = 0.22`**，不是 1。合成音是"裸正弦/方波"，满幅会刺耳；0.22 留出叠加余量（一帧内可能同时有八种音效）。
- **必须用户手势后才能播**。`init()` 在首次 `pointerdown` / `keydown` 里调用；`ctx.state === 'suspended'` 时 `resume()`。这在移动端是硬限制，不是 bug。
- **限流 `_gate(key, ms)`**：每个音效各自配阈值（射击 40ms、狙击蓄力 110ms 等），同一音效在阈值内不重复触发，否则密集弹幕会糊成一段噪声。
- **总开关走 master 增益**，用 `setTargetAtTime` 做 20ms 淡入淡出，避免"咔"的爆音；已经在排程的音也会一起收掉。

---

## 9. 输入

统一用 **Pointer Events**，一套代码同时覆盖鼠标、触屏、手写笔。

| 输入 | 处理 |
|---|---|
| 拖动飞机 | `pointerdown` 记录 `pointerId` 并进入拖拽；`pointermove` 只在 `e.pointerId === input.pointerId` 时响应 |
| 键盘 | `←→↑↓` / `WASD` 移动；`Q` 循环切槽、数字键 `1~4` 精确切槽；`X`/`B` 普通保险、`C`/`V`/`L` 激光保险；`Esc`/`P` 暂停；`Space`/`Enter` 开始与续关（**开火是自动的，没有开火键**） |
| HUD 按钮 | 保险、激光保险、声音、暂停、武器槽、`DEV` 面板——热区坐标与绘制**共用一份常量**（`BOMB_BTN` / `PAUSE_BTN` / `SLOT_UI` 等），改位置只改一处 |
| 暂停按钮（3.41） | HUD 右上角血条下方的小圆，只负责"进暂停"；恢复仍是点击屏幕任意处。判定要排在"暂停中任意点击恢复"之前，否则暂停里点它等于没点 |
| 后台暂停 | `document.hidden` 时自动 `paused = true` |

**`pointerId` 是必须的**：输入只有一个 `pointerActive`，`pointerup` 又不看是谁抬的手。一只手拖飞机、另一只手点保险，抬保险那根手指就会把拖动状态清掉，玩家感受是"飞机卡住，要重新触屏"。所以 `input.pointerId` 记控制权归属，`pointermove` / `pointerup` 都要先比对它；新增触屏控件的按钮分支必须**在赋值之前 return**，不能抢走控制权。

---

## 10. 存档

只有最高分，键 `HI_KEY = 'raiden-lite.hi.v1'`。

- 每帧在状态机之外更新内存值（`_updateHiScore`），否则"通关 +2000 分"那句结算不算进去。
- 写盘做 1.2 秒节流，失败/通关时立刻落盘。
- **读不到存储（隐私模式 / 禁用存储）必须当 0**：一个记录分数不能把游戏搞崩。

---

## 11. 代码分层

没有引擎的"节点树/组件系统"，但职责划分是按引擎的思路来的：

| 文件 | 角色 | 类比 |
|---|---|---|
| `config.js` | 纯数据。所有数值、表、常量 | 配置表 + 预制体参数 |
| `entities.js` | 单个对象**自身**的行为：移动、绘制、受击 | 组件 |
| `levels.js` | 编队几何、BOSS 弹幕模式、判定轮廓 | 关卡资产 + 行为树 |
| `game.js` | 状态机、碰撞结算、投放、HUD、主循环 | 系统调度器 / 场景 |
| `assets.js` + `audio.js` | 资源与音效 | 引擎的 Resource / Audio 模块 |

**状态机**：`title → intro → warn → play → boss → clear → (下一关 | win) / gameover`。

一条重要纪律：**状态分支要共用更新入口**。按 `state` 分叉时，别在每个分支各抄一份"要更新什么"——保险/激光/冲击环/冷却统一走 `_updateBombSystems(dt)`，四个战斗状态都调。3.20.4 就是预警分支漏抄，导致炸弹挂在半空、特效定格。

**数据驱动**：加一种敌机 = 在 `ENEMY_DEFS` 加一条 + 图集里加一帧；加一层波次 = 在 `LEVELS[].waves` 加一行。逻辑代码里基本不出现具体数字——这是"能用配置解决就不加抽象层"的落地方式。

---

## 12. 工具链

不在运行时，但在同一个仓库里：

| 脚本 | 依赖 | 作用 |
|---|---|---|
| `tools/gen_assets.py` | Pillow + numpy | 程序化生成全部美术：21 个精灵 + 9 张背景。4× 超采样后降采样，保证小尺寸下边缘干净；同时写出 `sprites.png` / `sprites.json` / `atlas.js` / 验收图 |
| `tools/gen_boss_hull.py` | Pillow | 读 BOSS 贴图的 alpha 通道，自动算多圆判定轮廓 → `levels.js` 的 `BOSS_HULL` |
| `tools/balance_sim.py` | 纯 Python | 九关数值模拟：漏怪率、同屏峰值、清场耗时。改 `density` / `bossHp` / 护盾数值后必跑 |
| `tools/smoke.py` | Playwright + Chromium | 真实渲染跑 3 关 × file/http 两条通道，抓 `pageerror`、截图、读 `fps` 和 `crashCount` |

**发版流程**（4 步，缺一步就会出"改了但没生效"）：

```bash
# 1. 版本号两处同步：config.js 的 VERSION + index.html 8 处 ?v=
# 2. 语法检查
for f in js/*.js; do node --check "$f"; done
# 3. 冒烟 + 平衡
python3 tools/smoke.py
python3 tools/balance_sim.py
# 4. 打包 + 上传静态托管
zip -qr raiden-lite-<V>.zip raiden-lite -x "*/__pycache__/*" "*.png.bak"
```

没有 `npm run build`，因为确实没有"构建"这一步。

---

## 13. 性能

目标 **60fps @ 480×854**。实测（Playwright + SwiftShader 软件渲染，抽测第 1/5/9 关）稳定 60fps —— 这是偏保守的下限，软件渲染都能满帧，真机 GPU 只会更宽裕。

已知的性能红线：

| 红线 | 原因 | 对策 |
|---|---|---|
| 每帧新建渐变 / 每帧 `new` 对象 | GC 抖动，帧时间毛刺 | 子弹贴图预烘焙；全部对象池 |
| 大面积 `globalCompositeOperation='lighter'` | 低端 GPU 填充率 | 只用于小面积光效 |
| 同屏子弹 > 150 | 每颗一次 `drawImage` + 碰撞遍历 | 池子封顶 680，弹幕设计控制在 150 以内 |
| 碰撞用 O(n×m) 双层循环 | 无网格加速 | 量级可接受（弹 ~150 × 敌 ~80），暂不引入空间划分 |

碰撞全部是**圆-圆距离平方比较**（`dist2`，不开方）+ BOSS 的多圆近似；只有 BOSS 本体用矩形。判定与绘制**必须同步**：`_drawHitboxes()` 是调试层，约定是"每一条真实判定都要画出来"，改了判定不更新它，这个开关就会骗人。

BOSS 出场无敌期（`boss.invuln`）**不是关掉碰撞**：`_collide` 里它走独立分支——照常调 `_bossHits()` 判命中、消耗子弹、`boss.barrierHit()` 记一圈涟漪、溅冷色火花，只跳过扣血。这样"打不动"和"打不到"在观感上是两件事，后者会被玩家当成 bug。分支写成 `if (invuln) {...} else if (boss) {...}` 而不是 `if (invuln) continue`：那条 `continue` 会连后面打小怪的循环一起跳过（第 7 关 BOSS 退场召唤期间援军就永远打不掉）。

---

## 14. 技术债与迁移评估

**现有取舍**（不是 bug，是明确选择的）：

- 无模块系统 → 全局命名空间，靠加载顺序。文件数涨到十几个之前够用，再涨就该上 ESM 了（不需要 bundler，浏览器原生支持）。
- 无类型 → 靠 `config.js` 的集中数值 + 命名约定。TS 化收益主要在 `entities.js`（3400 行）里，但要引入构建步骤。
- 无场景图 → 层序写死在 `draw()` 里。STG 的层序本来就固定，硬编码反而更可控。
- 无对象池索引 → 线性扫 `find(o => !o.active)`。百级容量下可接受。

**迁移到手环（Vela 快应用）需要面对的真实差异**：

| 项 | 浏览器版 | 手环版 |
|---|---|---|
| 渲染 | Canvas 2D | 快应用的 canvas 组件，能力子集，需逐项核对 `globalCompositeOperation` / `filter` |
| 音频 | WebAudio 实时合成 | 通常只能播短音频文件，"全合成"这条路走不通，需要预渲染成 pcm |
| 内存 | 无约束 | 图集要按关卡拆包，不能一次全载 |
| 输入 | Pointer + 键盘 | 触摸/表冠，热区要重排（480×854 → 方屏或圆屏） |
| 存储 | localStorage | 快应用的 storage API，需要适配层 |

细节见 `../小米手环10-雷电Lite开发方案.md` 和 README 的「与手环版的差距」一节。
