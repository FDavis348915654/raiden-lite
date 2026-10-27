#!/usr/bin/env python3
"""从图集里分析每个 BOSS 的实体轮廓，生成"贴合形状"的判定圆组（BOSS_HULL）。

为什么不用单一矩形：
  BOSS 贴图是不规则的（菱形、圆形、带翼），一个 72%×64% 的矩形会框进大量空白，
  表现为"明明没碰到却撞死了"。改成 6~8 个内切圆拼出的近似轮廓，判定贴合、
  运算量仍然是圆-圆距离。

算法：对 alpha 通道做欧氏距离变换，贪心取最大内切圆，直到覆盖率达标。
  半径按内切圆取，所以圆不会溢出到透明区域——判定只会略小于视觉，不会误伤。

用法：
    python3 tools/gen_boss_hull.py            # 打印结果
    python3 tools/gen_boss_hull.py --write    # 直接写入 js/levels.js 的 BOSS_HULL
"""
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
ALPHA = 96          # 低于这个值算透明（精灵是不透明+抗锯齿边缘，双峰分布）
MAX_CIRCS = 12      # 单只 BOSS 最多几个圆
COVER = 0.90        # 目标覆盖率
MIN_R = 0.035       # 半径下限（相对精灵短边），再小的碎片忽略

# 少数 BOSS 的可见实体由多个分离块组成（例如星环本体 + 环上的能量节点），
# 默认 5% 的碎片阈值会把它们当噪点删掉，这里单独放宽。
MIN_SHARE = {'boss9': 0.012}


def body_mask(mask: np.ndarray, min_share: float = 0.05) -> np.ndarray:
    """只保留主体与大连通域，丢掉星尘、光点这类碎片。
    否则距离变换会被散点带偏，判定框会散成一片小圆。"""
    lab, n = ndimage.label(mask)
    if n <= 1:
        return mask
    sizes = ndimage.sum(mask, lab, range(1, n + 1))
    keep = [i + 1 for i, sz in enumerate(sizes) if sz >= mask.sum() * min_share]
    return np.isin(lab, keep) if keep else mask


def union_area(circs, w, h):
    yy, xx = np.ogrid[:h, :w]
    got = np.zeros((h, w), dtype=bool)
    for cx, cy, r in circs:
        got |= (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
    return got


def circles_for(mask: np.ndarray, max_circs: int, cover: float, min_r: float,
                min_share: float = 0.05):
    """贪心取最大内切圆覆盖前景"""
    mask = body_mask(mask, min_share)
    edt = ndimage.distance_transform_edt(mask)
    h, w = mask.shape
    total = mask.sum()
    short = min(w, h)
    chosen = []
    got = np.zeros_like(mask, dtype=bool)

    while len(chosen) < max_circs:
        # 每轮把已覆盖区域的候选权重清零，保证下一个圆落在未覆盖处
        cand = np.where(got, 0, edt)
        idx = np.unravel_index(np.argmax(cand), cand.shape)
        r = cand[idx]
        if r < short * min_r:
            break
        cy, cx = idx
        chosen.append((int(cx), int(cy), float(r)))
        yy, xx = np.ogrid[:h, :w]
        inside = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
        got |= inside & mask

        if got.sum() / total >= cover:
            break
    return chosen


def main():
    img = Image.open(ROOT / 'assets/sprites.png').convert('RGBA')
    frames = json.loads((ROOT / 'assets/sprites.json').read_text())['frames']
    names = sorted(k for k in frames if k.startswith('boss'))

    out = {}
    for name in names:
        x, y, w, h = frames[name]
        a = np.array(img.crop((x, y, x + w, y + h)).split()[3])
        mask = a >= ALPHA
        circs = circles_for(mask, MAX_CIRCS, COVER, MIN_R,
                            MIN_SHARE.get(name, 0.05))
        rect = (w * 0.72) * (h * 0.64)     # 旧版单一矩形的面积，作为"总宽容度"基准

        # 面积标定：多圆并集容易比旧矩形大，超过 130% 才整体收缩。
        # 不追求"面积相等"——形状贴合后，同一块面积里空白少得多，
        # 硬压到等面积反而会把圆缩碎、留出缝隙。
        base = [(c[0], c[1], c[2]) for c in circs]
        area1 = union_area(base, w, h).sum()
        k = 1.0 if area1 <= rect * 1.3 else (rect * 1.3 / area1) ** 0.5
        circs = [(x_, y_, r * k) for x_, y_, r in base]

        # 兜底：若贴合后面积不到旧矩形的 55%，在中心补一个大圆。
        # 典型是 boss9（判定只在中央核心，环是能量特效），否则玩家能整只穿过去。
        area_now = union_area(circs, w, h).sum()
        if area_now < rect * 0.55:
            rb = (rect * 0.55 / 3.14159) ** 0.5
            # 被这个兜底圆完全包住的圆没有意义，先剔掉
            circs = [c for c in circs
                     if ((c[0] - w / 2) ** 2 + (c[1] - h / 2) ** 2) ** 0.5 + c[2] > rb]
            circs.append((w / 2, h / 2, rb))

        got = union_area(circs, w, h)
        body = body_mask(mask, MIN_SHARE.get(name, 0.05))
        cov = (got & body).sum() / body.sum()
        area = got.sum()
        out[name] = {
            'w': w, 'h': h,
            'circles': [{'dx': c[0] - w // 2, 'dy': c[1] - h // 2, 'r': round(c[2], 1)}
                        for c in circs],
        }
        print(f'{name}: {w}x{h}  {len(circs)} 个圆  k={k:.2f}  '
              f'主体覆盖率 {cov*100:.1f}%  判定面积 {area}px² '
              f'(旧矩形 {rect:.0f}px², {area/rect*100:.0f}%)')

    lines = ['const BOSS_HULL = {']
    for name, d in out.items():
        seg = ', '.join(f"{{dx:{c['dx']},dy:{c['dy']},r:{c['r']}}}" for c in d['circles'])
        lines.append(f'  {name}: [{seg}],')
    lines.append('};')
    js = '\n'.join(lines)

    if '--write' in sys.argv:
        p = ROOT / 'js/levels.js'
        s = p.read_text(encoding='utf-8')
        start = s.find('const BOSS_HULL = {')
        if start >= 0:
            end = s.find('\n};', start) + 3
            s = s[:start] + js + s[end:]
        else:
            s = s.rstrip() + '\n\n' + js + '\n'
        p.write_text(s, encoding='utf-8')
        print('\n已写入 js/levels.js')
    else:
        print('\n' + js)


if __name__ == '__main__':
    main()
