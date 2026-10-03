# Session state

Whether a Claude Code chat is working, waiting on someone, idle or gone. seamux derives it on every poll from three sources, none of which is right on its own: `claude agents --json --all`, cmux, and the chat's [transcript](transcripts.md). This page is about where they disagree. Codex has no `claude agents`, and [its own rules](codex.md#cmuxs-lifecycle-is-unreliable-for-codex).

## `status: busy` does not mean a turn is running

Claude Code also sets `busy` while internal helper agents run between turns, and while a background shell runs after the turn has ended. The board treats a session as working only when the transcript's last message agrees: a turn is over once the last message is an assistant message with `stop_reason: end_turn`, an interruption, or a harness-written turn such as `/compact`.

- **Measured:** not recorded.
- **In seamux:** `turnActive` and `turnRunning` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [Helper agents fire `SubagentStop` with an empty `agent_type`](subagents.md#helper-agents-fire-subagentstop-with-an-empty-agent_type-and-never-fire-subagentstart), [A `!` command moves to the background after 120 seconds](transcripts.md#a--command-moves-to-the-background-after-120-seconds-and-its-output-leaves-the-transcript), [OpenCode's server says whether a session is busy](opencode.md#opencodes-server-says-whether-a-session-is-busy), whose `busy` covers a waiting permission prompt too.

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
- **See also:** [A chat moved to the background keeps its old transcript apart](background-sessions.md#a-chat-moved-to-the-background-keeps-its-old-transcript-apart), another way one chat ends up under two ids.
