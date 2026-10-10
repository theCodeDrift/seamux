// The store (app/lib/store.server.ts): config kept for good, every other
// table remade when SCHEMA_VERSION moves, and pins carried out of the table
// they had before they moved into config.

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { beforeAll, expect, it } from "vitest";

// A store as an older seamux left it, made before the module opens it.
const dbPath = join(process.env.SEAMUX_HOME!, "data/seamux.db");
mkdirSync(join(process.env.SEAMUX_HOME!, "data"), { recursive: true });
const legacy = new DatabaseSync(dbPath);
legacy.exec(`
  CREATE TABLE config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO config VALUES ('worktreeByDefault', 'true');
  CREATE TABLE pins (
    session_id TEXT PRIMARY KEY, pinned_at INTEGER NOT NULL,
    position INTEGER NOT NULL DEFAULT 0, pid INTEGER, started_at INTEGER,
    cleared_from TEXT
  );
  INSERT INTO pins VALUES ('b', 1, 0, 42, 100, 'a'), ('c', 2, 1, NULL, NULL, NULL);
  CREATE TABLE queued_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
    text TEXT NOT NULL, queued_at INTEGER NOT NULL, old_column TEXT
  );
  INSERT INTO queued_messages (session_id, text, queued_at) VALUES ('b', 'hi', 1);
`);
legacy.close();

let store: typeof import("~/lib/store.server");
let config: typeof import("~/lib/config.server");

beforeAll(async () => {
  store = await import("~/lib/store.server");
  config = await import("~/lib/config.server");
});

it("keeps the config and carries the pins over, in order", () => {
  expect(config.readConfig().worktreeByDefault).toBe(true);
  expect(store.pins()).toEqual([
    { sessionId: "b", pinnedAt: 1, pid: 42, startedAt: 100, clearedFrom: "a" },
    {
      sessionId: "c",
      pinnedAt: 2,
      pid: null,
      startedAt: null,
      clearedFrom: null,
    },
  ]);
});

it("remakes every other table at the current schema", () => {
  const db = store.openStore();
  expect(store.queuedFor(["b"])).toEqual([]);
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all()
    .map((t) => t.name);
  expect(tables).not.toContain("pins");
  expect(db.prepare(`PRAGMA user_version`).get()).toEqual({
    user_version: store.SCHEMA_VERSION,
  });
});

it("pins, moves, carries and unpins", () => {
  store.setPinned("d", true, 3);
  store.movePin("d", "b");
  expect(store.pinnedSessions()).toEqual(["d", "b", "c"]);
  store.notePinProcess("c", 7, 200);
  store.carryPin("c", "e");
  expect(store.pins().at(-1)).toEqual({
    sessionId: "e",
    pinnedAt: 2,
    pid: 7,
    startedAt: 200,
    clearedFrom: "c",
  });
  // Carried onto a chat already pinned, the old pin just goes.
  store.carryPin("d", "b");
  store.setPinned("e", false);
  expect(store.pinnedSessions()).toEqual(["b"]);
});

it("keeps project colours, and takes a browser's only where none is set", () => {
  config.setProjectColor("/r/one", 3);
  config.importProjectColors({
    "/r/one": 5,
    "/r/two": "oklch(0.71 0.21 48)",
    "/r/three": 99,
  });
  expect(config.readConfig().projectColors).toEqual({
    "/r/one": 3,
    "/r/two": 2,
  });
  config.setProjectColor("/r/one", null);
  expect(config.readConfig().projectColors).toEqual({ "/r/two": 2 });
  expect(() => config.setProjectColor("/r/one", 13)).toThrow();
});
