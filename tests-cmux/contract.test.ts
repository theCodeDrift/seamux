// seamux's contract with cmux, checked against the real thing: every
// behaviour app/lib/drive.server.ts and board.server.ts rely on, and that
// tests/fake-cmux.ts imitates. When cmux changes one, a test here fails, and
// the fake and seamux both need to follow.
//
// `npm run test:cmux`, from a cmux terminal. Not in CI.

import { execFileSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CMUX_BIN } from "~/lib/bins.server";
import { CmuxError, cmuxCli, cmuxRpc } from "~/lib/cmux.server";
import type { ReplayGrid } from "~/lib/harness.server";
import { KEYS } from "../tests/fake-cmux";
import {
  closeThrowaways,
  eventually,
  listedWorkspace,
  marker,
  screen,
  shows,
  throwaway,
  workspaceGone,
} from "./cmux";

afterEach(closeThrowaways);

// A plain interactive shell to type into, which stays open.
const SHELL = "exec /bin/sh -i";

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error("cmux accepted it");
    },
    (err: unknown) => {
      if (!(err instanceof CmuxError)) throw err;
      return err;
    },
  );

describe("the socket protocol", () => {
  it("answers a request with its result", async () => {
    await expect(cmuxRpc("system.ping")).resolves.toEqual({ pong: true });
  });

  it("refuses an unknown method as method_not_found", async () => {
    const err = await refusal(cmuxRpc("seamux.no_such_method"));
    expect(err.code).toBe("method_not_found");
  });
});

describe("workspaces", () => {
  // drive.server.ts launch(): every session seamux starts.
  it("workspace.create returns the new workspace and surface, unfocused", async () => {
    const t = await throwaway(SHELL);
    expect(t.workspaceId).toMatch(/^[0-9A-F-]{36}$/);
    expect(t.surfaceId).toMatch(/^[0-9A-F-]{36}$/);
  });

  // board.server.ts cmuxWorkspaces(), drive.server.ts namesInUse(). A new
  // workspace shows up a moment after workspace.create returns.
  it("workspace.list reports id, ref, title and directory", async () => {
    const t = await throwaway(SHELL);
    const listed = await eventually(
      () => listedWorkspace(t.workspaceId),
      "the new workspace to be listed",
    );
    expect(listed).toMatchObject({
      id: t.workspaceId,
      ref: expect.stringMatching(/^workspace:\d+$/),
      title: t.title,
      current_directory: t.cwd,
    });
  });

  // renameLive(). Like a new workspace, a new title is listed a moment later.
  it("workspace.rename retitles it", async () => {
    const t = await throwaway(SHELL);
    const title = marker("renamed");
    await cmuxRpc("workspace.rename", { workspace_id: t.workspaceId, title });
    await eventually(
      async () => (await listedWorkspace(t.workspaceId))?.title === title,
      "the new title to be listed",
    );
  });

  // closeChat(): a workspace seamux launched goes with its agent.
  it("closes itself when its initial_command exits", async () => {
    const t = await throwaway("exit 0");
    await workspaceGone(t.workspaceId);
  });

  // closeChat() on a chat started by hand, and its not_found tolerance.
  it("workspace.close closes it, and a closed one is not_found", async () => {
    const t = await throwaway(SHELL);
    await cmuxRpc("workspace.close", { workspace_id: t.workspaceId });
    await workspaceGone(t.workspaceId);
    const err = await refusal(
      cmuxRpc("surface.list", { workspace_id: t.workspaceId }),
    );
    expect(err).toMatchObject({
      code: "not_found",
      message: expect.stringMatching(/Workspace not found/),
    });
  });
});

describe("initial_command", () => {
  // launch() wraps its command in `exec $SHELL -ic`, because of this.
  it("runs in a login shell that is not interactive, so skips ~/.zshrc", async () => {
    const m = marker("shell");
    const t = await throwaway(
      `[[ -o login ]] && L=login || L=nologin; [[ -o interactive ]] && I=interactive || I=noninteractive; echo "${m} $L $I"; sleep 30`,
    );
    await shows(t, `${m} login noninteractive`);
  });

  it("runs in the cwd it was given", async () => {
    const m = marker("cwd");
    const t = await throwaway(`echo "${m} $(pwd -P)"; sleep 30`);
    await shows(t, `${m} ${t.cwd}`);
  });
});

describe("surfaces", () => {
  // closeChat(), renameLive(): how many tabs a workspace has.
  it("surface.list lists the workspace's surfaces by id", async () => {
    const t = await throwaway(SHELL);
    const { surfaces } = await cmuxRpc<{ surfaces: { id: string }[] }>(
      "surface.list",
      { workspace_id: t.workspaceId },
    );
    expect(surfaces.map((s) => s.id)).toEqual([t.surfaceId]);
  });

  // readScreen(): dialogs, the trust prompt, Codex approvals.
  it("surface.read_text returns the screen as text", async () => {
    const m = marker("screen");
    const t = await throwaway(`echo ${m}; sleep 30`);
    await shows(t, m);
    const result = await cmuxRpc<Record<string, unknown>>(
      "surface.read_text",
      t.target,
    );
    expect(result.text).toEqual(expect.any(String));
  });

  // readDraft(): the prompt box, less the faint text that typed text never
  // is, Claude Code's placeholder and its suggestion of what to send.
  it("terminal.replay draws the screen as runs of text, the faint ones marked", async () => {
    const m = marker("replay");
    const t = await throwaway(
      `printf 'plain-${m} \\033[2mfaint-${m}\\033[0m\\n'; sleep 30`,
    );
    await shows(t, `faint-${m}`);
    const { render_grid: grid } = await cmuxRpc<{ render_grid: ReplayGrid }>(
      "terminal.replay",
      t.target,
    );
    expect(grid.columns).toEqual(expect.any(Number));
    const faint = new Set(
      grid.styles.filter((s) => s.faint).map((s) => s.id),
    );
    const span = (text: string) =>
      grid.row_spans.find((s) => s.text.includes(text))!;
    expect(span(`plain-${m}`)).toMatchObject({
      row: expect.any(Number),
      column: 0,
      cell_width: expect.any(Number),
    });
    expect(faint.has(span(`plain-${m}`).style_id)).toBe(false);
    expect(faint.has(span(`faint-${m}`).style_id)).toBe(true);
  });

  // sendMessage(), answerQuestion(): typed text, then Enter.
  it("surface.send_text types, and send_key enter submits", async () => {
    const t = await throwaway(SHELL);
    const m = marker("typed");
    await shows(t, "$");
    await cmuxRpc("surface.send_text", { ...t.target, text: `echo ${m}-ok` });
    await cmuxRpc("surface.send_key", { ...t.target, key: "enter" });
    await shows(t, `\n${m}-ok`);
  });

  // sendMessage() for multi-line text and Codex, closeChat()'s /exit.
  it("terminal.paste pastes, and send_key enter submits", async () => {
    const t = await throwaway(SHELL);
    const m = marker("pasted");
    await shows(t, "$");
    await cmuxRpc("terminal.paste", { ...t.target, text: `echo ${m}-ok` });
    await cmuxRpc("surface.send_key", { ...t.target, key: "enter" });
    await shows(t, `\n${m}-ok`);
  });

  // interrupt(), answerApproval(), answerQuestion(), acceptTrust(). The fake
  // accepts these keys and no others.
  it("surface.send_key knows every key seamux presses", async () => {
    const t = await throwaway(SHELL);
    await shows(t, "$");
    for (const key of KEYS) {
      await expect(
        cmuxRpc("surface.send_key", { ...t.target, key }),
        key,
      ).resolves.toBeDefined();
    }
  });

  it("surface.send_key refuses a key it doesn't know as invalid_params", async () => {
    const t = await throwaway(SHELL);
    const err = await refusal(
      cmuxRpc("surface.send_key", { ...t.target, key: "seamux-no-such-key" }),
    );
    expect(err).toMatchObject({ code: "invalid_params", message: expect.stringMatching(/Unknown key/) });
  });

  // What the fake answers for a surface the workspace doesn't have.
  it("refuses a surface its workspace doesn't have as invalid_params", async () => {
    const t = await throwaway(SHELL);
    const err = await refusal(
      cmuxRpc("surface.read_text", {
        workspace_id: t.workspaceId,
        surface_id: "00000000-0000-0000-0000-000000000000",
      }),
    );
    expect(err.code).toBe("invalid_params");
  });

  // closeChat(): why the last tab goes by closing its workspace.
  it("surface.close refuses a workspace's last surface", async () => {
    const t = await throwaway(SHELL);
    const err = await refusal(cmuxRpc("surface.close", t.target));
    expect(err).toMatchObject({
      code: "invalid_state",
      message: expect.stringMatching(/Cannot close the last surface/),
    });
  });
});

describe("the cmux command", () => {
  // listLive(): which sessions are live, and where.
  it("sessions list --json reports the fields seamux reads", async () => {
    const { sessions } = JSON.parse(
      await cmuxCli(["sessions", "list", "--json"], {
        maxBuffer: 16 * 1024 * 1024,
      }),
    ) as { sessions: Record<string, unknown>[] };
    expect(Array.isArray(sessions)).toBe(true);
    for (const s of sessions) {
      expect(s).toMatchObject({
        session_id: expect.any(String),
        agent: expect.any(String),
        active_for_surface: expect.any(Boolean),
        surface_id: expect.any(String),
        workspace_id: expect.any(String),
      });
      // null when cmux's record has lost the session's pid.
      expect(s.stored_pid_exists).toSatisfy(
        (v: unknown) => v === null || typeof v === "boolean",
      );
      // What a stored pid runs now, to tell a pid handed on to another
      // process from the session's own.
      for (const key of ["launch_arguments", "stored_pid_arguments"]) {
        expect(s[key] ?? []).toSatisfy(
          (v: unknown) =>
            Array.isArray(v) && v.every((a) => typeof a === "string"),
        );
      }
      expect(s.transcript_path ?? null).toSatisfy(
        (v: unknown) => v === null || typeof v === "string",
      );
    }
  });

  // launch(): the wrappers that start each agent and register it with cmux.
  it("ships the agent wrappers seamux launches through", () => {
    for (const wrapper of ["cmux-claude-wrapper", "cmux-codex-wrapper"]) {
      expect(() => accessSync(join(CMUX_BIN, wrapper), constants.X_OK), wrapper)
        .not.toThrow();
    }
  });

  it("reports its version", () => {
    // Printed with the results, so a failure says which cmux changed.
    const version = execFileSync("cmux", ["--version"], { encoding: "utf8" });
    console.log(`checked against ${version.trim()}`);
    expect(version).toMatch(/^cmux \d+\.\d+\.\d+/);
  });
});
