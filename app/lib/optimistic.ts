import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import type { Card, Column, FailedStart } from "./board.ts";
import type { Engine } from "./config.ts";

// A card moved by the board ahead of the poll that confirms it: a sent
// message puts it in Working, a close in Done. With many chats a poll takes
// a while, and `claude agents` lags behind the transcript besides, so the
// card moves as the button is pressed. Once a poll shows it there, or the
// hold runs out, the polled state is the card's again: a card that
// finished before any poll saw it working goes back where it was.
interface Expected {
  column: Column;
  at: number;
}

// Long enough for a busy board's poll to catch up.
const HOLD_MS = 12_000;

// A chat being dispatched or forked, shown in Working from the moment it is
// sent until the board lists it. `sessionId` is null until the server has
// picked one.
export interface Spawning {
  key: string;
  sessionId: string | null;
  name: string;
  cwd: string;
  intent: string;
  engine: Engine;
  forked: boolean;
  at: number;
}

// Launching a session can take a while: a worktree, a cmux workspace, the
// agent's own start-up. Longer than the server waits before it reports a
// launch as stalled (STALLED_MS in launches.server.ts), so the card that
// says so takes this one's place rather than following a gap.
const SPAWN_MS = 120_000;

interface Optimistic {
  expect: (sessionId: string, column: Column) => void;
  // Called when the action failed: the card is what the poll says.
  drop: (sessionId: string) => void;
  // Returns the placeholder's key, for `started`.
  spawn: (s: Omit<Spawning, "key" | "sessionId" | "at">) => string;
  // The spawn's session id, or null when it failed to start.
  started: (key: string, sessionId: string | null) => void;
  expected: (sessionId: string) => boolean;
}

export const OptimisticContext = createContext<Optimistic>({
  expect: () => {},
  drop: () => {},
  spawn: () => "",
  started: () => {},
  expected: () => false,
});

export function useOptimistic(): Optimistic {
  return useContext(OptimisticContext);
}

// Still to be confirmed by the board. A close whose macro is still cleaning
// up holds as long as that runs; once the server holds it open, it is open.
function holds(e: Expected, card: Card, now: number): boolean {
  if (card.column === e.column) return false;
  if (e.column === "done" && card.closing) {
    return card.closing.state === "cleaning";
  }
  return now - e.at < HOLD_MS;
}

// The card a spawn became. Until its action returns, the id isn't known,
// but a poll can list the chat before then: its intent is the prompt,
// flattened and cut short.
function listedAs(s: Spawning, cards: Card[]): Card | undefined {
  if (s.sessionId) return cards.find((c) => c.sessionId === s.sessionId);
  const flat = s.intent.replace(/\s+/g, " ").trim();
  return cards.find((c) => {
    const intent = c.intent?.replace(/…$/, "");
    return (
      !!intent &&
      flat.startsWith(intent) &&
      !!c.forkedFrom === s.forked &&
      c.column !== "done"
    );
  });
}

function moved(card: Card, column: Column): Card {
  return {
    ...card,
    column,
    // So Stop works on a card sent a message a moment ago.
    turnRunning: column === "working",
    waiting: column === "waiting" ? card.waiting : null,
  };
}

// The board's cards with the moves it expects applied, and the chats still
// starting. A chat the server reports failed to start is no longer
// starting: its failed card shows instead.
export function useOptimisticBoard(
  cards: Card[],
  failedStarts: FailedStart[] = [],
) {
  const [expects, setExpects] = useState<Record<string, Expected>>({});
  const [spawns, setSpawns] = useState<Spawning[]>([]);
  const counter = useRef(0);

  const expect = useCallback((sessionId: string, column: Column) => {
    setExpects((x) => ({ ...x, [sessionId]: { column, at: Date.now() } }));
  }, []);
  const drop = useCallback((sessionId: string) => {
    setExpects((x) => {
      if (!(sessionId in x)) return x;
      const { [sessionId]: _, ...rest } = x;
      return rest;
    });
  }, []);
  const spawn = useCallback((s: Omit<Spawning, "key" | "sessionId" | "at">) => {
    const key = `spawn:${++counter.current}`;
    setSpawns((list) => [
      ...list,
      { ...s, key, sessionId: null, at: Date.now() },
    ]);
    return key;
  }, []);
  const started = useCallback((key: string, sessionId: string | null) => {
    setSpawns((list) =>
      sessionId
        ? list.map((s) =>
            s.key === key ? { ...s, sessionId, at: Date.now() } : s,
          )
        : list.filter((s) => s.key !== key),
    );
  }, []);

  // Each poll settles what it confirms or has outlasted. A spawn the board
  // now lists becomes an expected move to Working, in case the first poll
  // to see it still has it idle.
  useEffect(() => {
    const now = Date.now();
    const byId = new Map(cards.map((c) => [c.sessionId, c]));
    const listed = spawns.flatMap((s) => listedAs(s, cards) ?? []);
    const failed = new Set(failedStarts.map((f) => f.sessionId));
    const gone = new Set(
      spawns
        .filter(
          (s) =>
            listedAs(s, cards) ||
            (s.sessionId && failed.has(s.sessionId)) ||
            now - s.at >= SPAWN_MS,
        )
        .map((s) => s.key),
    );
    setSpawns((list) => {
      const next = list.filter((s) => !gone.has(s.key));
      return next.length === list.length ? list : next;
    });
    setExpects((x) => {
      let changed = false;
      const next: Record<string, Expected> = {};
      for (const [id, e] of Object.entries(x)) {
        const card = byId.get(id);
        if (card ? holds(e, card, now) : now - e.at < HOLD_MS) next[id] = e;
        else changed = true;
      }
      for (const card of listed) {
        next[card.sessionId] = { column: "working", at: now };
        changed = true;
      }
      return changed ? next : x;
    });
    // Only on a new board: the spawns read here are the ones it answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, failedStarts]);

  const now = Date.now();
  const shown = cards.map((card) => {
    const e = expects[card.sessionId];
    return e && holds(e, card, now) ? moved(card, e.column) : card;
  });
  const failed = new Set(failedStarts.map((f) => f.sessionId));
  const starting = spawns.filter(
    (s) => !listedAs(s, cards) && !(s.sessionId && failed.has(s.sessionId)),
  );
  const context = useMemo<Optimistic>(
    () => ({
      expect,
      drop,
      spawn,
      started,
      expected: (id) => id in expects,
    }),
    [expect, drop, spawn, started, expects],
  );
  return { cards: shown, starting, context };
}
