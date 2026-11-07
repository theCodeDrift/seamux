// The board's one shell: what app/lib/terminal.server.ts and its route send
// to cmux, measured by hand first (knowledge/cmux.md).

import { homedir } from "node:os";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeValue } from "~/lib/store.server";
import { isTerminalKey } from "~/lib/terminal";
import {
  openTerminal,
  readTerminal,
  sendToTerminal,
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
    await expect(readTerminal()).resolves.toBe("");
  });

  it("reads one that hasn't started as blank, and typing starts it", async () => {
    await openTerminal();
    surface().unstarted = true;
    await expect(readTerminal()).resolves.toBe("");
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

  it("reads a bounded stretch of its scrollback, without the blank rows below", async () => {
    await openTerminal();
    surface().screen = "one\ntwo\n\n\n";
    await expect(readTerminal()).resolves.toBe("one\ntwo");
    const [read] = cmux.calls("surface.read_text");
    expect(read.params.lines).toEqual(expect.any(Number));
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
