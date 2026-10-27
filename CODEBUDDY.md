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
| `raiden-lite/js/config.js` | 所有**数值**：VERSION / PLAYER / WEAPONS / OVERDRIVE / DROPS / ENEMY_DEFS / LEVELS / SNAKE | 逻辑 |
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
2. `index.html` 里 **7 处** `?v=`

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
- 性能目标：60fps（480×854 画布），改动后跑一次冒烟看 `fps` 字段

## 协作偏好

- 先给方案让用户确认，再动代码；需求模糊时先问清楚，不要猜着实现
- 拒绝过度设计：能用配置解决就别加抽象层
- 分阶段推进：低风险项先验证，高风险项先确认方案
- 中文交流，注释写"为什么"而不是"做了什么"；不要 emoji
- 结论要自己验证（跑测试 / 截图 / 读源码），不接受"看起来应该没问题"
