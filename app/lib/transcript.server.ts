// Reading transcripts, whichever agent wrote them: the tail of a file, a
// whole one followed as it grows, and text cut down for a card.

import { open } from "node:fs/promises";

import type { ChatMessage } from "./board.ts";
import type { Config } from "./config.ts";
import { macroEcho, shownPrompt } from "./macro-echo.ts";

const TAIL_BYTES = 2 * 1024 * 1024;
const EXCERPT_CHARS = 280;
// A card renders its last reply as markdown, clipped to a few lines.
const REPLY_EXCERPT_CHARS = 800;

export async function readTail(path: string): Promise<string[]> {
  const file = await open(path);
  try {
    const { size } = await file.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await file.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    // The first line is partial unless we read from the start.
    return start > 0 ? lines.slice(1) : lines;
  } finally {
    await file.close();
  }
}

// A transcript read from its start, once, then only what was appended since,
// for the whole of a long conversation without parsing hundreds of megabytes
// on every poll. Transcripts only grow; one that shrank, or no longer ends a
// line where the last read stopped, was replaced and is read again. key holds
// whatever else the state was built from, such as the macros a prompt is
// matched against, and a new key reads it again too.
interface Followed {
  key: string;
  offset: number;
  state: unknown;
  reading: Promise<void>;
}
const followed = new Map<string, Followed>();
// The transcripts followed at once, the least recently read let go first.
const FOLLOWED_MAX = 24;

export async function follow<S>(
  path: string,
  key: string,
  init: () => S,
  consume: (state: S, line: string) => void | Promise<void>,
): Promise<S> {
  let f = followed.get(path);
  if (!f || f.key !== key) {
    f = { key, offset: 0, state: init(), reading: Promise.resolve() };
  }
  followed.delete(path);
  followed.set(path, f);
  if (followed.size > FOLLOWED_MAX)
    followed.delete(followed.keys().next().value!);
  // Two polls at once must not both append what was written since.
  const entry = f;
  const read = entry.reading.then(async () => {
    const file = await open(path);
    try {
      const { size } = await file.stat();
      if (entry.offset > 0) {
        const last = Buffer.alloc(1);
        await file.read(last, 0, 1, entry.offset - 1);
        if (size < entry.offset || last[0] !== 0x0a) {
          entry.offset = 0;
          entry.state = init();
        }
      }
      if (size <= entry.offset) return;
      const buf = Buffer.alloc(size - entry.offset);
      await file.read(buf, 0, buf.length, entry.offset);
      // A line still being written waits for the next read.
      const end = buf.lastIndexOf(0x0a) + 1;
      if (end === 0) return;
      try {
        for (const line of buf.toString("utf8", 0, end).split("\n")) {
          if (line) await consume(entry.state as S, line);
        }
      } catch (e) {
        // Half a read consumed is worse than none: start over next time.
        entry.offset = 0;
        entry.state = init();
        throw e;
      }
      entry.offset += end;
    } finally {
      await file.close();
    }
  });
  entry.reading = read.catch(() => {});
  await read;
  return entry.state as S;
}

// Claude Code wraps text pasted into a prompt in
// <pasted_content id="N">…</pasted_content id="N"> for the model. The user sees
// the paste, not the tags.
export function unwrapPasted(text: string): string {
  return text.replace(/<\/?pasted_content(?:\s+id="[^"]*")?>\n?/g, "").trim();
}

export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > EXCERPT_CHARS
    ? `${flat.slice(0, EXCERPT_CHARS - 1)}…`
    : flat;
}

// The end of a reply, where it says what was done or asks what's next, with
// the line breaks its markdown is built on. It starts at a line, and reopens
// a code block it starts inside.
export function replyExcerpt(text: string): string {
  const kept = text
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (kept.length <= REPLY_EXCERPT_CHARS) return kept;
  let tail = kept.slice(-REPLY_EXCERPT_CHARS);
  const line = tail.indexOf("\n");
  if (line >= 0 && line < tail.length - 1) tail = tail.slice(line + 1);
  const fences = (tail.match(/^\s*```/gm) ?? []).length;
  return fences % 2 ? `\`\`\`\n${tail}` : tail;
}

// The last paragraph of a reply that ends on a question, so the chat is
// waiting on the user although no dialog is open. The question need not be
// its last sentence: "Want me to go ahead? Or tell me to stop." still asks.
// Trailing markdown such as bold or a closing quote does not hide the
// question mark, and one inside a URL or code does not count.
export function endingQuestionIn(text: string | null): string | null {
  const trimmed = text?.trim();
  if (!trimmed) return null;
  const last = trimmed.split(/\n\s*\n/).at(-1) ?? trimmed;
  const prose = last.replace(/`[^`]*`/g, "");
  if (!/\?[*_`"')\]]*(?:\s|$)/.test(prose)) return null;
  return excerpt(last.replace(/\*\*|__|`/g, ""));
}

// Messages are cut to this in the chat view.
export const MESSAGE_CHARS = 20_000;

export function clip(text: string): string {
  return text.length > MESSAGE_CHARS
    ? `${text.slice(0, MESSAGE_CHARS)}…`
    : text;
}

// A prompt as a card shows it, a macro seamux sent by its name.
export function promptExcerpt(text: string, macros: Config["macros"]): string {
  return excerpt(shownPrompt(text, macros));
}

// A prompt as the chat shows it: what the user typed, with the name of each
// macro seamux sent it in where the macro's text was.
export function userTurn(
  text: string,
  at: string | null,
  macros: Config["macros"],
): ChatMessage[] {
  const echo = macroEcho(text, macros);
  if (!echo) return [{ role: "user", text: clip(text), at }];
  const turn: ChatMessage[] = echo.macros.map((name) => ({
    role: "macro",
    name,
    at,
  }));
  if (echo.prompt)
    turn.splice(echo.promptAt, 0, {
      role: "user",
      text: clip(echo.prompt),
      at,
    });
  return turn;
}

// A tool call as the chat shows it: one row for a run of calls between a
// reply's words, each tool once, in the order first called, with how many
// times.
export function addToolCall(
  messages: ChatMessage[],
  name: string,
  at: string | null,
): void {
  const last = messages.at(-1);
  if (last?.role !== "tools") {
    messages.push({ role: "tools", calls: [{ name, count: 1 }], at });
    return;
  }
  const call = last.calls.find((c) => c.name === name);
  if (call) call.count++;
  else last.calls.push({ name, count: 1 });
}
