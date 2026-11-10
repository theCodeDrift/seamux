import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Root } from "mdast";
import { describe, expect, it } from "vitest";

import { remarkFilePaths } from "~/lib/files";
import {
  existingPaths,
  findExistingPaths,
  findRootedLinks,
  projectRoot,
} from "~/lib/files.server";

// The links remarkFilePaths makes of one line of prose, or of one inline code
// span, as their urls, given the paths with spaces the server found.
function links(
  value: string,
  paths: string[] = [],
  type: "text" | "inlineCode" = "text",
) {
  const tree: Root = {
    type: "root",
    children: [{ type: "paragraph", children: [{ type, value }] }],
  };
  remarkFilePaths({ paths })(tree);
  const paragraph = tree.children[0];
  if (paragraph.type !== "paragraph") throw new Error("no paragraph");
  return paragraph.children.flatMap((c) => (c.type === "link" ? [c.url] : []));
}

describe("bare paths", () => {
  it("links a path without spaces as before", () => {
    expect(links("see ~/notes/a.md and ./app/root.tsx:12.")).toEqual([
      "~/notes/a.md",
      "./app/root.tsx:12",
    ]);
  });

  it("carries a path across spaces only to a file the server found", () => {
    const receipt =
      "~/Dropbox/__inbox/2026-10-27 Tiltify BCRF donation 1 (7.27pm).pdf";
    const line = `${receipt} (donation ID 5986)`;
    expect(links(line, [receipt])).toEqual([receipt]);
    expect(links(line)).toEqual(["~/Dropbox/__inbox/2026-10-27"]);
    expect(links("I edited ~/notes and README.md")).toEqual(["~/notes"]);
  });

  it("carries a path across a long title to the end of a sentence", () => {
    const note =
      "./__inbox/2026-11-03 engineers know agents ignore rules while VCs assume agents are flawless.md";
    expect(
      links(`I added that to the capture in ${note}. It now says`, [note]),
    ).toEqual([note]);
  });

  it("carries a path across an apostrophe inside a word", () => {
    const note = "./self/memory/jakob's writing style for documents.md";
    expect(
      links(`I also added your point to ${note}: alliteration is`, [note]),
    ).toEqual([note]);
    expect(links("see ./a/jakob's.md and './b/c.md'")).toEqual([
      "./a/jakob's.md",
      "./b/c.md",
    ]);
  });

  it("takes the longest path the server found", () => {
    expect(
      links("open /tmp/a b.tar c.gz now", [
        "/tmp/a b.tar",
        "/tmp/a b.tar c.gz",
      ]),
    ).toEqual(["/tmp/a b.tar c.gz"]);
  });

  it("links inline code that is a path with spaces the server found", () => {
    const code = "~/Library/Application Support/a b.json";
    expect(links(code, [code], "inlineCode")).toEqual([code]);
    expect(links(code, [], "inlineCode")).toEqual([]);
  });
});

describe("existing paths", () => {
  const dir = mkdtempSync(join(tmpdir(), "seamux-paths-"));
  mkdirSync(join(dir, "in box"));
  writeFileSync(join(dir, "in box", "receipt 1 (7.27pm).pdf"), "");
  writeFileSync(join(dir, "my notes.md"), "");

  it("finds the paths with spaces that are files, as the reply wrote them", async () => {
    const reply = [
      `- **${dir}/in box/receipt 1 (7.27pm).pdf** (donation)`,
      `- ${dir}/in box/receipt 2 (7.34pm).pdf (missing)`,
      "- see `./my notes.md`, and ./my notes.md.",
    ].join("\n");
    expect((await findExistingPaths(reply, dir)).sort()).toEqual(
      [`${dir}/in box/receipt 1 (7.27pm).pdf`, "./my notes.md"].sort(),
    );
  });

  it("looks for what a reply names once", async () => {
    const reply = `${dir}/my notes.md`;
    const first = existingPaths(reply, dir);
    expect(existingPaths(reply, dir)).toBe(first);
    expect(await first).toEqual([reply]);
  });
});

describe("links relative to the project's root", () => {
  const root = mkdtempSync(join(tmpdir(), "seamux-root-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "content", "drafts"), { recursive: true });
  mkdirSync(join(root, "content", "slides"));
  writeFileSync(join(root, "content", "slides", "deck.pdf"), "");
  writeFileSync(join(root, "content", "drafts", "beside.md"), "");
  writeFileSync(join(root, "content", "slides", "my deck.pdf"), "");
  const dir = join(root, "content", "drafts");

  it("finds the project a file is in", async () => {
    expect(await projectRoot(dir)).toBe(root);
    expect(await projectRoot(root)).toBe(root);
  });

  it("resolves against the root only what isn't beside the file", async () => {
    const doc = [
      "The deck: `content/slides/deck.pdf`, or [it](content/slides/deck.pdf).",
      "Beside it: [here](beside.md) and `./beside.md`.",
      "Nowhere: `content/slides/gone.pdf`.",
      "Spaced: `./content/slides/my deck.pdf`.",
    ].join("\n");
    const paths = await findExistingPaths(doc, root);
    expect(paths).toEqual(["./content/slides/my deck.pdf"]);
    expect((await findRootedLinks(doc, dir, root, paths)).sort()).toEqual(
      ["content/slides/deck.pdf", "./content/slides/my deck.pdf"].sort(),
    );
  });
});
