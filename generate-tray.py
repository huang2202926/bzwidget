import struct, zlib, os

# 生成 16x16 的青色圆角方形托盘图标（RGBA）
W, H = 16, 16
# 颜色 #2dd4bf -> (45, 212, 191)
R, G, B = 45, 212, 191
radius = 4

def in_rounded_rect(x, y, w, h, r):
    if x < r and y < r:
        return (x - r + 0.5) ** 2 + (y - r + 0.5) ** 2 <= r * r
    if x >= w - r and y < r:
        return (x - (w - r) - 0.5) ** 2 + (y - r + 0.5) ** 2 <= r * r
    if x < r and y >= h - r:
        return (x - r + 0.5) ** 2 + (y - (h - r) - 0.5) ** 2 <= r * r
    if x >= w - r and y >= h - r:
        return (x - (w - r) - 0.5) ** 2 + (y - (h - r) - 0.5) ** 2 <= r * r
    return True

raw = bytearray()
for y in range(H):
    raw.append(0)  # filter byte
    for x in range(W):
        if in_rounded_rect(x, y, W, H, radius):
            raw.extend([R, G, B, 255])
        else:
            raw.extend([0, 0, 0, 0])

def chunk(name, data):
    c = name + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

png = b'\x89PNG\r\n\x1a\n'
png += chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 6, 0, 0, 0))
png += chunk(b'IDAT', zlib.compress(bytes(raw), 9))
png += chunk(b'IEND', b'')

out = os.path.join(os.path.dirname(__file__), 'tray.png')
with open(out, 'wb') as f:
    f.write(png)
print('tray.png generated:', out)
