// Reading Codex sessions from disk. Codex has no `claude agents --json`, and
// cmux's lifecycle for it goes stale, so everything a card says about a
// Codex session comes from its transcript. knowledge/codex.md has what was
// measured, against codex-cli 0.156.1. Imported by drive.server.ts, which
// scripts/seamux.ts runs under plain Node: relative imports with extensions.

import { appendFile, open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { ChatMessage, ContextUsage } from "./board.ts";
import { configOrDefaults } from "./config.server.ts";
import {
  addToolCall,
  clip,
  endingQuestionIn,
  excerpt,
  follow,
  promptExcerpt,
  readTail,
  replyExcerpt,
  userTurn,
} from "./transcript.server.ts";

const CODEX_DIR = process.env.CODEX_HOME ?? join(homedir(), ".codex");
const SESSIONS_DIR = join(CODEX_DIR, "sessions");
const SESSION_INDEX = join(CODEX_DIR, "session_index.jsonl");

export interface CodexTranscript {
  path: string;
  mtimeMs: number;
}

// Transcripts are sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl.
const ROLLOUT =
  /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/;

// sessionId -> transcript, for every Codex session on disk.
export async function indexCodexTranscripts(): Promise<
  Map<string, CodexTranscript>
> {
  const index = new Map<string, CodexTranscript>();
  const list = (dir: string) => readdir(dir).catch(() => [] as string[]);
  for (const year of await list(SESSIONS_DIR)) {
    for (const month of await list(join(SESSIONS_DIR, year))) {
      for (const day of await list(join(SESSIONS_DIR, year, month))) {
        const dir = join(SESSIONS_DIR, year, month, day);
        await Promise.all(
          (await list(dir)).map(async (f) => {
            const id = ROLLOUT.exec(f)?.[1];
            if (!id) return;
            const path = join(dir, f);
            try {
              index.set(id, { path, mtimeMs: (await stat(path)).mtimeMs });
            } catch {}
          }),
        );
      }
    }
  }
  return index;
}

// Codex also writes a transcript for every headless run, `codex exec` and
// the summaries cmux names workspaces with among them. Only the TUI's are
// chats. The first line says which; it never changes, so it is remembered.
const interactive = new Map<string, boolean>();

export async function isChatTranscript(path: string): Promise<boolean> {
  const known = interactive.get(path);
  if (known !== undefined) return known;
  let head = "";
  try {
    const file = await open(path);
    try {
      const buf = Buffer.alloc(8192);
      const { bytesRead } = await file.read(buf, 0, buf.length, 0);
      head = buf.toString("utf8", 0, bytesRead);
    } finally {
      await file.close();
    }
  } catch {
    return false;
  }
  const originator = /"originator"\s*:\s*"([^"]+)"/.exec(head)?.[1];
  // Not written yet: ask again next time.
  if (!originator) return false;
  const chat = originator === "codex-tui";
  interactive.set(path, chat);
  return chat;
}

// A session's name: what Codex titled it, or what `/rename` set. Each is
// a line in the session index, and the last one for a session wins.
let names: { mtimeMs: number; map: Map<string, string> } | null = null;

export async function codexNames(): Promise<Map<string, string>> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(SESSION_INDEX)).mtimeMs;
  } catch {
    return new Map();
  }
  if (names?.mtimeMs === mtimeMs) return names.map;
  const map = new Map<string, string>();
  for (const line of (await readFile(SESSION_INDEX, "utf8")).split("\n")) {
    try {
      const o = JSON.parse(line);
      if (typeof o.id === "string" && typeof o.thread_name === "string")
        map.set(o.id, o.thread_name);
    } catch {}
  }
  names = { mtimeMs, map };
  return map;
}

// Renaming a closed session the way `/rename` does: one more index line.
// It adds to the index and changes nothing already in it.
export async function renameCodexSession(sessionId: string, name: string) {
  await appendFile(
    SESSION_INDEX,
    JSON.stringify({
      id: sessionId,
      thread_name: name,
      updated_at: new Date().toISOString(),
    }) + "\n",
  );
}

export interface CodexSummary {
  cwd: string | null;
  lastPrompt: string | null;
  lastPromptAt: number | null;
  lastReply: string | null;
  // Whether a turn is in progress: its task_started with no task_complete
  // or turn_aborted after it. null when the tail holds neither.
  turnActive: boolean | null;
  // The tool call a running turn is on, with no output yet. An approval
  // dialog belongs to it.
  pendingTool: { id: string; name: string; input: any } | null;
  question: string | null;
  context: ContextUsage | null;
}

const CALLS = new Set([
  "custom_tool_call",
  "function_call",
  "local_shell_call",
]);
const OUTPUTS = new Set([
  "custom_tool_call_output",
  "function_call_output",
  "local_shell_call_output",
]);

function itemText(item: any): string | null {
  if (!Array.isArray(item?.content)) return null;
  const parts = item.content
    .filter((c: any) => typeof c?.text === "string")
    .map((c: any) => c.text as string);
  return parts.length ? parts.join("\n") : null;
}

export async function summarizeCodex(path: string): Promise<CodexSummary> {
  const s: CodexSummary = {
    cwd: null,
    lastPrompt: null,
    lastPromptAt: null,
    lastReply: null,
    turnActive: null,
    pendingTool: null,
    question: null,
    context: null,
  };
  // Walking back from the end, a call's output comes before the call.
  const answered = new Set<string>();
  let finalReply: string | null = null;
  const lines = await readTail(path);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o: any;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    const p = o.payload ?? {};
    if (!s.cwd && (o.type === "turn_context" || o.type === "session_meta"))
      s.cwd = typeof p.cwd === "string" ? p.cwd : null;
    if (o.type === "event_msg") {
      if (s.turnActive == null) {
        if (p.type === "task_started") s.turnActive = true;
        if (p.type === "task_complete" || p.type === "turn_aborted")
          s.turnActive = false;
      }
      if (!s.context && p.type === "token_count" && p.info) {
        const u = p.info.last_token_usage;
        const window = p.info.model_context_window;
        if (u && typeof window === "number")
          s.context = {
            used: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
            window,
          };
      }
      if (p.type === "item_completed") {
        const item = p.item;
        const text = itemText(item)?.trim();
        if (text && item?.type === "UserMessage" && !s.lastPrompt) {
          s.lastPrompt = promptExcerpt(text, configOrDefaults().macros);
          s.lastPromptAt = Date.parse(o.timestamp) || null;
        }
        if (text && item?.type === "AgentMessage") {
          if (!s.lastReply) s.lastReply = replyExcerpt(text);
          if (finalReply == null && item.phase === "final_answer")
            finalReply = text;
        }
      }
    }
    if (o.type === "response_item" && s.turnActive == null) {
      if (OUTPUTS.has(p.type) && p.call_id) answered.add(p.call_id);
      if (CALLS.has(p.type) && !s.pendingTool && !answered.has(p.call_id))
        s.pendingTool = {
          id: p.call_id ?? p.id,
          name: p.name ?? p.type,
          input: p.input ?? p.arguments ?? p.action ?? null,
        };
    }
    if (
      s.cwd &&
      s.lastPrompt &&
      s.lastReply &&
      s.turnActive != null &&
      s.context
    )
      break;
  }
  if (!s.turnActive) s.pendingTool = null;
  else s.question = null;
  if (s.turnActive === false) s.question = endingQuestionIn(finalReply);
  return s;
}

// The visible conversation, oldest first: prompts, replies, and the tools
// called between them by name, without the context Codex injects.
export async function loadCodexMessages(path: string): Promise<ChatMessage[]> {
  const { macros } = configOrDefaults();
  return follow<ChatMessage[]>(
    path,
    JSON.stringify(macros),
    () => [],
    (messages, line) => consumeCodexLine(messages, line, macros),
  );
}

const CODEX_TOOL_CALL = new Set(["function_call", "custom_tool_call"]);

function consumeCodexLine(
  messages: ChatMessage[],
  line: string,
  macros: ReturnType<typeof configOrDefaults>["macros"],
): void {
  if (!line.includes('"item_completed"') && !line.includes('_call"')) return;
  let o: any;
  try {
    o = JSON.parse(line);
  } catch {
    return;
  }
  const at = o.timestamp ?? null;
  if (
    o.type === "response_item" &&
    CODEX_TOOL_CALL.has(o.payload?.type) &&
    typeof o.payload.name === "string"
  ) {
    addToolCall(messages, o.payload.name, at);
    return;
  }
  if (o.payload?.type !== "item_completed") return;
  const item = o.payload.item;
  const role =
    item?.type === "UserMessage"
      ? "user"
      : item?.type === "AgentMessage"
        ? "assistant"
        : null;
  const text = itemText(item)?.trim();
  if (!role || !text) return;
  if (role === "user") messages.push(...userTurn(text, at, macros));
  else messages.push({ role, text: clip(text), at });
}

// An approval as Codex draws it, measured on a command approval:
//
//   Would you like to run the following command?
//   ...
//   $ curl -sI https://example.com
// › 1. Yes, proceed (y)
//   2. Yes, and don't ask again for commands that start with ... (p)
//   3. No, and tell Codex what to do differently (esc)
//   Press enter to confirm or esc to cancel
//
// `y` approves and Esc refuses, whatever the options in between.
export function parseCodexApproval(
  screen: string,
): { title: string; detail: string | null } | null {
  const lines = screen.split("\n").map((l) => l.trim());
  while (lines.length && !lines.at(-1)) lines.pop();
  if (!/Press enter to confirm or esc to cancel/.test(lines.at(-1) ?? ""))
    return null;
  let at = lines.length - 1;
  while (at >= 0 && !/^Would you like to /.test(lines[at])) at--;
  if (at < 0) return null;
  const command = lines
    .slice(at + 1)
    .find((l) => l.startsWith("$ "))
    ?.slice(2);
  return { title: lines[at], detail: command ? excerpt(command) : null };
}
