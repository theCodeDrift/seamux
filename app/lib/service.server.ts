// The services behind the chats: whether each is signed in, and a sign-in
// the board runs for it. Nothing is scraped from a status page: sign-in
// comes from the tools' own status commands, and expired logins from the
// transcripts, where Claude Code writes each failed request in place of a
// reply. Other failed requests are reconnect.server.ts's to pick up.
//
// A sign-in runs without a terminal, so it can be finished from any device.
// Measured against Claude Code 2.1.283 and Codex 0.156.1, in knowledge/signing-in.md:
// - `claude auth login` with a pipe for stdin prints a sign-in URL whose
//   page shows a code, then reads that code from stdin. It also hands
//   `BROWSER` a second URL, whose callback is a port it listens on here, so
//   it finishes with nothing to paste, but only in a browser on this Mac.
//   The board gives it a browser that opens no tab and keeps that URL for a
//   board viewed on this Mac. Either way it prints "Login successful." and
//   exits 0, or "Login failed: ..." and exits 1.
// - `codex login --device-auth` prints a URL and a one-time code to enter
//   there, and needs no input.

import { spawn, type ChildProcess, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { Card, ServiceLogin, ServiceNotice } from "./board.ts";
import type { Engine } from "./config.ts";
import { BIN_DIRS } from "./bins.server";
import { packagePath } from "./paths.server";
import {
  installedEngines,
  listLive,
  resumeTurn,
  sendMessage,
} from "./drive.server";

const run = promisify(execFile);

// Status is asked on every poll, so hold an answer this long.
const STATUS_TTL_MS = 15_000;
// Codex's device code expires after 15 minutes; give up with it.
const LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
// A finished sign-in stays on its card long enough for every board polling,
// a hidden one included, to see how it went.
const DONE_VISIBLE_MS = 20_000;
const FAILED_VISIBLE_MS = 10 * 60 * 1000;
// Stands in for a browser: writes the URL it is given to a file.
const LOGIN_BROWSER = packagePath("scripts/login-browser.sh");

const env = () => ({
  ...process.env,
  PATH: [...BIN_DIRS, process.env.PATH ?? ""].join(":"),
});

interface Login {
  child: ChildProcess;
  output: string;
  // Where the stand-in browser writes Claude Code's localhost sign-in URL.
  urlFile: string | null;
  startedAt: number;
  endedAt: number | null;
  ok: boolean | null;
  message: string | null;
}

// Kept on globalThis so a hot reload keeps a sign-in in progress.
const state = ((globalThis as any).__seamuxServices ??= {
  status: new Map(),
  logins: new Map(),
  signedInAt: new Map(),
}) as {
  status: Map<Engine, { at: number; signedIn: boolean | null }>;
  logins: Map<Engine, Login>;
  // When a sign-in the board ran last succeeded. A chat's expired login
  // from before then is settled; one from after means it expired again.
  signedInAt: Map<Engine, number>;
};

// How each service signs in, as measured in the comment at the top.
interface SignIn {
  // Whether it is signed in, or null when it couldn't be told.
  status: () => Promise<boolean | null>;
  // The command that signs in.
  login: [string, string[]];
  // It hands BROWSER a URL that finishes on this Mac, and the stand-in
  // browser keeps it for the board.
  localUrl: boolean;
  // Its sign-in page shows a code to paste back on stdin.
  takesCode: boolean;
  // The one-time code it prints to enter on its page.
  deviceCode: RegExp | null;
  // Its chats' transcripts record a request refused for an expired login.
  recordsExpiry: boolean;
}

const SIGN_IN: Record<Engine, SignIn> = {
  claude: {
    status: askClaude,
    login: ["claude", ["auth", "login"]],
    localUrl: true,
    takesCode: true,
    deviceCode: null,
    recordsExpiry: true,
  },
  codex: {
    status: askCodex,
    login: ["codex", ["login", "--device-auth"]],
    localUrl: false,
    takesCode: false,
    deviceCode: /\b[A-Z0-9]{4}-[A-Z0-9]{4,6}\b/,
    recordsExpiry: false,
  },
};

// `claude auth status` exits 1 when signed out, with the same JSON.
async function askClaude(): Promise<boolean | null> {
  const parse = (stdout: string) => JSON.parse(stdout).loggedIn === true;
  try {
    const { stdout } = await run("claude", ["auth", "status", "--json"], {
      env: env(),
      timeout: 10_000,
    });
    return parse(stdout);
  } catch (err: any) {
    try {
      return typeof err.stdout === "string" ? parse(err.stdout) : null;
    } catch {
      return null;
    }
  }
}

// `codex login status` exits 1 with "Not logged in".
async function askCodex(): Promise<boolean | null> {
  try {
    await run("codex", ["login", "status"], { env: env(), timeout: 10_000 });
    return true;
  } catch (err: any) {
    return typeof err.code === "number" ? false : null;
  }
}

async function signedIn(service: Engine, now: number): Promise<boolean | null> {
  const held = state.status.get(service);
  if (held && now - held.at < STATUS_TTL_MS) return held.signedIn;
  const answer = await SIGN_IN[service].status();
  state.status.set(service, { at: now, signedIn: answer });
  return answer;
}

const ESCAPES = /\x1b\[[0-9;?]*[A-Za-z]/g;

// The first URL printed. Claude Code wraps it in a terminal hyperlink, an
// escape sequence that ends where the URL does.
function urlIn(output: string): string | null {
  return /https:\/\/[^\s\x1b\x07]+/.exec(output)?.[0] ?? null;
}

function readUrl(file: string): string | null {
  try {
    return urlIn(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function viewOf(service: Engine, login: Login): ServiceLogin {
  const output = login.output.replace(ESCAPES, "");
  return {
    state: login.ok == null ? "running" : login.ok ? "done" : "failed",
    url: urlIn(login.output),
    deviceCode: SIGN_IN[service].deviceCode?.exec(output)?.[0] ?? null,
    localUrl: login.urlFile ? readUrl(login.urlFile) : null,
    takesCode: SIGN_IN[service].takesCode,
    message: login.message,
    startedAt: login.startedAt,
  };
}

// The sign-in to show, if any: one running, or one that just ended.
function currentLogin(service: Engine, now: number): ServiceLogin | null {
  const login = state.logins.get(service);
  if (!login) return null;
  if (login.endedAt != null) {
    const keep = login.ok ? DONE_VISIBLE_MS : FAILED_VISIBLE_MS;
    if (now - login.endedAt > keep) {
      state.logins.delete(service);
      return null;
    }
  }
  return viewOf(service, login);
}

// The last line a finished sign-in printed, which says how it went.
function lastLine(output: string): string | null {
  const lines = output
    .replace(ESCAPES, "")
    .split(/[\r\n]+/)
    .map((l) => l.replace(/^Paste code here if prompted >\s*/, "").trim())
    .filter(Boolean);
  return lines.at(-1) ?? null;
}

export function startLogin(service: Engine) {
  const current = state.logins.get(service);
  if (current && current.ok == null) return;
  const signIn = SIGN_IN[service];
  const [cmd, args] = signIn.login;
  const dir = signIn.localUrl
    ? mkdtempSync(join(tmpdir(), "seamux-login-"))
    : null;
  const urlFile = dir ? join(dir, "url") : null;
  const child = spawn(cmd, args, {
    env: urlFile
      ? { ...env(), BROWSER: LOGIN_BROWSER, SEAMUX_LOGIN_URL_FILE: urlFile }
      : env(),
    stdio: [signIn.takesCode ? "pipe" : "ignore", "pipe", "pipe"],
  });
  const login: Login = {
    child,
    output: "",
    urlFile,
    startedAt: Date.now(),
    endedAt: null,
    ok: null,
    message: null,
  };
  state.logins.set(service, login);
  const take = (chunk: Buffer) => {
    login.output = (login.output + chunk.toString()).slice(-16_000);
  };
  child.stdout?.on("data", take);
  child.stderr?.on("data", take);
  const timer = setTimeout(() => {
    login.message = "The sign-in timed out.";
    child.kill();
  }, LOGIN_TIMEOUT_MS);
  const end = (ok: boolean, message: string | null) => {
    clearTimeout(timer);
    if (login.endedAt != null) return;
    login.endedAt = Date.now();
    login.ok = ok;
    if (dir) rmSync(dir, { recursive: true, force: true });
    login.message ??= message;
    state.status.delete(service);
    if (ok) state.signedInAt.set(service, login.endedAt);
  };
  child.on("error", (err) => end(false, err.message));
  child.on("exit", (code) => end(code === 0, lastLine(login.output)));
}

// Claude Code's sign-in page shows a code to paste back.
export function submitLoginCode(service: Engine, code: string) {
  const login = state.logins.get(service);
  if (!login || login.ok != null || !login.child.stdin)
    throw new Error("No sign-in is waiting for a code");
  login.child.stdin.write(`${code.trim()}\n`);
}

// Stops a sign-in the board started, and forgets it.
export function cancelLogin(service: Engine) {
  const login = state.logins.get(service);
  if (!login) return;
  state.logins.delete(service);
  if (login.ok == null) login.child.kill();
}

// `/login` typed into a chat signs in through that chat's terminal, in a
// dialog the board doesn't drive, with a browser opened on this Mac.
const LOGIN_COMMAND = /^\/login\s*$/;

// What the board sends a chat, except `/login`: that runs the board's own
// sign-in for the chat's service instead, finished from its Attention card
// on any device. Returns whether the text went to the chat.
export async function sendOrSignIn(
  sessionId: string,
  text: string,
): Promise<boolean> {
  if (!LOGIN_COMMAND.test(text.trim())) {
    await sendMessage(sessionId, text);
    return true;
  }
  const live = (await listLive()).get(sessionId);
  if (!live) throw new Error("This session is not running in a cmux surface");
  startLogin(live.engine);
  return false;
}

const named = (c: Card) => ({ sessionId: c.sessionId, name: c.name });

// The service's live chats whose last turn ended on an expired login.
function stoppedOnLogin(cards: Card[], service: Engine): Card[] {
  if (!SIGN_IN[service].recordsExpiry) return [];
  return cards.filter(
    (c) =>
      c.column !== "done" &&
      c.engine === service &&
      c.apiError?.kind === "authentication_failed",
  );
}

// Each installed service with something to show. One whose transcripts
// record no expired login, such as Codex, has only its own status to speak
// for it.
export async function serviceNotices(
  cards: Card[],
  now: number,
): Promise<ServiceNotice[]> {
  const installed = installedEngines();
  const services = (Object.keys(installed) as Engine[]).filter(
    (s) => installed[s],
  );
  const notices = await Promise.all(
    services.map(async (service): Promise<ServiceNotice> => {
      const stopped = stoppedOnLogin(cards, service);
      const since = state.signedInAt.get(service) ?? 0;
      const status = await signedIn(service, now);
      return {
        service,
        signedIn: status,
        needsLogin:
          status === false || stopped.some((c) => c.apiError!.at > since),
        stopped: stopped.map(named),
        login: currentLogin(service, now),
      };
    }),
  );
  return notices.filter((n) => n.needsLogin || n.stopped.length > 0 || n.login);
}

// Sends each chat stopped on an expired login on its way again. Returns the
// ones that could not be reached.
export async function resumeStopped(
  cards: Card[],
  service: Engine,
): Promise<string[]> {
  const failed: string[] = [];
  for (const card of stoppedOnLogin(cards, service)) {
    if (!card.drivable) {
      failed.push(card.name);
      continue;
    }
    try {
      await resumeTurn(card.sessionId);
    } catch {
      failed.push(card.name);
    }
  }
  return failed;
}
