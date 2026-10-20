// Reading Cursor's agent chats from disk. cmux names each chat's transcript
// but records ~/.cursor as its directory, so where a chat runs and what it
// is called come from Cursor's own meta.json, and whether a turn runs from
// cmux's lifecycle, which the transcript can't say. knowledge/cursor.md has
// what was measured, against Cursor Agent 2026.10.18. Imported by
// harness.server.ts, which scripts/seamux.ts runs under plain Node:
// relative imports with extensions.

import { execFile } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ChatMessage } from "./board.ts";
import { configOrDefaults } from "./config.server.ts";
import {
  addToolCall,
  clip,
  excerpt,
  follow,
  promptExcerpt,
  readTail,
  replyExcerpt,
  userTurn,
} from "./transcript.server.ts";

const run = promisify(execFile);

const CURSOR_DIR = join(homedir(), ".cursor");
const PROJECTS_DIR = join(CURSOR_DIR, "projects");
const CHATS_DIR = join(CURSOR_DIR, "chats");

export interface CursorTranscript {
  path: string;
  mtimeMs: number;
}

const list = (dir: string) => readdir(dir).catch(() => [] as string[]);

// sessionId -> transcript, for every Cursor chat on disk. Transcripts are
// projects/<folder>/agent-transcripts/<id>/<id>.jsonl.
export async function indexCursorTranscripts(): Promise<
  Map<string, CursorTranscript>
> {
  const index = new Map<string, CursorTranscript>();
  await Promise.all(
    (await list(PROJECTS_DIR)).map(async (project) => {
      const dir = join(PROJECTS_DIR, project, "agent-transcripts");
      await Promise.all(
        (await list(dir)).map(async (id) => {
          const path = join(dir, id, `${id}.jsonl`);
          try {
            index.set(id, { path, mtimeMs: (await stat(path)).mtimeMs });
          } catch {}
        }),
      );
    }),
  );
  return index;
}

export interface CursorChat {
  cwd: string | null;
  // What Cursor titled the chat after its first turn, or what /rename set.
  title: string | null;
}

// meta.json by path, read again only once it changes.
const metas = new Map<string, { mtimeMs: number; chat: CursorChat }>();

// sessionId -> where the chat runs and its title, from
// chats/<md5 of the folder>/<id>/meta.json.
export async function cursorChats(): Promise<Map<string, CursorChat>> {
  const chats = new Map<string, CursorChat>();
  await Promise.all(
    (await list(CHATS_DIR)).map(async (folder) => {
      await Promise.all(
        (await list(join(CHATS_DIR, folder))).map(async (id) => {
          const path = join(CHATS_DIR, folder, id, "meta.json");
          try {
            const { mtimeMs } = await stat(path);
            const known = metas.get(path);
            if (known?.mtimeMs === mtimeMs) {
              chats.set(id, known.chat);
              return;
            }
            const o = JSON.parse(await readFile(path, "utf8"));
            const chat = {
              cwd: typeof o.cwd === "string" ? o.cwd : null,
              title: typeof o.title === "string" ? o.title : null,
            };
            metas.set(path, { mtimeMs, chat });
            chats.set(id, chat);
          } catch {}
        }),
      );
    }),
  );
  return chats;
}

// The session id of every Cursor chat resumed from a running process, with
// its pid. cmux keeps a resumed chat's old pid, so this is how it is known
// to run.
export async function runningCursorSessions(): Promise<Map<string, number>> {
  const running = new Map<string, number>();
  try {
    const { stdout } = await run("ps", ["-axo", "pid=,args="], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 5_000,
    });
    for (const line of stdout.split("\n")) {
      const m =
        /^\s*(\d+)\s.*cursor-agent\/versions\/\S+\/index\.js\s.*--resume[\s=]([0-9a-f-]{36})\b/.exec(
          line,
        );
      if (m) running.set(m[2], Number(m[1]));
    }
  } catch {}
  return running;
}

// A prompt as Cursor hands it to the model:
// <timestamp>Monday, Oct 19, 2026, 5:43 PM (UTC-7)</timestamp>
// <user_query>
// …what was typed…
// </user_query>
const QUERY = /<user_query>\n?([\s\S]*?)\n?<\/user_query>/;
const STAMP =
  /<timestamp>[A-Za-z]+, (.+?) \(UTC([+-])(\d{1,2})(?::(\d{2}))?\)<\/timestamp>/;

function promptOf(text: string): { text: string; at: string | null } {
  const query = QUERY.exec(text)?.[1] ?? text;
  const m = STAMP.exec(text);
  let at: string | null = null;
  if (m) {
    const ms = Date.parse(
      `${m[1]} GMT${m[2]}${m[3].padStart(2, "0")}${m[4] ?? "00"}`,
    );
    if (!Number.isNaN(ms)) at = new Date(ms).toISOString();
  }
  return { text: query.trim(), at };
}

function textOf(o: any): string | null {
  const content = o?.message?.content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text as string);
  return parts.length ? parts.join("\n").trim() || null : null;
}

export interface CursorSummary {
  lastPrompt: string | null;
  lastPromptAt: number | null;
  lastReply: string | null;
  // The last reply in full, for a question it ends on.
  finalReply: string | null;
  // Whether the transcript ends on a turn that ended. Unknown until cmux
  // files the chat, a new one's first turn writes no turn_ended until it
  // is over.
  turnEnded: boolean;
}

// Cursor writes a prompt and the replies to it as a turn goes, and
// rewrites its last line, `turn_ended`, as each turn ends. A turn
// interrupted before it wrote anything leaves nothing behind.
export async function summarizeCursor(path: string): Promise<CursorSummary> {
  const s: CursorSummary = {
    lastPrompt: null,
    lastPromptAt: null,
    lastReply: null,
    finalReply: null,
    turnEnded: false,
  };
  const lines = await readTail(path).catch(() => [] as string[]);
  let last = true;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o: any;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (last) s.turnEnded = o.type === "turn_ended";
    last = false;
    const text = textOf(o);
    if (!text) continue;
    if (o.role === "assistant" && s.finalReply == null && !s.lastPrompt) {
      s.finalReply = text;
      s.lastReply = replyExcerpt(text);
    }
    if (o.role === "user") {
      const prompt = promptOf(text);
      s.lastPrompt = promptExcerpt(prompt.text, configOrDefaults().macros);
      s.lastPromptAt = prompt.at ? Date.parse(prompt.at) : null;
      break;
    }
  }
  return s;
}

// The visible conversation, oldest first: prompts, replies, and the tools
// called between them by name.
export async function loadCursorMessages(path: string): Promise<ChatMessage[]> {
  const { macros } = configOrDefaults();
  // A prompt's time stands for the replies to it, which record none.
  let at: string | null = null;
  return follow<ChatMessage[]>(
    path,
    JSON.stringify(macros),
    () => [],
    (messages, line) => {
      let o: any;
      try {
        o = JSON.parse(line);
      } catch {
        return;
      }
      const content = o?.message?.content;
      if (!Array.isArray(content)) return;
      if (o.role === "user") {
        const text = textOf(o);
        if (!text) return;
        const prompt = promptOf(text);
        at = prompt.at;
        if (prompt.text) messages.push(...userTurn(prompt.text, at, macros));
        return;
      }
      if (o.role !== "assistant") return;
      for (const c of content) {
        if (c?.type === "tool_use" && typeof c.name === "string")
          addToolCall(messages, c.name, at);
        if (c?.type === "text" && typeof c.text === "string" && c.text.trim())
          messages.push({ role: "assistant", text: clip(c.text.trim()), at });
      }
    },
  );
}

// An approval as Cursor draws it under a rule, measured on a command
// approval:
//
//  ──────────────────────────
//  $  date +%s > stamp.txt in .
//
//  Run this command?
//  Hook requested approval • Not in allowlist: date
//   → Run (once) (y)
//     Run Everything (shift+tab)
//     Skip & tell the agent what to do instead (esc or n)
//
// `y` approves, Shift+Tab approves and runs every later command unasked,
// and Esc refuses.
export function parseCursorApproval(screen: string): {
  title: string;
  detail: string | null;
  tool: string | null;
  all: string | null;
} | null {
  const lines = screen.split("\n").map((l) => l.trim());
  while (lines.length && !lines.at(-1)) lines.pop();
  if (!/\(esc or n\)$/.test(lines.at(-1) ?? "")) return null;
  let at = lines.length - 1;
  while (at >= 0 && !/\?$/.test(lines[at])) at--;
  if (at < 0) return null;
  let command: string | undefined;
  for (let up = at - 1; up >= 0 && !/^─{8,}$/.test(lines[up]); up--) {
    command ??= /^\$\s+(.+?)(?:\s+in\s+\S+)?$/.exec(lines[up])?.[1];
  }
  let all: string | null = null;
  for (const line of lines.slice(at + 1))
    all ??= /^(\S.*?)\s+\(shift\+tab\)$/.exec(line)?.[1] ?? null;
  return {
    title: lines[at],
    detail: command ? excerpt(command) : null,
    tool: command ? "Shell" : null,
    all,
  };
}
