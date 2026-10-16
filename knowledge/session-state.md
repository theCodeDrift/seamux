# Session state

Whether a Claude Code chat is working, waiting on someone, idle or gone. seamux derives it on every poll from three sources, none of which is right on its own: `claude agents --json --all`, cmux, and the chat's [transcript](transcripts.md). This page is about where they disagree. Codex has no `claude agents`, and [its own rules](codex.md#cmuxs-lifecycle-is-unreliable-for-codex).

## `status: busy` does not mean a turn is running

Claude Code also sets `busy` while internal helper agents run between turns, and while a background shell runs after the turn has ended. The board treats a session as working only when the transcript's last message agrees: a turn is over once the last message is an assistant message with `stop_reason: end_turn`, an interruption, or a harness-written turn such as `/compact`.

- **Measured:** not recorded.
- **In seamux:** `turnActive` and `turnRunning` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [Helper agents fire `SubagentStop` with an empty `agent_type`](subagents.md#helper-agents-fire-subagentstop-with-an-empty-agent_type-and-never-fire-subagentstart), [A `!` command moves to the background after 120 seconds](transcripts.md#a--command-moves-to-the-background-after-120-seconds-and-its-output-leaves-the-transcript), [OpenCode's server says whether a session is busy](opencode.md#opencodes-server-says-whether-a-session-is-busy), whose `busy` covers a waiting permission prompt too.

## A task notification after its hand-back does not wake the model

A subagent that finishes reaches the model first as an `<agent-message from="<task id>">` hand-back, a user turn the model answers. Since 2.1.285 the `<task-notification>` for the same run is logged after that answer, as a user message with `origin.kind: "task-notification"`, and nothing answers it, so it is the last message in the transcript until the next prompt. A notification with no hand-back before it still wakes the model. Across this Mac's transcripts, all 111 such notifications up to 2.1.283 woke it, and 19 of 22 from 2.1.285 to 2.1.289 did not. With a background shell running, `claude agents` stays `busy` the whole time, so taking the notification for a pending turn left a chat in Working for as long as the shell ran.

- **Measured:** Claude Code 2.1.272 to 2.1.289.
- **In seamux:** `notificationHandedBack` in [board.server.ts](../app/lib/board.server.ts) passes over it when settling the turn.
- **See also:** [`status: busy` does not mean a turn is running](#status-busy-does-not-mean-a-turn-is-running).

## Idle and waiting are separate `status` values

`claude agents` reports `status: waiting` while a dialog is open, with `waitingFor` set to `input needed` for AskUserQuestion or `permission prompt` for an approval. The board once assumed only `idle` and `busy`, and so used to depend on cmux for WAITING and missed sessions outside it.

- **Measured:** not recorded.
- **In seamux:** `waitingOn` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [Other dialogs are `waitingFor: "dialog open"`](dialogs.md#other-dialogs-are-waitingfor-dialog-open-and-a-digit-picks-and-confirms), [cmux's `any_agent_needs_input` goes stale](#cmuxs-any_agent_needs_input-goes-stale).

## cmux's `any_agent_needs_input` goes stale

It stayed `true` on a session that `claude agents` reported `busy` and whose screen showed a running command, with no dialog open. The board no longer reads it.

- **Measured:** not recorded.
- **See also:** [Idle and waiting are separate `status` values](#idle-and-waiting-are-separate-status-values), [cmux's lifecycle is unreliable for Codex](codex.md#cmuxs-lifecycle-is-unreliable-for-codex).

## A resumed chat is invisible for a few seconds

Until the new workspace starts Claude, nothing reports the session as live, so a second resume in that window started a second process on the same conversation. The server now claims a session before its first check and holds the claim for 60 seconds.

- **Measured:** not recorded.
- **In seamux:** `RESUME_GUARD_MS` and `resume` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [Launching](launching.md), [cmux knows a Codex session only after its first prompt](codex.md#cmux-knows-a-codex-session-only-after-its-first-prompt).

## `/clear` keeps the process and changes the session id

`claude agents` then lists the same `pid` and `startedAt` under a new `sessionId`, and the old id drops out as if the chat had closed. The new transcript opens with a `SessionStart:clear` hook, and some of its entries still carry the old id in `session_id`, but nothing documents that, so the board links the two by process. cmux's session record keeps the launch's original `--session-id` in its stored arguments however many times the chat is cleared.

- **Measured:** Claude Code 2.1.283.
- **In seamux:** `processKey` in [board.server.ts](../app/lib/board.server.ts), and `notePinProcess` and `carryPin` in [store.server.ts](../app/lib/store.server.ts), which keep a pin on the chat across the change.
- **See also:** [A chat moved to the background keeps its old transcript apart](background-sessions.md#a-chat-moved-to-the-background-keeps-its-old-transcript-apart), another way one chat ends up under two ids, and [cmux files a cleared chat's new id after `claude agents` does](#cmux-files-a-cleared-chats-new-id-after-claude-agents-does).

## cmux files a cleared chat's new id after `claude agents` does

After `/clear`, `claude agents` lists the new id about 100 ms before `cmux sessions list` does. For that moment cmux still has the old id, with the same `pid`, and then for another 100 ms or so it can list no record for the chat at all, before the new id appears under the same surface. A board refresh that landed in the gap showed the chat's card as idle, from its new, empty transcript, and "Not in a cmux surface", until the next refresh. Polling both several times a second over three clears missed the chat twice. So seamux finds a chat cmux doesn't list under its id by its process: the live record with the same pid, or the one last seen with it in the past five seconds. With that, six clears missed it never.

- **Measured:** cmux 0.64.23, Claude Code 2.1.301, in a throwaway workspace; a plain prompt, `/compact` and `/branch` kept cmux and `claude agents` in step.
- **In seamux:** `listLive` and `REFILE_GRACE_MS` in [drive.server.ts](../app/lib/drive.server.ts), which the board passes its `claude agents` rows; `runningClaudeSessions` in [harness.server.ts](../app/lib/harness.server.ts), for a caller without the pid; the `pid` check in [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).

## A message sent straight after `/clear` reaches the cleared chat

`/clear` and Enter, then a message and Enter at once, with no pause between: the message went into the new transcript, after its `SessionStart:clear` hook, and the old one never saw it. Whatever the chat was told at its start goes with the clear, so seamux sends it again.

- **Measured:** Claude Code 2.1.295, in a throwaway workspace.
- **In seamux:** `clear` in [macros.server.ts](../app/lib/macros.server.ts), which pauses `CLEAR_GAP_MS`, three seconds, anyway, and `sendMessage` in [drive.server.ts](../app/lib/drive.server.ts), which sends Session information after a clear from the board.
