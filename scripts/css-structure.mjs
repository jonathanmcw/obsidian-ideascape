// Structural checks on the map's stylesheet — the mistakes that leave valid CSS behind, so neither the build nor a
// test that greps the file can see them. Every one of these has happened:
//
//   - A rule inserted into the middle of a selector list took the selectors above it with it. (0.9.4: the phone's
//     zoom and undo buttons were sized by a list that a `display: none` rule was spliced into, and vanished.)
//   - A component was deleted and its rules stayed behind, styling nothing. (0.9.4: 288 lines of them.)
//   - A token was renamed in one place and read in another, so `var(--io-...)` silently fell back or resolved
//     to nothing.
//
// Used by verify:release and by the UI tests. Pure text, no browser: it answers "is this sheet still shaped the way
// it reads", not "does it look right" — that is what the rendered checks are for.

/** A rule: its selector text, its declarations, and where it starts. `@media` and friends are walked into. */
function* rules(css) {
  const comments = []
  // Blank the comments, keeping the offsets, so a `{` or `,` inside prose cannot be mistaken for syntax.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, match => {
    comments.push(match)
    return " ".repeat(match.length)
  })
  const stack = []
  let i = 0
  let start = 0
  while (i < bare.length) {
    const ch = bare[i]
    if (ch === "{") {
      const prelude = bare.slice(start, i)
      if (prelude.trim().startsWith("@")) stack.push({ at: true })
      else stack.push({ at: false, prelude, preludeBare: prelude, preludeRaw: css.slice(start, i), offset: start, body: i + 1 });
      i += 1
      start = i
      continue
    }
    if (ch === "}") {
      const frame = stack.pop()
      if (frame && !frame.at) yield { selector: frame.prelude, selectorBare: frame.preludeBare, selectorRaw: frame.preludeRaw, offset: frame.offset, body: bare.slice(frame.body, i) }
      i += 1
      start = i
      continue
    }
    if (ch === ";" && !stack.some(f => !f.at)) start = i + 1
    i += 1
  }
}

const lineOf = (css, offset) => css.slice(0, offset).split("\n").length

/** Every problem found, as readable lines. Empty means the sheet is shaped as it reads. */
export function cssStructureProblems(css, label = "styles.css") {
  const problems = []
  const at = offset => `${label}:${lineOf(css, offset)}`

  for (const rule of rules(css)) {
    const selector = rule.selector.trim()
    if (!selector) continue

    // A rule that declares nothing is either a leftover or a splice that took its declarations elsewhere.
    if (!rule.body.trim()) problems.push(`${at(rule.offset)}: \`${selector.replace(/\s+/g, " ").slice(0, 70)}\` declares nothing`)

    const parts = selector.split(",")
    if (parts.some(part => !part.trim())) problems.push(`${at(rule.offset)}: empty selector in the list \`${selector.replace(/\s+/g, " ").slice(0, 70)}\``)

    // The splice signature: prose between the parts of one selector list. A comment belongs above a rule, never
    // inside its selector — and when one lands inside, the selectors above it quietly join the rule below.
    // Read from the blanked text, so commas in the prose above a rule are not mistaken for a selector list.
    const firstComma = rule.selectorBare.indexOf(",")
    if (firstComma >= 0 && rule.selectorRaw.slice(firstComma).includes("/*")) {
      problems.push(`${at(rule.offset)}: a comment sits inside the selector list of \`${parts[0].trim().slice(0, 50)}, …\` — move it above the rule, or the selectors before it belong to this rule`)
    }
  }

  // Tokens of the sheet's own (--io-*) must be defined in it; Obsidian's variables come from the app and are not
  // checked here, but their fallbacks are what keeps the export canvas and the tests honest.
  const used = new Set([...css.matchAll(/var\((--io-[a-z0-9-]+)/g)].map(m => m[1]))
  const defined = new Set([...css.matchAll(/^\s*(--io-[a-z0-9-]+)\s*:/gm)].map(m => m[1]))
  // Set from JS on the app element, not in the sheet.
  for (const runtime of ["--io-bottom-inset", "--io-keyboard-inset"]) used.delete(runtime)
  for (const token of used) if (!defined.has(token)) problems.push(`${label}: \`var(${token})\` is read but never defined`)
  for (const token of defined) if (!used.has(token)) problems.push(`${label}: \`${token}\` is defined but never read`)

  return problems
}
