// The tour: a map in which every node shows the thing it describes — the bold node is bold, the checkbox is a
// checkbox, the folded node is folded. It is written as the Markdown a map is saved as, so the tour is also the
// file format's first example. No Obsidian import: tests read it directly.
import { MAP_FORMATS } from "./organiser/model/markdown.ts";
import { chord } from "./organiser/ui/keys.ts";

export const TOUR_NAME = "Ideascape tour";

export { chord };

/** The tour as a map note. Branches after the first two open folded, so it fits one screen and folding teaches itself. */
export function tourMarkdown(mac: boolean): string {
  const k = (keys: string) => chord(keys, mac);
  const { key, block } = MAP_FORMATS[0];
  const lines = [
    "---",
    `${key}: tour`,
    "---",
    `# ${TOUR_NAME} ^tour`,
    "",
    "- Make your own map ^make",
    "  - [ ] New map: the ribbon button ^make-new",
    "  - [ ] Any note: right-click › Open as a map ^make-convert",
    `  - Notes with \`${key}:\` open as maps ^make-key`,
    "  - [x] Open the tour ^make-tour",
    "- Build with keys ^build",
    "  - Tab adds a child ^build-tab",
    "  - Enter adds a sibling ^build-enter",
    "  - Just type to replace me ^build-type",
    `  - ${k("⌘E")} edits without replacing ^build-edit`,
    `  - ${k("⇧Enter")} adds`,
    "    a second line ^build-line",
    `  - ${k("⌫")} deletes, ${k("⌘Z")} brings it back ^build-undo`,
    "- Style the words ^style",
    "  - **Bold**, *italic*, <u>underline</u> ^style-inline",
    "  - ~~Strike~~ and ==highlight== ^style-more",
    "  - # Big heading ^style-heading",
    "  - Aligned left,",
    `    with ${k("⇧⌘L")} ^style-align`,
    "  - Numbered steps ^style-steps",
    "    1. Plan ^style-plan",
    "    2. Do ^style-do",
    "  - Drag my edge to widen me ^style-wide",
    "- Connect ideas ^connect",
    `  - Link a note: [[${TOUR_NAME}]] ^connect-link`,
    "  - Tag a node with #idea ^connect-tag",
    `  - Link to one node: [[${TOUR_NAME}#^tour|the centre]] ^connect-block`,
    `  - ${k("⌘C")} a branch, paste it in a note ^connect-copy`,
    "- Organise ^organise",
    `  - Folded: ${k("⌘.")} opens me ^organise-fold`,
    "    - Nothing was deleted ^fold-kept",
    "    - Folding only hides a branch ^fold-hides",
    `    - ${k("⌘.")} folds me again ^fold-again`,
    "  - Drag me onto another node ^organise-drag",
    `  - ${k("⌘↑")} ${k("⌘↓")} moves me ^organise-move`,
    `  - ${k("⌘F")} finds any word ^organise-find`,
    `  - ${k("⌥⌘F")} focuses one branch ^organise-focus`,
    "- See it differently ^see",
    `  - ${k("⌘2")} Outline, ${k("⌘1")} back to Map ^see-outline`,
    `  - ${k("⌘/")} themes and node styles ^see-theme`,
    "  - Toolbar: Free layout, then Tidy ^see-free",
    `  - ${k("⇧⌘0")} fits the whole map ^see-fit`,
    "  - The page icon shows the Markdown ^see-markdown",
    "- [ ] Done? Delete this map. “Take the tour” brings it back ^done",
    "",
    block,
    JSON.stringify({
      v: 1,
      collapsed: ["style", "connect", "organise", "organise-fold", "see"],
      // A node of two lines is centred until told otherwise, so the alignment shown is left.
      align: { "style-align": "left" },
      width: { "style-wide": 300 },
      // The two open branches face each other, so the tour reads as a map from the first look.
      side: { make: -1, style: -1, organise: -1, build: 1, connect: 1, see: 1, done: 1 },
    }),
    "%%",
    "",
  ];
  return lines.join("\n");
}
