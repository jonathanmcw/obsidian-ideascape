import { test } from "node:test";
import assert from "node:assert/strict";

import { nodeTypeOf, setNodeType } from "../src/organiser/model/doc.ts";
import { fromMarkdownMap, toMarkdownMap } from "../src/organiser/model/markdown.ts";

test("node type: canonical choices are exclusive while imported mixed Markdown stays untouched", () => {
  const src = "# R\n\n- [x] ## heading task ^mixed\n1. [x] numbered task ^numbered-task\n- plain ^plain\n";
  const doc = fromMarkdownMap(src, "x");
  assert.equal(nodeTypeOf(doc.nodes.mixed!), "mixed");
  assert.equal(nodeTypeOf(doc.nodes["numbered-task"]!), "mixed");
  assert.equal(toMarkdownMap(doc).includes("- [x] ## heading task ^mixed"), true, "opening does not normalise mixed Markdown");

  const heading = setNodeType(doc, "mixed", "h2");
  assert.equal(nodeTypeOf(heading.nodes.mixed!), "h2");
  assert.equal(heading.nodes.mixed!.task, undefined);
  assert.equal(heading.nodes.mixed!.ordered, undefined);

  const checklist = setNodeType(doc, "numbered-task", "checklist");
  assert.equal(nodeTypeOf(checklist.nodes["numbered-task"]!), "checklist");
  assert.equal(checklist.nodes["numbered-task"]!.task, "x", "an existing completion state survives the explicit conversion");
  assert.equal(checklist.nodes["numbered-task"]!.ordered, undefined);

  const numbered = setNodeType(doc, "plain", "numbered");
  assert.equal(nodeTypeOf(numbered.nodes.plain!), "numbered");
  assert.equal(setNodeType(numbered, "plain", "text").nodes.plain!.ordered, undefined);
  assert.equal(setNodeType(doc, doc.rootId, "checklist"), doc, "the root is never converted to a list type");
});
