#!/usr/bin/env python3
"""Draw the sparse shortcut hints recorded in done.json onto renderer frames."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", size)


def width(draw: ImageDraw.ImageDraw, text: str, face: ImageFont.FreeTypeFont) -> int:
    box = draw.textbbox((0, 0), text, font=face)
    return box[2] - box[0]


def draw_hint(image: Image.Image, keys: list[str], label: str) -> Image.Image:
    rgba = image.convert("RGBA")
    scale = rgba.width / 840
    cap_font = font(round(15 * scale))
    label_font = font(round(13.5 * scale))
    gap = round(7 * scale)
    outer_x = round(12 * scale)
    outer_y = round(7 * scale)
    cap_h = round(28 * scale)
    cap_pad = round(7 * scale)
    min_cap = round(28 * scale)
    label_gap = round(7 * scale)
    label_w = width(ImageDraw.Draw(rgba), label, label_font)
    cap_widths = [max(min_cap, width(ImageDraw.Draw(rgba), key, cap_font) + cap_pad * 2) for key in keys]
    pill_w = outer_x * 2 + sum(cap_widths) + gap * max(0, len(keys) - 1) + label_gap + label_w
    pill_h = outer_y * 2 + cap_h
    right = round(22 * scale)
    bottom = round(22 * scale)
    x0 = rgba.width - right - pill_w
    y0 = rgba.height - bottom - pill_h

    overlay = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    radius = round(13 * scale)
    draw.rounded_rectangle(
        (x0, y0, x0 + pill_w, y0 + pill_h),
        radius=radius,
        fill=(30, 30, 34, 246),
        outline=(255, 255, 255, 42),
        width=max(1, round(scale)),
    )
    x = x0 + outer_x
    for key, cap_w in zip(keys, cap_widths, strict=True):
        cy = y0 + outer_y
        draw.rounded_rectangle(
            (x, cy, x + cap_w, cy + cap_h),
            radius=round(7 * scale),
            fill=(255, 255, 255, 23),
            outline=(255, 255, 255, 46),
            width=max(1, round(scale)),
        )
        draw.text(
            (x + cap_w / 2, cy + cap_h / 2),
            key,
            font=cap_font,
            fill=(255, 255, 255, 245),
            anchor="mm",
            stroke_width=0,
        )
        x += cap_w + gap
    x += label_gap - gap
    draw.text(
        (x, y0 + pill_h / 2),
        label,
        font=label_font,
        fill=(255, 255, 255, 190),
        anchor="lm",
    )
    return Image.alpha_composite(rgba, overlay).convert("RGB")


def main() -> None:
    folder = Path(sys.argv[1])
    data = json.loads((folder / "done.json").read_text())
    events = data.get("keycasts", [])
    changed = 0
    for event in events:
        end = event.get("end") or data["frames"]
        for index in range(event["start"], end):
            frame = folder / f"frame-{index:05d}.png"
            if not frame.exists():
                continue
            with Image.open(frame) as image:
                draw_hint(image, event["keys"], event["label"]).save(frame)
            changed += 1
    print(f"drew {len(events)} shortcut hints across {changed} frames")


if __name__ == "__main__":
    main()
