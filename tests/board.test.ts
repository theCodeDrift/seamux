// The board on a machine that is new to seamux (app/lib/board.server.ts):
// it has to load before Claude Code has ever run, and with only Codex
// installed, which seamux supports as much as Claude Code.

import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, expect, it } from "vitest";

import {
  distinctDirectories,
  loadBoard,
  loadMessages,
} from "~/lib/board.server";
import { DEFAULT_CONFIG, renderMacro } from "~/lib/config";
import { clearFailure, recordFailure } from "~/lib/send-failures.server";
import { FakeCmux } from "./fake-cmux";

let cmux: FakeCmux;
const path = process.env.PATH;

beforeEach(async () => {
  cmux = new FakeCmux(
    process.env.CMUX_SOCKET_PATH!,
    process.env.SEAMUX_TEST_CMUX_STATE!,
  );
  await cmux.start();
});

afterEach(async () => {
  process.env.PATH = path;
  await cmux.stop();
});

it("loads before Claude Code has ever run", async () => {
  // The test home has no ~/.claude/projects.
  const board = await loadBoard();
  expect(board.cards).toEqual([]);
  expect(board.warnings).toEqual([]);
  expect(board.sessionsKnown).toBe(true);
});

it("loads with only Codex installed, and no claude to run", async () => {
  // A PATH with the fake cmux but no claude at all.
  const bin = mkdtempSync(join(tmpdir(), "seamux-bin-"));
  copyFileSync(
    fileURLToPath(new URL("./bin/cmux", import.meta.url)),
    join(bin, "cmux"),
  );
  process.env.PATH = [bin, dirname(process.execPath), "/usr/bin", "/bin"].join(
    ":",
  );
  const board = await loadBoard();
  expect(board.cards).toEqual([]);
  expect(board.warnings).toEqual([]);
  expect(board.sessionsKnown).toBe(true);
});

it("says why when seamux was started outside cmux, in place of cmux's words", async () => {
  cmux.outsideCmux = true;
  const board = await loadBoard();
  expect(board.cmux).toMatchObject({ trouble: "outside_cmux" });
  expect(board.warnings).toEqual([]);
  expect(board.sessionsKnown).toBe(false);
});

it("says cmux isn't running when nothing listens on its socket", async () => {
  await cmux.stop();
  const board = await loadBoard();
  expect(board.cmux).toMatchObject({ trouble: "not_running" });
  expect(board.warnings).toEqual([]);
  expect(board.sessionsKnown).toBe(false);
  await cmux.start();
});

it("says cmux's socket is off when cmux runs but nothing listens", async () => {
  // A `ps` that lists cmux's app as running. Never a stand-in app: macOS
  // takes an unsigned one named cmux for the real app, damaged.
  const bin = mkdtempSync(join(tmpdir(), "seamux-ps-"));
  const app = join(process.env.SEAMUX_CMUX_APP!, "Contents/MacOS/cmux");
  writeFileSync(
    join(bin, "ps"),
    `#!/bin/sh\ncase "$*" in *comm=*) echo "${app}" ;; esac\n`,
    { mode: 0o755 },
  );
  process.env.PATH = `${bin}:${path}`;
  await cmux.stop();
  try {
    const board = await loadBoard();
    expect(board.cmux).toMatchObject({ trouble: "socket_off" });
    expect(board.warnings).toEqual([]);
  } finally {
    await cmux.start();
  }
});

it("runs the `cmux` command from cmux's app bundle when it isn't on PATH", async () => {
  cmux.addSession("3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c16");
  process.env.PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  const board = await loadBoard();
  expect(board.cmux).toBeNull();
  expect(board.warnings).toEqual([]);
});

it("says cmux isn't installed when there is no `cmux` command at all", async () => {
  const bundled = join(
    process.env.SEAMUX_CMUX_APP!,
    "Contents/Resources/bin/cmux",
  );
  const away = `${bundled}.away`;
  renameSync(bundled, away);
  process.env.PATH = [dirname(process.execPath), "/usr/bin", "/bin"].join(":");
  try {
    const board = await loadBoard();
    expect(board.cmux).toMatchObject({ trouble: "not_installed" });
  } finally {
    renameSync(away, bundled);
  }
});

it("shows `!` commands, and what a backgrounded one wrote", async () => {
  // As Claude Code logs them: a command that ran past its timeout records
  // only where its output went, and one still running has no output yet.
  const sessionId = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c15";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  const tasks = join(mkdtempSync(join(tmpdir(), "seamux-tasks-")), "tasks");
  mkdirSync(project, { recursive: true });
  mkdirSync(tasks);
  const output = join(tasks, "baou49weh.output");
  writeFileSync(
    output,
    "Open this URL in your browser:\n  https://example.test/verify\n",
  );
  const user = (content: string, at: string) =>
    JSON.stringify({
      type: "user",
      timestamp: at,
      message: { role: "user", content },
    });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      user("<bash-input> echo hi</bash-input>", "2026-01-01T00:00:00Z"),
      user(
        "<bash-stdout>hi</bash-stdout><bash-stderr></bash-stderr>",
        "2026-01-01T00:00:01Z",
      ),
      user("<bash-input>tool auth login</bash-input>", "2026-01-01T00:00:02Z"),
      user(
        `<bash-stdout>Command did not complete within its 120s timeout and was moved to the background (ID: baou49weh). Output is being written to: ${output}. You will be notified when it completes.</bash-stdout><bash-stderr></bash-stderr>`,
        "2026-01-01T00:02:02Z",
      ),
      user("<bash-input>sleep 600</bash-input>", "2026-01-01T00:03:00Z"),
    ].join("\n") + "\n",
  );

  const messages = (await loadMessages(sessionId))?.messages;
  expect(messages).toEqual([
    {
      role: "shell",
      command: "echo hi",
      output: "hi",
      at: "2026-01-01T00:00:00Z",
    },
    {
      role: "shell",
      command: "tool auth login",
      output: expect.stringContaining("https://example.test/verify"),
      at: "2026-01-01T00:00:02Z",
    },
    {
      role: "shell",
      command: "sleep 600",
      output: null,
      at: "2026-01-01T00:03:00Z",
    },
  ]);
});

it("shows a prompt command as typed, and leaves local commands out", async () => {
  // As Claude Code 2.1.295 logs them: a prompt command's line, then its
  // expansion as a meta message; a local command starts with its name.
  const sessionId = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c18";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const user = (content: string, at: string, extra = {}) =>
    JSON.stringify({
      type: "user",
      timestamp: at,
      message: { role: "user", content },
      ...extra,
    });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      user(
        "<command-name>/rename</command-name>\n            <command-message>rename</command-message>\n            <command-args>demo</command-args>",
        "2026-01-01T00:00:00Z",
      ),
      user(
        "<command-message>opsx:apply</command-message>\n<command-name>/opsx:apply</command-name>",
        "2026-01-01T00:00:01Z",
      ),
      user("Implement tasks from an OpenSpec change.", "2026-01-01T00:00:01Z", {
        isMeta: true,
      }),
      user(
        "<command-message>push</command-message>\n<command-name>/push</command-name>\n<command-args>now</command-args>",
        "2026-01-01T00:00:02Z",
      ),
    ].join("\n") + "\n",
  );

  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "user", text: "/opsx:apply", at: "2026-01-01T00:00:01Z" },
    { role: "user", text: "/push now", at: "2026-01-01T00:00:02Z" },
  ]);
});

it("shows a run of tool calls as one row of tool names between replies", async () => {
  const sessionId = "6c2a9e14-7d3b-4f58-a1c6-0e9b8d7f2a31";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const assistant = (content: unknown[], at: string) =>
    JSON.stringify({
      type: "assistant",
      timestamp: at,
      message: { role: "assistant", content },
    });
  const tool = (name: string) => ({
    type: "tool_use",
    id: name,
    name,
    input: {},
  });
  const result = JSON.stringify({
    type: "user",
    timestamp: "2026-01-01T00:00:02Z",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "Bash",
          content: [{ type: "text", text: "output" }],
        },
      ],
    },
  });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      assistant([{ type: "text", text: "Looking." }], "2026-01-01T00:00:00Z"),
      assistant([tool("Bash")], "2026-01-01T00:00:01Z"),
      result,
      assistant([{ type: "thinking", thinking: "hm" }], "2026-01-01T00:00:03Z"),
      assistant([tool("Read"), tool("Bash")], "2026-01-01T00:00:04Z"),
      assistant(
        [tool("mcp__claude_ai_Linear__save_issue")],
        "2026-01-01T00:00:05Z",
      ),
      assistant([{ type: "text", text: "Done." }], "2026-01-01T00:00:06Z"),
    ].join("\n") + "\n",
  );

  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "assistant", text: "Looking.", at: "2026-01-01T00:00:00Z" },
    {
      role: "tools",
      calls: [
        { name: "Bash", count: 2 },
        { name: "Read", count: 1 },
        { name: "Linear save_issue", count: 1 },
      ],
      at: "2026-01-01T00:00:01Z",
    },
    { role: "assistant", text: "Done.", at: "2026-01-01T00:00:06Z" },
  ]);
});

it("reads the whole of a long transcript, and then only what was added", async () => {
  // Tool output once filled the last 2 MB the board read, so a chat showed
  // three of its hundred messages.
  const sessionId = "9e4b1f7a-2c8d-4a63-b5e0-7f1d3c9a6b42";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const file = join(project, `${sessionId}.jsonl`);
  const user = (content: unknown, at: string) =>
    JSON.stringify({
      type: "user",
      timestamp: at,
      message: { role: "user", content },
    }) + "\n";
  const big = [
    {
      type: "tool_result",
      tool_use_id: "t",
      content: "x".repeat(3 * 1024 * 1024),
    },
  ];
  writeFileSync(
    file,
    user("First", "2026-01-01T00:00:00Z") +
      user(big, "2026-01-01T00:00:01Z") +
      user("Second", "2026-01-01T00:00:02Z"),
  );
  expect(await loadMessages(sessionId, 1)).toEqual({
    messages: [{ role: "user", text: "Second", at: "2026-01-01T00:00:02Z" }],
    total: 2,
  });
  expect((await loadMessages(sessionId))?.messages.map((m) => m.at)).toEqual([
    "2026-01-01T00:00:00Z",
    "2026-01-01T00:00:02Z",
  ]);

  // A line still being written waits until it ends.
  const third = user("Third", "2026-01-01T00:00:03Z");
  appendFileSync(file, third.slice(0, 20));
  expect((await loadMessages(sessionId))?.total).toBe(2);
  appendFileSync(file, third.slice(20));
  expect((await loadMessages(sessionId))?.messages.at(-1)).toEqual({
    role: "user",
    text: "Third",
    at: "2026-01-01T00:00:03Z",
  });

  // A transcript replaced by a shorter one is read again from its start.
  writeFileSync(file, user("Only", "2026-01-01T00:00:04Z"));
  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "user", text: "Only", at: "2026-01-01T00:00:04Z" },
  ]);
});

it("offers a tool's own No/Yes confirmation as its options, not Approve", async () => {
  // As Claude Code 2.1.289 shows the Artifact tool's delete: unnumbered,
  // No first, and digits do nothing, so Approve's 1 would never answer it.
  const sessionId = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c17";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "Artifact",
            input: { action: "delete", url: "https://claude.ai/artifact/x" },
          },
        ],
      },
    }) + "\n",
  );
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  writeFileSync(
    agents,
    JSON.stringify([
      {
        pid: 1,
        cwd: "/work",
        kind: "interactive",
        startedAt: 0,
        sessionId,
        name: "demo",
        status: "waiting",
        waitingFor: "permission prompt",
      },
    ]),
  );
  const { surface } = cmux.addSession(sessionId);
  surface.screen = [
    "⏺ Artifact(delete · https://claude.ai/artifact/x)",
    "",
    "────────────────────────────────",
    ' Permanently delete "Demo Night"?',
    "",
    " ❯ No",
    "   Yes",
    "",
    " Esc to cancel · Tab to amend",
  ].join("\n");
  try {
    const board = await loadBoard();
    const card = board.cards.find((c) => c.sessionId === sessionId);
    expect(card?.waiting).toMatchObject({
      tool: "Artifact",
      approval: null,
      dialog: {
        title: 'Permanently delete "Demo Night"?',
        options: ["No", "Yes"],
        cursor: 0,
      },
    });
  } finally {
    rmSync(agents, { force: true });
  }
});

it("keeps a cleared chat drivable while cmux still files it under its old id", async () => {
  // /clear moves `claude agents` to the new id a moment before cmux.
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  writeFileSync(
    agents,
    JSON.stringify([
      {
        pid: 4242,
        cwd: "/work",
        kind: "interactive",
        startedAt: 0,
        sessionId: "after-clear",
        name: "demo",
        status: "idle",
      },
    ]),
  );
  const { workspace } = cmux.addSession("before-clear", { pid: 4242 });
  try {
    const board = await loadBoard();
    const card = board.cards.find((c) => c.sessionId === "after-clear");
    expect(card?.drivable).toBe(true);
    expect(card?.workspaceRef).toBe(workspace.ref);
  } finally {
    rmSync(agents, { force: true });
  }
});

// A Cursor chat as Cursor 2026.10.18 writes it: the transcript, which
// cmux names, and meta.json, which has where it runs and its title.
function cursorChat(id: string, cwd: string, title: string, lines: object[]) {
  const home = process.env.HOME!;
  const dir = join(home, ".cursor/projects/work-demo/agent-transcripts", id);
  mkdirSync(dir, { recursive: true });
  const transcript = join(dir, `${id}.jsonl`);
  writeFileSync(
    transcript,
    lines.map((l) => JSON.stringify(l) + "\n").join(""),
  );
  const chat = join(home, ".cursor/chats/7fc0827fc407a15740f8d2ca9dc8f23c", id);
  mkdirSync(chat, { recursive: true });
  writeFileSync(
    join(chat, "meta.json"),
    JSON.stringify({ schemaVersion: 1, hasConversation: true, title, cwd }),
  );
  return transcript;
}

const cursorPrompt = (text: string) => ({
  role: "user",
  message: {
    content: [
      {
        type: "text",
        text: `<timestamp>Monday, Oct 19, 2026, 5:43 PM (UTC-7)</timestamp>\n<user_query>\n${text}\n</user_query>`,
      },
    ],
  },
});

it("reads a Cursor chat from its transcript, meta.json and cmux's hooks", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "seamux-cursor-"));
  const id = "bce250b2-cda0-4ca7-9629-49027ae9fc47";
  const transcript = cursorChat(id, cwd, "Stamp file", [
    cursorPrompt("Write the time to stamp.txt"),
    {
      role: "assistant",
      message: {
        content: [
          { type: "text", text: "I'll write the timestamp." },
          {
            type: "tool_use",
            name: "Shell",
            input: { command: "date +%s > stamp.txt" },
          },
        ],
      },
    },
    {
      role: "assistant",
      message: { content: [{ type: "text", text: "Done. Want another?" }] },
    },
    { type: "turn_ended", status: "success" },
  ]);
  // cmux records ~/.cursor as every Cursor chat's directory.
  const { surface } = cmux.addSession(id, {
    agent: "cursor",
    active_for_surface: false,
    cwd: join(process.env.HOME!, ".cursor"),
    transcript_path: transcript,
    agent_lifecycle: "idle",
  });
  try {
    let card = (await loadBoard()).cards.find((c) => c.sessionId === id);
    expect(card).toMatchObject({
      engine: "cursor",
      name: "Stamp file",
      cwd,
      lastPrompt: "Write the time to stamp.txt",
      lastPromptAt: Date.parse("2026-10-20T00:43:00Z"),
      lastReply: "Done. Want another?",
      column: "waiting",
      drivable: true,
      waiting: { detail: "Done. Want another?", approval: null },
    });
    expect((await loadMessages(id))?.messages).toEqual([
      {
        role: "user",
        text: "Write the time to stamp.txt",
        at: "2026-10-20T00:43:00.000Z",
      },
      {
        role: "assistant",
        text: "I'll write the timestamp.",
        at: "2026-10-20T00:43:00.000Z",
      },
      {
        role: "tools",
        calls: [{ name: "Shell", count: 1 }],
        at: "2026-10-20T00:43:00.000Z",
      },
      {
        role: "assistant",
        text: "Done. Want another?",
        at: "2026-10-20T00:43:00.000Z",
      },
    ]);

    cmux.sessions[0].agent_lifecycle = "running";
    cmux.writeSessions();
    card = (await loadBoard()).cards.find((c) => c.sessionId === id);
    expect(card).toMatchObject({ column: "working", turnRunning: true });

    cmux.sessions[0].agent_lifecycle = "needsInput";
    cmux.writeSessions();
    surface.screen = [
      "─".repeat(40),
      " $  date +%s > stamp.txt in .",
      "",
      " Run this command?",
      " Hook requested approval • Not in allowlist: date",
      "  → Run (once) (y)",
      "    Run Everything (shift+tab)",
      "    Skip & tell the agent what to do instead (esc or n)",
    ].join("\n");
    card = (await loadBoard()).cards.find((c) => c.sessionId === id);
    expect(card).toMatchObject({
      column: "waiting",
      waiting: {
        reason: "permission prompt",
        tool: "Shell",
        detail: "date +%s > stamp.txt",
        approval: { toolUseId: expect.any(String) },
      },
    });

    cmux.endSession(id);
    card = (await loadBoard()).cards.find((c) => c.sessionId === id);
    expect(card).toMatchObject({ column: "done", name: "Stamp file", cwd });
  } finally {
    rmSync(join(process.env.HOME!, ".cursor"), {
      recursive: true,
      force: true,
    });
    rmSync(cwd, { recursive: true, force: true });
  }
});

it("takes a task notification after its answered hand-back as no turn", async () => {
  // As Claude Code 2.1.289 logs a subagent's return: the <agent-message>
  // hand-back wakes the model, and the task notification for the same run
  // lands after the answer without waking it. A background shell keeps
  // `claude agents` at busy all the while.
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const user = (content: string) => ({
    type: "user",
    timestamp: "2026-01-01T00:00:00Z",
    message: { role: "user", content },
  });
  const reply = {
    type: "assistant",
    timestamp: "2026-01-01T00:00:00Z",
    message: {
      role: "assistant",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Both passes are done." }],
    },
  };
  const notification = (id: string) =>
    user(
      `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>\n</task-notification>`,
    );
  const write = (sessionId: string, lines: object[]) =>
    writeFileSync(
      join(project, `${sessionId}.jsonl`),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
  const handedBack = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c18";
  const notYet = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c19";
  write(handedBack, [
    user("review the PR"),
    reply,
    user(
      'Another Claude session sent a message:\n<agent-message from="a9dd2f7e8a0e90819">\nNo findings.\n</agent-message>',
    ),
    reply,
    notification("a9dd2f7e8a0e90819"),
  ]);
  write(notYet, [
    user("review the PR"),
    reply,
    notification("a9dd2f7e8a0e90819"),
  ]);
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  const row = (sessionId: string) => ({
    pid: 1,
    cwd: "/work",
    kind: "interactive",
    startedAt: 0,
    sessionId,
    name: "demo",
    status: "busy",
  });
  writeFileSync(agents, JSON.stringify([row(handedBack), row(notYet)]));
  try {
    const board = await loadBoard();
    const card = (id: string) => board.cards.find((c) => c.sessionId === id);
    expect(card(handedBack)?.turnRunning).toBe(false);
    expect(card(notYet)?.turnRunning).toBe(true);
  } finally {
    rmSync(agents, { force: true });
  }
});

it("shows what an idle chat's prompt box holds unsent, and reads no box while a turn runs", async () => {
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const ids = {
    idle: "6b1f2e3a-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
    working: "7c2a3f4b-5d6e-4f70-9b8c-1d2e3f4a5b6c",
  };
  // One turn over, and one under way on a prompt just sent.
  writeFileSync(
    join(project, `${ids.idle}.jsonl`),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Done." }],
      },
    }) + "\n",
  );
  writeFileSync(
    join(project, `${ids.working}.jsonl`),
    JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "fix the login" },
    }) + "\n",
  );
  const agents = process.env.SEAMUX_TEST_CLAUDE_AGENTS!;
  writeFileSync(
    agents,
    JSON.stringify(
      Object.entries(ids).map(([status, sessionId], pid) => ({
        pid: pid + 1,
        cwd: "/work",
        kind: "interactive",
        startedAt: 0,
        sessionId,
        name: status,
        status: status === "working" ? "busy" : "idle",
      })),
    ),
  );
  const box = [
    "⏺ Done.",
    "─".repeat(40),
    "❯ 1 - fair",
    "  2 - yes, fix it",
    "─".repeat(40),
    "  ⏵⏵ auto mode on",
  ].join("\n");
  const idle = cmux.addSession(ids.idle).surface;
  idle.screen = box;
  cmux.addSession(ids.working).surface.screen = box;
  recordFailure(ids.idle, "1 - fair 2 - yes, fix it", new Error("Nope"));
  try {
    const { cards } = await loadBoard();
    const card = (id: string) => cards.find((c) => c.sessionId === id);
    expect(card(ids.idle)?.unsentDraft).toBe("1 - fair\n2 - yes, fix it");
    expect(card(ids.idle)?.sendFailure).toMatchObject({
      text: "1 - fair 2 - yes, fix it",
      error: "Nope",
    });
    expect(card(ids.working)?.sendFailure).toBeNull();
    expect(card(ids.working)?.unsentDraft).toBeNull();
    expect(
      cmux.calls("terminal.replay").map((r) => r.params.surface_id),
    ).toEqual([idle.id]);
  } finally {
    clearFailure(ids.idle);
    rmSync(agents, { force: true });
  }
});

it("shows a macro seamux sent before Session information by its name, after the prompt it carried", async () => {
  const sessionId = "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c19";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const user = (content: string, at: string) =>
    JSON.stringify({
      type: "user",
      timestamp: at,
      message: { role: "user", content },
    });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      user(
        "Fix the thing\n\n## How to worktree\n\nYou are working in a new git worktree, /work/wt, on branch wt, made from the repo's main checkout, /work.\n\nIf the repo already has a convention for working in worktrees, in its CLAUDE.md, AGENTS.md or other agent instructions, follow that and ignore the rest of this.\n\nIf it doesn't, propose this convention to the user before you start the work. Once they have agreed to it, or to their own version of it, record it in the repo's agent instructions (CLAUDE.md, AGENTS.md, or whichever it has), so later sessions follow it without asking, and follow it in this worktree:\n\n1. Worktrees go under worktrees/ in the main checkout, never inside other worktrees, and git ignores that directory: `git -C /work check-ignore -q worktrees/` succeeds when it does. If it doesn't, add it to .gitignore.\n2. A new worktree starts from the latest main, unless the work was asked to start from a particular branch or commit: fetch, then rebase onto whichever of the local main branch and the remote's is ahead.\n3. Install the project's dependencies in the worktree before running any of its scripts. Package managers hoist dependencies inconsistently, so what is installed in the main checkout may not resolve from a worktree.\n4. Do all the work in the worktree, never in the main checkout.",
        "2026-01-01T00:00:00Z",
      ),
      user(
        "Clean up after yourself: if you are working in a worktree, remove it and its branch.\n\n Do not touch anything outside your own worktree, and do not run a bare `git worktree prune` or anything else that operates on the whole repo.\n\nIf you have uncommitted work, say so and stop rather than discarding it.",
        "2026-01-01T00:01:00Z",
      ),
    ].join("\n") + "\n",
  );

  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "user", text: "Fix the thing", at: "2026-01-01T00:00:00Z" },
    { role: "macro", name: "howToWorktree", at: "2026-01-01T00:00:00Z" },
    { role: "macro", name: "closeSession", at: "2026-01-01T00:01:00Z" },
  ]);
});

it("shows the macros ahead of a first prompt by their names, then the prompt", async () => {
  const sessionId = "8b3c1d2e-4f5a-4b6c-9d7e-1a2b3c4d5e6f";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const { macros } = DEFAULT_CONFIG;
  const first = renderMacro(macros.newSession.text, {
    prompt: "/gtd daily",
    session_information: renderMacro(macros.sessionInformation.text, {
      name: "gtd-daily",
      cwd: "/work",
    }),
    how_to_worktree: "",
  }).trim();
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: first },
    }) + "\n",
  );

  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "macro", name: "sessionInformation", at: "2026-01-01T00:00:00Z" },
    { role: "macro", name: "newSession", at: "2026-01-01T00:00:00Z" },
    { role: "user", text: "/gtd daily", at: "2026-01-01T00:00:00Z" },
  ]);
});

it("shows a macro sent after a prompt command by its name", async () => {
  const sessionId = "5a1e7c3d-9b2f-4e6a-8c0d-3f4b2a1e9d58";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    JSON.stringify({
      type: "user",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "user",
        content:
          "<command-message>gtd</command-message>\n<command-name>/gtd</command-name>\n<command-args>daily\n\n## How to worktree\n\nYou are working in a new git worktree, /work/wt, on branch wt, made from the repo's main checkout, /work.\n\nIf the repo already has a convention for working in worktrees, in its CLAUDE.md, AGENTS.md or other agent instructions, follow that and ignore the rest of this.\n\nIf it doesn't, propose this convention to the user before you start the work. Once they have agreed to it, or to their own version of it, record it in the repo's agent instructions (CLAUDE.md, AGENTS.md, or whichever it has), so later sessions follow it without asking, and follow it in this worktree:\n\n1. Worktrees go under worktrees/ in the main checkout, never inside other worktrees, and git ignores that directory: `git -C /work check-ignore -q worktrees/` succeeds when it does. If it doesn't, add it to .gitignore.\n2. A new worktree starts from the latest main, unless the work was asked to start from a particular branch or commit: fetch, then rebase onto whichever of the local main branch and the remote's is ahead.\n3. Install the project's dependencies in the worktree before running any of its scripts. Package managers hoist dependencies inconsistently, so what is installed in the main checkout may not resolve from a worktree.\n4. Do all the work in the worktree, never in the main checkout.</command-args>",
      },
    }) + "\n",
  );

  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "user", text: "/gtd daily", at: "2026-01-01T00:00:00Z" },
    { role: "macro", name: "howToWorktree", at: "2026-01-01T00:00:00Z" },
  ]);
});

it("shows a prompt sent while a turn ran, which Claude Code logs as a queued command", async () => {
  const sessionId = "7c2d9e4b-1a3f-4b8e-a6d0-5e9f2c1b3a47";
  const project = join(process.env.HOME!, ".claude/projects/-work");
  mkdirSync(project, { recursive: true });
  const queued = (prompt: unknown, origin: object, at: string) =>
    JSON.stringify({
      type: "attachment",
      timestamp: at,
      attachment: {
        type: "queued_command",
        prompt,
        commandMode: "prompt",
        origin,
      },
    });
  writeFileSync(
    join(project, `${sessionId}.jsonl`),
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-01-01T00:00:00Z",
        message: { role: "user", content: "Fix the thing" },
      }),
      queued("Also the other thing", { kind: "human" }, "2026-01-01T00:00:10Z"),
      queued(
        '<agent-message from="a1">done</agent-message>',
        { kind: "peer" },
        "2026-01-01T00:00:20Z",
      ),
      queued(
        [{ type: "text", text: "[Image #1] and this" }],
        { kind: "human" },
        "2026-01-01T00:00:30Z",
      ),
    ].join("\n") + "\n",
  );

  expect((await loadMessages(sessionId))?.messages).toEqual([
    { role: "user", text: "Fix the thing", at: "2026-01-01T00:00:00Z" },
    { role: "user", text: "Also the other thing", at: "2026-01-01T00:00:10Z" },
    { role: "user", text: "[Image #1] and this", at: "2026-01-01T00:00:30Z" },
  ]);
});

it("lists a directory once whatever path names it", async () => {
  // As macOS's ~/code and ~/Code do: one folder under two spellings, which a
  // symlink stands in for on a disk that minds case.
  const root = mkdtempSync(join(tmpdir(), "seamux-dirs-"));
  const code = join(root, "code");
  mkdirSync(join(code, "app"), { recursive: true });
  symlinkSync(code, join(root, "Code-link"));
  const gone = join(root, "gone");
  expect(
    await distinctDirectories([
      join(code, "app"),
      join(root, "Code-link", "app"),
      code,
      join(root, "Code-link"),
      gone,
      gone,
    ]),
  ).toEqual([join(code, "app"), code, gone]);
  rmSync(root, { recursive: true });
});
