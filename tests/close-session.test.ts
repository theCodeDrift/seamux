// Closing an idle chat through the close-session macro: the macro goes in as
// a prompt, and the chat exits once that turn ends, unless the turn never
// starts or never ends, ends on a question, or leaves uncommitted changes or
// its worktree behind. Then the close is held, the chat left open with a
// note, since exiting would lose what the session meant the user to read.
// Closing a held chat again exits it, unless the turn never started, when it
// sends the macro again.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ASKED_IN_REPLY, type Card, type Column } from "~/lib/board";
import { closeSession, closingState } from "~/lib/drive.server";
import { FakeCmux } from "./fake-cmux";

let cmux: FakeCmux;
let ids = 0;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
  // The clock runs on its own, so cmux's replies and the keystrokes' pauses
  // go as usual, and a test moves it on by minutes to reach a timeout.
  vi.useFakeTimers({
    shouldAdvanceTime: true,
    toFake: ["setTimeout", "clearTimeout", "Date"],
  });
});

afterEach(async () => {
  vi.useRealTimers();
  await cmux.stop();
});

// A chat as the board derives it on each poll; the test changes it as the
// session's turn goes.
function chat(cwd = mkdtempSync(join(tmpdir(), "seamux-close-"))) {
  const sessionId = `close-${++ids}`;
  const { surface } = cmux.addSession(sessionId);
  // Claude Code ends the session on /exit and Enter.
  cmux.onInput((s, i) => {
    if (
      s === surface &&
      i.kind === "key" &&
      surface.input.at(-2)?.value === "/exit"
    ) {
      cmux.endSession(sessionId);
    }
  });
  const card = {
    sessionId,
    engine: "claude",
    name: sessionId,
    cwd,
    column: "idle" as Column,
    lastActivityAt: Date.now() - 60_000,
    lastPrompt: "the work",
    waiting: null,
  } as Card;
  const lookup = vi.fn(async (): Promise<Card | undefined> => card);
  const exited = () => surface.input.some((i) => i.value === "/exit");
  const state = () => closingState(sessionId, card);
  return { sessionId, surface, card, lookup, exited, state };
}

// The macro's turn starting: the transcript moves on past the paste.
function turnStarts(card: Card) {
  card.column = "working";
  card.lastActivityAt = Date.now() + 1;
}

const poll = () => vi.advanceTimersByTimeAsync(3000);

function gitRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "seamux-close-repo-"));
  execFileSync("git", ["init", "-q", dir]);
  return dir;
}

describe("closeSession", () => {
  it("sends the close-session macro, then exits once its turn ends", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    expect(c.surface.input[0].value).toContain("Clean up after yourself");
    expect(c.state()).toMatchObject({ state: "cleaning" });

    turnStarts(c.card);
    await poll();
    expect(c.exited()).toBe(false);
    c.card.column = "idle";
    await poll();
    await vi.waitFor(() => expect(c.exited()).toBe(true));
    await vi.waitFor(() => expect(c.state()).toBeNull());
  });

  it("refuses a second close while the first is cleaning up", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    await expect(closeSession(c.card, [c.card], c.lookup)).rejects.toThrow(
      /Already cleaning up/,
    );
  });

  it("holds a chat whose macro never started a turn", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    await vi.advanceTimersByTimeAsync(63_000);
    await vi.waitFor(() =>
      expect(c.state()).toMatchObject({
        state: "held",
        note: expect.stringMatching(/never started a turn/),
        retry: true,
      }),
    );
    expect(c.exited()).toBe(false);
  });

  it("sends the macro again when closing a chat whose macro never started a turn", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    await vi.advanceTimersByTimeAsync(63_000);
    await vi.waitFor(() => expect(c.state()).toMatchObject({ retry: true }));
    const typed = c.surface.input.length;

    await closeSession(c.card, [c.card], c.lookup);
    const again = c.surface.input
      .slice(typed)
      .map((i) => i.value)
      .join("");
    expect(again).toContain("Clean up after yourself");
    expect(c.exited()).toBe(false);
    expect(c.state()).toMatchObject({ state: "cleaning" });
  });

  it("keeps waiting while the clean-up runs, however long", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    turnStarts(c.card);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(c.state()).toMatchObject({ state: "cleaning" });
    expect(c.exited()).toBe(false);
  });

  it("holds a chat whose clean-up is still running after 30 minutes", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    turnStarts(c.card);
    await vi.advanceTimersByTimeAsync(31 * 60_000);
    await vi.waitFor(() =>
      expect(c.state()).toMatchObject({
        state: "held",
        note: expect.stringMatching(/after 30 minutes/),
      }),
    );
    expect(c.exited()).toBe(false);
  });

  it("holds a chat whose turn ended by asking the user something", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    turnStarts(c.card);
    await poll();
    c.card.column = "waiting";
    c.card.waiting = {
      reason: ASKED_IN_REPLY,
      tool: null,
      detail: null,
      ask: null,
    } as Card["waiting"];
    await poll();
    await vi.waitFor(() =>
      expect(c.state()).toMatchObject({
        state: "held",
        note: expect.stringMatching(/asked you something/),
      }),
    );
    expect(c.exited()).toBe(false);
  });

  it("holds a chat that leaves uncommitted changes", async () => {
    const repo = gitRepo();
    writeFileSync(join(repo, "notes.txt"), "unsaved");
    const c = chat(repo);
    await closeSession(c.card, [c.card], c.lookup);
    turnStarts(c.card);
    await poll();
    c.card.column = "idle";
    await poll();
    await vi.waitFor(() =>
      expect(c.state()).toMatchObject({
        state: "held",
        note: expect.stringMatching(/uncommitted changes/),
      }),
    );
    expect(c.exited()).toBe(false);
  });

  it.each([".agents/.worktrees", ".claude/worktrees", "worktrees"])(
    "holds a chat whose worktree in %s is still there",
    async (home) => {
      const worktree = join(
        mkdtempSync(join(tmpdir(), "seamux-close-")),
        home,
        "feature",
      );
      mkdirSync(join(worktree, "src"), { recursive: true });
      const c = chat(join(worktree, "src"));
      await closeSession(c.card, [c.card], c.lookup);
      turnStarts(c.card);
      await poll();
      c.card.column = "idle";
      await poll();
      await vi.waitFor(() =>
        expect(c.state()).toMatchObject({
          state: "held",
          note: expect.stringMatching(/worktree is still there/),
        }),
      );
      expect(c.exited()).toBe(false);
    },
  );

  it("exits a held chat on the next close, without the macro", async () => {
    const repo = gitRepo();
    writeFileSync(join(repo, "notes.txt"), "unsaved");
    const c = chat(repo);
    await closeSession(c.card, [c.card], c.lookup);
    turnStarts(c.card);
    await poll();
    c.card.column = "idle";
    await poll();
    await vi.waitFor(() => expect(c.state()).toMatchObject({ state: "held" }));
    const typed = c.surface.input.length;

    await closeSession(c.card, [c.card], c.lookup);
    expect(c.surface.input.slice(typed).map((i) => i.value)).toEqual([
      "/exit",
      "enter",
    ]);
    expect(c.state()).toBeNull();
  });

  it("stops watching a chat that closed another way", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    turnStarts(c.card);
    c.lookup.mockResolvedValue(undefined);
    await poll();
    await vi.waitFor(() => expect(c.state()).toBeNull());
    const polls = c.lookup.mock.calls.length;
    await poll();
    expect(c.lookup.mock.calls.length).toBe(polls);
    expect(c.exited()).toBe(false);
  });

  it("drops a held note once the chat is given another prompt", async () => {
    const c = chat();
    await closeSession(c.card, [c.card], c.lookup);
    await vi.advanceTimersByTimeAsync(63_000);
    await vi.waitFor(() => expect(c.state()).toMatchObject({ state: "held" }));
    c.card.lastPrompt = "something else";
    expect(c.state()).toBeNull();
  });

  it("tells the session which other sessions share its repo", async () => {
    const repo = gitRepo();
    const c = chat(repo);
    const sibling = {
      ...c.card,
      sessionId: "other",
      name: "fix-login",
      cwd: join(repo, "worktrees/fix-login"),
      column: "working",
    } as Card;
    // The default macro names its siblings through {siblings}.
    await closeSession(c.card, [c.card, sibling], c.lookup);
    const typed = c.surface.input.map((i) => i.value).join("");
    expect(typed).toContain("fix-login (worktree fix-login)");
  });
});
