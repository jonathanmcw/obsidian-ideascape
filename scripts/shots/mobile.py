# Turn a raw `screencapture -l` frame of the phone-shaped window into one 9:16 picture for the plugin directory.
#
# Obsidian's mobile emulation still runs inside a desktop window: the macOS title bar and the space the window
# keeps for the traffic lights sit above the mobile header. Both are cut off here, the way slide.py cuts off the
# desktop tab row, so the finished picture starts at the mobile header and ends below the mobile navbar. The
# window's rounded bottom corners leave transparent pixels and a fringe of its drop shadow behind, so anything
# that is not fully opaque is replaced — not blended, which would leave the shadow as a dark arc — by the
# background colour the window itself is using, read off its own bottom edge. The corners come out square.
#
# Usage: python3 mobile.py <window-width> <window-height> <css-width> <css-top> <out-w> <out-h> <raw.png> <dest.png>
#        Window size in physical pixels; css-width is window.innerWidth; css-top is where the mobile header
#        starts in CSS pixels (89 in Obsidian 1.13's emulated phone layout).
import sys
from collections import Counter
from PIL import Image

win_w, win_h = int(sys.argv[1]), int(sys.argv[2])
css_w, css_top = float(sys.argv[3]), float(sys.argv[4])
out_w, out_h = int(sys.argv[5]), int(sys.argv[6])
raw, dest = sys.argv[7], sys.argv[8]

src = Image.open(raw).convert("RGBA")
x0, y0 = src.split()[3].point(lambda v: 255 if v > 250 else 0).getbbox()[:2]
top = y0 + round(css_top * win_w / css_w)
have = y0 + win_h - top
if out_w > win_w or out_h > have:
    sys.exit(f"{raw}: window gives {win_w}x{have} below the header, too small for {out_w}x{out_h}")
box = (x0 + (win_w - out_w) // 2, top, x0 + (win_w - out_w) // 2 + out_w, top + out_h)
crop = src.crop(box)

# The commonest opaque colour along the bottom edge, three rows up from the window's own rounded corner.
row = crop.crop((0, out_h - 24, out_w, out_h - 21)).tobytes()
fill = Counter(tuple(row[i:i + 3]) for i in range(0, len(row), 4) if row[i + 3] > 250).most_common(1)[0][0]
out = Image.new("RGB", (out_w, out_h), fill)
out.paste(crop.convert("RGB"), (0, 0), crop.split()[3].point(lambda v: 255 if v > 250 else 0))
out.save(dest)
print(f"{dest.split('/')[-1]}  {out_w}x{out_h}  from {win_w}x{win_h}, cut {top - y0}px of chrome, corners filled #{'%02x%02x%02x' % fill}")
