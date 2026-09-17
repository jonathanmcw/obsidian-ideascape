// keycast: the key-hint pill in docs/showcase-clean.gif. A floating panel that names the key just pressed, for screen
// recordings made by a script that drives the keyboard (the plugin itself draws nothing of the kind).
//
// Build:  swiftc -O scripts/keycast.swift -o /tmp/keycast
// Run:    /tmp/keycast labels.txt <right> <bottom>     (screen points, top-left origin, where the pill's corner sits)
//
// labels.txt has one "caps|label" per line, caps separated by spaces: "⌘ B|Bold". The recording script shows line i
// by parking the mouse at x >= 1200 and y in [300 + 10*i, 310 + 10*i), somewhere outside the recorded region, right
// before it presses the key; y < 290 hides the pill. The pill fades after 1.5 s. Recorded with
// `screencapture -v -R x,y,w,h`, which sees the panel; the desktop app's own screenshots do not.
import AppKit

let args = CommandLine.arguments
let lines = try! String(contentsOfFile: args[1], encoding: .utf8).split(separator: "\n").map(String.init)
let right = CGFloat(Double(args[2])!), bottom = CGFloat(Double(args[3])!)
let screenH = NSScreen.main!.frame.height

final class Pill: NSView {
  var caps: [String] = [], label = ""
  let capFont = NSFont.systemFont(ofSize: 15, weight: .medium), labelFont = NSFont.systemFont(ofSize: 13.5)
  override func draw(_ r: NSRect) {
    let bg = NSBezierPath(roundedRect: bounds, xRadius: 12, yRadius: 12)
    NSColor(calibratedRed: 0.11, green: 0.11, blue: 0.13, alpha: 0.96).setFill(); bg.fill()
    NSColor(calibratedWhite: 1, alpha: 0.14).setStroke(); bg.lineWidth = 1; bg.stroke()
    var x: CGFloat = 12
    for c in caps {
      let s = NSAttributedString(string: c, attributes: [.font: capFont, .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.95)])
      let w = max(26, s.size().width + 14)
      let cap = NSBezierPath(roundedRect: NSRect(x: x, y: 8, width: w, height: 28), xRadius: 6, yRadius: 6)
      NSColor(calibratedWhite: 1, alpha: 0.10).setFill(); cap.fill()
      NSColor(calibratedWhite: 1, alpha: 0.18).setStroke(); cap.stroke()
      s.draw(at: NSPoint(x: x + (w - s.size().width) / 2, y: 8 + (28 - s.size().height) / 2 + 0.5))
      x += w + 6
    }
    let l = NSAttributedString(string: label, attributes: [.font: labelFont, .foregroundColor: NSColor(calibratedWhite: 1, alpha: 0.72)])
    l.draw(at: NSPoint(x: x + 6, y: (bounds.height - l.size().height) / 2 + 0.5))
  }
  func size() -> NSSize {
    var w: CGFloat = 12
    for c in caps { w += max(26, NSAttributedString(string: c, attributes: [.font: capFont]).size().width + 14) + 6 }
    w += 6 + NSAttributedString(string: label, attributes: [.font: labelFont]).size().width + 14
    return NSSize(width: ceil(w), height: 44)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let win = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
win.level = .floating; win.isOpaque = false; win.backgroundColor = .clear; win.hasShadow = true
win.ignoresMouseEvents = true; win.isReleasedWhenClosed = false; win.collectionBehavior = [.canJoinAllSpaces, .stationary]
let pill = Pill(); win.contentView = pill
var shown = -1, hideAt = Date()

func show(_ i: Int) {
  let parts = lines[i].split(separator: "|", maxSplits: 1).map(String.init)
  pill.caps = parts[0].split(separator: " ").map(String.init); pill.label = parts.count > 1 ? parts[1] : ""
  let sz = pill.size()
  win.setFrame(NSRect(x: right - sz.width, y: screenH - bottom, width: sz.width, height: sz.height), display: true)
  pill.needsDisplay = true; win.alphaValue = 1; win.orderFrontRegardless()
  hideAt = Date().addingTimeInterval(1.5)
}
Timer.scheduledTimer(withTimeInterval: 0.03, repeats: true) { _ in
  let m = NSEvent.mouseLocation
  let yTop = screenH - m.y
  if m.x >= 1200 {
    if yTop < 290 { if shown != -2 { win.orderOut(nil); shown = -2 } }
    else { let i = Int((yTop - 300) / 10); if i >= 0 && i < lines.count && i != shown { shown = i; show(i) } }
  }
  // A short fade, stepped by hand: the animator left the window at alpha 0 for the next show.
  if shown >= 0 && Date() > hideAt {
    win.alphaValue -= 0.12
    if win.alphaValue <= 0 { win.orderOut(nil); win.alphaValue = 1; shown = -1 }
  }
}
app.run()
