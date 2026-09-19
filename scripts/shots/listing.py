# Turn the raw `screencapture -l` frames into the picture set the Obsidian community directory asks for.
#
# The directory's submission form takes 1200x800 desktop images (3:2) and 900x1600 mobile ones (9:16), PNG/JPEG/WebP,
# 5 MB each. The detail page shows the first image as a hero in a rounded 3:2 frame on a near-black page, and the
# grid thumbnails are about 300 px wide and cropped with CSS `object-fit: cover`. There are no captions and the alt
# text is generated, so any words a picture needs have to be inside the picture, and they have to survive being
# shown at a quarter of their size.
#
# Two variants come out of one run, so the listing can be decided by looking rather than by arguing:
#
#   plain    — the window exactly as finish.py crops it, on flat #141416. This is what every plugin in the directory
#              does today, so it is the safe default. Nothing about it has changed.
#   branded  — a story strip. Each picture is one sentence and one close crop of the real app, set out the way the
#              plugin sets out a map: the kicker is a node, a connector leaves it, and the screenshot is its child.
#
# How a branded picture is built, and why:
#
#   The subject is large. A whole Obsidian window scaled to fit leaves map text at 8 px in the hero and nothing
#   legible in a thumbnail, so each picture shows a crop of the window instead: the nodes, the Markdown, the keys.
#   The crop is real pixels from the capture and nothing is drawn over it. It sits in a panel that runs off the right
#   edge of the canvas, which is what says "this is a piece of a bigger window" without inventing any chrome.
#
#   A panel that bleeds needs slack on its right, because a cover-cropped thumbnail can lose 8% of a side. Where the
#   subject is itself at the right of the crop (the node being edited, the far leaves of the whole map, the export
#   sheet) the entry says "bleed": false and the panel stops at the 8% line with all four corners rounded.
#
#   The words are a column, not a caption. The headline is SF Pro Display Bold at 54 units, which is still 13 px when
#   the picture is a 300 px thumbnail. It is wrapped into balanced lines and shrinks only if a late headline will not
#   fit in four. The column starts 8% in from the left, for the same reason. The kicker is one or two words in
#   letterspaced capitals; at thumbnail size it is a chip of the branch colour and no more, which is its job there.
#
#   The colour is the product's own. Ideascape colours a map's branches in a fixed order (theme.ts, the graphite
#   palette: terracotta, blue, green, ochre, plum, teal, rose, olive). The five desktop pictures and three mobile ones
#   take those eight colours in that order, so the set reads as one map with eight branches. The tint colours the
#   kicker, the connector and the panel's hairline, and warms the ground by a few percent. There is no glow and no
#   gradient: the old violet bloom behind the window was decoration the app does not have.
#
#   Mobile pictures hold a real-iPhone capture in a plain rounded bezel with no notch and no logo. The phone runs off
#   the bottom of the canvas so it can be wide enough to read; what is lost there is Obsidian's own navigation bar.
#
# The five desktop frames are one map, "Weekend in Kyoto", so the strip tells one story: a node mid-edit, the whole
# shape, the outline, the Markdown source, the export sheet. They are captured by `bash scripts/shots/capture.sh
# listing` (OUT=<dir>) and kept in docs/listing/frames/, so the JSON never points into a temp directory. The phone
# pictures use the real-iPhone captures in docs/screenshots/ (10, 13, 12). The 828 px frames in review/ are larger
# but are a different map in a different state, with no soft keyboard, so they cannot stand for "the dock".
#
# The words and the crops are data, not code: docs/listing/headlines.json lists, for each picture, its name, source
# frame (a repo path, or a bare file name looked for in the raw-frame directory), crop box, kicker, headline and
# tint, and optionally "bleed" and "layout". There is one other layout, "wide", for the one picture whose subject
# is a whole map: the words run across the top and the panel takes the full safe width underneath (render_wide). The crop is given in fractions of the window (0,0 is the window's top
# left, 1,1 its bottom right), so it holds for any capture size. If the file is missing, the defaults below are
# written to it. An entry may carry a "standin" note when the frame it wants has not been captured yet; the note is
# printed on every run so it cannot be forgotten, and is never drawn.
#
# Each variant is written at 1200x800 (the form's recommendation) and at 2400x1600 in a sibling "@2x" folder, both
# resampled from the 2x raw frame rather than up from a finished 1200x800 picture.
#
# Usage
#   python3 scripts/shots/listing.py [raw-frame-dir] [NAME ...]
#       <raw-frame-dir> holds the raw-*.png frames from scripts/shots/capture.sh and defaults to docs/listing/frames.
#       NAME limits the run to some of the desktop pictures. A full run also rebuilds the mobile pictures and removes
#       any picture whose entry has gone from the JSON, so a renamed picture cannot be uploaded twice.
#           docs/listing/{desktop,mobile}/{plain,plain@2x,branded,branded@2x}/<name>.png
#           docs/listing/preview-desktop.png, preview-mobile.png
#               — the set at hero size and at thumbnail size on the directory's page colour, to judge legibility
#           docs/listing/upload/   — the same files, laid out in the order the form wants them
#
#   python3 scripts/shots/listing.py --rebrand
#       Rebuild only the branded layer from the 2x plain exports already on disk. Use this when the headlines change
#       and the raw frames are gone; the plain export holds the whole window, so the same crops apply.
#
# Needs Pillow. Reads the raw frames; writes only under docs/listing.
import itertools
import json
import os
import shutil
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = os.path.join(REPO, "docs", "listing")
HEADLINES = os.path.join(OUT_ROOT, "headlines.json")
FRAMES = os.path.join(OUT_ROOT, "frames")

WINDOW = (2294, 1530)  # the captured window in physical pixels, the size finish.py is handed
DESKTOP_SIZE = (1200, 800)
MOBILE_SIZE = (900, 1600)
# Where the window sits in a 1200x800 plain export. --rebrand uses it to find the window again.
PLAIN_WINDOW = (44, 29, 1156, 771)

PLAIN_BG = (20, 20, 22)  # #141416
PAGE_BG = (13, 13, 15)  # the directory's page, for the contact sheets
GROUND = (19, 18, 22)  # a touch under the graphite theme's --bg, so the app's own surface still reads as lit
INK = (240, 238, 244)

# theme.ts, graphite palette, in branch order. The order is the point: picture n wears branch n's colour.
TINTS = {
    "terracotta": (240, 153, 106),
    "blue": (121, 168, 240),
    "green": (104, 199, 154),
    "ochre": (220, 174, 99),
    "plum": (193, 148, 214),
    "teal": (95, 201, 196),
    "rose": (239, 139, 160),
    "olive": (179, 196, 106),
}
GROUND_TINT = 0.075  # how far the ground leans towards the tint; more than this starts to look like a coloured card

DEFAULT_HEADLINES = {
    "desktop": [
        {
            "name": "1-keys",
            "source": "docs/listing/frames/raw-L1-editing.png",
            "crop": [0.505, 0.283, 1.0, 0.8],
            "bleed": False,
            "kicker": "KEYBOARD",
            "headline": "Hands on the keys. The map keeps up.",
            "tint": "terracotta",
        },
        {
            "name": "2-shape",
            "source": "docs/listing/frames/raw-L2-shape.png",
            "crop": [0.06, 0.283, 0.995, 0.947],
            "layout": "wide",
            "kicker": "THE SHAPE",
            "headline": "Tab, Enter, type. The shape appears.",
            "tint": "blue",
        },
        {
            "name": "3-outline",
            "source": "docs/listing/frames/raw-L3-outline.png",
            "crop": [0.268, 0.315, 0.7, 0.905],
            "kicker": "THE OUTLINE",
            "headline": "One shortcut, and it is an outline.",
            "tint": "green",
        },
        {
            "name": "4-file",
            "source": "docs/listing/frames/raw-L4-note-and-map.png",
            "crop": [0.055, 0.195, 0.455, 0.722],
            "kicker": "THE FILE",
            "headline": "It was only ever a Markdown note.",
            "tint": "ochre",
        },
        {
            "name": "5-export",
            "source": "docs/listing/frames/raw-L5-export-light.png",
            "crop": [0.235, 0.262, 0.81, 0.858],
            "bleed": False,
            "kicker": "THE WAY OUT",
            "headline": "Export the map. Keep the note.",
            "tint": "plum",
        },
    ],
    "mobile": [
        {
            "name": "1-phone",
            "source": "docs/screenshots/10-phone-map.png",
            "kicker": "THE PHONE",
            "headline": "The same map, on your phone.",
            "tint": "teal",
        },
        {
            "name": "2-dock",
            "source": "docs/screenshots/13-phone-editing.png",
            "kicker": "THE DOCK",
            "headline": "A soft keyboard has no Tab. The dock does.",
            "tint": "rose",
        },
        {
            "name": "3-note",
            "source": "docs/screenshots/12-phone-outline.png",
            "kicker": "THE NOTE",
            "headline": "Still a list. Still yours.",
            "tint": "olive",
        },
    ],
}

# Desktop geometry in 1200-wide design units; every number is multiplied by the output's scale.
COL_X = 96  # 8% in: what an object-fit: cover thumbnail can take off a side
COL_W = 368
PANEL_X = 500
PANEL_MAX_H = 660
PANEL_RADIUS = 16
HEAD_SIZE = 54
HEAD_LEADING = 1.13
HEAD_MAX_LINES = 4
KICKER_SIZE = 20
KICKER_TRACK = 0.09  # of the font size, for kickers set in capitals
KICKER_PAD = (16, 9)
KICKER_GAP = 30  # from the pill's foot to the headline's first cap
WIDE_HEAD_W = 620  # the "wide" layout: narrow enough that the headline takes two lines and leaves the edge room
WIDE_GAP = 40  # from the headline's last baseline to the panel

# Mobile geometry in 900-wide design units.
M_TOP = 136  # 8.5% down
M_TEXT_W = 740
M_HEAD_SIZE = 72
M_KICKER_SIZE = 22
M_KICKER_PAD = (20, 11)
M_KICKER_GAP = 34
M_PHONE_W = 676  # the screen, without the bezel
M_PHONE_GAP = 72  # from the headline's last baseline to the top of the bezel
M_BEZEL = 13
M_SCREEN_RADIUS = 62

SANS = {
    "Bold": ["/Library/Fonts/SF-Pro-Display-Bold.otf", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/SF-Pro.ttf"],
    "Medium": ["/Library/Fonts/SF-Pro-Text-Medium.otf", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/SF-Pro.ttf"],
    "Regular": ["/Library/Fonts/SF-Pro-Text-Regular.otf", "/System/Library/Fonts/SFNS.ttf", "/Library/Fonts/SF-Pro.ttf"],
}
LAST_RESORT = ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]


def load_font(size, weight="Medium"):
    for path in SANS[weight] + LAST_RESORT:
        if not os.path.exists(path):
            continue
        font = ImageFont.truetype(path, size)
        try:  # SFNS.ttf and SF-Pro.ttf are variable fonts that open at Regular; the static .otf files ignore this.
            font.set_variation_by_name(weight)
        except Exception:
            pass
        return font
    raise SystemExit("no usable system font found")


def load_headlines():
    if not os.path.exists(HEADLINES):
        os.makedirs(OUT_ROOT, exist_ok=True)
        with open(HEADLINES, "w") as f:
            json.dump(DEFAULT_HEADLINES, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"  wrote the default {os.path.relpath(HEADLINES, REPO)}")
    with open(HEADLINES) as f:
        return json.load(f)


def mix(a, b, t):
    return tuple(round(x + (y - x) * t) for x, y in zip(a, b))


def ground(size, tint):
    return Image.new("RGBA", size, mix(GROUND, tint, GROUND_TINT) + (255,))


def wrap_balanced(text, font, max_w, max_lines):
    """Break into the fewest lines that fit, then pick the breaks that leave the lines most alike in length.

    A greedy wrap leaves one orphan word under a full line, which is the first thing the eye finds in a headline.
    """
    words = text.split()
    width = lambda ws: font.getlength(" ".join(ws))
    for n in range(1, max_lines + 1):
        best = None
        for cuts in itertools.combinations(range(1, len(words)), n - 1):
            edges = (0,) + cuts + (len(words),)
            lines = [words[a:b] for a, b in zip(edges, edges[1:])]
            widths = [width(l) for l in lines]
            if max(widths) > max_w:
                continue
            score = max(widths) - min(widths)
            if best is None or score < best[0]:
                best = (score, [" ".join(l) for l in lines])
        if best:
            return best[1]
    return None


def fit_headline(text, size, max_w, max_lines, scale):
    """The headline at its designed size, or a step smaller for as long as it takes to fit."""
    while size > 20:
        font = load_font(round(size * scale), "Bold")
        lines = wrap_balanced(text, font, max_w * scale, max_lines)
        if lines:
            return font, lines
        size -= 2
    raise SystemExit(f"headline will not fit: {text!r}")


def rounded_mask(size, radius, corners=(True, True, True, True)):
    """Drawn at 4x and reduced, because Pillow's rounded_rectangle is not antialiased."""
    k = 4
    big = Image.new("L", (size[0] * k, size[1] * k), 0)
    ImageDraw.Draw(big).rounded_rectangle((0, 0, big.width - 1, big.height - 1), radius=radius * k, fill=255, corners=corners)
    return big.resize(size, Image.LANCZOS)


def shadow(canvas, box, radius, scale, strength=150):
    blur = 30 * scale
    pad = round(blur * 3)
    x, y, w, h = box
    shade = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle((pad, pad, pad + w, pad + h), radius=radius, fill=(0, 0, 0, strength))
    shade = shade.filter(ImageFilter.GaussianBlur(blur))
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    layer.alpha_composite(shade, (x - pad, y - pad + round(18 * scale)))
    return Image.alpha_composite(canvas, layer)


def tracked(font, text, track):
    return sum(font.getlength(ch) for ch in text) + track * (len(text) - 1)


def draw_kicker(canvas, text, xy, anchor, tint, size, pad, scale):
    """The kicker as an outlined pill — the shape the plugin gives a node. Returns the pill's box.

    The final kickers are capitals, which close up at this size, so they are letterspaced: Pillow has no tracking,
    and the letters are placed one by one.
    """
    font = load_font(round(size * scale), "Medium")
    track = KICKER_TRACK * font.size if text.isupper() else 0
    ascent = -font.getbbox("H", anchor="ls")[1]
    px, py = pad[0] * scale, pad[1] * scale
    w, h = tracked(font, text, track) + 2 * px, ascent + 2 * py
    x0 = xy[0] - w / 2 if anchor == "m" else xy[0]
    y0 = xy[1]
    k = 4
    layer = Image.new("RGBA", (round(w * k) + 4 * k, round(h * k) + 4 * k), (0, 0, 0, 0))
    ImageDraw.Draw(layer).rounded_rectangle(
        (2 * k, 2 * k, 2 * k + w * k, 2 * k + h * k),
        radius=h * k / 2,
        fill=mix(GROUND, tint, 0.13) + (255,),
        outline=tint + (235,),
        width=round(1.6 * scale * k),
    )
    layer = layer.resize((layer.width // k, layer.height // k), Image.LANCZOS)
    canvas.alpha_composite(layer, (round(x0) - 2, round(y0) - 2))
    draw = ImageDraw.Draw(canvas)
    x = x0 + px
    for ch in text:
        draw.text((x, y0 + py + ascent), ch, font=font, fill=tint + (255,), anchor="ls")
        x += font.getlength(ch) + track
    return x0, y0, x0 + w, y0 + h


def edge_points(start, end):
    """A map edge: horizontal out, horizontal in, the curve the plugin draws between a parent and a child."""
    (x0, y0), (x1, y1) = start, end
    mid = (x0 + x1) / 2
    pts = []
    for i in range(121):
        t = i / 120
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t**2, t**3
        pts.append((a * x0 + b * mid + c * mid + d * x1, a * y0 + b * y0 + c * y1 + d * y1))
    return pts


def turn_points(start, end):
    """The same edge turned a quarter: level out of the parent, straight down into a child that sits below it."""
    (x0, y0), (x1, y1) = start, end
    pts = []
    for i in range(121):
        t = i / 120
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t**2, t**3
        pts.append((a * x0 + b * (x0 + (x1 - x0) * 0.7) + c * x1 + d * x1, a * y0 + b * y0 + c * (y0 + (y1 - y0) * 0.3) + d * y1))
    return pts


def draw_connector(canvas, pts, tint, scale):
    k = 4
    layer = Image.new("RGBA", (canvas.width * k, canvas.height * k), (0, 0, 0, 0))
    pts = [(x * k, y * k) for x, y in pts]
    ImageDraw.Draw(layer).line(pts, fill=tint + (200,), width=round(2 * scale * k), joint="curve")
    canvas.alpha_composite(layer.resize(canvas.size, Image.LANCZOS))


def draw_lines(canvas, lines, font, xy, anchor, leading):
    """Headline lines from the first baseline down. Returns the last baseline."""
    draw = ImageDraw.Draw(canvas)
    step = font.size * leading
    y = xy[1]
    for line in lines:
        x = xy[0] - (font.getbbox(line)[0] if anchor == "l" else 0)  # the side bearing, so the ink sits on the grid
        draw.text((x, y), line, font=font, fill=INK + (255,), anchor=anchor + "s")
        y += step
    return y - step


def window_box(src, window):
    """Where the window sits inside a raw frame, and how much shadow the frame keeps around it."""
    win_w, win_h = window
    x0, y0 = src.split()[3].point(lambda v: 255 if v > 250 else 0).getbbox()[:2]
    return x0, y0, x0 + win_w, y0 + win_h


def plain_crop(src, window, out_size):
    """finish.py's crop, to the pixel: the window with a little of its shadow, on the output's 3:2."""
    out_w, out_h = out_size
    win_w, win_h = window
    x0, y0, x1, y1 = window_box(src, window)
    margin_y = 60
    margin_x = round(((win_h + 2 * margin_y) * out_w / out_h - win_w) / 2)
    if x0 < margin_x or y0 < margin_y or x1 + margin_x > src.width or y1 + margin_y > src.height:
        margin_y = min(y0, src.height - y1, margin_y)
        margin_x = round(((win_h + 2 * margin_y) * out_w / out_h - win_w) / 2)
    return x0 - margin_x, y0 - margin_y, x1 + margin_x, y1 + margin_y


def render_plain(src, window, out_size):
    box = plain_crop(src, window, out_size)
    window_on_dark = src.crop(box).resize(out_size, Image.LANCZOS)
    return Image.alpha_composite(Image.new("RGBA", out_size, PLAIN_BG + (255,)), window_on_dark)


def window_of(src, window):
    """The window alone, flattened, so a crop that reaches a rounded corner shows dark rather than nothing."""
    win = src.crop(window_box(src, window))
    return Image.alpha_composite(Image.new("RGBA", win.size, PLAIN_BG + (255,)), win)


def render_branded(win, out_size, spec):
    """One desktop picture: the words in a column on the left, the crop in a panel that runs off the right edge."""
    out_w, out_h = out_size
    s = out_w / DESKTOP_SIZE[0]
    tint = TINTS[spec["tint"]]
    canvas = ground(out_size, tint)

    fx0, fy0, fx1, fy1 = spec["crop"]
    crop = win.crop((round(fx0 * win.width), round(fy0 * win.height), round(fx1 * win.width), round(fy1 * win.height)))
    # The panel is as wide as the canvas allows and as tall as the crop makes it. A crop too tall for that starts
    # further right instead, so it still ends where it should and nothing in it is trimmed.
    #
    # By default the panel runs off the right edge. That only works when the crop's right side is slack, because a
    # cover-cropped thumbnail can lose 8% there. When the subject itself is at the crop's right ("bleed": false in
    # the entry: the node being edited, the far leaves of the whole map) the panel stops at the safe line instead.
    bleed = spec.get("bleed", True)
    right = out_w if bleed else out_w - round(COL_X * s)
    panel_w = right - round(PANEL_X * s)
    panel_h = round(panel_w * crop.height / crop.width)
    if panel_h > PANEL_MAX_H * s:
        panel_h = round(PANEL_MAX_H * s)
        panel_w = round(panel_h * crop.width / crop.height)
    crop = crop.resize((panel_w, panel_h), Image.LANCZOS)
    px, py = right - panel_w, (out_h - panel_h) // 2
    radius = round(PANEL_RADIUS * s)

    # A bleeding panel's shadow and hairline are drawn wider than the canvas so neither turns the corner at the edge.
    over = 4 * radius if bleed else 0
    canvas = shadow(canvas, (px, py, panel_w + over, panel_h), radius, s)
    crop.putalpha(rounded_mask(crop.size, radius, (True, not bleed, not bleed, True)))
    canvas.alpha_composite(crop, (px, py))
    k = 4
    edge = Image.new("RGBA", (panel_w * k, panel_h * k), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (0, 0, edge.width - 1 + over * k, edge.height - 1),
        radius=radius * k,
        outline=tint + (120,),
        width=round(1.5 * s * k),
    )
    canvas.alpha_composite(edge.resize((panel_w, panel_h), Image.LANCZOS), (px, py))

    font, lines = fit_headline(spec["headline"], HEAD_SIZE, COL_W, HEAD_MAX_LINES, s)
    cap = -font.getbbox("H", anchor="ls")[1]
    kicker_font = load_font(round(KICKER_SIZE * s), "Medium")
    pill_h = -kicker_font.getbbox("H", anchor="ls")[1] + 2 * KICKER_PAD[1] * s
    block_h = pill_h + KICKER_GAP * s + cap + (len(lines) - 1) * font.size * HEAD_LEADING
    top = (out_h - block_h) / 2
    pill = draw_kicker(canvas, spec["kicker"], (COL_X * s, top), "l", tint, KICKER_SIZE, KICKER_PAD, s)
    first_base = top + pill_h + KICKER_GAP * s + cap
    draw_lines(canvas, lines, font, (COL_X * s, first_base), "l", HEAD_LEADING)

    # The edge leaves the pill level and bends down to the panel's middle, the way a parent's edge meets a child.
    # A long first line would sit in its way, and an edge drawn through a word is a strike-through, so then it
    # rises to the panel instead. Which way it goes is decided by the geometry, not by the entry.
    start = (pill[2], (pill[1] + pill[3]) / 2)
    pts = edge_points(start, (px, out_h / 2))
    first_right = COL_X * s + font.getlength(lines[0]) + 14 * s
    first_top = first_base - cap - 14 * s
    if any(x < first_right and y > first_top for x, y in pts):
        pts = edge_points(start, (px, max(py + 3 * radius, start[1] - 84 * s)))
    draw_connector(canvas, pts, tint, s)
    return canvas


def render_desktop(win, out_size, spec):
    return (render_wide if spec.get("layout") == "wide" else render_branded)(win, out_size, spec)


def render_wide(win, out_size, spec):
    """The one picture whose subject is a whole map: the words across the top, the panel the full safe width below.

    A map is twice as wide as it is tall, and beside a column it can only be a strip at two-thirds size. Here it
    gets 1008 units and shows at about its real size. The parts are the column layout's own (pill, edge, hairline,
    tint), so it reads as the same family with a different rhythm, which suits the beat where the shape appears.
    """
    out_w, out_h = out_size
    s = out_w / DESKTOP_SIZE[0]
    tint = TINTS[spec["tint"]]
    canvas = ground(out_size, tint)

    fx0, fy0, fx1, fy1 = spec["crop"]
    crop = win.crop((round(fx0 * win.width), round(fy0 * win.height), round(fx1 * win.width), round(fy1 * win.height)))
    panel_w = out_w - 2 * round(COL_X * s)
    panel_h = round(panel_w * crop.height / crop.width)
    crop = crop.resize((panel_w, panel_h), Image.LANCZOS)

    font, lines = fit_headline(spec["headline"], HEAD_SIZE, WIDE_HEAD_W, 2, s)
    cap = -font.getbbox("H", anchor="ls")[1]
    kicker_font = load_font(round(KICKER_SIZE * s), "Medium")
    pill_h = -kicker_font.getbbox("H", anchor="ls")[1] + 2 * KICKER_PAD[1] * s
    text_h = pill_h + KICKER_GAP * s + cap + (len(lines) - 1) * font.size * HEAD_LEADING
    top = (out_h - (text_h + WIDE_GAP * s + panel_h)) / 2
    px, py = round(COL_X * s), round(top + text_h + WIDE_GAP * s)
    radius = round(PANEL_RADIUS * s)

    canvas = shadow(canvas, (px, py, panel_w, panel_h), radius, s)
    crop.putalpha(rounded_mask(crop.size, radius))
    canvas.alpha_composite(crop, (px, py))
    k = 4
    edge = Image.new("RGBA", (panel_w * k, panel_h * k), (0, 0, 0, 0))
    ImageDraw.Draw(edge).rounded_rectangle(
        (0, 0, edge.width - 1, edge.height - 1), radius=radius * k, outline=tint + (120,), width=round(1.5 * s * k)
    )
    canvas.alpha_composite(edge.resize((panel_w, panel_h), Image.LANCZOS), (px, py))

    pill = draw_kicker(canvas, spec["kicker"], (COL_X * s, top), "l", tint, KICKER_SIZE, KICKER_PAD, s)
    first_base = top + pill_h + KICKER_GAP * s + cap
    draw_lines(canvas, lines, font, (COL_X * s, first_base), "l", HEAD_LEADING)

    # The edge leaves the pill level, passes the end of the headline and turns down into the top of the panel. It
    # lands as far left as it can without touching a word.
    head_right = COL_X * s + max(font.getlength(l) for l in lines) + 28 * s
    head_top = first_base - cap - 16 * s
    start = (pill[2], (pill[1] + pill[3]) / 2)
    land = max(head_right + 60 * s, out_w * 0.5)
    while True:
        pts = turn_points(start, (land, py))
        if land > out_w - COL_X * s - 3 * radius or not any(x < head_right and y > head_top for x, y in pts):
            break
        land += 20 * s
    draw_connector(canvas, pts, tint, s)
    return canvas


def render_mobile(content, out_size, variant, spec):
    out_w, out_h = out_size
    s = out_w / MOBILE_SIZE[0]
    if variant == "plain" or not spec:
        margin = 70 * s
        k = min((out_w - 2 * margin) / content.width, (out_h - 2 * margin) / content.height)
        w, h = round(content.width * k), round(content.height * k)
        x, y = (out_w - w) // 2, (out_h - h) // 2
        canvas = Image.new("RGBA", out_size, PLAIN_BG + (255,))
        canvas = shadow(canvas, (x, y, w, h), round(44 * s), s, 140)
        shot = content.resize((w, h), Image.LANCZOS)
        shot.putalpha(rounded_mask(shot.size, round(44 * s)))
        canvas.alpha_composite(shot, (x, y))
        return canvas

    tint = TINTS[spec["tint"]]
    canvas = ground(out_size, tint)
    cx = out_w / 2
    font, lines = fit_headline(spec["headline"], M_HEAD_SIZE, M_TEXT_W, 2, s)
    cap = -font.getbbox("H", anchor="ls")[1]
    pill = draw_kicker(canvas, spec["kicker"], (cx, M_TOP * s), "m", tint, M_KICKER_SIZE, M_KICKER_PAD, s)
    # Two lines are always reserved, so the three phones stand at one height whatever the headlines do,
    # and the space is measured at the designed size, so a headline that had to shrink does not move its phone.
    step = M_HEAD_SIZE * s * HEAD_LEADING
    first = pill[3] + M_KICKER_GAP * s + cap
    block = (len(lines) - 1) * font.size * HEAD_LEADING
    draw_lines(canvas, lines, font, (cx, first + (step - block) / 2), "m", HEAD_LEADING)
    phone_top = round(first + step + M_PHONE_GAP * s)

    # A bezel and nothing else: no notch, no island, no buttons, no logo. It says "a phone" and stops.
    bezel = round(M_BEZEL * s)
    sw = round(M_PHONE_W * s)
    sh = round(sw * content.height / content.width)
    bw, bh = sw + 2 * bezel, sh + 2 * bezel
    bx = (out_w - bw) // 2
    r_screen = round(M_SCREEN_RADIUS * s)
    r_body = r_screen + bezel
    canvas = shadow(canvas, (bx, phone_top, bw, bh), r_body, s, 170)
    body = Image.new("RGBA", (bw, bh), (9, 9, 11, 255))
    body.putalpha(rounded_mask(body.size, r_body))
    canvas.alpha_composite(body, (bx, phone_top))
    k = 4
    rim = Image.new("RGBA", (bw * k, bh * k), (0, 0, 0, 0))
    ImageDraw.Draw(rim).rounded_rectangle(
        (0, 0, rim.width - 1, rim.height - 1), radius=r_body * k, outline=mix((84, 84, 92), tint, 0.25) + (255,), width=round(2 * s * k)
    )
    canvas.alpha_composite(rim.resize((bw, bh), Image.LANCZOS), (bx, phone_top))
    screen = content.resize((sw, sh), Image.LANCZOS)
    screen.putalpha(rounded_mask(screen.size, r_screen))
    canvas.alpha_composite(screen, (bx + bezel, phone_top + bezel))
    return canvas


def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.convert("RGB").save(path, optimize=True)
    mb = os.path.getsize(path) / 1e6
    note = ""
    if mb > 5:  # the form's ceiling; WebP at 90 is visually the same and a third of the weight
        webp = path.replace(".png", ".webp")
        img.convert("RGB").save(webp, quality=90, method=6)
        note = f"  OVER 5 MB -> also wrote {os.path.basename(webp)} ({os.path.getsize(webp) / 1e6:.2f} MB)"
    print(f"  {os.path.relpath(path, REPO)}  {img.width}x{img.height}  {mb:.2f} MB{note}")


def tile(sheet, path, box, radius):
    x, y, w, h = box
    if not os.path.exists(path):
        ImageDraw.Draw(sheet).rectangle((x, y, x + w, y + h), outline=(60, 60, 68))
        return
    img = Image.open(path).convert("RGBA").resize((w, h), Image.LANCZOS)
    img.putalpha(rounded_mask(img.size, radius))
    sheet.paste(img, (x, y), img)


def contact_sheets(spec):
    """The set as the directory shows it: the hero large, then every picture at thumbnail width, on the page colour.

    The thumbnail row is the one to judge. If a headline cannot be read there, it is not doing its job.
    """
    small = load_font(14, "Regular")
    names = [e["name"] for e in spec["desktop"]]
    side, gap, tw, th = 40, 20, 300, 200
    width = 2 * side + 5 * tw + 4 * gap
    hero_w, hero_h = 1050, 700  # with two half-height pictures beside it, this fills the row of five exactly
    sub_h = (hero_h - gap) // 2
    sub_w = sub_h * 3 // 2
    sheet = Image.new("RGB", (width, side + hero_h + 56 + th + 56 + th + 50), PAGE_BG)
    draw = ImageDraw.Draw(sheet)
    folder = lambda variant, name: os.path.join(OUT_ROOT, "desktop", variant, f"{name}.png")
    tile(sheet, folder("branded", names[0]), (side, side, hero_w, hero_h), 14)
    for i, name in enumerate(names[1:3]):
        tile(sheet, folder("branded", name), (side + hero_w + gap, side + i * (sub_h + gap), sub_w, sub_h), 10)
    y = side + hero_h + 36
    for variant, label in (("branded", "branded, at the grid's thumbnail width (300 px)"), ("plain", "plain, same width")):
        draw.text((side, y - 24), label, font=small, fill=(130, 130, 140))
        for i, name in enumerate(names):
            tile(sheet, folder(variant, name), (side + i * (tw + gap), y, tw, th), 8)
        y += th + 56
    path = os.path.join(OUT_ROOT, "preview-desktop.png")
    sheet.save(path, optimize=True)
    print(f"  {os.path.relpath(path, REPO)}  {sheet.width}x{sheet.height}")

    names = [e["name"] for e in spec["mobile"]]
    big_w, big_h, tw, th = 405, 720, 169, 300
    width = 2 * side + 3 * big_w + 2 * gap
    sheet = Image.new("RGB", (width, side + big_h + 56 + th + 50), PAGE_BG)
    draw = ImageDraw.Draw(sheet)
    folder = lambda variant, name: os.path.join(OUT_ROOT, "mobile", variant, f"{name}.png")
    for i, name in enumerate(names):
        tile(sheet, folder("branded", name), (side + i * (big_w + gap), side, big_w, big_h), 12)
    y = side + big_h + 36
    draw.text((side, y - 24), "branded, then plain, at thumbnail width (169 px)", font=small, fill=(130, 130, 140))
    for j, variant in enumerate(("branded", "plain")):
        for i, name in enumerate(names):
            tile(sheet, folder(variant, name), (side + (j * len(names) + i) * (tw + gap) + j * gap, y, tw, th), 6)
    path = os.path.join(OUT_ROOT, "preview-mobile.png")
    sheet.save(path, optimize=True)
    print(f"  {os.path.relpath(path, REPO)}  {sheet.width}x{sheet.height}")


def refresh_upload(spec):
    """Lay the finished files out the way the form wants them. Only the folders this script owns are replaced."""
    up = os.path.join(OUT_ROOT, "upload")
    plan = [
        ("branded@2x", ""),
        ("plain@2x", "plain-version"),
        ("branded", "fallback-1200x800"),
    ]
    for variant, sub in plan:
        for kind in ("desktop", "mobile"):
            dest = os.path.join(up, sub, kind)
            shutil.rmtree(dest, ignore_errors=True)
            os.makedirs(dest)
            for entry in spec[kind]:
                src = os.path.join(OUT_ROOT, kind, variant, f"{entry['name']}.png")
                if os.path.exists(src):
                    shutil.copy2(src, dest)
    for sheet in ("preview-desktop.png", "preview-mobile.png"):
        if os.path.exists(os.path.join(OUT_ROOT, sheet)):
            shutil.copy2(os.path.join(OUT_ROOT, sheet), up)
    print(f"  {os.path.relpath(up, REPO)}/  refreshed")


def sizes(base):
    return ((base, ""), ((base[0] * 2, base[1] * 2), "@2x"))


def note_standin(entry):
    if entry.get("standin"):
        print(f"  STAND-IN  {entry['name']}: {entry['standin']}")


def run_mobile(spec):
    for entry in spec["mobile"]:
        path = os.path.join(REPO, entry["source"])
        if not os.path.exists(path):
            print(f"  {entry['source']}: missing, skipped")
            continue
        content = Image.open(path).convert("RGBA")
        print(f"mobile {entry['name']}  <- {entry['source']}  {content.width}x{content.height}")
        note_standin(entry)
        for size, suffix in sizes(MOBILE_SIZE):
            for variant in ("plain", "branded"):
                save(render_mobile(content, size, variant, entry), os.path.join(OUT_ROOT, "mobile", variant + suffix, f"{entry['name']}.png"))


def run_desktop(raw_dir, only):
    spec = load_headlines()
    for entry in spec["desktop"]:
        if only and entry["name"] not in only:
            continue
        path = os.path.join(REPO, entry["source"])
        if not os.path.exists(path):  # a bare file name is looked for in the raw-frame directory
            path = os.path.join(raw_dir, os.path.basename(entry["source"]))
        if not os.path.exists(path):
            print(f"  {entry['source']}: missing, skipped")
            continue
        src = Image.open(path).convert("RGBA")
        win = window_of(src, WINDOW)
        print(f"{entry['name']}  <- {entry['source']}")
        note_standin(entry)
        for size, suffix in sizes(DESKTOP_SIZE):
            save(render_plain(src, WINDOW, size), os.path.join(OUT_ROOT, "desktop", "plain" + suffix, f"{entry['name']}.png"))
            save(render_desktop(win, size, entry), os.path.join(OUT_ROOT, "desktop", "branded" + suffix, f"{entry['name']}.png"))
    if not only:
        run_mobile(spec)
        prune(spec)
    print("contact sheets")
    contact_sheets(spec)
    refresh_upload(spec)


def prune(spec):
    """Drop pictures whose entry has gone from headlines.json, so a renamed picture cannot be uploaded twice."""
    for kind in ("desktop", "mobile"):
        keep = {e["name"] for e in spec[kind]}
        for variant in ("plain", "plain@2x", "branded", "branded@2x"):
            folder = os.path.join(OUT_ROOT, kind, variant)
            for f in os.listdir(folder) if os.path.isdir(folder) else []:
                if os.path.splitext(f)[1] in (".png", ".webp") and os.path.splitext(f)[0] not in keep:
                    os.remove(os.path.join(folder, f))
                    print(f"  removed stale {kind}/{variant}/{f}")


def rebrand():
    """Refresh only the words and the crops, from the 2x plain exports, when the raw frames are no longer around."""
    spec = load_headlines()
    for entry in spec["desktop"]:
        source = os.path.join(OUT_ROOT, "desktop", "plain@2x", f"{entry['name']}.png")
        if not os.path.exists(source):
            print(f"  desktop/plain@2x/{entry['name']}.png: missing, skipped")
            continue
        plain = Image.open(source).convert("RGBA")
        k = plain.width / DESKTOP_SIZE[0]
        win = plain.crop(tuple(round(v * k) for v in PLAIN_WINDOW))
        print(f"{entry['name']}  <- desktop/plain@2x/{entry['name']}.png")
        note_standin(entry)
        for size, suffix in sizes(DESKTOP_SIZE):
            save(render_desktop(win, size, entry), os.path.join(OUT_ROOT, "desktop", "branded" + suffix, f"{entry['name']}.png"))
    run_mobile(spec)
    print("contact sheets")
    contact_sheets(spec)
    refresh_upload(spec)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--rebrand"]:
        rebrand()
    elif not args or not args[0].startswith("-"):
        raw_dir = args.pop(0) if args and os.path.isdir(args[0]) else FRAMES
        run_desktop(raw_dir, set(args))
    else:
        raise SystemExit("usage: listing.py [raw-frame-dir] [NAME ...] | --rebrand")
