// When a queued message goes (app/lib/queue.server.ts): once the chat's turn
// is over and its prompt box is free.

import { expect, it } from "vitest";

import { ASKED_IN_REPLY, type Card, type Waiting } from "~/lib/board";
import { ready } from "~/lib/queue.server";

function card(
  column: Card["column"],
  waiting: Waiting | null = null,
  turnRunning = column === "working",
): Card {
  return {
    sessionId: "3f0e8c1a-5b2d-4c3e-9f41-2a7d6b8e0c15",
    column,
    turnRunning,
    drivable: true,
    closing: null,
    waiting,
    lastActivityAt: null,
    background: [],
  } as unknown as Card;
}

function waitingOn(reason: string, tool: string | null = null): Waiting {
  return { reason, tool, detail: null, ask: null, approval: null, dialog: null };
}

it("sends into an idle chat", () => {
  expect(ready(card("idle"), Date.now())).toBe(true);
});

it("sends into a chat whose reply ended on a question", () => {
  const asked = card("waiting", waitingOn(ASKED_IN_REPLY));
  expect(ready(asked, Date.now())).toBe(true);
});

it("holds while a dialog is open or the chat works", () => {
  const now = Date.now();
  expect(ready(card("waiting", waitingOn("permission prompt", "Bash")), now)).toBe(false);
  expect(ready(card("waiting", waitingOn("input needed", "AskUserQuestion")), now)).toBe(false);
  expect(ready(card("working"), now)).toBe(false);
});

it("sends into a chat whose own turn ended while its subagents run", () => {
  expect(ready(card("working", null, false), Date.now())).toBe(true);
});
