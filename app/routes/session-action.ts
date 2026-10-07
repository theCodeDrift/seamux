import { data } from "react-router";

import type { Route } from "./+types/session-action";
import { MAX_ATTACHMENTS_BYTES } from "~/lib/attachments";
import { withAttachments } from "~/lib/attachments.server";
import { closable, hasPreviews, type Answer, type Question } from "~/lib/board";
import { closedSession, loadBoard, sessionInfo } from "~/lib/board.server";
import {
  answerApproval,
  answerDialog,
  answerQuestion,
  askToDelete,
  attach,
  cancelClose,
  closeSession,
  fork,
  interrupt,
  renameClosed,
  renameLive,
  resume,
  UnsentError,
} from "~/lib/drive.server";
import { assertFromBoard, SESSION_ID } from "~/lib/guard.server";
import { startQueue } from "~/lib/queue.server";
import { sendOrSignIn } from "~/lib/service.server";
import {
  editQueued,
  movePin,
  queueMessage,
  restoreQueued,
  setPinned,
  takeQueued,
} from "~/lib/store.server";

const INTENTS = new Set([
  "send",
  "interrupt",
  "resume",
  "attach",
  "delete",
  "fork",
  "close",
  "pin",
  "unpin",
  "pin-move",
  "rename",
  "answer",
  "approve",
  "deny",
  "choose",
  "queue",
  "queue-edit",
  "queue-send",
  "queue-drop",
]);
const MAX_MESSAGE = 100_000;

export interface ActionResult {
  ok: boolean;
  error: string | null;
  // The new session, for a fork.
  sessionId?: string;
}

// Answers from the board, checked against the questions actually open.
function parseAnswers(raw: string, questions: Question[]): Answer[] {
  let answers: unknown;
  try {
    answers = JSON.parse(raw);
  } catch {
    throw new Error("Bad answers");
  }
  if (!Array.isArray(answers) || answers.length !== questions.length) {
    throw new Error("Answer every question");
  }
  return questions.map((q, i) => {
    const a = answers[i];
    if (typeof a?.text === "string" && !q.multiSelect && !hasPreviews(q)) {
      const text = a.text.trim();
      if (!text) throw new Error("Answer every question");
      if (text.length > MAX_MESSAGE) throw new Error("Answer too long");
      return { text };
    }
    const picks = a?.picks;
    const valid =
      Array.isArray(picks) &&
      picks.length > 0 &&
      (q.multiSelect || picks.length === 1) &&
      new Set(picks).size === picks.length &&
      picks.every((p) => Number.isInteger(p) && p >= 0 && p < q.options.length);
    if (!valid) throw new Error("Answer every question");
    // One line: a line break would end the note early.
    const notes =
      typeof a.notes === "string" && hasPreviews(q)
        ? a.notes.replace(/\s+/g, " ").trim()
        : "";
    if (notes.length > MAX_MESSAGE) throw new Error("Note too long");
    return notes ? { picks, notes } : { picks };
  });
}

function messageText(form: FormData): string {
  const text = String(form.get("text") ?? "").trim();
  if (!text) throw new Error("Nothing to send");
  if (text.length > MAX_MESSAGE) throw new Error("Message too long");
  return text;
}

const MAX_NAME = 100;

// One line: it is typed after `/rename`, and a newline would submit early.
function sessionName(form: FormData): string {
  const name = String(form.get("name") ?? "").trim();
  if (!name) throw new Error("A name can't be empty");
  if (name.length > MAX_NAME) throw new Error("Name too long");
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new Error("One line only");
  return name;
}

function queuedId(form: FormData): number {
  const id = Number(form.get("id"));
  if (!Number.isInteger(id)) throw new Error("Bad queued message");
  return id;
}

async function perform(
  sessionId: string,
  intent: string,
  form: FormData,
): Promise<string | void> {
  if (intent === "send") {
    const text = await withAttachments(sessionId, messageText(form), form);
    await sendOrSignIn(sessionId, text);
  } else if (intent === "queue") {
    // Written now, so the queue holds the paths, not the files.
    queueMessage(
      sessionId,
      await withAttachments(sessionId, messageText(form), form),
    );
    startQueue();
  } else if (intent === "queue-edit") {
    if (!editQueued(queuedId(form), sessionId, messageText(form))) {
      throw new Error("Already sent");
    }
  } else if (intent === "queue-send") {
    // Into Claude Code now, which takes it at its next step.
    const row = takeQueued(queuedId(form), sessionId);
    if (!row) throw new Error("Already sent");
    try {
      await sendOrSignIn(sessionId, row.text);
    } catch (err) {
      // Typed but not sent: queued again, it would be typed a second time.
      if (!(err instanceof UnsentError)) restoreQueued(row);
      throw err;
    }
  } else if (intent === "queue-drop") {
    takeQueued(queuedId(form), sessionId);
  } else if (intent === "close") {
    // Only a chat at rest: closing a working one would cut its turn off.
    const { cards } = await loadBoard();
    const card = cards.find((c) => c.sessionId === sessionId);
    if (!card || !closable(card)) {
      throw new Error("Only idle chats can be closed");
    }
    await closeSession(card, cards, async () =>
      (await loadBoard()).cards.find((c) => c.sessionId === sessionId),
    );
  } else if (intent === "answer") {
    // Only the question still open: keys sent after it closed would land
    // in the prompt box instead.
    const card = (await loadBoard()).cards.find(
      (c) => c.sessionId === sessionId,
    );
    const ask = card?.waiting?.ask;
    if (!ask || ask.toolUseId !== form.get("toolUseId")) {
      throw new Error("That question is no longer open");
    }
    const answers = parseAnswers(
      String(form.get("answers") ?? ""),
      ask.questions,
    );
    await answerQuestion(sessionId, ask.questions, answers);
  } else if (intent === "approve" || intent === "deny") {
    // Only the prompt still open, for the same reason as an answer.
    const card = (await loadBoard()).cards.find(
      (c) => c.sessionId === sessionId,
    );
    const approval = card?.waiting?.approval;
    if (!card || !approval || approval.toolUseId !== form.get("toolUseId")) {
      throw new Error("That approval is no longer open");
    }
    await answerApproval(sessionId, intent === "approve", card.engine);
  } else if (intent === "choose") {
    // answerDialog reads the screen again, so only the dialog still open
    // gets the key.
    await answerDialog(
      sessionId,
      String(form.get("dialog") ?? ""),
      Number(form.get("option")),
    );
  } else if (intent === "interrupt") {
    cancelClose(sessionId);
    await interrupt(sessionId);
  } else if (intent === "resume") {
    const closed = await closedSession(sessionId);
    if (!closed)
      throw new Error("This chat is still live, or has no transcript");
    await resume(sessionId, closed.cwd, closed.name, closed.engine);
  } else if (intent === "attach") {
    // Only a background session the board lists on its own; one with a
    // parent chat belongs to that chat.
    const orphan = (await loadBoard()).orphans.find(
      (o) => o.sessionId === sessionId,
    );
    if (!orphan) throw new Error("No longer a background session on its own");
    await attach(sessionId, orphan.id, orphan.cwd, orphan.name);
  } else if (intent === "delete") {
    const orphan = (await loadBoard()).orphans.find(
      (o) => o.sessionId === sessionId,
    );
    if (!orphan) throw new Error("No longer a background session on its own");
    await askToDelete(orphan);
  } else if (intent === "fork") {
    const info = await sessionInfo(sessionId);
    if (!info) throw new Error("No transcript to fork from");
    return fork(
      sessionId,
      info.cwd,
      String(form.get("text") ?? ""),
      info.engine,
    );
  } else if (intent === "pin" || intent === "unpin") {
    setPinned(sessionId, intent === "pin");
  } else if (intent === "rename") {
    const name = sessionName(form);
    const closed = await closedSession(sessionId);
    if (closed) {
      await renameClosed(sessionId, closed.transcript, name, closed.engine);
    } else {
      // A live chat renames itself, which takes effect even mid-turn. Not
      // while a dialog is open: the keys would land in it.
      const card = (await loadBoard()).cards.find(
        (c) => c.sessionId === sessionId,
      );
      if (!card) throw new Error("No longer on the board");
      if (card.waiting) throw new Error("Answer what it is waiting on first");
      await renameLive(sessionId, name);
    }
  } else if (intent === "pin-move") {
    const before = String(form.get("before") ?? "");
    if (before && !SESSION_ID.test(before)) throw new Error("Bad session id");
    movePin(sessionId, before || null);
  }
}

export async function action({
  request,
  params,
}: Route.ActionArgs): Promise<ActionResult> {
  assertFromBoard(request);
  if (!SESSION_ID.test(params.sessionId)) {
    throw data("Bad session id", { status: 400 });
  }
  // Room for the most a message's attachments may add up to, and its text.
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_ATTACHMENTS_BYTES + (1 << 20)) {
    throw data("Too large", { status: 413 });
  }
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  if (!INTENTS.has(intent)) throw data("Unknown intent", { status: 400 });

  try {
    const created = await perform(params.sessionId, intent, form);
    return {
      ok: true,
      error: null,
      ...(created ? { sessionId: created } : {}),
    };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
