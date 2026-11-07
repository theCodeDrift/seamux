// The board's one shell: what app/lib/terminal.server.ts and its route send
// to cmux, measured by hand first (knowledge/cmux.md).

import { homedir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig, setTerminalFont } from "~/lib/config.server";
import { writeValue } from "~/lib/store.server";
import { isTerminalKey } from "~/lib/terminal";
import type { ReplayGrid } from "~/lib/harness.server";
import {
  openTerminal,
  readTerminal,
  sendToTerminal,
  terminalContent,
} from "~/lib/terminal.server";
import { FakeCmux } from "./fake-cmux";

let cmux: FakeCmux;

beforeEach(async () => {
  writeValue("terminal", undefined);
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  for (const r of cmux.requests) {
    if (/^surface\./.test(r.method)) {
      expect(r.params, r.method).toMatchObject({
        surface_id: expect.any(String),
        workspace_id: expect.any(String),
      });
    }
  }
  await cmux.stop();
});

const surface = () => cmux.workspaces[0].surfaces[0];

const text = (lines: [string, number][][] | undefined) =>
  lines?.map((line) => line.map(([t]) => t).join("")).join("\n");

describe("drawing the terminal", () => {
  const plain = {
    id: 0,
    faint: false,
    foreground: "#FFFFFF",
    foreground_source: "default",
    background: "#282C34",
    background_source: "default",
  };
  const grid = (over: Partial<ReplayGrid>): ReplayGrid => ({
    columns: 79,
    rows: 3,
    row_spans: [],
    styles: [plain],
    terminal_foreground: "#FFFFFF",
    terminal_background: "#282C34",
    ...over,
  });
  const span = (row: number, column: number, t: string, style_id = 0) => ({
    row,
    column,
    text: t,
    cell_width: Array.from(t).length,
    style_id,
  });

  it("carries the terminal's own colours", () => {
    const { foreground, background } = terminalContent(grid({}));
    expect({ foreground, background }).toEqual({
      foreground: "#FFFFFF",
      background: "#282C34",
    });
  });

  it("puts the scrollback above the screen, oldest first", () => {
    const { lines } = terminalContent(
      grid({
        scrollback_rows: 2,
        scrollback_spans: [span(0, 0, "old"), span(1, 0, "older")],
        row_spans: [span(0, 0, "now")],
      }),
    );
    expect(text(lines)).toBe("old\nolder\nnow");
  });

  it("keeps a blank row between lines, and drops the ones below", () => {
    const { lines } = terminalContent(
      grid({ row_spans: [span(0, 0, "a"), span(2, 0, "b")] }),
    );
    expect(lines).toEqual([[["a", 0]], [], [["b", 0]]]);
  });

  it("fills the gap between two spans, by the columns text takes", () => {
    const { lines } = terminalContent(
      grid({
        row_spans: [
          { ...span(0, 0, "😀"), cell_width: 2 },
          span(0, 4, "x"),
          span(0, 2, "w"),
        ],
      }),
    );
    expect(text(lines)).toBe("😀w x");
  });

  it("sends only the styles in use, and merges what they don't split", () => {
    const red = {
      ...plain,
      id: 7,
      foreground: "#CC6666",
      foreground_source: "palette",
      bold: true,
    };
    const unused = { ...plain, id: 8, italic: true };
    const { lines, styles } = terminalContent(
      grid({
        styles: [plain, red, unused],
        row_spans: [
          span(0, 0, "ok "),
          span(0, 3, "bad", 7),
          span(0, 6, "ly", 7),
          span(0, 8, "!"),
        ],
      }),
    );
    expect(lines).toEqual([
      [
        ["ok ", 0],
        ["badly", 1],
        ["!", 0],
      ],
    ]);
    expect(styles).toEqual([{}, { color: "#CC6666", bold: true }]);
  });

  it("swaps an inverse run's colours, its defaults resolved", () => {
    const { styles } = terminalContent(
      grid({
        styles: [
          plain,
          { ...plain, id: 1, inverse: true },
          {
            ...plain,
            id: 2,
            inverse: true,
            foreground: "#F07623",
            foreground_source: "rgb",
          },
        ],
        row_spans: [span(0, 0, "a", 1), span(0, 1, "b", 2)],
      }),
    );
    expect(styles.slice(1)).toEqual([
      { color: "#282C34", background: "#FFFFFF" },
      { color: "#282C34", background: "#F07623" },
    ]);
  });

  it("hides invisible text in its background", () => {
    const { styles } = terminalContent(
      grid({
        styles: [plain, { ...plain, id: 1, invisible: true }],
        row_spans: [span(0, 0, "secret", 1)],
      }),
    );
    expect(styles[1]).toEqual({ color: "#282C34" });
  });
});

describe("the terminal font", () => {
  afterEach(() => writeValue("terminalFont", undefined));

  it("defaults to none, and an empty one goes back to that", () => {
    expect(readConfig().terminalFont).toBe("");
    setTerminalFont("  MesloLGS NF, monospace ");
    expect(readConfig().terminalFont).toBe("MesloLGS NF, monospace");
    setTerminalFont("   ");
    expect(readConfig().terminalFont).toBe("");
  });

  it("refuses one too long to be a font", () => {
    expect(() => setTerminalFont("x".repeat(201))).toThrow("too long");
  });

  it("takes quoted names, and refuses an open quote", () => {
    setTerminalFont(`"0xProto", 'Fira Code'`);
    expect(readConfig().terminalFont).toBe(`"0xProto", 'Fira Code'`);
    expect(() => setTerminalFont(`"0xProto`)).toThrow("unclosed");
    expect(() => setTerminalFont(`Fira's Code`)).toThrow("unclosed");
    expect(readConfig().terminalFont).toBe(`"0xProto", 'Fira Code'`);
  });

  it("ignores a stored value that isn't a string", () => {
    writeValue("terminalFont", 12);
    expect(readConfig().terminalFont).toBe("");
  });
});

describe("the board's terminal", () => {
  it("opens a plain shell in the home directory, without taking focus", async () => {
    await openTerminal();
    const [create] = cmux.calls("workspace.create");
    expect(create.params).toMatchObject({
      cwd: homedir(),
      title: "seamux terminal",
      focus: false,
    });
    expect(create.params).not.toHaveProperty("initial_command");
  });

  it("starts it with a keystroke that leaves nothing on the line", async () => {
    await openTerminal();
    expect(surface().input).toEqual([{ kind: "text", value: "\x15" }]);
    expect(surface().unstarted).toBe(false);
  });

  it("reads one that hasn't started as blank, and typing starts it", async () => {
    await openTerminal();
    surface().unstarted = true;
    expect((await readTerminal())?.lines).toEqual([]);
    await sendToTerminal("ls", "enter");
    expect(surface().unstarted).toBe(false);
  });

  it("reuses the one it has", async () => {
    await openTerminal();
    await openTerminal();
    expect(cmux.calls("workspace.create")).toHaveLength(1);
  });

  it("opens one, however many ask at once", async () => {
    await Promise.all([openTerminal(), openTerminal(), openTerminal()]);
    expect(cmux.calls("workspace.create")).toHaveLength(1);
  });

  it("reads the terminal's text, without the blank rows below it", async () => {
    await openTerminal();
    surface().screen = "one\ntwo\n\n\n";
    expect(text((await readTerminal())?.lines)).toBe("one\ntwo");
    expect(cmux.calls("terminal.replay")).toHaveLength(1);
  });

  it("has nothing to read until one is opened", async () => {
    await expect(readTerminal()).resolves.toBeNull();
    expect(cmux.calls("surface.read_text")).toEqual([]);
  });

  it("forgets one whose shell has exited, and opens a new one", async () => {
    await openTerminal();
    cmux.workspaces.length = 0;
    await expect(readTerminal()).resolves.toBeNull();
    await openTerminal();
    expect(cmux.calls("workspace.create")).toHaveLength(2);
  });

  it("types the text, then presses the key", async () => {
    await openTerminal();
    await sendToTerminal("tail -f /tmp/a.log", "enter");
    expect(surface().input.slice(1)).toEqual([
      { kind: "text", value: "tail -f /tmp/a.log" },
      { kind: "key", value: "enter" },
    ]);
  });

  it("presses a key with nothing typed", async () => {
    await openTerminal();
    await sendToTerminal("", "ctrl+c");
    expect(surface().input.slice(1)).toEqual([
      { kind: "key", value: "ctrl+c" },
    ]);
  });

  it("says so when there's nothing to type at", async () => {
    await expect(sendToTerminal("ls", "enter")).rejects.toThrow(
      "The terminal has closed",
    );
    await openTerminal();
    cmux.workspaces.length = 0;
    await expect(sendToTerminal("ls", "enter")).rejects.toThrow(
      "The terminal has closed",
    );
    await expect(readTerminal()).resolves.toBeNull();
  });

  it("takes only the keys it offers", () => {
    for (const key of ["enter", "ctrl+c", "up", "backspace"]) {
      expect(isTerminalKey(key)).toBe(true);
    }
    expect(isTerminalKey("shift+enter")).toBe(false);
    expect(isTerminalKey("ctrl+d")).toBe(false);
  });
});
