// The board's one shell: a plain cmux terminal for what no chat should be
// asked to do, such as tailing a log from a phone. The board opens it, reads
// it and types into it through cmux like any chat. It lives until its shell
// exits, which closes its workspace, and seamux never closes it.

import { homedir } from "node:os";

import { CmuxError, cmuxRpc } from "./cmux.server.ts";
import {
  Terminal,
  type ReplayGrid,
  type ReplaySpan,
  type ReplayStyle,
  type Surface,
} from "./harness.server.ts";
import { readValue, writeValue } from "./store.server.ts";
import type {
  TerminalContent,
  TerminalRun,
  TerminalStyle,
} from "./terminal.ts";

// A config key rather than a table: nothing else records which terminal is
// the board's, and bumping SCHEMA_VERSION for it would drop every dispatch
// and queued message. One a surface no longer answers to is simply forgotten.
const TERMINAL_KEY = "terminal";

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

const defaulted = (color?: string, source?: string) =>
  source === "default" ? undefined : color;

function styleOf(style: ReplayStyle, grid: ReplayGrid): TerminalStyle {
  let color = defaulted(style.foreground, style.foreground_source);
  let background = defaulted(style.background, style.background_source);
  if (style.inverse) {
    [color, background] = [
      background ?? grid.terminal_background,
      color ?? grid.terminal_foreground,
    ];
  }
  if (style.invisible) color = background ?? grid.terminal_background;
  return {
    ...(color && { color }),
    ...(background && { background }),
    ...(style.bold && { bold: true }),
    ...(style.faint && { faint: true }),
    ...(style.italic && { italic: true }),
    ...(style.underline && { underline: true }),
    ...(style.strikethrough && { strikethrough: true }),
  };
}

// The grid as lines of runs, oldest first, for the panel to draw. A span
// says which column it starts at and nothing fills a gap between two, and
// cmux already gives colours as hex, so only the layout is left to work out.
export function terminalContent(grid: ReplayGrid): TerminalContent {
  const scrollback = grid.scrollback_spans ?? [];
  const above = grid.scrollback_rows ?? scrollback.length;
  const rows = new Map<number, ReplaySpan[]>();
  const place = (span: ReplaySpan, row: number) => {
    rows.set(row, [...(rows.get(row) ?? []), span]);
  };
  for (const span of scrollback) place(span, span.row);
  for (const span of grid.row_spans) place(span, span.row + above);

  // Only the styles in use go to the browser, the plain one first.
  const styles: TerminalStyle[] = [{}];
  const indexes = new Map<number, number>();
  const styleIndex = (id: number) => {
    let index = indexes.get(id);
    if (index === undefined) {
      const style = grid.styles.find((s) => s.id === id);
      const drawn = style ? styleOf(style, grid) : {};
      index = Object.keys(drawn).length === 0 ? 0 : styles.push(drawn) - 1;
      indexes.set(id, index);
    }
    return index;
  };

  const lines: TerminalRun[][] = [];
  const last = Math.max(-1, ...rows.keys());
  for (let row = 0; row <= last; row++) {
    const line: TerminalRun[] = [];
    const add = (text: string, style: number) => {
      const end = line.at(-1);
      if (end?.[1] === style) end[0] += text;
      else line.push([text, style]);
    };
    let at = 0;
    const spans = rows.get(row) ?? [];
    for (const span of spans.sort((a, b) => a.column - b.column)) {
      if (span.column > at) add(" ".repeat(span.column - at), 0);
      add(span.text, styleIndex(span.style_id));
      at = span.column + span.cell_width;
    }
    lines.push(line);
  }
  return {
    lines,
    styles,
    foreground: grid.terminal_foreground ?? null,
    background: grid.terminal_background ?? null,
  };
}

// The terminal as the panel draws it, or null when there isn't one to read.
// One that hasn't started yet has nothing on it. Should the keystroke below
// never have come, anything typed starts it.
export async function readTerminal(): Promise<TerminalContent | null> {
  const open = terminal();
  if (!open) return null;
  try {
    const grid = await open.grid();
    return grid
      ? terminalContent(grid)
      : { lines: [], styles: [{}], foreground: null, background: null };
  } catch (err) {
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
