// The board's write verbs: send a message, interrupt a turn, resume a
// closed chat, and start new sessions (dispatch and fork). All of them go
// through cmux. None of them destroys anything.

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import {
  ASKED_IN_REPLY,
  type Answer,
  type Card,
  type Dialog,
  type Question,
} from "./board.ts";
import { forgetCommands } from "./commands.server.ts";
import { parseCodexApproval } from "./codex.server.ts";
import {
  ENGINE_LABELS,
  ENGINES,
  renderMacro,
  usesVariable,
  type Engine,
} from "./config.ts";
import { configOrDefaults } from "./config.server.ts";
import { BIN_DIRS, findBin, SHELL } from "./bins.server.ts";
import { cmuxCli, cmuxRpc } from "./cmux.server.ts";
import {
  exclusive,
  harnessOf,
  HARNESSES,
  pause,
  readScreen,
  Session,
  target,
  type Surface,
} from "./harness.server.ts";
import * as macros from "./macros.server.ts";
import { projectOf } from "./project-colors.ts";
import type { Alive } from "./protocol.server.ts";
import { recordDispatch } from "./store.server.ts";

const run = promisify(execFile);

export type { Surface };

const rpc = cmuxRpc;

interface CmuxSession {
  session_id: string;
  agent: string;
  active_for_surface: boolean;
  // null when cmux's record of the session has lost its pid.
  stored_pid_exists: boolean | null;
  surface_id: string;
  workspace_id: string;
  cwd?: string;
  transcript_path?: string | null;
}

// A session running in a cmux surface, which the board can type into.
export interface LiveSession {
  engine: Engine;
  surface: Surface;
  cwd: string | null;
  // Codex only: cmux records where its transcript is.
  transcript: string | null;
}

// A resumed session of a harness cmux files only once a prompt goes in
// stays under its old surface until then, so seamux remembers where it
// resumed it until cmux catches up. Kept on globalThis, so a hot reload
// doesn't forget it.
const resumedUnfiled = ((globalThis as any).__seamuxResumedUnfiled ??= new Map<
  string,
  { engine: Engine; surface: Surface }
>()) as Map<string, { engine: Engine; surface: Surface }>;

// sessionId -> every live session cmux hosts of a harness seamux drives.
// One cmux marks active for its surface is live while it has the mark;
// one that never gets it, such as Codex, is live while its process is.
// cmux sometimes loses a session's pid and can't tell, so the harness's
// own list of running sessions decides those, where it has one.
export async function listLive(): Promise<Map<string, LiveSession>> {
  const stdout = await cmuxCli(["sessions", "list", "--json"], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const { sessions } = JSON.parse(stdout) as { sessions: CmuxSession[] };
  const pidless = new Set(
    sessions.flatMap((s) => {
      const h = harnessOf(s.agent);
      return h?.running && s.active_for_surface && s.stored_pid_exists == null
        ? [h]
        : [];
    }),
  );
  const running = new Set(
    (await Promise.all([...pidless].map((h) => h.running!()))).flatMap(
      (ids) => [...ids],
    ),
  );
  const map = new Map<string, LiveSession>();
  for (const s of sessions) {
    const harness = harnessOf(s.agent);
    if (!harness) continue;
    if (harness.markedActive && !s.active_for_surface) continue;
    if (s.stored_pid_exists == null) {
      if (!harness.running || !running.has(s.session_id)) continue;
    } else if (!s.stored_pid_exists) continue;
    map.set(s.session_id, {
      engine: harness.engine,
      surface: { surfaceId: s.surface_id, workspaceId: s.workspace_id },
      cwd: s.cwd ?? null,
      transcript: s.transcript_path ?? null,
    });
  }
  if (resumedUnfiled.size > 0) {
    const { workspaces } = await rpc<{ workspaces: { id: string }[] }>(
      "workspace.list",
      {},
    );
    for (const [id, { engine, surface }] of resumedUnfiled) {
      const filed = sessions.find((s) => s.session_id === id);
      if (filed?.surface_id === surface.surfaceId) {
        resumedUnfiled.delete(id);
      } else if (!workspaces.some((w) => w.id === surface.workspaceId)) {
        // Exited before its first prompt: its workspace closed with it.
        resumedUnfiled.delete(id);
        map.delete(id);
      } else {
        map.set(id, { engine, surface, cwd: null, transcript: null });
      }
    }
  }
  return map;
}

// Whether a session still runs, told as the board tells a closed chat:
// `claude agents` lists it, cmux hosts it, or it went on as a background
// job under its short id. null when either couldn't be asked. For
// `seamux wait`, which runs without the board.
export async function sessionsAlive(): Promise<Alive> {
  try {
    const [agents, live] = await Promise.all([
      run("claude", ["agents", "--json", "--all"], {
        maxBuffer: 32 * 1024 * 1024,
        timeout: 10_000,
      }).then(
        ({ stdout }) =>
          JSON.parse(stdout) as {
            id?: string | null;
            sessionId?: string | null;
          }[],
        (err: NodeJS.ErrnoException) => {
          // No Claude Code installed: only cmux's sessions run.
          if (err.code === "ENOENT") return [];
          throw err;
        },
      ),
      listLive(),
    ]);
    const known = new Set([...agents.map((a) => a.sessionId), ...live.keys()]);
    const jobs = new Set(agents.map((a) => a.id));
    return (id) => known.has(id) || jobs.has(id.slice(0, 8));
  } catch {
    return null;
  }
}

// sessionId -> the cmux surface a live session is running in.
export async function listSurfaces(): Promise<Map<string, Surface>> {
  const live = await listLive();
  return new Map([...live].map(([id, l]) => [id, l.surface]));
}

export { UnsentError } from "./harness.server.ts";

// Drive a live chat through a macro, as the one writer to its terminal
// until the macro is done. The surface is always resolved server-side, once
// it is this macro's turn, so macros asked for together run in that order.
function driving<T>(
  sessionId: string,
  macro: (s: Session) => Promise<T>,
): Promise<T> {
  return exclusive(sessionId, async () => {
    const live = (await listLive()).get(sessionId);
    if (!live) throw new Error("This session is not running in a cmux surface");
    return macro(new Session(live.surface, HARNESSES[live.engine]));
  });
}

export async function sendMessage(sessionId: string, text: string) {
  await driving(sessionId, (s) => macros.send(s, text));
  // New skills on disk: the inputs' slash commands must be listed again.
  if (/^\/reload-skills\b/.test(text)) forgetCommands();
}

export async function resumeTurn(sessionId: string) {
  await driving(sessionId, macros.resume);
}

export async function interrupt(sessionId: string) {
  await driving(sessionId, macros.interrupt);
}

export async function answerQuestion(
  sessionId: string,
  questions: Question[],
  answers: Answer[],
) {
  await driving(sessionId, (s) => macros.answerQuestion(s, questions, answers));
}

// Answer an open permission prompt, as read off `engine`'s screen. Measured
// against Claude Code 2.1.281 and Codex 0.156.1.
export async function answerApproval(
  sessionId: string,
  allow: boolean,
  engine: Engine,
) {
  await driving(sessionId, (s) => {
    if (s.harness.engine !== engine)
      throw new Error("That approval is no longer open");
    return allow ? macros.approve(s) : macros.deny(s);
  });
}

const OPTION = /^(?:❯\s*)?([1-9])\.\s+(.+)$/;
// A row of a dialog whose options have no numbers, untrimmed: the one under
// the cursor led by " ❯ ", the rest indented to line up with it.
const ROW = /^ (❯| ) (\S.*)$/;
// A line made of one box-drawing character: the rule a dialog opens under.
const RULE = /^([▔─━])\1{7,}$/;

// The dialog open at the bottom of the screen, or null. It must end on
// Claude Code's "Esc to cancel" footer, so a list in a reply is never
// mistaken for one.
function parseDialog(screen: string): Dialog | null {
  const raw = screen.split("\n").map((l) => l.trimEnd());
  while (raw.length && !raw.at(-1)) raw.pop();
  if (!/Esc to cancel/.test(raw.at(-1) ?? "")) return null;
  const lines = raw.map((l) => l.trim());

  const found = numberedOptions(lines) ?? cursorOptions(raw);
  if (!found) return null;

  // The dialog's own text, between its rule and the first option.
  const text: string[] = [];
  for (let at = found.at - 1; at >= 0 && !RULE.test(lines[at]); at--) {
    if (lines[at]) text.unshift(lines[at]);
  }
  if (text.length === 0) return null;
  const [title, ...detail] = text;
  return {
    title,
    detail,
    options: found.options,
    cursor: found.cursor,
    key: [...text, ...found.options].join("\n"),
  };
}

interface Options {
  // The line the first option is on.
  at: number;
  options: string[];
  cursor: number | null;
}

// A numbered dialog's options, read upwards from the footer down to option
// 1; lines between them are their descriptions.
function numberedOptions(lines: string[]): Options | null {
  let at = lines.length - 2;
  while (at >= 0 && !OPTION.test(lines[at])) at--;
  const last = Number(OPTION.exec(lines[at] ?? "")?.[1] ?? 0);
  const options: string[] = [];
  for (; at >= 0; at--) {
    const m = OPTION.exec(lines[at]);
    if (!m) continue;
    if (Number(m[1]) !== last - options.length) return null;
    options.unshift(m[2].trim());
    if (options.length === last) break;
  }
  if (options.length < 2 || options.length !== last) return null;
  return { at, options, cursor: null };
}

// The options of a dialog that numbers none, such as the Artifact tool's
// "Permanently delete …?" (No, then Yes): the rows just above the footer,
// one of them under the cursor.
function cursorOptions(raw: string[]): Options | null {
  let end = raw.length - 1;
  while (end > 0 && !raw[end - 1]) end--;
  let at = end;
  while (at > 0 && ROW.test(raw[at - 1])) at--;
  const rows = raw.slice(at, end).map((l) => ROW.exec(l)!);
  const cursor = rows.findIndex((m) => m[1] === "❯");
  if (rows.length < 2 || cursor < 0) return null;
  if (rows.some((m, i) => i !== cursor && m[1] === "❯")) return null;
  return { at, options: rows.map((m) => m[2].trim()), cursor };
}

export async function readDialog(surface: Surface): Promise<Dialog | null> {
  return parseDialog(await readScreen(surface));
}

export async function readCodexApproval(surface: Surface) {
  return parseCodexApproval(await readScreen(surface));
}

// Pick an option in the dialog read as `key`. Measured against Claude Code
// 2.1.281 on /exit's "Background work is running": a digit picks and
// confirms in one go. A dialog with no numbers takes arrows and Enter
// instead (2.1.289). The screen is read again first, so no key ever lands
// in the prompt box once the dialog has gone.
export async function answerDialog(
  sessionId: string,
  key: string,
  option: number,
) {
  await driving(sessionId, async (s) => {
    const dialog = parseDialog(await s.screen());
    if (!dialog || dialog.key !== key)
      throw new Error("That dialog is no longer open");
    if (
      !Number.isInteger(option) ||
      option < 0 ||
      option >= dialog.options.length
    )
      throw new Error("No such option");
    await macros.pick(s, option, dialog.cursor);
  });
}

// Close a chat the way the user would: /exit, which Claude Code and Codex both
// take, then close the tab it ran in.
// The conversation is kept, and the card moves to DONE, where it can be
// resumed.
//
// A workspace seamux launched closes itself when the agent exits, but a chat
// the user started by hand leaves its shell behind, so the tab is closed once
// the agent is gone. cmux refuses to close a workspace's last tab, so then
// the workspace goes instead. An agent that has not exited keeps its tab.
const EXIT_WAIT_MS = 10_000;

export async function closeChat(sessionId: string) {
  const surface = await driving(sessionId, async (s) => {
    await macros.exit(s);
    return s.surface;
  });

  const deadline = Date.now() + EXIT_WAIT_MS;
  while ((await listSurfaces()).has(sessionId)) {
    if (Date.now() > deadline)
      throw new Error("The chat did not exit, so its tab was left open");
    await pause(500);
  }

  // A workspace closing itself can go between any two of these calls: cmux
  // reports a Codex session over before its process has quite exited.
  try {
    const { workspaces } = await rpc<{ workspaces: { id: string }[] }>(
      "workspace.list",
      {},
    );
    if (!workspaces.some((w) => w.id === surface.workspaceId)) return;
    const { surfaces } = await rpc<{ surfaces: { id: string }[] }>(
      "surface.list",
      { workspace_id: surface.workspaceId },
    );
    if (!surfaces.some((s) => s.id === surface.surfaceId)) return;
    if (surfaces.length > 1) {
      await rpc("surface.close", target(surface));
    } else {
      await rpc("workspace.close", { workspace_id: surface.workspaceId });
    }
  } catch (err) {
    if (!/not_found/.test((err as Error).message)) throw err;
  }
}

// Closing with the close-session macro: the macro goes in as a prompt, and
// the chat exits once that turn ends. Held in memory only, since a restart
// mid-close just leaves the chat open, which loses nothing.
//
// A close is held, leaving the chat open with a note, when the turn never
// starts or never ends, when it ends on a question, or when it leaves
// uncommitted changes or its worktree behind: the session said why in its
// reply, which the user should read before it goes. Closing a held chat
// again exits it without the macro, unless the turn never started: then
// nothing ran, so closing again sends the macro again.
export interface Closing {
  state: "cleaning" | "held";
  note: string | null;
  since: number;
  // Held because the macro's turn never started, so the next close retries.
  retry: boolean;
}

// The prompt a held chat was last given when it was held, to tell when it
// has taken another turn since. Undefined when the hold had no card to read.
const heldOn = new Map<string, string | null>();

const closing = new Map<string, Closing>();
const CLOSE_POLL_MS = 3000;
const CLOSE_START_MS = 60_000;
const CLOSE_TURN_MS = 30 * 60_000;
// A held note stays on the card this long.
const HELD_VISIBLE_MS = 10 * 60_000;

// A held note goes once the chat is given another prompt, since whatever
// it said no longer holds: the user answered it, and it may have cleaned up.
export function closingState(
  sessionId: string,
  now: { lastPrompt: string | null },
): Closing | null {
  const c = closing.get(sessionId);
  if (c?.state !== "held") return c ?? null;
  const prompt = heldOn.get(sessionId);
  const prompted = prompt !== undefined && now.lastPrompt !== prompt;
  if (prompted || Date.now() - c.since > HELD_VISIBLE_MS) {
    closing.delete(sessionId);
    heldOn.delete(sessionId);
    return null;
  }
  return c;
}

// Stopping the clean-up turn calls the close off.
export function cancelClose(sessionId: string) {
  if (closing.get(sessionId)?.state === "cleaning") closing.delete(sessionId);
}

function hold(sessionId: string, note: string, card?: Card, retry = false) {
  closing.set(sessionId, { state: "held", note, since: Date.now(), retry });
  if (card) heldOn.set(sessionId, card.lastPrompt);
  else heldOn.delete(sessionId);
}

// The other live sessions under the same repo, in a sentence, so the
// session knows what a repo-wide command would reach.
function describeSiblings(card: Card, cards: Card[]): string {
  const repo = projectOf(card.cwd);
  const others = cards.filter(
    (c) =>
      c.sessionId !== card.sessionId &&
      c.column !== "done" &&
      projectOf(c.cwd) === repo,
  );
  if (others.length === 0) {
    return `No other sessions are live under ${repo} right now.`;
  }
  const where = (c: Card) => {
    const wt = worktreeOf(c.cwd);
    if (wt) return `worktree ${wt.split("/").at(-1)}`;
    return c.cwd === repo ? "the main checkout" : c.cwd;
  };
  const list = others.map((c) => `${c.name} (${where(c)})`);
  const named =
    list.length === 1
      ? list[0]
      : `${list.slice(0, -1).join(", ")} and ${list.at(-1)}`;
  const count =
    others.length === 1
      ? "is 1 other session"
      : `are ${others.length} other sessions`;
  return `There ${count} live under ${repo} right now: ${named}.`;
}

// The worktree a directory sits in, if any.
function worktreeOf(cwd: string): string | null {
  return cwd.match(/^.*\/(?:\.claude\/)?worktrees\/[^/]+/)?.[0] ?? null;
}

async function uncommitted(cwd: string): Promise<boolean> {
  if (!existsSync(cwd)) return false;
  try {
    const { stdout } = await run("git", ["-C", cwd, "status", "--porcelain"]);
    return stdout.trim() !== "";
  } catch {
    // Not a git checkout: nothing to lose by exiting.
    return false;
  }
}

// Close an idle chat, running the close-session macro first when one is
// set. `lookup` re-reads the card, since the board is derived per poll.
export async function closeSession(
  card: Card,
  cards: Card[],
  lookup: () => Promise<Card | undefined>,
) {
  const sessionId = card.sessionId;
  const current = closingState(sessionId, card);
  if (current?.state === "cleaning") {
    throw new Error("Already cleaning up before it closes");
  }
  const macro = configOrDefaults().macros.closeSession.text.trim();
  if (!macro || (current?.state === "held" && !current.retry)) {
    closing.delete(sessionId);
    await closeChat(sessionId);
    return;
  }
  const text = renderMacro(macro, {
    cwd: card.cwd,
    repo: projectOf(card.cwd),
    siblings: describeSiblings(card, cards),
  });
  const sentAt = Date.now();
  closing.set(sessionId, {
    state: "cleaning",
    note: null,
    since: sentAt,
    retry: false,
  });
  try {
    await sendMessage(sessionId, text);
  } catch (err) {
    closing.delete(sessionId);
    throw err;
  }
  void finishClose(sessionId, sentAt, lookup).catch((err: Error) => {
    if (closing.get(sessionId)?.state === "cleaning")
      hold(sessionId, `Not closed: ${err.message}`);
  });
}

async function finishClose(
  sessionId: string,
  sentAt: number,
  lookup: () => Promise<Card | undefined>,
) {
  let started = false;
  for (;;) {
    await pause(CLOSE_POLL_MS);
    // Stopped, or closed another way, in the meantime.
    if (closing.get(sessionId)?.state !== "cleaning") return;
    const card = await lookup();
    if (!card || card.column === "done") {
      closing.delete(sessionId);
      return;
    }
    // The transcript moving on after the paste is the turn starting.
    if ((card.lastActivityAt ?? 0) > sentAt) started = true;
    const waited = Date.now() - sentAt;
    if (!started && waited > CLOSE_START_MS) {
      hold(
        sessionId,
        "The close-session macro never started a turn, so it was left open. Close again to send it again",
        card,
        true,
      );
      return;
    }
    if (waited > CLOSE_TURN_MS) {
      hold(
        sessionId,
        "Clean-up was still running after 30 minutes, so it was left open",
        card,
      );
      return;
    }
    if (!started) continue;
    // A turn that ended by asking the user something wants an answer, not an
    // exit.
    if (card.waiting?.reason === ASKED_IN_REPLY) {
      hold(
        sessionId,
        "Left open: it asked you something. Close again to exit anyway",
        card,
      );
      return;
    }
    // Waiting on a dialog counts as still running.
    if (card.column === "idle") {
      if (await uncommitted(card.cwd)) {
        hold(
          sessionId,
          "Left open: uncommitted changes remain. Close again to exit anyway",
          card,
        );
        return;
      }
      const worktree = worktreeOf(card.cwd);
      if (worktree && existsSync(worktree)) {
        hold(
          sessionId,
          "Left open: its worktree is still there. Close again to exit anyway",
          card,
        );
        return;
      }
      await closeChat(sessionId);
      closing.delete(sessionId);
      return;
    }
  }
}

// Every session seamux starts runs in its own cmux workspace.
//
// cmux runs the command in a zsh login shell that does not read ~/.zshrc,
// so the session would miss the PATH and environment a terminal opened by
// hand gets (npx, pnpm, brew's tools). The command re-runs itself in an
// interactive instance of the user's own shell, which reads its startup
// files. Launch through cmux's own wrapper for the agent, which registers
// the session with cmux (so the board can find its surface), and put the
// agents' install directories first on PATH, in case those files do not.

// Which agents this Mac can launch: cmux's wrapper for it, and the agent
// itself where a launch would look.
export function installedEngines(): Record<Engine, boolean> {
  return Object.fromEntries(
    ENGINES.map((e) => [
      e,
      existsSync(HARNESSES[e].wrapper) && findBin(HARNESSES[e].bin) !== null,
    ]),
  ) as Record<Engine, boolean>;
}

const shq = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

async function launch(
  engine: Engine,
  cwd: string,
  title: string,
  args: string[],
  focus: boolean,
): Promise<Surface> {
  const harness = HARNESSES[engine];
  const created = await rpc<{ surface_id: string; workspace_id: string }>(
    "workspace.create",
    {
      cwd,
      title,
      initial_command: `exec ${shq(SHELL)} -ic ${shq(
        [
          `PATH=${BIN_DIRS.map(shq).join(":")}:"$PATH"`,
          shq(harness.wrapper),
          ...args.map(shq),
        ].join(" "),
      )}`,
      focus,
    },
  );
  const surface = {
    surfaceId: created.surface_id,
    workspaceId: created.workspace_id,
  };
  // Not awaited: the dialog, if any, shows up seconds after the launch.
  void macros.acceptTrust(new Session(surface, harness)).catch(() => {});
  return surface;
}

// A harness that picks its own session id, as Codex does, is filed by cmux
// under the surface once the first prompt goes in, a couple of seconds after
// the folder is trusted. Dispatching waits for it, to know which card is the
// new one.
const FILED_MS = 60_000;

async function sessionIn(engine: Engine, surface: Surface): Promise<string> {
  const deadline = Date.now() + FILED_MS;
  while (Date.now() < deadline) {
    await pause(1000);
    for (const [id, live] of await listLive()) {
      if (
        live.engine === engine &&
        live.surface.surfaceId === surface.surfaceId
      )
        return id;
    }
  }
  throw new Error(
    `${ENGINE_LABELS[engine]} started, but cmux never reported its session. Check its workspace`,
  );
}

// A new workspace starts Claude a few seconds after it is created, and
// until then nothing reports the session as live. Remember in-flight
// resumes so a second click in that window cannot start a second process
// on the same conversation.
const RESUME_GUARD_MS = 60_000;
const resuming = new Map<string, number>();

export async function resume(
  sessionId: string,
  cwd: string,
  title: string,
  engine: Engine,
) {
  const now = Date.now();
  const started = resuming.get(sessionId);
  if (started && now - started < RESUME_GUARD_MS) {
    throw new Error("Already resuming this chat");
  }
  // Claim it before the first await, so concurrent requests see the claim.
  resuming.set(sessionId, now);
  try {
    if ((await listSurfaces()).has(sessionId)) {
      throw new Error("This chat is already open in cmux");
    }
    const args = HARNESSES[engine].resumeArgs(sessionId);
    const surface = await launch(engine, cwd, title, args, true);
    if (HARNESSES[engine].filedOnPrompt)
      resumedUnfiled.set(sessionId, { engine, surface });
  } catch (err) {
    resuming.delete(sessionId);
    throw err;
  }
}

// An open chat renames itself with `/rename`, which Codex takes too, and
// which also retitles its tab.
// cmux's workspace title is its own, so it is set too, but only when the
// chat is the workspace's one tab: otherwise the title covers other chats.
// The rename has happened by then, so a failure there is not reported.
export async function renameLive(sessionId: string, name: string) {
  const surface = await driving(sessionId, async (s) => {
    await macros.rename(s, name);
    return s.surface;
  });
  try {
    const { surfaces } = await rpc<{ surfaces: { id: string }[] }>(
      "surface.list",
      { workspace_id: surface.workspaceId },
    );
    if (surfaces.length === 1 && surfaces[0].id === surface.surfaceId) {
      await rpc("workspace.rename", {
        workspace_id: surface.workspaceId,
        title: name,
      });
    }
  } catch {}
}

// A closed chat is named where its harness keeps names (renameClosed on its
// Harness). Not while a resume is starting, since the new process would
// write its old name back.
export async function renameClosed(
  sessionId: string,
  transcript: string,
  name: string,
  engine: Engine,
) {
  const started = resuming.get(sessionId);
  if (started && Date.now() - started < RESUME_GUARD_MS) {
    throw new Error("This chat is resuming; rename it once it is open");
  }
  await HARNESSES[engine].renameClosed(sessionId, transcript, name);
}

// Brings a stopped background session back in a new cmux workspace, with
// its conversation. `claude attach` restarts it from its job, even when its
// transcript is gone. The wrapper passes subcommands through without
// registering a surface, so the board can show it but not type into it.
export async function attach(
  sessionId: string,
  shortId: string,
  cwd: string,
  title: string,
) {
  const now = Date.now();
  const started = resuming.get(sessionId);
  if (started && now - started < RESUME_GUARD_MS) {
    throw new Error("Already resuming this session");
  }
  resuming.set(sessionId, now);
  try {
    await launch("claude", cwd, title, ["attach", shortId], true);
  } catch (err) {
    resuming.delete(sessionId);
    throw err;
  }
}

// Deleting a background session no open chat owns. seamux never deletes, so
// it dispatches a chat that checks the session and runs `claude rm` itself,
// stopping to ask before discarding unpushed work. The chat starts in the
// session's main checkout, since `claude rm` may remove the worktree the
// session ran in.
export async function askToDelete(orphan: {
  id: string;
  name: string;
  cwd: string;
}): Promise<string> {
  let cwd = orphan.cwd;
  try {
    const { stdout } = await run("git", [
      "-C",
      cwd,
      "rev-parse",
      "--path-format=absolute",
      "--git-common-dir",
    ]);
    cwd = dirname(stdout.trim());
  } catch {
    // Not a repository, or already gone: the nearest directory that exists.
    while (!existsSync(cwd) && cwd !== dirname(cwd)) cwd = dirname(cwd);
  }
  return dispatch({
    cwd,
    engine: "claude",
    name: `rm-${orphan.id}`,
    prompt: [
      `Delete the background session ${orphan.id} (${orphan.name}, in ${orphan.cwd}).`,
      `Check it with \`claude agents --json --all\`, then run \`claude rm ${orphan.id}\`.`,
      "If it reports unpushed commits or uncommitted changes, stop and tell me instead of discarding them.",
    ].join(" "),
  });
}

// Any real directory can be dispatched into.
export async function checkDirectory(path: string): Promise<string> {
  if (!path.startsWith("/")) throw new Error("Pick an absolute directory");
  let real: string;
  try {
    real = await realpath(path);
  } catch {
    throw new Error(`No such directory: ${path}`);
  }
  if (!(await stat(real)).isDirectory())
    throw new Error(`Not a directory: ${path}`);
  return real;
}

// Every name a session or a cmux workspace goes by now. A new session
// takes a name outside it, so no two chats or workspaces share one.
async function namesInUse(): Promise<Set<string>> {
  const [agents, { workspaces }] = await Promise.all([
    run("claude", ["agents", "--json", "--all"], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 10_000,
    }).then(
      ({ stdout }) => JSON.parse(stdout) as { name?: string | null }[],
      () => [],
    ),
    rpc<{ workspaces: { title?: string | null }[] }>("workspace.list", {}),
  ]);
  return new Set(
    [...agents.map((a) => a.name), ...workspaces.map((w) => w.title)].filter(
      (n): n is string => !!n,
    ),
  );
}

// What goes on the end of a name to make it free: nothing, else -2, -3, ...
async function freeSuffix(
  taken: (suffix: string) => boolean | Promise<boolean>,
): Promise<string> {
  let suffix = "";
  for (let n = 2; await taken(suffix); n++) suffix = `-${n}`;
  return suffix;
}

// A short, readable name from the first words of a prompt.
export function nameFrom(prompt: string): string {
  return (
    prompt
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 4)
      .join("-")
      .slice(0, 40) || "work"
  );
}

const WORKTREE_NAME = /^[a-z0-9][a-z0-9._/-]{0,60}$/;

interface NewWorktree {
  // What went on the end of the name asked for to make it free.
  suffix: string;
  path: string;
  branch: string;
  // The repo's main checkout, which holds every worktree.
  repo: string;
  // Where in it the worktrees go: .claude/worktrees/ or worktrees/.
  home: string;
}

// A new worktree for dispatched work, branched from what the chosen checkout
// has checked out now. seamux makes it rather than `claude --worktree`, which
// branches from the remote's default branch (stale when main is unpushed)
// and stops on exit to ask whether to keep the worktree.
//
// It goes in the repo's main checkout, even when the chosen checkout is
// itself a worktree, so worktrees never nest: under .claude/worktrees if
// that exists, else worktrees/.
//
// The same prompt gives the same name, so a name whose worktree or branch
// already exists, or that nameTaken says is taken elsewhere, gets the next
// free number on the end.
async function createWorktree(
  cwd: string,
  name: string,
  nameTaken: (suffix: string) => boolean,
): Promise<NewWorktree> {
  let list: string;
  try {
    ({ stdout: list } = await run("git", [
      "-C",
      cwd,
      "worktree",
      "list",
      "--porcelain",
    ]));
  } catch {
    throw new Error("A new worktree needs a git repository");
  }
  // The main checkout is the first entry git lists, from any worktree.
  const repo = list.split("\n")[0].replace(/^worktree /, "");
  const relHome = existsSync(join(repo, ".claude/worktrees"))
    ? ".claude/worktrees/"
    : "worktrees/";
  const home = join(repo, relHome);
  const taken = async (candidate: string) =>
    existsSync(join(home, candidate)) ||
    (await run("git", [
      "-C",
      repo,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/worktree-${candidate}`,
    ]).then(
      () => true,
      () => false,
    ));
  const suffix = await freeSuffix(
    async (s) => nameTaken(s) || (await taken(name + s)),
  );
  const path = join(home, name + suffix);
  const branch = `worktree-${name}${suffix}`;
  // HEAD as the chosen checkout sees it, not the main checkout's.
  await run("git", ["-C", cwd, "worktree", "add", path, "-b", branch, "HEAD"]);
  return { suffix, path, branch, repo, home: relHome };
}

// The first prompt of a dispatched session: the new-session macro around
// what was typed, with How to worktree when it has a new worktree. A macro
// customised without {{how_to_worktree}} gets it at the end.
function firstPrompt(prompt: string, cwd: string, wt: NewWorktree | null) {
  const { macros } = configOrDefaults();
  const howTo = wt
    ? renderMacro(macros.howToWorktree.text, {
        worktree: wt.path,
        branch: wt.branch,
        repo: wt.repo,
        worktrees: wt.home,
      }).trim()
    : "";
  let text = macros.newSession.text;
  if (howTo && !usesVariable(text, "how_to_worktree"))
    text += "\n\n{{how_to_worktree}}";
  return renderMacro(text, { prompt, cwd, how_to_worktree: howTo }).trim();
}

// A leading dash would be read as a flag.
const asPrompt = (p: string) => (p.startsWith("-") ? `Task: ${p}` : p);

export interface DispatchInput {
  cwd: string;
  // Claude Code unless given: fan-out workers rely on its hooks and skill.
  engine?: Engine;
  prompt: string;
  name?: string;
  worktree?: string | null;
  dispatchId?: string | null;
  worker?: string | null;
}

// Start new work as its own top-level session, and record why.
export async function dispatch(input: DispatchInput): Promise<string> {
  const cwd = await checkDirectory(input.cwd);
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error("Say what the new session should do");
  const asked = input.name?.trim() || nameFrom(prompt);
  const worktree = input.worktree?.trim() || null;
  if (worktree && !WORKTREE_NAME.test(worktree)) {
    throw new Error("Worktree names are lowercase letters, digits, - . _ /");
  }

  const engine = input.engine ?? "claude";
  // One number makes the session's name, its cmux workspace's and its
  // worktree's all free, so they read the same.
  const inUse = await namesInUse();
  const nameTaken = (suffix: string) => inUse.has(asked + suffix);
  const wt = worktree ? await createWorktree(cwd, worktree, nameTaken) : null;
  const suffix = wt ? wt.suffix : await freeSuffix(nameTaken);
  const name = asked + suffix;
  const where = wt?.path ?? cwd;
  // The session gets the prompt inside the new-session macro; the card
  // shows what was typed.
  const first = asPrompt(firstPrompt(prompt, where, wt));
  const record = (sessionId: string) =>
    recordDispatch({
      session_id: sessionId,
      cwd: where,
      prompt,
      name,
      worktree: wt ? worktree + wt.suffix : null,
      forked_from: null,
      dispatch_id: input.dispatchId ?? null,
      worker: input.worker ?? null,
    });

  const { identify } = HARNESSES[engine];
  if (!identify) {
    const surface = await launch(engine, where, name, [first], false);
    const sessionId = await sessionIn(engine, surface);
    record(sessionId);
    return sessionId;
  }
  const sessionId = randomUUID();
  record(sessionId);
  await launch(
    engine,
    where,
    name,
    [...identify(sessionId, name), first],
    false,
  );
  return sessionId;
}

// Split a tangent out of a chat: a new session that starts with the
// parent's full context, leaving the parent untouched.
export async function fork(
  parentId: string,
  cwd: string,
  prompt: string,
  engine: Engine,
): Promise<string> {
  const text = prompt.trim();
  if (!text) throw new Error("Say what the tangent is");
  const forkArgs = HARNESSES[engine].fork;
  if (!forkArgs)
    throw new Error(`${ENGINE_LABELS[engine]} chats can't be forked`);
  const sessionId = randomUUID();
  const inUse = await namesInUse();
  const base = nameFrom(text);
  const name = base + (await freeSuffix((s) => inUse.has(base + s)));
  recordDispatch({
    session_id: sessionId,
    cwd,
    prompt: text,
    name,
    worktree: null,
    forked_from: parentId,
    dispatch_id: null,
    worker: null,
  });
  await launch(
    engine,
    cwd,
    name,
    [...forkArgs(parentId, sessionId, name), asPrompt(text)],
    false,
  );
  return sessionId;
}
