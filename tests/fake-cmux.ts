// A stand-in for cmux, for the tests: both ways seamux reaches it
// (app/lib/cmux.server.ts), over one set of workspaces, surfaces and saved
// sessions.
//
// - A control socket speaking cmux's v2 protocol as measured against cmux
//   0.64.23: one JSON request per line, optionally prefixed
//   "_cmux_capability_v1 <token> ", an optional "auth <password>" line first,
//   and {"id","ok","result"} or {"id","ok":false,"error":{"code","message"}}
//   back. Every request is recorded, so a test can assert what seamux sent.
// - `cmux sessions list --json`, answered by tests/bin/cmux from a state file
//   this writes, since the real command reads cmux's saved records rather
//   than the socket.
//
// It models only what seamux relies on, and refuses what cmux refuses with
// cmux's own codes and words (checked by tests-cmux/). A method it doesn't
// know gets cmux's own method_not_found, so a new call seamux starts making fails loudly here
// until the fake learns it, which is the point: that is a new piece of the
// contract to pin down.

import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";

import type { ReplayGrid } from "~/lib/harness.server";

export interface Request {
  method: string;
  params: Record<string, unknown>;
  // The capability token the request carried, if any.
  capability: string | null;
}

export interface FakeSurface {
  id: string;
  // What surface.read_text returns: the terminal's screen.
  screen: string;
  // What terminal.replay returns, when a test needs styles; otherwise the
  // screen, each line one run of plain text.
  grid?: ReplayGrid;
  // What was typed, pasted or pressed in it, in order.
  input: { kind: "text" | "paste" | "key"; value: string }[];
}

export interface FakeWorkspace {
  id: string;
  ref: string;
  title: string;
  cwd: string;
  surfaces: FakeSurface[];
  // What workspace.create was asked to run in it.
  initialCommand: string | null;
  focus: boolean | null;
}

// One row of `cmux sessions list --json`, as far as seamux reads it.
export interface FakeSession {
  session_id: string;
  agent: string;
  active_for_surface: boolean;
  pid?: number | null;
  // null when cmux's record has lost the session's pid.
  stored_pid_exists: boolean | null;
  launch_arguments?: string[];
  stored_pid_arguments?: string[];
  surface_id: string;
  workspace_id: string;
  cwd?: string;
  transcript_path?: string | null;
  agent_lifecycle?: string;
  started_at?: string;
}

type InputListener = (
  surface: FakeSurface,
  input: FakeSurface["input"][number],
) => void;

class Refusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

// The keys seamux presses, each checked against cmux by tests-cmux/. cmux
// refuses a key it doesn't know, and so does the fake, so a misspelt one
// fails here too.
export const KEYS = ["enter", "escape", "tab", "down", "shift+enter"];

// Methods that act on one terminal, which must always be named: cmux falls
// back to the caller's own surface when one isn't (CLAUDE.md).
const SURFACE_METHODS = new Set([
  "surface.send_text",
  "surface.send_key",
  "surface.read_text",
  "surface.close",
  "terminal.paste",
  "terminal.replay",
]);

export class FakeCmux {
  readonly requests: Request[] = [];
  readonly workspaces: FakeWorkspace[] = [];
  sessions: FakeSession[] = [];
  // When set, a request without this capability token is refused, as cmux
  // refuses a process it can't authorize.
  capability: string | null = null;
  // When set, the connection must open with "auth <password>".
  password: string | null = null;
  // When set, every connection is refused as cmux refuses a process it
  // didn't start, in its default socket mode: a line of plain text.
  outsideCmux = false;

  private server: Server | null = null;
  private listeners: InputListener[] = [];
  private refs = 0;

  constructor(
    readonly socketPath: string,
    readonly stateFile: string,
  ) {}

  async start() {
    rmSync(this.socketPath, { force: true });
    this.server = createServer((socket) => this.serve(socket));
    await new Promise<void>((resolve) =>
      this.server!.listen(this.socketPath, resolve),
    );
    this.writeSessions();
  }

  async stop() {
    await new Promise<void>((resolve) => this.server?.close(() => resolve()));
    rmSync(this.socketPath, { force: true });
    rmSync(this.stateFile, { force: true });
  }

  // --- Setting the scene ----------------------------------------------------

  addWorkspace(fields: Partial<Omit<FakeWorkspace, "surfaces">> = {}) {
    const workspace: FakeWorkspace = {
      id: fields.id ?? randomUUID().toUpperCase(),
      ref: fields.ref ?? `workspace:${++this.refs}`,
      title: fields.title ?? "",
      cwd: fields.cwd ?? "/tmp",
      surfaces: [],
      initialCommand: fields.initialCommand ?? null,
      focus: fields.focus ?? null,
    };
    this.workspaces.push(workspace);
    return workspace;
  }

  addSurface(workspace: FakeWorkspace, screen = "") {
    const surface: FakeSurface = {
      id: randomUUID().toUpperCase(),
      screen,
      input: [],
    };
    workspace.surfaces.push(surface);
    return surface;
  }

  // A live agent session in its own workspace and surface, as cmux lists it.
  addSession(
    sessionId: string,
    fields: Partial<FakeSession> & { title?: string } = {},
  ) {
    const workspace = this.addWorkspace({ title: fields.title ?? sessionId });
    const surface = this.addSurface(workspace);
    this.sessions.push({
      session_id: sessionId,
      agent: "claude",
      active_for_surface: true,
      stored_pid_exists: true,
      surface_id: surface.id,
      workspace_id: workspace.id,
      cwd: workspace.cwd,
      transcript_path: null,
      ...fields,
    });
    this.writeSessions();
    return { workspace, surface };
  }

  endSession(sessionId: string) {
    this.sessions = this.sessions.filter((s) => s.session_id !== sessionId);
    this.writeSessions();
  }

  // Rewrite what `cmux sessions list` reports, after changing `sessions`.
  writeSessions() {
    writeFileSync(
      this.stateFile,
      JSON.stringify({ sessions: this.sessions }, null, 2),
    );
  }

  // Called for each thing typed, pasted or pressed, to make the terminal
  // react: a chat exiting on /exit, a dialog closing on a digit.
  onInput(listener: InputListener) {
    this.listeners.push(listener);
  }

  surface(id: string): FakeSurface | undefined {
    for (const w of this.workspaces) {
      const s = w.surfaces.find((s) => s.id === id);
      if (s) return s;
    }
  }

  // Requests for one method, oldest first.
  calls(method: string) {
    return this.requests.filter((r) => r.method === method);
  }

  // --- The socket -----------------------------------------------------------

  private serve(socket: Socket) {
    let buffer = "";
    let authenticated = this.password === null;
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (this.outsideCmux) {
          socket.end(
            "Access denied - only processes started inside cmux can connect\n",
          );
          return;
        }
        if (!authenticated) {
          if (line === `auth ${this.password}`) {
            authenticated = true;
            socket.write("OK: Authenticated\n");
          } else {
            socket.write("ERROR: Invalid password\n");
          }
          continue;
        }
        socket.write(`${JSON.stringify(this.answer(line))}\n`);
      }
    });
  }

  private answer(line: string) {
    let capability: string | null = null;
    let body = line;
    const prefix = /^_cmux_capability_v1 (\S+) /.exec(line);
    if (prefix) {
      capability = prefix[1];
      body = line.slice(prefix[0].length);
    }
    const request = JSON.parse(body) as {
      id: string;
      method: string;
      params?: Record<string, unknown>;
    };
    const params = request.params ?? {};
    this.requests.push({ method: request.method, params, capability });
    try {
      if (this.capability !== null && capability !== this.capability) {
        throw new Refusal("unauthorized", "Capability token required");
      }
      return { id: request.id, ok: true, result: this.call(request.method, params) };
    } catch (err) {
      if (!(err instanceof Refusal)) throw err;
      return {
        id: request.id,
        ok: false,
        error: { code: err.code, message: err.message },
      };
    }
  }

  private call(method: string, params: Record<string, unknown>): unknown {
    if (SURFACE_METHODS.has(method) && !params.surface_id) {
      throw new Refusal(
        "invalid_params",
        `${method} without surface_id would act on the caller's own terminal`,
      );
    }
    switch (method) {
      case "system.ping":
        return { pong: true };
      case "workspace.list":
        return {
          workspaces: this.workspaces.map((w) => ({
            id: w.id,
            ref: w.ref,
            title: w.title,
            current_directory: w.cwd,
          })),
        };
      case "workspace.create": {
        const workspace = this.addWorkspace({
          title: String(params.title ?? ""),
          cwd: String(params.cwd ?? "/tmp"),
          initialCommand: String(params.initial_command ?? ""),
          focus: Boolean(params.focus),
        });
        const surface = this.addSurface(workspace);
        return { workspace_id: workspace.id, surface_id: surface.id };
      }
      case "workspace.rename": {
        this.workspaceById(params.workspace_id).title = String(params.title);
        return {};
      }
      case "workspace.close": {
        const workspace = this.workspaceById(params.workspace_id);
        this.workspaces.splice(this.workspaces.indexOf(workspace), 1);
        return {};
      }
      case "surface.list":
        return {
          surfaces: this.workspaceById(params.workspace_id).surfaces.map(
            (s) => ({ id: s.id }),
          ),
        };
      case "surface.close": {
        const workspace = this.workspaceById(params.workspace_id);
        if (workspace.surfaces.length === 1) {
          // As cmux does: its last tab closes with the workspace.
          throw new Refusal("invalid_state", "Cannot close the last surface");
        }
        const surface = this.surfaceIn(workspace, params.surface_id);
        workspace.surfaces.splice(workspace.surfaces.indexOf(surface), 1);
        return {};
      }
      case "surface.read_text": {
        const surface = this.surfaceIn(
          this.workspaceById(params.workspace_id),
          params.surface_id,
        );
        return {
          text: surface.screen,
          surface_id: surface.id,
          workspace_id: params.workspace_id,
        };
      }
      case "terminal.replay": {
        const surface = this.surfaceIn(
          this.workspaceById(params.workspace_id),
          params.surface_id,
        );
        return {
          render_grid: surface.grid ?? plainGrid(surface.screen),
          surface_id: surface.id,
          workspace_id: params.workspace_id,
        };
      }
      case "surface.send_text":
      case "terminal.paste":
      case "surface.send_key": {
        const surface = this.surfaceIn(
          this.workspaceById(params.workspace_id),
          params.surface_id,
        );
        if (method === "surface.send_key" && !KEYS.includes(String(params.key))) {
          throw new Refusal("invalid_params", "Unknown key");
        }
        const input = {
          kind:
            method === "surface.send_key"
              ? ("key" as const)
              : method === "terminal.paste"
                ? ("paste" as const)
                : ("text" as const),
          value: String(method === "surface.send_key" ? params.key : params.text),
        };
        surface.input.push(input);
        for (const listener of this.listeners) listener(surface, input);
        return {};
      }
      default:
        throw new Refusal("method_not_found", "Unknown method");
    }
  }

  private workspaceById(id: unknown): FakeWorkspace {
    const workspace = this.workspaces.find((w) => w.id === id);
    if (!workspace) throw new Refusal("not_found", "Workspace not found");
    return workspace;
  }

  private surfaceIn(workspace: FakeWorkspace, id: unknown): FakeSurface {
    const surface = workspace.surfaces.find((s) => s.id === id);
    // cmux's words for a surface id it doesn't have in the workspace.
    if (!surface) throw new Refusal("invalid_params", "Surface is not a terminal");
    return surface;
  }
}

// A screen as terminal.replay draws it, every line one run in the plain
// style, on a terminal 80 columns wide.
export function plainGrid(screen: string, columns = 80): ReplayGrid {
  return {
    columns,
    row_spans: screen.split("\n").flatMap((text, row) =>
      text
        ? [{ row, column: 0, text, cell_width: Array.from(text).length, style_id: 0 }]
        : [],
    ),
    styles: [{ id: 0, faint: false }],
  };
}
