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

// What the panel polls: the terminal's text, or null with none open.
export interface TerminalScreen {
  text: string | null;
  error: string | null;
}

export interface TerminalResult {
  ok: boolean;
  error: string | null;
}
