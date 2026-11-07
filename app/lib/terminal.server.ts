// The board's one shell: a plain cmux terminal for what no chat should be
// asked to do, such as tailing a log from a phone. The board opens it, reads
// it and types into it through cmux like any chat. It lives until its shell
// exits, which closes its workspace, and seamux never closes it.

import { homedir } from "node:os";

import { CmuxError, cmuxRpc } from "./cmux.server.ts";
import { Terminal, type Surface } from "./harness.server.ts";
import { readValue, writeValue } from "./store.server.ts";

// A config key rather than a table: nothing else records which terminal is
// the board's, and bumping SCHEMA_VERSION for it would drop every dispatch
// and queued message. One a surface no longer answers to is simply forgotten.
const TERMINAL_KEY = "terminal";

// Enough to catch up on a log, and little enough to ask for every second
// over a phone's connection.
const LINES_SHOWN = 500;

function terminal(): Terminal | null {
  const raw = readValue(TERMINAL_KEY) as Partial<Surface> | null | undefined;
  if (typeof raw?.surfaceId !== "string") return null;
  if (typeof raw.workspaceId !== "string") return null;
  return new Terminal({
    surfaceId: raw.surfaceId,
    workspaceId: raw.workspaceId,
  });
}

const closed = (err: unknown) =>
  err instanceof CmuxError && err.code === "not_found";

// The terminal's text, or null when there isn't one to read.
export async function readTerminal(): Promise<string | null> {
  const open = terminal();
  if (!open) return null;
  try {
    return (await open.history(LINES_SHOWN)).trimEnd();
  } catch (err) {
    // Started but not up yet: a blank screen, not a failure. Should the
    // keystroke below never have come, anything typed starts it.
    if (err instanceof CmuxError && err.code === "internal_error") return "";
    if (!closed(err)) throw err;
    writeValue(TERMINAL_KEY, undefined);
    return null;
  }
}

async function start() {
  if ((await readTerminal()) !== null) return;
  // Without an initial_command cmux runs the user's own shell with its
  // integration, so `claude` typed there gets a card. Unfocused: whoever
  // opened it may be nowhere near this Mac.
  const created = await cmuxRpc<{ surface_id: string; workspace_id: string }>(
    "workspace.create",
    { cwd: homedir(), title: "seamux terminal", focus: false },
  );
  const surface = {
    surfaceId: created.surface_id,
    workspaceId: created.workspace_id,
  };
  writeValue(TERMINAL_KEY, surface);
  // An unfocused terminal with no command doesn't start until something is
  // typed at it. Ctrl+U leaves nothing on the line (knowledge/launching.md).
  await new Terminal(surface).keys("\x15");
}

// Two tabs opening it at once get the same one.
let opening: Promise<void> | null = null;

export function openTerminal(): Promise<void> {
  opening ??= start().finally(() => {
    opening = null;
  });
  return opening;
}

// Types `text` at the shell, then presses `key` if there is one.
export async function sendToTerminal(text: string, key: string | null) {
  const open = terminal();
  if (!open) throw new Error("The terminal has closed");
  try {
    if (text) await open.type(text);
    if (key) await open.press(key);
  } catch (err) {
    if (!closed(err)) throw err;
    writeValue(TERMINAL_KEY, undefined);
    throw new Error("The terminal has closed");
  }
}
