// Helpers for checking cmux itself: throwaway workspaces, and waiting on
// what a terminal shows.

import { mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CmuxError, cmuxRpc } from "~/lib/cmux.server";

export interface Throwaway {
  workspaceId: string;
  surfaceId: string;
  cwd: string;
  title: string;
  // What the params name it by, for the calls that take a surface.
  target: { workspace_id: string; surface_id: string };
}

const created: string[] = [];

export const marker = (label: string) =>
  `${label}-${Math.random().toString(36).slice(2, 10)}`;

// A new workspace, unfocused, running `command`, or a plain shell without
// one. Closed by closeThrowaways.
export async function throwaway(command?: string): Promise<Throwaway> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), "seamux-contract-")));
  const title = marker("seamux-contract");
  const result = await cmuxRpc<{ workspace_id: string; surface_id: string }>(
    "workspace.create",
    {
      cwd,
      title,
      ...(command ? { initial_command: command } : {}),
      focus: false,
    },
  );
  created.push(result.workspace_id);
  return {
    workspaceId: result.workspace_id,
    surfaceId: result.surface_id,
    cwd,
    title,
    target: { workspace_id: result.workspace_id, surface_id: result.surface_id },
  };
}

export async function closeThrowaways() {
  for (const id of created.splice(0)) {
    await cmuxRpc("workspace.close", { workspace_id: id }).catch(
      (err: unknown) => {
        // Already gone: it closed itself when its command exited.
        if (!(err instanceof CmuxError && /not_found/.test(err.code))) throw err;
      },
    );
  }
}

export async function screen(t: Throwaway): Promise<string> {
  return (await cmuxRpc<{ text: string }>("surface.read_text", t.target)).text;
}

// Poll until `check` passes, or fail with the last thing it saw.
export async function eventually<T>(
  check: () => Promise<T | null | undefined | false>,
  what: string,
  timeoutMs = 10_000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

export async function shows(t: Throwaway, text: string, timeoutMs?: number) {
  return eventually(
    async () => (await screen(t)).includes(text),
    `"${text}" on screen`,
    timeoutMs,
  );
}

// The workspace as workspace.list reports it, or undefined.
export async function listedWorkspace(id: string) {
  const { workspaces } = await cmuxRpc<{
    workspaces: ({ id: string; title: string } & Record<string, unknown>)[];
  }>("workspace.list");
  return workspaces.find((w) => w.id === id);
}

export async function workspaceGone(id: string) {
  return eventually(async () => {
    const { workspaces } = await cmuxRpc<{ workspaces: { id: string }[] }>(
      "workspace.list",
    );
    return !workspaces.some((w) => w.id === id);
  }, `workspace ${id} to close`);
}
