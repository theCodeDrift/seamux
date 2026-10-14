// Reads a file on disk for the /file viewer. Read-only, like everything
// else here: nothing in this module writes, moves or deletes.

import { randomBytes } from "node:crypto";
import { createReadStream, type Stats } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, join } from "node:path";
import { Readable } from "node:stream";

import { SANDBOX_FLAGS } from "./files.ts";

// A rendered HTML page runs sandboxed, in an opaque origin, so its own
// stylesheets and scripts arrive as cross-site requests with no Referer:
// indistinguishable from another website's. They are let through by this
// secret in their path instead, which the page's relative URLs inherit and
// no other site can know. A new one each time the server starts.
export const SANDBOX_BASE = `/file/sandbox/${randomBytes(16).toString("hex")}`;

// Beyond this, the viewer shows the start and says so.
const TEXT_LIMIT = 2 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".md": "text/markdown; charset=utf-8",
  ".markdown": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".ogv": "video/ogg",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
};

export type FileKind =
  | "markdown"
  | "html"
  | "image"
  | "video"
  | "audio"
  | "text"
  | "binary";

export type FileEntry =
  | {
      type: "file";
      path: string;
      kind: FileKind;
      size: number;
      text: string | null;
      truncated: boolean;
      mtime: number;
    }
  | { type: "directory"; path: string; entries: DirEntry[]; mtime: number };

export type DirEntry = { name: string; directory: boolean };

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return join(homedir(), path.slice(2));
  return path;
}

async function statOrNull(path: string) {
  try {
    return await stat(path);
  } catch {
    return null;
  }
}

// Replies cite code as `app/root.tsx:12` or `:12:4`. When that isn't a
// file, the path without the line is.
async function resolveLine(
  path: string,
): Promise<{ path: string; stats: Stats } | null> {
  const stats = await statOrNull(path);
  if (stats) return { path, stats };
  const bare = path.replace(/:\d+(:\d+)?$/, "");
  if (bare === path) return null;
  const bareStats = await statOrNull(bare);
  return bareStats ? { path: bare, stats: bareStats } : null;
}

const WORKTREE = /^(.*?)\/(?:\.claude\/)?worktrees\/[^/]+(\/.*)$/;

// A reply resolves its paths against the session's directory, and a
// session in a worktree removes that worktree once its work has landed. A
// path into a worktree that is gone is read from the checkout it was made
// from, where the work now lives.
export async function resolveFile(
  raw: string,
): Promise<{ path: string; stats: Stats } | null> {
  const path = expandHome(raw);
  if (!path.startsWith("/")) return null;
  const found = await resolveLine(path);
  if (found) return found;
  const inWorktree = WORKTREE.exec(path);
  if (!inWorktree) return null;
  const [, checkout, rest] = inWorktree;
  const worktree = path.slice(0, path.length - rest.length);
  if (await statOrNull(worktree)) return null;
  return resolveLine(checkout + rest);
}

export function contentType(path: string, sample: Buffer): string {
  return (
    TYPES[extname(path).toLowerCase()] ??
    (isBinary(sample) ? "application/octet-stream" : "text/plain; charset=utf-8")
  );
}

function isBinary(sample: Buffer): boolean {
  return sample.subarray(0, 8000).includes(0);
}

function kindOf(path: string, sample: Buffer): FileKind {
  const type = contentType(path, sample);
  if (type.startsWith("text/markdown")) return "markdown";
  if (type.startsWith("text/html")) return "html";
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (
    type.startsWith("text/") ||
    type.startsWith("application/json") ||
    !isBinary(sample)
  ) {
    return "text";
  }
  return "binary";
}

// A file's bytes, sandboxed: an HTML file opened from here, framed or not,
// runs in an opaque origin and cannot act as the board. A PDF is the one
// exception, since Chrome refuses to show one in a sandboxed document, with
// ERR_BLOCKED_BY_CLIENT, and its viewer runs no script in the board's
// origin anyway. `download` asks the browser to
// save the file under its own name instead of showing it. `range`, a
// request's Range header, sends just those bytes: a video or audio player
// asks for them to seek, and Safari won't play a video without them.
export async function fileResponse(
  found: { path: string; stats: Stats },
  { download = false, range = null as string | null } = {},
): Promise<Response> {
  const size = found.stats.size;
  const type = contentType(found.path, await readHead(found.path, 8000));
  const headers = new Headers({
    "Content-Type": type,
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  });
  if (type !== "application/pdf") {
    headers.set("Content-Security-Policy", `sandbox ${SANDBOX_FLAGS}`);
  }
  if (download) {
    const name = found.path.split("/").pop() ?? "file";
    headers.set(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
  }
  const span = range === null ? null : byteRange(range, size);
  if (span === "unsatisfiable") {
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }
  if (span) {
    headers.set("Content-Range", `bytes ${span.start}-${span.end}/${size}`);
    headers.set("Content-Length", String(span.end - span.start + 1));
    const body = Readable.toWeb(
      createReadStream(found.path, span),
    ) as ReadableStream;
    return new Response(body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  const body = Readable.toWeb(createReadStream(found.path)) as ReadableStream;
  return new Response(body, { headers });
}

// A Range header's one span, inclusive, within a file of `size` bytes:
// `bytes=0-`, `bytes=100-199` or the last 500, `bytes=-500`. Null for
// anything else, several spans included, which gets the whole file.
export function byteRange(
  header: string,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (m[1] === "") {
    const last = Number(m[2]);
    if (last === 0 || size === 0) return "unsatisfiable";
    return { start: Math.max(0, size - last), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (end < start) return null;
  return { start, end };
}

export async function readHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

export async function loadFile(raw: string): Promise<FileEntry | null> {
  const found = await resolveFile(raw);
  if (!found) return null;
  const { path, stats } = found;
  if (stats.isDirectory()) {
    const dirents = await readdir(path, { withFileTypes: true });
    const entries = dirents
      .map((d) => ({ name: d.name, directory: d.isDirectory() }))
      .sort(
        (a, b) =>
          Number(b.directory) - Number(a.directory) ||
          a.name.localeCompare(b.name),
      );
    return { type: "directory", path, entries, mtime: stats.mtimeMs };
  }
  if (!stats.isFile()) return null;
  const size = stats.size;
  const head = await readHead(path, Math.min(size, TEXT_LIMIT));
  const kind = kindOf(path, head);
  const textual = kind === "markdown" || kind === "html" || kind === "text";
  return {
    type: "file",
    path,
    kind,
    size,
    text: textual ? head.toString("utf8") : null,
    truncated: textual && size > TEXT_LIMIT,
    mtime: stats.mtimeMs,
  };
}

// The directories on disk a partly typed absolute path could go on to name,
// for the directory picker's Tab: /Users/me/code/se lists every directory
// in /Users/me/code whose name starts with "se". Hidden ones only once the
// typed name starts with a dot, as in a shell.
export async function completeDirectory(typed: string): Promise<string[]> {
  if (!typed.startsWith("/")) return [];
  const cut = typed.lastIndexOf("/") + 1;
  const parent = typed.slice(0, cut);
  const stem = typed.slice(cut).toLowerCase();
  const dirents = await readdir(parent, { withFileTypes: true }).catch(
    () => [],
  );
  const names: string[] = [];
  for (const d of dirents) {
    if (!d.name.toLowerCase().startsWith(stem)) continue;
    if (d.name.startsWith(".") && !stem.startsWith(".")) continue;
    // A symlink counts when it leads to a directory.
    const isDir =
      d.isDirectory() ||
      (d.isSymbolicLink() &&
        (await stat(join(parent, d.name)).then(
          (s) => s.isDirectory(),
          () => false,
        )));
    if (isDir) names.push(parent + d.name);
  }
  return names.sort().slice(0, 200);
}
