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
| `raiden-lite/README.md` | 玩家向文档：玩法、道具、敌机、BOSS、调数值 | 架构细节 |
| `raiden-lite/TECH.md` | 技术实现说明：选型、主循环、渲染顺序、对象池、资源、音频、输入、工具链、迁移评估 | 玩法数值（引用 config.js） |

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
- **拆 BOSS 炮台连带本体掉血**（3.49）：`onBossPartDestroyed()` 里给 `boss.hit(boss.maxHp * PLAYER.bossPartKillRatio, this, { raw: true })`。三条硬规矩：①必须 `!boss.dead` 守卫——本体可能刚被最后那一发打死，再进 `hit()` 会第二次调 `onBossDying`；②`raw` 用来跳过护盾轮转（3.53 起是真挡，之前是 28% 减伤），这是"炮塔炸开撕开舰体"，不是一次命中。眼下带部件的只有 boss6/boss7 且都没有轮转盾（只有 boss3 有），所以这个 flag 是空跑，但谁以后给它们加了 `shield: true`，拆炮台就会静默打不进去；③保险路径（`_bombBoom` → 同一个回调）也会走这条，一颗雷炸两门 = 16% + 160，属刻意设计，别为了"削弱保险"单独把它禁掉。比例形态是刻意的（不是定值）：第 6 关 6300 血、第 9 关 7500，定值在后期等于没有。
- **BOSS 出场保护分两种**（3.46，`LEVELS[].bossEntry`）：`open` 出场即可打（只给第 1、2 关——那时玩家火力线还没成型，空等 3 秒会让第一场 BOSS 战很空）；`invuln`（默认）下降 2.8s + 到位 0.6s 打不动，但**子弹要弹开**——照常判定命中、消耗子弹、`boss.barrierHit()` 荡一圈涟漪、溅冷色火花，只是不结算伤害。三条硬规矩：①**无敌期不许再写成整块跳过**（`if (bo.invuln) continue` 那种），子弹穿过舰体不留痕迹，玩家只会觉得"打了个寂寞"；②这个分支的 `continue` 会顺带跳过下面打小怪的循环，第 7 关 BOSS 退场召唤期间援军就打不掉、BOSS 永远不回来——所以用 if/else 而**不是** continue；③无敌期靠**旋转虚线的能量膜**解释"为什么打不动"，不要再用"把机体画成半透明"（读起来像贴图没加载完）。保险（`_bombBoom`）同样吃 `!bo.invuln` 这一条，否则一颗雷能在演出席里炸掉 BOSS 的血
- **`sprites.png` 必须带版本串加载**，否则图集坐标更新后仍裁旧图，表现为全屏精灵错位
- **`assets/` 是生成物**：改美术走 `gen_assets.py`，不要手动改 PNG 或 `atlas.js`
- **纯全局脚本，无模块系统**：新增文件要在 `index.html` 里按顺序加 `<script>`，且带 `?v=`
- **对象池复用**：`Bullet` / `Particle` / `Pickup` / `Enemy` 都是池对象，跨帧持引用前先确认它没被回收
- **新增小 BOSS 必须进 `MINI_KINDS`**（`config.js`，配 `isMiniKind()`）：所有"这是不是小 BOSS"的判断都走它——波次密度加成、车道分配、`_trackMiniBoss` 的收尾判定、击破补给。漏一处就出"3 架变 6 架""小 BOSS 死光却永远不进 BOSS"。新机型设 `ai:'miniboss'` + `mb:'sniper'|'prism'|'ram'` 复用爬升/巡游/血条，开火差异写在 `Enemy._mbFire()`
- **关卡节奏按"每关 2~3 种新单位"排**：`LEVELS[].waves[].at` 在 `startLevel` 里会 `sort` 并按 `WAVE_TUNE.timeScale` 压缩、每波自动插一支 60% 数量的换编队补充波，所以表格里 `at` 写成段落顺序即可，不用手算实际秒数。一关塞 5 种以上新单位（3.25 之前的第 2 关塞了 9 种）玩家来不及消化，后几关又没新东西；改关卡时先数"本关新机型"数量再看数值
- **`LEVELS[].hint` 是开场 banner 的第三行**：新单位第一次露脸时点名（"新威胁 · 潜伏者 · 狙击机"）。加了新机型不写 hint，玩家只会觉得"屏幕里多了个色块"，不知道该防什么
- **难度曲线的四个旋钮**：`LEVELS[].density`（3.28 起 1.30 → 2.38 逐关跳档，后期靠它变挤）、`eliteChance(id)`（4% → 21%，精英 3.2 倍血 + 掉一份高价值道具）、后期多插一轮小 BOSS（同屏上限 3，必须给 `lane`）、`bossHp` + `bossRate`（BOSS 弹幕间隔倍率，0.84 = 出招快 19%，乘在 `BOSS_PATTERNS` 返回值上）。调难度优先动这四个，**别改 `ENEMY_DEFS` 的全局血量**——那会把前八关一起改
- **武器与道具的解锁关在两张表里**：`WEAPONS[].from`（3.28 起**每关 +2 把**，第 5 关集齐 9 把）与 `DROPS[].from`（前两关只掉 P/W/B/H；临时增益按 `TEMP_FROM` 从第 3 关起逐个解锁；`E` 加命也是第 3 关起）。**掉落判定必须走 `dropTable(level.id)` 而不是直接遍历 `DROPS`**，否则前期就会掉护盾、宽头弹这类"改变打法"的道具，把基础课盖掉
- **道具有三个来源，调任何一个都要一起看**：击破掉落（`dropTable`，3.30 起总掉率 8%→22%，W 6.0→3.0、P 0.9→0.6，省出来的份额给临时增益）、每关固定 `supply` 表（主题时刻，深海要浮上来、峡谷要弹一下）、四周补给（`EDGE_SUPPLY` + `edgeSupplyGap`，每 7.4~12.3 秒从四条边随机进一份）。**B（保险）在三条路线里都要压**（3.39 各砍一半：击破 2.6→1.3、四周 2.2→1.1、BOSS 空投 12%→8%）——它单条看着不高，但三路叠加一关能攒到七八颗，"什么时候用雷"就没有取舍了。P 一次升全槽，是等级线的总闸门——4 瓶就能把四把枪从 L1 顶到 L5，所以它必须是全表**最稀有**的常驻条目；3.28 时它独占掉落的 40%，实战两关就全槽满级，后面七关的火力线等于不存在
- **临时增益的解锁关只有 `TEMP_FROM` 一份**（S 3 / T 4 / D 5 / A 6）：`DROPS[].from`、`EDGE_SUPPLY[].from`、BOSS 空投的候选池都按它过滤。改解锁关时三处必须一起改，否则会出现"第 3 关 BOSS 空投了一件宽头弹"
- **`DROPS` 的 `w` 是百分数，换算成 0~1 只在 `dropTable` 里做一次**：3.29.1 之前它把百分数原样返回（`upto` 是 3.0），而判定写 `Math.random() < upto`，恒真 —— 表现是"每架敌机必掉一瓶 P"，不报错、不崩，只是某样东西满地都是。新增任何按权重抽取的表（`EDGE_SUPPLY`、`eliteChance`、`pickWeaponIdx`）都要确认随机数与权重单位一致
- **精英掉落是隐藏的大水龙头**：`eliteChance` 后期 21%，一关四十多只；3.28 的"每只双掉落"等于一关白送近百件道具，压普通掉率会被它抵消。3.29.1 改成"一份高价值（W/B/P 加权）+ 残血补 H"，改精英相关数值时先算这条路的总量。3.33 起"残血"的判据是 `player.hp < maxHp * 0.6`（H 已改成回血）
- **左右入场的道具走 `Pickup.dirX` 而不是 `dir`**：出界回收、触边反弹都按 `dir` 判定，混用会让横穿屏幕的道具在屏幕外就被判成"掉出底边"回收；横穿时也不能 `clamp(x, 20, W-20)`，否则第一帧就被拽进画面
- **W 道具抽武器必须走 `pickWeaponIdx(stageId, player.weapons)`**：权重是"本关新解锁 ×6 / 未拥有 ×3 / 已拥有 ×1"。纯随机（`pick(unlockedWeapons(id))`）在武器池涨到 9 把后，新枪只有 1/9 概率，一整关可能一次都见不到——解锁等于没解锁
- **冲角型（`mb:'ram'`）的状态机必须排在 `case 'miniboss'` 的最前面**：俯冲会让 `y` 越过 216，而 `y > 216` 那条分支是"还在从底部爬升"，会把俯冲当爬升拽回去，表现为原地抖动、永远冲不下来
- **蛇是数组 `this.snakes`**：`n:1` 单条（第 8 关首秀）、`n:2` 双条（第 9 关压轴，一正一反沿环路游走、第二条走内圈 `_snakePath(inset)`）。`killSnake(head)` 必须按 `head` 引用找控制器，不能取 `[0]`；蛇身被剪时的 `splice` 也要逐条找
- **蛇的每个关节都是一份"计分件"**（3.31）：关节血量≈头（8 节 ×860 / 双蛇 7 节 ×1040），头 2800 分、每节 1000 分——啃干净身体的总分刻意高于直接爆头，爆头时剩下未死的节**不计分**（`killSnake` 只是 `active=false`）。三条路都不许"秒掉整条"：保险走 `bombSnakeDmg`(头 180) / `bombSnakeSegDmg`(节 90)，撞机对 `ai==='snake'` 完全不掉血。暴走按**身体掉血比例**（`rage.lostBody` 0.30）判定，别改回"掉了 N 节"——关节血量拉高后那个门槛永远够不到，`SERPENT ENRAGED` 会变成死代码
- **`Enemy` 是池对象，`init` 必须重置"只由外部写入"的标记**：`snakeLink` 是 `game.spawnSnake` 在 `init` 之后置的 true，而 `Enemy.draw()` 见到它就整只跳过（蛇要整体画成连续一条）。3.30 之前 `init` 没清它 —— 第 8 关先跑过一波蛇、蛇被击破，池里那 8 个对象再被复用作 BOSS 分身时就成了**看不见但打得掉**的幽灵。以后新增任何"外部置位、draw/update 里读"的字段，都要在 `init` 里给默认值
- **出手资格只有一处闸门**（3.51，3.52 分两档）：`shoot()` 开头 `if (!this.inPlay(game)) return;`。默认判"贴图四边都在可活动区"（顶部让开 `PLAY_TOP`）；`LEVELS[].edgeFire` 点名的机型（现只有第 5 关 `flame`、第 9 关 `heavy`）放宽到"贴图与可活动区重叠四成"，用来在画面边缘先铺一堵弹幕墙、把玩家往一侧挤。**压制档必须按关卡点名**：每关都开的话，屏幕上永远挂着一层来源不清的弹，"看机身位置判断威胁"就不再是玩家要学的东西；判断"这关该不该有"只看编排里有没有"从顶部成排压下、持续输出"的段（`line`/`arc`/`pincer` 里的压制机型），别顺手加机型——侧向 `side` 入场是 235px/s 斜切，0.2 秒就整只进屏，压制窗口根本来不及。四条配套：①**不要再在每个 AI 分支写 `y > PLAY_TOP`**——那只看圆心，机身还压在 HUD 血条后面就能开火（实测第 5 关火焰机 124 发里 47 发、第 8 关 83 发里 43 发属于这种）；②`_updateEntry` 的"已入场"判据与压制档是同一把尺子（露出四成），否则侧向入场的单位会在 `entryImmune` 期间贴着边开火，`inPlay` 里那句 `if (this.entryImmune) return false` 是兜底别删；③**主动作**（浮雷 `deathBurst`、BOSS 浮游炮）要各自把生成点夹进画面——闸门只管"谁开火"，管不了"弹从哪冒出来"；④`entryImmune` 管"打不打得动"、`inPlay()` 管"该不该出手"，两者不要互相顶替。
- **入场保护 `ENTRY_GUARD`（3.30）**：敌机在贴图露头之前免疫，且**子弹直接穿过不消耗**（`game._updateBullets` / `plasmaBoom` / `chainLightning` / 撞机循环全部 `continue`）。只在 `hit()` 里 return 是不够的——子弹会被看不见的敌机吃掉，玩家看到弹幕凭空消失。露头判定用"贴图下沿 > 8px"（不是 `PLAY_TOP`，HUD 下方那段已经看得见了），露头后再按机型给 0.1~0.34s 缓冲（小快机短、大慢机长），`max 3.0` 兜底防止绕边单位永久无敌；从底部升起的单位走 `SPAWN_GUARD`，`buf` 配 0 不叠加
- **出场护盾 `ENEMY_SHIELD`（3.37，3.39 改过穿透规则）**：中型机与小 BOSS 出场时罩一层有血量的能量盾，**打空或超时都消失**。三条硬规矩：①**穿盾只认显式 `{ ignoreShield: true }`**（撞机用），别再用"伤害够大就穿"这种兜底——3.37 写了 `|| dmg >= 500`，结果保险的 9999 永远算穿透，一颗雷照样秒掉带盾小 BOSS，3.37 刚加的盾等于白加；这类"按数值悄悄改规则"的兜底不报错，只是让另一套机制静默失效；②普通伤害护盾期**不溢出**（只扣盾），唯一例外是保险传 `{ overflow: ratio }`——破盾后本体最多吃 `maxHp × ratio`（`PLAYER.bombShieldPass` 0.30），全溢出等于盾不存在，全不溢出等于一颗雷只配破盾；③计时从 `!entryImmune && spawnGuard <= 0` 才开始，`init` 里 `shieldHp/shieldMax/shieldDur/shieldT/shieldHit/shieldBreak` **必须逐项复位**（池对象，漏一个就是"这只没配盾却顶着上一只的盾"）。`opt.summoned`（BOSS 召唤的援军）一律不给盾。注意 `entryImmune` 是 **getter**（`!entryDone || entryBuf > 0`），测试里赋值无效，要改 `entryDone/entryBuf`。数值两端都要看：全关用满值会让第 1 关漏怪率 0%→20%，所以有 `ENEMY_SHIELD.scale`（0.34→1.0），改数值必跑 `balance_sim.py` 的"下限 Lv1 单槽"那组。绘制在 `Enemy.draw()`，入场保护期不画（两圈叠一起是噪点），破盾震屏只给小 BOSS（后期十几只中型机同时破盾会变成持续抖动）
- **保险（清屏炸弹）的伤害分四路结算**（3.41）：`_bombBoom()` 里 ①**小 BOSS 单独限伤**——`hit(maxHp * bombMiniPass, …, { overflow: bombShieldPass })`，一颗雷最多削 40%，**绝不能**用 `max(bombDmg, maxHp+1)`（那等于按一下就跳过整段小 BOSS 战，加多少血都没用）；②蛇头 / 蛇身按 `bombSnakeDmg / bombSnakeSegDmg` 单独给；③普通小怪 `hit(max(bombDmg, maxHp+1), …, { overflow: bombShieldPass })`——取 `max` 是为了"无盾必秒"不依赖某个魔数恰好大于最强杂兵血量；④BOSS **本体**按 `_bossHits` 轮廓吃 `bombBossDmg`，**可破坏部件与浮游炮**必须单独结算（`pt.dx/dy` + `pt.r`、浮游炮坐标要 `clamp(…, 36, W-36)` 和子弹路径一致），以前只打本体，爆炸圈把炮台整个罩住也纹丝不动。本体放在部件之后打，因为 `boss.hit()` 可能直接击杀并触发结算流程。四路都走 `_bombing` 抑制击破掉落。判断"是不是小 BOSS"只认 `isMiniKind()`，别在分支里另写机型列表
- **偏折面（`deflect`）是三处联动**：判定在 `game._deflect()`（**必须早于本体命中**，否则拨开又立刻结算一次伤害，机制变成纯特效）、视觉在 `Enemy.draw()` 的透镜弧、调试线框在 `_drawHitboxes()`。耐久按"还能拨几发"算（`cap`），拨空过载 `down` 秒
- **直射型敌机走 `ENEMY_DEFS[].nonAim`**（3.53）：`fighter` / `bomber` / `flame` / `heavy` 只朝机头前方打，不读玩家位置。覆盖点在 `shoot()` 里一行 `ang`（`aim` / `aim2` / `fan3` / `fan5` 全走它），`snipe` 不受影响。方向由 `this.faceUp` 决定（`riser` 出生即 true，`looper` 掉头时置 true）——**不要用 `rot` 反推**：侧向入场（`side`）时 `rot` 是斜的，会被误判成"朝上"。新增机型时判据只有一条：编排是不是"整排/整队压下来"，是就配 `nonAim`；追着打的（爬升、狙击、小 BOSS）保留瞄准
- **BOSS 轮转护盾是真挡，不是减伤**（3.53，`Boss.shieldBlocks(x, y)`）：缺口之外玩家子弹在 `game._updateBullets` 里被消耗（`b.active=false` + 冷色火花 + `shieldFlash`），**不调 `hit()`**，血条一动不动。三条硬规矩：①判定只算角度不算距离——`hit()` 的兜底传的是**玩家坐标**（玩家永远在盾外），带距离会把这一路误判成"没挡"；②`Boss.hit()` 里还有一道同样的兜底，任何新加的伤害路径（除 `{ raw: true }`）都会被它挡下；③`raw` 是"无视护盾"的开关，现在给**拆炮台**与**保险**用——保险是玩家的破局手段，被盾吃掉等于把雷废掉。轮转周期按 `BOSS_TRAITS[].shieldTurn` 配（第 3 关 3.0 秒，因为子弹飞到 BOSS 约 0.9 秒，2.4 秒的窗口看到缺口再开枪、弹到时缺口已经转走）
- **狙击弹的 `snipe` 必须透传**：`spawnEnemyBullet(x,y,vx,vy,{snipe:{delay,speed}})` 里少写一个字段，它就会退化成一颗普通慢弹、永远不加速——和 `wideBlock` 那次同一类静默失效
- **敌弹伤害有两档来源（3.38）**：命中玩家时 `b.dmg > 0` 就用弹自带的伤害，否则回落到"按判定半径分档"（`r >= 9` 大弹 34，其余 26）。`spawnEnemyBullet` 的 `dmg` 默认是 **0 = 未指定**，不是 1 —— 写成 1 会让"没配伤害的弹"变成 1 点伤害，比原值小 26 倍且不报错。现在只有狙击弹显式传 `PLAYER.snipeDmg`（46），要加"这种弹更疼"的弹幕就走 `{ dmg: n }`，别去改全局 `bulletDmg`
- **暂停按钮（3.41）的判定必须排在"暂停中任意点击恢复"之前**：`_onDown` 里先判 `PAUSE_BTN` 再判 `paused`，并且在按钮分支里写 `if (this.paused) this.paused = false; else this.togglePause()` —— 只调 `togglePause()` 不行，它的守卫只管"能不能进暂停"（只认 play/boss），反过来如果先被"任意点击恢复"吃掉，按钮就变成"点了没反应"。`PAUSE_BTN` 坐标只写一份，绘制与热区共用。位置刻意选 HUD 右上角血条下方而不是右下角按钮柱：右下角是拖飞机的必经之路，误触暂停比难按更烦
- **触摸输入必须带 `pointerId`**：输入只有一个 `pointerActive`，`pointerup` 又不看是谁抬的手 —— 一只手拖飞机、另一只手点保险/声音，抬手指就会把拖动状态清掉，表现为"飞机卡住，要重新触屏"。`input.pointerId` 记的是控制权归属，`pointermove` / `pointerup` 都要先比对它。以后加任何新的触屏控件，注意别让它抢走控制权（按钮分支要在赋值之前 return）
- **状态分支要共用更新入口**：`_update()` 里按 `state` 分叉时，别在每个分支各抄一份"要更新什么"。保险/激光/冲击环/冷却统一走 `_updateBombSystems(dt)`，`play`/`boss`/`warn`/`clear` 都调 —— 3.20.4 就是预警分支漏抄，导致炸弹挂在半空、特效定格。同理，判断"能不能按保险"只认 `_canUseBomb()`，不要在 `onDown` 里另写一份状态列表
- **武器槽 / 冷却 / 等级三张表必须同步动**：`weapons`、`slotT`、`lv` 是并行数组（3.28 起 `lv` 承载每把枪独立的火力等级，`player.power` 已删除）。伤害按位置（`SLOT_DMG`）、冷却按位置（`slotT`）、等级按位置（`lv`）。`switchWeapon` 轮转、`addWeapon` 满槽替换都必须三处一起 `shift`/`splice`，只搬前两个就会出现"新枪继承旧枪的等级 / 剩余冷却"。切上主位的冷却要压到 0.06s，否则切枪像卡顿
- **火力等级有三条会自己变化**（3.40 起受击降级回来，但只降主位）：P 道具 → 所有已装武器各 +1（`_collectPickups` 里循环 `p.lv`）**并顺带回 `PLAYER.pHealAmount`（12，3.35）**；同款 W → **只有那一把** +1（`Player.addWeapon`），满级再吃转全弹发射；**受伤 → `lv[0]` 降 1 级**（`Math.max(PLAYER.startPower, cur - 1)`，3.42；3.40 写的是一次按回 L1，实测太狠——一发弹抹平三关火力线），写在 `Player.hit` 扣血之后、`hp <= 0` 判定之前，`game.onWeaponLevelDrop()` 弹红色提示。三个边界：①已是 L1 不再扣（也不弹提示）；②这一发致命时跳过（炸机已经要扣命 + 散落降一档，双罚太重）；③只动 `lv[0]`，副位一律不改——惩罚要落在"主武器这个位置"上，而不是抹平整条火力线（3.32 之前是每中弹全槽 -1，密集弹幕下半分钟就能把三关攒的火力打回原点，所以当时才删掉）。带 `lv` 的 W 只来自"爆机散落"，走 `Math.max(cur, lv)` 直接回到那一档、不再叠 +1（否则主武器捡回来只回到 L(原-2)）。**新枪入场一律 L1**（3.36，只有爆机散落的自己的枪按掉落档位 `Math.max` 接回）——以前继承主武器等级等于每把枪都是白捡的满级枪。改任何一条都要同步 HUD（`_drawWeaponSlots` 里每槽画 `L{lv}`，满级暖色）
- **临时武器（`track` / `wide`）的表现画在 `Bullet._tempFx`**（3.42）：`Assets.drawBullet` 只负责贴一帧图，动感全靠这里，调用点在 `Bullet.draw` 的贴图之前。三条规矩：①**不许在 `_tempFx` 里 createLinearGradient / createRadialGradient**——这两类弹同屏十来颗、每帧新建渐变是这类特效最容易悄悄吃掉帧数的写法，拖尾一律用"重复画同一张已烘焙贴图 + 递减 alpha/缩放"（宽头弹的残影就是同形状贴图，换成椭圆会变成"子弹后面挂了个东西"）；②`wide` 的 `suckT` 由 `_wideSweep` 置位、`Bullet.init` 必须清 0（池对象），它的作用是"吞到弹就白闪一下"，没吞到绝不能闪；③追踪弹的判定 `TEMP.track.r 16` 与贴图 26×38 是配套的，只改视觉不改判定会出现"尾焰扫过敌机却没命中"；④**尾焰朝向必须与弹体分开**（3.44，`Bullet.trailA`）：弹体是刚体，转向得立刻；喷出去的火是空气里的东西，转不回来那么快。`trailA` 每帧朝速度方向低通跟随（`dt*6`），绘制时把"夹角落到本地坐标"（末端 `(-len·sinδ, len·cosδ)`，三层各乘 1.35/1.0/0.6 撕成扇形）——直接在 `ctx.rotate(rot)` 里画整段火焰，转弯时就会跟着贴图硬转一圈，那是"生硬"的来源；`trailA` 是池对象字段，`init` 里必须按发射方向复位
- **玩家是血量制，不是"一击掉一命"**（3.32）：`PLAYER.hp` 100、普通弹 26 / 大弹 34（`b.r >= 9`，判定半径已乘过 `ENEMY_BULLET_HIT_K`）/ **狙击弹 46（3.38）** / 撞机 40，掉血进 `hitInvuln` **1.6 秒**（3.34 从 1.2 延长）。`Player.hit(game, dmg)` 的签名和 `Enemy.hit(dmg, bullet, game)` **不一样**，别照抄。血掉光走 `_destroy` → 扣命 → `dropLoadout` 散落 → `onPlayerDying`（`respawnPending = lives > 0`），1.5 秒后 `respawnPlayer()` 重生或 `onPlayerDead()` 结算。**撞机是双方掉血**：敌机吃 `maxHp × ramEnemyDmg`（0.7），不再一律 999 —— 但 `ai === 'snake'` 整条仍然免伤
- **爆机散落的速度不能随意调**：`dropLoadout` 用 18px/s 下飘，46px/s 时从底边到回收线只要 2 秒，玩家还没重生装备就没了。散落物靠 `Pickup.lv` 带等级，`spawnPickup` 的 opt 里透传
- **最高分只在 localStorage**（`HI_KEY`）：`_updateHiScore` 每帧抬高内存值、写入做 1.2 秒节流，失败/通关时立刻落盘。读不到存储（隐私模式）必须当 0，不能让一个记录分数把游戏搞崩
- **命与血是两条独立资源**（3.33）：`H` 只回血（`PLAYER.healAmount` 50，`_collectPickups` 里 `p.hp = min(maxHp, hp+50)`），**不再加命**；命只有两个来源——`SCORE_1UP` 分数奖励（`_updateScoreLife`，25000 起每 75000 一条，`while` 循环补齐跨档，封顶 `PLAYER.maxLives`，与 `_updateHiScore` 并列在状态机外每帧结算）和极稀有的 `E` 道具（`DROPS` 0.05 / `EDGE_SUPPLY` 0.08，`from: 3`）。新增任何"送命"路径都要过 `maxLives` 封顶，否则一条命的价值会被稀释；`_collectPickups` 的 `else` 分支已被改成空操作——以前它兜底"未知类型 = 加命"，新道具漏写 case 会白送一条命。残血补给的判据是 `hp < maxHp * 0.6`，不要写回 `lives < 3`（血量制下漏判"三条命但只剩 10 血"）
- **新增武器必须补 `OVERDRIVE.shapes`**：全弹发射按 `weapons[0]` 的 `id` 查表，缺项会静默回落到 `vulcan` 那一套，症状是"换了枪还是火神炮的环"
- **改槽数要三处一起改**：`WEAPON_SLOTS`（config）、`SLOT_DMG`（长度必须 ≥ 槽数，否则 `SLOT_DMG[s]` 是 `undefined` 被 `|| 1` 兜成满伤害）、`fireSlot` 里的出膛偏移（只有 4 个横向位置可用，第 4 槽改纵向抬高）。数字键上限已改为按 `WEAPON_SLOTS` 推导，HUD 与点槽命中也都是循环 `WEAPON_SLOTS`，不用另外改
- **`spawnPlayerBullet` 的 opt 是白名单**：新加的子弹字段必须在里面逐个透传，否则静默丢失。3.23 的 `wideBlock` 就漏过——宽头弹变成一颗普通大弹、吞不了敌弹，而且不报错
- **敌弹的判定半径统一在 `spawnEnemyBullet` 里乘 `ENEMY_BULLET_HIT_K`（0.72）**：调用点传的 `r` 是"视觉基准"，不是最终判定。新增弹幕时照旧传 6/10/14，不要再手动打折（会变成二次收缩）；要调整全局擦弹手感只改这一个常量，`_drawHitboxes` 会自动跟着画对
- **临时武器有三把，开火方式不一样**：`track`（追踪弹）/ `wide`（宽头弹）到点就放；`thunder`（雷电，3.36）**先查 215px 内有没有已入场的敌机，没有就静默重试**（`retry` 0.08 秒，不能空转整个 cd），命中后走 `chainLightning` 的 4 跳传递（178px、每跳 -1.2、最低 3）。`_fireTemp` 必须**返回下一次冷却**，`_updateTemp` 直接拿它赋值给 `tw.cd`——新增临时武器别忘了这个返回值，否则 `cd` 会变成 `undefined` 而每帧开火。`chainLightning` 的 `opt`（first/firstR/radius/falloff/minDmg/color/life）缺省值就是电弧炮原来的参数，改缺省值会连带改 tesla 的手感
- **临时增益（`shield` / `tempWpns` / `tempAlly`）不占武器槽**：它们由 `Player._updateTemp(dt, game)` 统一推进，开火也直接走 `game.spawnPlayerBullet`，别塞进 `weapons` 数组（否则会被 `SLOT_DMG` 打折、被切枪轮转、被满槽替换挤掉）。新增"玩家可操作"的状态分支时，这条更新链不能漏。护盾挡弹的抖动（`TEMP.shield.jit`）**只改 `_drawShield` 的绘制坐标**，判定仍用 `Player.x/y` —— 任何"抖一抖"的效果都不许挪判定，3px 的漂移就足以让玩家错过/多挨一颗弹。**三把临时武器是数组 `tempWpns` 不是单槽**（3.47）：追踪 / 宽头 / 雷电可以同时在手，`gainTempWpn` 先按 id 查、有就只刷新 `t`，没有才 push；`_updateTemp` 里**倒序遍历 + splice**（正序删会跳过一个，三把同时在场只掉一把）。要加第四把临时武器，除了 `_fireTemp` 分支，还得确认 HUD 的 4 条一行折行够用（最挤 护盾 + 3 武器 + 僚机 = 5 条）。**五件时长统一 35 秒**（3.41，`TEMP.*.dur` 各写一份但必须同值）：HUD 上四条进度条共用同一把量尺才是这套道具能被记住的前提，改一件就要一起改。**定位是"限时实验武器"，数值必须高于主武器**（3.45）：三把临时武器单体都在主武器单槽的 1.4~2 倍（3.48 实测 track 69 / wide 52 / thunder 48，基准是火神炮 L5 单槽 34.7；3.45 曾给到 2~3 倍，玩家反馈"捡到就把整关推平"，收回一档），僚机按"第二把满级主武器"给（`mul 1.0`、`powMax 5`、射速 `cd*1.15`），护盾 30 发 + 打穿回 15 血（3.46 从 60 退回 30：35 秒里 30 发已够罩住一整轮 BOSS 弹幕，再厚就把"什么时候该冲"变成"随便冲"）。**别再用"不能盖过正式武器"去压它们**——那是 3.42 之前的口径，压到 1/3 之后玩家的原话是"捡了也不改变打法"；这件道具的平衡杠杆只有时限一条，靠数值压等于把它变成废品。护盾的"回血"只在**耐久归零且时间未到**时触发（`_updateTemp` 里 `broke = sh.hp <= 0 && sh.t > 0`），时间到不回——否则玩家会故意挨弹把它打碎当回血包；提示走 `game.onShieldBreak`（复用 `wpnTitle` 位），破盾时**不要再调 `onTempEnd`**，两条提示会叠着说"被打穿"和"已结束"
- 性能目标：60fps（480×854 画布），改动后跑一次冒烟看 `fps` 字段

## 协作偏好

- 先给方案让用户确认，再动代码；需求模糊时先问清楚，不要猜着实现
- 拒绝过度设计：能用配置解决就别加抽象层
- 分阶段推进：低风险项先验证，高风险项先确认方案
- 中文交流，注释写"为什么"而不是"做了什么"；不要 emoji
- 结论要自己验证（跑测试 / 截图 / 读源码），不接受"看起来应该没问题"
