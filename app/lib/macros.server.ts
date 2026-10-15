// The board's built-in macros: every key sequence it types into a chat, each
// made of a Session's primitives (harness.server.ts), so each works the same
// way on every harness that supplies them.

import { hasPreviews, type Answer, type Question } from "./board.ts";
import { MUST_PASTE, pause, type Session } from "./harness.server.ts";

// Long enough for a dialog to redraw between keys.
export const KEY_GAP_MS = 400;

// A message, sent: the box emptied, the message written, and Enter until it
// goes.
export async function send(s: Session, text: string) {
  await s.clearInput();
  await s.write(text);
  await s.submit(text);
}

// A message left unsent in the prompt box, sent as it stands, or emptied
// from it for the board to edit. Either only while the box still holds
// `text`, the draft the board showed: it may have been sent or changed in
// the terminal since.
export async function sendDraft(s: Session, text: string) {
  await holding(s, text);
  await s.submit(text);
}

export async function takeDraft(s: Session, text: string) {
  await holding(s, text);
  await s.clearInput();
}

async function holding(s: Session, text: string) {
  if (!s.harness.unsent?.(await s.screen(), text)) {
    throw new Error("The chat's prompt box no longer holds that message");
  }
}

// Long enough for a chat to start afresh after /clear. A message sent at
// once went to the cleared chat too, so this is generous margin: the chat is
// held for the macro meanwhile, so nothing else is typed into it.
export const CLEAR_GAP_MS = 3000;

// Clears the chat, then sends what it should know from the start, which
// the clear dropped.
export async function clear(s: Session, line: string, context: string) {
  await send(s, line);
  if (!context) return;
  await pause(CLEAR_GAP_MS);
  await send(s, context);
}

// Picks a turn back up where something outside the chat cut it short, an
// expired login or a failed request: one line telling the model to carry on.
export async function resume(s: Session) {
  await send(s, "continue");
}

// A slash command, such as /exit or /rename. Pasted, since typing it would
// open the slash menu, whose Enter picks whatever it has highlighted.
export async function command(s: Session, line: string) {
  await s.clearInput();
  await s.paste(line);
  await s.press("enter");
}

// Ends the session, keeping its conversation. Claude Code and Codex both
// take it.
export async function exit(s: Session) {
  await command(s, "/exit");
}

// Renames the chat and its tab, which takes effect even mid-turn.
export async function rename(s: Session, name: string) {
  await command(s, `/rename ${name}`);
}

// Esc: stops the current turn, keeps the session and its history.
export async function interrupt(s: Session) {
  await s.press("escape");
}

// A permission prompt. "No" moves with the options offered, so a denial is
// Esc, which refuses the call and ends the turn for the user to reply to.
export async function approve(s: Session) {
  await s.keys(s.harness.approveKey);
}

export async function deny(s: Session) {
  await s.press("escape");
}

// A dialog's option, counted from 0. In a numbered dialog its digit picks
// and confirms in one go. A dialog with no numbers ignores digits, so the
// cursor, at `cursor`, walks to the option and Enter picks it.
export async function pick(s: Session, option: number, cursor: number | null) {
  if (cursor === null) {
    await s.keys(String(option + 1));
    return;
  }
  const arrow = option > cursor ? "down" : "up";
  for (let n = Math.abs(option - cursor); n > 0; n--) {
    await s.press(arrow);
    await pause(KEY_GAP_MS);
  }
  await s.press("enter");
}

// Answer an open AskUserQuestion by driving its dialog, so the model gets a
// real answer rather than an interrupted turn. Measured against Claude Code
// 2.1.281 and 2.1.282:
// - a digit picks an option on a single-select question and moves on,
//   submitting outright when there is only one question;
// - on a multi-select question digits toggle, and Tab moves on;
// - the row after the last option is "Type something". On a single-select
//   question its digit puts the cursor in it; on a multi-select one the
//   digit only ticks it, so the cursor walks down to it instead. Pasted text
//   there is taken as the answer and moves on. Typed text, which Claude Code
//   shows in full rather than folded, needs an Enter, or on a multi-select
//   question a Tab down to "Next" and an Enter;
// - a question whose options have previews shows each beside the list, has
//   no "Type something" row, and a digit there only moves the cursor, so an
//   Enter picks. Before it, n opens a note on the option under the cursor,
//   and typed text fills it; the Enter then picks with the note;
// - with several questions, or any multi-select one, a review screen comes
//   last, and 1 submits it.
export async function answerQuestion(
  s: Session,
  questions: Question[],
  answers: Answer[],
) {
  const key = async (k: string) => {
    await s.press(k);
    await pause(KEY_GAP_MS);
  };
  const digit = async (n: number) => {
    await s.keys(String(n));
    await pause(KEY_GAP_MS);
  };
  for (const [i, q] of questions.entries()) {
    const a = answers[i];
    if ("text" in a) {
      if (q.multiSelect)
        for (let n = 0; n < q.options.length; n++) await key("down");
      else await digit(q.options.length + 1);
      const paste = MUST_PASTE.test(a.text);
      if (paste) await s.paste(a.text);
      else await s.type(a.text);
      await pause(KEY_GAP_MS);
      if (!paste) {
        if (q.multiSelect) await key("tab");
        await key("enter");
      }
    } else if (hasPreviews(q)) {
      await digit(a.picks[0] + 1);
      if (a.notes) {
        await s.keys("n");
        await pause(KEY_GAP_MS);
        await s.type(a.notes);
        await pause(KEY_GAP_MS);
      }
      await key("enter");
    } else if (q.multiSelect) {
      for (const p of a.picks) await digit(p + 1);
      await key("tab");
    } else {
      await digit(a.picks[0] + 1);
    }
  }
  if (questions.length > 1 || questions.some((q) => q.multiSelect))
    await digit(1);
}

const TRUST_WAIT_MS = 30_000;

// Both harnesses stop on a new folder to ask whether the user trusts it,
// before the session exists anywhere the board could see it. Choosing the
// folder to dispatch into is that decision, so the answer is yes.
export async function acceptTrust(s: Session) {
  const { trust, ready } = s.harness;
  const deadline = Date.now() + TRUST_WAIT_MS;
  while (Date.now() < deadline) {
    await pause(1000);
    const screen = await s.screen();
    if (screen.includes(trust.prompt)) {
      for (const [i, key] of trust.keys.entries()) {
        if (i > 0) await pause(KEY_GAP_MS);
        await s.press(key);
      }
      return;
    }
    if (ready.test(screen)) return;
  }
}
