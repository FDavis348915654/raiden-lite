"""敌机血量平衡模拟：用真实游戏逻辑跑完整关卡，统计漏怪率。

用法：python3 tools/balance_sim.py
原理：在页面里停掉 rAF，手动以 60Hz 步进 game.update，
     玩家由简单 AI 操作（无敌 + 优先打最靠近底部的敌人），
     只统计"敌机是否被及时打掉"，不评判渲染。
"""
import json
import subprocess
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8231

OLD_HP = {
    'scout': 3, 'fighter': 6, 'bomber': 15, 'diver': 5, 'mine': 3, 'formation': 5,
    'torpedo': 5, 'eel': 14, 'jelly': 10, 'drone': 4, 'shield': 34, 'kamikaze': 5,
    'flame': 8, 'mirror': 10, 'heavy': 32, 'mineH': 9, 'looper': 7, 'riser': 6,
    'miniboss': 260, 'splitling': 360,
}
OLD_MINIBOSS_WAVE = {'4': 260, '6': 240, '7': 270, '8': 270, '9': 290}


def run(page, mode, profile):
    """mode: 'old' | 'new'；profile: 'rookie' | 'veteran'"""
    return page.evaluate(
        """([mode, profile, OLD_HP, OLD_WAVE]) => {
        const g = window.game;
        // 停掉自循环与看门狗，改为手动步进（快进模拟）
        cancelAnimationFrame(g.raf);
        g._loop = null;
        if (g._watchdog) { clearInterval(g._watchdog); g._watchdog = null; }

        // 保存原始血量（页面首次调用时）
        if (!window.__newHp) {
          window.__newHp = {};
          for (const k in ENEMY_DEFS) window.__newHp[k] = ENEMY_DEFS[k].hp;
        }
        const applyHp = (table) => { for (const k in table) if (ENEMY_DEFS[k]) ENEMY_DEFS[k].hp = table[k]; };
        applyHp(mode === 'old' ? OLD_HP : window.__newHp);

        const out = [];
        for (let id = 1; id <= 9; id++) {
          // 关卡内 miniboss 的 hp 覆盖值也要按模式还原
          const lv = LEVELS[id - 1];
          for (const w of lv.waves) {
            if (w.kind === 'miniboss' && w.hp) {
              if (!w.__origHp) w.__origHp = w.hp;
              w.hp = mode === 'old' ? OLD_WAVE[String(id)] : w.__origHp;
            }
          }

          g.startLevel(id - 1, false);
          const p = g.player;
          const mkOpt = (n) => Array.from({ length: n }, (_, i) => (
            { x: VIEW.w / 2 + (i === 0 ? -54 : 54), y: 770, fireT: 0.2, t: 0 }));
          if (profile === 'rookie') {
            // 下限：全程只有一把 Lv1 主武器，不掉道具也不吃僚机
            p.weapons = [0]; p.lv = [1]; p.slotT = [0]; p.options = [];
          } else if (profile === 'normal') {
            // 典型：火力随关卡自然成长，第 6 关起满级（5 级）+ 双僚机
            if (id <= 2) { p.weapons = [0]; p.lv = [2]; }
            else if (id <= 5) { p.weapons = [0, 1]; p.lv = [3, 3]; }
            else { p.weapons = [0, 2, 5]; p.lv = [5, 5, 5]; }
            p.slotT = p.weapons.map(() => 0);
            p.options = mkOpt(id <= 2 ? 0 : id <= 5 ? 1 : 2);
          } else {
            p.weapons = [0, 2, 6]; p.lv = [5, 5, 5]; p.slotT = [0, 0, 0]; p.options = mkOpt(2);
          }

          let spawned = 0, killed = 0, escaped = 0, peak = 0;
          const origSpawn = g._spawnEnemy.bind(g);
          g._spawnEnemy = q => { spawned++; return origSpawn(q); };
          const origKill = g.onEnemyKilled.bind(g);
          g.onEnemyKilled = e => { killed++; return origKill(e); };

          const seen = new WeakSet();
          let frames = 0, clearT = -1, maxAlive = 0;
          const STEP = 1 / 60;
          while (frames < 60 * 75) {
            // 玩家 AI：贴着底部，横向追最靠下的敌人
            let tx = VIEW.w / 2, best = -1;
            for (const e of g.enemies) {
              if (!e.active || e.fromBottom && e.y > VIEW.h) continue;
              if (e.y > best) { best = e.y; tx = e.x; }
            }
            const dx = tx - p.x;
            const step = 330 * STEP;
            p.x += Math.abs(dx) <= step ? dx : Math.sign(dx) * step;
            p.y = 730;
            p.invuln = 5;              // 无敌，只测火力
            p.canFire = true;

            g.update(STEP);
            frames++;
            const alive = g.enemies.filter(e => e.active).length;
            if (alive > maxAlive) maxAlive = alive;
            for (const e of g.enemies) {
              if (!e.active || e.fromBottom) continue;
              if (e.y > VIEW.h + 6 && !seen.has(e)) { seen.add(e); escaped++; }
            }
            if (g.state !== 'intro' && g.state !== 'play' && clearT < 0) clearT = frames * STEP;
            if (clearT >= 0) break;
          }
          const aliveEnd = g.enemies.filter(e => e.active).length;
          out.push({
            stage: id, spawned, killed, escaped, aliveEnd,
            peak: maxAlive,
            clearT: clearT > 0 ? +clearT.toFixed(1) : -1,
          });

          g._spawnEnemy = origSpawn;
          g.onEnemyKilled = origKill;
        }
        applyHp(window.__newHp);
        return out;
      }""",
        [mode, profile, OLD_HP, OLD_MINIBOSS_WAVE],
    )


def show(title, rows):
    print(f"\n== {title} ==")
    print(f"{'关':>2} {'生成':>5} {'击杀':>5} {'漏过':>5} {'存活':>5} {'峰值':>5} {'清场耗时':>8} {'漏怪率':>6}")
    tot_s = tot_k = tot_e = 0
    for r in rows:
        rate = r['escaped'] / max(1, r['spawned']) * 100
        print(f"{r['stage']:>2} {r['spawned']:>5} {r['killed']:>5} {r['escaped']:>5} "
              f"{r['aliveEnd']:>5} {r['peak']:>5} {r['clearT']:>8} {rate:>5.0f}%")
        tot_s += r['spawned']; tot_k += r['killed']; tot_e += r['escaped']
    print(f"合计 生成 {tot_s} 击杀 {tot_k} 漏过 {tot_e} 漏怪率 {tot_e / max(1, tot_s) * 100:.0f}%")


def main():
    srv = subprocess.Popen(
        [sys.executable, '-m', 'http.server', str(PORT)],
        cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    try:
        time.sleep(1.0)
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=['--use-gl=swiftshader', '--disable-gpu-sandbox'])
            page = b.new_page(viewport={'width': 480, 'height': 854})
            errs = []
            page.on('pageerror', lambda e: errs.append(str(e)))
            page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
            page.goto(f'http://127.0.0.1:{PORT}/index.html')
            page.wait_for_function('window.game && window.game.state', timeout=15000)
            # 跳过标题：先建好关卡数据，否则 play 状态下 waves 还是 undefined
            page.evaluate('window.game.startLevel(0, false); window.game.state = "play";')
            time.sleep(0.3)

            for mode in ('old', 'new'):
                for profile in ('rookie', 'normal', 'veteran'):
                    rows = run(page, mode, profile)
                    name = {'rookie': '下限 Lv1 单槽', 'normal': '典型 随关卡成长', 'veteran': '熟练 Lv5 三槽'}[profile]
                    show(('改前' if mode == 'old' else '改后') + ' / ' + name, rows)

            print('\n页面错误:', errs[:5] if errs else '无')
            b.close()
    finally:
        srv.terminate()


if __name__ == '__main__':
    main()
