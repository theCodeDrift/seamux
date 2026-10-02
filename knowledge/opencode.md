# OpenCode

OpenCode is not yet a harness seamux drives. This page is its findings, measured before its engine is written, as [CONTRIBUTING.md](../CONTRIBUTING.md) asks. Much of it looks like [Codex](codex.md): cmux learns of a session late, its lifecycle can't be trusted, and the conversation itself is the signal. Unlike Codex, the conversation is in a SQLite database rather than a transcript file, and nothing in cmux points at it. Measured against OpenCode 1.18.33 and 1.18.34 under cmux 0.64.25, launched as plain `opencode` through `zsh -ic` with no wrapper, and with cmux's OpenCode plugins installed (`cmux hooks opencode install`), unless an entry says otherwise.

cmux's integration is two plugins in `~/.config/opencode/plugins/`. `cmux-session.js` reports OpenCode's `session.created` and `session.updated` to cmux as `session-start`, its `session.idle` and an idle `session.status` as `stop`, and an archived or deleted session as `session-end`. `cmux-feed.js` sends `permission.asked` and `question.asked` to cmux's Feed with `feed.push`, and answers them through OpenCode's own API when the user decides there. OpenCode's [plugin docs](https://opencode.ai/docs/plugins/) list the `session.*` and `permission.asked` events, but not `question.asked`.

OpenCode's own documentation, for reference: [CLI](https://opencode.ai/docs/cli/), [config](https://opencode.ai/docs/config/), [keybinds](https://opencode.ai/docs/keybinds/), [permissions](https://opencode.ai/docs/permissions/), [plugins](https://opencode.ai/docs/plugins/), [SDK](https://opencode.ai/docs/sdk/) and [troubleshooting](https://opencode.ai/docs/troubleshooting/). Where an entry below disagrees with them, the entry is what OpenCode did.

## cmux registers an OpenCode session launched without a wrapper

OpenCode has no cmux wrapper. Launched directly, the plugin registers it all the same: after the first prompt, `cmux sessions list` had a row with `agent: "opencode"`, the `session_id` (`ses_…`), `surface_id`, `pid`, `cwd`, `launch_backed: true` and `launch_arguments` naming the `opencode` binary. The record is in `~/.cmuxterm/opencode-hook-sessions.json`.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [That login shell does not read `~/.zshrc`](launching.md#that-login-shell-does-not-read-zshrc), where `claude` launched without its wrapper is never registered.

## cmux knows an OpenCode session only after its first prompt

Before the first prompt there is no session row and no `opencode-hook-sessions.json` at all. The record appeared when the first prompt was sent.

- **Measured:** OpenCode 1.18.33, cmux 0.64.25.
- **See also:** [cmux knows a Codex session only after its first prompt](codex.md#cmux-knows-a-codex-session-only-after-its-first-prompt).

## `active_for_surface` stays `false` for a live OpenCode session

`active_for_surface` and `active_for_workspace` were `false`, and `active_surface_session_id` was `null`, while OpenCode ran in that surface. `surface_id` with `stored_pid_exists: true` finds it. `stored_pid_exists` was only ever `true` or `false` for OpenCode, never the `null` cmux can give a live Claude Code session, and OpenCode has no `claude agents` to ask if it were.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [`active_for_surface` stays `false` for a live Codex session](codex.md#active_for_surface-stays-false-for-a-live-codex-session), [`cmux sessions list` can lose a live Claude session's pid](cmux.md#cmux-sessions-list-can-lose-a-live-claude-sessions-pid).

## cmux has no transcript for OpenCode, whose sessions live in SQLite

cmux reports `transcript_path: null` and `transcript_backed: false`. OpenCode keeps every session in `~/.local/share/opencode/opencode.db`: the `session` table has `id`, `directory`, `title`, `agent` and `model`, `message` holds one row per message with its JSON in `data` (`role`, `time.created`, `time.completed`, `finish`, `error`), and `part` holds each message's pieces (`text`, `reasoning`, `tool`, `step-start`, `step-finish`). A new session's title is `New session - <ISO time>`. OpenCode renamed one after its first finished reply (to `Pong`, for a prompt asking for "pong"), and a session whose turns never finished kept the default. [Troubleshooting](https://opencode.ai/docs/troubleshooting/) says session and message data is in `project/` under `~/.local/share/opencode/`, but there was no `project/` there, only the database. The [CLI docs](https://opencode.ai/docs/cli/) say `opencode export <id>` prints a session as JSON.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [The record names the transcript](codex.md#the-record-names-the-transcript), for Codex.

## cmux's lifecycle is unreliable for OpenCode

`agent_lifecycle` was `unknown` while a turn ran, and stayed `unknown` after a turn finished normally: the record didn't change for 47 seconds after the reply. It went `idle` only after a turn was interrupted. It never reported that a permission prompt was waiting. `cmux-session.js` has no event for a turn starting or for needing input, so cmux can't say either. It does map `session.idle` to `stop`, and why no `stop` arrived after a normal finish is unmeasured.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [cmux's lifecycle is unreliable for Codex](codex.md#cmuxs-lifecycle-is-unreliable-for-codex).

## A turn is over when its assistant message has `time.completed`

A finished reply's `message` row has `time.completed` and `finish: "stop"`, and its last `part` is a `step-finish` with `reason: "stop"`. An interrupted one has `time.completed`, `finish: null` and `error.name: "MessageAbortedError"`. While a turn runs, its assistant message has no `time.completed`. On 1.18.33, interrupting a request that was stuck retrying left `time.completed` with neither `finish` nor `error`, so `time.completed` is the signal that the turn is over, and `finish` or `error` only says how.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.

## A new folder asks nothing

OpenCode opened straight to its prompt box ("Ask anything…") in a folder it had never seen, with no trust or setup dialog.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [A new folder stops on a trust dialog that nothing reports](launching.md#a-new-folder-stops-on-a-trust-dialog-that-nothing-reports), for Claude Code and Codex.

## A permission prompt is a running tool call, and Enter allows it once

Asked to read `/etc/hosts`, OpenCode stopped on "△ Permission required", "Access external directory /etc", with "Allow once", "Allow always" and "Reject", and "⇆ select" and "enter confirm" below. Enter chose "Allow once": the tool completed, and no rule was saved to the `permission` table. While the prompt was open, the tool's `part` had `state.status: "running"` and its message had no `time.completed`, the same as a tool that is running, so only the screen, or cmux's Feed, shows that it's waiting. What the Feed shows for it, and what `question.asked` looks like, are unmeasured. The [permissions docs](https://opencode.ai/docs/permissions/) say `external_directory` defaults to `ask`, and that "always" lasts for the rest of the session.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [An open approval is a tool call with no output](codex.md#an-open-approval-is-a-tool-call-with-no-output), for Codex.

## Typed text with a line break is sent at once, as one line

`cmux send` with `first line\nsecond line`, and no Enter after it, sent the prompt: OpenCode received `first linesecond line` as one line and started a turn on it. The line break was dropped, and the text was submitted without an Enter. The [keybinds docs](https://opencode.ai/docs/keybinds/) give `input_newline` as Shift+Enter, Ctrl+Enter, Alt+Enter or Ctrl+J. Whether any of them makes a line break when cmux sends it is unmeasured.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [Shift+Enter is a line break in Claude Code's prompt box, and a typed one is not](prompt-box.md#shiftenter-is-a-line-break-in-claude-codes-prompt-box-and-a-typed-one-is-not).

## Esc twice interrupts a turn

One Esc during a turn changed the footer's "esc interrupt" to "esc again to interrupt", and the turn carried on to the end. Two Escs in a row stopped it, on both versions. On 1.18.34 the message was saved with `MessageAbortedError`. The [keybinds docs](https://opencode.ai/docs/keybinds/) give `session_interrupt` as `escape`, which reads as one press; the TUI wanted two.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [Esc interrupts, `/quit` exits, and `codex resume <id>` resumes](codex.md#esc-interrupts-quit-exits-and-codex-resume-id-resumes).

## `/exit` exits, and `opencode -s <id>` resumes

`/exit` ended OpenCode, and the workspace closed with it. cmux kept the record, with `stored_pid_exists: false`, since the plugin sends `session-end` only when a session is archived or deleted. `opencode -s <id>` reopened the conversation, but cmux kept the old surface and pid until the next prompt, when the record moved to the new ones. Neither its `--help` nor the [CLI docs](https://opencode.ai/docs/cli/) list an option to start a session with a chosen id.

- **Measured:** OpenCode 1.18.33, cmux 0.64.25.
- **See also:** [A workspace closes itself when its `initial_command` exits](cmux.md#a-workspace-closes-itself-when-its-initial_command-exits), and [cmux knows a Codex session only after its first prompt](codex.md#cmux-knows-a-codex-session-only-after-its-first-prompt), where a resumed Codex session moves the same way.

## OpenCode updates itself between launches

`opencode --version` printed 1.18.33 for one launch and 1.18.34 for the next, a few minutes later, with no update run by hand. The [config docs](https://opencode.ai/docs/config/) say `autoupdate` is on by default and downloads updates at startup; `"autoupdate": false` in `~/.config/opencode/opencode.json` (or `.jsonc`) holds the version still while measuring. A finding measured on one launch may not hold on the next, so record the version each time.

- **Measured:** OpenCode 1.18.33 and 1.18.34.
- **See also:** [Record the versions first](measuring.md#record-the-versions-first).
