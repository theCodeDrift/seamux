// Sends seamux's queued messages. A message written while a chat works is
// held in the store rather than pasted into Claude Code's own queue, so it
// can be edited or removed until it goes. This loop sends the oldest one
// once the chat takes input, one per turn: idle, waiting only because its
// reply ended on a question, which the next message may well answer, or
// working only on subagents while its own turn has ended.

import { takesInput, type Card } from "./board.ts";
import { loadBoard } from "./board.server";
import { UnsentError } from "./drive.server";
import { sendOrSignIn } from "./service.server";
import {
  queuedFor,
  queuedSessions,
  restoreQueued,
  takeQueued,
} from "./store.server";

const TICK_MS = 3000;
// After a send, the chat reads idle until its turn shows up. The next
// message waits until the chat has been seen working, or its transcript
// moved and it stayed idle this long, or this much longer if nothing moved.
const SETTLE_MS = 10_000;
const GIVE_UP_MS = 60_000;

interface Sent {
  at: number;
  seenBusy: boolean;
}

// Kept on globalThis so a hot reload replaces the timer instead of adding a
// second one, and remembers what was just sent.
const state = ((globalThis as any).__seamuxQueue ??= {
  timer: null as NodeJS.Timeout | null,
  running: false,
  sent: new Map<string, Sent>(),
}) as {
  timer: NodeJS.Timeout | null;
  running: boolean;
  sent: Map<string, Sent>;
};

// Idempotent, so every entry point can call it. Once per module load it
// swaps out a timer left by the code before a hot reload.
let started = false;
export function startQueue() {
  if (started) return;
  started = true;
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => void tick(), TICK_MS);
}

async function tick() {
  if (state.running) return;
  state.running = true;
  try {
    await drain();
  } catch (err) {
    console.error("seamux queue:", (err as Error).message);
  } finally {
    state.running = false;
  }
}

export function ready(card: Card, now: number): boolean {
  const sent = state.sent.get(card.sessionId);
  const rest = takesInput(card);
  if (sent && !rest) sent.seenBusy = true;
  if (!rest || !card.drivable || card.closing) return false;
  if (!sent || sent.seenBusy) return true;
  const since = now - sent.at;
  if ((card.lastActivityAt ?? 0) > sent.at) return since > SETTLE_MS;
  return since > GIVE_UP_MS;
}

async function drain() {
  const sessions = queuedSessions();
  if (sessions.length === 0) {
    state.sent.clear();
    return;
  }
  const { cards } = await loadBoard();
  const now = Date.now();
  for (const sessionId of sessions) {
    const card = cards.find((c) => c.sessionId === sessionId);
    // A closed chat keeps its queue, on its Done card, until it is resumed.
    if (!card || !ready(card, now)) continue;
    const [next] = queuedFor([sessionId]);
    const row = next && takeQueued(next.id, sessionId);
    if (!row) continue;
    try {
      // A `/login` starts no turn, so the next message needn't wait on one.
      const about = async () => ({ name: card.name, cwd: card.cwd });
      if (await sendOrSignIn(sessionId, row.text, about)) {
        state.sent.set(sessionId, { at: Date.now(), seenBusy: false });
      }
    } catch (err) {
      // Typed but not sent: queued again, it would be typed a second time.
      if (!(err instanceof UnsentError)) restoreQueued(row);
      console.error(`seamux queue: ${sessionId}:`, (err as Error).message);
    }
  }
}
