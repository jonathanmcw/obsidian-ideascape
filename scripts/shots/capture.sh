#!/bin/bash
# Take the pictures in docs/screenshots and src/welcome again, from the demo vault, on the build in this checkout.
#
#   npm run build && node scripts/install.mjs "$PWD/demo-vault"   # the pictures must show the build being shipped
#   bash scripts/shots/capture.sh screenshots                     # docs/screenshots/*.png, 1200x800
#   bash scripts/shots/capture.sh slides                          # src/welcome/*.webp, 1200x747 (then build again)
#   OUT=<dir> bash scripts/shots/capture.sh mobile                # <dir>/content-m*.png, 810x1440 (9:16) for the directory
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
# An unfocused window wears grey traffic lights and a smaller shadow, which changes the crop; steal focus for the capture.
front() { ev "const r=require('electron').remote; r.app.focus({steal:true}); const w=r.getCurrentWindow(); w.show(); w.focus(); w.moveTop(); w.setAlwaysOnTop(true); w.setBounds({x:60,y:80,width:$WIN_W,height:$WIN_H}); 'ok'" >/dev/null; }
unfront() { ev "require('electron').remote.getCurrentWindow().setAlwaysOnTop(false); 'ok'" >/dev/null; }
win_id() { ev "require('electron').remote.getCurrentWindow().getMediaSourceId()" | sed 's/^window://; s/:.*//'; }

# A pane of its own, one tab, both sidebars in, the note open at the given shape.
solo() {
  ev "const ls=[]; app.workspace.rootSplit.children.forEach(g=>(g.children||[]).forEach(l=>ls.push(l))); ls.slice(1).forEach(l=>l.detach()); 'one pane'" >/dev/null
  sleep 1.2
  ev "(async()=>{app.workspace.leftSplit.collapse(); app.workspace.rightSplit.collapse();
    await app.workspace.getMostRecentLeaf().openFile(app.vault.getAbstractFileByPath('$1'));
    const l=app.workspace.getMostRecentLeaf(); if(l.view.getViewType()!=='ideascape') await l.setViewState({type:'ideascape', state:{file:'$1'}});})(); 'open'" >/dev/null
  sleep 2.5
  # Opening a marked note can leave a twin leaf behind (one drawn, one not, each with its own camera). Keep the
  # one on screen and make it active, so every command and capture below lands on the same view.
  ev "(()=>{const ls=app.workspace.getLeavesOfType('ideascape'); const on=ls.find(l=>l.containerEl?.offsetParent); ls.filter(l=>l!==on).forEach(l=>l.detach()); if(on) app.workspace.setActiveLeaf(on,{focus:true}); return ls.length+' leaves'})()" >/dev/null; sleep 1
  ev "app.commands.executeCommandById('ideascape:map-shape-$2'); 'shape'" >/dev/null; sleep 1.2
}
panel() { ev "const on=document.querySelector('.io-root .app')?.classList.contains('inspector-open'); if(on !== ('$1'==='on')) app.commands.executeCommandById('ideascape:map-properties'); 'panel'" >/dev/null; sleep 1; }
fit() { ev "app.commands.executeCommandById('ideascape:map-fit'); 'fit'" >/dev/null; sleep 1.2; }
# Fit stops at 100%, so a small map sits in the middle of a big window. The view's own zoomBy multiplies the camera
# once, deterministically, on the active leaf (a stale background tab can hold the same file, so never take leaf [0]).
# Grow the map until it fills the stage (fit never zooms past 100%). Same measurement as mapfill below, which assigns
# the eval to a variable first: macOS's bash 3.2 splits quotes nested inside "$(...)" and brace-expands the code.
zoomfill() { mapfill "$@"; }
scale() { ev "(()=>{const l=app.workspace.getLeavesOfType('ideascape').find(x=>x.containerEl?.offsetParent); const el=l?.view?.containerEl?.querySelector('[style*=\"translate3d\"][style*=\"scale(\"]'); return el? el.style.transform.match(/scale\\(([^)]+)\\)/)[1] : 'none'})()"; }
zoom() { ev "app.workspace.getLeavesOfType('ideascape').find(x=>x.containerEl?.offsetParent)?.view.commands()?.zoomBy($1); 'zoom'" >/dev/null; sleep 1.5; echo "  zoom x$1 → scale $(scale)"; }
theme() { ev "app.changeTheme('$1'); 'theme'" >/dev/null; sleep 1.8; }
sidebar() { ev "(async()=>{const fe=app.workspace.getLeavesOfType('file-explorer')[0]; if(fe) await app.workspace.revealLeaf(fe); app.workspace.leftSplit.expand();})(); 'sidebar'" >/dev/null; sleep 2; }
# Clear a menu or a modal that the window's last frame still holds: a resize forces the whole surface to be drawn.
repaint() { ev "const w=require('electron').remote.getCurrentWindow(); w.setBounds({x:60,y:80,width:1000,height:700}); 'small'" >/dev/null; sleep 1.5; front; sleep 2; }

# A run ends with the welcome window open (its last picture), so the next run starts by closing whatever is open (Escape,
# the way any Obsidian modal closes) and marking the welcome as seen, or the modal would sit in every frame.
reset() { for _ in 1 2 3; do ev "const wc=require('electron').remote.getCurrentWebContents(); wc.sendInputEvent({type:'keyDown',keyCode:'Escape'}); wc.sendInputEvent({type:'keyUp',keyCode:'Escape'}); 'esc'" >/dev/null; sleep 0.6; done
  ev "(p=>{if(p){p.settings.welcomed=true; void p.saveSettings();}})(app.plugins.plugins.ideascape); 'seen'" >/dev/null; sleep 1
  [ "$(ev "document.querySelectorAll('.modal-container').length")" = 0 ] || { echo 'a modal is still open; close it and rerun' >&2; exit 1; }; }

shot() {
  front; sleep 1.5
  cliclick m:1300,400 >/dev/null; sleep 0.5      # a row under the pointer would wear its hover state
  ev "document.querySelectorAll('.tooltip').forEach(e=>e.remove()); 'clean'" >/dev/null; sleep 0.5
  screencapture -x -l "$(win_id)" "$OUT/raw-$1.png"
  unfront; echo "  $1"
}

finish() {
  read -r W H _ < <(geom | tr -d '[]' | tr ',' ' ')
  python3 scripts/shots/finish.py "$W" "$H" "$OUT"/raw-*.png
  for f in "$OUT"/out-*.png; do cp "$f" "docs/screenshots/$(basename "${f#*out-}")"; done
}

# ── the phone ────────────────────────────────────────────────────────────────────────────────────────────────
# Obsidian's own developer toggle, app.emulateMobile, draws the phone UI in the desktop window: is-mobile and
# is-phone land on the body, the tab row becomes the mobile header, and the navbar floats over the bottom of the
# view. The window keeps its macOS title bar and the room the leaf reserves for the traffic lights above that
# header — 89 CSS pixels together — so the window is made that much taller than 9:16 and mobile.py cuts it off.
MOB_W=405 MOB_H=818            # content size in points: 810x1636 physical, 196 of them the chrome above the header
MOB_TOP=89                     # where the mobile header starts, in CSS pixels
SHOT_W=810 SHOT_H=1440         # what the community directory asks for: 9:16
emulate() { ev "app.emulateMobile($1); 'emulate'" >/dev/null; sleep 4; }
mfront() { ev "const w=require('electron').remote.getCurrentWindow(); w.show(); w.focus(); w.moveTop(); w.setAlwaysOnTop(true); w.setContentBounds({x:60,y:29,width:$MOB_W,height:$MOB_H}); 'ok'" >/dev/null; }
# The phone window is taller than the screen's work area allows anywhere but the top, so it sits at y 29, and
# setContentBounds is what has to be exact here: the picture is measured from the content, not the frame.
mshot() {
  caffeinate -u -t 1                             # a sleeping display hands screencapture nothing but "could not create image"
  mfront; sleep 1.5
  cliclick m:1300,400 >/dev/null; sleep 0.5
  ev "document.querySelectorAll('.tooltip').forEach(e=>e.remove()); 'clean'" >/dev/null; sleep 0.5
  screencapture -x -l "$(win_id)" "$OUT/raw-$1.png"
  unfront; echo "  $1"
}
# What zoomfill does, for the phone: fit floors at 50% on a view under 600px wide, which leaves even a compact map
# wider than the window, so the map is measured as drawn and taken to the given fraction of the stage. The answer
# has to land in a variable first — bash brace-expands a {a, b} inside a $( ) that sits inside double quotes, and
# Obsidian is handed two half-statements instead of the code (which is what zoomfill itself runs into).
mapfill() {
  local r; r=$(ev "(()=>{const l=app.workspace.getLeavesOfType('ideascape').find(x=>x.containerEl?.offsetParent) || app.workspace.activeLeaf; const c=l.view.containerEl;
    const st=c.querySelector('.stage').getBoundingClientRect();
    const ns=[...c.querySelectorAll('.nodes .node')].filter(n=>!n.classList.contains('ghost')).map(n=>n.getBoundingClientRect());
    const x0=Math.min(...ns.map(r=>r.left)), x1=Math.max(...ns.map(r=>r.right)), y0=Math.min(...ns.map(r=>r.top)), y1=Math.max(...ns.map(r=>r.bottom));
    const k=Math.min(${1:-0.90}*st.width/(x1-x0), ${1:-0.90}*st.height/(y1-y0)); l.view.commands().zoomBy(k);
    return 'x'+k.toFixed(2)+': nodes '+Math.round(x1-x0)+'x'+Math.round(y1-y0)+' in stage '+Math.round(st.width)+'x'+Math.round(st.height)})()")
  echo "  mapfill $r"; sleep 1.5
}
# The lowest node on screen, in CSS pixels down the window.
mapfoot() { ev "(()=>{const c=app.workspace.getLeavesOfType('ideascape').find(x=>x.containerEl?.offsetParent).view.containerEl; let d=0; c.querySelectorAll('.nodes .node').forEach(n=>{d=Math.max(d,n.getBoundingClientRect().bottom)}); return Math.round(d)})()"; }
# A map centred in a phone-shaped stage runs under the zoom, undo and help buttons stacked down its right edge
# (they start 515 CSS pixels down this window). A wheel over empty canvas pans the map and never touches a node,
# so the note is safe, but the events arrive in fits: lift until the map is clear rather than a fixed number of times.
lift() { ev "(()=>{const b=require('electron').remote.getCurrentWindow().getContentBounds(); const k=b.width/window.innerWidth;
  const wc=require('electron').remote.getCurrentWebContents(); const x=Math.round(60*k), y=Math.round(300*k);
  for(let i=0;i<2;i++) wc.sendInputEvent({type:'mouseWheel',x,y,deltaX:0,deltaY:-30,canScroll:true}); return 'lift'})()" >/dev/null; sleep 1.8; }
mapclear() { for _ in 1 2 3 4 5 6; do [ "$(mapfoot)" -le 505 ] && { echo "  map clear of the buttons"; return; }; lift; done
  echo '  the map still runs under the buttons' >&2; }
mfinish() {
  read -r W H CSS < <(geom | tr -d '[]' | tr ',' ' ')
  for f in "$OUT"/raw-m*.png; do
    n=$(basename "$f" .png); n=${n#raw-}
    python3 scripts/shots/mobile.py "$W" "$H" "$CSS" "$MOB_TOP" "$SHOT_W" "$SHOT_H" "$f" "$OUT/content-$n.png"
  done
}
# Whatever happened, the app is left the way the other runs expect to find it.
desktop() { ev "app.emulateMobile(false); 'desktop'" >/dev/null; sleep 4
  ev "app.changeTheme('obsidian'); 'theme'" >/dev/null; sleep 1.5
  front; sleep 1.5; unfront; echo "back on the desktop: $(geom)"; }

case "${1:-screenshots}" in
screenshots)
  reset; theme obsidian
  solo "Maps/Launch a podcast.md" map;      panel off; fit; zoomfill 0.86; shot 01-map-dark
  solo "Maps/Launch a podcast.md" outline;             shot 02-outline-dark
  solo "Maps/Ideascape tour.md" map;        panel off;  shot 08-tour-dark
  solo "Maps/Learn linear algebra.md" map;  panel off; fit
  ev "document.querySelector('.io-root .help')?.click(); 'sheet'" >/dev/null; sleep 1.5; shot 05-shortcuts-dark
  ev "document.querySelector('.io-root .sheet button')?.click(); 'close'" >/dev/null; sleep 1
  # The note's Markdown on the left, the map on the right.
  solo "Maps/Launch a podcast.md" map
  ev "app.commands.executeCommandById('ideascape:open-as-markdown'); 'md'" >/dev/null; sleep 2
  ev "(async()=>{const l=app.workspace.getLeaf('split'); await l.setViewState({type:'ideascape', state:{file:'Maps/Launch a podcast.md'}}); app.workspace.setActiveLeaf(l,{focus:true});})(); 'split'" >/dev/null; sleep 3
  fit; zoomfill 0.9; shot 06-markdown-and-map
  solo "Maps/Weekend in Kyoto.md" map; panel on; theme moonstone; fit; shot 04-themes-light
  theme obsidian
  # The welcome window, the way a first run shows it: forget it was seen, then reload.
  solo "Maps/Weekend in Kyoto.md" map; panel off; fit; sidebar
  ev "(p=>{p.settings.welcomed=false; void p.saveSettings(); return 'reset'})(app.plugins.plugins.ideascape)" >/dev/null; sleep 2
  ev "app.commands.executeCommandById('app:reload'); 'reload'" >/dev/null; sleep 15
  repaint; shot 07-welcome-dark; unfront
  finish
  ;;
hero)   # the first picture alone, for a quick retake: bash scripts/shots/capture.sh hero
  reset; theme obsidian
  solo "Maps/Launch a podcast.md" map;      panel off; fit; zoomfill 0.86; shot 01-map-dark
  finish; open -a Claude 2>/dev/null || true
  ;;
split)  # the Markdown-beside-map picture alone: bash scripts/shots/capture.sh split
  reset; theme obsidian
  solo "Maps/Launch a podcast.md" map
  ev "app.commands.executeCommandById('ideascape:open-as-markdown'); 'md'" >/dev/null; sleep 2
  ev "(async()=>{const l=app.workspace.getLeaf('split'); await l.setViewState({type:'ideascape', state:{file:'Maps/Launch a podcast.md'}}); app.workspace.setActiveLeaf(l,{focus:true});})(); 'split'" >/dev/null; sleep 3
  fit; zoomfill 0.9; shot 06-markdown-and-map
  finish; open -a Claude 2>/dev/null || true
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
mobile) # the phone-shaped pictures the community directory asks for, 810x1440 in $OUT, nothing written to the repo
  trap desktop EXIT
  reset; theme obsidian
  emulate true
  # The window has to be phone-shaped before anything is laid out or measured: every number below — the fit floor,
  # the stage the map is sized against, the 505 the buttons start at — belongs to this window and no other.
  mfront; sleep 3
  # Fit floors at 50% under 600px wide, which leaves even this compact map wider than a phone, so the map is
  # sized off what is drawn instead and then lifted clear of the buttons.
  solo "Maps/Weekend in Kyoto.md" map; panel off; fit; mapfill 0.90; mapclear; mshot m1-map-dark
  solo "Maps/Launch a podcast.md" outline;                                        mshot m2-outline-dark
  theme moonstone
  solo "Maps/Weekend in Kyoto.md" map; panel off; fit; mapfill 0.90; mapclear; mshot m3-map-light
  theme obsidian
  solo "Maps/Weekend in Kyoto.md" map; panel off; fit; mapfill 0.90; mapclear
  ev "document.querySelector('.io-root .help')?.click(); 'sheet'" >/dev/null; sleep 1.5; mshot m4-shortcuts-dark
  ev "document.querySelector('.io-root .sheet button')?.click(); 'close'" >/dev/null; sleep 1
  mfinish
  ;;
*) echo "usage: capture.sh [screenshots|hero|split|slides|mobile]" >&2; exit 1 ;;
esac
