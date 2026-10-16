// The slash commands a Claude Code session in a folder accepts: its
// built-ins, skills and MCP prompts, for autocomplete in the board's inputs.
//
// A headless Claude Code started with stream-json input answers an
// `initialize` control request with the list, before any prompt, so closing
// its input once the answer arrives runs no turn: about half a second on
// Claude Code 2.1.301. Up to 2.1.282 or so it printed the list unasked, as
// its first line, and stopped doing so by 2.1.301. The terminal-only
// commands (/add-dir, /artifacts and a few more) are in neither.

import { spawn } from "node:child_process";
import { dirname } from "node:path";

import type { SlashCommand } from "./board.ts";
import { findBin } from "./bins.server.ts";

const TTL_MS = 10 * 60_000;
const TIMEOUT_MS = 20_000;

interface Entry {
  at: number;
  commands: Promise<SlashCommand[]>;
}

// cwd -> its list, or the run fetching it. On globalThis so a hot reload
// keeps it.
const cache = ((globalThis as any).__seamuxCommands ??= new Map()) as Map<
  string,
  Entry
>;

// The pids of the headless sessions listing commands now. `claude agents`
// lists each as an interactive chat while it runs, which the board must
// leave out. On globalThis so a hot reload keeps it.
const listing = ((globalThis as any).__seamuxListingPids ??=
  new Set()) as Set<number>;

export function listingPids(): ReadonlySet<number> {
  return listing;
}

export function slashCommands(cwd: string): Promise<SlashCommand[]> {
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.commands;
  const commands = listCommands(cwd);
  cache.set(cwd, { at: Date.now(), commands });
  // A failed run is not kept, so the next open tries again.
  commands.catch(() => {
    if (cache.get(cwd)?.commands === commands) cache.delete(cwd);
  });
  return commands;
}

// /reload-skills picks up skills added or changed on disk, which may be
// user-level ones every folder sees, so every folder's list goes.
export function forgetCommands() {
  cache.clear();
}

function listCommands(cwd: string): Promise<SlashCommand[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      findBin("claude") ?? "claude",
      [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--verbose",
        "--no-session-persistence",
      ],
      {
        cwd,
        stdio: ["pipe", "pipe", "ignore"],
        env: {
          ...process.env,
          PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
        },
      },
    );
    const pid = child.pid;
    if (pid != null) listing.add(pid);
    let out = "";
    let done = false;
    const finish = (err: Error | null, commands?: SlashCommand[]) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.stdin.end();
      child.kill();
      if (err) reject(err);
      else resolve(commands!);
    };
    const timer = setTimeout(
      () => finish(new Error("Claude Code took too long to list commands")),
      TIMEOUT_MS,
    );
    child.on("error", (err) => finish(err));
    child.on("exit", () => {
      if (pid != null) listing.delete(pid);
      finish(new Error("Claude Code exited without listing commands"));
    });
    // A child that exits first closes the pipe under the request, which its
    // exit already reports.
    child.stdin.on("error", () => {});
    child.stdin.write(
      JSON.stringify({
        type: "control_request",
        request_id: "seamux-commands",
        request: { subtype: "initialize" },
      }) + "\n",
    );
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      out += chunk;
      for (let nl = out.indexOf("\n"); nl >= 0; nl = out.indexOf("\n")) {
        const line = out.slice(0, nl);
        out = out.slice(nl + 1);
        let msg: any;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg?.type === "control_response") {
          const commands = msg.response?.response?.commands;
          return Array.isArray(commands)
            ? finish(null, parse(commands))
            : finish(new Error("Claude Code listed no commands"));
        }
        // What Claude Code printed unasked before 2.1.301.
        if (msg?.type === "system" && Array.isArray(msg.commands)) {
          return finish(null, parse(msg.commands));
        }
      }
    });
  });
}

function parse(raw: unknown[]): SlashCommand[] {
  const commands: SlashCommand[] = [];
  for (const c of raw as any[]) {
    if (typeof c?.name !== "string" || !c.name) continue;
    // Claude Code's own plumbing, not for typing.
    if (c.name.startsWith("__")) continue;
    commands.push({
      name: c.name,
      description: typeof c.description === "string" ? c.description : "",
      argumentHint: typeof c.argumentHint === "string" ? c.argumentHint : "",
    });
  }
  return commands.sort((a, b) => a.name.localeCompare(b.name));
}
