// The durable store: only what cannot be re-derived from the tools.
//
// Imported by the app and by the hook script, which Node runs directly with
// type stripping. So: relative imports with extensions, `import type`, and
// no TypeScript-only runtime syntax.

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { DATA_DIR } from "./paths.server.ts";

export const DB_PATH = process.env.SEAMUX_DB ?? join(DATA_DIR, "seamux.db");

// Two kinds of table. `config` holds what the user chose: settings, themes,
// macros, pins, project colours. It is a JSON value per key, so its shape
// never changes: something new is a new key, and the code that reads a key
// accepts the shapes it held before. It is never dropped.
//
// Every other table can be lost: hook records, dispatch records and queued
// messages, which matter for minutes. When their schema changes, bump
// SCHEMA_VERSION and they are dropped and made afresh on the next open,
// rather than migrated. Keep nothing in them the user would miss.
const CONFIG = `
  -- A JSON value per key; a missing key means the default.
  CREATE TABLE IF NOT EXISTS config (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

export const SCHEMA_VERSION = 1;

const REBUILT = ["subagents", "dispatches", "queued_messages"];

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS subagents (
    agent_id        TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    agent_type      TEXT,
    cwd             TEXT,
    transcript_path TEXT,    -- the parent session's transcript
    started_at      INTEGER, -- ms since epoch
    stopped_at      INTEGER, -- null while running
    last_message    TEXT     -- from SubagentStop
  );
  CREATE INDEX IF NOT EXISTS subagents_session ON subagents (session_id);

  -- Sessions seamux started, and why. Nothing else records a session's goal.
  CREATE TABLE IF NOT EXISTS dispatches (
    session_id     TEXT PRIMARY KEY,
    cwd            TEXT NOT NULL,
    prompt         TEXT NOT NULL,
    name           TEXT,
    worktree       TEXT,    -- worktree name, when started in a new one
    forked_from    TEXT,    -- parent session id, for a forked tangent
    dispatch_id    TEXT,    -- fan-out set this worker belongs to, if any
    worker         TEXT,    -- the worker's key within that set
    created_at     INTEGER NOT NULL
  );

  -- Messages the user wrote while a chat was working, held here instead of in
  -- Claude Code's queue so they can be edited. Sent in id order, one per
  -- turn, once the chat is idle; a row goes as it is sent.
  CREATE TABLE IF NOT EXISTS queued_messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    text       TEXT NOT NULL,
    queued_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS queued_messages_session
    ON queued_messages (session_id);
`;

let db: DatabaseSync | null = null;

// Drops and remakes the tables that can be lost when SCHEMA_VERSION has
// moved. Pins had a table of their own before they moved into config, and
// are carried over from it.
function rebuild(store: DatabaseSync): void {
  store.exec("BEGIN IMMEDIATE");
  try {
    const { user_version } = store.prepare(`PRAGMA user_version`).get() as {
      user_version: number;
    };
    if (user_version !== SCHEMA_VERSION) {
      carryLegacyPins(store);
      for (const table of [...REBUILT, "pins"]) {
        store.exec(`DROP TABLE IF EXISTS ${table}`);
      }
      store.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    }
    store.exec(SCHEMA);
    store.exec("COMMIT");
  } catch (err) {
    store.exec("ROLLBACK");
    throw err;
  }
}

function carryLegacyPins(store: DatabaseSync): void {
  const table = store
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'pins'`,
    )
    .get();
  if (!table || readValue(PINS_KEY, store) !== undefined) return;
  const columns = (
    store.prepare(`PRAGMA table_info(pins)`).all() as unknown as {
      name: string;
    }[]
  ).map((c) => c.name);
  const has = (c: string) => (columns.includes(c) ? c : "NULL");
  const rows = store
    .prepare(
      `SELECT session_id, pinned_at, ${has("pid")} AS pid,
              ${has("started_at")} AS started_at,
              ${has("cleared_from")} AS cleared_from
       FROM pins ORDER BY ${has("position")}, pinned_at`,
    )
    .all() as unknown as {
    session_id: string;
    pinned_at: number;
    pid: number | null;
    started_at: number | null;
    cleared_from: string | null;
  }[];
  if (rows.length === 0) return;
  writeValue(
    PINS_KEY,
    rows.map((r): PinRow => ({
      sessionId: r.session_id,
      pinnedAt: r.pinned_at,
      pid: r.pid,
      startedAt: r.started_at,
      clearedFrom: r.cleared_from,
    })),
    store,
  );
}

export function openStore(): DatabaseSync {
  if (db) return db;
  mkdirSync(dirname(DB_PATH), { recursive: true });
  // Many hooks write at once during a fan-out, so wait on locks from the
  // first statement, including the switch to WAL.
  const store = new DatabaseSync(DB_PATH, { timeout: 5000 });
  store.exec("PRAGMA journal_mode = WAL;");
  store.exec(CONFIG);
  rebuild(store);
  db = store;
  return db;
}

// A config key's value, parsed, or undefined when it is missing or broken.
export function readValue(key: string, store = openStore()): unknown {
  const row = store
    .prepare(`SELECT value FROM config WHERE key = ?`)
    .get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value);
  } catch {
    return undefined;
  }
}

// `undefined` removes the key.
export function writeValue(
  key: string,
  value: unknown,
  store = openStore(),
): void {
  if (value === undefined) {
    store.prepare(`DELETE FROM config WHERE key = ?`).run(key);
    return;
  }
  store
    .prepare(
      `INSERT INTO config (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value));
}

// Reads a key, changes it, and writes it back if `change` returned a new
// value, holding the write lock throughout so two changes can't interleave.
export function updateValue<T>(
  key: string,
  read: (raw: unknown) => T,
  change: (value: T) => T,
): T {
  const store = openStore();
  store.exec("BEGIN IMMEDIATE");
  try {
    const before = read(readValue(key, store));
    const after = change(before);
    if (after !== before) writeValue(key, after, store);
    store.exec("COMMIT");
    return after;
  } catch (err) {
    store.exec("ROLLBACK");
    throw err;
  }
}

export interface SubagentRow {
  agent_id: string;
  session_id: string;
  agent_type: string | null;
  cwd: string | null;
  transcript_path: string | null;
  started_at: number | null;
  stopped_at: number | null;
  last_message: string | null;
}

export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  agent_id?: string;
  agent_type?: string;
  cwd?: string;
  transcript_path?: string;
  last_assistant_message?: string;
}

export function recordHook(p: HookPayload, now = Date.now()): void {
  if (!p.agent_id || !p.session_id) return;
  // Claude Code's internal helper agents fire SubagentStop with an empty
  // type and never fire SubagentStart. They are not the user's subagents.
  if (!p.agent_type) return;
  const store = openStore();
  if (p.hook_event_name === "SubagentStart") {
    // A resumed subagent starts again: keep its first start, clear the stop.
    store
      .prepare(
        `INSERT INTO subagents
           (agent_id, session_id, agent_type, cwd, transcript_path, started_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET stopped_at = NULL`,
      )
      .run(
        p.agent_id,
        p.session_id,
        p.agent_type ?? null,
        p.cwd ?? null,
        p.transcript_path ?? null,
        now,
      );
  } else if (p.hook_event_name === "SubagentStop") {
    // Upsert, in case the start was missed (hooks installed mid-run).
    store
      .prepare(
        `INSERT INTO subagents
           (agent_id, session_id, agent_type, cwd, transcript_path, stopped_at, last_message)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (agent_id) DO UPDATE SET
           stopped_at = excluded.stopped_at,
           last_message = excluded.last_message`,
      )
      .run(
        p.agent_id,
        p.session_id,
        p.agent_type ?? null,
        p.cwd ?? null,
        p.transcript_path ?? null,
        now,
        p.last_assistant_message ?? null,
      );
  }
}

export function subagentsFor(
  sessionIds: string[],
  since: number,
): SubagentRow[] {
  if (sessionIds.length === 0) return [];
  const marks = sessionIds.map(() => "?").join(", ");
  return openStore()
    .prepare(
      `SELECT * FROM subagents
       WHERE session_id IN (${marks})
         AND agent_type != ''  -- rows from before the hook ignored helpers
         AND (stopped_at IS NULL OR stopped_at >= ?)
       ORDER BY started_at`,
    )
    .all(...sessionIds, since) as unknown as SubagentRow[];
}

export interface DispatchRow {
  session_id: string;
  cwd: string;
  prompt: string;
  name: string | null;
  worktree: string | null;
  forked_from: string | null;
  dispatch_id: string | null;
  worker: string | null;
  created_at: number;
}

export function recordDispatch(
  row: Omit<DispatchRow, "created_at">,
  now = Date.now(),
): void {
  openStore()
    .prepare(
      `INSERT INTO dispatches
         (session_id, cwd, prompt, name, worktree, forked_from, dispatch_id, worker, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      row.session_id,
      row.cwd,
      row.prompt,
      row.name,
      row.worktree,
      row.forked_from,
      row.dispatch_id,
      row.worker,
      now,
    );
}

export function dispatchesFor(sessionIds: string[]): DispatchRow[] {
  if (sessionIds.length === 0) return [];
  const marks = sessionIds.map(() => "?").join(", ");
  return openStore()
    .prepare(`SELECT * FROM dispatches WHERE session_id IN (${marks})`)
    .all(...sessionIds) as unknown as DispatchRow[];
}

export function recentDispatchCwds(limit = 50): string[] {
  return (
    openStore()
      .prepare(
        `SELECT cwd FROM dispatches GROUP BY cwd ORDER BY MAX(created_at) DESC LIMIT ?`,
      )
      .all(limit) as unknown as { cwd: string }[]
  ).map((r) => r.cwd);
}

// Sessions the user pinned, because they are meant to run for a long time,
// in the order they dragged them into; a new pin goes last. Each notes the
// Claude Code process the chat last ran in, which `/clear` keeps under a new
// session id, and the chat it was carried from by one.
export interface PinRow {
  sessionId: string;
  pinnedAt: number;
  pid: number | null;
  startedAt: number | null;
  clearedFrom: string | null;
}

const PINS_KEY = "pins";

function readPins(raw: unknown): PinRow[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (p): p is PinRow =>
      typeof p?.sessionId === "string" && typeof p?.pinnedAt === "number",
  );
}

function updatePins(change: (pins: PinRow[]) => PinRow[]): void {
  updateValue(PINS_KEY, readPins, change);
}

export function pins(): PinRow[] {
  return readPins(readValue(PINS_KEY));
}

export function pinnedSessions(): string[] {
  return pins().map((p) => p.sessionId);
}

// Notes the process a pinned chat runs in, when it has changed.
export function notePinProcess(
  sessionId: string,
  pid: number,
  startedAt: number,
): void {
  updatePins((all) => {
    const pin = all.find((p) => p.sessionId === sessionId);
    if (!pin || (pin.pid === pid && pin.startedAt === startedAt)) return all;
    return all.map((p) => (p === pin ? { ...p, pid, startedAt } : p));
  });
}

// Moves a pin, in its place, to the session `/clear` carried its chat on
// under. If that session is pinned already, the old pin just goes.
export function carryPin(from: string, to: string): void {
  updatePins((all) => {
    if (!all.some((p) => p.sessionId === from)) return all;
    if (all.some((p) => p.sessionId === to)) {
      return all.filter((p) => p.sessionId !== from);
    }
    return all.map((p) =>
      p.sessionId === from ? { ...p, sessionId: to, clearedFrom: from } : p,
    );
  });
}

export function setPinned(
  sessionId: string,
  pinned: boolean,
  now = Date.now(),
): void {
  updatePins((all) => {
    const has = all.some((p) => p.sessionId === sessionId);
    if (pinned === has) return all;
    if (!pinned) return all.filter((p) => p.sessionId !== sessionId);
    return [
      ...all,
      {
        sessionId,
        pinnedAt: now,
        pid: null,
        startedAt: null,
        clearedFrom: null,
      },
    ];
  });
}

// Moves a pinned session to just before `before`, or to the end when
// `before` is null or not pinned.
export function movePin(sessionId: string, before: string | null): void {
  updatePins((all) => {
    const pin = all.find((p) => p.sessionId === sessionId);
    if (!pin) throw new Error("Not pinned");
    const rest = all.filter((p) => p !== pin);
    const at =
      before === null ? -1 : rest.findIndex((p) => p.sessionId === before);
    rest.splice(at === -1 ? rest.length : at, 0, pin);
    return rest;
  });
}

export interface QueuedRow {
  id: number;
  session_id: string;
  text: string;
  queued_at: number;
}

export function queueMessage(
  sessionId: string,
  text: string,
  now = Date.now(),
): void {
  openStore()
    .prepare(
      `INSERT INTO queued_messages (session_id, text, queued_at) VALUES (?, ?, ?)`,
    )
    .run(sessionId, text, now);
}

export function queuedFor(sessionIds: string[]): QueuedRow[] {
  if (sessionIds.length === 0) return [];
  const marks = sessionIds.map(() => "?").join(", ");
  return openStore()
    .prepare(
      `SELECT * FROM queued_messages WHERE session_id IN (${marks}) ORDER BY id`,
    )
    .all(...sessionIds) as unknown as QueuedRow[];
}

// Sessions with anything queued.
export function queuedSessions(): string[] {
  return (
    openStore()
      .prepare(`SELECT DISTINCT session_id FROM queued_messages`)
      .all() as unknown as { session_id: string }[]
  ).map((r) => r.session_id);
}

// Each of these names the session too, so a stale form can't reach another
// chat's queue. False when the message was already sent or removed.
export function editQueued(id: number, sessionId: string, text: string) {
  const { changes } = openStore()
    .prepare(
      `UPDATE queued_messages SET text = ? WHERE id = ? AND session_id = ?`,
    )
    .run(text, id, sessionId);
  return changes > 0;
}

export function takeQueued(id: number, sessionId: string): QueuedRow | null {
  return (
    (openStore()
      .prepare(
        `DELETE FROM queued_messages WHERE id = ? AND session_id = ? RETURNING *`,
      )
      .get(id, sessionId) as unknown as QueuedRow | undefined) ?? null
  );
}

// Put back a message whose send failed, in its old place.
export function restoreQueued(row: QueuedRow): void {
  openStore()
    .prepare(
      `INSERT OR IGNORE INTO queued_messages (id, session_id, text, queued_at)
       VALUES (?, ?, ?, ?)`,
    )
    .run(row.id, row.session_id, row.text, row.queued_at);
}
