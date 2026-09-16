# Ideascape's listing icon: a mind map, branches either side of the centre, which is what the Auto layout does.
# Drawn at 4x and reduced, so the curves come out clean without a vector renderer. The test is 48 pixels.
import sys
from PIL import Image, ImageDraw

S, OUT = 2048, 512
INK    = (17, 20, 27)
PAPER  = (247, 246, 242)
ACCENT = (59, 110, 245)
LINE_D = (176, 183, 196)
LINE_L = (36, 41, 52)
TERRA, BLUE, GREEN = (224, 138, 86), (122, 162, 221), (111, 189, 146)
TERRA_L, BLUE_L, GREEN_L = (194, 104, 60), (74, 111, 165), (79, 138, 107)

def bez(p0, p1, p2, p3, n=400):
    out = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        out.append((u**3*p0[0] + 3*u*u*t*p1[0] + 3*u*t*t*p2[0] + t**3*p3[0],
                    u**3*p0[1] + 3*u*u*t*p1[1] + 3*u*t*t*p2[1] + t**3*p3[1]))
    return out

def stroke(d, pts, w, fill):
    """A round-capped stroke, stamped along the path: PIL's own joints leave a stitched edge on a thick curve."""
    r = w / 2
    for x, y in pts:
        d.ellipse([x - r, y - r, x + r, y + r], fill=fill)

def icon(bg, line, cols, per_side=3, dot_r=0.060, spread=0.245):
    im = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.225), fill=bg)
    cx, cy = S * 0.5, S * 0.5
    half_w, half_h = S * 0.093, S * 0.070
    lw = int(S * 0.034)
    ends = []
    for side in (1, -1):
        if per_side == 3:
            ys = [cy - S * spread, cy, cy + S * spread]
            xs = [S * 0.775, S * 0.815, S * 0.775]
        else:
            ys = [cy - S * spread * 0.78, cy + S * spread * 0.78]
            xs = [S * 0.79, S * 0.79]
        for x, y in zip(xs, ys):
            ends.append((cx + side * (x - cx), y, side))
    # The lines first, so every dot sits on top of the one that reaches it.
    for ex, ey, side in ends:
        start = (cx + side * half_w, cy)
        c1 = (cx + side * S * 0.20, cy)
        c2 = (cx + side * S * 0.21, ey)
        stroke(d, bez(start, c1, c2, (ex - side * S * dot_r * 0.9, ey)), lw, line)
    d.rounded_rectangle([cx - half_w, cy - half_h, cx + half_w, cy + half_h], radius=half_h, fill=ACCENT)
    for i, (ex, ey, _side) in enumerate(ends):
        r = S * dot_r
        d.ellipse([ex - r, ey - r, ex + r, ey + r], fill=cols[i % len(cols)])
    return im

# Usage: python3 scripts/icon.py [out-dir]   (needs Pillow; writes icon.png and icon-light.png)
out = sys.argv[1] if len(sys.argv) > 1 else 'docs'
for name, im in [
    ("icon", icon(INK, LINE_D, [TERRA, BLUE, GREEN, GREEN, TERRA, BLUE], 3)),
    ("icon-light", icon(PAPER, LINE_L, [TERRA_L, BLUE_L, GREEN_L, GREEN_L, TERRA_L, BLUE_L], 3)),
]:
    im.resize((OUT, OUT), Image.LANCZOS).save(f"{out}/{name}.png")
    print(f"{name}.png")
