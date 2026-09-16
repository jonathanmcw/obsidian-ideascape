# Turn a raw `screencapture -l` frame into one 1200x747 welcome slide for src/welcome.
#
# A slide is the Obsidian window without its macOS title bar: the tab row is the top edge. The build inlines these
# as data URIs, so they are saved as WebP and kept small.
#
# Usage: python3 slide.py <window-width> <window-height> <css-width> <css-top> <raw.png> <dest.webp>
#        Window size in physical pixels; css-width is window.innerWidth; css-top is where the tab row starts
#        in CSS pixels (30 in Obsidian 1.13).
import sys
from PIL import Image

W, H = 1200, 747
win_w, win_h = int(sys.argv[1]), int(sys.argv[2])
css_w, css_top = float(sys.argv[3]), float(sys.argv[4])
raw, dest = sys.argv[5], sys.argv[6]

src = Image.open(raw).convert("RGBA")
x0, y0 = src.split()[3].point(lambda v: 255 if v > 250 else 0).getbbox()[:2]
top = y0 + round(css_top * win_w / css_w)
out = src.crop((x0, top, x0 + win_w, y0 + win_h)).convert("RGB").resize((W, H), Image.LANCZOS)
out.save(dest, quality=80, method=6)
print(f"{dest.split('/')[-1]}  from {win_w}x{y0 + win_h - top}")
