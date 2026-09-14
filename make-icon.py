# -*- coding: utf-8 -*-
"""把 猫奴.jpg 转成 Electron 应用图标：icon.ico（多尺寸）+ tray.png + icon.png"""
import os
from PIL import Image, ImageDraw, ImageEnhance

SRC = r"C:\Users\Administrator\Desktop\猫奴.jpg"
OUT = r"C:\Users\Administrator\WorkBuddy\2026-09-11-17-15-47\momoyu-widget"

img = Image.open(SRC).convert("RGB")
print("source size:", img.size)

# 1. 居中裁成正方形
w, h = img.size
side = min(w, h)
left = (w - side) // 2
top = (h - side) // 2
img = img.crop((left, top, left + side, top + side))

# 2. 缩到 1024 后再处理，边缘更平滑
BASE = 1024
img = img.resize((BASE, BASE), Image.LANCZOS)

# 3. 轻微提亮 + 加对比，让小图标里猫脸更清楚
img = ImageEnhance.Brightness(img).enhance(1.06)
img = ImageEnhance.Contrast(img).enhance(1.08)
img = ImageEnhance.Color(img).enhance(1.05)


def rounded(img_rgb, radius_ratio=0.18, supersample=4):
    """返回带抗锯齿圆角透明通道的 RGBA 图"""
    S = img_rgb.size[0] * supersample
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    r = int(S * radius_ratio)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=r, fill=255)
    mask = mask.resize(img_rgb.size, Image.LANCZOS)
    out = img_rgb.convert("RGBA")
    out.putalpha(mask)
    return out


def circle(img_rgb, supersample=4):
    S = img_rgb.size[0] * supersample
    mask = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(mask)
    d.ellipse([0, 0, S - 1, S - 1], fill=255)
    mask = mask.resize(img_rgb.size, Image.LANCZOS)
    out = img_rgb.convert("RGBA")
    out.putalpha(mask)
    return out


# 圆角方形版（应用主图标 / 窗口图标）
app_icon = rounded(img, 0.18)
app_icon.save(os.path.join(OUT, "icon.png"), "PNG")

# 圆形版（系统托盘更协调）
tray_img = circle(img)
tray_img.resize((64, 64), Image.LANCZOS).save(os.path.join(OUT, "tray.png"), "PNG")

# 托盘再出一张 16px 细版，Windows 小托盘更清晰
tray_img.resize((16, 16), Image.LANCZOS).save(os.path.join(OUT, "tray-16.png"), "PNG")

# 多尺寸 ICO（Windows 会用其中最合适的一档）
ico_sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
app_icon.save(os.path.join(OUT, "icon.ico"), format="ICO", sizes=ico_sizes)

for f in ["icon.ico", "icon.png", "tray.png", "tray-16.png"]:
    p = os.path.join(OUT, f)
    print(f, "->", os.path.getsize(p), "bytes")
print("done")
