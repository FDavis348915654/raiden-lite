# CODEBUDDY.md · 项目记忆

> 这份文件是该项目的**项目级记忆**：AI 助手在每次会话开始时自动加载。
> 只写"不用每次重复交代"的稳定信息——项目结构、命令、硬性约定、踩过的坑。
> 临时任务、当天的调试细节不要写进来（会挤占上下文，也很快过期）。

## 项目定位

竖版卷轴射击游戏（STG），9 关、19 种敌机、9 个多阶段 BOSS。
纯静态前端：**零构建、零依赖、零外部素材** —— 美术由 Python 脚本程序化生成，音效由 WebAudio 实时合成。

- **项目根 = `/workspace`**（git 仓库根），游戏工程在 `raiden-lite/`
- 线上试玩：<https://a7e93b2aed1fb636c.app.workbuddy.host/?sharecode=QFXRKQOU2C>
- 目标平台：先跑通浏览器，后续按 `小米手环10-雷电Lite开发方案.md` 移植到小米手环 10（Vela 快应用）

## 目录与职责

| 路径 | 管什么 | 不该放什么 |
|---|---|---|
| `raiden-lite/index.html` | 唯一入口，7 个 script 按序加载，全部带 `?v=<VERSION>` | 逻辑 |
| `raiden-lite/js/config.js` | 所有**数值**：VERSION / PLAYER / WEAPONS / OVERDRIVE / DROPS / ENEMY_DEFS / LEVELS（含 hint 与解锁表）/ SNAKE | 逻辑 |
| `raiden-lite/js/entities.js` | 单个对象自身行为：Bullet / Particle / Pickup / Player / Enemy / Boss | 全局状态、波次调度 |
| `raiden-lite/js/levels.js` | 编队几何（spawnFormation）、BOSS 弹幕（BOSS_PATTERNS）、判定轮廓（BOSS_HULL） | 通用敌人 AI |
| `raiden-lite/js/game.js` | Game 类：状态机、碰撞结算、掉落/补给投放、HUD、调试面板 | 具体弹道形状 |
| `raiden-lite/js/assets.js` | 图集与背景加载，**必须拼 `?v=VERSION`** | — |
| `raiden-lite/js/atlas.js` | 自动生成，**不要手改** | — |
| `raiden-lite/assets/` | 程序化生成的贴图；`sprites.png` 由脚本重排，手改会错位 | — |
| `raiden-lite/tools/` | 生成与验证脚本（见下） | 运行时代码 |

加载顺序（倒过来会 undefined）：`config → audio → atlas → assets → entities → levels → game`

## 常用命令

```bash
# 跑游戏：直接开文件，或起静态服务
open raiden-lite/index.html
cd raiden-lite && python3 -m http.server 8232

# 冒烟测试（Playwright，3 关 × file:// 与 http 两个通道，出截图并抓控制台错误）
cd raiden-lite && python3 tools/smoke.py

# 改了美术之后重新生成图集（会改写 assets/ 与 atlas.js）
cd raiden-lite && python3 tools/gen_assets.py

# 改了 BOSS 贴图后重算多圆判定
cd raiden-lite && python3 tools/gen_boss_hull.py

# 调数值后看漏怪率 / 同屏峰值
cd raiden-lite && python3 tools/balance_sim.py
```

## 改完必做：版本号两处同步

1. `js/config.js` 的 `VERSION`
2. `index.html` 里 **8 处** `?v=`（7 个 script + 1 个 css，用 `sed -i 's/?v=<旧>/?v=<新>/g'` 一把换完再 `grep -c` 核对）

漏掉任何一处，浏览器会命中旧缓存，症状是"版本号是新的、画出来的还是旧的"。

## 发版流程

```bash
# 1. 冒烟
cd /workspace/raiden-lite && python3 tools/smoke.py

# 2. 打包（命名固定，旧版本包删掉）
cd /workspace && rm -f raiden-lite-<旧版本>.zip
zip -qr raiden-lite-<新版本>.zip raiden-lite -x "*/__pycache__/*" "*.png.bak"

# 3. 发布线上（同一个链接，覆盖更新）
node /root/.codebuddy/skills/sites/scripts/publish.js --dir /workspace/raiden-lite --language static
```

## Git 约定

- **只在用户说"备份"时提交**，平时改代码不乱 commit
- 动手前先 `git pull --rebase`（仓库已配 `pull.rebase=true` + `rebase.autoStash=true`，`git sync` 是别名）
- 提交作者固定：`FDavis348915654 <348915654@qq.com>`
- 推送用沙箱里的 SSH deploy key，**只对这一个仓库有权限**
- `.gitignore` 已排除：`*.zip`、`__pycache__/`、`.codebuddy/`、`.cloudstudio`、`*.png.bak`、编辑器文件
- 提交信息写清"改了什么 + 为什么"，中文

## 硬性约定与已知的坑

- **判定与绘制必须同步改**。`_drawHitboxes()` 是调试可视化层，约定是"每一条真实判定都要画出来"，改了判定不更新它，这个开关就失去意义
- **BOSS 命中判定有两处**：玩家撞机（`_collide` 末尾）与子弹命中（子弹循环内，传 `includeParts=false`）。只改一处会出现"画了圆但子弹仍打矩形"
- **`sprites.png` 必须带版本串加载**，否则图集坐标更新后仍裁旧图，表现为全屏精灵错位
- **`assets/` 是生成物**：改美术走 `gen_assets.py`，不要手动改 PNG 或 `atlas.js`
- **纯全局脚本，无模块系统**：新增文件要在 `index.html` 里按顺序加 `<script>`，且带 `?v=`
- **对象池复用**：`Bullet` / `Particle` / `Pickup` / `Enemy` 都是池对象，跨帧持引用前先确认它没被回收
- **新增小 BOSS 必须进 `MINI_KINDS`**（`config.js`，配 `isMiniKind()`）：所有"这是不是小 BOSS"的判断都走它——波次密度加成、车道分配、`_trackMiniBoss` 的收尾判定、击破补给。漏一处就出"3 架变 6 架""小 BOSS 死光却永远不进 BOSS"。新机型设 `ai:'miniboss'` + `mb:'sniper'|'prism'|'ram'` 复用爬升/巡游/血条，开火差异写在 `Enemy._mbFire()`
- **关卡节奏按"每关 2~3 种新单位"排**：`LEVELS[].waves[].at` 在 `startLevel` 里会 `sort` 并按 `WAVE_TUNE.timeScale` 压缩、每波自动插一支 60% 数量的换编队补充波，所以表格里 `at` 写成段落顺序即可，不用手算实际秒数。一关塞 5 种以上新单位（3.25 之前的第 2 关塞了 9 种）玩家来不及消化，后几关又没新东西；改关卡时先数"本关新机型"数量再看数值
- **`LEVELS[].hint` 是开场 banner 的第三行**：新单位第一次露脸时点名（"新威胁 · 潜伏者 · 狙击机"）。加了新机型不写 hint，玩家只会觉得"屏幕里多了个色块"，不知道该防什么
- **难度曲线的四个旋钮**：`LEVELS[].density`（3.28 起 1.30 → 2.38 逐关跳档，后期靠它变挤）、`eliteChance(id)`（4% → 21%，精英 3.2 倍血 + 掉一份高价值道具）、后期多插一轮小 BOSS（同屏上限 3，必须给 `lane`）、`bossHp` + `bossRate`（BOSS 弹幕间隔倍率，0.84 = 出招快 19%，乘在 `BOSS_PATTERNS` 返回值上）。调难度优先动这四个，**别改 `ENEMY_DEFS` 的全局血量**——那会把前八关一起改
- **武器与道具的解锁关在两张表里**：`WEAPONS[].from`（3.28 起**每关 +2 把**，第 5 关集齐 9 把）与 `DROPS[].from`（前两关只掉 P/W/B/H；临时增益按 `TEMP_FROM` 从第 3 关起逐个解锁）。**掉落判定必须走 `dropTable(level.id)` 而不是直接遍历 `DROPS`**，否则前期就会掉护盾、宽头弹这类"改变打法"的道具，把基础课盖掉
- **道具有三个来源，调任何一个都要一起看**：击破掉落（`dropTable`，3.30 起总掉率 8%→22%，W 6.0→3.0、P 0.9→0.6，省出来的份额给临时增益）、每关固定 `supply` 表（主题时刻，深海要浮上来、峡谷要弹一下）、四周补给（`EDGE_SUPPLY` + `edgeSupplyGap`，每 7.4~12.3 秒从四条边随机进一份）。P 一次升全槽，是等级线的总闸门——4 瓶就能把四把枪从 L1 顶到 L5，所以它必须是全表**最稀有**的常驻条目；3.28 时它独占掉落的 40%，实战两关就全槽满级，后面七关的火力线等于不存在
- **临时增益的解锁关只有 `TEMP_FROM` 一份**（S 3 / T 4 / D 5 / A 6）：`DROPS[].from`、`EDGE_SUPPLY[].from`、BOSS 空投的候选池都按它过滤。改解锁关时三处必须一起改，否则会出现"第 3 关 BOSS 空投了一件宽头弹"
- **`DROPS` 的 `w` 是百分数，换算成 0~1 只在 `dropTable` 里做一次**：3.29.1 之前它把百分数原样返回（`upto` 是 3.0），而判定写 `Math.random() < upto`，恒真 —— 表现是"每架敌机必掉一瓶 P"，不报错、不崩，只是某样东西满地都是。新增任何按权重抽取的表（`EDGE_SUPPLY`、`eliteChance`、`pickWeaponIdx`）都要确认随机数与权重单位一致
- **精英掉落是隐藏的大水龙头**：`eliteChance` 后期 21%，一关四十多只；3.28 的"每只双掉落"等于一关白送近百件道具，压普通掉率会被它抵消。3.29.1 改成"一份高价值（W/B/P 加权）+ 残血补 H"，改精英相关数值时先算这条路的总量
- **左右入场的道具走 `Pickup.dirX` 而不是 `dir`**：出界回收、触边反弹都按 `dir` 判定，混用会让横穿屏幕的道具在屏幕外就被判成"掉出底边"回收；横穿时也不能 `clamp(x, 20, W-20)`，否则第一帧就被拽进画面
- **W 道具抽武器必须走 `pickWeaponIdx(stageId, player.weapons)`**：权重是"本关新解锁 ×6 / 未拥有 ×3 / 已拥有 ×1"。纯随机（`pick(unlockedWeapons(id))`）在武器池涨到 9 把后，新枪只有 1/9 概率，一整关可能一次都见不到——解锁等于没解锁
- **冲角型（`mb:'ram'`）的状态机必须排在 `case 'miniboss'` 的最前面**：俯冲会让 `y` 越过 216，而 `y > 216` 那条分支是"还在从底部爬升"，会把俯冲当爬升拽回去，表现为原地抖动、永远冲不下来
- **蛇是数组 `this.snakes`**：`n:1` 单条（第 8 关首秀）、`n:2` 双条（第 9 关压轴，一正一反沿环路游走、第二条走内圈 `_snakePath(inset)`）。`killSnake(head)` 必须按 `head` 引用找控制器，不能取 `[0]`；蛇身被剪时的 `splice` 也要逐条找
- **蛇的每个关节都是一份"计分件"**（3.31）：关节血量≈头（8 节 ×860 / 双蛇 7 节 ×1040），头 2800 分、每节 1000 分——啃干净身体的总分刻意高于直接爆头，爆头时剩下未死的节**不计分**（`killSnake` 只是 `active=false`）。三条路都不许"秒掉整条"：保险走 `bombSnakeDmg`(头 180) / `bombSnakeSegDmg`(节 90)，撞机对 `ai==='snake'` 完全不掉血。暴走按**身体掉血比例**（`rage.lostBody` 0.30）判定，别改回"掉了 N 节"——关节血量拉高后那个门槛永远够不到，`SERPENT ENRAGED` 会变成死代码
- **`Enemy` 是池对象，`init` 必须重置"只由外部写入"的标记**：`snakeLink` 是 `game.spawnSnake` 在 `init` 之后置的 true，而 `Enemy.draw()` 见到它就整只跳过（蛇要整体画成连续一条）。3.30 之前 `init` 没清它 —— 第 8 关先跑过一波蛇、蛇被击破，池里那 8 个对象再被复用作 BOSS 分身时就成了**看不见但打得掉**的幽灵。以后新增任何"外部置位、draw/update 里读"的字段，都要在 `init` 里给默认值
- **入场保护 `ENTRY_GUARD`（3.30）**：敌机在贴图露头之前免疫，且**子弹直接穿过不消耗**（`game._updateBullets` / `plasmaBoom` / `chainLightning` / 撞机循环全部 `continue`）。只在 `hit()` 里 return 是不够的——子弹会被看不见的敌机吃掉，玩家看到弹幕凭空消失。露头判定用"贴图下沿 > 8px"（不是 `PLAY_TOP`，HUD 下方那段已经看得见了），露头后再按机型给 0.1~0.34s 缓冲（小快机短、大慢机长），`max 3.0` 兜底防止绕边单位永久无敌；从底部升起的单位走 `SPAWN_GUARD`，`buf` 配 0 不叠加
- **偏折面（`deflect`）是三处联动**：判定在 `game._deflect()`（**必须早于本体命中**，否则拨开又立刻结算一次伤害，机制变成纯特效）、视觉在 `Enemy.draw()` 的透镜弧、调试线框在 `_drawHitboxes()`。耐久按"还能拨几发"算（`cap`），拨空过载 `down` 秒
- **狙击弹的 `snipe` 必须透传**：`spawnEnemyBullet(x,y,vx,vy,{snipe:{delay,speed}})` 里少写一个字段，它就会退化成一颗普通慢弹、永远不加速——和 `wideBlock` 那次同一类静默失效
- **触摸输入必须带 `pointerId`**：输入只有一个 `pointerActive`，`pointerup` 又不看是谁抬的手 —— 一只手拖飞机、另一只手点保险/声音，抬手指就会把拖动状态清掉，表现为"飞机卡住，要重新触屏"。`input.pointerId` 记的是控制权归属，`pointermove` / `pointerup` 都要先比对它。以后加任何新的触屏控件，注意别让它抢走控制权（按钮分支要在赋值之前 return）
- **状态分支要共用更新入口**：`_update()` 里按 `state` 分叉时，别在每个分支各抄一份"要更新什么"。保险/激光/冲击环/冷却统一走 `_updateBombSystems(dt)`，`play`/`boss`/`warn`/`clear` 都调 —— 3.20.4 就是预警分支漏抄，导致炸弹挂在半空、特效定格。同理，判断"能不能按保险"只认 `_canUseBomb()`，不要在 `onDown` 里另写一份状态列表
- **武器槽 / 冷却 / 等级三张表必须同步动**：`weapons`、`slotT`、`lv` 是并行数组（3.28 起 `lv` 承载每把枪独立的火力等级，`player.power` 已删除）。伤害按位置（`SLOT_DMG`）、冷却按位置（`slotT`）、等级按位置（`lv`）。`switchWeapon` 轮转、`addWeapon` 满槽替换都必须三处一起 `shift`/`splice`，只搬前两个就会出现"新枪继承旧枪的等级 / 剩余冷却"。切上主位的冷却要压到 0.06s，否则切枪像卡顿
- **火力等级的三条变化路径**：P 道具 → 所有已装武器各 +1（`_collectPickups` 里循环 `p.lv`）；同款 W → **只有那一把** +1（`Player.addWeapon`），满级再吃转全弹发射；中弹 → 所有槽各 -1（`Player.hit`，最低 1 级）。新枪入场取主武器等级。改任何一条都要同步 HUD（`_drawWeaponSlots` 里每槽画 `L{lv}`，满级暖色）
- **新增武器必须补 `OVERDRIVE.shapes`**：全弹发射按 `weapons[0]` 的 `id` 查表，缺项会静默回落到 `vulcan` 那一套，症状是"换了枪还是火神炮的环"
- **改槽数要三处一起改**：`WEAPON_SLOTS`（config）、`SLOT_DMG`（长度必须 ≥ 槽数，否则 `SLOT_DMG[s]` 是 `undefined` 被 `|| 1` 兜成满伤害）、`fireSlot` 里的出膛偏移（只有 4 个横向位置可用，第 4 槽改纵向抬高）。数字键上限已改为按 `WEAPON_SLOTS` 推导，HUD 与点槽命中也都是循环 `WEAPON_SLOTS`，不用另外改
- **`spawnPlayerBullet` 的 opt 是白名单**：新加的子弹字段必须在里面逐个透传，否则静默丢失。3.23 的 `wideBlock` 就漏过——宽头弹变成一颗普通大弹、吞不了敌弹，而且不报错
- **敌弹的判定半径统一在 `spawnEnemyBullet` 里乘 `ENEMY_BULLET_HIT_K`（0.72）**：调用点传的 `r` 是"视觉基准"，不是最终判定。新增弹幕时照旧传 6/10/14，不要再手动打折（会变成二次收缩）；要调整全局擦弹手感只改这一个常量，`_drawHitboxes` 会自动跟着画对
- **临时增益（`shield` / `tempWpn` / `tempAlly`）不占武器槽**：它们由 `Player._updateTemp(dt, game)` 统一推进，开火也直接走 `game.spawnPlayerBullet`，别塞进 `weapons` 数组（否则会被 `SLOT_DMG` 打折、被切枪轮转、被满槽替换挤掉）。新增"玩家可操作"的状态分支时，这条更新链不能漏
- 性能目标：60fps（480×854 画布），改动后跑一次冒烟看 `fps` 字段

## 协作偏好

- 先给方案让用户确认，再动代码；需求模糊时先问清楚，不要猜着实现
- 拒绝过度设计：能用配置解决就别加抽象层
- 分阶段推进：低风险项先验证，高风险项先确认方案
- 中文交流，注释写"为什么"而不是"做了什么"；不要 emoji
- 结论要自己验证（跑测试 / 截图 / 读源码），不接受"看起来应该没问题"
