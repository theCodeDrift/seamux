// What becomes of a chat seamux starts before the board lists it.
//
// An agent that dies while starting takes nothing with it that the board
// could read: no transcript, no `claude agents` row, no cmux record. Its
// workspace closed with it too, until the launch command kept it open:
// the agent now runs under /bin/sh, which waits for it, and when it exits
// with an error, or so soon after starting that it can't have been asked
// to, says so on the screen and leaves the user's shell there, with
// whatever the agent printed above it (knowledge/launching.md).
//
// The board then shows the chat as failed to start, from that line or
// from its workspace being gone, until the user dismisses it. Kept in
// memory only, like the launch itself: after a restart, the workspace
// still holds what happened.
//
// Imported by drive.server.ts, which scripts/seamux.ts runs under plain
// Node: relative imports with extensions.

import type { FailedStart } from "./board.ts";
import { cmuxRpc } from "./cmux.server.ts";
import type { Engine } from "./config.ts";
import { readScreen, type Surface } from "./harness.server.ts";

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

// Under this long, even a clean exit is a start that failed: a session
// someone meant to use runs longer, and the trust dialog refused exits as
// fast, with status 1.
export const MIN_RUN_S = 15;

// /bin/sh, whatever the user's own shell, so the check reads the same
// under zsh, bash and fish. $1 is the user's shell, $2 what it runs, $3
// the agent's name for the line.
const KEEP_OPEN = [
  "start=$(date +%s)",
  '"$1" -ic "$2"',
  "code=$?",
  "ran=$(( $(date +%s) - start ))",
  `if [ "$code" -ne 0 ] || [ "$ran" -lt ${MIN_RUN_S} ]; then`,
  `  printf '\\nseamux: %s exited with status %s after %ss.\\n' "$3" "$code" "$ran"`,
  "  printf 'This terminal stays open to show what it printed.\\n\\n'",
  '  exec "$1" -i',
  "fi",
].join("\n");

// The workspace's command: `command` in `shell`, kept open as above.
export function launchCommand(
  shell: string,
  command: string,
  agent: string,
): string {
  return `exec /bin/sh -c ${shq(KEEP_OPEN)} sh ${[shell, command, agent]
    .map(shq)
    .join(" ")}`;
}

const EXITED = /seamux: (.+) exited with status (\d+) after (\d+)s\./;

// The line the launch command printed, if the agent on this screen exited.
export function exitedLine(screen: string): string | null {
  return screen.match(EXITED)?.[0] ?? null;
}

// Whether a launched agent has exited, read off its terminal.
export async function exitedOn(surface: Surface): Promise<string | null> {
  try {
    return exitedLine(await readScreen(surface));
  } catch {
    return null;
  }
}

interface Launch {
  sessionId: string;
  engine: Engine;
  surface: Surface;
  name: string;
  cwd: string;
  intent: string;
  forked: boolean;
  at: number;
  // Final: it exited, or its workspace went. Otherwise it may yet show up.
  failed: { reason: string; final: boolean; at: number } | null;
}

// Kept on globalThis, so a hot reload doesn't forget a launch.
const launches = ((globalThis as any).__seamuxLaunches ??= new Map()) as Map<
  string,
  Launch
>;

// cmux lists a new workspace a moment after workspace.create returns.
const LISTED_GRACE_MS = 10_000;
// An agent still not listed by now is stuck, or slow enough to say so.
export const STALLED_MS = 90_000;
// A launch nobody dismissed goes after this long.
const FORGET_MS = 60 * 60_000;

export function trackLaunch(
  launch: Omit<Launch, "at" | "failed">,
  now = Date.now(),
) {
  launches.set(launch.sessionId, { ...launch, at: now, failed: null });
}

export function dismissStart(sessionId: string) {
  launches.delete(sessionId);
}

// The launches that failed to start, or haven't yet long after they
// should have. One the board now lists is forgotten: it started.
export async function failedStarts(
  listed: (sessionId: string) => boolean,
  now = Date.now(),
): Promise<FailedStart[]> {
  if (launches.size === 0) return [];
  let workspaces: Promise<Set<string>> | null = null;
  const open = () =>
    (workspaces ??= cmuxRpc<{ workspaces: { id: string }[] }>(
      "workspace.list",
      {},
    ).then((r) => new Set(r.workspaces.map((w) => w.id))));
  const failed: FailedStart[] = [];
  for (const launch of launches.values()) {
    if (listed(launch.sessionId) || now - launch.at > FORGET_MS) {
      launches.delete(launch.sessionId);
      continue;
    }
    if (!launch.failed?.final && now - launch.at > LISTED_GRACE_MS) {
      const failure = await check(launch, await open(), now);
      if (failure) launch.failed = { ...failure, at: launch.failed?.at ?? now };
    }
    if (launch.failed) {
      failed.push({
        sessionId: launch.sessionId,
        engine: launch.engine,
        name: launch.name,
        cwd: launch.cwd,
        intent: launch.intent,
        forked: launch.forked,
        reason: launch.failed.reason,
        final: launch.failed.final,
        at: launch.failed.at,
      });
    }
  }
  return failed;
}

async function check(
  launch: Launch,
  workspaces: Set<string>,
  now: number,
): Promise<{ reason: string; final: boolean } | null> {
  const workspace = `Its workspace, “${launch.name}”, is still open in cmux`;
  if (!workspaces.has(launch.surface.workspaceId)) {
    return {
      reason: "Its workspace closed before the chat started.",
      final: true,
    };
  }
  const line = await exitedOn(launch.surface);
  if (line) {
    return {
      reason: `${line.replace(/^seamux: /, "")} ${workspace} with what it printed.`,
      final: true,
    };
  }
  if (now - launch.at > STALLED_MS) {
    return {
      reason: `Not on the board ${Math.round(STALLED_MS / 1000)} seconds after it was started. ${workspace}.`,
      final: false,
    };
  }
  return null;
}
