import { test } from "node:test";
import assert from "node:assert/strict";

// No DOM under node --test: just enough of one for the label's round trip — elements, text,
// fragments, dataset and inline style. The editor code only walks and builds nodes.
class FakeNode {
  nodeType = 1;
  childNodes: FakeNode[] = [];
  parentNode: FakeNode | null = null;
  ownerDocument: FakeDocument;
  constructor(doc: FakeDocument) { this.ownerDocument = doc; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(v: string) { this.childNodes = []; if (v) this.appendChild(new FakeText(this.ownerDocument, v)); }
  appendChild(c: FakeNode) {
    const kids = c.nodeType === 11 ? [...c.childNodes] : [c];
    if (c.nodeType === 11) c.childNodes = [];
    for (const k of kids) { k.parentNode?.childNodes.splice(k.parentNode.childNodes.indexOf(k), 1); k.parentNode = this; this.childNodes.push(k); }
    return c;
  }
}
class FakeText extends FakeNode {
  data: string;
  constructor(doc: FakeDocument, d: string) { super(doc); this.nodeType = 3; this.data = d; }
  get textContent() { return this.data; }
  set textContent(v: string) { this.data = v; }
}
class FakeElement extends FakeNode {
  tagName: string;
  dataset: Record<string, string> = {};
  style: Record<string, string> = {};
  className = "";
  attrs: Record<string, string> = {};
  constructor(doc: FakeDocument, tag: string) { super(doc); this.tagName = tag.toUpperCase(); }
  getAttribute(k: string) { return this.attrs[k] ?? null; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
}
class FakeDocument {
  createTextNode(d: string) { return new FakeText(this, d); }
  createElement(t: string) { return new FakeElement(this, t); }
  createDocumentFragment() { const f = new FakeNode(this); f.nodeType = 11; return f; }
  // Obsidian builds through the window the document belongs to.
  win = { createEl: (t: string) => this.createElement(t), createFragment: () => this.createDocumentFragment() };
}
const doc = new FakeDocument();
// The code before this fix read the globals; keeping them lets this file run against it too.
Object.assign(globalThis, { document: doc, Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 }, HTMLElement: FakeElement });

const { renderInto, domToMarkdown, fragmentFor } = await import("../src/organiser/ui/wysiwyg.ts");
const { parseInline } = await import("../src/organiser/model/inline.ts");

type Kid = FakeNode | string;
const el = (tag: string, ...kids: Kid[]) => {
  const e = doc.createElement(tag);
  for (const k of kids) e.appendChild(typeof k === "string" ? doc.createTextNode(k) : k);
  return e;
};
const label = (...kids: Kid[]) => el("span", ...kids);
const md = (l: FakeElement) => domToMarkdown(l as unknown as HTMLElement);
const roundTrip = (text: string) => {
  const l = label();
  renderInto(l as unknown as HTMLElement, text);
  return md(l);
};
/** Plain text and styles, as the label and the map both show them: [styles, text] per stretch. */
const look = (text: string) => {
  const r = parseInline(text);
  const runs: [string, string][] = [];
  for (const x of r.runs) {
    const key = `${x.b ? "b" : ""}${x.i ? "i" : ""}${x.u ? "u" : ""}${x.s ? "s" : ""}${x.mark ? "m" : ""}${x.code ? "c" : ""}${x.href != null ? `>${x.href}` : ""}`;
    const t = r.plain.slice(x.start, x.end);
    const prev = runs[runs.length - 1];
    if (prev && prev[0] === key) prev[1] += t;
    else runs.push([key, t]);
  }
  return { plain: r.plain, runs };
};

test("wysiwyg: opening and leaving a node gives back its text byte for byte", () => {
  const corpus = [
    "x = 5",
    "2 * 3 = 6",
    "a < b",
    "~3 days",
    "C:\\temp",
    "C:\\Users\\ana\\notes",
    "$E=mc^2$",
    "Energy $E=mc^2$ and $a*b$",
    "$$x_1 * x_2$$ and $y$",
    "Line<br>break",
    'Line<br>break and <span style="color:red">red</span>',
    "[[Lisbon]]",
    "[[Trip#^a2|Lisbon]] and [[Plan]]",
    "[t](u)",
    "[web](https://example.com/a_b)",
    "snake_case_name",
    "**b** *i*",
    "**ab*cd*** *ef*",
    "_emphasis_ and __strong__",
    "`a`b`",
    "`` a`b ``",
    "a \\*literal\\* star",
    "\\[[Lisbon]] and x \\= 5",
    "**Bold** and [[Note]]",
    "price ==> high",
    "cost ~ 5 == 5",
    "[^1] footnote and #tag",
    "==hi== ~~no~~ <u>u</u> `x`",
    "咖啡店：**先做外賣**",
    "Plan a small trip",
    "two\nlines",
    "[[Note|Note]] and [[ Note ]] and [](https://a.b)",
    "![[doc.pdf]] read this",
    "``x`` and \\$5",
  ];
  for (const text of corpus) {
    assert.equal(roundTrip(text), text, JSON.stringify(text));
    // Typing elsewhere in the node keeps every construct as it was written.
    const l = label();
    renderInto(l as unknown as HTMLElement, text);
    l.appendChild(doc.createTextNode(" z"));
    assert.equal(md(l), text + " z", `${JSON.stringify(text)} after typing`);
  }
});

test("wysiwyg: typing inside math, an escape or a link writes what the label now shows", () => {
  const edited = (text: string, change: (t: FakeText) => void) => {
    const l = label();
    renderInto(l as unknown as HTMLElement, text);
    const texts = (n: FakeNode): FakeText[] => (n.nodeType === 3 ? [n as FakeText] : n.childNodes.flatMap(texts));
    change(texts(l)[1]!);
    return md(l);
  };
  assert.equal(edited("Energy $E=mc^2$", (t) => (t.data = "$E=mc^3$")), "Energy $E=mc^3$");
  assert.equal(edited("x \\= 5", (t) => (t.data = "=!")), "x =! 5");
  assert.equal(edited("See [[Lisbon|the city]] soon", (t) => (t.data = "the town")), "See [[Lisbon|the town]] soon");
});

test("wysiwyg: a wikilink with no address ([[|alias]]) is written back as it was, never as a link to its text", () => {
  const texts = (n: FakeNode): FakeText[] => (n.nodeType === 3 ? [n as FakeText] : n.childNodes.flatMap(texts));
  for (const text of ["a [[|alias]] b", "[[ |alias]] and [[Plan]]"]) {
    assert.equal(roundTrip(text), text);
    // Typing elsewhere in the node.
    const l = label();
    renderInto(l as unknown as HTMLElement, text);
    l.appendChild(doc.createTextNode(" z"));
    assert.equal(md(l), text + " z");
  }
  // Typing inside the alias keeps the link's (empty) address.
  const l = label();
  renderInto(l as unknown as HTMLElement, "[[|alias]] x");
  const t = texts(l).find((x) => x.data.includes("alias"))!;
  t.data = t.data.replace("alias", "aliases");
  assert.equal(md(l), "[[|aliases]] x");
});

test("wysiwyg: text typed into the label is kept as typed, and shown the same when read back", () => {
  for (const typed of ["See [[Lisbon]]", "a **bold** word", "x = 5", "a *b* c", "<u>not underlined</u>", "\\* star", "`tick`", "==not==", "a\\b", "!![[x.png]]", "$5 and $6"]) {
    const out = md(label(typed));
    assert.deepEqual(look(out), { plain: typed, runs: [["", typed]] }, `${JSON.stringify(typed)} → ${JSON.stringify(out)}`);
    assert.equal(parseInline(out).embeds.length, 0);
  }
  // Only what would otherwise parse is escaped.
  assert.equal(md(label("x = 5 and 2 * 3")), "x = 5 and 2 * 3");
  assert.equal(md(label("See [[Lisbon]]")), "See \\[[Lisbon]]");
});

test("wysiwyg: bold then italic across overlapping text keeps both", () => {
  // Bold on "abcd", then italic on "cdef": the DOM nests the overlap inside the bold.
  const out = md(label(el("b", "ab", el("i", "cd")), el("i", "ef")));
  assert.deepEqual(look(out).runs, [["b", "ab"], ["bi", "cd"], ["i", "ef"]], out);
  const out2 = md(label(el("i", "ab", el("b", "cd")), el("b", "ef")));
  assert.deepEqual(look(out2).runs, [["i", "ab"], ["bi", "cd"], ["b", "ef"]], out2);
  const out3 = md(label(el("s", "ab", el("mark", "cd")), el("mark", "ef")));
  assert.deepEqual(look(out3).runs, [["s", "ab"], ["sm", "cd"], ["m", "ef"]], out3);
});

test("wysiwyg: code with backticks, and empty formatting, leave no residue", () => {
  const code = md(label("run ", el("code", "a`b"), " now"));
  assert.deepEqual(look(code).runs, [["", "run "], ["c", "a`b"], ["", " now"]], code);
  assert.equal(md(label("x", el("u"), el("b"), el("code"), "y")), "xy");
  assert.equal(md(label(el("b", "a"), el("b", "b"))), "**ab**");
});

test("wysiwyg: pasted Markdown arrives as what it means", () => {
  for (const text of ["See [[Lisbon]]", "[text](https://a.b)", "a **bold** word", "x \\= 5", "$a*b$ and _it_"]) {
    const l = label("Before: ");
    l.appendChild(fragmentFor(doc as unknown as Document, parseInline(text)) as unknown as FakeNode);
    assert.equal(md(l), "Before: " + text);
  }
});


// ⌘A and F2 select the label's own contents through a Range, not the document's `selectAll` command. The stub is
// only what selectAllIn touches: the focused label, and the selection its document hands out.
test("wysiwyg: selecting all in a label takes the label's contents, and nothing when the caret left it", async () => {
  const { selectAllIn } = await import("../src/organiser/ui/format.ts");
  const made: { selected: unknown[]; cleared: number; added: unknown[] } = { selected: [], cleared: 0, added: [] };
  const range = { selectNodeContents: (n: unknown) => made.selected.push(n) };
  const selection = { removeAllRanges: () => made.cleared++, addRange: (r: unknown) => made.added.push(r) };
  const owner = { createRange: () => range, defaultView: { getSelection: () => selection } };
  const labelEl = { nodeType: 1, classList: { contains: (n: string) => n === "node-label" }, isContentEditable: true, ownerDocument: owner };

  assert.equal(selectAllIn({ activeElement: labelEl } as unknown as Document), true);
  assert.deepEqual(made.selected, [labelEl], "the range covers the label itself, never the document");
  assert.equal(made.cleared, 1);
  assert.deepEqual(made.added, [range]);

  // Focus on a toolbar button rather than the label: nothing is selected, where `selectAll` would have taken the view.
  const button = { nodeType: 1, classList: { contains: () => false }, isContentEditable: false, ownerDocument: owner };
  assert.equal(selectAllIn({ activeElement: button } as unknown as Document), false);
  assert.equal(made.cleared, 1, "a selection outside a label is left alone");
});

// Putting a highlight, a code span or a link on turns the space beside it into U+00A0, which is the browser
// holding its own rendering still rather than a character anyone typed. The file must never be given one.
test("wysiwyg: a non-breaking space the browser wrote is read back as the space it stands for", () => {
  assert.equal(md(label("keep ", el("mark", "this"), " safe")), "keep ==this== safe");
  assert.equal(md(label("a b")), "a b");
  // Inside a code span too, where the text is written between backticks exactly as it reads.
  assert.equal(md(label(el("code", "npm test"))), "`npm test`");
});
