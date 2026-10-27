"""冒烟测试：真实渲染跑几关，抓控制台错误并截图。

用法：python3 tools/smoke.py [线上URL]
不传 URL 时测本地 file:// 与 http://127.0.0.1:8232。
"""
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
PORT = 8232
# 截图写到系统临时目录，不污染工程（跨平台，Linux/macOS/Windows 都可用）
OUT = Path(tempfile.gettempdir()) / 'raiden-lite-smoke'
OUT.mkdir(parents=True, exist_ok=True)


def check(page, label, errors):
    page.wait_for_timeout(400)
    page.evaluate("""() => {
        const g = window.game;
        // 让玩家自动瞄准最靠下的敌人，方便看子弹命中 / 血条
        if (!window.__aiOn) {
          window.__aiOn = true;
          const tick = () => {
            const gg = window.game;
            if (gg && gg.state === 'play') {
              let best = -1, tx = VIEW.w / 2;
              for (const e of gg.enemies) {
                if (!e.active || (e.fromBottom && e.y > VIEW.h)) continue;
                if (e.y > best) { best = e.y; tx = e.x; }
              }
              gg.player.x += Math.max(-8, Math.min(8, tx - gg.player.x));
              gg.player.invuln = 5;
            }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        }
    }""")
    page.wait_for_timeout(5200)
    shot = OUT / f'{label}.png'
    page.screenshot(path=str(shot))
    info = page.evaluate("""() => {
        const g = window.game;
        return {
            state: g.state, fps: g.fps, ver: VERSION,
            enemies: g.enemies.filter(e => e.active).length,
            bullets: g.bullets.filter(b => b.active).length,
            crash: g.crashCount || 0,
        };
    }""")
    print(f'  {label}: {info}  截图 {shot.name}')
    if info['crash']:
        errors.append(f'{label}: crashCount={info["crash"]}')


def main():
    urls = sys.argv[1:] or []
    srv = None
    if not urls:
        srv = subprocess.Popen(
            [sys.executable, '-m', 'http.server', str(PORT)],
            cwd=str(ROOT), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        time.sleep(1.0)
        urls = [f'file://{ROOT}/index.html', f'http://127.0.0.1:{PORT}/index.html']

    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(args=['--use-gl=swiftshader'])
            for url in urls:
                print(f'\n### {url}')
                page = b.new_page(viewport={'width': 480, 'height': 854})
                errs = []
                page.on('pageerror', lambda e: errs.append(f'pageerror: {e}'))
                page.on('console', lambda m: errs.append(m.text) if m.type == 'error' else None)
                page.on('requestfailed', lambda r: errs.append(f'reqfail: {r.url}'))
                page.goto(url)
                page.wait_for_function('window.game && window.game.state', timeout=15000)
                page.evaluate('window.game.startLevel(0, false); window.game.state = "play";')
                check(page, f'{url.split("/")[-1]}'.replace('.html', '') + '-s1', errs)

                for sid, tag in ((5, 's5'), (9, 's9')):
                    page.evaluate(f'window.game.startLevel({sid - 1}, true); window.game.state = "play";')
                    check(page, f'{tag}', errs)
                print('  错误:', errs[:6] if errs else '无')
                page.close()
            b.close()
    finally:
        if srv:
            srv.terminate()


if __name__ == '__main__':
    main()
