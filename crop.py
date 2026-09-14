from PIL import Image

BASE = r"C:\Users\Administrator\WorkBuddy\2026-09-11-17-15-47\momoyu-widget"
src = Image.open(BASE + r"\widget-shot.png")
print("full size:", src.size)

x, y, w, h = 1560, 745, 360, 260
x = max(0, min(x, src.size[0] - w))
y = max(0, min(y, src.size[1] - h))

crop = src.crop((x, y, x + w, y + h))
crop = crop.resize((w * 2, h * 2), Image.LANCZOS)
crop.save(BASE + r"\widget-crop.png")
print("saved crop:", crop.size)
