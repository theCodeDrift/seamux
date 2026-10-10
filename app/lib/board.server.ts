// Derives the board from the running tools. Nothing here writes anywhere:
// Claude Code's session state comes from `claude agents --json`, Codex's
// from cmux and its transcripts (codex.server.ts), and card content from
// the transcripts on disk. If this ever disagrees with the tools, the tools
// win.

import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { shortenAttachments } from "./attachments";
import {
  ASKED_IN_REPLY,
  DONE_VISIBLE_MS,
  FANOUT_VISIBLE_MS,
  SUBAGENT_STALE_MS,
  SUBAGENT_VISIBLE_MS,
  type BackgroundSession,
  type Board,
  type CmuxTrouble,
  type Card,
  type ChatMessage,
  type Column,
  type ApiError,
  type ContextUsage,
  type DispatchSet,
  type Question,
  type Subagent,
  type Waiting,
} from "./board";
import {
  indexCodexTranscripts,
  codexNames,
  isChatTranscript,
  loadCodexMessages,
  summarizeCodex,
  type CodexSummary,
  type CodexTranscript,
} from "./codex.server";
import { ENGINES, type Engine } from "./config";
import { configOrDefaults } from "./config.server";
import {
  closingState,
  listLive,
  readCodexApproval,
  readDialog,
  readDraft,
  type LiveSession,
  type Surface,
} from "./drive.server";
import { cmuxAppRunning, cmuxRpc, cmuxTrouble } from "./cmux.server";
import {
  IS_CHECKOUT,
  PACKAGE_ROOT,
  packageVersion,
  SEAMUX_HOME,
} from "./paths.server";
import { dispatchStatus, listDispatches, type Alive } from "./protocol.server";
import { serviceNotices } from "./service.server";
import {
  clip,
  endingQuestionIn,
  excerpt,
  MESSAGE_CHARS,
  readTail,
  promptExcerpt,
  replyExcerpt,
  unwrapPasted,
  userTurn,
} from "./transcript.server";
import {
  dispatchesFor,
  carryPin,
  notePinProcess,
  pins,
  queuedFor,
  recentDispatchCwds,
  setPinned,
  subagentsFor,
  type PinRow,
  type SubagentRow,
} from "./store.server";
import { failureFor } from "./send-failures.server";

const run = promisify(execFile);
const CLAUDE_DIR = join(homedir(), ".claude");

interface AgentRow {
  sessionId: string;
  kind: "interactive" | "background";
  cwd: string;
  name: string;
  startedAt: number;
  id?: string;
  pid?: number;
  // "waiting" when a dialog is open, with `waitingFor` saying which kind.
  status?: "busy" | "idle" | "waiting";
  waitingFor?: string;
  state?: "working" | "blocked" | "done" | "failed";
}

interface Transcript {
  path: string;
  mtimeMs: number;
}

interface TranscriptSummary {
  name: string | null;
  cwd: string | null;
  branch: string | null;
  lastPrompt: string | null;
  // When the user sent it. null when it lies beyond the tail read.
  lastPromptAt: number | null;
  lastReply: string | null;
  // From the last message: is a turn in progress? null when unknown.
  turnActive: boolean | null;
  // The tool call the last message is waiting on, if any.
  pendingTool: { id: string; name: string; input: any } | null;
  // The question the last message ended the turn on, if it did.
  question: string | null;
  // How full the context window is, from the last response's usage.
  context: ContextUsage | null;
  // Prompts the user typed while a turn ran, not yet taken up by the chat.
  queued: string[];
  // The error the last message is, when the API answered with one.
  apiError: ApiError | null;
}

async function readJson<T>(cmd: string, args: string[]): Promise<T> {
  const { stdout } = await run(cmd, args, {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10_000,
  });
  return JSON.parse(stdout) as T;
}

async function listAgents(): Promise<AgentRow[]> {
  return readJson<AgentRow[]>("claude", ["agents", "--json", "--all"]);
}

// The ids, names or session ids that a running `claude attach` names.
// `claude agents` reports a background session the same whether or not a
// terminal is attached, so the attach process is the only sign of one.
async function attachedTo(): Promise<Set<string>> {
  const { stdout } = await run("ps", ["-axo", "command="], {
    maxBuffer: 8 * 1024 * 1024,
    timeout: 5_000,
  });
  const ids = new Set<string>();
  for (const line of stdout.split("\n")) {
    const m = /(?:^|\/)claude attach (\S+)/.exec(line);
    if (m) ids.add(m[1]);
  }
  return ids;
}

interface Workspace {
  id: string;
  ref: string;
  cwd: string;
}

// Every cmux workspace, for the card's workspace ref. Its needs-input
// signal is not read: it stays set after the dialog is answered, and
// `claude agents` reports waiting itself.
async function cmuxWorkspaces(): Promise<Workspace[]> {
  const { workspaces } = await cmuxRpc<{
    workspaces: { id: string; ref: string; current_directory: string }[];
  }>("workspace.list");
  return workspaces.map((w) => ({
    id: w.id,
    ref: w.ref,
    cwd: w.current_directory,
  }));
}

async function backgroundDetail(
  shortId: string,
): Promise<{ needs: string | null }> {
  try {
    const file = await open(join(CLAUDE_DIR, "jobs", shortId, "state.json"));
    try {
      const state = JSON.parse(await file.readFile("utf8"));
      return { needs: state.needs ?? null };
    } finally {
      await file.close();
    }
  } catch {
    return { needs: null };
  }
}

// sessionId -> transcript file, across every project.
async function indexTranscripts(): Promise<Map<string, Transcript>> {
  const root = join(CLAUDE_DIR, "projects");
  const index = new Map<string, Transcript>();
  // None yet: Claude Code has never run here, or only Codex has.
  const projects = await readdir(root).catch(() => [] as string[]);
  for (const project of projects) {
    let files: string[];
    try {
      files = await readdir(join(root, project));
    } catch {
      continue;
    }
    await Promise.all(
      files
        .filter((f) => f.endsWith(".jsonl"))
        .map(async (f) => {
          const path = join(root, project, f);
          const { mtimeMs } = await stat(path);
          index.set(f.slice(0, -".jsonl".length), { path, mtimeMs });
        }),
    );
  }
  return index;
}

function textOf(content: unknown): string | null {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return null;
  const parts = content
    .filter((c) => c?.type === "text" && typeof c.text === "string")
    .map((c) => c.text as string);
  return parts.length ? parts.join("\n") : null;
}

// Harness-generated user turns (slash commands, caveats, reminders,
// compaction summaries).
const SYNTHETIC_PROMPT =
  /^(<(local-command|command-|system-reminder|bash-|task-notification)|This session is being continued from a previous conversation|\[Request interrupted)/;

// A prompt command, such as a skill, as the user typed it: Claude Code logs
// `/name args` as <command-message> first, then <command-name> and
// <command-args>. A local command, such as /rename, starts with
// <command-name> and stays out of the chat.
function promptCommand(text: string): string | null {
  if (!text.startsWith("<command-message>")) return null;
  const name = tagged(text, "command-name")?.trim();
  if (!name) return null;
  const args = tagged(text, "command-args")?.trim();
  return args ? `${name} ${args}` : name;
}

// A prompt the user sent while a turn ran, such as a queued message sent
// now: Claude Code takes it at the turn's next step and logs it as a
// queued_command attachment, never as a user message.
function midTurnPrompt(o: any): string | null {
  const a = o.type === "attachment" ? o.attachment : null;
  if (a?.type !== "queued_command" || a.origin?.kind !== "human") return null;
  return textOf(a.prompt);
}

// What the harness queues for the chat on its own: background task and
// subagent hand-backs. The rest of the queue is prompts the user typed.
const HARNESS_QUEUED = /^<(task-notification|agent-message)[\s>]/;

// Claude Code logs its input queue as it changes. Replaying the log gives
// what is still queued. A dequeue takes a typed prompt ahead of harness
// items, and a remove names the item it drops.
function queuedPrompts(lines: string[]): string[] {
  let queue: string[] = [];
  for (const line of lines) {
    if (!line.includes('"queue-operation"')) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.type !== "queue-operation") continue;
    const content = typeof o.content === "string" ? o.content : "";
    if (o.operation === "enqueue") queue.push(content);
    else if (o.operation === "popAll") queue = [];
    else if (o.operation === "dequeue") {
      const typed = queue.findIndex((c) => !HARNESS_QUEUED.test(c));
      queue.splice(typed >= 0 ? typed : 0, 1);
    } else if (o.operation === "remove") {
      const at = queue.indexOf(content);
      if (at >= 0) queue.splice(at, 1);
    }
  }
  return queue.filter((c) => !HARNESS_QUEUED.test(c));
}

// Messages are written once complete, so the last one says whether the model
// still owes a response. This is the check on `status: busy`, which Claude
// Code also sets while internal helper agents run between turns.
function turnActive(o: any): boolean {
  if (o.type === "assistant") return o.message?.stop_reason === "tool_use";
  if (o.isMeta || o.isCompactSummary) return false;
  const content = o.message?.content;
  if (Array.isArray(content) && content.some((c) => c?.type === "tool_result"))
    return true;
  const text = (textOf(content) ?? "").trimStart();
  if (text.startsWith("[Request interrupted")) return false;
  // A skill or prompt command: its expansion follows as a meta message, and
  // the model answers it. Local commands such as /model start <command-name>.
  if (text.startsWith("<command-message>")) return true;
  // A task notification wakes the model; other harness turns do not.
  if (text.startsWith("<task-notification")) return true;
  return !SYNTHETIC_PROMPT.test(text);
}

// A subagent's result reaches the model first as an <agent-message> hand-back,
// which the model answers. Since Claude Code 2.1.285 the task notification for
// the same run is logged after that answer without waking the model, so it
// settles nothing. True when the line at `at` is such a notification: a
// hand-back from its task sits between it and that task's last notification.
function notificationHandedBack(lines: string[], at: number, o: any): boolean {
  const text = (textOf(o.message?.content) ?? "").trimStart();
  if (!text.startsWith("<task-notification")) return false;
  const id = /<task-id>([^<]+)<\/task-id>/.exec(text)?.[1];
  if (!id) return false;
  for (let i = at - 1; i >= 0; i--) {
    if (!lines[i]?.includes(id)) continue;
    let p: any;
    try {
      p = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (p.type !== "user" || p.isSidechain) continue;
    const prior = textOf(p.message?.content) ?? "";
    if (prior.includes(`<agent-message from="${id}"`)) return true;
    if (prior.trimStart().startsWith("<task-notification")) return false;
  }
  return false;
}

// The last tool call in an assistant message that stopped to run tools. When
// the session is waiting, its dialog belongs to this call.
function pendingTool(o: any): TranscriptSummary["pendingTool"] {
  if (o.type !== "assistant" || o.message?.stop_reason !== "tool_use")
    return null;
  const content = o.message?.content;
  if (!Array.isArray(content)) return null;
  const call = content.filter((c: any) => c?.type === "tool_use").at(-1);
  return call
    ? { id: call.id, name: call.name, input: call.input ?? {} }
    : null;
}

// A reply that ended the turn on a question.
function endingQuestion(o: any): string | null {
  if (o.type !== "assistant" || o.message?.stop_reason !== "end_turn")
    return null;
  return endingQuestionIn(textOf(o.message?.content));
}

// Transcripts record the model but not its window: a 1M session is logged
// as plain `claude-opus-5`. Opus runs with 1M here; anything else is taken
// at 200k until a response shows it holding more.
const WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

// What the next request would send: everything this response read, plus
// what it wrote.
function contextUsage(o: any): ContextUsage | null {
  const m = o.message;
  const u = m?.usage;
  if (!u || m.model === "<synthetic>") return null;
  const used =
    (u.input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.output_tokens ?? 0);
  const large = /opus/.test(m.model ?? "") || used > WINDOW;
  return { used, window: large ? LARGE_WINDOW : WINDOW };
}

// Claude Code writes an API failure as an assistant message of its own,
// such as "Login expired · Please run /login".
function apiErrorOf(o: any): ApiError | null {
  if (o.type !== "assistant" || !o.isApiErrorMessage) return null;
  return {
    kind: o.error ?? "unknown",
    text: textOf(o.message?.content) ?? "",
    at: Date.parse(o.timestamp) || 0,
  };
}

async function summarize(path: string): Promise<TranscriptSummary> {
  const { macros } = configOrDefaults();
  const summary: TranscriptSummary = {
    name: null,
    cwd: null,
    branch: null,
    lastPrompt: null,
    lastPromptAt: null,
    lastReply: null,
    turnActive: null,
    pendingTool: null,
    question: null,
    context: null,
    queued: [],
    apiError: null,
  };
  // Settled by the last response, or by a compaction after it, which leaves
  // the window's size unknown until the next response.
  let contextKnown = false;
  const lines = await readTail(path);
  summary.queued = queuedPrompts(lines);
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i]) continue;
    let o: any;
    try {
      o = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (o.type === "custom-title" && !summary.name)
      summary.name = o.customTitle;
    if (o.type === "agent-name" && !summary.name) summary.name = o.agentName;
    if (o.cwd && !summary.cwd) summary.cwd = o.cwd;
    if (o.gitBranch && !summary.branch) summary.branch = o.gitBranch;
    // Meta messages ride along with the message before them, such as a
    // prompt command's expansion, so that one settles the turn.
    if (
      summary.turnActive == null &&
      (o.type === "user" || o.type === "assistant") &&
      !o.isSidechain &&
      !o.isMeta &&
      !notificationHandedBack(lines, i, o)
    ) {
      summary.turnActive = turnActive(o);
      summary.pendingTool = pendingTool(o);
      summary.question = endingQuestion(o);
      summary.apiError = apiErrorOf(o);
    }
    if (!contextKnown && !o.isSidechain) {
      if (o.isCompactSummary) contextKnown = true;
      else if (o.type === "assistant") {
        summary.context = contextUsage(o);
        contextKnown = summary.context != null;
      }
    }
    if (o.isSidechain || o.isMeta || o.isCompactSummary) continue;

    const midTurn = midTurnPrompt(o);
    const text = midTurn ?? textOf(o.message?.content);
    if (!text) continue;
    if (o.type === "assistant" && !summary.lastReply) {
      summary.lastReply = replyExcerpt(text);
    }
    const command = o.type === "user" ? promptCommand(text.trimStart()) : null;
    if (
      (o.type === "user" || midTurn) &&
      !summary.lastPrompt &&
      (command || !SYNTHETIC_PROMPT.test(text.trimStart()))
    ) {
      summary.lastPrompt = promptExcerpt(
        command ?? unwrapPasted(text),
        macros,
      );
      summary.lastPromptAt = Date.parse(o.timestamp) || null;
    }
    if (
      summary.lastPrompt &&
      summary.lastReply &&
      summary.turnActive != null &&
      contextKnown &&
      summary.cwd &&
      summary.branch
    )
      break;
  }
  return summary;
}

// The visible conversation, oldest first: what the user and the agent said to
// each other, without tool traffic, sidechains, or harness turns.
// What resuming or renaming a closed chat needs, read server-side from its
// transcript. null when the session is still live, since resuming would run
// a second process on the same conversation.
export async function closedSession(sessionId: string): Promise<{
  cwd: string;
  name: string;
  transcript: string;
  engine: Engine;
} | null> {
  const [agents, live] = await Promise.all([
    listAgents(),
    listLive().catch(() => new Map<string, LiveSession>()),
  ]);
  if (agents.some((a) => a.sessionId === sessionId) || live.has(sessionId))
    return null;
  const found = await findTranscript(sessionId);
  if (!found) return null;
  const info = await infoFrom(sessionId, found);
  return info ? { ...info, transcript: found.path } : null;
}

// A session's directory, name and engine, live or not, from its transcript.
export async function sessionInfo(
  sessionId: string,
): Promise<{ cwd: string; name: string; engine: Engine } | null> {
  const found = await findTranscript(sessionId);
  return found ? infoFrom(sessionId, found) : null;
}

// How each harness's transcripts are found and read.
interface TranscriptReader {
  // sessionId -> its transcript, across every project.
  index: () => Promise<Map<string, Transcript>>;
  // Where the chat ran and what it is called, null without a directory.
  info: (
    sessionId: string,
    path: string,
  ) => Promise<{ cwd: string; name: string | null } | null>;
  // The visible conversation, oldest first.
  messages: (path: string) => Promise<ChatMessage[]>;
}

const READERS: Record<Engine, TranscriptReader> = {
  claude: {
    index: indexTranscripts,
    info: async (_id, path) => {
      const s = await summarize(path);
      return s.cwd ? { cwd: s.cwd, name: s.name } : null;
    },
    messages: loadClaudeMessages,
  },
  // Codex keeps names apart from transcripts, in its session index.
  codex: {
    index: indexCodexTranscripts,
    info: async (id, path) => {
      const [s, names] = await Promise.all([
        summarizeCodex(path),
        codexNames(),
      ]);
      return s.cwd ? { cwd: s.cwd, name: names.get(id) ?? null } : null;
    },
    messages: loadCodexMessages,
  },
};

// Each harness's transcripts in turn, in the order ENGINES lists them.
async function findTranscript(
  sessionId: string,
): Promise<(Transcript & { engine: Engine }) | null> {
  for (const engine of ENGINES) {
    const found = (await READERS[engine].index()).get(sessionId);
    if (found) return { ...found, engine };
  }
  return null;
}

async function infoFrom(
  sessionId: string,
  transcript: Transcript & { engine: Engine },
) {
  const info = await READERS[transcript.engine].info(
    sessionId,
    transcript.path,
  );
  return info
    ? {
        cwd: info.cwd,
        name: info.name ?? sessionId.slice(0, 8),
        engine: transcript.engine,
      }
    : null;
}

export async function loadMessages(
  sessionId: string,
  limit = 60,
): Promise<ChatMessage[] | null> {
  const transcript = await findTranscript(sessionId);
  if (!transcript) return null;
  return (await READERS[transcript.engine].messages(transcript.path)).slice(
    -limit,
  );
}

async function loadClaudeMessages(path: string): Promise<ChatMessage[]> {
  const messages: ChatMessage[] = [];
  const { macros } = configOrDefaults();
  for (const line of await readTail(path)) {
    if (!line) continue;
    let o: any;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o.isSidechain) continue;
    const midTurn = midTurnPrompt(o)?.trim();
    if (midTurn) {
      messages.push(
        ...userTurn(unwrapPasted(midTurn), o.timestamp ?? null, macros),
      );
      continue;
    }
    if (o.type !== "user" && o.type !== "assistant") continue;
    if (o.isMeta || o.isCompactSummary) continue;
    const text = textOf(o.message?.content)?.trim();
    if (!text) continue;
    if (o.type === "user" && text.startsWith("<bash-input>")) {
      messages.push({
        role: "shell",
        command: clip((tagged(text, "bash-input") ?? "").trim()),
        output: null,
        at: o.timestamp ?? null,
      });
      continue;
    }
    if (o.type === "user" && text.startsWith("<bash-stdout>")) {
      const ran = messages.at(-1);
      if (ran?.role === "shell" && ran.output === null)
        ran.output = await shellOutput(text);
      continue;
    }
    const command = o.type === "user" ? promptCommand(text) : null;
    if (o.type === "user" && !command && SYNTHETIC_PROMPT.test(text)) continue;
    const at = o.timestamp ?? null;
    if (o.type === "user")
      messages.push(...userTurn(command ?? unwrapPasted(text), at, macros));
    else messages.push({ role: o.type, text: clip(text), at });
  }
  return messages;
}

function tagged(text: string, tag: string): string | null {
  const m = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(text);
  return m ? m[1] : null;
}

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g;

// A `!` command that outlives Claude Code's timeout moves to the
// background, and the transcript records only where its output goes. That
// output is what the user needs, such as a login's URL and code, so it is
// read from the file, which Claude Code keeps under its tasks directory.
const BACKGROUNDED =
  /moved to the background \(ID: \w+\)\. Output is being written to: (\/\S+\/tasks\/[\w-]+\.output)/;

async function shellOutput(text: string): Promise<string> {
  const stdout = tagged(text, "bash-stdout") ?? "";
  const stderr = tagged(text, "bash-stderr") ?? "";
  let output = [stdout, stderr].filter((s) => s.trim()).join("\n");
  const file = BACKGROUNDED.exec(stdout)?.[1];
  if (file) {
    const written = await readFile(file, "utf8").catch(() => null);
    if (written?.trim())
      output = `${output}\n\n${written.slice(-MESSAGE_CHARS)}`;
  }
  return clip(output.replace(ANSI, "").trim());
}

// Claude Code keeps each subagent's transcript and metadata next to the
// parent's: <parent>/<session-id>/subagents/agent-<id>.{jsonl,meta.json}.
async function toSubagent(
  row: SubagentRow,
  parentTranscript: string | undefined,
  now: number,
): Promise<Subagent> {
  let description: string | null = null;
  let quietSince: number | null = null;
  if (parentTranscript) {
    const base = join(
      dirname(parentTranscript),
      row.session_id,
      "subagents",
      `agent-${row.agent_id}`,
    );
    try {
      const meta = JSON.parse(await readFile(`${base}.meta.json`, "utf8"));
      description = meta.description ?? null;
    } catch {}
    try {
      quietSince = (await stat(`${base}.jsonl`)).mtimeMs;
    } catch {}
  }
  const running = row.stopped_at == null;
  const lastWrite = quietSince ?? row.started_at ?? 0;
  return {
    agentId: row.agent_id,
    type: row.agent_type,
    description,
    running,
    stale: running && now - lastWrite > SUBAGENT_STALE_MS,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    lastMessage: row.last_message ? excerpt(row.last_message) : null,
  };
}

async function toBackground(row: AgentRow): Promise<BackgroundSession> {
  const shortId = row.id ?? row.sessionId.slice(0, 8);
  const { needs } = await backgroundDetail(shortId);
  return { id: shortId, name: row.name, state: row.state ?? "unknown", needs };
}

// The questions of an open AskUserQuestion call, or null when the input is
// not the shape the board knows how to answer.
function questionsOf(input: any): Question[] | null {
  if (!Array.isArray(input?.questions) || input.questions.length === 0)
    return null;
  const questions: Question[] = [];
  for (const q of input.questions) {
    if (typeof q?.question !== "string" || !Array.isArray(q.options))
      return null;
    // Options are picked by digit, so at most nine, less "Type something".
    if (q.options.length === 0 || q.options.length > 8) return null;
    questions.push({
      question: q.question,
      header: typeof q.header === "string" ? q.header : null,
      multiSelect: q.multiSelect === true,
      options: q.options.map((o: any) => ({
        label: String(o?.label ?? ""),
        description: typeof o?.description === "string" ? o.description : null,
        preview: typeof o?.preview === "string" ? o.preview : null,
      })),
    });
  }
  return questions;
}

// What a waiting tool call is about, in one line.
function toolDetail(input: any): string | null {
  const v =
    input?.command ?? input?.file_path ?? input?.url ?? input?.description;
  if (typeof v === "string") return excerpt(v);
  const json = JSON.stringify(input ?? {});
  return json === "{}" ? null : excerpt(json);
}

function waitingOn(
  row: AgentRow,
  summary: TranscriptSummary | null,
  needs: string | null,
): Waiting | null {
  // A background session says itself when its reply left it blocked on
  // the user, whether or not the reply ends on a question mark.
  const blocked = row.state === "blocked";
  if (row.status === "idle" && (summary?.question || blocked)) {
    return {
      reason: ASKED_IN_REPLY,
      tool: null,
      detail: (blocked ? needs : null) ?? summary?.question ?? null,
      ask: null,
      approval: null,
      dialog: null,
    };
  }
  if (row.status !== "waiting") return null;
  const tool = summary?.pendingTool ?? null;
  const questions =
    tool?.name === "AskUserQuestion" ? questionsOf(tool.input) : null;
  return {
    reason: row.waitingFor ?? null,
    tool: tool?.name ?? null,
    detail: tool && !questions ? toolDetail(tool.input) : null,
    ask: tool && questions ? { toolUseId: tool.id, questions } : null,
    approval:
      tool && !questions && row.waitingFor === "permission prompt"
        ? { toolUseId: tool.id }
        : null,
    dialog: null,
  };
}

// Busy only counts when the transcript agrees a turn is running.
function turnRunning(row: AgentRow, turnActive: boolean | null): boolean {
  return row.status === "busy" && turnActive !== false;
}

function liveColumn(
  busy: boolean,
  needsInput: boolean,
  background: BackgroundSession[],
  subagents: Subagent[],
): Column {
  // A blocked child needs the user just as much as a blocked parent. A failed
  // one is over: it shows on the card but asks nothing of the user.
  const childNeedsHuman = background.some((b) => b.state === "blocked");
  if (needsInput || childNeedsHuman) return "waiting";
  // A parent at rest while its subagents run is still working.
  if (busy || subagents.some((s) => s.running && !s.stale)) return "working";
  return "idle";
}

// A pin lasts as long as its chat. `/clear` carries a chat on under a new
// session id in the same Claude Code process, so a pin whose chat closed
// moves, in its place, to the live chat in that process; any other closed
// chat's pin goes. Without cmux a live Codex chat looks closed, so pins wait
// for a poll that has it. Returns the pins left, in order.
function settlePins(
  agents: AgentRow[],
  closed: (id: string) => boolean,
  liveKnown: boolean,
): PinRow[] {
  const processKey = (pid: number, startedAt: number) => `${pid}:${startedAt}`;
  const inProcess = new Map(
    agents
      .filter((a) => a.kind === "interactive" && a.pid != null)
      .map((a) => [processKey(a.pid!, a.startedAt), a.sessionId]),
  );
  const rows = pins();
  let changed = false;
  for (const pin of rows) {
    const row = agents.find((a) => a.sessionId === pin.sessionId);
    if (row?.pid != null) {
      notePinProcess(pin.sessionId, row.pid, row.startedAt);
    } else if (liveKnown && closed(pin.sessionId)) {
      const next =
        pin.pid != null && pin.startedAt != null
          ? inProcess.get(processKey(pin.pid, pin.startedAt))
          : undefined;
      if (next) carryPin(pin.sessionId, next);
      else setPinned(pin.sessionId, false);
      changed = true;
    }
  }
  return changed ? pins() : rows;
}

export async function loadBoard(now = Date.now()): Promise<Board> {
  const warnings: string[] = [];
  // Why seamux can't reach cmux at all, which the board explains in place of
  // the warnings below.
  let cmux: CmuxTrouble | null = null;
  // Whether `claude agents` and the attached-terminal check answered: without
  // them, chats can be missing from the board while they still run.
  let agentsKnown = true;

  const [agents, attached, workspaces, transcripts, codexTranscripts, names] =
    await Promise.all([
      // No Claude Code installed is a board of Codex sessions, not an error.
      listAgents().catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT") {
          agentsKnown = false;
          warnings.push(`Claude Code sessions unknown: ${err.message}`);
        }
        return [] as AgentRow[];
      }),
      attachedTo().catch((err) => {
        agentsKnown = false;
        warnings.push(`Attached sessions unknown: ${err.message}`);
        return null;
      }),
      cmuxWorkspaces().catch((err) => {
        cmux ??= cmuxTrouble(err);
        if (!cmux) {
          warnings.push(
            `cmux unavailable, workspace refs missing: ${err.message}`,
          );
        }
        return [] as Workspace[];
      }),
      indexTranscripts(),
      indexCodexTranscripts(),
      codexNames().catch(() => new Map<string, string>()),
    ]);
  let liveKnown = true;
  const live = await listLive().catch((err) => {
    liveKnown = false;
    cmux = cmuxTrouble(err) ?? cmux;
    if (!cmux) {
      warnings.push(
        `cmux sessions unavailable, replies disabled: ${err.message}`,
      );
    }
    return new Map<string, LiveSession>();
  });
  // Set in the callbacks above, which TypeScript doesn't follow.
  let trouble = cmux as CmuxTrouble | null;
  if (trouble === "not_running" && (await cmuxAppRunning().catch(() => false)))
    trouble = "socket_off";
  // Read for the chats `claude agents` lists, whose ids no other harness's
  // session shares.
  const surfaces = new Map([...live].map(([id, l]) => [id, l.surface]));

  // A background session attached to a terminal is a chat the user is in, so
  // it gets a card like any interactive session. Once the terminal closes it
  // keeps running, with a live `status`, but it is a background job again.
  // Without `ps`, a live `status` is the best guess.
  const isAttached = (a: AgentRow) =>
    attached
      ? [a.id, a.name, a.sessionId].some((k) => k != null && attached.has(k))
      : a.status != null;
  const isChat = (a: AgentRow) =>
    a.kind === "interactive" || (a.status != null && isAttached(a));
  const interactive = agents.filter(isChat);
  const backgroundRows = agents.filter((a) => !isChat(a));
  const background = await Promise.all(backgroundRows.map(toBackground));

  // Background sessions carry no parent id, so attach them to the live
  // chats in the same directory that started before them: a chat cannot
  // have spawned a session older than itself. The rest are orphans.
  const parentOf = (parent: AgentRow, child: AgentRow) =>
    parent.cwd === child.cwd && parent.startedAt <= child.startedAt;
  const childrenOf = (parent: AgentRow) =>
    background.filter((_, i) => parentOf(parent, backgroundRows[i]));
  const orphans: Board["orphans"] = [];
  backgroundRows.forEach((row, i) => {
    if (!interactive.some((p) => parentOf(p, row))) {
      orphans.push({
        ...background[i],
        cwd: row.cwd,
        sessionId: row.sessionId,
      });
    }
  });

  let subagentRows: SubagentRow[] = [];
  try {
    subagentRows = subagentsFor(
      interactive.map((a) => a.sessionId),
      now - SUBAGENT_VISIBLE_MS,
    );
  } catch (err) {
    warnings.push(`Subagent store unavailable: ${(err as Error).message}`);
  }

  const liveCards = await Promise.all(
    interactive.map(async (row): Promise<Card> => {
      const transcript = transcripts.get(row.sessionId);
      const summary = transcript ? await summarize(transcript.path) : null;
      // The session's own workspace when cmux hosts it; otherwise the one
      // open in the same directory.
      const surface = surfaces.get(row.sessionId);
      const ws = surface
        ? workspaces.find((w) => w.id === surface.workspaceId)
        : workspaces.find((w) => w.cwd === row.cwd);
      const children = childrenOf(row);
      const subagents = await Promise.all(
        subagentRows
          .filter((s) => s.session_id === row.sessionId)
          .map((s) => toSubagent(s, transcript?.path, now)),
      );
      const busy = turnRunning(row, summary?.turnActive ?? null);
      const needs =
        row.state === "blocked"
          ? (await backgroundDetail(row.id ?? row.sessionId.slice(0, 8))).needs
          : null;
      const waiting = waitingOn(row, summary, needs);
      // A dialog with nothing in the transcript behind it can only be read
      // off the screen. So can a tool's own confirmation, such as the
      // Artifact tool's "Permanently delete …?": No, then Yes, with no
      // numbers, so Approve's digit does nothing there and the card offers
      // the dialog's own options instead.
      if (waiting && surface && !waiting.ask) {
        const dialog = await readDialog(surface).catch(() => null);
        if (!waiting.approval) waiting.dialog = dialog;
        else if (dialog && dialog.cursor !== null) {
          waiting.dialog = dialog;
          waiting.approval = null;
        }
      }
      // At rest, the chat's prompt box may hold a message never sent.
      const atRest =
        !busy && (waiting === null || waiting.reason === ASKED_IN_REPLY);
      const unsentDraft =
        atRest && surface
          ? await readDraft(row.sessionId, surface, "claude").catch(() => null)
          : null;
      return {
        sessionId: row.sessionId,
        engine: "claude",
        name: row.name,
        cwd: row.cwd,
        column: liveColumn(busy, waiting != null, children, subagents),
        branch: summary?.branch ?? null,
        lastActivityAt: transcript?.mtimeMs ?? null,
        lastPrompt: summary?.lastPrompt ?? null,
        lastPromptAt: summary?.lastPromptAt ?? null,
        lastReply: summary?.lastReply ?? null,
        context: summary?.context ?? null,
        terminalQueue: summary?.queued ?? [],
        unsentDraft,
        sendFailure: failureFor(row.sessionId),
        boardQueue: [],
        workspaceRef: ws?.ref ?? null,
        intent: null,
        forkedFrom: null,
        worker: null,
        fanouts: [],
        drivable: surfaces.has(row.sessionId),
        turnRunning: busy,
        pinned: false,
        clearedFrom: null,
        waiting,
        apiError: summary?.apiError ?? null,
        closing: closingState(row.sessionId, {
          lastPrompt: summary?.lastPrompt ?? null,
        }),
        background: children,
        subagents,
      };
    }),
  );

  // Where each harness's live chats come from: Claude Code's from `claude
  // agents`, above, and the others' from cmux, one card per live session.
  const fromCmux: Record<
    Engine,
    ((sessionId: string, l: LiveSession) => Promise<Card>) | null
  > = {
    claude: null,
    codex: (sessionId, l) =>
      codexCard(
        sessionId,
        l,
        codexTranscripts.get(sessionId),
        names,
        workspaces,
      ),
  };
  const cmuxCards = await Promise.all(
    [...live].flatMap(([sessionId, l]) => {
      const card = fromCmux[l.engine];
      return card ? [card(sessionId, l)] : [];
    }),
  );
  liveCards.push(...cmuxCards);

  // A chat is closed once it is no longer live and is not a background job.
  // A chat moved to the background keeps its first transcript under the
  // job's short id while the job runs on under a new session id; that
  // transcript is the same conversation, not a closed chat.
  const known = new Set([...agents.map((a) => a.sessionId), ...live.keys()]);
  const jobIds = new Set(agents.map((a) => a.id).filter((id) => id != null));
  const closed = (id: string) => !known.has(id) && !jobIds.has(id.slice(0, 8));

  // In the order the user dragged them into.
  let pinRows: PinRow[] = [];
  try {
    pinRows = settlePins(agents, closed, liveKnown);
  } catch (err) {
    warnings.push(`Pin store unavailable: ${(err as Error).message}`);
  }
  const pinned = new Set(pinRows.map((p) => p.sessionId));

  // DONE: a chat the user closed recently, its transcript written within the
  // window.
  const shown = (id: string, t: { mtimeMs: number }) =>
    closed(id) && now - t.mtimeMs < DONE_VISIBLE_MS;
  const recent = [...transcripts.entries()].filter(([id, t]) => shown(id, t));
  const recentCodex = (
    await Promise.all(
      [...codexTranscripts.entries()]
        .filter(([id, t]) => shown(id, t))
        .map(async (e) => ((await isChatTranscript(e[1].path)) ? e : null)),
    )
  ).filter((e) => e != null);
  const doneCards = await Promise.all(
    recent.map(async ([sessionId, t]): Promise<Card> => {
      const s = await summarize(t.path);
      return {
        sessionId,
        engine: "claude",
        name: s.name ?? sessionId.slice(0, 8),
        cwd: s.cwd ?? "",
        column: "done",
        branch: s.branch,
        lastActivityAt: t.mtimeMs,
        lastPrompt: s.lastPrompt,
        lastPromptAt: s.lastPromptAt,
        lastReply: s.lastReply,
        context: s.context,
        terminalQueue: [],
        unsentDraft: null,
        sendFailure: null,
        boardQueue: [],
        workspaceRef: null,
        intent: null,
        forkedFrom: null,
        worker: null,
        fanouts: [],
        drivable: false,
        turnRunning: false,
        pinned: false,
        clearedFrom: null,
        waiting: null,
        apiError: null,
        closing: null,
        background: [],
        subagents: [],
      };
    }),
  );

  const codexDone = await Promise.all(
    recentCodex.map(async ([sessionId, t]) => {
      const s = await summarizeCodex(t.path);
      return {
        ...codexFields(sessionId, s, t, names),
        column: "done" as const,
        branch: await branchOf(s.cwd),
        turnRunning: false,
        waiting: null,
      };
    }),
  );

  const cards = [...liveCards, ...doneCards, ...codexDone];
  for (const card of cards) {
    card.pinned = pinned.has(card.sessionId);
    card.clearedFrom =
      pinRows.find((p) => p.sessionId === card.sessionId)?.clearedFrom ??
      null;
  }
  try {
    for (const row of queuedFor(cards.map((c) => c.sessionId))) {
      cards
        .find((c) => c.sessionId === row.session_id)
        ?.boardQueue.push({
          id: row.id,
          text: row.text,
          queuedAt: row.queued_at,
        });
    }
  } catch (err) {
    warnings.push(`Queue store unavailable: ${(err as Error).message}`);
  }
  try {
    const intents = new Map(
      dispatchesFor(cards.map((c) => c.sessionId)).map((d) => [
        d.session_id,
        d,
      ]),
    );
    for (const card of cards) {
      const d = intents.get(card.sessionId);
      if (d) {
        card.intent = excerpt(shortenAttachments(d.prompt));
        card.forkedFrom = d.forked_from;
        if (d.dispatch_id && d.worker) {
          card.worker = { dispatchId: d.dispatch_id, key: d.worker };
        }
      }
    }
  } catch (err) {
    warnings.push(`Dispatch store unavailable: ${(err as Error).message}`);
  }
  // Oldest prompt first, so the card the user last turned to is at the bottom
  // of its column. Only the user sends a prompt, so a working card keeps its
  // place while its turn writes to the transcript. Pinned cards keep the
  // order the user dragged them into instead.
  cards.sort((a, b) => (a.lastPromptAt ?? 0) - (b.lastPromptAt ?? 0));
  const pinRank = new Map(pinRows.map((p, i) => [p.sessionId, i]));
  const rank = (c: Card) => pinRank.get(c.sessionId) ?? pinRows.length;
  cards.sort((a, b) => rank(a) - rank(b));
  // Without both sources, a worker missing from them may still run.
  const alive: Alive = agentsKnown && liveKnown ? (id) => !closed(id) : null;
  const lastWrite = (id: string) =>
    (transcripts.get(id) ?? codexTranscripts.get(id))?.mtimeMs ?? null;
  const dispatches = loadDispatchSets(now, alive, lastWrite, warnings);
  for (const card of cards) {
    card.fanouts = dispatches.filter(
      (d) => d.parentSessionId === card.sessionId,
    );
  }
  return {
    generatedAt: now,
    version: await servedVersion(),
    cards,
    dispatches,
    orphans,
    attention: await serviceNotices(cards, now).catch((err) => {
      warnings.push(`Service status unavailable: ${err.message}`);
      return [];
    }),
    warnings,
    sessionsKnown: agentsKnown && liveKnown && trouble === null,
    cmux: trouble && {
      trouble,
      start:
        IS_CHECKOUT && PACKAGE_ROOT
          ? `cd ${PACKAGE_ROOT} && npm run seamux`
          : "npx seamux",
      home: SEAMUX_HOME,
    },
  };
}

// What a Codex card shares whether it is live or closed.
function codexFields(
  sessionId: string,
  s: CodexSummary,
  t: CodexTranscript | undefined,
  names: Map<string, string>,
): Omit<Card, "column" | "branch" | "turnRunning" | "waiting"> {
  return {
    sessionId,
    engine: "codex",
    name: names.get(sessionId) ?? sessionId.slice(0, 8),
    cwd: s.cwd ?? "",
    lastActivityAt: t?.mtimeMs ?? null,
    lastPrompt: s.lastPrompt,
    lastPromptAt: s.lastPromptAt,
    lastReply: s.lastReply,
    context: s.context,
    terminalQueue: [],
    unsentDraft: null,
    sendFailure: failureFor(sessionId),
    boardQueue: [],
    workspaceRef: null,
    intent: null,
    forkedFrom: null,
    worker: null,
    fanouts: [],
    drivable: false,
    pinned: false,
    clearedFrom: null,
    // Codex records no API errors the board reads.
    apiError: null,
    closing: null,
    background: [],
    subagents: [],
  };
}

// A live Codex session. cmux's lifecycle for it goes stale, so the
// transcript says whether a turn runs, and an approval, which nothing
// records, is read off the screen while a tool call waits on its output.
async function codexCard(
  sessionId: string,
  live: LiveSession,
  indexed: CodexTranscript | undefined,
  names: Map<string, string>,
  workspaces: Workspace[],
): Promise<Card> {
  let t = indexed;
  if (live.transcript && !t) {
    try {
      t = {
        path: live.transcript,
        mtimeMs: (await stat(live.transcript)).mtimeMs,
      };
    } catch {}
  }
  const s: CodexSummary = t
    ? await summarizeCodex(t.path)
    : {
        cwd: live.cwd,
        lastPrompt: null,
        lastPromptAt: null,
        lastReply: null,
        turnActive: null,
        pendingTool: null,
        question: null,
        context: null,
      };
  s.cwd ??= live.cwd;
  let waiting: Waiting | null = null;
  if (s.question) {
    waiting = {
      reason: ASKED_IN_REPLY,
      tool: null,
      detail: s.question,
      ask: null,
      approval: null,
      dialog: null,
    };
  } else if (s.pendingTool) {
    const approval = await readCodexApproval(live.surface).catch(() => null);
    if (approval) {
      waiting = {
        reason: "permission prompt",
        tool: s.pendingTool.name,
        detail: approval.detail,
        ask: null,
        approval: { toolUseId: s.pendingTool.id },
        dialog: null,
      };
    }
  }
  const busy = s.turnActive === true;
  return {
    ...codexFields(sessionId, s, t, names),
    column: waiting ? "waiting" : busy ? "working" : "idle",
    branch: await branchOf(s.cwd),
    workspaceRef:
      workspaces.find((w) => w.id === live.surface.workspaceId)?.ref ?? null,
    drivable: true,
    turnRunning: busy,
    waiting,
    closing: closingState(sessionId, { lastPrompt: s.lastPrompt }),
  };
}

// Codex's transcript records the branch only when the session starts, at
// the head of a file only its tail is read from, so ask git.
async function branchOf(cwd: string | null): Promise<string | null> {
  if (!cwd) return null;
  try {
    const { stdout } = await run(
      "git",
      ["-C", cwd, "branch", "--show-current"],
      { timeout: 5_000 },
    );
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

// The commit a checkout serves, or an installed package's version.
async function servedVersion(): Promise<Board["version"]> {
  if (!IS_CHECKOUT || !PACKAGE_ROOT) {
    const version = packageVersion();
    return version ? { hash: `v${version}`, subject: "" } : null;
  }
  try {
    const { stdout } = await run(
      "git",
      ["-C", PACKAGE_ROOT, "log", "-1", "--format=%h %s"],
      { timeout: 5_000 },
    );
    const [hash, ...subject] = stdout.trim().split(" ");
    return hash ? { hash, subject: subject.join(" ") } : null;
  } catch {
    return null;
  }
}

// The folders people keep their code in. A missing one is skipped.
const REPO_ROOTS = [
  "code",
  "Code",
  "dev",
  "Developer",
  "git",
  "projects",
  "Projects",
  "repos",
  "src",
  "work",
].map((d) => join(homedir(), d));

// Git repos up to two levels under each root, e.g. ~/code/seamux and
// ~/code/acme/api.
async function gitRepos(): Promise<string[]> {
  const found: string[] = [];
  async function scan(dir: string, depth: number) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === ".git")) found.push(dir);
    if (depth === 0) return;
    await Promise.all(
      entries
        .filter(
          (e) =>
            e.isDirectory() &&
            !e.name.startsWith(".") &&
            e.name !== "node_modules",
        )
        .map((e) => scan(join(dir, e.name), depth - 1)),
    );
  }
  await Promise.all(REPO_ROOTS.map((r) => scan(r, 2)));
  return found;
}

// Where new work is likely to go: directories in use right now first, then
// past dispatches, then every repo on disk.
export async function knownDirectories(): Promise<string[]> {
  const [agents, workspaces, repos] = await Promise.all([
    listAgents().catch(() => [] as AgentRow[]),
    cmuxWorkspaces().catch(() => [] as Workspace[]),
    gitRepos(),
  ]);
  let dispatched: string[] = [];
  try {
    dispatched = recentDispatchCwds();
  } catch {}
  const all = [
    ...agents.map((a) => a.cwd),
    ...workspaces.map((w) => w.cwd),
    ...dispatched,
    ...repos.sort(),
  ];
  return [...new Set(all)];
}

// Fan-outs still waiting on workers, and settled ones for FANOUT_VISIBLE_MS.
// A set settles once every worker has reported or its session has ended; a
// worker that ended goes at its transcript's last write, as its DONE card
// does.
function loadDispatchSets(
  now: number,
  alive: Alive,
  lastWrite: (sessionId: string) => number | null,
  warnings: string[],
): DispatchSet[] {
  const sets: DispatchSet[] = [];
  for (const id of listDispatches()) {
    try {
      const s = dispatchStatus(id, alive, now);
      const m = s.manifest;
      const endedAt = (w: (typeof m.workers)[number]) =>
        s.markers[w.key]?.at ??
        (w.sessionId ? lastWrite(w.sessionId) : null) ??
        w.spawnedAt ??
        m.createdAt;
      const settledAt = s.complete
        ? Math.max(m.createdAt, ...m.workers.map(endedAt))
        : null;
      if (settledAt !== null && now - settledAt > FANOUT_VISIBLE_MS) continue;
      sets.push({
        id,
        title: m.title,
        parentSessionId: m.parentSessionId,
        createdAt: m.createdAt,
        settledAt,
        workers: m.workers.map((w) => ({
          key: w.key,
          sessionId: w.sessionId,
          status:
            s.markers[w.key]?.status ??
            (s.gone.includes(w.key) ? "gone" : null),
          summary: s.markers[w.key]?.summary ?? null,
        })),
      });
    } catch (err) {
      warnings.push(`Dispatch ${id} unreadable: ${(err as Error).message}`);
    }
  }
  return sets.sort((a, b) => b.createdAt - a.createdAt);
}
