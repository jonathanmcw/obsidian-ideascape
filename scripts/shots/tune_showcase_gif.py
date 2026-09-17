#!/usr/bin/env python3
"""Post-process the README showcase GIF.

The checked-in demo is recorded from Obsidian plus an external keycast panel.
This helper keeps that workflow intact, but smooths two recording artifacts:

- a bright, warm strip of desktop showing through the left edge of the capture
- repeated lower-right keycast flashes that distract from the map

Usage:
  python3 scripts/shots/tune_showcase_gif.py /path/to/raw-showcase.gif docs/showcase-clean.gif
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageSequence


LEFT_EDGE_STAGE_TOP = 100
LEFT_EDGE_CORE_PX = 68
LEFT_EDGE_END_PX = 86
LEFT_EDGE_FOREGROUND_START = 46
LEFT_EDGE_FOREGROUND_END = 72
LEFT_EDGE_BACKGROUND = (24, 24, 23)
KEYCAST_ROI = (590, 500, 840, 606)
EARLY_KEYCAST_PATCH = (558, 532, 835, 600)
KEYCAST_BRIGHT_THRESHOLD = 500
MIN_KEYCAST_GAP_FRAMES = 54
MAX_KEYCAST_FRAMES = 17
KEEP_FULL_GROUP_RANGE = (240, 999)
MIN_FULL_GROUP_FRAMES = 8


@dataclass(frozen=True)
class Group:
    start: int
    end: int


def load_frames(path: Path) -> tuple[list[Image.Image], list[int]]:
    image = Image.open(path)
    frames: list[Image.Image] = []
    durations: list[int] = []
    for frame in ImageSequence.Iterator(image):
        frames.append(frame.convert("RGBA"))
        durations.append(int(frame.info.get("duration", image.info.get("duration", 80))))
    return frames, durations


def luma(pixel: tuple[int, int, int, int]) -> float:
    r, g, b, _ = pixel
    return 0.30 * r + 0.59 * g + 0.11 * b


def clean_left_capture_edge(frame: Image.Image) -> None:
    """Replace the exposed desktop strip while preserving bright UI text drawn over it.

    The strip is not just an orange tint: it contains a static column of another window. Colour correction alone
    leaves that brighter shape visible on a phone. Low-contrast pixels in the strip are blended back to the stage
    background; text and icons stay. The stage colour is fixed in this recording: sampling it per row would turn a
    node or connector crossing that row into a horizontal bar at the edge.
    """
    pixels = frame.load()
    width, height = frame.size
    edge = min(LEFT_EDGE_END_PX, width)

    for y in range(LEFT_EDGE_STAGE_TOP, height):
        for x in range(edge):
            r, g, b, a = pixels[x, y]
            if a == 0:
                continue

            edge_strength = 1.0 if x < LEFT_EDGE_CORE_PX else (edge - x) / (edge - LEFT_EDGE_CORE_PX)
            value = luma((r, g, b, a))
            foreground = min(
                1.0,
                max(0.0, (value - LEFT_EDGE_FOREGROUND_START) / (LEFT_EDGE_FOREGROUND_END - LEFT_EDGE_FOREGROUND_START)),
            )
            strength = edge_strength * (1.0 - foreground)
            pixels[x, y] = (
                int(r * (1 - strength) + LEFT_EDGE_BACKGROUND[0] * strength),
                int(g * (1 - strength) + LEFT_EDGE_BACKGROUND[1] * strength),
                int(b * (1 - strength) + LEFT_EDGE_BACKGROUND[2] * strength),
                a,
            )


def keycast_score(frame: Image.Image) -> int:
    gray = frame.crop(KEYCAST_ROI).convert("L")
    hist = gray.histogram()
    return sum(hist[91:])


def find_keycast_groups(frames: list[Image.Image]) -> list[Group]:
    groups: list[Group] = []
    start: int | None = None
    last = 0
    for index, frame in enumerate(frames):
        visible = keycast_score(frame) > KEYCAST_BRIGHT_THRESHOLD
        if visible and start is None:
            start = index
        if visible:
            last = index
        if not visible and start is not None:
            groups.append(Group(start, last))
            start = None
    if start is not None:
        groups.append(Group(start, last))
    return groups


def clean_patch_before_group(frames: list[Image.Image], group: Group, patch: tuple[int, int, int, int]) -> Image.Image:
    """The unchanged background immediately before an early keycast opens."""
    before = max(0, group.start - 1)
    return frames[before].crop(patch)


def replace_keycast_patch(frame: Image.Image, clean_patch: Image.Image, patch: tuple[int, int, int, int]) -> None:
    frame.paste(clean_patch, patch[:2])


def calm_keycasts(frames: list[Image.Image]) -> tuple[int, int]:
    groups = find_keycast_groups(frames)
    kept: list[Group] = []
    hidden = 0
    last_kept = -MIN_KEYCAST_GAP_FRAMES

    for group in groups:
        keep = group.start - last_kept >= MIN_KEYCAST_GAP_FRAMES
        keep_full_group = (
            KEEP_FULL_GROUP_RANGE[0] <= group.start < KEEP_FULL_GROUP_RANGE[1]
            and group.end - group.start + 1 >= MIN_FULL_GROUP_FRAMES
        )
        if keep_full_group:
            keep_until = group.end
        elif keep:
            keep_until = min(group.end, group.start + MAX_KEYCAST_FRAMES - 1)
        else:
            keep_until = group.start - 1
        if keep or keep_full_group:
            kept.append(Group(group.start, keep_until))
            last_kept = group.start

        for index in range(group.start, group.end + 1):
            if index <= keep_until:
                continue
            replace_keycast_patch(
                frames[index],
                clean_patch_before_group(frames, group, EARLY_KEYCAST_PATCH),
                EARLY_KEYCAST_PATCH,
            )
            hidden += 1

    return len(kept), hidden


def save_gif(frames: list[Image.Image], durations: list[int], path: Path) -> None:
    gifsicle = shutil.which("gifsicle")
    if gifsicle is None:
        frames[0].save(path, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
        return

    with tempfile.NamedTemporaryFile(suffix=".gif", delete=False) as tmp:
        tmp_path = Path(tmp.name)
    try:
        frames[0].save(tmp_path, save_all=True, append_images=frames[1:], duration=durations, loop=0, optimize=True)
        subprocess.run(
            [gifsicle, "-O3", "--colors", "128", str(tmp_path), "-o", str(path)],
            check=True,
        )
    finally:
        tmp_path.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()

    frames, durations = load_frames(args.source)
    for frame in frames:
        clean_left_capture_edge(frame)
    kept, hidden = calm_keycasts(frames)
    save_gif(frames, durations, args.output)
    print(f"wrote {args.output} ({len(frames)} frames, {sum(durations) / 1000:.2f}s)")
    print(f"keycast groups kept: {kept}; frames with keycast patch hidden: {hidden}")


if __name__ == "__main__":
    main()
