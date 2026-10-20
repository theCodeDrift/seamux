// How seamux types into a chat: what each harness (Claude Code, Codex, Cursor) needs
// to know, and a Session, the handle every macro drives a chat through. The
// key sequences live here and in macros.server.ts, nowhere else, so a fix to
// one reaches every verb that uses it. knowledge/prompt-box.md has the measurements
// behind each.

import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { CMUX_BIN } from "./bins.server.ts";
import { cmuxRpc } from "./cmux.server.ts";
import { renameCodexSession } from "./codex.server.ts";
import { runningCursorSessions } from "./cursor.server.ts";
import type { Engine } from "./config.ts";

const rpc = cmuxRpc;
const run = promisify(execFile);

export interface Surface {
  surfaceId: string;
  workspaceId: string;
}

// Always pass the surface: cmux defaults to the caller's own terminal.
export function target(s: Surface) {
  return { surface_id: s.surfaceId, workspace_id: s.workspaceId };
}

export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Harness {
  engine: Engine;
  // What leads the input line when it isn't in shell mode, where every
  // harness leads it with "!", after `inputIndent` columns of space.
  inputLead: string;
  inputIndent: number;
  // The line drawn right above the input line, for a harness whose dialogs
  // lead their options with the input line's mark.
  boxTop?: RegExp;
  // Whether a message is typed a line at a time, or pasted whole, and
  // whether a slash command is typed, where its slash menu picks the command
  // typed, or pasted.
  typesMessages: boolean;
  typesCommands: boolean;
  // Whether a message still sits in the prompt box after its Enter, for a
  // harness whose box can be read that closely, and how long the box may
  // take to show a message written into it.
  unsent?: (screen: string, text: string) => boolean;
  shownWaitMs?: number;
  // What its prompt box holds that was typed and never sent, read off the
  // screen as cmux's terminal.replay draws it, for a harness whose box can
  // be read that closely.
  draft?: (grid: ReplayGrid) => string | null;
  // What approves a permission prompt, and what refuses it.
  approveKey: string;
  denyKeys: string[];
  // Launching it: the agent, cmux's wrapper for it, the dialog a new folder
  // opens on and the keys that trust it, and what shows once it is up and
  // past that dialog. An agent with no wrapper is launched as itself, and
  // cmux learns of it from the hooks cmux installed into it.
  bin: string;
  wrapper: string | null;
  // Whether cmux will register its sessions: its wrapper is there, or its
  // hooks are installed.
  integrated: () => boolean;
  trust: { prompt: string; keys: string[] };
  ready: RegExp;
  resumeArgs: (sessionId: string) => string[];
  // What gives a new chat the session id seamux picked, and its name.
  // Without it the harness picks its own id, which seamux learns once cmux
  // files the session under its surface.
  identify?: (sessionId: string, name: string) => string[];
  // What starts a new chat from a copy of another's conversation, with the
  // session id seamux picked and its name, where it can (ENGINE_FEATURES).
  fork?: (parentId: string, sessionId: string, name: string) => string[];
  // The name cmux gives it, in the `agent` field of `cmux sessions list`.
  cmuxAgent: string;
  // Whether cmux marks its session active for its surface. Then the mark
  // says it is live; otherwise its process does.
  markedActive: boolean;
  // The session id of each of its processes still running, with its pid,
  // for a session whose pid cmux lost or whose id cmux hasn't caught up
  // with, where the harness can list them itself.
  running?: () => Promise<Map<string, number>>;
  // cmux keeps a resumed session's old pid, so a stored pid that is gone
  // says nothing and `running` decides.
  keepsOldPid?: boolean;
  // cmux files its session under a surface only once a prompt goes in, or
  // later, so a resumed one stays under its old surface until then, and a
  // new one under none.
  filedOnPrompt: boolean;
  // Names a closed chat, as /rename names an open one.
  renameClosed: (
    sessionId: string,
    transcript: string,
    name: string,
  ) => Promise<void>;
  // A turn stopped on a failed request resumes once the API answers again
  // (reconnect.server.ts), for a harness whose transcripts record it.
  reconnects: boolean;
  // The command that empties the chat into a new session in the same
  // process, which then gets Session information again.
  clear?: RegExp;
}

// Measured against Claude Code 2.1.281 to 2.1.286, codex-cli 0.156.1 and
// Cursor Agent 2026.10.18.
export const HARNESSES: Record<Engine, Harness> = {
  // Claude Code folds a long paste into a "[Pasted text #1]" placeholder and
  // hands it to the model wrapped in <pasted_content>, so a message for it is
  // typed, with Shift+Enter between its lines, since a typed line break
  // submits.
  claude: {
    engine: "claude",
    inputLead: "❯",
    inputIndent: 0,
    typesMessages: true,
    typesCommands: false,
    unsent: endsPromptBox,
    draft: promptBoxDraft,
    // 1 is always "Yes", and Esc refuses, whatever "No" is numbered.
    approveKey: "1",
    denyKeys: ["escape"],
    bin: "claude",
    wrapper: join(CMUX_BIN, "cmux-claude-wrapper"),
    integrated: () => existsSync(join(CMUX_BIN, "cmux-claude-wrapper")),
    // Its default is "No, exit", so Enter alone would refuse.
    trust: { prompt: "Yes, I trust this folder", keys: ["down", "enter"] },
    ready: /Claude Code v/,
    resumeArgs: (id) => ["--resume", id],
    identify: (id, name) => ["--session-id", id, "--name", name],
    fork: (parent, id, name) => [
      "--resume",
      parent,
      "--fork-session",
      "--session-id",
      id,
      "--name",
      name,
    ],
    cmuxAgent: "claude",
    markedActive: true,
    running: runningClaudeSessions,
    filedOnPrompt: false,
    renameClosed: renameClaudeTranscript,
    reconnects: true,
    clear: /^\/clear\s*$/,
  },
  // Codex is the other way round: it folds long typed input into
  // "[Pasted Content N chars]" but shows a paste in full, so it always gets
  // one. A separate Enter submits it.
  codex: {
    engine: "codex",
    inputLead: "›",
    inputIndent: 0,
    typesMessages: false,
    typesCommands: false,
    approveKey: "y",
    denyKeys: ["escape"],
    bin: "codex",
    wrapper: join(CMUX_BIN, "cmux-codex-wrapper"),
    integrated: () => existsSync(join(CMUX_BIN, "cmux-codex-wrapper")),
    // Its default is "Trust and continue".
    trust: { prompt: "Trust this folder?", keys: ["enter"] },
    // Its banner draws before the dialog, with the model still "loading",
    // and names the model only once the folder is trusted.
    ready: /model:\s+(?!loading\b)\S/,
    resumeArgs: (id) => ["resume", id],
    // Codex has no --session-id or --name: it picks its id, and titles the
    // session itself after the first turn.
    cmuxAgent: "codex",
    markedActive: false,
    filedOnPrompt: true,
    renameClosed: (id, _transcript, name) => renameCodexSession(id, name),
    reconnects: false,
  },
  // Cursor's agent has no cmux wrapper: cmux learns of a chat from the hooks
  // `cmux hooks cursor install` writes into ~/.cursor/hooks.json, after its
  // first turn is over. Its prompt box sits indented between two rules, and
  // its approvals lead their options with the same arrow. A paste shows in
  // full (a long one folds), and a separate Enter submits it once the box
  // shows it: cmux ends a paste with a carriage return, which Cursor takes
  // for a line break, for an Enter, or loses, and an Enter that comes too
  // soon after is lost. A slash command typed in full is what its menu
  // picks.
  cursor: {
    engine: "cursor",
    inputLead: "→",
    inputIndent: 2,
    boxTop: /^\s*▄{8,}\s*$/,
    typesMessages: false,
    typesCommands: true,
    unsent: inCursorBox,
    // It showed a paste within 600 ms. A paste that sent itself never
    // shows, so this is how long sending it waits.
    shownWaitMs: 3_000,
    approveKey: "y",
    // Esc asks what to tell the agent instead, and an empty answer skips
    // the call, which the agent is told was rejected.
    denyKeys: ["escape", "enter"],
    bin: "agent",
    wrapper: null,
    integrated: cursorHooked,
    // Its default is "Trust this workspace".
    trust: { prompt: "Trust this workspace", keys: ["enter"] },
    // The banner draws only once the folder is trusted. The dialog says
    // "Cursor Agent can execute code", never "Cursor Agent" on a line alone.
    ready: /^\s*Cursor Agent\s*$/m,
    resumeArgs: (id) => ["--resume", id],
    // Resuming an id it has never seen starts a chat under it. It titles
    // the chat itself after the first turn.
    identify: (id) => ["--resume", id],
    cmuxAgent: "cursor",
    markedActive: false,
    running: runningCursorSessions,
    keepsOldPid: true,
    filedOnPrompt: true,
    // A closed chat's name is in its SQLite store as well as its meta.json,
    // and resuming it writes the store's back.
    renameClosed: async () => {
      throw new Error(
        "Cursor renames a chat only while it is open: resume it, then rename it",
      );
    },
    reconnects: false,
    clear: /^\/clear\s*$/,
  },
};

// Whether cmux's hooks are in Cursor's hooks.json, which is how cmux learns
// of a Cursor chat at all.
function cursorHooked(): boolean {
  try {
    return readFileSync(join(homedir(), ".cursor/hooks.json"), "utf8").includes(
      "hooks enqueue cursor",
    );
  } catch {
    return false;
  }
}

// The harness cmux names `agent`, if seamux drives it.
export function harnessOf(agent: string): Harness | null {
  return Object.values(HARNESSES).find((h) => h.cmuxAgent === agent) ?? null;
}

// The session id of every Claude Code process still running, with its pid.
async function runningClaudeSessions(): Promise<Map<string, number>> {
  const agents = await run("claude", ["agents", "--json", "--all"], {
    maxBuffer: 32 * 1024 * 1024,
    timeout: 10_000,
  }).then(
    ({ stdout }) =>
      JSON.parse(stdout) as {
        pid?: number | null;
        sessionId?: string | null;
      }[],
    () => [],
  );
  return new Map(
    agents
      .filter((a) => a.sessionId && a.pid && processAlive(a.pid))
      .map((a) => [a.sessionId!, a.pid!]),
  );
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: alive, but someone else's.
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

// A closed Claude Code chat's name lives in its transcript, as the lines
// `/rename` writes; Claude Code reads the last of them when the chat is
// resumed. Appending adds to the transcript and changes nothing already in
// it.
async function renameClaudeTranscript(
  sessionId: string,
  transcript: string,
  name: string,
) {
  await appendFile(
    transcript,
    [
      { type: "custom-title", customTitle: name, sessionId },
      { type: "agent-name", agentName: name, sessionId },
    ]
      .map((line) => JSON.stringify(line) + "\n")
      .join(""),
  );
}

// A tab counts as needing a paste: typed, one would autocomplete.
export const MUST_PASTE = /[\r\n\t]/;
const LINE_BREAK = /\r\n|\r|\n/;

// Claude Code takes typed input arriving faster than about ten characters a
// millisecond for a paste: it drops pieces of it, and an Enter that comes
// while it is still taking it in is lost, leaving the message unsent in its
// prompt box. So text is typed a little at a time.
const TYPE_CHUNK = 100;
const TYPE_GAP_MS = 20;

// A chat that has fallen behind shows a message seconds after it is typed,
// and empties its box seconds after the Enter. How long to wait for each,
// how often to look, and how many more times to try sending a message that
// stays in the box.
const SHOWN_WAIT_MS = 10_000;
const SENT_WAIT_MS = 3_000;
const SCREEN_POLL_MS = 100;
const SUBMIT_RETRIES = 3;

// Ctrl+E to the end of the line, Ctrl+U to delete back to its start, and
// Backspace to join it to the line above, or, in an empty box, to leave
// shell mode. Each typed on its own: sent together they did less.
const CLEAR_KEYS = ["\x05", "\x15", "\x7f"];
const CLEAR_KEY_GAP_MS = 50;
const CLEAR_WAIT_MS = 200;
const CLEAR_ROUNDS = 40;

// The message is still in the prompt box after its Enter.
export class UnsentError extends Error {
  constructor() {
    super(
      "The message is in the chat's prompt box but didn't send; press Enter there",
    );
  }
}

export async function readScreen(surface: Surface): Promise<string> {
  const { text } = await rpc<{ text: string }>(
    "surface.read_text",
    target(surface),
  );
  return text;
}

// A chat's terminal, as a macro sees it: the primitives every macro is made
// of, each speaking to cmux the one way that harness was measured to take.
export class Session {
  readonly surface: Surface;
  readonly harness: Harness;

  constructor(surface: Surface, harness: Harness) {
    this.surface = surface;
    this.harness = harness;
  }

  screen(): Promise<string> {
    return readScreen(this.surface);
  }

  // A named key, encoded by cmux the way a keypress would be.
  async press(key: string) {
    await rpc("surface.send_key", { ...target(this.surface), key });
  }

  // Text exactly as given, in one go: a digit, a control character.
  async keys(text: string) {
    await rpc("surface.send_text", { ...target(this.surface), text });
  }

  async paste(text: string) {
    await rpc("terminal.paste", { ...target(this.surface), text });
  }

  // Text typed a little at a time, so it is never taken for a paste.
  async type(text: string) {
    const chars = Array.from(text);
    for (let at = 0; at < chars.length; at += TYPE_CHUNK) {
      if (at) await pause(TYPE_GAP_MS);
      await this.keys(chars.slice(at, at + TYPE_CHUNK).join(""));
    }
  }

  // A message into the prompt box, the way this harness takes one, without
  // sending it.
  async write(text: string) {
    if (!this.harness.typesMessages || /\t/.test(text)) {
      await this.paste(text);
      return;
    }
    for (const [i, line] of text.split(LINE_BREAK).entries()) {
      if (i) await this.press("shift+enter");
      await this.type(line);
    }
  }

  // Enter, once the box shows `text`, then, where the box can be read, try
  // again while `text` still sits in it, and give up with an UnsentError if
  // it stays. A chat that has fallen behind shows neither the message nor
  // its sending for seconds, and drops an Enter that comes before it has
  // caught up, while a box it hasn't redrawn yet would pass for sent. So the
  // Enter waits until the box shows the message, or a while, for a box that
  // never does, and each try waits a while for the box to empty. Each try is
  // a carriage return typed on its own, which reaches the harness as written
  // rather than through cmux's key encoding: a chat has been seen ignoring
  // cmux's Enter, or taking it as a line break, while a typed carriage return
  // sent. Typed with anything after it, it is taken for a paste and becomes
  // a line break.
  async submit(text: string) {
    const unsent = this.harness.unsent;
    // No input line, as under a dialog, has nothing to wait for.
    if (unsent)
      await this.until(
        (screen) =>
          unsent(screen, text) || inputArea(screen, this.harness) === null,
        this.harness.shownWaitMs ?? SHOWN_WAIT_MS,
      );
    await this.press("enter");
    if (!unsent) return;
    try {
      for (let tries = 0; ; tries++) {
        if (await this.until((screen) => !unsent(screen, text), SENT_WAIT_MS))
          return;
        if (tries === SUBMIT_RETRIES) throw new UnsentError();
        await this.keys("\r");
      }
    } catch (err) {
      // A command such as /exit can close the terminal it was sent to,
      // which then has nothing left unsent.
      if (/not_found/.test((err as Error).message)) return;
      throw err;
    }
  }

  // Whether the screen comes to satisfy `done` within `ms`.
  private async until(done: (screen: string) => boolean, ms: number) {
    const deadline = Date.now() + ms;
    for (;;) {
      if (done(await this.screen())) return true;
      if (Date.now() >= deadline) return false;
      await pause(SCREEN_POLL_MS);
    }
  }

  // Empty the prompt box, so a draft left there is neither sent along nor
  // sends what follows somewhere else: in shell mode Enter runs the box as
  // shell commands. None of the keys stops a turn the way Esc or Ctrl+C
  // would. Each round empties one line, so rounds go on until the input area
  // stops changing. Claude Code keeps what was deleted for Ctrl+Y.
  async clearInput() {
    let area = inputArea(await this.screen(), this.harness);
    if (area === null) return;
    for (let round = 0; round < CLEAR_ROUNDS; round++) {
      for (const [i, key] of CLEAR_KEYS.entries()) {
        if (i) await pause(CLEAR_KEY_GAP_MS);
        await this.keys(key);
      }
      await pause(CLEAR_WAIT_MS);
      const next = inputArea(await this.screen(), this.harness);
      if (next === area) break;
      area = next;
    }
    if (area?.startsWith("!")) {
      throw new Error(
        "The chat's prompt box is still in shell mode (it starts with !), where this would run as a shell command. Clear the box in the chat, then try again",
      );
    }
  }
}

// One writer per chat: two macros typing into the same box would interleave
// their keys, so each waits for the one before it on that chat, in the
// order they were asked for.
const writing = new Map<string, Promise<unknown>>();

// Whether a macro is typing into the chat now, when its prompt box holds
// what the macro is part way through.
export function writingTo(sessionId: string): boolean {
  return writing.has(sessionId);
}

export function exclusive<T>(
  sessionId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const before = writing.get(sessionId) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const settled = run.catch(() => {});
  writing.set(sessionId, settled);
  void settled.then(() => {
    if (writing.get(sessionId) === settled) writing.delete(sessionId);
  });
  return run;
}

// The bottom of the screen from the input line on: the last line led by the
// harness's own mark, or by "!" in shell mode, through everything under it,
// starting at the mark. A line the box wraps onto is indented further, so it
// never matches. Null when no input line shows, such as while a dialog is
// open.
export function inputArea(screen: string, harness: Harness): string | null {
  const lines = screen.split("\n").map((l) => l.trimEnd());
  const indent = harness.inputIndent;
  for (let at = lines.length - 1; at >= 0; at--) {
    const line = lines[at];
    if (line.slice(0, indent).trim()) continue;
    const lead = line[indent];
    if (lead !== harness.inputLead && lead !== "!") continue;
    if (harness.boxTop && !harness.boxTop.test(lines[at - 1] ?? "")) continue;
    return lines.slice(at).join("\n").slice(indent).trimEnd();
  }
  return null;
}

// What the comparison leaves out: whitespace, since the box wraps lines, and
// invisible characters, since Claude Code strips a lone one from the box and
// holds the message for another Enter, saying "Removed 1 invisible character".
const UNSEEN = /[\s\p{Cf}\p{Mn}\p{Me}ᅟᅠㅤﾠ]/gu;

// Claude Code's prompt box: the lines between the last two rules on the
// screen, the first led by "❯", or by "!" in shell mode. Its text leaves out
// what UNSEEN matches.
export function readPromptBox(
  screen: string,
): { shell: boolean; text: string } | null {
  const lines = screen.split("\n").map((l) => l.trim());
  const rules = lines.flatMap((l, i) => (/^[─━▔]{8,}/.test(l) ? [i] : []));
  const [top, bottom] = rules.slice(-2);
  const lead = lines[top + 1]?.[0];
  if (bottom === undefined || (lead !== "❯" && lead !== "!")) return null;
  const text = lines
    .slice(top + 1, bottom)
    .join("")
    .slice(1)
    .replace(UNSEEN, "");
  return { shell: lead === "!", text };
}

// Whether Claude Code's prompt box ends with the end of `text`.
export function endsPromptBox(screen: string, text: string): boolean {
  const box = readPromptBox(screen);
  const tail = Array.from(text.replace(UNSEEN, "")).slice(-20).join("");
  return box !== null && tail.length > 0 && box.text.endsWith(tail);
}

// Cursor's prompt box: the lines between a rule of ▄ and one of ▀, the
// first led by "→", or by "!" in shell mode, two columns in. Its text
// leaves out what UNSEEN matches.
export function readCursorBox(screen: string): string | null {
  const lines = screen.split("\n").map((l) => l.trim());
  let top = lines.length - 1;
  while (top >= 0 && !/^▄{8,}$/.test(lines[top])) top--;
  if (top < 0) return null;
  const bottom = lines.findIndex((l, i) => i > top && /^▀{8,}$/.test(l));
  const lead = lines[top + 1]?.[0];
  if (bottom < 0 || (lead !== "→" && lead !== "!")) return null;
  return lines
    .slice(top + 1, bottom)
    .join("")
    .slice(1)
    .replace(UNSEEN, "");
}

// Whether Cursor's prompt box holds `text`: ends with its end, or holds a
// paste long enough that Cursor folds it into "[Pasted text #1 +3 lines]".
export function inCursorBox(screen: string, text: string): boolean {
  const box = readCursorBox(screen);
  const tail = Array.from(text.replace(UNSEEN, "")).slice(-20).join("");
  return (
    box !== null &&
    tail.length > 0 &&
    (box.endsWith(tail) || /^\[Pastedtext#\d+/.test(box))
  );
}

// The screen as cmux's terminal.replay draws it: each run of text in one
// style, by the row and column it starts at, and the styles they use.
export interface ReplayGrid {
  columns: number;
  row_spans: {
    row: number;
    column: number;
    text: string;
    cell_width: number;
    style_id: number;
  }[];
  styles: { id: number; faint: boolean }[];
}

// What Claude Code's prompt box holds, as typed: the rows between the last
// two rules, the first led by "❯", less the two columns that lead each row.
// Faint text is left out: the box's placeholder and its suggestion of what
// to send next are faint, and typed text never is. A row of the box is
// `columns` - 2 cells wide. A long word is broken where the row is full,
// and other text before the word that wouldn't fit, so a row that ends
// short of that is where a line break was typed. Null for an empty box, one
// in shell mode, or a screen without one, as under a dialog.
export function promptBoxDraft(grid: ReplayGrid): string | null {
  const faint = new Set(grid.styles.filter((s) => s.faint).map((s) => s.id));
  const rows = new Map<number, { text: string; cells: number }>();
  for (const span of [...grid.row_spans].sort((a, b) => a.column - b.column)) {
    const row = rows.get(span.row) ?? { text: "", cells: 0 };
    if (!faint.has(span.style_id)) {
      row.text += " ".repeat(Math.max(0, span.column - row.cells)) + span.text;
      row.cells = span.column + span.cell_width;
    }
    rows.set(span.row, row);
  }
  const last = Math.max(-1, ...rows.keys());
  const lines = Array.from(
    { length: last + 1 },
    (_, i) => rows.get(i)?.text.trimEnd() ?? "",
  );
  const rules = lines.flatMap((l, i) =>
    /^[─━▔]{8,}/.test(l.trimStart()) ? [i] : [],
  );
  const [top, bottom] = rules.slice(-2);
  if (bottom === undefined || !lines[top + 1].startsWith("❯")) return null;
  const width = grid.columns - 2;
  const box = lines.slice(top + 1, bottom);
  let draft = "";
  for (const [i, line] of box.entries()) {
    const text = line.slice(2);
    if (i > 0) {
      const above = Array.from(box[i - 1]).length;
      const word = Array.from(/^\S*/.exec(text)![0]).length;
      draft += above >= width ? "" : above + 1 + word > width ? " " : "\n";
    }
    draft += text;
  }
  return draft.trim() || null;
}
