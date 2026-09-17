# Turn the raw `screencapture -l` frames into the picture set the Obsidian community directory asks for.
#
# The directory's submission form takes 1200x800 desktop images (3:2) and 900x1600 mobile ones (9:16), PNG/JPEG/WebP,
# 5 MB each. The detail page shows the first image as a hero in a rounded 3:2 frame on a near-black page, and the
# grid thumbnails are cropped with CSS `object-fit: cover`, so the subject has to sit centred with slack at the edges
# and nothing that matters may live near a border. There are no captions: the alt text is generated.
#
# Two variants come out of one run, so the listing can be decided by looking rather than by arguing:
#
#   plain    — the window exactly as finish.py crops it, on flat #141416. This is what every plugin in the directory
#              does today (12 of 12 are bare app captures, 10 of them dark), so it is the safe default.
#   branded  — the same window, scaled down under a feature label and outcome-led headline, on a faint diagonal tint
#              with a violet glow behind the window. Still the real app, with no invented product UI.
#
# Each variant is written at 1200x800 (the form's recommendation, and what to upload) and at 2400x1600 in a sibling
# "@2x" folder, both resampled down from the 2x raw frame rather than up from a finished 1200x800 picture.
#
# Usage
#   python3 scripts/shots/listing.py <raw-frame-dir> [NAME ...]
#       <raw-frame-dir> holds the raw-*.png frames from scripts/shots/capture.sh. NAME limits the run to some of the
#       five outputs (1-map, 2-note-and-map, 3-outline, 4-shortcuts, 5-themes); the contact sheet is always rebuilt
#       from whatever is on disk afterwards.
#           docs/listing/desktop/{plain,plain@2x,branded,branded@2x}/<name>.png
#           docs/listing/preview-desktop.png    — all ten tiles side by side for a human to compare
#
#   python3 scripts/shots/listing.py --mobile NAME=<content.png> ...
#       Mobile takes a different kind of input: a TIGHT CONTENT CROP of the app running in Obsidian's mobile
#       emulation — no macOS title bar, no window shadow, roughly 9:16 (e.g. 810x1440 physical pixels). Each crop is
#       scaled to fit, given its own rounded corners (44 px at 900 width) and a soft drop shadow, and centred on a
#       900x1600 canvas with a ~70 px margin, in both variants; branded mobile copy sits top-centre rather than
#       top-left, because a 9:16 thumbnail is cropped from the sides. NAME picks the output name and, through the
#       table below, the label; any name not in the table simply gets no label.
#           docs/listing/mobile/{plain,plain@2x,branded,branded@2x}/<name>.png
#       Nothing about this mode has been through a real capture yet — no mobile frames exist.
#
#   python3 scripts/shots/listing.py --rebrand
#       Rebuild only the branded explanation layer from the checked-in 2x plain exports. Use this when refining
#       feature labels or headlines without changing the underlying product captures.
#
# Needs Pillow and numpy. Reads the raw frames; writes only under docs/listing.
import os
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT_ROOT = os.path.join(REPO, "docs", "listing")

# name, raw frame, feature label, headline. The order is the upload order: the first one is the hero on the detail page.
DESKTOP = [
    ("1-map", "raw-01-map-dark.png", "KEYBOARD FIRST", "Build a mind map without the mouse"),
    ("2-note-and-map", "raw-06-markdown-and-map.png", "PLAIN MARKDOWN", "Your map is still an ordinary note"),
    ("3-outline", "raw-02-outline-dark.png", "TWO VIEWS", "Switch between map and outline"),
    ("4-shortcuts", "raw-05-shortcuts-dark.png", "SHORTCUTS", "Keep every command one key away"),
    ("5-themes", "raw-04-themes-light.png", "THEMES", "Match your vault, light or dark"),
]
LABELS = {name: (feature, headline) for name, _, feature, headline in DESKTOP}
# Phone frames from `capture.sh mobile`, in upload order.
# The hero's label must not repeat the short description, which sits beside it at the top of the listing page.
MOBILE_LABELS = {
    "1-map": ("MOBILE", "Keep mapping on your phone"),
    "2-outline": ("TWO VIEWS", "Switch to an outline on mobile"),
    "3-light": ("LIGHT + DARK", "Match your vault on every screen"),
}

WINDOW = (2294, 1530)  # the captured window in physical pixels, the size finish.py is handed
DESKTOP_SIZE = (1200, 800)
MOBILE_SIZE = (900, 1600)

PLAIN_BG = (20, 20, 22)  # #141416
TINT_TL = (28, 26, 43)  # #1c1a2b
TINT_BR = (19, 19, 22)  # #131316
GLOW = (124, 101, 235)  # #7c65eb
GLOW_ALPHA = 0.10

# Geometry in 1200-wide design units; every number is multiplied by the output's scale.
BRANDED_SCALE = 0.84  # leaves room for a feature label and headline without crowding the app window
FEATURE_SIZE = 13
FEATURE_Y = 23
LABEL_SIZE = 34
LABEL_MIN_X = 90  # the central 85% of the width starts here, and an object-cover thumbnail keeps that much
LABEL_Y = 47

MOBILE_MARGIN = 70  # in 900-wide design units
MOBILE_RADIUS = 44
MOBILE_FEATURE_SIZE = 15
MOBILE_FEATURE_Y = 35
MOBILE_LABEL_SIZE = 38
MOBILE_LABEL_Y = 66

FONTS = [
    "/Library/Fonts/SF-Pro-Display-Medium.otf",
    "/Library/Fonts/SF-Pro-Text-Medium.otf",
    "/System/Library/Fonts/SFNS.ttf",
    "/Library/Fonts/SF-Pro.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
]


def load_font(size):
    for path in FONTS:
        if not os.path.exists(path):
            continue
        font = ImageFont.truetype(path, size)
        try:  # SFNS.ttf and SF-Pro.ttf are variable fonts and default to a weight that is too light for a label.
            font.set_variation_by_name("Medium")
        except Exception:
            pass
        return font
    raise SystemExit("no usable system font found")


def flat_background(size, colour):
    return Image.new("RGBA", size, colour + (255,))


def branded_background(size, centre):
    """The diagonal tint plus a blurred violet glow behind the window, dithered so a 9-step ramp cannot band."""
    w, h = size
    x = np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :]
    y = np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None]
    t = (x + y) / 2.0
    tint = np.array(TINT_TL, np.float32) + (np.array(TINT_BR, np.float32) - np.array(TINT_TL, np.float32)) * t[..., None]

    cx, cy = centre
    rx, ry = 0.78 * w, 0.78 * h
    r2 = ((np.arange(w, dtype=np.float32)[None, :] - cx) / rx) ** 2 + (
        (np.arange(h, dtype=np.float32)[:, None] - cy) / ry
    ) ** 2
    glow = (GLOW_ALPHA * np.exp(-2.2 * r2))[..., None]
    rgb = tint * (1.0 - glow) + np.array(GLOW, np.float32) * glow

    rng = np.random.default_rng(7)  # one LSB of noise: the whole picture moves over ~21 steps of blue across 1200 px
    rgb = np.clip(rgb + rng.uniform(-0.5, 0.5, rgb.shape).astype(np.float32), 0, 255)
    out = Image.fromarray(rgb.astype(np.uint8), "RGB").convert("RGBA")
    return out


def draw_label(canvas, text, font, xy, anchor, fill=(255, 255, 255, 235)):
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(layer).text(xy, text, font=font, fill=fill, anchor=anchor)
    return Image.alpha_composite(canvas, layer)


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
    return Image.alpha_composite(flat_background(out_size, PLAIN_BG), window_on_dark)


def render_branded(src, window, out_size, feature, headline):
    out_w, out_h = out_size
    scale = out_w / DESKTOP_SIZE[0]
    win_w, win_h = window
    x0, y0, _, _ = window_box(src, window)

    box = plain_crop(src, window, out_size)
    plain_window_w = win_w * out_w / (box[2] - box[0])  # the width the plain variant gives the window
    k = plain_window_w * BRANDED_SCALE / win_w
    shot = src.resize((round(src.width * k), round(src.height * k)), Image.LANCZOS)
    win_left = (out_w - win_w * k) / 2
    paste_x = round(win_left - x0 * k)

    feature_font = load_font(round(FEATURE_SIZE * scale))
    font = load_font(round(LABEL_SIZE * scale))
    ascent, descent = font.getmetrics()
    band_bottom = LABEL_Y * scale + ascent + descent
    win_top = band_bottom + (out_h - band_bottom - win_h * k) / 2
    paste_y = round(win_top - y0 * k)

    # The label's first letter stands on the window's own left edge, so the two read as one block. The side bearing
    # comes off the drawing origin, or the ink would sit a couple of pixels to the right of the window.
    label_x = max(win_left, LABEL_MIN_X * scale) - font.getbbox(headline)[0]

    centre = (out_w / 2, win_top + win_h * k / 2)
    canvas = branded_background(out_size, centre)
    canvas = draw_label(
        canvas,
        feature,
        feature_font,
        (round(label_x), round(FEATURE_Y * scale)),
        "la",
        fill=(181, 163, 255, 242),
    )
    canvas = draw_label(canvas, headline, font, (round(label_x), round(LABEL_Y * scale)), "la")
    canvas.alpha_composite(shot, (paste_x, paste_y))
    return canvas


def rounded(img, radius):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius=radius, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def drop_shadow(canvas, box, radius, scale):
    """A soft shadow under the mobile content, roughly the weight macOS gives a window."""
    blur = 26 * scale
    pad = round(blur * 3)
    x, y, w, h = box
    layer = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shade = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
    ImageDraw.Draw(shade).rounded_rectangle((pad, pad, pad + w, pad + h), radius=radius, fill=(0, 0, 0, 140))
    shade = shade.filter(ImageFilter.GaussianBlur(blur))
    layer.alpha_composite(shade, (x - pad, y - pad + round(14 * scale)))
    return Image.alpha_composite(canvas, layer)


def render_mobile(content, out_size, variant, label):
    out_w, out_h = out_size
    scale = out_w / MOBILE_SIZE[0]
    margin = MOBILE_MARGIN * scale
    top = margin

    feature_font = None
    font = None
    if variant == "branded" and label:
        feature, headline = label
        feature_font = load_font(round(MOBILE_FEATURE_SIZE * scale))
        font = load_font(round(MOBILE_LABEL_SIZE * scale))
        ascent, descent = font.getmetrics()
        top = MOBILE_LABEL_Y * scale + ascent + descent

    avail_w, avail_h = out_w - 2 * margin, (out_h - margin) - top
    k = min(avail_w / content.width, avail_h / content.height)
    w, h = round(content.width * k), round(content.height * k)
    x, y = round((out_w - w) / 2), round(top + (avail_h - h) / 2)

    centre = (out_w / 2, y + h / 2)
    canvas = flat_background(out_size, PLAIN_BG) if variant == "plain" else branded_background(out_size, centre)
    radius = round(MOBILE_RADIUS * scale)
    canvas = drop_shadow(canvas, (x, y, w, h), radius, scale)
    canvas.alpha_composite(rounded(content.resize((w, h), Image.LANCZOS), radius), (x, y))
    if font:
        canvas = draw_label(
            canvas,
            feature,
            feature_font,
            (round(out_w / 2), round(MOBILE_FEATURE_Y * scale)),
            "ma",
            fill=(181, 163, 255, 242),
        )
        canvas = draw_label(canvas, headline, font, (round(out_w / 2), round(MOBILE_LABEL_Y * scale)), "ma")
    return canvas


def render_branded_from_plain(plain, out_size, feature, headline):
    """Rebuild branded artwork from the checked-in 2x plain export when the original raw frame is unavailable."""
    out_w, out_h = out_size
    scale = out_w / DESKTOP_SIZE[0]

    # The plain exports all share this window geometry. Crop the window itself, not its flat #141416 surround.
    x0 = round(plain.width * 44 / DESKTOP_SIZE[0])
    y0 = round(plain.height * 29 / DESKTOP_SIZE[1])
    x1 = round(plain.width * 1156 / DESKTOP_SIZE[0])
    y1 = round(plain.height * 771 / DESKTOP_SIZE[1])
    window = plain.crop((x0, y0, x1, y1)).convert("RGBA")

    target_w = round((1112 / DESKTOP_SIZE[0]) * out_w * BRANDED_SCALE)
    target_h = round(window.height * target_w / window.width)
    window = rounded(window.resize((target_w, target_h), Image.LANCZOS), round(14 * scale))

    feature_font = load_font(round(FEATURE_SIZE * scale))
    font = load_font(round(LABEL_SIZE * scale))
    ascent, descent = font.getmetrics()
    band_bottom = LABEL_Y * scale + ascent + descent
    win_left = (out_w - target_w) / 2
    win_top = band_bottom + (out_h - band_bottom - target_h) / 2
    label_x = max(win_left, LABEL_MIN_X * scale) - font.getbbox(headline)[0]

    canvas = branded_background(out_size, (out_w / 2, win_top + target_h / 2))
    canvas = draw_label(
        canvas,
        feature,
        feature_font,
        (round(label_x), round(FEATURE_Y * scale)),
        "la",
        fill=(181, 163, 255, 242),
    )
    canvas = draw_label(canvas, headline, font, (round(label_x), round(LABEL_Y * scale)), "la")
    canvas.alpha_composite(window, (round(win_left), round(win_top)))
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


def contact_sheet():
    """Ten tiles, branded over plain, so the two variants can be compared at a glance."""
    w, h = DESKTOP_SIZE
    sheet = Image.new("RGB", (w, h), (12, 12, 14))
    draw = ImageDraw.Draw(sheet)
    head, small = load_font(19), load_font(13)
    gap, side = 14, 24
    tile_w = (w - 2 * side - 4 * gap) // 5
    tile_h = round(tile_w * 2 / 3)
    draw.text((side, 26), "Ideascape — community directory screenshots", font=head, fill=(236, 236, 240))
    draw.text((side, 54), "two variants of the same five frames, 1200x800 each", font=small, fill=(140, 140, 150))

    foot = [
        "plain is what every plugin in the directory does today — a bare window capture, nothing added.",
        "branded keeps the real window under a feature label and headline, on a diagonal tint with a violet glow.",
        "The first image is the hero, shown in a rounded 3:2 frame; grid thumbnails are object-cover cropped,",
        "so the label stays inside the central 85% of the width and the window keeps slack on every side.",
    ]
    block = 2 * (30 + tile_h + 20) + 36  # two labelled rows and the gap between them
    y = 78 + (h - 78 - 22 * len(foot) - 28 - block) // 2
    for variant in ("branded", "plain"):
        draw.text((side, y), variant, font=head, fill=(198, 186, 255) if variant == "branded" else (170, 170, 178))
        y += 30
        for i, (name, _, _, _) in enumerate(DESKTOP):
            path = os.path.join(OUT_ROOT, "desktop", variant, f"{name}.png")
            x = side + i * (tile_w + gap)
            if os.path.exists(path):
                sheet.paste(Image.open(path).convert("RGB").resize((tile_w, tile_h), Image.LANCZOS), (x, y))
            else:
                draw.rectangle((x, y, x + tile_w, y + tile_h), outline=(60, 60, 68))
            draw.text((x, y + tile_h + 7), f"{name}.png", font=small, fill=(150, 150, 160))
        y += tile_h + 56
    y += 8
    for line in foot:
        draw.text((side, y), line, font=small, fill=(126, 126, 136))
        y += 22
    path = os.path.join(OUT_ROOT, "preview-desktop.png")
    sheet.save(path, optimize=True)
    print(f"  {os.path.relpath(path, REPO)}  {sheet.width}x{sheet.height}  {os.path.getsize(path) / 1e6:.2f} MB")


def run_desktop(raw_dir, only):
    for name, frame, feature, headline in DESKTOP:
        if only and name not in only:
            continue
        path = os.path.join(raw_dir, frame)
        if not os.path.exists(path):
            print(f"  {frame}: missing, skipped")
            continue
        src = Image.open(path).convert("RGBA")
        print(f"{name}  <- {frame}")
        for size, suffix in ((DESKTOP_SIZE, ""), ((DESKTOP_SIZE[0] * 2, DESKTOP_SIZE[1] * 2), "@2x")):
            save(render_plain(src, WINDOW, size), os.path.join(OUT_ROOT, "desktop", "plain" + suffix, f"{name}.png"))
            save(
                render_branded(src, WINDOW, size, feature, headline),
                os.path.join(OUT_ROOT, "desktop", "branded" + suffix, f"{name}.png"),
            )
    print("contact sheet")
    contact_sheet()


def run_mobile(pairs):
    for pair in pairs:
        if "=" not in pair:
            raise SystemExit(f"--mobile wants NAME=path, got {pair!r}")
        name, path = pair.split("=", 1)
        content = Image.open(path).convert("RGBA")
        label = MOBILE_LABELS.get(name, LABELS.get(name))
        print(f"{name}  <- {os.path.basename(path)}  {content.width}x{content.height}")
        for size, suffix in ((MOBILE_SIZE, ""), ((MOBILE_SIZE[0] * 2, MOBILE_SIZE[1] * 2), "@2x")):
            for variant in ("plain", "branded"):
                save(
                    render_mobile(content, size, variant, label),
                    os.path.join(OUT_ROOT, "mobile", variant + suffix, f"{name}.png"),
                )


def rebrand_checked_in_plain_exports():
    """Refresh only the explanation layer, preserving the exact checked-in product captures."""
    for name, _, feature, headline in DESKTOP:
        source = os.path.join(OUT_ROOT, "desktop", "plain@2x", f"{name}.png")
        plain = Image.open(source).convert("RGB")
        print(f"{name}  <- desktop/plain@2x/{name}.png")
        for size, suffix in ((DESKTOP_SIZE, ""), ((DESKTOP_SIZE[0] * 2, DESKTOP_SIZE[1] * 2), "@2x")):
            save(
                render_branded_from_plain(plain, size, feature, headline),
                os.path.join(OUT_ROOT, "desktop", "branded" + suffix, f"{name}.png"),
            )

    for name, label in MOBILE_LABELS.items():
        source = os.path.join(OUT_ROOT, "mobile", "plain@2x", f"{name}.png")
        plain = Image.open(source).convert("RGB")
        # render_mobile's checked-in plain 2x export places the 9:16 capture at x=140, y=249.
        content = plain.crop((140, 249, 1660, 2951))
        print(f"{name}  <- mobile/plain@2x/{name}.png")
        for size, suffix in ((MOBILE_SIZE, ""), ((MOBILE_SIZE[0] * 2, MOBILE_SIZE[1] * 2), "@2x")):
            save(
                render_mobile(content, size, "branded", label),
                os.path.join(OUT_ROOT, "mobile", "branded" + suffix, f"{name}.png"),
            )

    print("contact sheet")
    contact_sheet()


if __name__ == "__main__":
    args = sys.argv[1:]
    if args == ["--rebrand"]:
        rebrand_checked_in_plain_exports()
    elif args and args[0] == "--mobile":
        run_mobile(args[1:])
    elif args:
        run_desktop(args[0], set(args[1:]))
    else:
        raise SystemExit(
            __doc__ or "usage: listing.py <raw-frame-dir> [NAME ...] | --mobile NAME=content.png ... | --rebrand"
        )
