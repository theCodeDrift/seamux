# Transcripts

Claude Code writes each chat to a `.jsonl` transcript under `~/.claude/projects/`, one JSON object per line, as each message completes. seamux reads them on every poll for what nothing else reports: whether a turn is over, what's queued, how full the context is, and what a `!` command printed. Codex transcripts are a different format, covered in [Codex](codex.md#the-record-names-the-transcript).

Entries about transcripts that live in other domains:

- [`status: busy` does not mean a turn is running](session-state.md#status-busy-does-not-mean-a-turn-is-running): the transcript's last message decides whether a turn is over.
- [`/clear` keeps the process and changes the session id](session-state.md#clear-keeps-the-process-and-changes-the-session-id): a new transcript for the same process.
- [Claude Code records subagents on disk](subagents.md#claude-code-records-subagents-on-disk), next to the parent's transcript.
- [A long paste folds into a placeholder](prompt-box.md#a-long-paste-folds-into-a-placeholder-even-on-one-line-and-the-model-gets-it-as-pasted-content): the transcript wraps it in `<pasted_content>`.
- [An expired login is in the transcript](signing-in.md#an-expired-login-is-in-the-transcript), as are API errors.
- [`/rename` works mid-turn](names.md#rename-works-mid-turn-and-a-closed-chat-can-be-renamed-through-its-transcript): two lines appended to a transcript rename a closed chat.

## The transcript logs the input queue, but a dequeue is not first in, first out

Each change is a `queue-operation` line: `enqueue` with the item's text, `dequeue`, `remove` with the text it drops, and `popAll`. A `dequeue` takes a typed prompt ahead of queued `<task-notification>` and `<agent-message>` hand-backs, which is how replaying the log leaves no typed prompt queued in any closed transcript. The board replays it to count and list what is queued in the terminal.

- **Measured:** not recorded.
- **In seamux:** `queuedPrompts` in [board.server.ts](../app/lib/board.server.ts). The board's own queue, for messages waiting on an idle chat, is separate: [queue.server.ts](../app/lib/queue.server.ts).

## A prompt taken mid-turn is an attachment, not a user message

A prompt typed while a turn runs is taken at the turn's next step and logged once, as a line with `type: "attachment"` and `attachment: { type: "queued_command", prompt, commandMode: "prompt", origin: { kind: "human" } }`, after the queue's `remove`. No `user` line ever carries it, so a reader of `user` lines alone misses it. `prompt` is a string, or content blocks when it holds an image. Subagent hand-backs arrive the same way with `origin.kind` `peer`, and task notifications with `commandMode` `task-notification`.

- **Measured:** Claude Code 2.1.246 to 2.1.295, across this Mac's transcripts.
- **In seamux:** `midTurnPrompt` in [board.server.ts](../app/lib/board.server.ts), for the chat log and the card's last prompt. A queued message sent now from the board arrives this way.
- **See also:** [Codex logs a prompt sent mid-turn like any other](codex.md#a-prompt-sent-mid-turn-waits-for-the-next-tool-call-and-is-logged-like-any-other).

## Transcripts do not record the context window

Each response logs its token usage, but a 1M-token Opus session is logged as plain `claude-opus-5`, the same as a 200k one; only `/context` output names `[1m]`. Opus sessions here have run to 999k, so the context bar assumes 1M for Opus and 200k for anything else, raising it to 1M once a response holds more than 200k.

- **Measured:** not recorded.
- **In seamux:** `WINDOW`, `LARGE_WINDOW` and `contextUsage` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** Codex does record it, as `model_context_window`: [The record names the transcript](codex.md#the-record-names-the-transcript).

## A `!` command moves to the background after 120 seconds, and its output leaves the transcript

The transcript logs the command as a user turn `<bash-input>…</bash-input>` and, once it returns, `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr>`. Nothing is written while it runs, and the terminal is the only place its live output shows. One still running at 120 seconds is moved to the background, and its `<bash-stdout>` then says only that the output is being written to `…/tasks/<id>.output`; what it printed, such as a login's URL and code, is in that file, which keeps growing until the command exits.

- **Measured:** Claude Code 2.1.283.
- **In seamux:** `BACKGROUNDED` and `shellOutput` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [A prompt box in shell mode runs what it holds as shell commands](prompt-box.md#a-prompt-box-in-shell-mode-runs-what-it-holds-as-shell-commands), [`claude auth login` needs no terminal](signing-in.md#claude-auth-login-needs-no-terminal).

## A prompt command is logged as tags, its name before or after by kind

A slash command that prompts the model, such as a skill or `/opsx:apply`, is a user turn `<command-message>name</command-message>\n<command-name>/name</command-name>`, with `\n<command-args>…</command-args>` when anything followed the name, and its expansion comes next as an `isMeta` message. A local command, such as `/rename`, `/compact` or `/model`, opens with `<command-name>` instead, followed by `<local-command-stdout>` turns. Which tag comes first is the only thing that tells the two apart. The chat log shows a prompt command as `/name args`, as it was typed, and leaves local commands out. Whatever was sent after the command's name lands in `<command-args>`, so a dispatched prompt that starts with a slash command carries How to worktree there, and the board matches macros against `/name args` as it does any other prompt.

- **Measured:** Claude Code 2.1.295, across every transcript on this Mac.
- **In seamux:** `promptCommand` in [board.server.ts](../app/lib/board.server.ts).

## Tool output fills most of a transcript, and its last 2 MB can hold only a few messages

Claude Code logs each tool's whole result in the transcript, along with attachments and file-history snapshots, so the conversation is a small part of it. In the largest transcript on this Mac, 132 MB, tool results were 57 MB, attachments 24 MB, tool calls 14 MB, and the replies' text 4 MB. 108 of its 473 transcripts were over 2 MB, and the last 2 MB of one 25.6 MB transcript held 3 of its 103 messages, which was all the chat showed when it read only that much. Reading a 132 MB transcript whole and parsing every line took about half a second, so the chat reads each transcript in full once and then only what was appended since.

- **Measured:** Claude Code up to 2.1.301, across this Mac's transcripts from 2026-09-16 to 2026-10-15.
- **In seamux:** `follow` in [transcript.server.ts](../app/lib/transcript.server.ts), and `loadClaudeMessages` in [board.server.ts](../app/lib/board.server.ts), which keeps a tool call to its name. A card's own state still reads the tail, with `readTail`.
