# raiden-lite · 腕上雷电

竖版卷轴射击（STG）Demo：**9 关、19 种特色敌机、9 个多阶段 BOSS**。
纯静态前端，零构建、零外部素材依赖 —— 所有美术由 Python 脚本程序化生成，音效由 WebAudio 实时合成。

> A vertical scrolling shooter demo inspired by classic arcade shmups.
> All art is procedurally generated and all SFX are synthesized at runtime — no binary asset packs, no build step.

**在线试玩**：<https://a7e93b2aed1fb636c.app.workbuddy.host/?sharecode=QFXRKQOU2C>

---

## 仓库结构

| 路径 | 说明 |
|---|---|
| `raiden-lite/` | **游戏工程本体**，可以直接运行 |
| `raiden-lite/js/config.js` | 全部可调数值：武器 / 道具 / 敌机 / 关卡波次 / 补给表 |
| `raiden-lite/assets/` | 程序化生成的图集与 9 张关卡背景 |
| `raiden-lite/tools/` | 资源生成、BOSS 判定自动计算、平衡模拟、冒烟测试 |
| `小米手环10-雷电Lite开发方案.md` | 移植到小米手环 10（Vela 快应用）的方案文档 |
| `README.md` | 本文件 |
| `CODEBUDDY.md` | 项目级记忆：结构、命令、硬性约定与踩坑记录（AI 助手每次会话自动加载） |
| `LICENSE` | MIT |
| `.gitignore` | 版本控制排除规则（详见下方「协作流程」） |

## 快速开始

双击 `raiden-lite/index.html` 就能玩（`file://` 直接跑，无需服务器）。
若浏览器对本地文件有额外限制，起个静态服务更稳：

```bash
cd raiden-lite
python3 -m http.server 8232
# 浏览器打开 http://127.0.0.1:8232
```

画布固定 480×854，窗口更小时整体等比缩放并居中，手机横竖屏都能用。

## 操作

| 动作 | 触屏 / 鼠标 | 键盘 |
|---|---|---|
| 移动 | 拖拽（落点会比手指高一截，避免被挡住） | `WASD` / 方向键 |
| 保险（清屏炸弹） | 右下角 `X·BOMB` 按钮 | `X` / `B` |
| 激光保险（向上持续光束） | 右下角 `C·LASER` 按钮 | `C` / `V` / `L` |
| **切换主武器** | **点 HUD 左上角的武器槽** | `1`~`4` 直选第 N 格 / `Q` 依次循环 |
| 暂停 | HUD 暂停按钮 | `Esc` / `P` |
| 开始 / 续关 | 点击画面 | `空格` / `Enter` |
| 声音开关 | 右下角喇叭（状态会记住） | — |

## 道具

| 道具 | 效果 |
|---|---|
| `P` | 火力等级 +1（影响弹道数量与伤害） |
| `W` | 获得 / 切换武器，共 9 种；**满级后再吃同款触发全弹发射**（形状跟当前主武器） |
| `B` | 保险 +1 |
| `H` | 生命 +1 |
| `O` | 僚机 +1（最多 2 架，双武器槽） |
| `R` | 环绕机 +1（最多 2 台，椭圆轨道，可撞敌机、可挡弹） |
| `L` | 激光保险 +1 |
| `S` ◇ | **护盾 30 秒**：机头前方光罩，可挡 30 发子弹（挡穿提前结束） |
| `T` ◇ | **高爆追踪弹 14 秒**：不占武器槽的自动追踪炸弹 |
| `D` ◇ | **宽头弹 14 秒**：巨弹，途经的敌方子弹一并吞掉 |
| `A` ◇ | **临时僚机 20 秒** |

道具除敌机掉落外，每关还会按主题在固定时间点 / 事件点投放：可以从上飘下、从下升起，也可以落到底边反弹再飘走。
圆形是永久成长，**菱形是临时增益**（到期自动消失，HUD 武器槽下方有剩余秒数）。

## 开发

```bash
cd raiden-lite

python3 tools/gen_assets.py      # 重新生成 sprites.png / 背景 / atlas.js（改美术后跑）
python3 tools/gen_boss_hull.py   # 从 BOSS 贴图自动算多圆判定轮廓，写入 BOSS_HULL
python3 tools/balance_sim.py     # 漏怪率、同屏峰值模拟（调血量时跑）
python3 tools/smoke.py           # Playwright 冒烟：3 关 × 2 渠道，截图 + 抓控制台错误
```

改完**必须同步两处版本号**，否则浏览器会命中旧缓存（典型症状：版本号是新的，画出来的还是旧的）：

1. `js/config.js` 的 `VERSION`
2. `index.html` 里 7 处 `?v=`

### 协作流程

这个目录同时是云电脑上的工作副本，**动手前先同步远端**。仓库已配置 `pull.rebase=true` 与 `rebase.autoStash=true`，所以有未提交改动时也能直接拉：

```bash
git pull --rebase        # 或简写 git sync（已设别名）
```

日常顺序：

1. `git pull --rebase` 拉到最新
2. 改 `raiden-lite/` 下的代码，同步版本号
3. `python3 tools/smoke.py` 冒烟
4. 需要发布时打包 `raiden-lite-<版本>.zip` 并部署线上
5. 需要备份时 `git add -A && git commit -m "..." && git push`

### 版本控制约定

`.gitignore` 只排除“能重新生成或与运行无关”的东西，工程本身（含贴图、文档）全部入库：

| 排除项 | 原因 |
|---|---|
| `*.zip` / `*.tar.gz` / `*.7z` | 打包产物与备份快照，可由 `raiden-lite/` 重新打出 |
| `__pycache__/`、`*.py[cod]`、`.pytest_cache/`、`venv/` 等 | Python 运行缓存与虚拟环境 |
| `.codebuddy/`、`.cloudstudio` | 云开发平台目录 |
| `*.png.bak`、`*.tmp`、`*.log` | 素材备份与临时文件 |
| `.vscode/`、`.idea/`、`.DS_Store` | 编辑器与系统文件 |

`assets/_contact_*.png`（约 895K，`tools/gen_assets.py` 输出的验收拼贴图）**保留在仓库里**：它们已经在历史中，忽略只会造成“本地看不见、远端还在”的错觉。

## 版本

当前 **3.23.0**。完整变更记录（每个版本改了什么、踩过哪些坑）见
[`raiden-lite/README.md`](raiden-lite/README.md)。

## 仓库用途

日常开发在云电脑上进行，这个仓库主要用于**备份与同步**：
主工程始终是 `raiden-lite/`，历史快照可能以整包或目录形式出现在根目录 —— 以 `raiden-lite/` 为准。

## License

MIT © 2026 Davis，详见 [LICENSE](LICENSE)。
