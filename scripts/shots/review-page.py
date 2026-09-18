# Turn a folder of review pictures into two things a person can actually open:
#
#   index.html        every picture embedded in the page itself, so it opens from anywhere — a viewer that will not
#                     fetch a file next to the page (a sandboxed preview, a chat window) still shows them all
#   contact-sheet.png one image of the lot, for a glance or for sending on
#
# Usage: python3 review-page.py <dir> <version> <vault>
import base64, io, sys
from pathlib import Path
from PIL import Image

folder, version, vault = Path(sys.argv[1]), sys.argv[2], sys.argv[3]
shots = sorted(p for p in folder.glob("*.png") if p.name != "contact-sheet.png")
if not shots:
    sys.exit("no pictures to page")

PAGE_W = 1200  # what the page shows; the full-size PNG stays in the folder beside it


def scaled(path, width):
    im = Image.open(path).convert("RGB")
    w, h = im.size
    return im.resize((width, round(h * width / w)), Image.LANCZOS) if w > width else im


def data_uri(im):
    buf = io.BytesIO()
    im.save(buf, format="WEBP", quality=80, method=4)
    return "data:image/webp;base64," + base64.b64encode(buf.getvalue()).decode()


cards = []
for shot in shots:
    title = shot.stem.split("-", 1)[-1].replace("-", " ")
    cards.append(f'<figure><img src="{data_uri(scaled(shot, PAGE_W))}" alt="{title}">'
                 f'<figcaption>{title} · <a href="{shot.name}">full size</a></figcaption></figure>')

(folder / "index.html").write_text(f"""<!doctype html><meta charset="utf-8"><title>Ideascape {version} — {len(shots)} surfaces</title>
<style>
  body {{ margin:0; padding:32px; background:#141414; color:#e6e6e6; font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif; }}
  h1 {{ font-size:17px; margin:0 0 4px; }}
  p.note {{ margin:0 0 28px; color:#8a8a8a; }}
  .grid {{ display:grid; gap:28px; grid-template-columns:repeat(auto-fit,minmax(480px,1fr)); }}
  figure {{ margin:0; }}
  img {{ width:100%; display:block; border-radius:10px; background:#1e1e1e; box-shadow:0 2px 10px rgba(0,0,0,.4); }}
  figcaption {{ margin-top:8px; color:#9a9a9a; font-size:12px; text-transform:capitalize; }}
  a {{ color:#7aa2f7; }}
</style>
<h1>Ideascape {version} — {len(shots)} surfaces</h1>
<p class="note">Taken in Obsidian from {vault}, renderer capture. Every picture is embedded in this page.</p>
<div class="grid">
{chr(10).join(cards)}
</div>
""", encoding="utf-8")

# One sheet of the lot: four across, each picture scaled to the same width.
COLS, THUMB = 4, 520
thumbs = [scaled(shot, THUMB) for shot in shots]
rows = (len(thumbs) + COLS - 1) // COLS
row_h = [max(t.height for t in thumbs[r * COLS:(r + 1) * COLS]) for r in range(rows)]
sheet = Image.new("RGB", (COLS * (THUMB + 16) + 16, sum(row_h) + 16 * (rows + 1)), (20, 20, 20))
y = 16
for r in range(rows):
    x = 16
    for t in thumbs[r * COLS:(r + 1) * COLS]:
        sheet.paste(t, (x, y))
        x += THUMB + 16
    y += row_h[r] + 16
sheet.save(folder / "contact-sheet.png")
print(f"  {len(shots)} pictures → {folder}/index.html (self-contained) and contact-sheet.png")
