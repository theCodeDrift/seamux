// Keeps the board running. Run it in its own terminal (a cmux workspace):
//
//   npm run seamux    (or `seamux` with no command)
//
// From a git checkout it runs the dev server, so changes go live by hot
// reload. Installed from npm, or with SEAMUX_COMPILED=1, it runs the compiled
// server (server/serve.ts) on what `npm run build` made. Either way it keeps
// it up:
// - restarts it when it exits, backing off to 30s while it keeps failing;
// - restarts it when it stops answering HTTP, even if the process lives;
// - restarts it when asked: `npm run land` touches data/board.restart after
//   reinstalling dependencies, and so does the /restart page, for a browser
//   stuck on a board whose scripts don't run. Other changes go live by hot
//   reload;
// - on start, stops a board server orphaned by a supervisor that was killed;
// - refuses to run twice;
// - on start, sets seamux up when it isn't, or updates an old setup
//   (scripts/setup.ts), and after `seamux uninstall` doesn't start at all.
//
// It also runs the Cloudflare tunnel while the board's Remote switches are on
// (app/lib/remote.server.ts), restarting it with the same backoff when it exits,
// and stops it when a switch goes off or its settings go missing. When LAN
// access is switched on or off, it restarts the board server, which picks the address
// it listens on at startup.
//
// The port comes from SEAMUX_PORT, else .seamux.json, else 54321, and is
// written back to .seamux.json so `npm run land` checks the right board.
// .seamux.json and data/ are in SEAMUX_HOME (app/lib/paths.server.ts): the
// checkout, or ~/.seamux for an installed package.
//
// Portable to Linux and WSL: Node APIs, POSIX process groups, and polling
// rather than file events, which WSL does not deliver for /mnt drives.

import { spawn, type ChildProcess } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { basicAuthHeader, readCredentials } from "../app/lib/credentials.ts";
import {
  IS_CHECKOUT,
  packagePath,
  SEAMUX_HOME,
} from "../app/lib/paths.server.ts";
import {
  lanWanted,
  readRemoteSettings,
  tunnelLogFile,
  tunnelWanted,
  tunnelPidFile,
  updateRunFile,
} from "../app/lib/remote.server.ts";
import { restartFile } from "../app/lib/restart.server.ts";
import { installRuntime } from "./runtime.ts";
import { ensureSetup, SETUP_COMMAND } from "./setup.ts";

// Where .seamux.json and data/ live. `npm run land` passes the main
// checkout's own instead, since it runs from a worktree.
const REPO = SEAMUX_HOME;
const DATA = join(REPO, "data");
const COMPILED = !IS_CHECKOUT || process.env.SEAMUX_COMPILED === "1";
const RESTART_FILE = restartFile(REPO);
const SUPERVISOR_PID = join(DATA, "serve.pid");
const CHILD_PID = join(DATA, "board.pid");
const TUNNEL_PID = tunnelPidFile(REPO);

const DEFAULT_PORT = 54321;
const HEALTHY_MS = 60_000; // up this long resets the backoff
const MAX_BACKOFF_MS = 30_000;
const STARTUP_GRACE_MS = 30_000; // no health checks while it boots
const PROBE_EVERY_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
const PROBE_FAILURES = 3; // consecutive failures before a restart
const KILL_AFTER_MS = 5_000;

// How the board in `repo` runs, kept in its gitignored .seamux.json.
export interface RunConfig {
  port: number;
}

export function readRunConfig(repo = REPO): RunConfig {
  let port = DEFAULT_PORT;
  try {
    const saved = JSON.parse(
      readFileSync(join(repo, ".seamux.json"), "utf8"),
    ) as Partial<RunConfig>;
    if (Number.isInteger(saved.port)) port = saved.port!;
  } catch {}
  return { port };
}

// Keeps the file's other fields, such as the Remote switch.
function writeRunConfig(config: RunConfig) {
  updateRunFile(REPO, { ...config });
}

export function boardUrl(repo = REPO): string {
  return `http://127.0.0.1:${readRunConfig(repo).port}/`;
}

// Headers that get a request past the board's HTTP Basic check, read from the
// same place the board reads them. Without them a secured board answers 401,
// and a health check would take that for a board that is down.
export function boardHeaders(repo = REPO): Record<string, string> {
  const credentials = readCredentials(repo);
  return credentials ? { authorization: basicAuthHeader(credentials) } : {};
}

// The pid of the server the supervisor serving `repo` last started.
export function boardPid(repo = REPO): string | null {
  try {
    return readFileSync(join(repo, "data", "board.pid"), "utf8").trim();
  } catch {
    return null;
  }
}

function log(message: string) {
  console.log(`[seamux serve ${new Date().toLocaleTimeString()}] ${message}`);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(path: string): number | null {
  try {
    const pid = Number(readFileSync(path, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function mtime(path: string): number {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

// Signal a whole process group: the board server and everything it spawned.
function signalGroup(pid: number, signal: NodeJS.Signals) {
  try {
    process.kill(-pid, signal);
  } catch {}
}

async function stopGroup(pid: number) {
  signalGroup(pid, "SIGTERM");
  const deadline = Date.now() + KILL_AFTER_MS;
  while (alive(pid) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }
  if (alive(pid)) signalGroup(pid, "SIGKILL");
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: boardHeaders(),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function supervise() {
  mkdirSync(DATA, { recursive: true });

  const other = readPid(SUPERVISOR_PID);
  if (other && other !== process.pid && alive(other)) {
    log(`already running as pid ${other}; not starting a second one`);
    process.exit(1);
  }

  // Set seamux up if it isn't, or bring an old setup up to date. After
  // `seamux uninstall`, don't start at all until `seamux setup`.
  const setup = ensureSetup();
  if (setup.state === "uninstalled") {
    console.error(
      `seamux was uninstalled. Run \`${SETUP_COMMAND}\` to reinstall its hooks and skill.`,
    );
    process.exit(1);
  }
  if (setup.state === "failed") {
    log(
      `couldn't set seamux up (${setup.error}); starting anyway, but the board won't see subagents`,
    );
  } else if (setup.changed) {
    log(setup.changed);
  }

  writeFileSync(SUPERVISOR_PID, `${process.pid}\n`);

  const server = COMPILED ? packagePath("dist/serve.js") : null;
  if (server && !existsSync(packagePath("build/server/index.js"))) {
    log("no compiled board: run `npm run build` first");
    process.exit(1);
  }
  installRuntime();

  const port = Number(process.env.SEAMUX_PORT ?? readRunConfig().port);
  if (!Number.isInteger(port) || port <= 0) {
    log(`not a port: ${process.env.SEAMUX_PORT}`);
    process.exit(1);
  }
  writeRunConfig({ port });
  const url = boardUrl();

  // A supervisor killed with SIGKILL leaves its board server holding the port,
  // and its tunnel running.
  const orphan = readPid(CHILD_PID);
  if (orphan && alive(orphan)) {
    log(`stopping orphaned board server, pid ${orphan}`);
    await stopGroup(orphan);
  }
  const orphanTunnel = readPid(TUNNEL_PID);
  if (orphanTunnel && alive(orphanTunnel)) {
    log(`stopping orphaned tunnel, pid ${orphanTunnel}`);
    await stopGroup(orphanTunnel);
  }
  rmSync(TUNNEL_PID, { force: true });

  let child: ChildProcess | null = null;
  let stopping = false;
  let backoff = 1000;
  let startedAt = 0;
  let failures = 0;
  let restartStamp = mtime(RESTART_FILE);
  let pendingStart: NodeJS.Timeout | null = null;
  let restarting = false;
  // Whether the running board server was started listening on the network.
  let listeningLan = false;

  const start = () => {
    pendingStart = null;
    if (stopping || child) return;
    startedAt = Date.now();
    listeningLan = lanWanted(REPO);
    failures = 0;
    const [command, args] = server
      ? [process.execPath, ["--no-warnings", server, "--port", String(port)]]
      : ["npx", ["react-router", "dev", "--port", String(port)]];
    const c = spawn(command, args, {
      cwd: server ? REPO : packagePath(),
      env: server ? { ...process.env, NODE_ENV: "production" } : process.env,
      stdio: "inherit",
      detached: true, // its own process group, so restarts stop its children too
    });
    child = c;
    if (c.pid) writeFileSync(CHILD_PID, `${c.pid}\n`);
    log(
      `started ${server ? "compiled board" : "dev server"}, pid ${c.pid}, ${url}`,
    );
    c.on("error", (err) => log(`could not start the board server: ${err.message}`));
    c.on("exit", (code, signal) => {
      if (child === c) child = null;
      rmSync(CHILD_PID, { force: true });
      if (stopping) return;
      if (Date.now() - startedAt > HEALTHY_MS) backoff = 1000;
      log(
        `board server exited (${signal ?? `code ${code}`}); restarting in ${backoff / 1000}s`,
      );
      pendingStart = setTimeout(start, backoff);
      backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
    });
  };

  // Stop the current board server and start a fresh one straight away.
  const restart = async (reason: string) => {
    if (restarting || stopping) return;
    restarting = true;
    log(`restarting: ${reason}`);
    backoff = 1000;
    if (pendingStart) clearTimeout(pendingStart);
    const c = child;
    if (c?.pid) {
      c.removeAllListeners("exit");
      child = null;
      await stopGroup(c.pid);
      rmSync(CHILD_PID, { force: true });
    }
    restarting = false;
    start();
  };

  // The tunnel: run while the Remote switch is on and its settings are all
  // set. The token goes in cloudflared's environment, not its arguments, so
  // `ps` doesn't show it.
  let tunnel: ChildProcess | null = null;
  let tunnelBackoff = 1000;
  let tunnelStartedAt = 0;
  let tunnelRetryAt = 0;

  const startTunnel = (token: string) => {
    tunnelStartedAt = Date.now();
    const out = openSync(tunnelLogFile(REPO), "a");
    const t = spawn("cloudflared", ["tunnel", "--no-autoupdate", "run"], {
      cwd: REPO,
      env: { ...process.env, TUNNEL_TOKEN: token },
      stdio: ["ignore", out, out],
      detached: true,
    });
    closeSync(out);
    tunnel = t;
    if (t.pid) writeFileSync(TUNNEL_PID, `${t.pid}\n`);
    log(`started tunnel, pid ${t.pid}; its log is data/tunnel.log`);
    t.on("error", (err) => log(`could not start cloudflared: ${err.message}`));
    t.on("exit", (code, signal) => {
      if (tunnel === t) tunnel = null;
      rmSync(TUNNEL_PID, { force: true });
      if (stopping) return;
      if (Date.now() - tunnelStartedAt > HEALTHY_MS) tunnelBackoff = 1000;
      tunnelRetryAt = Date.now() + tunnelBackoff;
      log(
        `tunnel exited (${signal ?? `code ${code}`}); retrying in ${tunnelBackoff / 1000}s if still on`,
      );
      tunnelBackoff = Math.min(tunnelBackoff * 2, MAX_BACKOFF_MS);
    });
  };

  const stopTunnel = async (reason: string) => {
    const t = tunnel;
    if (!t?.pid) return;
    log(`stopping tunnel: ${reason}`);
    t.removeAllListeners("exit");
    tunnel = null;
    await stopGroup(t.pid);
    rmSync(TUNNEL_PID, { force: true });
    tunnelBackoff = 1000;
    tunnelRetryAt = 0;
  };

  let reconcilingTunnel = false;
  const reconcileTunnel = async () => {
    if (reconcilingTunnel || stopping) return;
    reconcilingTunnel = true;
    try {
      const { settings, missing } = readRemoteSettings(REPO);
      const wanted = tunnelWanted(REPO);
      if (tunnel && !wanted) await stopTunnel("switched off");
      else if (tunnel && !settings) {
        await stopTunnel(`${missing.join(", ")} unset`);
      } else if (!tunnel && wanted && settings && Date.now() >= tunnelRetryAt) {
        startTunnel(settings.token);
      }
    } finally {
      reconcilingTunnel = false;
    }
  };

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`${signal}: stopping`);
    if (pendingStart) clearTimeout(pendingStart);
    if (tunnel?.pid) await stopGroup(tunnel.pid);
    rmSync(TUNNEL_PID, { force: true });
    if (child?.pid) await stopGroup(child.pid);
    rmSync(CHILD_PID, { force: true });
    if (readPid(SUPERVISOR_PID) === process.pid)
      rmSync(SUPERVISOR_PID, { force: true });
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(sig, () => void shutdown(sig));
  }
  // The supervisor must outlive its own bugs.
  process.on("uncaughtException", (err) =>
    log(`supervisor error: ${err.stack ?? err}`),
  );
  process.on("unhandledRejection", (err) => log(`supervisor error: ${err}`));

  start();

  setInterval(() => {
    const stamp = mtime(RESTART_FILE);
    if (stamp !== restartStamp) {
      restartStamp = stamp;
      void restart("requested");
    } else if (child && lanWanted(REPO) !== listeningLan) {
      void restart(
        listeningLan ? "LAN access switched off" : "LAN access switched on",
      );
    }
    void reconcileTunnel();
  }, 1000);

  setInterval(async () => {
    if (!child || stopping || Date.now() - startedAt < STARTUP_GRACE_MS) return;
    if (await probe(url)) {
      failures = 0;
      return;
    }
    failures += 1;
    log(`health check failed (${failures}/${PROBE_FAILURES})`);
    if (failures >= PROBE_FAILURES) void restart("not answering");
  }, PROBE_EVERY_MS);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await supervise();
