#!/bin/bash
# Rebuild the README/community-listing animation from a real Ideascape session.
#
# This records Electron's active Obsidian leaf directly. Unlike a display or
# region recording, renderer capture cannot include Claude/Codex overlays,
# wallpaper, or a strip from a neighbouring window.
set -euo pipefail
cd "$(dirname "$0")/../.."

VAULT=${VAULT:-demo-vault}
OUTPUT=${OUTPUT:-docs/showcase.gif}
FPS=${FPS:-12}
KEEP_FRAMES=${KEEP_FRAMES:-0}
FRAMES=$(mktemp -d /private/tmp/ideascape-showcase.XXXXXX)

cleanup() {
  if [ "$KEEP_FRAMES" = 1 ]; then
    echo "frames kept at $FRAMES"
  else
    rm -rf "$FRAMES"
  fi
}
trap cleanup EXIT

find_cli() {
  if [ -n "${OBSIDIAN_CLI:-}" ] && [ -x "$OBSIDIAN_CLI" ]; then printf '%s\n' "$OBSIDIAN_CLI"; return; fi
  # However it was installed: on PATH (which is where Obsidian's own installer puts it), or in the app bundle.
  if command -v obsidian >/dev/null 2>&1; then command -v obsidian; return; fi
  if [ -x /usr/local/bin/obsidian ]; then printf '%s\n' /usr/local/bin/obsidian; return; fi
  if [ -x /Applications/Obsidian.app/Contents/MacOS/obsidian-cli ]; then
    printf '%s\n' /Applications/Obsidian.app/Contents/MacOS/obsidian-cli; return
  fi
  echo "Obsidian CLI is missing. Reinstall Obsidian 1.12.7+ and enable Settings → General → Command line interface." >&2
  exit 1
}

CLI=$(find_cli)
RECORDER="$PWD/scripts/shots/showcase-recorder.js"
command -v ffmpeg >/dev/null || { echo "ffmpeg is required" >&2; exit 1; }
command -v gifsicle >/dev/null || { echo "gifsicle is required" >&2; exit 1; }

echo "recording renderer-only frames → $FRAMES"
CODE="window.__ideascapeShowcase={out:$(node -p 'JSON.stringify(process.argv[1])' "$FRAMES"),fps:$FPS};eval(require('fs').readFileSync($(node -p 'JSON.stringify(process.argv[1])' "$RECORDER"),'utf8'))"
"$CLI" "vault=$VAULT" eval "code=$CODE"
# The CLI can return before the renderer has finished what it was given: the recorder is asynchronous, and a pass
# that took 356 good frames was called unfinished because this looked once, the instant the command returned. Wait
# for the file the recorder writes, the way scripts/shots/review.mjs waits for its own.
for _ in $(seq 1 300); do [ -f "$FRAMES/done.json" ] && break; sleep 1; done
[ -f "$FRAMES/done.json" ] || { echo "The recorder did not finish" >&2; exit 1; }
python3 scripts/shots/draw_keycast.py "$FRAMES"

mkdir -p "$(dirname "$OUTPUT")"
RAW="$FRAMES/showcase-raw.gif"
ffmpeg -hide_banner -loglevel error -y -framerate "$FPS" -i "$FRAMES/frame-%05d.png" \
  -filter_complex "[0:v]scale=840:606:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle" \
  -loop 0 "$RAW"
gifsicle -O3 --lossy=25 --colors 128 "$RAW" -o "$OUTPUT"

# The community listing cached the original path while the README uses the
# cache-busted name. Keep them byte-identical so either URL shows the new demo.
if [ "$OUTPUT" = docs/showcase.gif ]; then cp "$OUTPUT" docs/showcase-clean.gif; fi

echo "wrote $OUTPUT ($(du -h "$OUTPUT" | cut -f1), $(node -p 'const d=require(process.argv[1]); `${d.frames} frames at ${d.fps} fps`' "$FRAMES/done.json"))"
