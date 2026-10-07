// What seamux's write verbs (app/lib/drive.server.ts) send to cmux: which
// methods, with which params, in which order. Each is the contract a working
// board depends on, and each was measured against cmux and Claude Code by
// hand first (knowledge/); these keep it from drifting.

import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ENGINE_FEATURES, ENGINES } from "~/lib/config";
import {
  answerApproval,
  answerDialog,
  answerQuestion,
  closeChat,
  dispatch,
  fork,
  interrupt,
  listLive,
  readDialog,
  renameLive,
  resume,
  resumeTurn,
  sendMessage,
  UnsentError,
} from "~/lib/drive.server";
import { HARNESSES } from "~/lib/harness.server";
import { FakeCmux, type FakeSurface } from "./fake-cmux";

let cmux: FakeCmux;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  // Every call that acts on a terminal names it, both surface and workspace:
  // cmux falls back to the caller's own terminal otherwise, which is
  // whatever seamux runs in (CLAUDE.md).
  for (const r of cmux.requests) {
    if (
      /^(surface\.(send_text|send_key|read_text|close)|terminal\.paste)$/.test(
        r.method,
      )
    ) {
      expect(r.params, r.method).toMatchObject({
        surface_id: expect.any(String),
        workspace_id: expect.any(String),
      });
    }
  }
  await cmux.stop();
});

const input = (surface: FakeSurface) =>
  surface.input.map((i) => `${i.kind}:${i.value}`);

describe("listLive", () => {
  it("lists the sessions cmux says are live, with their surfaces", async () => {
    const claude = cmux.addSession("claude-live", {
      cwd: "/work/a",
    });
    const codex = cmux.addSession("codex-live", {
      agent: "codex",
      // cmux never marks a Codex session active for its surface.
      active_for_surface: false,
      transcript_path: "/codex/rollout.jsonl",
    });
    cmux.addSession("claude-inactive", { active_for_surface: false });
    cmux.addSession("claude-dead", { stored_pid_exists: false });
    cmux.addSession("amp-live", { agent: "amp" });

    const live = await listLive();

    expect([...live.keys()].sort()).toEqual(["claude-live", "codex-live"]);
    expect(live.get("claude-live")).toEqual({
      engine: "claude",
      surface: {
        surfaceId: claude.surface.id,
        workspaceId: claude.workspace.id,
      },
      cwd: "/work/a",
      transcript: null,
    });
    expect(live.get("codex-live")).toMatchObject({
      engine: "codex",
      transcript: "/codex/rollout.jsonl",
    });
    expect(live.get("codex-live")!.surface.surfaceId).toBe(codex.surface.id);
  });

  it("asks claude agents about a Claude session whose pid cmux lost", async () => {
    const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
    // claude agents lists this test's own process, which is alive, and a pid
    // no process has.
    writeFileSync(
      agents,
      JSON.stringify([
        { sessionId: "claude-pidless", pid: process.pid },
        { sessionId: "claude-pidless-dead", pid: 2 ** 22 + 1 },
      ]),
    );
    try {
      const claude = cmux.addSession("claude-pidless", {
        stored_pid_exists: null,
      });
      cmux.addSession("claude-pidless-dead", { stored_pid_exists: null });
      cmux.addSession("claude-pidless-unlisted", { stored_pid_exists: null });

      const live = await listLive();

      expect([...live.keys()]).toEqual(["claude-pidless"]);
      expect(live.get("claude-pidless")!.surface.surfaceId).toBe(
        claude.surface.id,
      );
    } finally {
      rmSync(agents, { force: true });
    }
  });
});

describe("sendMessage", () => {
  it("types a one-line message into Claude Code, then presses Enter", async () => {
    const { surface } = cmux.addSession("s");
    await sendMessage("s", "fix the login");
    expect(input(surface)).toEqual(["text:fix the login", "key:enter"]);
  });

  it("types a message with line breaks, with Shift+Enter between its lines", async () => {
    const { surface } = cmux.addSession("s");
    await sendMessage("s", "one\ntwo\r\nthree");
    expect(input(surface)).toEqual([
      "text:one",
      "key:shift+enter",
      "text:two",
      "key:shift+enter",
      "text:three",
      "key:enter",
    ]);
  });

  it("types a long message a little at a time, which Claude Code would otherwise take for a paste", async () => {
    const { surface } = cmux.addSession("s");
    const text = "x".repeat(250);
    await sendMessage("s", text);
    expect(input(surface)).toEqual([
      `text:${"x".repeat(100)}`,
      `text:${"x".repeat(100)}`,
      `text:${"x".repeat(50)}`,
      "key:enter",
    ]);
  });

  it("pastes a message with a tab, which typing would autocomplete", async () => {
    const { surface } = cmux.addSession("s");
    await sendMessage("s", "a\tb");
    expect(input(surface)).toEqual(["paste:a\tb", "key:enter"]);
  });

  // The prompt box as Claude Code draws it, holding `text`.
  const promptBox = (text: string) =>
    [
      "⏺ ok",
      "─".repeat(40),
      `❯ ${text}`,
      "─".repeat(40),
      "  ⏸ manual mode on",
    ].join("\n");

  // A typed carriage return, as each try after the first Enter is, sends.
  const sends = (s: { screen: string }, i: { kind: string; value: string }) => {
    if (i.kind === "text")
      s.screen = promptBox(i.value === "\r" ? "" : i.value);
  };

  it("types a carriage return while the message still sits in the prompt box", async () => {
    const { surface } = cmux.addSession("s");
    // The Enter is lost, as it is while Claude Code takes a paste in.
    cmux.onInput(sends);
    await sendMessage("s", "fix the login");
    expect(input(surface)).toEqual([
      "text:fix the login",
      "key:enter",
      "text:\r",
    ]);
  });

  it("tries again when Claude Code holds a message it stripped invisible characters from", async () => {
    const { surface } = cmux.addSession("s");
    let tries = 0;
    cmux.onInput((s, i) => {
      if (i.value !== "enter" && i.value !== "\r") return;
      s.screen = promptBox(++tries > 1 ? "" : "fix the login");
    });
    await sendMessage("s", "fix the\u200b login\u00ad");
    expect(input(surface)).toEqual([
      "text:fix the\u200b login\u00ad",
      "key:enter",
      "text:\r",
    ]);
  });

  it("says so when the message never leaves the prompt box", async () => {
    const { surface } = cmux.addSession("s");
    cmux.onInput((s, i) => {
      if (i.kind === "text" && i.value !== "\r") s.screen = promptBox(i.value);
    });
    await expect(sendMessage("s", "fix the login")).rejects.toBeInstanceOf(
      UnsentError,
    );
    expect(input(surface).slice(-4)).toEqual([
      "key:enter",
      "text:\r",
      "text:\r",
      "text:\r",
    ]);
  });

  // A draft in the prompt box, which takes the clearing keys as Claude Code
  // and Codex do: Ctrl+U empties the line, Backspace on an empty one joins
  // it to the one above, or leaves shell mode in an empty box.
  const draft = (
    surface: { screen: string },
    lines: string[],
    { shell = false, lead = "❯", stuck = false } = {},
  ) => {
    const draw = () => {
      const [first, ...rest] = lines;
      surface.screen = [
        "⏺ ok",
        `${shell ? "!" : lead} ${first}`,
        ...rest.map((l) => `  ${l}`),
        "",
        "  footer",
      ].join("\n");
    };
    draw();
    cmux.onInput((s, i) => {
      if (s !== surface || i.kind !== "text") return;
      if (i.value === "\x15") lines[lines.length - 1] = "";
      else if (i.value === "\x7f") {
        if (lines.length > 1) lines.pop();
        else if (!stuck) shell = false;
      } else return;
      draw();
    });
  };

  it("clears a draft from the prompt box a line at a time before typing", async () => {
    const { surface } = cmux.addSession("s");
    draft(surface, ["half a thought", "and more"]);
    await sendMessage("s", "fix the login");
    const round = ["text:\x05", "text:\x15", "text:\x7f"];
    expect(input(surface)).toEqual([
      ...round,
      ...round,
      ...round,
      "text:fix the login",
      "key:enter",
    ]);
  });

  it("takes the prompt box out of shell mode, where Enter would run it as shell commands", async () => {
    const { surface } = cmux.addSession("s");
    draft(surface, ["Any thoughts?"], { shell: true });
    await sendMessage("s", "fix the login");
    expect(input(surface).slice(-2)).toEqual([
      "text:fix the login",
      "key:enter",
    ]);
    expect(surface.screen).toContain("❯");
  });

  it("refuses a prompt box that stays in shell mode", async () => {
    const { surface } = cmux.addSession("s");
    draft(surface, ["Any thoughts?"], { shell: true, stuck: true });
    await expect(sendMessage("s", "fix the login")).rejects.toThrow(
      /shell mode/,
    );
    expect(input(surface)).not.toContain("text:fix the login");
  });

  it("types one message at a time into a chat, never interleaving two", async () => {
    const { surface } = cmux.addSession("s");
    await Promise.all([
      sendMessage("s", "first\nline"),
      sendMessage("s", "second\nline"),
    ]);
    expect(input(surface)).toEqual([
      "text:first",
      "key:shift+enter",
      "text:line",
      "key:enter",
      "text:second",
      "key:shift+enter",
      "text:line",
      "key:enter",
    ]);
  });

  it("always pastes into Codex, which folds long typed input", async () => {
    const { surface } = cmux.addSession("s", {
      agent: "codex",
      active_for_surface: false,
    });
    await sendMessage("s", "short");
    expect(input(surface)).toEqual(["paste:short", "key:enter"]);
  });

  it("refuses a session that isn't running in cmux", async () => {
    await expect(sendMessage("gone", "hello")).rejects.toThrow(
      "This session is not running in a cmux surface",
    );
    expect(cmux.requests).toEqual([]);
  });
});

describe("resumeTurn", () => {
  it("sends Claude Code one line telling it to carry on", async () => {
    const { surface } = cmux.addSession("s");
    await resumeTurn("s");
    expect(input(surface)).toEqual(["text:continue", "key:enter"]);
  });
});

describe("interrupt", () => {
  it("presses Esc", async () => {
    const { surface } = cmux.addSession("s");
    await interrupt("s");
    expect(input(surface)).toEqual(["key:escape"]);
  });
});

describe("answerApproval", () => {
  it("approves Claude Code with 1, which is always Yes", async () => {
    const { surface } = cmux.addSession("s");
    await answerApproval("s", true, "claude");
    expect(input(surface)).toEqual(["text:1"]);
  });

  it("approves Codex with y", async () => {
    const { surface } = cmux.addSession("s", {
      agent: "codex",
      active_for_surface: false,
    });
    await answerApproval("s", true, "codex");
    expect(input(surface)).toEqual(["text:y"]);
  });

  it("denies with Esc, since No has no fixed number", async () => {
    const { surface } = cmux.addSession("s");
    await answerApproval("s", false, "claude");
    expect(input(surface)).toEqual(["key:escape"]);
  });
});

describe("answerQuestion", () => {
  const question = (multiSelect: boolean) => ({
    question: "Which one?",
    header: "Pick",
    multiSelect,
    options: [
      { label: "A", description: null, preview: null },
      { label: "B", description: null, preview: null },
    ],
  });

  it("picks a single-select option with its digit", async () => {
    const { surface } = cmux.addSession("s");
    await answerQuestion("s", [question(false)], [{ picks: [1] }]);
    expect(input(surface)).toEqual(["text:2"]);
  });

  it("toggles multi-select options, tabs on, and submits the review", async () => {
    const { surface } = cmux.addSession("s");
    await answerQuestion("s", [question(true)], [{ picks: [0, 1] }]);
    expect(input(surface)).toEqual(["text:1", "text:2", "key:tab", "text:1"]);
  });

  it("types an answer of its own into the row after the options", async () => {
    const { surface } = cmux.addSession("s");
    await answerQuestion("s", [question(false)], [{ text: "neither" }]);
    expect(input(surface)).toEqual(["text:3", "text:neither", "key:enter"]);
  });
});

describe("dialogs", () => {
  const screen = [
    "● Some earlier reply",
    "",
    "────────────────────────────────",
    " Background work is running",
    " A shell is still running.",
    "",
    " ❯ 1. Exit and stop tasks",
    "   2. Move to background and exit",
    "   3. Stay",
    "",
    " Esc to cancel",
  ].join("\n");

  it("reads a numbered dialog off the screen", async () => {
    const { surface, workspace } = cmux.addSession("s");
    surface.screen = screen;
    const dialog = await readDialog({
      surfaceId: surface.id,
      workspaceId: workspace.id,
    });
    expect(dialog).toMatchObject({
      title: "Background work is running",
      detail: ["A shell is still running."],
      options: ["Exit and stop tasks", "Move to background and exit", "Stay"],
    });
    expect(cmux.calls("surface.read_text")).toHaveLength(1);
  });

  it("answers the dialog still open with the option's digit", async () => {
    const { surface, workspace } = cmux.addSession("s");
    surface.screen = screen;
    const { key } = (await readDialog({
      surfaceId: surface.id,
      workspaceId: workspace.id,
    }))!;
    await answerDialog("s", key, 2);
    expect(input(surface)).toEqual(["text:3"]);
  });

  // A tool's own confirmation, as Claude Code 2.1.289 shows the Artifact
  // tool's delete: no numbers, and digits do nothing.
  const unnumbered = [
    "────────────────────────────────",
    ' Permanently delete "Demo Night"?',
    "",
    " ❯ No",
    "   Yes",
    "",
    " Esc to cancel · Tab to amend",
  ].join("\n");

  it("reads a dialog with no numbers, and where its cursor is", async () => {
    const { surface, workspace } = cmux.addSession("s");
    surface.screen = unnumbered;
    const dialog = await readDialog({
      surfaceId: surface.id,
      workspaceId: workspace.id,
    });
    expect(dialog).toMatchObject({
      title: 'Permanently delete "Demo Night"?',
      detail: [],
      options: ["No", "Yes"],
      cursor: 0,
    });
  });

  it("walks the cursor to the option and presses Enter where digits do nothing", async () => {
    const { surface, workspace } = cmux.addSession("s");
    surface.screen = unnumbered;
    const { key } = (await readDialog({
      surfaceId: surface.id,
      workspaceId: workspace.id,
    }))!;
    await answerDialog("s", key, 1);
    expect(input(surface)).toEqual(["key:down", "key:enter"]);
  });

  it("types nothing once the dialog has gone", async () => {
    const { surface } = cmux.addSession("s");
    surface.screen = "❯ ";
    await expect(answerDialog("s", "stale", 0)).rejects.toThrow(
      "That dialog is no longer open",
    );
    expect(input(surface)).toEqual([]);
  });
});

describe("closeChat", () => {
  // The terminal's side: /exit and Enter end the session, as Claude Code does.
  const exitsOnEnter = (sessionId: string) =>
    cmux.onInput((surface, i) => {
      if (i.kind === "key" && surface.input.at(-2)?.value === "/exit") {
        cmux.endSession(sessionId);
      }
    });

  it("sends /exit, then closes the workspace it was the only tab of", async () => {
    const { surface, workspace } = cmux.addSession("s");
    exitsOnEnter("s");
    await closeChat("s");
    expect(input(surface)).toEqual(["paste:/exit", "key:enter"]);
    expect(cmux.calls("workspace.close")).toEqual([
      expect.objectContaining({ params: { workspace_id: workspace.id } }),
    ]);
    expect(cmux.workspaces).toEqual([]);
  });

  it("closes only its tab when the workspace has others", async () => {
    const { surface, workspace } = cmux.addSession("s");
    const other = cmux.addSurface(workspace);
    exitsOnEnter("s");
    await closeChat("s");
    expect(cmux.calls("surface.close")).toEqual([
      expect.objectContaining({
        params: { surface_id: surface.id, workspace_id: workspace.id },
      }),
    ]);
    expect(workspace.surfaces).toEqual([other]);
  });

  it("clears the prompt box before typing /exit", async () => {
    const { surface } = cmux.addSession("s", {
      agent: "codex",
      active_for_surface: false,
    });
    surface.screen = "› a draft";
    cmux.onInput((s, i) => {
      if (i.value === "\x15") s.screen = "›";
      if (i.kind === "key" && s.input.at(-2)?.value === "/exit")
        cmux.endSession("s");
    });
    await closeChat("s");
    expect(input(surface)).toEqual([
      "text:\x05",
      "text:\x15",
      "text:\x7f",
      "text:\x05",
      "text:\x15",
      "text:\x7f",
      "paste:/exit",
      "key:enter",
    ]);
  });

  it("leaves nothing to close once the workspace closed itself", async () => {
    const { workspace } = cmux.addSession("s");
    cmux.onInput((_, i) => {
      if (i.kind === "key") {
        cmux.endSession("s");
        cmux.workspaces.splice(cmux.workspaces.indexOf(workspace), 1);
      }
    });
    await closeChat("s");
    expect(cmux.calls("workspace.close")).toEqual([]);
    expect(cmux.calls("surface.close")).toEqual([]);
  });
});

describe("renameLive", () => {
  it("sends /rename, and retitles a workspace it is the only tab of", async () => {
    const { surface, workspace } = cmux.addSession("s");
    await renameLive("s", "new name");
    expect(input(surface)).toEqual(["paste:/rename new name", "key:enter"]);
    expect(workspace.title).toBe("new name");
  });

  it("leaves a shared workspace's title alone", async () => {
    const { workspace } = cmux.addSession("s", { title: "shared" });
    cmux.addSurface(workspace);
    await renameLive("s", "new name");
    expect(cmux.calls("workspace.rename")).toEqual([]);
    expect(workspace.title).toBe("shared");
  });
});

describe("dispatch", () => {
  const dir = () =>
    realpathSync(mkdtempSync(join(tmpdir(), "seamux-dispatch-")));

  it("starts Claude Code in a new workspace through cmux's wrapper", async () => {
    const cwd = dir();
    const sessionId = await dispatch({ cwd, prompt: "Fix the login page" });

    const [create] = cmux.calls("workspace.create");
    expect(create.params).toMatchObject({
      cwd,
      title: "fix-the-login-page",
      focus: false,
    });
    const command = String(create.params.initial_command);
    // In the user's own interactive shell, so it gets their PATH.
    expect(command).toMatch(/^exec '[^']+' -ic '/);
    expect(command).toContain("cmux-claude-wrapper");
    expect(command).toContain(`--session-id`);
    expect(command).toContain(sessionId);
    expect(command).toContain("--name");
    expect(command).toContain("Fix the login page");
  });

  it("takes the next free name when a workspace already has it", async () => {
    cmux.addWorkspace({ title: "fix-the-login-page" });
    await dispatch({ cwd: dir(), prompt: "Fix the login page" });
    expect(cmux.calls("workspace.create")[0].params.title).toBe(
      "fix-the-login-page-2",
    );
  });

  it("answers the new-folder trust dialog, which nothing else reports", async () => {
    await dispatch({ cwd: dir(), prompt: "Trust me" });
    const created = cmux.workspaces.at(-1)!.surfaces[0];
    created.screen =
      "Do you trust the files in this folder?\n❯ 1. No, exit\n  2. Yes, I trust this folder";
    // Its default is "No, exit", so Down, then Enter.
    await vi.waitFor(
      () => expect(input(created)).toEqual(["key:down", "key:enter"]),
      {
        timeout: 5_000,
      },
    );
  });

  it("refuses an empty prompt before reaching cmux", async () => {
    await expect(dispatch({ cwd: dir(), prompt: "  " })).rejects.toThrow(
      "Say what the new session should do",
    );
    expect(cmux.calls("workspace.create")).toEqual([]);
  });

  // Codex takes no session id: it picks its own, which cmux files under the
  // new surface once the first prompt goes in.
  it("waits for cmux to file a session that picks its own id", async () => {
    const started = dispatch({
      cwd: dir(),
      engine: "codex",
      prompt: "Fix the login page",
    });
    await vi.waitFor(() =>
      expect(cmux.calls("workspace.create")).toHaveLength(1),
    );
    const command = String(
      cmux.calls("workspace.create")[0].params.initial_command,
    );
    expect(command).toContain("cmux-codex-wrapper");
    expect(command).not.toContain("--session-id");
    const created = cmux.workspaces.at(-1)!;
    cmux.sessions.push({
      session_id: "codex-picked",
      agent: "codex",
      active_for_surface: false,
      stored_pid_exists: true,
      surface_id: created.surfaces[0].id,
      workspace_id: created.id,
    });
    cmux.writeSessions();
    expect(await started).toBe("codex-picked");
  });
});

describe("fork", () => {
  it("is offered on the board for exactly the harnesses that can", () => {
    for (const engine of ENGINES) {
      expect(ENGINE_FEATURES[engine].fork, engine).toBe(
        HARNESSES[engine].fork !== undefined,
      );
    }
  });

  it("starts Claude Code on a copy of the parent's conversation", async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), "seamux-fork-")));
    const sessionId = await fork(
      "parent-id",
      cwd,
      "Try it another way",
      "claude",
    );
    const command = String(
      cmux.calls("workspace.create")[0].params.initial_command,
    );
    expect(command).toContain("--resume");
    expect(command).toContain("parent-id");
    expect(command).toContain("--fork-session");
    expect(command).toContain(sessionId);
  });

  it("refuses a harness that can't fork, before reaching cmux", async () => {
    await expect(
      fork("parent-id", "/tmp", "Try it another way", "codex"),
    ).rejects.toThrow("Codex chats can't be forked");
    expect(cmux.calls("workspace.create")).toEqual([]);
  });
});

describe("resume", () => {
  // A resumed Codex session stays filed under its old surface until its
  // next prompt, so seamux counts it live in the new one until then.
  it("keeps a resumed session cmux hasn't refiled live in its new surface", async () => {
    await resume("codex-old", "/tmp", "old chat", "codex");
    const created = cmux.workspaces.at(-1)!;
    const live = (await listLive()).get("codex-old");
    expect(live).toMatchObject({ engine: "codex" });
    expect(live!.surface.surfaceId).toBe(created.surfaces[0].id);
  });
});
