# OpenCode

OpenCode is not yet a harness seamux drives, and this page holds its findings, measured before its engine is written, as [CONTRIBUTING.md](../CONTRIBUTING.md) asks. Much of it looks like [Codex](codex.md): cmux learns of a session late, its lifecycle can't be trusted, and the conversation itself is the signal. Unlike Codex, the conversation is in a SQLite database that nothing in cmux points at, and OpenCode can serve its sessions over HTTP. Measured against OpenCode 1.18.33 and 1.18.34 under cmux 0.64.25, launched as plain `opencode` through `zsh -ic` with no wrapper, and with cmux's OpenCode plugins installed (`cmux hooks opencode install`), unless an entry says otherwise.

OpenCode entries that live in other domains:

- [OpenCode keeps a pasted message whole and submits it, as Codex does](prompt-box.md#opencode-keeps-a-pasted-message-whole-and-submits-it-as-codex-does).
- [Shift+Enter, Alt+Enter and Ctrl+Enter are line breaks in OpenCode, and Ctrl+J is not](prompt-box.md#shiftenter-altenter-and-ctrlenter-are-line-breaks-in-opencode-and-ctrlj-is-not).
- [Ctrl+E, Ctrl+U and Backspace empty a prompt box](prompt-box.md#ctrle-ctrlu-and-backspace-empty-a-prompt-box-a-line-at-a-time-in-claude-code-and-codex-alike), in OpenCode too.
- [Two Escs on an idle Claude Code chat open Rewind](dialogs.md#two-escs-on-an-idle-claude-code-chat-open-rewind), which matters if OpenCode's two Escs become everyone's.

## cmux's OpenCode session plugin reports only three events

cmux integrates OpenCode through two plugins in `~/.config/opencode/plugins/`, read as installed. `cmux-session.js` reports OpenCode's `session.created` and `session.updated` to cmux as `session-start`, its `session.idle` and an idle `session.status` as `stop`, and an archived or deleted session as `session-end`, and nothing else. `cmux-feed.js` sends `permission.asked` and `question.asked` to cmux's Feed with `feed.push`, and answers them through OpenCode's own API when the user decides there. OpenCode's [plugin docs](https://opencode.ai/docs/plugins/) list the `session.*` and `permission.asked` events, but not `question.asked`.

- **Measured:** cmux 0.64.25, plugins marked `cmux-opencode-session-plugin-marker v1` and `cmux-feed-plugin-marker v1`.
- **See also:** [cmux's lifecycle is unreliable for OpenCode](#cmuxs-lifecycle-is-unreliable-for-opencode), which follows from what the plugin reports.

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
- **See also:** [`active_for_surface` stays `false` for a live Codex session](codex.md#active_for_surface-stays-false-for-a-live-codex-session), [`cmux sessions list` can lose a live Claude session's pid](cmux.md#cmux-sessions-list-can-lose-a-live-claude-sessions-pid), [cmux lists an OpenCode subagent as a session of its own](#cmux-lists-an-opencode-subagent-as-a-session-of-its-own), in its parent's surface.

## cmux has no transcript for OpenCode, whose sessions live in SQLite

cmux reports `transcript_path: null` and `transcript_backed: false`. OpenCode keeps every session in `~/.local/share/opencode/opencode.db`: the `session` table has `id`, `parent_id`, `directory`, `title`, `agent` and `model`, `message` holds one row per message with its JSON in `data` (`role`, `time.created`, `time.completed`, `finish`, `error`), and `part` holds each message's pieces (`text`, `reasoning`, `tool`, `step-start`, `step-finish`). A new session's title is `New session - <ISO time>`. OpenCode renamed one after its first finished reply (to `Pong`, for a prompt asking for "pong"), and a session whose turns never finished kept the default. [Troubleshooting](https://opencode.ai/docs/troubleshooting/) says session and message data is in `project/` under `~/.local/share/opencode/`, but there was no `project/` there, only the database.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [The record names the transcript](codex.md#the-record-names-the-transcript), for Codex.

## cmux's lifecycle is unreliable for OpenCode

`agent_lifecycle` was `unknown` while a turn ran, and stayed `unknown` after a turn finished normally: the record didn't change for 47 seconds after the reply. It went `idle` only after a turn was interrupted. It never reported that a permission prompt was waiting. `cmux-session.js` has no event for a turn starting or for needing input, so cmux can't say either. It does map `session.idle` to `stop`, and why no `stop` arrived after a normal finish is unmeasured.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [cmux's lifecycle is unreliable for Codex](codex.md#cmuxs-lifecycle-is-unreliable-for-codex), [OpenCode's server says whether a session is busy](#opencodes-server-says-whether-a-session-is-busy), which does.

## A turn is over when its assistant message has `time.completed`

A finished reply's `message` row has `time.completed` and `finish: "stop"`, and its last `part` is a `step-finish` with `reason: "stop"`. An interrupted one has `time.completed`, `finish: null` and `error.name: "MessageAbortedError"`. While a turn runs, its assistant message has no `time.completed`. On 1.18.33, interrupting a request that was stuck retrying left `time.completed` with neither `finish` nor `error`, so `time.completed` is the signal that the turn is over, and `finish` or `error` only says how.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [cmux's lifecycle is unreliable for Codex](codex.md#cmuxs-lifecycle-is-unreliable-for-codex), where `task_complete` and `turn_aborted` play this part.

## OpenCode serves its sessions over HTTP only when launched with `--port`

The [server docs](https://opencode.ai/docs/server/) say the TUI picks a random port, but an `opencode` launched with no flags listened on no TCP port at all. Launched with `--port 48731`, it listened on `127.0.0.1:48731`, and served an OpenAPI spec with 162 routes at `/doc`. cmux's record holds no port, so only whoever launched OpenCode knows it. Whether the server asks for any credentials is unmeasured: every request to it was answered without any.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [OpenCode's server says whether a session is busy](#opencodes-server-says-whether-a-session-is-busy).

## OpenCode's server says whether a session is busy

`GET /session/status` returned `{"<session id>": {"type": "busy"}}` while a turn ran, and `{}` once it was over. A permission prompt left the session `busy`, so status alone doesn't say whether a session is working or waiting.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [cmux's lifecycle is unreliable for OpenCode](#cmuxs-lifecycle-is-unreliable-for-opencode), [OpenCode's server lists a waiting permission prompt](#opencodes-server-lists-a-waiting-permission-prompt), [`status: busy` does not mean a turn is running](session-state.md#status-busy-does-not-mean-a-turn-is-running), Claude Code's equivalent.

## OpenCode's server lists a waiting permission prompt

While a permission prompt was open, `GET /permission` listed it: its `id`, `sessionID`, `permission` (`external_directory`), `patterns` (`/etc/*`), the `filepath`, and the `tool` call waiting on it. `POST /permission/<id>/reply` with `{"reply": "once"}` answered it as "Allow once" would: the tool completed and the list emptied. `GET /question` and `POST /question/<id>/reply` are in the spec and unmeasured.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [A waiting permission prompt looks like a running tool call](#a-waiting-permission-prompt-looks-like-a-running-tool-call), which the database can't tell apart.

## An OpenCode subagent is a child session

Asked to use its task tool, OpenCode ran a `general` subagent, and the TUI showed `✓ General Task — Reply with hello` with `ctrl+x down view subagents`. The subagent got its own row in the `session` table, with `parent_id` set to the main session and the title `Reply with hello (@general subagent)`. The main session's `task` tool `part` held its `description`, `prompt` and `subagent_type` in `state.input`, and the child's id in `state.metadata.sessionId`. With `--port`, `GET /session/<id>/children` returned the child, with its `parentID` and title. The child session holds the subagent's own messages, and its reply got `time.completed` when the subagent finished, as a main session's does.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [Claude Code records subagents on disk](subagents.md#claude-code-records-subagents-on-disk), [cmux lists an OpenCode subagent as a session of its own](#cmux-lists-an-opencode-subagent-as-a-session-of-its-own), [An OpenCode subagent's `task` call says whether it is running](#an-opencode-subagents-task-call-says-whether-it-is-running).

## An OpenCode subagent's `task` call says whether it is running

Polled every second through a 34-second subagent, the parent's `task` tool `part` read `state.status: "pending"` before the child session existed, `"running"` from when it appeared until the subagent finished, then `"completed"`, with `state.time.start` and `state.time.end`. Over the same run, `GET /session/status` listed the child as `busy` beside its parent, and dropped it when it finished. So whether a subagent runs, and when it started and stopped, is in OpenCode's own records, where for Claude Code only the `SubagentStart` and `SubagentStop` hooks say so.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [The global hook is required](subagents.md#the-global-hook-is-required), for Claude Code, [OpenCode's event stream reports a subagent starting and stopping](#opencodes-event-stream-reports-a-subagent-starting-and-stopping).

## OpenCode's event stream reports a subagent starting and stopping

With `--port`, `GET /event` streamed OpenCode's events as they happened. For the subagent's child session it sent `session.created`, with `info.parentID` set to the parent and the subagent's title, when the subagent started, `session.status` with `busy` while it worked, and `session.status` with `idle` then `session.idle` when it finished. These are the moments Claude Code's `SubagentStart` and `SubagentStop` hooks mark. The [plugin docs](https://opencode.ai/docs/plugins/) list the same event names for plugins; whether a plugin sees them for a child session as the stream does is unmeasured.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [An OpenCode subagent's `task` call says whether it is running](#an-opencode-subagents-task-call-says-whether-it-is-running), [cmux's OpenCode session plugin reports only three events](#cmuxs-opencode-session-plugin-reports-only-three-events).

## cmux lists an OpenCode subagent as a session of its own

`cmux sessions list` had a row for the child session beside its parent's, with the parent's `surface_id` and `pid`, `stored_pid_exists: true` and `agent_lifecycle: "unknown"`. So filtering on `surface_id` finds two sessions in one surface, and only the database or the server says which is the parent.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [An OpenCode subagent is a child session](#an-opencode-subagent-is-a-child-session), [Claude Code records subagents on disk](subagents.md#claude-code-records-subagents-on-disk), where neither cmux nor `claude agents` knows of them.

## A new folder asks nothing

OpenCode opened straight to its prompt box ("Ask anything…") in a folder it had never seen, with no trust or setup dialog.

- **Measured:** OpenCode 1.18.33 and 1.18.34, cmux 0.64.25.
- **See also:** [A new folder stops on a trust dialog that nothing reports](launching.md#a-new-folder-stops-on-a-trust-dialog-that-nothing-reports), for Claude Code and Codex.

## A waiting permission prompt looks like a running tool call

Asked to read `/etc/hosts`, OpenCode stopped on "△ Permission required", "Access external directory /etc". While the prompt was open, the tool's `part` had `state.status: "running"` and its message had no `time.completed`, the same as a tool that is running, so the database can't tell that it's waiting. The screen, cmux's Feed and [OpenCode's server](#opencodes-server-lists-a-waiting-permission-prompt) can. What the Feed shows for it, and what `question.asked` looks like on screen, are unmeasured. The [permissions docs](https://opencode.ai/docs/permissions/) say `external_directory` defaults to `ask`.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [An open approval is a tool call with no output](codex.md#an-open-approval-is-a-tool-call-with-no-output), for Codex, [Enter allows an OpenCode permission prompt once](#enter-allows-an-opencode-permission-prompt-once).

## Enter allows an OpenCode permission prompt once

The prompt offered "Allow once", "Allow always" and "Reject", with "⇆ select" and "enter confirm" below. Enter chose "Allow once": the tool completed, and no rule was saved to the `permission` table. The [permissions docs](https://opencode.ai/docs/permissions/) say "always" lasts for the rest of the session. The keys for "Allow always" and "Reject" are unmeasured.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [A permission prompt's "No" has no fixed number](dialogs.md#a-permission-prompts-no-has-no-fixed-number), for Claude Code, [An open approval is a tool call with no output](codex.md#an-open-approval-is-a-tool-call-with-no-output), where Codex approves with `y`.

## Esc twice interrupts a turn

One Esc during a turn changed the footer's "esc interrupt" to "esc again to interrupt", and the turn carried on to the end. Two Escs in a row stopped it, on both versions. On 1.18.34 the message was saved with `MessageAbortedError`. Two Escs on an idle OpenCode did nothing that showed. The [keybinds docs](https://opencode.ai/docs/keybinds/) give `session_interrupt` as `escape`, which reads as one press; the TUI wanted two. With `--port`, `POST /session/<id>/abort` also stopped a turn, with no key: it returned `true`, the message was saved with `MessageAbortedError`, and `/session/status` went back to `{}`.

seamux's `interrupt` macro presses one Esc, which stops Claude Code and Codex. Two for every harness is not harmless: [two Escs on an idle Claude Code chat open Rewind](dialogs.md#two-escs-on-an-idle-claude-code-chat-open-rewind), and a Stop that lands as a turn ends would leave that dialog open. What two Escs do in Codex is unmeasured.

- **Measured:** OpenCode 1.18.33 and 1.18.34, Claude Code 2.1.287, cmux 0.64.25.
- **In seamux:** `interrupt` in [macros.server.ts](../app/lib/macros.server.ts).
- **See also:** [Esc interrupts, `/quit` exits, and `codex resume <id>` resumes](codex.md#esc-interrupts-quit-exits-and-codex-resume-id-resumes).

## `/exit` ends OpenCode and leaves cmux's record

`/exit` ended OpenCode, and the workspace closed with it. cmux kept the record, with `stored_pid_exists: false`, since the plugin sends `session-end` only when a session is archived or deleted.

- **Measured:** OpenCode 1.18.33, cmux 0.64.25.
- **See also:** [A workspace closes itself when its `initial_command` exits](cmux.md#a-workspace-closes-itself-when-its-initial_command-exits), [cmux's OpenCode session plugin reports only three events](#cmuxs-opencode-session-plugin-reports-only-three-events).

## `opencode -s <id>` resumes on the old surface until the next prompt

`opencode -s <id>` reopened the conversation in a new workspace, but cmux kept the old surface and pid until the next prompt, when the record moved to the new ones. Neither its `--help` nor the [CLI docs](https://opencode.ai/docs/cli/) list an option to start a session with a chosen id.

- **Measured:** OpenCode 1.18.33, cmux 0.64.25.
- **See also:** [cmux knows a Codex session only after its first prompt](codex.md#cmux-knows-a-codex-session-only-after-its-first-prompt), where a resumed Codex session moves the same way.

## OpenCode updates itself between launches

`opencode --version` printed 1.18.33 for one launch and 1.18.34 for the next, a few minutes later, with no update run by hand. The [config docs](https://opencode.ai/docs/config/) say `autoupdate` is on by default and downloads updates at startup; `"autoupdate": false` in `~/.config/opencode/opencode.json` (or `.jsonc`) holds the version still while measuring. A finding measured on one launch may not hold on the next, so record the version each time.

- **Measured:** OpenCode 1.18.33 and 1.18.34.
- **See also:** [Record the versions first](measuring.md#record-the-versions-first).
