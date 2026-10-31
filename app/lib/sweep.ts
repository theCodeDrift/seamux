// What the browser keeps for a chat goes once the chat has been missing from
// the board for this many healthy polls in a row: minutes, at a poll every
// few seconds, longer in a hidden tab, and never while the board can't see
// every chat.
export const SWEEP_AFTER_POLLS = 100;

// Browser storage kept per chat, each key ending in its session id.
export const chatOpenKey = (sessionId: string) =>
  `seamux:chat-open:${sessionId}`;
export const scrollKey = (sessionId: string) =>
  `seamux:chat-scroll:${sessionId}`;
export const queueEditsKey = (sessionId: string) =>
  `seamux:queue-edits:${sessionId}`;

const PER_SESSION = [chatOpenKey(""), scrollKey(""), queueEditsKey("")];

// One poll's tally. `missing` holds, for each id, how many healthy polls in
// a row it has been missing; a poll that can't see every chat starts every
// count again, and so does an id on the board. Returns the ids to sweep.
export function tallyMissing(
  missing: Map<string, number>,
  known: Iterable<string>,
  present: Set<string>,
  healthy: boolean,
  after = SWEEP_AFTER_POLLS,
): string[] {
  const counts = new Map(missing);
  missing.clear();
  if (!healthy) return [];
  const gone: string[] = [];
  for (const id of new Set(known)) {
    if (present.has(id)) continue;
    const n = (counts.get(id) ?? 0) + 1;
    if (n >= after) gone.push(id);
    else missing.set(id, n);
  }
  return gone;
}

// The session ids browser storage holds anything for.
export function storedSessionIds(): string[] {
  const ids: string[] = [];
  for (const prefix of PER_SESSION) {
    try {
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (key?.startsWith(prefix)) ids.push(key.slice(prefix.length));
      }
    } catch {}
  }
  return ids;
}

export function forgetStored(sessionId: string) {
  for (const prefix of PER_SESSION) {
    try {
      sessionStorage.removeItem(prefix + sessionId);
    } catch {}
  }
}
