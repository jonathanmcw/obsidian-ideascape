#!/bin/bash
# Take the pictures in docs/screenshots and src/welcome again, from the demo vault, on the build in this checkout.
#
#   npm run build && node scripts/install.mjs "$PWD/demo-vault"   # the pictures must show the build being shipped
#   bash scripts/shots/capture.sh screenshots                     # docs/screenshots/*.png, 1200x800
#   bash scripts/shots/capture.sh slides                          # src/welcome/*.webp, 1200x747 (then build again)
#
# Needs: demo-vault open in Obsidian 1.12+ with its command line tool, Screen Recording permission for the terminal,
# cliclick (brew install cliclick), and Pillow (pip install pillow). Nothing here touches the vault's notes.
#
# Four things bite, and each is handled below:
#   - An occluded window hands `screencapture` its LAST composited frame. The window is raised (always on top) for
#     the moment of the capture, and resized off and back when a menu or modal has to be cleared from that frame.
#   - Any `obsidian eval` dismisses an open Obsidian menu. The menu is opened by sendInputEvent inside the same
#     eval, and the capture that follows runs with no eval in between.
#   - sendInputEvent takes window points, not CSS pixels: multiply by contentBounds.width / window.innerWidth.
#   - `iterateRootLeaves` does not report a split's second tab group; walk rootSplit.children instead.
set -euo pipefail
cd "$(dirname "$0")/../.."
VAULT=${VAULT:-demo-vault}
OUT=${OUT:-$(mktemp -d)}
WIN_W=1147 WIN_H=765          # window size in points; every picture is taken at this size
echo "raw frames → $OUT"

ev() { obsidian "vault=$VAULT" eval "code=$1" 2>&1 | sed 's/^=> //'; }
# The window in physical pixels (its points times the display's backing scale) and its width in CSS pixels, which
# differs from both when Obsidian's own zoom is not 100%.
geom() { ev "const r=require('electron').remote; const b=r.getCurrentWindow().getContentBounds(); const s=r.screen.getPrimaryDisplay().scaleFactor; JSON.stringify([Math.round(b.width*s), Math.round(b.height*s), Math.round(window.innerWidth)])"; }
front() { ev "const w=require('electron').remote.getCurrentWindow(); w.show(); w.focus(); w.moveTop(); w.setAlwaysOnTop(true); w.setBounds({x:60,y:80,width:$WIN_W,height:$WIN_H}); 'ok'" >/dev/null; }
unfront() { ev "require('electron').remote.getCurrentWindow().setAlwaysOnTop(false); 'ok'" >/dev/null; }
win_id() { ev "require('electron').remote.getCurrentWindow().getMediaSourceId()" | sed 's/^window://; s/:.*//'; }

# A pane of its own, one tab, both sidebars in, the note open at the given shape.
solo() {
  ev "const ls=[]; app.workspace.rootSplit.children.forEach(g=>(g.children||[]).forEach(l=>ls.push(l))); ls.slice(1).forEach(l=>l.detach()); 'one pane'" >/dev/null
  sleep 1.2
  ev "(async()=>{app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    await app.workspace.getMostRecentLeaf().openFile(app.vault.getAbstractFileByPath('$1'));})(); 'open'" >/dev/null
  sleep 2.5
  ev "app.commands.executeCommandById('ideascape:map-shape-$2'); 'shape'" >/dev/null; sleep 1.2
}
panel() { ev "const on=document.querySelector('.io-root .app')?.classList.contains('inspector-open'); if(on !== ('$1'==='on')) app.commands.executeCommandById('ideascape:map-properties'); 'panel'" >/dev/null; sleep 1; }
fit() { ev "app.commands.executeCommandById('ideascape:map-fit'); 'fit'" >/dev/null; sleep 1.2; }
theme() { ev "app.changeTheme('$1'); 'theme'" >/dev/null; sleep 1.8; }
sidebar() { ev "(async()=>{const fe=app.workspace.getLeavesOfType('file-explorer')[0]; if(fe) await app.workspace.revealLeaf(fe); app.workspace.leftSplit.expand();})(); 'sidebar'" >/dev/null; sleep 2; }
# Clear a menu or a modal that the window's last frame still holds: a resize forces the whole surface to be drawn.
repaint() { ev "const w=require('electron').remote.getCurrentWindow(); w.setBounds({x:60,y:80,width:1000,height:700}); 'small'" >/dev/null; sleep 1.5; front; sleep 2; }

shot() {
  front; sleep 1.5
  cliclick m:1300,400 >/dev/null; sleep 0.5      # a row under the pointer would wear its hover state
  ev "document.querySelectorAll('.tooltip').forEach(e=>e.remove()); 'clean'" >/dev/null; sleep 0.5
  screencapture -x -l "$(win_id)" "$OUT/raw-$1.png"
  unfront; echo "  $1"
}

case "${1:-screenshots}" in
screenshots)
  theme obsidian
  solo "Maps/Launch a podcast.md" map;      panel off; fit; shot 01-map-dark
  solo "Maps/Launch a podcast.md" outline;             shot 02-outline-dark
  solo "Maps/Ideascape tour.md" map;        panel off;  shot 08-tour-dark
  solo "Maps/Learn linear algebra.md" map;  panel off; fit
  ev "document.querySelector('.io-root .help')?.click(); 'sheet'" >/dev/null; sleep 1.5; shot 05-shortcuts-dark
  ev "document.querySelector('.io-root .sheet button')?.click(); 'close'" >/dev/null; sleep 1
  # The note's Markdown on the left, the map on the right.
  solo "Maps/Launch a podcast.md" map
  ev "app.commands.executeCommandById('ideascape:open-as-markdown'); 'md'" >/dev/null; sleep 2
  ev "(async()=>{const l=app.workspace.getLeaf('split'); await l.setViewState({type:'ideascape', state:{file:'Maps/Launch a podcast.md'}}); app.workspace.setActiveLeaf(l,{focus:true});})(); 'split'" >/dev/null; sleep 3
  fit; shot 06-markdown-and-map
  solo "Maps/Weekend in Kyoto.md" map; panel on; theme moonstone; fit; shot 04-themes-light
  theme obsidian
  # The welcome window, the way a first run shows it: forget it was seen, then reload.
  solo "Maps/Weekend in Kyoto.md" map; panel off; fit; sidebar
  ev "(p=>{p.settings.welcomed=false; void p.saveSettings(); return 'reset'})(app.plugins.plugins.ideascape)" >/dev/null; sleep 2
  ev "app.commands.executeCommandById('app:reload'); 'reload'" >/dev/null; sleep 15
  repaint; shot 07-welcome-dark; unfront
  read -r W H _ < <(geom | tr -d '[]' | tr ',' ' ')
  python3 scripts/shots/finish.py "$W" "$H" "$OUT"/raw-*.png
  for f in "$OUT"/out-*.png; do cp "$f" "docs/screenshots/$(basename "${f#*out-}")"; done
  ;;
slides)
  for shape in map outline; do
    solo "Maps/Weekend in Kyoto.md" $shape; panel off
    [ "$shape" = map ] && fit
    theme obsidian;  shot "w-$shape-dark"
    theme moonstone; shot "w-$shape-light"
  done
  # The file menu on a plain note. The menu is opened and captured with no eval in between, or it closes first.
  for pair in dark:obsidian light:moonstone; do
    theme "${pair#*:}"
    solo "Maps/Weekend in Kyoto.md" map; panel off; fit; sidebar
    front; cliclick m:1300,400 >/dev/null; sleep 1.5
    ev "const t=document.querySelector('.nav-file-title[data-path=\"Notes/Study log.md\"]').getBoundingClientRect();
        const b=require('electron').remote.getCurrentWindow().getContentBounds(); const k=b.width/window.innerWidth;
        const wc=require('electron').remote.getCurrentWebContents();
        const x=Math.round((t.left+70)*k), y=Math.round((t.top+t.height/2)*k);
        wc.sendInputEvent({type:'mouseDown',x,y,button:'right',clickCount:1});
        wc.sendInputEvent({type:'mouseUp',x,y,button:'right',clickCount:1}); 'sent'" >/dev/null
    sleep 1.6; screencapture -x -l "$(win_id)" "$OUT/raw-w-convert-${pair%%:*}.png"; unfront
    ev "const wc=require('electron').remote.getCurrentWebContents(); wc.sendInputEvent({type:'keyDown',keyCode:'Escape'}); wc.sendInputEvent({type:'keyUp',keyCode:'Escape'}); 'esc'" >/dev/null
    repaint; unfront
  done
  theme obsidian
  read -r W H CSS < <(geom | tr -d '[]' | tr ',' ' ')
  for f in "$OUT"/raw-w-*.png; do
    n=$(basename "$f" .png); n=${n#raw-w-}
    python3 scripts/shots/slide.py "$W" "$H" "$CSS" 30 "$f" "src/welcome/$n.webp"
  done
  # Point at "Open as a map"; the box is read off the finished slide.
  for n in dark light; do
    python3 scripts/shots/highlight.py "src/welcome/convert-$n.webp" "src/welcome/convert-$n.webp" 144 664 342 704
  done
  echo "run npm run build: the slides are inlined into main.js"
  ;;
*) echo "usage: capture.sh [screenshots|slides]" >&2; exit 1 ;;
esac
