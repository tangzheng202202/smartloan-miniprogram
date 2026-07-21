#!/usr/bin/env python3
"""生成 tabBar 图标：81x81 PNG，透明背景。
普通态 #999999，选中态 #1A6BFF。三对：计算器/方案库/我的。
"""
import os
from PIL import Image, ImageDraw

SIZE = 81
SS = 4  # 超采样抗锯齿
S = SIZE * SS
GRAY = (153, 153, 153, 255)
BLUE = (26, 107, 255, 255)

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "images")
os.makedirs(OUT, exist_ok=True)


def canvas(color):
    # 透明背景，但 RGB 预填图标色，避免下采样产生色偏/黑边
    return Image.new("RGBA", (S, S), (color[0], color[1], color[2], 0))


def save(img, name):
    img = img.resize((SIZE, SIZE), Image.BILINEAR)
    img.save(os.path.join(OUT, name))
    print("saved", name)


def rounded(d, box, r, **kw):
    d.rounded_rectangle(box, radius=r, **kw)


def calculator(color):
    img = canvas(color)
    d = ImageDraw.Draw(img)
    w = int(6 * SS)
    # 机身
    rounded(d, [16 * SS, 10 * SS, 65 * SS, 71 * SS], 10 * SS, outline=color, width=w)
    # 屏幕
    rounded(d, [24 * SS, 19 * SS, 57 * SS, 31 * SS], 4 * SS, fill=color)
    # 按键 3x3 圆点
    for row, y in enumerate([42, 52, 62]):
        for col, x in enumerate([28, 40.5, 53]):
            d.ellipse([(x - 3) * SS, (y - 3) * SS, (x + 3) * SS, (y + 3) * SS], fill=color)
    return img


def plans(color):
    """方案库：文件夹"""
    img = canvas(color)
    d = ImageDraw.Draw(img)
    w = int(6 * SS)
    # 文件夹主体（上部带标签突出）
    # 主体矩形
    rounded(d, [10 * SS, 22 * SS, 71 * SS, 68 * SS], 8 * SS, outline=color, width=w)
    # 标签页（左上凸起）
    d.polygon([(14 * SS, 22 * SS), (14 * SS, 14 * SS), (34 * SS, 14 * SS),
               (40 * SS, 22 * SS)], fill=color)
    # 文件行
    d.line([22 * SS, 38 * SS, 59 * SS, 38 * SS], fill=color, width=int(4 * SS))
    d.line([22 * SS, 50 * SS, 48 * SS, 50 * SS], fill=color, width=int(4 * SS))
    return img


def my(color):
    """我的：人像"""
    img = canvas(color)
    d = ImageDraw.Draw(img)
    w = int(6 * SS)
    # 头
    d.ellipse([28 * SS, 12 * SS, 53 * SS, 37 * SS], outline=color, width=w)
    # 肩
    d.arc([18 * SS, 44 * SS, 63 * SS, 92 * SS], start=180, end=360, fill=color, width=w)
    return img


icons = [
    ("calculator", calculator),
    ("plans", plans),
    ("my", my),
]

for name, fn in icons:
    save(fn(GRAY), f"tab_{name}.png")
    save(fn(BLUE), f"tab_{name}_active.png")

# 校验：尺寸 + 透明度 + 主色
for name, _ in icons:
    for suffix, expect in (("", GRAY), ("_active", BLUE)):
        p = os.path.join(OUT, f"tab_{name}{suffix}.png")
        im = Image.open(p).convert("RGBA")
        assert im.size == (SIZE, SIZE), (p, im.size)
        px = list(im.getdata())
        opaque = [q[:3] for q in px if q[3] >= 250]
        assert len(opaque) > 100, (p, "too few opaque pixels")
        for q in opaque:
            assert abs(q[0] - expect[0]) <= 12 and abs(q[1] - expect[1]) <= 12 and abs(q[2] - expect[2]) <= 12, (p, q)
        print(f"OK {p}: {SIZE}x{SIZE}, opaque={len(opaque)}, color={expect[:3]}")
print("ALL ICONS OK")
