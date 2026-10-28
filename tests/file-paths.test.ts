import type { Root } from "mdast";
import { describe, expect, it } from "vitest";

import { remarkFilePaths } from "~/lib/files";

// The links remarkFilePaths makes of one line of prose, or of one inline code
// span, as their urls.
function links(value: string, type: "text" | "inlineCode" = "text") {
  const tree: Root = {
    type: "root",
    children: [{ type: "paragraph", children: [{ type, value }] }],
  };
  remarkFilePaths()(tree);
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

  it("carries a path across spaces to its file's extension", () => {
    expect(
      links(
        "~/Dropbox/__inbox/2026-10-27 Tiltify BCRF donation 1 (7.27pm).pdf (donation ID 5986)",
      ),
    ).toEqual([
      "~/Dropbox/__inbox/2026-10-27 Tiltify BCRF donation 1 (7.27pm).pdf",
    ]);
    expect(links("Saved to /tmp/my report.html.")).toEqual([
      "/tmp/my report.html",
    ]);
  });

  it("stops at another path, a sentence's end, or a file already named", () => {
    expect(links("moved /tmp/a to /tmp/b.txt")).toEqual([
      "/tmp/a",
      "/tmp/b.txt",
    ]);
    expect(links("in /tmp/a. Then notes.md")).toEqual(["/tmp/a"]);
    expect(links("wrote /tmp/a.txt and b.md")).toEqual(["/tmp/a.txt"]);
    expect(links("under ~/code/ see x.md")).toEqual(["~/code/"]);
  });

  it("leaves brackets that don't close as prose", () => {
    expect(links("in /tmp/a (see notes.md)")).toEqual(["/tmp/a"]);
  });

  it("links inline code that is a path with spaces", () => {
    expect(
      links("~/Library/Application Support/a b.json", "inlineCode"),
    ).toEqual(["~/Library/Application Support/a b.json"]);
    expect(links("npm run test file.ts", "inlineCode")).toEqual([]);
  });
});
