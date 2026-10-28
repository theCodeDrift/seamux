// Links from Claude's replies to files on disk. A reply writes
// `./app/root.tsx` or `/Users/…/README.md`; the board would resolve that
// against its own URL, so it becomes a link to the /file viewer instead.

import type { Link, Nodes, PhrasingContent, Root, Text } from "mdast";

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
// `style.css:12` has the shape of a scheme, but is a path and a line.
const LINE_SUFFIX = /^[^:/]+:\d+(:\d+)?$/;

// `a/./b/../c` as `a/c`, keeping a leading `/` or `~/`.
function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && out.length > 0 && out[out.length - 1] !== "~") {
      out.pop();
    } else {
      out.push(part);
    }
  }
  const joined = out.join("/");
  return path.startsWith("/") ? `/${joined}` : joined;
}

export function dirnameOf(path: string): string {
  return path.replace(/\/[^/]*$/, "") || "/";
}

// The path a link points at, resolved against `base` (the session's
// directory, or the directory of the file being viewed), or null when the
// link is a web URL or an anchor.
export function linkedPath(href: string, base: string): string | null {
  if (href === "" || href.startsWith("#")) return null;
  let path: string;
  if (href.startsWith("file:")) {
    try {
      path = decodeURIComponent(new URL(href).pathname);
    } catch {
      return null;
    }
  } else if (SCHEME.test(href) && !LINE_SUFFIX.test(href)) {
    return null;
  } else {
    path = href.replace(/[?#].*$/, "");
    try {
      path = decodeURIComponent(path);
    } catch {}
  }
  if (path === "") return null;
  if (path.startsWith("/") || path === "~" || path.startsWith("~/")) {
    return normalize(path);
  }
  return normalize(`${base}/${path}`);
}

export type FileView = "raw" | "rendered";

export function fileViewerUrl(path: string, view?: FileView): string {
  const params = new URLSearchParams({ path });
  if (view) params.set("view", view);
  return `/file?${params}`;
}

// The file, to save rather than show.
export function fileDownloadUrl(path: string): string {
  return `/file/download?${new URLSearchParams({ path })}`;
}

// What a rendered HTML page may do, on the viewer's frame and on the bytes'
// own Content-Security-Policy: run scripts, but in an opaque origin, which
// can't read the board, call its actions, or reach this window. Its links
// may still download, such as a report's exported CSV, and open a new tab,
// which leaves the sandbox: Chrome won't show a PDF in a sandboxed tab, and
// every HTML file seamux serves into it arrives sandboxed by its own header.
export const SANDBOX_FLAGS =
  "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-downloads";

// The file's bytes, at a URL whose path mirrors the file's, so that a
// rendered page's relative `style.css` or `img/a.png` resolves beside it.
// `base` is `/file/raw` for the board's own requests, or the viewer's
// sandbox base for a rendered HTML page, whose requests arrive cross-site.
export function fileRawUrl(path: string, base = "/file/raw"): string {
  return `${base}${path.split("/").map(encodeURIComponent).join("/")}`;
}

// A path written without a link around it, in prose or as inline code:
// `./content/post.md`, `~/notes.txt`, `/Users/me/a/b`, or `app/root.tsx:12`.
// A bare relative path needs an extension, so `and/or` stays prose, and an
// absolute one needs two segments, so `/file` does too.
const SEGMENT = String.raw`[\w@%+=~.,-]+`;
const LINE = String.raw`(?::\d+(?::\d+)?)?`;
const BARE_PATH = new RegExp(
  String.raw`^(?:(?:\.{1,2}|~)(?:/${SEGMENT})+/?|(?:/${SEGMENT}){2,}/?|${SEGMENT}(?:/${SEGMENT})*/${SEGMENT}\.[A-Za-z]\w*)${LINE}$`,
);
const TOKEN = /(^|[\s(\[{"'])([^\s()[\]{}<>"'`]+)/g;
const TRAILING = /[.,;:!?]+$/;

// The path a token is, less the punctuation of a path that ends a sentence.
function barePath(token: string): string | null {
  const path = token.replace(TRAILING, "");
  return BARE_PATH.test(path) ? path : null;
}

// A path with spaces in it, such as `~/Dropbox/2026-10-27 Receipt (1).pdf`:
// absolute, from home or relative to `.`, ending in a file's extension, with
// its brackets closed.
const ANCHORED = /^(?:\/|~\/|\.{1,2}\/)/;
const EXTENSION = /\/[^/]*\.[A-Za-z]\w*$/;
function spacedPath(value: string): boolean {
  if (!ANCHORED.test(value) || !EXTENSION.test(value)) return false;
  if (!BARE_PATH.test(value.replace(/[ ()]/g, "_"))) return false;
  let depth = 0;
  for (const c of value) {
    depth += c === "(" ? 1 : c === ")" ? -1 : 0;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// Written bare, a path with spaces ends where its file's extension does, so
// the words after `path` join it up to the nearest extension on the line.
// They never cross another `/` or the end of a sentence, and `path` itself
// must not already be a file or a directory written as one.
const MAX_WORDS = 8;
function spacedTail(path: string, rest: string): string {
  if (!ANCHORED.test(path) || EXTENSION.test(path) || path.endsWith("/")) {
    return path;
  }
  const words = /^ ([^\s/`<>"]+)/;
  let candidate = path;
  let tail = rest;
  for (let i = 0; i < MAX_WORDS; i++) {
    const m = words.exec(tail);
    if (!m) break;
    candidate += ` ${m[1]}`;
    tail = tail.slice(m[0].length);
    const trimmed = candidate.replace(TRAILING, "");
    if (spacedPath(trimmed)) return trimmed;
    if (trimmed !== candidate) break;
  }
  return path;
}

function linkText(text: Text): PhrasingContent[] | null {
  const out: PhrasingContent[] = [];
  let last = 0;
  for (const m of text.value.matchAll(TOKEN)) {
    const start = m.index + m[1].length;
    if (start < last) continue;
    let path = barePath(m[2]);
    if (!path) continue;
    if (path === m[2]) {
      path = spacedTail(path, text.value.slice(start + path.length));
    }
    if (start > last)
      out.push({ type: "text", value: text.value.slice(last, start) });
    out.push({
      type: "link",
      url: path,
      children: [{ type: "text", value: path }],
    });
    last = start + path.length;
  }
  if (last === 0) return null;
  if (last < text.value.length)
    out.push({ type: "text", value: text.value.slice(last) });
  return out;
}

// Links every bare path in a reply, which the renderer then points at the
// /file viewer like any other link to a file.
export function remarkFilePaths() {
  const walk = (node: Nodes) => {
    if (!("children" in node)) return;
    if (node.type === "link" || node.type === "linkReference") return;
    const children: Nodes[] = [];
    for (const child of node.children) {
      if (child.type === "text") {
        children.push(...(linkText(child) ?? [child]));
      } else if (
        child.type === "inlineCode" &&
        (barePath(child.value) === child.value || spacedPath(child.value))
      ) {
        const link: Link = {
          type: "link",
          url: child.value,
          children: [child],
        };
        children.push(link);
      } else {
        walk(child);
        children.push(child);
      }
    }
    (node as { children: Nodes[] }).children = children;
  };
  return (tree: Root) => walk(tree);
}
