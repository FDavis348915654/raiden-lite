# -*- coding: utf-8 -*-
"""
Raiden Lite 素材生成器
- 全部图形程序化绘制，4x 超采样后降采样，保证小尺寸下边缘干净
- 输出: assets/sprites.png + assets/sprites.json + assets/bg/*.png
- 另出 _contact.png 供人工验收
"""
import json
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 4  # 超采样倍数
SCALE = 1.3  # 全局尺寸放大系数：小尺寸下细节会糊成一团
HERE = os.path.dirname(os.path.abspath(__file__))
ASSETS = os.path.normpath(os.path.join(HERE, '..', 'assets'))

# ---------------------------------------------------------------- 调色板
# 统一美术语言: 近黑描边 + 双色主体 + 高光面 + 霓虹点缀
PAL = {
    'player': dict(dark=(9, 18, 30), base=(108, 196, 224), light=(222, 250, 255),
                   accent=(96, 245, 255), core=(180, 255, 255)),
    # 关卡 1  高空哨戒  钢蓝
    'l1': dict(dark=(12, 20, 34), base=(92, 138, 178), light=(186, 214, 244),
               accent=(120, 216, 255), core=(160, 240, 255)),
    # 关卡 2  黄昏峡谷  琥珀
    'l2': dict(dark=(34, 16, 10), base=(186, 104, 52), light=(255, 198, 128),
               accent=(255, 168, 64), core=(255, 214, 140)),
    # 关卡 3  深海要塞  青绿
    'l3': dict(dark=(6, 26, 28), base=(52, 146, 142), light=(150, 236, 218),
               accent=(80, 255, 214), core=(190, 255, 240)),
    # 关卡 4  轨道残骸  紫银
    'l4': dict(dark=(20, 12, 34), base=(118, 96, 172), light=(206, 190, 244),
               accent=(178, 130, 255), core=(228, 200, 255)),
    # 关卡 6  极光堡垒  冰青
    'l6': dict(dark=(8, 26, 32), base=(92, 200, 196), light=(214, 255, 250),
               accent=(120, 255, 232), core=(228, 255, 252)),
    # 关卡 7  虚空王座  黑金
    'l7': dict(dark=(10, 7, 16), base=(86, 68, 116), light=(206, 186, 250),
               accent=(255, 198, 96), core=(255, 242, 208)),
    # 关卡 8  裂殖之巢  酸绿
    'l8': dict(dark=(10, 26, 12), base=(96, 190, 88), light=(214, 255, 178),
               accent=(178, 255, 96), core=(240, 255, 214)),
    # 关卡 9  终焉星环  白金紫
    'l9': dict(dark=(12, 8, 24), base=(120, 112, 176), light=(238, 232, 255),
               accent=(180, 190, 255), core=(255, 255, 255)),
    # 关卡 5  熔核母舰  熔岩
    'l5': dict(dark=(32, 8, 8), base=(172, 52, 44), light=(255, 146, 96),
               accent=(255, 92, 56), core=(255, 210, 120)),
}


def rgba(c, a=255):
    return (c[0], c[1], c[2], a)


def shade(c, k):
    return tuple(max(0, min(255, int(v * k))) for v in c)


def centroid(pts):
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def shrink(pts, k):
    cx, cy = centroid(pts)
    return [(cx + (x - cx) * (1 - k), cy + (y - cy) * (1 - k)) for x, y in pts]


def mirror_pts(left):
    """左半 -> 完整, 输入按从机头沿左侧到尾部的顺序"""
    right = [(1 - x, y) for x, y in reversed(left)]
    return left + right


class Sprite:
    def __init__(self, w, h, scale=None):
        k = SCALE if scale is None else scale
        self.w, self.h = int(w * k), int(h * k)
        self.img = Image.new('RGBA', (self.w * SS, self.h * SS), (0, 0, 0, 0))
        self.d = ImageDraw.Draw(self.img)

    # 坐标统一用 0..1 归一化
    def _p(self, pts):
        return [(x * self.w * SS, y * self.h * SS) for x, y in pts]

    def poly(self, pts, fill=None, outline=None, ow=0.0):
        p = self._p(pts)
        if fill:
            self.d.polygon(p, fill=rgba(fill) if len(fill) == 3 else fill)
        if outline and ow:
            self.d.line(p + [p[0]], fill=rgba(outline) if len(outline) == 3 else outline,
                        width=max(1, int(ow * self.w * SS)), joint='curve')

    def ell(self, cx, cy, rx, ry, fill=None, outline=None, ow=0.0):
        box = [(cx - rx) * self.w * SS, (cy - ry) * self.h * SS,
               (cx + rx) * self.w * SS, (cy + ry) * self.h * SS]
        self.d.ellipse(box,
                       fill=rgba(fill) if fill and len(fill) == 3 else fill,
                       outline=rgba(outline) if outline else None,
                       width=max(1, int(ow * self.w * SS)) if ow else 0)

    def seg(self, x1, y1, x2, y2, color, w=0.03):
        self.d.line([x1 * self.w * SS, y1 * self.h * SS, x2 * self.w * SS, y2 * self.h * SS],
                    fill=rgba(color), width=max(1, int(w * self.w * SS)))

    def glow(self, cx, cy, r, color, alpha=190, blur=1.0):
        layer = Image.new('RGBA', self.img.size, (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        box = [(cx - r) * self.w * SS, (cy - r) * self.h * SS,
               (cx + r) * self.w * SS, (cy + r) * self.h * SS]
        d.ellipse(box, fill=rgba(color, alpha))
        layer = layer.filter(ImageFilter.GaussianBlur(r * self.w * SS * 0.55 * blur))
        self.img.alpha_composite(layer)
        self.d = ImageDraw.Draw(self.img)

    def done(self):
        return self.img.resize((self.w, self.h), Image.LANCZOS)


# ---------------------------------------------------------------- 部件
def hull(s, pts, pal, hi=None, rim=True):
    """机身: 深色底 + 内缩主体 + 高光面。
    不画 outline：PIL 的 line joint='curve' 会在尖角留下黑圆点，小尺寸下像方块。
    """
    s.poly(pts, fill=shade(pal['dark'], 1.0))
    s.poly(shrink(pts, 0.075), fill=pal['base'])
    if hi:
        s.poly(hi, fill=pal['light'])


def plate(s, pts, pal, k=0.82):
    """装甲板: 略暗的实心块 + 细边"""
    s.poly(pts, fill=shade(pal['base'], k), outline=shade(pal['dark'], 0.7), ow=0.008)


def cockpit(s, cx, cy, rx, ry, pal, glow=True):
    # 底色用机身同系的暗色，纯黑在小尺寸下会糊成方块
    s.ell(cx, cy, rx * 1.18, ry * 1.18, fill=shade(pal['base'], 0.42))
    s.ell(cx, cy, rx, ry, fill=pal['core'])
    s.ell(cx - rx * 0.30, cy - ry * 0.32, rx * 0.42, ry * 0.34, fill=(255, 255, 255))
    if glow:
        s.glow(cx, cy - ry * 0.1, rx * 2.0, pal['accent'], alpha=150)


def nozzle(s, cx, cy, r, color):
    s.ell(cx, cy, r, r * 1.25, fill=(255, 255, 255))
    s.glow(cx, cy, r * 2.6, color, alpha=210)


def turret(s, cx, cy, r, pal, angle=math.pi / 2, barrel=0.9):
    """炮塔: 底座 + 炮管"""
    bx = cx + math.cos(angle) * r * barrel
    by = cy + math.sin(angle) * r * barrel
    s.seg(cx, cy, bx, by, shade(pal['dark'], 0.8), w=r * 1.1)
    s.ell(cx, cy, r, r, fill=shade(pal['base'], 1.1), outline=shade(pal['dark'], 0.8), ow=0.01)
    s.ell(cx, cy, r * 0.5, r * 0.5, fill=pal['core'])
    s.glow(cx, cy, r * 2.0, pal['accent'], alpha=120)


# ---------------------------------------------------------------- 玩家
def make_player():
    s = Sprite(40, 48)
    pal = PAL['player']
    body = mirror_pts([
        (0.50, 0.02),
        (0.435, 0.34),
        (0.415, 0.60),
        (0.40, 0.90),
        (0.46, 0.98),
    ])
    hull(s, body, pal, hi=[(0.50, 0.06), (0.455, 0.36), (0.50, 0.72)])

    # 主翼（后掠）
    wing_l = [(0.41, 0.44), (0.05, 0.74), (0.10, 0.84), (0.42, 0.78)]
    wing_r = [(0.59, 0.44), (0.95, 0.74), (0.90, 0.84), (0.58, 0.78)]
    for w, hi in ((wing_l, [(0.41, 0.46), (0.10, 0.76), (0.22, 0.78)]),
                  (wing_r, [(0.59, 0.46), (0.90, 0.76), (0.78, 0.78)])):
        s.poly(w, fill=shade(pal['dark'], 1.0), outline=shade(pal['dark'], 0.4), ow=0.012)
        s.poly(shrink(w, 0.07), fill=pal['base'])
        s.poly(hi, fill=shade(pal['light'], 0.92))

    # 翼尖导弹
    for mx in (0.09, 0.91):
        s.poly([(mx - 0.030, 0.72), (mx + 0.030, 0.72), (mx + 0.016, 0.90), (mx - 0.016, 0.90)],
               fill=shade(pal['light'], 0.95), outline=shade(pal['accent'], 1.0), ow=0.006)

    # 前翼
    for d in (-1, 1):
        s.poly([(0.50 + d * 0.05, 0.30), (0.50 + d * 0.20, 0.40),
                (0.50 + d * 0.18, 0.48), (0.50 + d * 0.05, 0.44)],
               fill=shade(pal['base'], 0.85))

    cockpit(s, 0.50, 0.30, 0.075, 0.115, pal)
    # 背部脊线
    s.seg(0.50, 0.42, 0.50, 0.86, shade(pal['accent'], 1.0), w=0.022)
    # 双引擎
    for nx in (0.445, 0.555):
        nozzle(s, nx, 0.95, 0.035, pal['accent'])
    return s.done()


# ---------------------------------------------------------------- 敌机
def make_scout():
    """侦察机: 细长箭形"""
    s = Sprite(34, 32)
    pal = PAL['l1']
    pts = [(0.50, 0.99), (0.43, 0.62), (0.04, 0.30), (0.19, 0.18),
           (0.44, 0.28), (0.50, 0.06), (0.56, 0.28), (0.81, 0.18),
           (0.96, 0.30), (0.57, 0.62)]
    hull(s, pts, pal)
    s.poly([(0.50, 0.96), (0.455, 0.62), (0.545, 0.62)], fill=shade(pal['light'], 0.9))
    cockpit(s, 0.50, 0.40, 0.055, 0.085, pal)
    s.seg(0.30, 0.34, 0.44, 0.30, pal['accent'], w=0.02)
    s.seg(0.70, 0.34, 0.56, 0.30, pal['accent'], w=0.02)
    return s.done()


def make_fighter():
    """战机: 前掠翼"""
    s = Sprite(38, 34)
    pal = PAL['l1']
    pts = [(0.50, 1.00), (0.41, 0.56), (0.06, 0.62), (0.16, 0.30),
           (0.42, 0.34), (0.50, 0.04), (0.58, 0.34), (0.84, 0.30),
           (0.94, 0.62), (0.59, 0.56)]
    hull(s, pts, pal)
    s.poly([(0.50, 0.92), (0.44, 0.58), (0.56, 0.58)], fill=shade(pal['light'], 0.85))
    for d in (-1, 1):
        s.poly([(0.50 + d * 0.10, 0.50), (0.50 + d * 0.40, 0.56),
                (0.50 + d * 0.36, 0.44)], fill=shade(pal['accent'], 0.8))
    cockpit(s, 0.50, 0.38, 0.05, 0.07, pal)
    nozzle(s, 0.50, 0.08, 0.03, pal['accent'])
    return s.done()


def make_bomber():
    """轰炸机: 宽体双吊舱"""
    s = Sprite(46, 40)
    pal = PAL['l1']
    pts = [(0.30, 0.96), (0.23, 0.56), (0.07, 0.46), (0.07, 0.26),
           (0.30, 0.20), (0.36, 0.06), (0.64, 0.06), (0.70, 0.20),
           (0.93, 0.26), (0.93, 0.46), (0.77, 0.56), (0.70, 0.96)]
    hull(s, pts, pal)
    # 吊舱
    for px in (0.20, 0.80):
        s.ell(px, 0.62, 0.085, 0.16, fill=shade(pal['base'], 0.9),
              outline=shade(pal['dark'], 0.7), ow=0.01)
        s.ell(px, 0.72, 0.035, 0.04, fill=pal['core'])
    # 装甲带
    s.poly([(0.36, 0.24), (0.64, 0.24), (0.62, 0.34), (0.38, 0.34)], fill=shade(pal['light'], 0.8))
    cockpit(s, 0.50, 0.44, 0.06, 0.08, pal)
    for nx in (0.40, 0.60):
        nozzle(s, nx, 0.09, 0.03, pal['accent'])
    return s.done()


def make_diver():
    """俯冲机: 长尖机头"""
    s = Sprite(34, 38)
    pal = PAL['l2']
    pts = [(0.50, 1.00), (0.37, 0.50), (0.05, 0.38), (0.24, 0.24),
           (0.43, 0.32), (0.50, 0.02), (0.57, 0.32), (0.76, 0.24),
           (0.95, 0.38), (0.63, 0.50)]
    hull(s, pts, pal)
    s.poly([(0.50, 0.97), (0.445, 0.50), (0.555, 0.50)], fill=shade(pal['light'], 0.9))
    cockpit(s, 0.50, 0.34, 0.05, 0.07, pal)
    for d in (-1, 1):
        s.seg(0.50 + d * 0.14, 0.36, 0.50 + d * 0.28, 0.30, pal['core'], w=0.018)
    return s.done()


def make_mine():
    """浮雷: 球体 + 尖刺"""
    s = Sprite(30, 30)
    pal = PAL['l2']
    for i in range(8):
        a = i * math.pi / 4
        x2 = 0.5 + math.cos(a) * 0.47
        y2 = 0.5 + math.sin(a) * 0.47
        s.seg(0.5 + math.cos(a) * 0.22, 0.5 + math.sin(a) * 0.22, x2, y2,
              shade(pal['dark'], 1.5), w=0.062)
        s.seg(0.5 + math.cos(a) * 0.26, 0.5 + math.sin(a) * 0.26, x2, y2,
              pal['accent'], w=0.026)
    s.ell(0.5, 0.5, 0.30, 0.30, fill=shade(pal['dark'], 1.1),
          outline=shade(pal['dark'], 0.5), ow=0.014)
    s.ell(0.5, 0.5, 0.245, 0.245, fill=pal['base'])
    s.ell(0.45, 0.44, 0.10, 0.08, fill=shade(pal['light'], 0.9))
    s.glow(0.5, 0.5, 0.16, pal['accent'], alpha=210)
    s.ell(0.5, 0.5, 0.055, 0.055, fill=(255, 255, 255))
    return s.done()


def make_formation():
    """编队机: 正三角"""
    s = Sprite(32, 30)
    pal = PAL['l2']
    pts = [(0.50, 0.97), (0.04, 0.16), (0.20, 0.06), (0.50, 0.26),
           (0.80, 0.06), (0.96, 0.16)]
    hull(s, pts, pal)
    s.poly([(0.50, 0.92), (0.30, 0.22), (0.70, 0.22)], fill=shade(pal['base'], 1.15))
    cockpit(s, 0.50, 0.36, 0.06, 0.07, pal)
    for d in (-1, 1):
        s.seg(0.50 + d * 0.22, 0.20, 0.50 + d * 0.34, 0.14, pal['core'], w=0.02)
    return s.done()


def make_torpedo():
    """鱼雷机: 鱼雷状机身 + 后掠翼 + 尾翼"""
    s = Sprite(36, 30)
    pal = PAL['l3']
    hull(s, mirror_pts([(0.50, 0.99), (0.315, 0.62), (0.365, 0.22), (0.50, 0.05)]), pal,
         hi=[(0.50, 0.95), (0.40, 0.60), (0.50, 0.20)])
    for d in (-1, 1):
        s.poly([(0.5 + d * 0.05, 0.46), (0.5 + d * 0.48, 0.66),
                (0.5 + d * 0.44, 0.77), (0.5 + d * 0.06, 0.60)],
               fill=shade(pal['base'], 0.88), outline=shade(pal['dark'], 0.55), ow=0.008)
        s.poly([(0.5 + d * 0.04, 0.17), (0.5 + d * 0.23, 0.06),
                (0.5 + d * 0.04, 0.02)], fill=shade(pal['base'], 1.1))
        s.ell(0.5 + d * 0.09, 0.20, 0.030, 0.028, fill=pal['core'])
        s.glow(0.5 + d * 0.09, 0.23, 0.055, pal['accent'], alpha=180)
    s.ell(0.50, 0.56, 0.055, 0.075, fill=pal['core'])
    s.glow(0.50, 0.56, 0.11, pal['accent'], alpha=170)
    return s.done()


def make_eel():
    """电鳗: 连续蛇形躯体 + 发光节点"""
    s = Sprite(44, 30)
    pal = PAL['l3']
    spine = [(0.09, 0.32), (0.24, 0.44), (0.38, 0.58), (0.54, 0.52),
             (0.70, 0.40), (0.88, 0.46)]
    for a, b in zip(spine, spine[1:]):
        s.seg(a[0], a[1], b[0], b[1], shade(pal['dark'], 0.55), w=0.170)
    for a, b in zip(spine, spine[1:]):
        s.seg(a[0], a[1], b[0], b[1], pal['base'], w=0.115)
    for i, p in enumerate(spine):
        r = 0.085 - i * 0.010
        s.ell(p[0], p[1], r, r, fill=pal['base'])
        s.ell(p[0] - r * 0.3, p[1] - r * 0.35, r * 0.35, r * 0.25,
              fill=shade(pal['light'], 0.9))
    # 头
    s.ell(0.09, 0.32, 0.105, 0.115, fill=shade(pal['base'], 1.15),
          outline=shade(pal['dark'], 0.55), ow=0.012)
    s.ell(0.075, 0.28, 0.028, 0.032, fill=(255, 255, 255))
    s.glow(0.09, 0.33, 0.10, pal['accent'], alpha=200)
    # 电节点
    for p in spine[1::2]:
        s.glow(p[0], p[1], 0.05, pal['accent'], alpha=170)
    return s.done()


def make_jelly():
    """水母: 伞盖 + 长触须"""
    s = Sprite(34, 38)
    pal = PAL['l3']
    # 触须（先画，压在伞盖下）
    for i in range(5):
        x0 = 0.28 + i * 0.11
        pts = []
        for t in range(9):
            yy = 0.40 + t * 0.065
            xx = x0 + math.sin(t * 0.85 + i * 1.3) * 0.045
            pts.append((xx, yy))
        for a, b in zip(pts, pts[1:]):
            s.seg(a[0], a[1], b[0], b[1], shade(pal['accent'], 0.85), w=0.020)
        s.glow(pts[-1][0], pts[-1][1], 0.03, pal['accent'], alpha=150)
    # 伞盖（半圆）
    s.d.arc([(0.5 - 0.36) * s.w * SS, (0.42 - 0.40) * s.h * SS,
             (0.5 + 0.36) * s.w * SS, (0.42 + 0.40) * s.h * SS],
            start=180, end=360, fill=rgba(shade(pal['dark'], 1.1), 255),
            width=int(0.10 * s.w * SS))
    s.d.pieslice([(0.5 - 0.36) * s.w * SS, (0.42 - 0.40) * s.h * SS,
                  (0.5 + 0.36) * s.w * SS, (0.42 + 0.40) * s.h * SS],
                 start=180, end=360, fill=rgba(shade(pal['dark'], 1.1), 255))
    s.d.pieslice([(0.5 - 0.30) * s.w * SS, (0.42 - 0.33) * s.h * SS,
                  (0.5 + 0.30) * s.w * SS, (0.42 + 0.33) * s.h * SS],
                 start=180, end=360, fill=rgba(pal['base'], 255))
    s.d.pieslice([(0.5 - 0.20) * s.w * SS, (0.42 - 0.22) * s.h * SS,
                  (0.5 + 0.20) * s.w * SS, (0.42 + 0.22) * s.h * SS],
                 start=200, end=270, fill=rgba(shade(pal['light'], 0.9), 220))
    # 边缘光
    s.d.arc([(0.5 - 0.345) * s.w * SS, (0.42 - 0.385) * s.h * SS,
             (0.5 + 0.345) * s.w * SS, (0.42 + 0.385) * s.h * SS],
            start=185, end=355, fill=rgba(pal['accent'], 220),
            width=int(0.014 * s.w * SS))
    s.glow(0.50, 0.38, 0.17, pal['accent'], alpha=170)
    s.ell(0.50, 0.34, 0.055, 0.05, fill=(255, 255, 255))
    return s.done()


def make_drone():
    """无人机: 六边形 + 环"""
    s = Sprite(28, 28)
    pal = PAL['l4']
    hexp = [(0.5 + math.cos(math.pi / 3 * i + math.pi / 6) * 0.34,
             0.5 + math.sin(math.pi / 3 * i + math.pi / 6) * 0.34) for i in range(6)]
    s.poly(hexp, fill=shade(pal['dark'], 1.1), outline=shade(pal['dark'], 0.5), ow=0.014)
    s.poly(shrink(hexp, 0.18), fill=pal['base'])
    s.poly(shrink(hexp, 0.45), fill=shade(pal['light'], 0.9))
    # 内环 + 三向灯
    s.d.ellipse([(0.5 - 0.20) * s.w * SS, (0.5 - 0.20) * s.h * SS,
                 (0.5 + 0.20) * s.w * SS, (0.5 + 0.20) * s.h * SS],
                outline=rgba(pal['accent'], 200), width=int(0.022 * s.w * SS))
    for i in range(3):
        a = -math.pi / 2 + i * math.tau / 3
        s.ell(0.5 + math.cos(a) * 0.20, 0.5 + math.sin(a) * 0.20, 0.018, 0.018, fill=pal['core'])
    s.glow(0.5, 0.5, 0.16, pal['accent'], alpha=200)
    s.ell(0.5, 0.5, 0.06, 0.06, fill=(255, 255, 255))
    return s.done()


def make_shield():
    """护盾机: 窄机身 + 前向能量护罩"""
    s = Sprite(36, 36)
    pal = PAL['l4']
    body = [(0.50, 0.90), (0.35, 0.66), (0.35, 0.28), (0.50, 0.14),
            (0.65, 0.28), (0.65, 0.66)]
    hull(s, body, pal, hi=[(0.50, 0.84), (0.41, 0.62), (0.50, 0.26)])
    cockpit(s, 0.50, 0.70, 0.055, 0.060, pal)
    # 半透明能量护罩（独立图层叠加，才有透明混合）
    box = [(0.5 - 0.47) * s.w * SS, (0.5 - 0.47) * s.h * SS,
           (0.5 + 0.47) * s.w * SS, (0.5 + 0.47) * s.h * SS]
    layer = Image.new('RGBA', s.img.size, (0, 0, 0, 0))
    d2 = ImageDraw.Draw(layer)
    d2.pieslice(box, start=28, end=152, fill=rgba(pal['accent'], 60))
    layer = layer.filter(ImageFilter.GaussianBlur(2.0 * SS))
    s.img.alpha_composite(layer)
    s.d = ImageDraw.Draw(s.img)
    # 边缘亮弧
    s.d.arc(box, start=28, end=152, fill=rgba(pal['accent'], 235), width=int(0.022 * s.w * SS))
    s.d.arc(box, start=40, end=140, fill=(230, 245, 255, 170), width=int(0.008 * s.w * SS))
    return s.done()


def make_kamikaze():
    """自爆机: 水滴 + 红核"""
    s = Sprite(30, 34)
    pal = PAL['l4']
    pts = [(0.50, 1.00), (0.20, 0.52), (0.26, 0.18), (0.50, 0.04),
           (0.74, 0.18), (0.80, 0.52)]
    s.poly(pts, fill=shade(pal['dark'], 1.1), outline=shade(pal['dark'], 0.5), ow=0.012)
    s.poly(shrink(pts, 0.09), fill=pal['base'])
    s.poly([(0.50, 0.95), (0.30, 0.52), (0.50, 0.30), (0.70, 0.52)], fill=shade(pal['base'], 1.2))
    s.glow(0.50, 0.55, 0.20, (255, 80, 80), alpha=220)
    s.ell(0.50, 0.55, 0.09, 0.10, fill=(255, 120, 110))
    s.ell(0.50, 0.53, 0.04, 0.045, fill=(255, 240, 230))
    return s.done()


def make_flame():
    """火焰机: 锥形 + 侧喷口"""
    s = Sprite(38, 36)
    pal = PAL['l5']
    pts = [(0.50, 0.98), (0.34, 0.52), (0.08, 0.34), (0.26, 0.18),
           (0.44, 0.26), (0.50, 0.04), (0.56, 0.26), (0.74, 0.18),
           (0.92, 0.34), (0.66, 0.52)]
    hull(s, pts, pal)
    s.poly([(0.50, 0.94), (0.42, 0.50), (0.58, 0.50)], fill=shade(pal['light'], 0.85))
    for px in (0.20, 0.80):
        s.ell(px, 0.44, 0.055, 0.10, fill=shade(pal['dark'], 1.3))
        s.glow(px, 0.50, 0.10, (255, 150, 60), alpha=220)
    cockpit(s, 0.50, 0.60, 0.055, 0.07, pal)
    return s.done()


def make_mirror():
    """镜像机: 蝶形"""
    s = Sprite(40, 36)
    pal = PAL['l5']
    for d in (-1, 1):
        wing = [(0.50, 0.46), (0.50 + d * 0.46, 0.20), (0.50 + d * 0.40, 0.52),
                (0.50 + d * 0.18, 0.72), (0.50, 0.68)]
        s.poly(wing, fill=shade(pal['dark'], 1.1), outline=shade(pal['dark'], 0.5), ow=0.012)
        s.poly(shrink(wing, 0.10), fill=pal['base'])
        s.poly([(0.50, 0.48), (0.50 + d * 0.34, 0.26), (0.50 + d * 0.28, 0.44)],
               fill=shade(pal['light'], 0.85))
        s.seg(0.50 + d * 0.16, 0.28, 0.50 + d * 0.26, 0.52, pal['accent'], w=0.016)
    s.poly([(0.50, 0.94), (0.435, 0.58), (0.565, 0.58)], fill=shade(pal['base'], 0.85),
           outline=shade(pal['dark'], 0.5), ow=0.010)
    cockpit(s, 0.50, 0.56, 0.06, 0.08, pal)
    return s.done()


def make_heavy():
    """重装机: 多层装甲 + 中央炮塔"""
    s = Sprite(48, 42)
    pal = PAL['l5']
    pts = [(0.30, 0.94), (0.20, 0.58), (0.04, 0.50), (0.04, 0.26),
           (0.26, 0.18), (0.34, 0.05), (0.66, 0.05), (0.74, 0.18),
           (0.96, 0.26), (0.96, 0.50), (0.80, 0.58), (0.70, 0.94)]
    hull(s, pts, pal)
    # 上层装甲（带斜切边）
    plate(s, [(0.24, 0.28), (0.76, 0.28), (0.72, 0.42), (0.28, 0.42)], pal, 0.68)
    plate(s, [(0.30, 0.46), (0.70, 0.46), (0.66, 0.58), (0.34, 0.58)], pal, 0.55)
    # 装甲铆钉
    for rx in (0.28, 0.72):
        for ry in (0.31, 0.38):
            s.ell(rx, ry, 0.008, 0.008, fill=shade(pal['light'], 0.7))
    # 侧吊舱 + 炮口
    for px in (0.12, 0.88):
        s.ell(px, 0.38, 0.065, 0.10, fill=shade(pal['base'], 0.9),
              outline=shade(pal['dark'], 0.7), ow=0.01)
        s.ell(px, 0.445, 0.028, 0.030, fill=pal['core'])
        s.glow(px, 0.445, 0.055, pal['accent'], alpha=180)
    # 中央炮塔
    s.ell(0.50, 0.66, 0.085, 0.075, fill=shade(pal['dark'], 1.35),
          outline=shade(pal['accent'], 0.9), ow=0.008)
    s.ell(0.50, 0.66, 0.038, 0.035, fill=pal['core'])
    s.glow(0.50, 0.68, 0.09, pal['accent'], alpha=200)
    return s.done()


# ---------------------------------------------------------------- BOSS
def make_boss1():
    """苍鹰母舰: 宽扁舰体 + 双甲板 + 4 炮塔"""
    s = Sprite(200, 160)
    pal = PAL['l1']
    body = [(0.50, 0.96), (0.36, 0.72), (0.10, 0.62), (0.02, 0.34),
            (0.18, 0.16), (0.40, 0.24), (0.50, 0.12),
            (0.60, 0.24), (0.82, 0.16), (0.98, 0.34), (0.90, 0.62), (0.64, 0.72)]
    hull(s, body, pal, hi=[(0.50, 0.20), (0.30, 0.30), (0.50, 0.64)])
    # 甲板
    for d in (-1, 1):
        s.poly([(0.5 + d * 0.14, 0.40), (0.5 + d * 0.44, 0.42),
                (0.5 + d * 0.42, 0.56), (0.5 + d * 0.12, 0.54)],
               fill=shade(pal['base'], 0.38), outline=shade(pal['accent'], 0.85), ow=0.004)
        # 舷窗
        for i in range(3):
            s.ell(0.5 + d * (0.19 + i * 0.075), 0.48, 0.016, 0.014, fill=pal['core'])
            s.glow(0.5 + d * (0.19 + i * 0.075), 0.48, 0.028, pal['accent'], alpha=110)
    # 炮塔
    for tx, ty in ((0.24, 0.66), (0.76, 0.66), (0.38, 0.82), (0.62, 0.82)):
        turret(s, tx, ty, 0.045, pal)
    # 核心
    s.glow(0.50, 0.52, 0.16, pal['accent'], alpha=220)
    s.ell(0.50, 0.52, 0.085, 0.07, fill=pal['core'], outline=shade(pal['dark'], 0.6), ow=0.006)
    s.ell(0.50, 0.52, 0.035, 0.03, fill=(255, 255, 255))
    return s.done()


def make_boss2():
    """岩甲巨蟹: 椭圆甲壳 + 双钳 + 腿"""
    s = Sprite(200, 160)
    pal = PAL['l2']
    # 腿
    for d in (-1, 1):
        for ax, ay, bx, by in ((0.22, 0.62, 0.05, 0.82), (0.26, 0.72, 0.11, 0.96)):
            s.seg(0.5 + d * ax, ay, 0.5 + d * bx, by, shade(pal['dark'], 1.4), w=0.055)
            s.seg(0.5 + d * ax, ay, 0.5 + d * bx, by, shade(pal['base'], 0.85), w=0.028)
    # 钳臂
    for d in (-1, 1):
        s.seg(0.5 + d * 0.20, 0.50, 0.5 + d * 0.40, 0.33, shade(pal['dark'], 1.3), w=0.095)
        s.seg(0.5 + d * 0.20, 0.50, 0.5 + d * 0.40, 0.33, shade(pal['base'], 1.0), w=0.055)
        # 上颚
        s.poly([(0.5 + d * 0.36, 0.30), (0.5 + d * 0.55, 0.15), (0.5 + d * 0.57, 0.27),
                (0.5 + d * 0.44, 0.36)], fill=shade(pal['base'], 1.12),
               outline=shade(pal['dark'], 0.6), ow=0.005)
        # 下颚
        s.poly([(0.5 + d * 0.36, 0.41), (0.5 + d * 0.55, 0.49), (0.5 + d * 0.50, 0.31),
                (0.5 + d * 0.42, 0.36)], fill=shade(pal['base'], 0.84),
               outline=shade(pal['dark'], 0.6), ow=0.005)
        s.glow(0.5 + d * 0.48, 0.32, 0.05, pal['accent'], alpha=120)
    # 椭圆甲壳（两层椭圆做描边，避免多边形硬角）
    s.ell(0.50, 0.50, 0.345, 0.405, fill=shade(pal['dark'], 1.05))
    s.ell(0.50, 0.495, 0.305, 0.360, fill=pal['base'])
    s.ell(0.43, 0.37, 0.135, 0.115, fill=shade(pal['light'], 0.72))
    # 弧形甲纹
    for r in (0.20, 0.265):
        s.d.arc([(0.5 - r) * s.w * SS, (0.44 - r * 1.05) * s.h * SS,
                 (0.5 + r) * s.w * SS, (0.44 + r * 1.05) * s.h * SS],
                start=205, end=335, fill=rgba(shade(pal['dark'], 0.9), 225),
                width=int(0.013 * s.w * SS))
    # 核心
    s.glow(0.50, 0.52, 0.16, pal['accent'], alpha=235)
    s.ell(0.50, 0.52, 0.082, 0.075, fill=pal['core'], outline=shade(pal['dark'], 0.55), ow=0.005)
    s.ell(0.50, 0.52, 0.032, 0.030, fill=(255, 255, 255))
    # 眼
    for ex in (0.39, 0.61):
        s.ell(ex, 0.23, 0.036, 0.031, fill=(255, 242, 205))
        s.glow(ex, 0.23, 0.052, pal['accent'], alpha=190)
    return s.done()


def make_boss3():
    """深渊之眼: 圆形主体 + 大眼 + 触手"""
    s = Sprite(200, 160)
    pal = PAL['l3']
    # 触手
    for i in range(6):
        a0 = math.pi * (0.15 + i * 0.14)
        pts = []
        for t in range(6):
            r = 0.30 + t * 0.055
            a = a0 + math.sin(t * 0.8 + i) * 0.10
            pts.append((0.5 + math.cos(a) * r * 1.15, 0.46 + math.sin(a) * r * 0.9))
        for p1, p2 in zip(pts, pts[1:]):
            s.seg(p1[0], p1[1], p2[0], p2[1], shade(pal['accent'], 0.85), w=0.012)
    # 主体
    s.ell(0.50, 0.46, 0.30, 0.30, fill=shade(pal['dark'], 1.1),
          outline=shade(pal['dark'], 0.5), ow=0.008)
    s.ell(0.50, 0.46, 0.265, 0.265, fill=pal['base'])
    s.ell(0.42, 0.36, 0.13, 0.10, fill=shade(pal['light'], 0.75))
    # 眼
    s.glow(0.50, 0.48, 0.20, pal['accent'], alpha=200)
    s.ell(0.50, 0.48, 0.13, 0.13, fill=shade(pal['dark'], 1.4))
    s.ell(0.50, 0.48, 0.105, 0.105, fill=pal['core'])
    s.ell(0.50, 0.48, 0.045, 0.045, fill=(10, 30, 30))
    s.ell(0.46, 0.44, 0.022, 0.022, fill=(255, 255, 255))
    # 环
    s.d.ellipse([(0.5 - 0.32) * s.w * SS, (0.46 - 0.32) * s.h * SS,
                 (0.5 + 0.32) * s.w * SS, (0.46 + 0.32) * s.h * SS],
                outline=rgba(pal['accent'], 200), width=int(0.008 * s.w * SS))
    return s.done()


def make_boss4():
    """轨道堡垒: 八边形厚装甲环 + 十字梁 + 六炮口"""
    s = Sprite(200, 160)
    pal = PAL['l4']
    cx, cy = 0.50, 0.48
    outer = [(cx + math.cos(math.pi / 4 * i) * 0.47,
              cy + math.sin(math.pi / 4 * i) * 0.50) for i in range(8)]
    s.poly(outer, fill=shade(pal['dark'], 1.15))
    s.poly(shrink(outer, 0.13), fill=pal['base'])
    # 环上装甲块
    for i in range(8):
        a = math.pi / 4 * i
        s.ell(cx + math.cos(a) * 0.395, cy + math.sin(a) * 0.425, 0.036, 0.033,
              fill=shade(pal['base'], 1.18), outline=shade(pal['dark'], 0.6), ow=0.004)
    # 内圈（挖空感）
    inner = shrink(outer, 0.42)
    s.poly(inner, fill=shade(pal['dark'], 1.45))
    s.poly(shrink(inner, 0.10), fill=shade(pal['base'], 0.50),
           outline=shade(pal['accent'], 0.75), ow=0.004)
    # 十字梁
    for i in range(4):
        a = math.pi / 4 + math.pi / 2 * i
        s.seg(cx, cy, cx + math.cos(a) * 0.29, cy + math.sin(a) * 0.31,
              shade(pal['base'], 0.72), w=0.034)
    # 六炮口
    for i in range(6):
        a = math.pi / 3 * i + math.pi / 6
        tx = cx + math.cos(a) * 0.295
        ty = cy + math.sin(a) * 0.325
        s.ell(tx, ty, 0.040, 0.040, fill=shade(pal['dark'], 1.55),
              outline=shade(pal['accent'], 0.9), ow=0.005)
        s.ell(tx, ty, 0.017, 0.017, fill=pal['core'])
        s.glow(tx, ty, 0.048, pal['accent'], alpha=150)
    s.glow(cx, cy, 0.17, pal['accent'], alpha=245)
    s.ell(cx, cy, 0.064, 0.064, fill=(255, 255, 255))
    return s.done()


def make_boss5():
    """熔核核心: 三瓣环形装甲 + 中央熔炉"""
    s = Sprite(200, 160)
    pal = PAL['l5']
    cx, cy = 0.50, 0.48
    R = 0.50
    box = [(cx - R) * s.w * SS, (cy - R * 1.02) * s.h * SS,
           (cx + R) * s.w * SS, (cy + R * 1.02) * s.h * SS]
    # 三片装甲瓣（120° 各留 12° 缝）
    for i in range(3):
        s.d.pieslice(box, start=i * 120 + 12, end=i * 120 + 108,
                     fill=rgba(shade(pal['base'], 0.80), 255))
    s.d.arc(box, start=0, end=360, fill=rgba(shade(pal['light'], 0.75), 190),
            width=int(0.009 * s.w * SS))
    # 环内熔岩缝
    R3 = 0.355
    s.d.arc([(cx - R3) * s.w * SS, (cy - R3 * 1.02) * s.h * SS,
             (cx + R3) * s.w * SS, (cy + R3 * 1.02) * s.h * SS],
            start=0, end=360, fill=rgba((255, 150, 70), 230), width=int(0.026 * s.w * SS))
    s.glow(cx, cy, 0.34, (255, 140, 60), alpha=130)
    # 内圈挖深
    R2 = 0.295
    s.d.pieslice([(cx - R2) * s.w * SS, (cy - R2 * 1.05) * s.h * SS,
                  (cx + R2) * s.w * SS, (cy + R2 * 1.05) * s.h * SS],
                 start=0, end=360, fill=rgba(shade(pal['dark'], 1.25), 255))
    # 瓣上分段线
    for i in range(3):
        a = math.radians(i * 120 + 60)
        s.seg(cx + math.cos(a) * 0.33, cy + math.sin(a) * 0.34,
              cx + math.cos(a) * 0.47, cy + math.sin(a) * 0.48,
              shade(pal['dark'], 0.9), w=0.010)
    # 中央六边形熔炉
    hexp = [(cx + math.cos(math.pi / 3 * i) * 0.205, cy + math.sin(math.pi / 3 * i) * 0.235)
            for i in range(6)]
    s.poly(hexp, fill=shade(pal['dark'], 1.55), outline=shade(pal['accent'], 0.9), ow=0.006)
    s.glow(cx, cy, 0.23, (255, 165, 75), alpha=245)
    s.ell(cx, cy, 0.090, 0.095, fill=(255, 228, 160))
    s.ell(cx, cy, 0.043, 0.045, fill=(255, 255, 255))
    return s.done()


def make_boss6():
    """极光堡垒: 冰晶六边形 + 四向尖刺 + 棱镜核心"""
    s = Sprite(200, 160)
    pal = PAL['l6']
    cx, cy = 0.50, 0.48

    # 四向冰刺
    for i in range(4):
        a = math.pi / 2 * i + math.pi / 4
        x1 = cx + math.cos(a) * 0.30
        y1 = cy + math.sin(a) * 0.32
        x2 = cx + math.cos(a) * 0.52
        y2 = cy + math.sin(a) * 0.55
        nx = math.cos(a + math.pi / 2) * 0.05
        ny = math.sin(a + math.pi / 2) * 0.05
        s.poly([(x1 + nx, y1 + ny), (x2, y2), (x1 - nx, y1 - ny)],
               fill=shade(pal['base'], 0.9), outline=shade(pal['dark'], 0.6), ow=0.005)

    # 主体六边形
    hexp = [(cx + math.cos(math.pi / 3 * i + math.pi / 6) * 0.30,
             cy + math.sin(math.pi / 3 * i + math.pi / 6) * 0.34) for i in range(6)]
    hull(s, hexp, pal, hi=[(cx, cy - 0.28), (cx + 0.22, cy + 0.02), (cx, cy + 0.20)])

    # 外环棱晶
    for r, k in ((0.235, 0.75), (0.165, 1.0)):
        s.poly([(cx + math.cos(math.pi / 3 * i + math.pi / 6) * r,
                 cy + math.sin(math.pi / 3 * i + math.pi / 6) * r * 1.12) for i in range(6)],
               fill=None, outline=shade(pal['accent'], k), ow=0.006)

    # 棱镜核心
    s.glow(cx, cy, 0.20, pal['accent'], alpha=235)
    s.poly([(cx, cy - 0.13), (cx + 0.10, cy), (cx, cy + 0.13), (cx - 0.10, cy)],
           fill=pal['core'], outline=shade(pal['accent'], 1.0), ow=0.006)
    s.poly([(cx, cy - 0.06), (cx + 0.045, cy), (cx, cy + 0.06), (cx - 0.045, cy)],
           fill=(255, 255, 255))

    # 侧翼
    for d in (-1, 1):
        s.poly([(cx + d * 0.28, cy - 0.04), (cx + d * 0.47, cy + 0.06),
                (cx + d * 0.45, cy + 0.20), (cx + d * 0.27, cy + 0.14)],
               fill=shade(pal['base'], 0.8), outline=shade(pal['dark'], 0.55), ow=0.005)
        s.glow(cx + d * 0.40, cy + 0.12, 0.05, pal['accent'], alpha=150)
    return s.done()


def make_boss7():
    """虚空王座: 对称巨型结构 + 双环 + 金色王座"""
    s = Sprite(220, 180)
    pal = PAL['l7']
    cx, cy = 0.50, 0.46

    # 外层双环
    for r, k, w in ((0.46, 0.55, 0.008), (0.38, 0.80, 0.006)):
        s.d.arc([(cx - r) * s.w * SS, (cy - r * 0.80) * s.h * SS,
                 (cx + r) * s.w * SS, (cy + r * 0.80) * s.h * SS],
                start=0, end=360, fill=rgba(shade(pal['accent'], k), 190),
                width=int(w * s.w * SS))

    # 主体八边形
    oct_ = [(cx + math.cos(math.pi / 4 * i + math.pi / 8) * 0.34,
             cy + math.sin(math.pi / 4 * i + math.pi / 8) * 0.36) for i in range(8)]
    hull(s, oct_, pal, hi=[(cx, cy - 0.26), (cx - 0.20, cy + 0.02), (cx, cy + 0.22)])

    # 内层拱门（王座背板）
    s.poly([(cx - 0.16, cy + 0.16), (cx - 0.16, cy - 0.14),
            (cx, cy - 0.24), (cx + 0.16, cy - 0.14), (cx + 0.16, cy + 0.16)],
           fill=shade(pal['dark'], 1.5), outline=shade(pal['accent'], 0.85), ow=0.005)

    # 两侧重炮（可破坏部件的视觉锚点）
    for d in (-1, 1):
        s.ell(cx + d * 0.40, cy + 0.16, 0.085, 0.10,
              fill=shade(pal['base'], 1.1), outline=shade(pal['dark'], 0.6), ow=0.006)
        s.seg(cx + d * 0.40, cy + 0.20, cx + d * 0.40, cy + 0.34,
              shade(pal['dark'], 0.9), w=0.045)
        s.ell(cx + d * 0.40, cy + 0.16, 0.035, 0.040, fill=pal['core'])
        s.glow(cx + d * 0.40, cy + 0.18, 0.09, pal['accent'], alpha=190)

    # 王座核心
    s.glow(cx, cy - 0.02, 0.20, pal['accent'], alpha=240)
    s.poly([(cx, cy - 0.14), (cx + 0.075, cy - 0.02), (cx, cy + 0.10), (cx - 0.075, cy - 0.02)],
           fill=pal['core'], outline=(255, 255, 255, 180), ow=0.004)
    s.ell(cx, cy - 0.02, 0.028, 0.030, fill=(255, 255, 255))

    # 顶部尖冠
    for i in range(3):
        off = (i - 1) * 0.09
        s.poly([(cx + off - 0.025, cy - 0.30), (cx + off, cy - 0.42),
                (cx + off + 0.025, cy - 0.30)],
               fill=shade(pal['accent'], 0.9), outline=None)
    return s.done()


def make_boss8():
    """裂殖之核: 双层细胞核 + 分裂缝 + 鞭毛"""
    s = Sprite(210, 170)
    pal = PAL['l8']
    cx, cy = 0.50, 0.47

    # 鞭毛
    for d in (-1, 1):
        for k in range(3):
            pts = []
            for t in range(6):
                yy = cy + 0.10 + t * 0.075
                xx = cx + d * (0.30 + k * 0.035) + math.sin(t * 1.1 + k) * 0.028
                pts.append((xx, yy))
            for a, b in zip(pts, pts[1:]):
                s.seg(a[0], a[1], b[0], b[1], shade(pal['accent'], 0.75), w=0.010)

    # 外膜
    s.ell(cx, cy, 0.40, 0.40, fill=shade(pal['dark'], 1.25),
          outline=shade(pal['dark'], 0.55), ow=0.012)
    s.ell(cx, cy, 0.355, 0.355, fill=shade(pal['base'], 0.55))

    # 两个半核（分裂感）
    for d in (-1, 1):
        s.ell(cx + d * 0.115, cy - 0.02, 0.155, 0.175,
              fill=shade(pal['base'], 1.0),
              outline=shade(pal['dark'], 0.7), ow=0.006)
        s.ell(cx + d * 0.115, cy - 0.06, 0.085, 0.095, fill=pal['light'])
        s.ell(cx + d * 0.115, cy - 0.02, 0.045, 0.05, fill=pal['core'])
        s.glow(cx + d * 0.115, cy - 0.02, 0.10, pal['accent'], alpha=190)

    # 中央分裂缝
    s.seg(cx, cy - 0.20, cx, cy + 0.18, shade(pal['dark'], 0.8), w=0.016)
    s.glow(cx, cy, 0.10, pal['light'], alpha=120)

    # 外圈棘突
    for i in range(12):
        a = math.pi * 2 * i / 12 + math.pi / 12
        x1 = cx + math.cos(a) * 0.40
        y1 = cy + math.sin(a) * 0.40
        x2 = cx + math.cos(a) * 0.475
        y2 = cy + math.sin(a) * 0.475
        s.seg(x1, y1, x2, y2, shade(pal['accent'], 0.85), w=0.012)
    return s.done()


def make_boss9():
    """终焉星环: 三重同心环 + 中央星核 + 六个引力锚"""
    s = Sprite(230, 200)
    pal = PAL['l9']
    cx, cy = 0.50, 0.47

    # 三重环
    for r, k, w in ((0.48, 0.45, 0.007), (0.40, 0.70, 0.006), (0.32, 0.95, 0.005)):
        s.d.arc([(cx - r) * s.w * SS, (cy - r * 0.86) * s.h * SS,
                 (cx + r) * s.w * SS, (cy + r * 0.86) * s.h * SS],
                start=0, end=360, fill=rgba(shade(pal['accent'], k), 200),
                width=int(w * s.w * SS))

    # 环间连接锚
    for i in range(6):
        a = math.pi / 3 * i + math.pi / 6
        x1 = cx + math.cos(a) * 0.30
        y1 = cy + math.sin(a) * 0.30
        x2 = cx + math.cos(a) * 0.48
        y2 = cy + math.sin(a) * 0.48
        s.seg(x1, y1, x2, y2, shade(pal['base'], 1.1), w=0.014)
        s.ell(x2, y2, 0.030, 0.030, fill=pal['light'],
              outline=shade(pal['dark'], 0.6), ow=0.005)

    # 中央星核（八芒）
    hexp = [(cx + math.cos(math.pi / 4 * i) * 0.19,
             cy + math.sin(math.pi / 4 * i) * 0.21) for i in range(8)]
    s.poly(hexp, fill=shade(pal['dark'], 1.3),
           outline=shade(pal['accent'], 1.0), ow=0.007)

    for i in range(4):
        a = math.pi / 4 * i
        x2 = cx + math.cos(a) * 0.26
        y2 = cy + math.sin(a) * 0.28
        s.seg(cx, cy, x2, y2, shade(pal['accent'], 1.15), w=0.010)

    s.glow(cx, cy, 0.24, pal['accent'], alpha=250)
    s.glow(cx, cy, 0.13, (255, 255, 255), alpha=250)
    s.ell(cx, cy, 0.085, 0.09, fill=(255, 255, 255))
    return s.done()


# ---------------------------------------------------------------- 图集打包
def pack(images, pad=2, max_w=2048):
    names = list(images.keys())
    names.sort(key=lambda n: -images[n].height)
    shelves = []  # (y, h, x_cursor, [names])
    x = pad
    y = pad
    shelf_h = 0
    pos = {}
    for n in names:
        im = images[n]
        if x + im.width + pad > max_w:
            y += shelf_h + pad
            x = pad
            shelf_h = 0
        pos[n] = (x, y)
        x += im.width + pad
        shelf_h = max(shelf_h, im.height)
    total_h = y + shelf_h + pad
    sheet = Image.new('RGBA', (max_w, total_h), (0, 0, 0, 0))
    frames = {}
    for n in names:
        im = images[n]
        px, py = pos[n]
        sheet.paste(im, (px, py), im)
        frames[n] = [px, py, im.width, im.height]
    # 裁掉空白
    bbox = sheet.getbbox()
    if bbox:
        sheet = sheet.crop((0, 0, bbox[2] + pad, bbox[3] + pad))
    return sheet, frames


def contact_sheet(images, path, scale=3, cols=4, cell_w=None, cell_h=None):
    if cell_w is None:
        cell_w = int(max(im.width for im in images.values()) * scale) + 30
    if cell_h is None:
        cell_h = int(max(im.height for im in images.values()) * scale) + 30
    rows = (len(images) + cols - 1) // cols
    W = cols * cell_w
    H = rows * cell_h + 30
    sheet = Image.new('RGB', (W, H), (14, 17, 24))
    d = ImageDraw.Draw(sheet)
    d.text((12, 10), path.split('/')[-1], fill=(200, 220, 240))
    for i, (n, im) in enumerate(images.items()):
        cx = (i % cols) * cell_w
        cy = (i // cols) * cell_h + 30
        for gy in range(0, cell_h, 12):
            for gx in range(0, cell_w, 12):
                if (gx // 12 + gy // 12) % 2 == 0:
                    d.rectangle([cx + gx, cy + gy, cx + gx + 11, cy + gy + 11], fill=(24, 28, 38))
        im2 = im.resize((int(im.width * scale), int(im.height * scale)), Image.LANCZOS)
        ox = cx + (cell_w - im2.width) // 2
        oy = cy + (cell_h - 14 - im2.height) // 2
        sheet.paste(im2, (ox, oy), im2)
        d.text((cx + 8, cy + cell_h - 12), n, fill=(140, 200, 220))
    sheet.save(path)


# ---------------------------------------------------------------- 背景
def periodic_noise(w, h, terms, seed=0):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    out = np.zeros((h, w), np.float32)
    for _ in range(terms):
        fx = rng.integers(1, 5)
        fy = rng.integers(1, 5)
        ph = rng.uniform(0, math.tau)
        amp = rng.uniform(0.4, 1.0) / (1 + fx + fy)
        out += amp * np.sin(math.tau * fx * xx / w + ph) * np.cos(math.tau * fy * yy / h + ph * 1.7)
    out -= out.min()
    out /= max(1e-6, out.max())
    return out


def make_bg(name, rgb, seed, stars=0.0, nebula=9.0):
    """深色无缝背景。
    关键：不使用垂直渐变——渐变会让平铺接缝露出明显的水平分界线；
    只用「周期噪声 + 星点」，天然可无缝平铺。
    """
    W, H = 512, 512
    rng = np.random.default_rng(seed)
    base = np.zeros((H, W, 3), np.float32)
    for c in range(3):
        base[:, :, c] = rgb[c]

    n1 = periodic_noise(W, H, 6, seed)
    n2 = periodic_noise(W, H, 12, seed + 3)
    cloud = (n1 * 0.72 + n2 * 0.28) - 0.5
    for c in range(3):
        base[:, :, c] += cloud * nebula

    if stars:
        m = rng.random((H, W)) < stars
        for c in range(3):
            base[:, :, c] += m * 150
        for _ in range(int(stars * 60)):
            x, y = rng.integers(0, W), rng.integers(0, H)
            base[y, x] = 225
            base[max(0, y - 1):y + 2, max(0, x - 1):x + 2] = np.maximum(
                base[max(0, y - 1):y + 2, max(0, x - 1):x + 2], 170)

    img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), 'RGB')
    img = img.filter(ImageFilter.GaussianBlur(1.0))
    img.save(os.path.join(ASSETS, 'bg', name + '.png'), optimize=True)


# ---------------------------------------------------------------- main
def main():
    os.makedirs(os.path.join(ASSETS, 'bg'), exist_ok=True)
    sprites = {
        'player': make_player(),
        'e_scout': make_scout(),
        'e_fighter': make_fighter(),
        'e_bomber': make_bomber(),
        'e_diver': make_diver(),
        'e_mine': make_mine(),
        'e_formation': make_formation(),
        'e_torpedo': make_torpedo(),
        'e_eel': make_eel(),
        'e_jelly': make_jelly(),
        'e_drone': make_drone(),
        'e_shield': make_shield(),
        'e_kamikaze': make_kamikaze(),
        'e_flame': make_flame(),
        'e_mirror': make_mirror(),
        'e_heavy': make_heavy(),
        'boss1': make_boss1(),
        'boss2': make_boss2(),
        'boss3': make_boss3(),
        'boss4': make_boss4(),
        'boss5': make_boss5(),
        'boss6': make_boss6(),
        'boss7': make_boss7(),
        'boss8': make_boss8(),
        'boss9': make_boss9(),
    }
    sheet, frames = pack(sprites)
    sheet.save(os.path.join(ASSETS, 'sprites.png'), optimize=True)
    with open(os.path.join(ASSETS, 'sprites.json'), 'w', encoding='utf-8') as f:
        json.dump({'image': 'sprites.png', 'frames': frames}, f, indent=1)
    # 同时输出成 JS 常量：避免 file:// 打开时 fetch 被 CORS 拦截
    atlas_js = os.path.normpath(os.path.join(HERE, '..', 'js', 'atlas.js'))
    with open(atlas_js, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/gen_assets.py 自动生成，请勿手改 */\n')
        f.write('const ATLAS = ' + json.dumps(frames, ensure_ascii=False) + ';\n')

    contact_sheet({k: v for k, v in sprites.items() if not k.startswith('boss')},
                  os.path.join(ASSETS, '_contact_ships.png'), scale=4, cols=4)
    contact_sheet({k: v for k, v in sprites.items() if k.startswith('boss')},
                  os.path.join(ASSETS, '_contact_boss.png'), scale=1.15, cols=3)

    make_bg('bg1', (26, 47, 70), 1, stars=0.0010, nebula=22)
    make_bg('bg2', (60, 33, 24), 2, stars=0.0006, nebula=24)
    make_bg('bg3', (11, 38, 45), 3, stars=0.0008, nebula=20)
    make_bg('bg4', (24, 18, 45), 4, stars=0.0034, nebula=26)
    make_bg('bg5', (56, 16, 15), 5, stars=0.0013, nebula=24)
    make_bg('bg6', (10, 40, 44), 6, stars=0.0020, nebula=26)
    make_bg('bg7', (14, 9, 22), 7, stars=0.0028, nebula=22)
    make_bg('bg8', (16, 40, 18), 8, stars=0.0012, nebula=24)
    make_bg('bg9', (16, 12, 34), 9, stars=0.0034, nebula=26)

    total = sum(i.width * i.height for i in sprites.values())
    print('sprites:', len(sprites), 'atlas:', sheet.size, 'raw px:', total)
    for n, im in sprites.items():
        print('  %-12s %dx%d' % (n, im.width, im.height))


if __name__ == '__main__':
    main()
