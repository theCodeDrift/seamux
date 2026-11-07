// What the board's terminal shares between the server and the browser.

// The keys a phone's keyboard hasn't got, as cmux names them, measured in
// knowledge/cmux.md. The box above them takes everything else.
export const TERMINAL_KEYS = [
  { key: "ctrl+c", label: "Ctrl+C" },
  { key: "escape", label: "Esc" },
  { key: "tab", label: "Tab" },
  { key: "up", label: "↑" },
  { key: "down", label: "↓" },
  { key: "left", label: "←" },
  { key: "right", label: "→" },
  { key: "backspace", label: "⌫" },
] as const;

export function isTerminalKey(key: string): boolean {
  return key === "enter" || TERMINAL_KEYS.some((k) => k.key === key);
}

// How a run of text is drawn. An empty style is the terminal's default.
export interface TerminalStyle {
  color?: string;
  background?: string;
  bold?: boolean;
  faint?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
}

// A run of text and the index of its style, kept short: the panel asks for
// this every second, over whatever connection a phone has.
export type TerminalRun = [text: string, style: number];

export interface TerminalContent {
  lines: TerminalRun[][];
  styles: TerminalStyle[];
  foreground: string | null;
  background: string | null;
}

// What the panel polls: the terminal, or null with none open.
export interface TerminalScreen {
  terminal: TerminalContent | null;
  error: string | null;
}

export interface TerminalResult {
  ok: boolean;
  error: string | null;
}
