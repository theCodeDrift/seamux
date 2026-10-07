// How seamux types into a chat: what each harness (Claude Code, Codex) needs
// to know, and a Session, the handle every macro drives a chat through. The
// key sequences live here and in macros.server.ts, nowhere else, so a fix to
// one reaches every verb that uses it. knowledge/prompt-box.md has the measurements
// behind each.

import { execFile } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { CMUX_BIN } from "./bins.server.ts";
import { cmuxRpc } from "./cmux.server.ts";
import { renameCodexSession } from "./codex.server.ts";
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
  // What leads the input line when it isn't in shell mode, where both
  // harnesses lead it with "!".
  inputLead: string;
  // Whether a message is typed a line at a time, or pasted whole.
  typesMessages: boolean;
  // Whether a message still sits in the prompt box after its Enter, for a
  // harness whose box can be read that closely.
  unsent?: (screen: string, text: string) => boolean;
  // What approves a permission prompt.
  approveKey: string;
  // Launching it: the agent, cmux's wrapper for it, the dialog a new folder
  // opens on and the keys that trust it, and what shows once it is up.
  bin: string;
  wrapper: string;
  trust: { prompt: string; keys: string[] };
  ready: string;
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
  // The session ids of its processes still running, for a session whose
  // pid cmux lost, where the harness can list them itself.
  running?: () => Promise<Set<string>>;
  // cmux files its session under a surface only once a prompt goes in, so a
  // resumed one stays under its old surface until then.
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
}

// Measured against Claude Code 2.1.281 to 2.1.286 and codex-cli 0.156.1.
export const HARNESSES: Record<Engine, Harness> = {
  // Claude Code folds a long paste into a "[Pasted text #1]" placeholder and
  // hands it to the model wrapped in <pasted_content>, so a message for it is
  // typed, with Shift+Enter between its lines, since a typed line break
  // submits.
  claude: {
    engine: "claude",
    inputLead: "❯",
    typesMessages: true,
    unsent: endsPromptBox,
    // 1 is always "Yes".
    approveKey: "1",
    bin: "claude",
    wrapper: join(CMUX_BIN, "cmux-claude-wrapper"),
    // Its default is "No, exit", so Enter alone would refuse.
    trust: { prompt: "Yes, I trust this folder", keys: ["down", "enter"] },
    ready: "Claude Code v",
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
  },
  // Codex is the other way round: it folds long typed input into
  // "[Pasted Content N chars]" but shows a paste in full, so it always gets
  // one. A separate Enter submits it.
  codex: {
    engine: "codex",
    inputLead: "›",
    typesMessages: false,
    approveKey: "y",
    bin: "codex",
    wrapper: join(CMUX_BIN, "cmux-codex-wrapper"),
    // Its default is "Trust and continue".
    trust: { prompt: "Trust this folder?", keys: ["enter"] },
    ready: "OpenAI Codex",
    resumeArgs: (id) => ["resume", id],
    // Codex has no --session-id or --name: it picks its id, and titles the
    // session itself after the first turn.
    cmuxAgent: "codex",
    markedActive: false,
    filedOnPrompt: true,
    renameClosed: (id, _transcript, name) => renameCodexSession(id, name),
    reconnects: false,
  },
};

// The harness cmux names `agent`, if seamux drives it.
export function harnessOf(agent: string): Harness | null {
  return Object.values(HARNESSES).find((h) => h.cmuxAgent === agent) ?? null;
}

// The session ids of every Claude Code process still running.
async function runningClaudeSessions(): Promise<Set<string>> {
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
  return new Set(
    agents
      .filter((a) => a.sessionId && a.pid && processAlive(a.pid))
      .map((a) => a.sessionId!),
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

// How long to give a harness to take a message in before checking it went,
// and how many more times to try sending it when it didn't.
const SUBMIT_WAIT_MS = 300;
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

  // Enter, then, where the box can be read, try again while `text` still
  // sits in it, and give up with an UnsentError if it stays. Each try is a
  // carriage return typed on its own, which reaches the harness as written
  // rather than through cmux's key encoding: a chat has been seen ignoring
  // cmux's Enter, or taking it as a line break, while a typed carriage return
  // sent. Typed with anything after it, it is taken for a paste and becomes
  // a line break.
  async submit(text: string) {
    await this.press("enter");
    const unsent = this.harness.unsent;
    if (!unsent) return;
    for (let tries = 0; ; tries++) {
      await pause(SUBMIT_WAIT_MS);
      if (!unsent(await this.screen(), text)) return;
      if (tries === SUBMIT_RETRIES) throw new UnsentError();
      await this.keys("\r");
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
// harness's own mark, or by "!" in shell mode, through everything under it.
// A line the box wraps onto is indented, so it never matches. Null when no
// input line shows, such as while a dialog is open.
export function inputArea(screen: string, harness: Harness): string | null {
  const lines = screen.split("\n").map((l) => l.trimEnd());
  for (let at = lines.length - 1; at >= 0; at--) {
    const lead = lines[at][0];
    if (lead === harness.inputLead || lead === "!")
      return lines.slice(at).join("\n").trimEnd();
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
