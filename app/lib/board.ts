// Shared board types. Safe to import from client and server.

import type { Engine, MacroName } from "./config.ts";

export const COLUMNS = ["idle", "waiting", "working", "done"] as const;
export type Column = (typeof COLUMNS)[number];

export const COLUMN_LABELS: Record<Column, string> = {
  idle: "Idle",
  waiting: "Waiting",
  working: "Working",
  done: "Done",
};

// A background session, shown only as a fact about its parent card.
// We never drive these directly; they belong to the chat that spawned them.
export interface BackgroundSession {
  id: string;
  name: string;
  state: string;
  needs: string | null;
}

// A subagent, from the SubagentStart / SubagentStop hooks, described from
// its own transcript metadata.
export interface Subagent {
  agentId: string;
  type: string | null;
  description: string | null;
  running: boolean;
  // Running with no Stop, but its transcript has gone quiet. Usually a
  // session that was killed before the hook could fire.
  stale: boolean;
  startedAt: number | null;
  stoppedAt: number | null;
  lastMessage: string | null;
}

// One question from an open AskUserQuestion call, as the model asked it.
export interface Question {
  question: string;
  header: string | null;
  multiSelect: boolean;
  options: {
    label: string;
    description: string | null;
    // A mockup or snippet to compare, shown when the option is picked.
    preview: string | null;
  }[];
}

// Options with previews make a different dialog: single-select, no "Type
// something" row, and a note can go with the pick.
export function hasPreviews(q: Question): boolean {
  return !q.multiSelect && q.options.some((o) => o.preview != null);
}

// How the user answers one question: option indices, with a note on a question
// with previews, or their own text on any other single-select question.
export type Answer = { picks: number[]; notes?: string } | { text: string };

// The reason on a chat whose turn ended on a question in its reply. Claude
// Code calls that session idle, since no dialog is open.
export const ASKED_IN_REPLY = "asked in its reply";

// What a WAITING card is blocked on.
export interface Waiting {
  // Claude Code's own words, from `claude agents`: "input needed" for a
  // question, "permission prompt" for an approval. Or ASKED_IN_REPLY.
  reason: string | null;
  // The tool call the dialog belongs to, from the transcript.
  tool: string | null;
  detail: string | null;
  // An open AskUserQuestion, which the board can answer.
  ask: { toolUseId: string; questions: Question[] } | null;
  // An open permission prompt, which the board can approve or deny.
  approval: { toolUseId: string } | null;
  // Any other dialog, such as /exit's "Background work is running", read
  // off the terminal since no tool call is behind it. Or a tool's own
  // confirmation in place of `approval`, which its options answer and
  // Approve can't.
  dialog: Dialog | null;
}

// A dialog as the terminal shows it. `key` is its text, so an answer only
// goes to the dialog it was meant for.
export interface Dialog {
  title: string;
  detail: string[];
  options: string[];
  // Which option the cursor is on in a dialog with no numbers, which arrows
  // and Enter answer; null in a numbered one, which a digit answers.
  cursor: number | null;
  key: string;
}

// Tokens in the chat's context against the size of its window.
export interface ContextUsage {
  used: number;
  window: number;
}

export interface Card {
  sessionId: string;
  // The agent running the chat. Only Claude Code has subagents, background
  // sessions, questions the board can answer, and forks.
  engine: Engine;
  name: string;
  cwd: string;
  column: Column;
  branch: string | null;
  lastActivityAt: number | null;
  lastPrompt: string | null;
  // When the user sent the last prompt, which orders each column.
  lastPromptAt: number | null;
  lastReply: string | null;
  // null until the chat's first response, and again just after a compaction.
  context: ContextUsage | null;
  // Prompts typed into the terminal that wait in Claude Code's own queue.
  terminalQueue: string[];
  // Messages seamux holds for the chat, sent in order once it is idle.
  boardQueue: QueuedMessage[];
  // A message typed into the chat's prompt box and never sent, read off its
  // screen while the chat is at rest: one the board sent that the chat
  // didn't take, or one typed in the terminal.
  unsentDraft: string | null;
  // The last message the board failed to send the chat, until one goes.
  sendFailure: SendFailure | null;
  workspaceRef: string | null;
  // What the session was dispatched or forked to do, if seamux started it.
  intent: string | null;
  forkedFrom: string | null;
  // Set when the session is a worker in a fan-out.
  worker: {
    dispatchId: string;
    key: string;
  } | null;
  // The fan-outs this session started, listed in its chat's side rail.
  fanouts: DispatchSet[];
  // Running in a cmux surface, so the board can send into it.
  drivable: boolean;
  // The chat's own turn is running, so Esc has something to stop. A card can
  // be WORKING without one, while only its subagents run.
  turnRunning: boolean;
  // Pinned from the board: shown in its own column whatever its state, until
  // it closes.
  pinned: boolean;
  // The pinned chat whose pin `/clear` carried to this one.
  clearedFrom: string | null;
  // Set when the chat itself is blocked on a dialog.
  waiting: Waiting | null;
  // Set when the chat's last turn ended on an error from the API rather
  // than a reply, such as an expired login or an overloaded server.
  apiError: ApiError | null;
  // Set while the board is closing it through the close-session macro, or
  // when such a close was held and left the chat open. `retry` when the
  // next close sends the macro again rather than exiting straight away.
  closing: {
    state: "cleaning" | "held";
    note: string | null;
    retry: boolean;
  } | null;
  background: BackgroundSession[];
  subagents: Subagent[];
}

// An error Claude Code wrote into the transcript in place of a reply.
export interface ApiError {
  // Claude Code's own kind: "authentication_failed", "server_error", ...
  kind: string;
  text: string;
  at: number;
}

// A sign-in seamux runs for a service, without a terminal, so it can be
// finished from any device: Claude Code takes back a pasted code, Codex a
// device code entered on its site.
export interface ServiceLogin {
  state: "running" | "failed" | "done";
  url: string | null;
  // Claude Code's sign-in URL that calls back to this Mac, so nothing is
  // pasted, but only a browser on this Mac can finish it.
  localUrl: string | null;
  // Codex's one-time device code, entered on its site.
  deviceCode: string | null;
  // Claude Code's sign-in page can show a code to paste back.
  takesCode: boolean;
  message: string | null;
  startedAt: number;
}

// Something wrong with a service rather than a chat, for the Attention
// column. Shown only while there is something to see.
export interface ServiceNotice {
  service: Engine;
  // By the tool's own status; null when it could not be asked.
  signedIn: boolean | null;
  // Signed out, or a chat hit an expired login since seamux last signed in.
  needsLogin: boolean;
  // Live chats whose last turn ended on an expired login.
  stopped: { sessionId: string; name: string }[];
  login: ServiceLogin | null;
}

// Whether the notice asks something of the user, so it counts like a waiting
// chat.
export function needsAction(n: ServiceNotice): boolean {
  return n.needsLogin || n.stopped.length > 0 || n.login?.state === "running";
}

// Whether the notice gets a card. A sign-in that just finished stays in the
// notices so every board sees it end, but says so in a toast instead.
export function showsCard(n: ServiceNotice): boolean {
  return n.needsLogin || n.stopped.length > 0 || n.login?.state !== "done";
}

export interface QueuedMessage {
  id: number;
  text: string;
  queuedAt: number;
}

// Where a fan-out worker stands: reported ok or failed, its session ended
// without reporting ("gone"), or still expected to report (null).
export type WorkerState = "ok" | "failed" | "gone" | null;

// A fan-out set from the protocol, and which workers have reported.
export interface DispatchSet {
  id: string;
  title: string;
  // The session that ran `seamux fanout`, whose card lists the workers.
  parentSessionId: string | null;
  createdAt: number;
  // When the last worker reported or ended; null while any is pending.
  settledAt: number | null;
  workers: {
    key: string;
    sessionId: string | null;
    status: WorkerState;
    // What the worker said when it reported.
    summary: string | null;
  }[];
}

export interface Board {
  generatedAt: number;
  // The commit the board is serving, so a landed change is visible.
  version: { hash: string; subject: string } | null;
  cards: Card[];
  // Every fan-out still on the board; each is also on its parent's card.
  dispatches: DispatchSet[];
  // Background sessions not matched to an open chat. Every one `claude
  // agents` still lists can be brought back with `claude attach`.
  orphans: (BackgroundSession & { cwd: string; sessionId: string })[];
  // Service problems, for the Attention column; empty when all is well.
  attention: ServiceNotice[];
  warnings: string[];
  // Every source of the board's chats answered, so a chat missing from
  // `cards` has gone, rather than gone unseen.
  sessionsKnown: boolean;
  // Why seamux can't reach cmux, which leaves it unable to drive any chat;
  // null when it can.
  cmux: CmuxProblem | null;
  // How hard macOS is pressed for memory; null when it can't be read.
  memory: MemoryPressure | null;
}

export type MemoryPressure = "normal" | "warn" | "critical";

export interface CmuxProblem {
  trouble: CmuxTrouble;
  // The command that starts this seamux, to run again from a cmux terminal.
  start: string;
  // Where seamux's .env is.
  home: string;
}

// What keeps seamux from cmux: cmux isn't installed, or isn't running, or
// runs with its socket off, seamux was started outside it, which cmux's
// socket refuses by default, or cmux wants a socket password seamux wasn't
// given.
export type CmuxTrouble =
  "not_installed" | "not_running" | "socket_off" | "outside_cmux" | "password";

export type ChatMessage =
  | { role: "user" | "assistant"; text: string; at: string | null }
  // A system macro seamux sent, shown by its name rather than its text.
  | { role: "macro"; name: MacroName; at: string | null }
  // The tools a reply called between its words, each by name with how many
  // times, rather than what went in and came out.
  | {
      role: "tools";
      calls: { name: string; count: number }[];
      at: string | null;
    }
  // A command the user ran in the chat with `!`. output is null while it
  // runs.
  | {
      role: "shell";
      command: string;
      output: string | null;
      at: string | null;
    };

// The chat shows this many of a conversation's last messages, and this many
// more each time it is asked for earlier ones.
export const MESSAGES_SHOWN = 100;

// A slash command a Claude Code chat accepts, for the inputs' autocomplete.
export interface SlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

// Finished subagents stay on their card for this long, and a settled
// fan-out's workers on their parent's this long after the last reported
// or ended.
export const SUBAGENT_VISIBLE_MS = 10 * 60 * 1000;
export const FANOUT_VISIBLE_MS = 10 * 60 * 1000;
// A running subagent whose transcript is quiet this long is marked stale.
export const SUBAGENT_STALE_MS = 15 * 60 * 1000;

// DONE cards stay visible for this long after the chat closes.
export const DONE_VISIBLE_MS = 30 * 60 * 1000;

// Whether the turn is over and no dialog is open, so what's typed lands in
// an empty prompt box. A reply that ended on a question puts the card in
// WAITING, but the prompt box is free.
// A message the board couldn't get into a chat, and why.
export interface SendFailure {
  text: string;
  error: string;
  // When it failed, which tells one failure from the next.
  at: number;
}

export function atRest(card: Card): boolean {
  return card.column === "idle" || card.waiting?.reason === ASKED_IN_REPLY;
}

// Whether /exit is safe.
export function closable(card: Card): boolean {
  return atRest(card);
}
