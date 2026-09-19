# Ring one menu row in a welcome slide, the way the third slide points at "Open as a map".
#
# The ring is drawn on its own layer and composited, so the words keep their own pixels instead of being painted
# over. Read the box off the finished slide; the menu lands in the same place every run.
#
# Usage: python3 highlight.py <slide.webp> <dest.webp> <left> <top> <right> <bottom>
import sys
from PIL import Image, ImageDraw, ImageFilter, ImageStat

ACCENT = (124, 101, 235)
src, dest = sys.argv[1], sys.argv[2]
box = tuple(int(v) for v in sys.argv[3:7])

im = Image.open(src).convert("RGBA")
# The menu is the system's own, so the page cannot be asked whether it opened; the picture can. A row of words is
# light and dark, and a stretch of bare sidebar is one colour. The 0.9.4 slide was ringed round nothing: a window
# stood over the file list, the menu never opened, and nothing here looked.
spread = ImageStat.Stat(im.crop(box).convert("L")).stddev[0]
if spread < 8:
    sys.exit(f"{src}: nothing is written inside {box} (spread {spread:.1f}), so the menu did not open or has moved")
glow = Image.new("RGBA", im.size, (0, 0, 0, 0))
ImageDraw.Draw(glow).rounded_rectangle(box, radius=9, outline=ACCENT + (190,), width=5)
glow = glow.filter(ImageFilter.GaussianBlur(7))
ring = Image.new("RGBA", im.size, (0, 0, 0, 0))
draw = ImageDraw.Draw(ring)
draw.rounded_rectangle(box, radius=9, fill=ACCENT + (70,))
draw.rounded_rectangle(box, radius=9, outline=ACCENT + (255,), width=3)
Image.alpha_composite(Image.alpha_composite(im, glow), ring).convert("RGB").save(dest, quality=80, method=6)
print(f"{dest.split('/')[-1]} ringed at {box}")
