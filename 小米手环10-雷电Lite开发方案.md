# 小米手环10 · 竖版射击游戏（Raiden Lite）开发方案

> 目标设备：小米手环 10（212×520，胶囊形 AMOLED，Vela OS）
> 目标产出：可侧载到自用手环的 `.rpk` 快应用，玩法为「雷电」极简版
> 文档用途：换机器后照此继续实现，无需回溯上下文

---

## 目录

1. [结论与定位](#1-结论与定位)
2. [技术底座（已核实事实）](#2-技术底座已核实事实)
3. [三条硬约束](#3-三条硬约束)
4. [玩法规格（雷电 Lite）](#4-玩法规格雷电-lite)
5. [工程结构](#5-工程结构)
6. [完整骨架代码](#6-完整骨架代码)
7. [性能预算与调优](#7-性能预算与调优)
8. [真机安装：AuthKey 流程](#8-真机安装authkey-流程)
9. [踩坑清单](#9-踩坑清单)
10. [里程碑与验收标准](#10-里程碑与验收标准)
11. [参考资料](#11-参考资料)

---

## 1. 结论与定位

手环10 做不出商业级「雷电」。它的运行时没有 Canvas、没有逐帧回调、没有扬声器。可交付的形态是：

- **固定赛道竖版射击**：自动开火，横向拖动，同屏 ≤4 敌机、≤8 子弹
- **12–15 fps**，低动态，像素/几何图形美术
- **反馈靠振动**，不靠音效
- 单机、无联网（Vela 的 HTTP 必须经手机 App 中转）

明确排除：Cocos2d-JS / Unity / WebView / WebGL 类方案。Vela 快应用是组件树 + JS 逻辑，不是浏览器。可复用的是游戏逻辑层（对象池、AABB、状态机、关卡表）。

---

## 2. 技术底座（已核实事实）

| 项 | 值 | 来源 |
|---|---|---|
| 操作系统 | Xiaomi Vela OS（基于 NuttX RTOS），HyperOS 精简版 | 官方文档 / 开发指南 |
| 应用框架 | Vela JS 快应用，类 Vue 的 MVVM，`.ux` 三段式 | 官方文档 |
| 开发工具 | AIoT-IDE（VS Code 魔改，内置模拟器） | iot.mi.com |
| 产物格式 | `.rpk`（非 APK） | 官方 FAQ |
| 屏幕 | 1.725"，212×520 px，PPI 326，DPR 2.0，DP 宽 106，胶囊形 | 官方多屏适配文档 |
| 内存 | 约 64 MB RAM | 社区实测 |
| 存储 | 系统预留约 90 MB，应用可用约 100 MB | 社区实测 |
| 扬声器 | 无（`@system.volume` 不支持） | API 清单 |
| 麦克风 / GPS / WiFi | 均无 | API 清单 |
| 振动 | `@system.vibrator`，`mode: 'short' \| 'long'` | 官方 API |
| 传感器 | 加速度计、气压计；无陀螺仪、无磁力计 | 官方 API |
| 通信 | 仅 BLE，且只能连已配对手机（`@system.interconnect`） | 官方 API |
| 快应用数量上限 | 20 个 | 社区 |

`manifest.json` 关键约定：

- `deviceTypeList` 必须是 `["watch"]`，**不能写 `band`**（手环10 走 watch 通道）
- `designWidth` 设 `212`，则 1px = 1 物理像素，做游戏最直观
- 不要写 `minAPILevel` 字段

---

## 3. 三条硬约束

### 3.1 没有 canvas 组件

官方组件白名单：`div`、`text`、`span`、`a`、`image`、`list`、`list-item`、`scroll`、`stack`、`swiper`、`progress`、`marquee`、`chart`、`qrcode`、`barcode`、`image-animator`、`input`、`picker`、`slider`、`switch`。

`canvas` 在文档中不存在（`zh/components/canvas.html`、`zh/components/basic/canvas.html` 均 301 回 guide 首页）。社区开发者实测结论一致："Vela JS API 不给你 canvas"。

**影响**：精灵只能用 `image` / `div` 绝对定位拼，无法批量绘制，节点数就是性能上限。

### 3.2 没有 requestAnimationFrame

只有 `setInterval` / `setTimeout` 驱动数据绑定更新。CSS `animation` / `transition` 可用但只能驱动固定关键帧，无法承载游戏逻辑。

**影响**：主循环 = `setInterval(tick, 66)`，约 15fps。所有运动、碰撞、生成都在 tick 里算。

### 3.3 没有扬声器

`@system.volume` 不在支持列表。只能 `vibrator.vibrate({ mode: 'short' })`。

**影响**：射击无音效，命中/受伤靠振动。振动本身耗电且体验突兀，需限制频率（≥300ms 间隔）。

---

## 4. 玩法规格（雷电 Lite）

### 4.1 与原作的能力映射

| 雷电要素 | 手环10 实现方式 |
|---|---|
| 60fps 弹幕 | 15fps，同屏 ≤4 敌机 / ≤8 子弹 |
| Canvas 精灵 | `div`/`image` 绝对定位，固定槽位池 |
| 粒子爆炸 | 2–3 帧方块闪烁，或省略 |
| 射击音效 / BGM | 无，仅振动 |
| 虚拟摇杆 | 自动开火 + 横向拖动 |
| 纵向移动 | 固定 y，只允许左右（降低操作复杂度） |
| 关卡 / BOSS | 保留，BOSS 用血条 + 3 种固定弹道 |

### 4.2 M1 核心循环（本次实现范围）

```
每 66ms:
  1. 开火冷却递减，到 0 则从子弹池取空槽，在机头位置生成向上子弹
  2. 子弹 y -= 30，出屏回收
  3. 敌机生成冷却递减，到 0 则取空槽，在顶部随机 x 生成，速度 6~10
  4. 敌机 y += spd，出屏回收
  5. 子弹 × 敌机 AABB 碰撞 → 双双回收，score += 10
  6. 敌机 × 玩家 AABB 碰撞 → 敌机回收，hp -= 1，短振
  7. hp <= 0 → over = true，停表
  8. 整表赋值触发一次视图刷新
```

### 4.3 数值表

| 参数 | 值 | 说明 |
|---|---|---|
| TICK | 66ms | ≈15fps |
| 玩家机 | 24×24，y=440 | 屏幕下方，避手指 |
| 子弹 | 4×10，每 tick 上移 30px | 约 1.3s 飞完全程 |
| 开火间隔 | 6 tick（≈0.4s） | 自动开火 |
| 敌机 | 20×20，每 tick 下移 6~10px | 约 4~6s 落地 |
| 生成间隔 | 18 tick（≈1.2s） | 同屏最多 4 |
| 初始 HP | 3 | |
| 单杀得分 | 10 | |

---

## 5. 工程结构

```
raiden-lite/
├── package.json              # AIoT-IDE 模板生成，勿手写
├── src/
│   ├── manifest.json         # 应用配置（见 6.1）
│   ├── app.ux                # 应用生命周期（见 6.2）
│   ├── pages/
│   │   └── index/
│   │       └── index.ux      # 主界面 + 全部游戏逻辑（见 6.3）
│   └── common/
│       └── logo.png          # 108×108 PNG，缺失会编译失败
└── dist/                     # 构建产物 .rpk
```

**推荐做法**：用 AIoT-IDE「新建工程 → Vela JS 快应用 → 手表模板」生成项目骨架，只替换 `src/manifest.json` 和 `src/pages/index/index.ux`。不要手写 `package.json` 和构建配置，容易因模板版本差异卡住。

---

## 6. 完整骨架代码

### 6.1 src/manifest.json

```json
{
  "package": "com.yourname.raidenlite",
  "name": "腕上雷电",
  "versionName": "0.1.0",
  "versionCode": 1,
  "minPlatformVersion": 1200,
  "icon": "/common/logo.png",
  "deviceTypeList": ["watch"],
  "features": [
    { "name": "system.vibrator" },
    { "name": "system.brightness" }
  ],
  "config": {
    "logLevel": "debug",
    "designWidth": 212
  },
  "router": {
    "entry": "pages/index",
    "pages": {
      "pages/index": { "component": "index" }
    }
  }
}
```

### 6.2 src/app.ux

```vue
<script>
export default {
  onCreate() {
    console.log('[raiden] app created')
  },
  onDestroy() {
    console.log('[raiden] app destroyed')
  }
}
</script>
```

### 6.3 src/pages/index/index.ux

> 说明：M1 全部用 `div` + 背景色，不依赖图片资源，换机器后无需美术即可跑通。后续把 `.ship` / `.enemy` / `.bullet` 换成 `image` 即可。

```vue
<template>
  <div class="stage" @touchstart="onTouch" @touchmove="onTouch">
    <text class="hud">SCORE {{ score }}   HP {{ hp }}</text>

    <block for="e in enemies">
      <div class="enemy" if="{{e.on}}" style="left: {{e.x}}px; top: {{e.y}}px;"></div>
    </block>

    <block for="b in bullets">
      <div class="bullet" if="{{b.on}}" style="left: {{b.x}}px; top: {{b.y}}px;"></div>
    </block>

    <div class="ship" style="left: {{shipX}}px; top: {{shipY}}px;"></div>

    <div class="over" if="{{over}}">
      <text class="over-title">GAME OVER</text>
      <text class="over-score">{{ score }}</text>
      <div class="btn" @click="restart">
        <text class="btn-text">RETRY</text>
      </div>
    </div>
  </div>
</template>

<script>
import brightness from '@system.brightness'
import vibrator from '@system.vibrator'

const W = 212
const H = 520
const TICK = 66          // ≈15fps
const NB = 8             // 子弹槽位
const NE = 4             // 敌机槽位
const SHIP_W = 24
const SHIP_H = 24
const SHIP_Y = 440
const BULLET_W = 4
const BULLET_H = 10
const BULLET_SPD = 30
const ENEMY_W = 20
const ENEMY_H = 20
const ENEMY_TOP = 44
const FIRE_CD = 6
const SPAWN_CD = 18

function makeBullets() {
  const arr = new Array(NB)
  for (let i = 0; i < NB; i++) {
    arr[i] = { on: false, x: 0, y: 0 }
  }
  return arr
}

function makeEnemies() {
  const arr = new Array(NE)
  for (let i = 0; i < NE; i++) {
    arr[i] = { on: false, x: 0, y: 0, spd: 6 }
  }
  return arr
}

export default {
  data: {
    score: 0,
    hp: 3,
    over: false,
    shipX: (W - SHIP_W) / 2,
    shipY: SHIP_Y,
    bullets: [],
    enemies: []
  },

  onInit() {
    this.timer = null
    this.fireCd = 0
    this.spawnCd = 0
    this.bullets = makeBullets()
    this.enemies = makeEnemies()
  },

  onShow() {
    // 不调用会 5 秒息屏，游戏必挂
    brightness.setKeepScreenOn({
      keepScreenOn: true,
      fail: (e) => console.log('[raiden] keepScreenOn fail: ' + JSON.stringify(e))
    })
    this.start()
  },

  onHide() {
    this.stop()
  },

  onDestroy() {
    this.stop()
  },

  start() {
    if (this.timer) return
    this.timer = setInterval(() => this.tick(), TICK)
  },

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (global.runGC) global.runGC()
  },

  // ---------- 输入 ----------
  onTouch(e) {
    if (this.over) return
    if (!e.touches || !e.touches.length) return
    let x = e.touches[0].clientX - SHIP_W / 2
    if (x < 0) x = 0
    if (x > W - SHIP_W) x = W - SHIP_W
    this.shipX = x
  },

  // ---------- 主循环 ----------
  tick() {
    if (this.over) return
    const bs = this.bullets
    const es = this.enemies

    if (++this.fireCd >= FIRE_CD) {
      this.fireCd = 0
      this.fire(bs)
    }

    for (let i = 0; i < NB; i++) {
      const b = bs[i]
      if (!b.on) continue
      b.y -= BULLET_SPD
      if (b.y + BULLET_H < 0) b.on = false
    }

    if (++this.spawnCd >= SPAWN_CD) {
      this.spawnCd = 0
      this.spawn(es)
    }

    for (let i = 0; i < NE; i++) {
      const en = es[i]
      if (!en.on) continue
      en.y += en.spd
      if (en.y > H) en.on = false
    }

    // 子弹 × 敌机
    for (let i = 0; i < NB; i++) {
      const b = bs[i]
      if (!b.on) continue
      for (let j = 0; j < NE; j++) {
        const en = es[j]
        if (!en.on) continue
        if (b.x < en.x + ENEMY_W && b.x + BULLET_W > en.x &&
            b.y < en.y + ENEMY_H && b.y + BULLET_H > en.y) {
          b.on = false
          en.on = false
          this.score = this.score + 10
          break
        }
      }
    }

    // 敌机 × 玩家
    for (let j = 0; j < NE; j++) {
      const en = es[j]
      if (!en.on) continue
      if (en.x < this.shipX + SHIP_W && en.x + ENEMY_W > this.shipX &&
          en.y < SHIP_Y + SHIP_H && en.y + ENEMY_H > SHIP_Y) {
        en.on = false
        this.hp = this.hp - 1
        vibrator.vibrate({
          mode: 'short',
          fail: (err) => console.log('[raiden] vibrate fail: ' + JSON.stringify(err))
        })
        if (this.hp <= 0) {
          this.gameOver()
          return
        }
      }
    }

    // 必须整表赋值：Vela 监听不到数组元素内部属性变更
    this.bullets = bs.slice()
    this.enemies = es.slice()
  },

  // ---------- 实体池 ----------
  fire(bs) {
    for (let i = 0; i < NB; i++) {
      if (!bs[i].on) {
        bs[i].on = true
        bs[i].x = this.shipX + SHIP_W / 2 - BULLET_W / 2
        bs[i].y = SHIP_Y - BULLET_H
        return
      }
    }
  },

  spawn(es) {
    for (let i = 0; i < NE; i++) {
      if (!es[i].on) {
        es[i].on = true
        es[i].x = Math.random() * (W - ENEMY_W)
        es[i].y = ENEMY_TOP
        es[i].spd = 6 + Math.random() * 4
        return
      }
    }
  },

  // ---------- 流程 ----------
  gameOver() {
    this.over = true
    this.stop()
    vibrator.vibrate({ mode: 'long', fail: () => {} })
  },

  restart() {
    this.score = 0
    this.hp = 3
    this.over = false
    this.shipX = (W - SHIP_W) / 2
    this.fireCd = 0
    this.spawnCd = 0
    this.bullets = makeBullets()
    this.enemies = makeEnemies()
    this.start()
  }
}
</script>

<style>
.stage {
  position: relative;
  width: 212px;
  height: 520px;
  background-color: #05070f;
}

.hud {
  position: absolute;
  left: 0;
  top: 28px;
  width: 212px;
  text-align: center;
  font-size: 14px;
  color: #78909c;
}

.ship {
  position: absolute;
  width: 24px;
  height: 24px;
  background-color: #4dd0e1;
  border-radius: 6px;
}

.bullet {
  position: absolute;
  width: 4px;
  height: 10px;
  background-color: #ffe082;
  border-radius: 2px;
}

.enemy {
  position: absolute;
  width: 20px;
  height: 20px;
  background-color: #ff5252;
  border-radius: 3px;
}

.over {
  position: absolute;
  left: 0;
  top: 0;
  width: 212px;
  height: 520px;
  background-color: rgba(0, 0, 0, 0.85);
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

.over-title {
  font-size: 20px;
  color: #ff5252;
}

.over-score {
  margin-top: 8px;
  font-size: 16px;
  color: #ffffff;
}

.btn {
  margin-top: 24px;
  width: 96px;
  height: 40px;
  background-color: #263238;
  border-radius: 20px;
  justify-content: center;
  align-items: center;
}

.btn-text {
  font-size: 15px;
  color: #4dd0e1;
}
</style>
```

### 6.4 关键实现说明

**为什么用固定槽位而不是 `for` 渲染变长数组**
节点创建/销毁在 Vela 上是最贵的操作。固定 8+4 个节点，靠 `if` 显隐，生命周期内节点数不变。

**为什么每帧要 `this.bullets = bs.slice()`**
Vela 的数据绑定基于赋值，监听不到 `this.bullets[0].y = 100` 这类内部修改。必须整体赋新数组触发 diff。这也是每帧唯一的一次渲染提交，不要在中途多次赋值。

**为什么 `over` 层写在最后**
Vela CSS 不支持 `z-index`，层级完全由 DOM 顺序决定，后写的盖前面的。

**为什么不用 `position: fixed`**
`fixed` 是相对滚动视口，游戏根节点用 `relative` + 子元素 `absolute` 才可控。

---

## 7. 性能预算与调优

| 指标 | 目标 | 备注 |
|---|---|---|
| 帧间隔 | 66ms | 低于 50ms 时手环开始掉帧 |
| 同屏可动节点 | ≤12 | 子弹 8 + 敌机 4 |
| 静态节点 | ≤6 | HUD、玩家机、遮罩 |
| 每次 tick 赋值次数 | 2 | bullets + enemies 各一次 |
| 单帧 JS 计算 | <10ms | 纯算术 + AABB，无字符串拼接 |

调优顺序（按收益排序）：

1. **降节点数**：子弹减到 6、敌机减到 3，先保帧率
2. **`left/top` → `transform: translate()`**：减少重排，但需实测 Vela 对 translate 的 px 支持
3. **静态节点标 `static`**：`<div class="hud" static>`，跳过 diff
4. **HUD 分数不要每帧改**：只在分数变化时赋值（当前实现已满足）
5. **手动 GC**：`onDestroy` 里 `global.runGC()`，Vela 没有主动 GC

`for` + `if` 若仍卡顿的终极方案：把 8 个子弹、4 个敌机在模板里**写死**，每个直绑 `b0x/b0y/...`，彻底消除列表 diff。代码丑但快。

---

## 8. 真机安装：AuthKey 流程

### 8.1 本质

AuthKey 是手机与手环配对时下发的 **64 位蓝牙密钥**，存在手机本地，只能从「小米运动健康」的同步日志里读出来。**必须安卓手机，iOS 拿不到 App 沙盒日志。**

### 8.2 准备

- 安卓手机，小米运动健康已绑定手环10、能正常同步
- 手环电量 > 30%，蓝牙连着手机
- 米坛「表盘自定义工具」v6.5+（**从 bbs.bandbbs.cn 原帖下载**，不要用第三方软件站的转包 APK，它要读你的账号日志）

### 8.3 四步

1. **生成日志**：小米运动健康 → 我的 → 关于 → 连续点击 App Logo 约 10 次 → 弹「迁移日志文件」→ 点**确认** → 等 10~30 秒
2. **读密钥**：打开表盘自定义工具 → 首页右上角选「小米手环10」→ 工具 → **AuthKey 读取工具** → 滑到底点「开始读取」→ 复制 64 位字符
3. **验证**：粘贴密钥 → 搜索设备（`Mi Band 10-XXXX`）→ 手环弹配对 → 点**同意**
4. **装包**：工具 → 蓝牙一键安装 → 选 `dist/com.yourname.raidenlite.rpk`

### 8.4 失败排查

| 现象 | 原因 / 处理 |
|---|---|
| 一直读不到 | 第 1 步没弹「迁移日志文件」或没点确认 |
| 读到空内容 | 运动健康版本过新，日志格式变了；换旧版 APK 或改用 AstroBox 内置读取 |
| 工具报无权限 | MIUI 限制访问 `Android/data`，给「所有文件访问」权限 |
| 配对失败 | 手环被另一台手机占用，手环上先「断开连接」 |
| 安装报错 | 快应用到 20 个上限，先卸载几个 |
| 装完不显示 | 用「快应用管理」确认是否真装上；卸载 → 重启手环 → 重装 |

### 8.5 另一条路：蓝牙 ADB

手环上：设置 → 关于 → 连点「OS 版本」5 次，开启蓝牙 ADB 调试，AIoT-IDE 可直连真机热重载，不必每次走 AuthKey。

缺点：配对、SDK 版本匹配问题多，社区反馈这条路不顺。**建议仅用于真机看手感，正式安装仍走 AuthKey。**

### 8.6 代价

- **固件升级会清空所有第三方快应用**，包括你的游戏
- AuthKey 等同设备配对密码，不要外传
- 连 iPhone 时第三方应用会被隐藏，切回安卓重连恢复

---

## 9. 踩坑清单

| # | 坑 | 解法 |
|---|---|---|
| 1 | 5 秒息屏 | `onShow` 里 `brightness.setKeepScreenOn` |
| 2 | 抬腕/息屏回来定时器堆叠 | `onHide` / `onDestroy` 必须 `clearInterval` |
| 3 | 数据改了视图不动 | 数组整体赋值，不改元素属性 |
| 4 | 层级错乱 | 没有 `z-index`，靠 DOM 顺序 |
| 5 | 元素溢出到圆角外 | 顶部 40px、底部 40px 留安全区 |
| 6 | 字体太小 | 212 宽下正文 ≥14px |
| 7 | 模拟器不渲染非方形纹理 | 手环10 模拟器可能失败，先用 Watch S5 方形模拟器验逻辑 |
| 8 | 模拟器没选中导致调试无反应 | 调试按钮旁的 `[+]` 下拉里勾选模拟器，再点 Debug |
| 9 | 内存涨 | `global.runGC()`，避免每帧 new 对象（当前实现复用槽位对象） |
| 10 | 振动过频 | 间隔 ≥300ms，只在受伤/结束时振 |
| 11 | 缺 `logo.png` 编译失败 | `src/common/logo.png` 108×108 |
| 12 | `deviceTypeList` 写 `band` | 手环10 必须写 `watch` |

---

## 10. 里程碑与验收标准

### M1 · 模拟器跑通（0.5~1 天）

- [ ] AIoT-IDE 新建工程，替换 `manifest.json` + `index.ux`，放 `logo.png`
- [ ] 模拟器选 `xiaomi10Band`，Build → Run
- [ ] 飞机跟随触摸左右移动、边界不越界
- [ ] 子弹自动发射、出屏回收
- [ ] 敌机生成、下移、出屏回收
- [ ] 命中加分、撞机扣血、HP 归零弹结束页、RETRY 可重开

### M2 · 真机验证（0.5~1 天）

- [ ] AuthKey 打通，rpk 装上
- [ ] 全程不息屏
- [ ] 被撞时有振动反馈
- [ ] 退出应用后无残留定时器（重进不加速）
- [ ] 手感：手指不遮挡飞机、拖动跟手

### M3 · 内容打磨（3~5 天）

- [ ] 三种敌机：直线、左右摆、俯冲
- [ ] BOSS：血条 + 三阶段弹道
- [ ] 道具：加火力 / 护盾（用槽位扩容实现）
- [ ] 像素图替换几何方块（`image` + PNG8）
- [ ] 最高分持久化（`@system.storage`）
- [ ] 关卡表外置为 JS 常量，方便调难度

### 验收红线

- 稳定 15fps，无肉眼可见卡顿
- 冷启动首屏 < 2s（官方发布强制要求 FMP ≤ 2000ms）
- 连续玩 10 分钟不掉帧、不发热降频

---

## 11. 参考资料

| 资源 | 地址 |
|---|---|
| Vela 快应用官方文档 | https://iot.mi.com/vela/quickapp/zh/ |
| AIoT-IDE 下载 | https://iot.mi.com/vela/quickapp/zh/guide/start/use-ide.html |
| 多屏适配（屏幕参数表） | https://iot.mi.com/vela/quickapp/zh/guide/multi-screens |
| 真机安装 FAQ | https://iot.mi.com/vela/quickapp/zh/guide/other/faq.html |
| 官方示例（wearable 目录） | https://github.com/open-vela/packages_apps |
| HyperTetris（开源手环游戏，div 渲染参考） | https://github.com/AetherZeng1145/HyperTetris |
| 第三方开发指南（含 CLI 脚本） | https://github.com/oryonatan/xiaomi-band-development |
| 手环10 开发技能文档（AI 上下文用） | https://github.com/paraflu/hermes-skill-xiaomi-miband10-vela-js |
| 米坛社区（资源 + 工具） | https://www.bandbbs.cn |
| 官方商务对接（上架用） | changjian@xiaomi.com |

---

## 附：下次开工第一件事

```bash
# 1. 安装 AIoT-IDE，新建「Vela JS 快应用 / 手表」工程
# 2. 用本文 6.1 / 6.2 / 6.3 覆盖 src 下对应文件
# 3. 放一张 108×108 的 logo.png 到 src/common/
# 4. AIoT-IDE 里 Build → Build RPK，先跑模拟器
```

如果 M1 代码在某处编译报错，优先怀疑三点：`block` 标签的 `for` 用法、`style` 内联绑定语法 `{{ }}` 的 px 单位、`data` 里数组初始化的时机。这三处是 Vela 与 Vue 差异最大的地方。
