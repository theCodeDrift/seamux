// Picks chats back up after a failed request. Claude Code writes one in
// place of a reply, such as "API Error: Can't reach the API server", "529
// Overloaded" or "Your computer went to sleep mid-response", and waits; each
// goes through when tried again once the API answers. This loop asks the API
// whether it answers, and once it has since a chat's error, sends that chat
// the resume macro. An expired login is the sign-in's to settle
// (service.server.ts), not this loop's.

import { atRest, type Card } from "./board.ts";
import { loadBoard } from "./board.server";
import { resumeTurn } from "./drive.server";
import { HARNESSES } from "./harness.server";
import { queuedFor } from "./store.server";

const TICK_MS = 10_000;
const PROBE_TIMEOUT_MS = 5_000;
// Claude Code's own endpoint, or what the board's environment points it at.
// Any answer, a 404 at its root included, means it can be reached.
const API_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
// How long after its error a chat is tried, by how many times it has been,
// and left to the user after the last. An overloaded server answers a probe
// at once, and the board can reach the API while Claude Code can't, behind
// a proxy only it uses, so this keeps either from retrying without end.
const BACKOFF_MS = [30_000, 60_000, 120_000];

export interface Tried {
  // The error last resumed, so it is resumed once.
  errorAt: number;
  count: number;
}

// Kept on globalThis so a hot reload replaces the timer instead of adding a
// second one. startedAt survives a hot reload but not a restart: an error
// from before the board started is one the user has seen sit there, and
// resuming it unasked would surprise them.
const state = ((globalThis as any).__seamuxReconnect ??= {
  timer: null,
  running: false,
  startedAt: Date.now(),
  reachableAt: 0,
  tried: new Map(),
}) as {
  timer: NodeJS.Timeout | null;
  running: boolean;
  startedAt: number;
  // When the API last answered a probe.
  reachableAt: number;
  tried: Map<string, Tried>;
};

// Idempotent, so every entry point can call it. Once per module load it
// swaps out a timer left by the code before a hot reload.
let started = false;
export function startReconnect() {
  if (started) return;
  started = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => void tick(), TICK_MS);
}

async function tick() {
  if (state.running) return;
  state.running = true;
  try {
    await reconnect();
  } catch (err) {
    console.error("seamux reconnect:", (err as Error).message);
  } finally {
    state.running = false;
  }
}

// Whether a chat is due its resume, the API aside: a live chat of a harness
// that reconnects, at rest on a request that failed since the board started,
// not resumed for that one yet, with tries left and its backoff over.
export function due(
  card: Card,
  now: number,
  startedAt: number,
  tried: Tried | undefined,
): boolean {
  if (
    card.column === "done" ||
    !HARNESSES[card.engine].reconnects ||
    card.apiError?.kind !== "server_error" ||
    !atRest(card) ||
    !card.drivable ||
    card.closing
  )
    return false;
  const at = card.apiError.at;
  const count = tried?.count ?? 0;
  return (
    at > startedAt &&
    tried?.errorAt !== at &&
    count < BACKOFF_MS.length &&
    now - at >= BACKOFF_MS[count]
  );
}

// Whether a chat's tries are over: it settled on a reply, or closed. One
// working on a resume keeps its count, in case that ends on another error.
export function settled(card: Card | undefined): boolean {
  return !card || card.column === "done" || (atRest(card) && !card.apiError);
}

async function probe(): Promise<void> {
  try {
    await fetch(API_URL, {
      method: "HEAD",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    state.reachableAt = Date.now();
  } catch {
    // No answer: try again next tick.
  }
}

async function reconnect() {
  const now = Date.now();
  const { cards } = await loadBoard(now);
  for (const id of state.tried.keys()) {
    if (settled(cards.find((c) => c.sessionId === id))) state.tried.delete(id);
  }
  const ready = cards.filter(
    (card) =>
      due(card, now, state.startedAt, state.tried.get(card.sessionId)) &&
      // A queued message goes next, and picks the chat up itself.
      queuedFor([card.sessionId]).length === 0,
  );
  if (ready.some((card) => card.apiError!.at >= state.reachableAt))
    await probe();
  for (const card of ready) {
    const at = card.apiError!.at;
    if (at >= state.reachableAt) continue;
    const count = state.tried.get(card.sessionId)?.count ?? 0;
    state.tried.set(card.sessionId, { errorAt: at, count: count + 1 });
    try {
      await resumeTurn(card.sessionId);
    } catch (err) {
      console.error(
        `seamux reconnect: ${card.sessionId}:`,
        (err as Error).message,
      );
    }
  }
}
