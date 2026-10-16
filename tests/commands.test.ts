// Listing a chat's slash commands (app/lib/commands.server.ts) through a
// headless Claude Code, which `claude agents` takes for a chat while it runs.

import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { loadBoard } from "~/lib/board.server";
import { forgetCommands, slashCommands } from "~/lib/commands.server";
import { FakeCmux } from "./fake-cmux";

// The fake claude, ahead of a real one in /opt/homebrew/bin or the like.
vi.mock("~/lib/bins.server", async (actual) => ({
  ...(await actual<typeof import("~/lib/bins.server")>()),
  findBin: (name: string) =>
    name === "claude"
      ? fileURLToPath(new URL("./bin/claude", import.meta.url))
      : null,
}));

const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
let cmux: FakeCmux;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
  forgetCommands();
});

afterEach(async () => {
  delete process.env.SEAMUX_TEST_CLAUDE_LIST_DELAY_MS;
  rmSync(agents, { force: true });
  await cmux.stop();
});

it("lists the commands a headless session answers initialize with", async () => {
  expect(await slashCommands(process.cwd())).toEqual([
    { name: "clear", description: "Clear the conversation", argumentHint: "" },
    { name: "gtd", description: "Get things done", argumentHint: "[when]" },
  ]);
});

it("leaves the listing session off the board while it runs", async () => {
  process.env.SEAMUX_TEST_CLAUDE_LIST_DELAY_MS = "2000";
  const listed = slashCommands(process.cwd());
  // Until the fake has listed itself in `claude agents`.
  const listing = async (): Promise<{ sessionId: string }> => {
    for (;;) {
      try {
        const [row] = JSON.parse(readFileSync(agents, "utf8"));
        if (row) return row;
      } catch {}
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const { sessionId } = await listing();

  const board = await loadBoard();

  expect(board.cards.map((c) => c.sessionId)).not.toContain(sessionId);
  expect(await listed).toHaveLength(2);
});
