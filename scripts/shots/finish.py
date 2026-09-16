# Turn a raw `screencapture -l` frame into one 1200x800 picture for docs/screenshots.
#
# The raw frame carries the window, its rounded corners and its drop shadow on transparency. A little of the
# shadow is kept, the result lands on exactly 1200x800 without stretching, and the background stays transparent
# so the picture sits on GitHub's light or dark page equally well.
#
# Usage: python3 finish.py <window-width> <window-height> <raw.png>...   (window size in physical pixels)
#        Each raw-NAME.png is written back as out-NAME.png beside it.
import sys
from PIL import Image

OUT_W, OUT_H = 1200, 800
win_w, win_h = int(sys.argv[1]), int(sys.argv[2])

for name in sys.argv[3:]:
    src = Image.open(name).convert("RGBA")
    x0, y0 = src.split()[3].point(lambda v: 255 if v > 250 else 0).getbbox()[:2]
    # The opaque box starts at the window's top-left corner, but a modal's or a menu's own shadow can stretch it
    # past the window's far edge, so the window's known size decides where it ends.
    x1, y1 = x0 + win_w, y0 + win_h
    margin_y = 60
    margin_x = round(((win_h + 2 * margin_y) * OUT_W / OUT_H - win_w) / 2)
    if x0 < margin_x or y0 < margin_y or x1 + margin_x > src.width or y1 + margin_y > src.height:
        margin_y = min(y0, src.height - y1, margin_y)
        margin_x = round(((win_h + 2 * margin_y) * OUT_W / OUT_H - win_w) / 2)
    box = (x0 - margin_x, y0 - margin_y, x1 + margin_x, y1 + margin_y)
    out = src.crop(box).resize((OUT_W, OUT_H), Image.LANCZOS)
    dest = name.replace("/raw-", "/out-")
    out.save(dest)
    print(f"{dest.split('/')[-1]}  window {win_w}x{win_h}  crop {box[2] - box[0]}x{box[3] - box[1]}")
