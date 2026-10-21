# Cursor

Cursor's agent CLI, `agent` (also installed as `cursor-agent`), is the third harness seamux drives. cmux has no wrapper for it: cmux learns of a chat from the hooks `cmux hooks cursor install` writes into `~/.cursor/hooks.json`, and cmux's lifecycle for it, unlike Codex's, holds up. Its transcript is plain JSONL that cmux points at, but it says nothing while a turn runs, and where a chat runs and what it is called are in Cursor's own `meta.json`. Measured against Cursor Agent 2026.10.18-ea085cb and 2026.10.19-6bbf2c4 (it updated itself between two launches) under cmux 0.64.23 on macOS 26.5.1, launched as plain `agent` through `zsh -ic` with cmux's Cursor hooks installed, unless an entry says otherwise.

In seamux, Cursor's reading is [cursor.server.ts](../app/lib/cursor.server.ts), and its driving is the `cursor` entry in `HARNESSES` in [harness.server.ts](../app/lib/harness.server.ts).

Cursor entries that live in other domains:

- [`terminal.paste` ends a paste with a carriage return of its own](cmux.md#terminalpaste-ends-a-paste-with-a-carriage-return-of-its-own), which Cursor sometimes takes for an Enter.
- [Ctrl+E, Ctrl+U and Backspace empty a prompt box](prompt-box.md#ctrle-ctrlu-and-backspace-empty-a-prompt-box-a-line-at-a-time-in-claude-code-and-codex-alike), in Cursor too, a line at a time, and an empty box in shell mode leaves it.

## cmux registers Cursor through hooks, not a wrapper

cmux's app bundle has wrappers for Claude Code, Codex, Amp and Hermes, and none for Cursor. `cmux hooks cursor install` writes `~/.cursor/hooks.json` with `beforeSubmitPrompt`, `beforeShellExecution`, `afterShellExecution`, `postToolUseFailure` (matching `Shell`), `afterAgentResponse` and `stop` hooks, each a no-op unless `CMUX_SURFACE_ID` is set. It wrote to `~/.cursor` even with `CURSOR_CONFIG_DIR` pointing elsewhere. cmux keeps the records in `~/.cmuxterm/cursor-hook-sessions.json`, and `cmux sessions list` lists them with `agent: "cursor"`, `launch_backed: false` and empty `launch_arguments`.

- **Measured:** Cursor Agent 2026.10.18, cmux 0.64.23.
- **In seamux:** `cursorHooked`, Cursor's `integrated`, in [harness.server.ts](../app/lib/harness.server.ts), which `installedEngines` in [drive.server.ts](../app/lib/drive.server.ts) asks.
- **See also:** [cmux registers an OpenCode session launched without a wrapper](opencode.md#cmux-registers-an-opencode-session-launched-without-a-wrapper).

## cmux files a Cursor chat only once its first turn is over

Before then `cmux sessions list` has no row for it. A first turn that wrote a 700-word essay with no tools ran 20 seconds with no row, which appeared a second after it ended. A first turn stopped on an approval had no row until the approval was answered. Later turns change the row as they go.

- **Measured:** Cursor Agent 2026.10.19, cmux 0.64.23.
- **In seamux:** a Cursor chat seamux starts is under an id it picks, and `unfiled` in [drive.server.ts](../app/lib/drive.server.ts) keeps it live in its new workspace until cmux files it.
- **See also:** [cmux knows a Codex session only after its first prompt](codex.md#cmux-knows-a-codex-session-only-after-its-first-prompt), [`agent --resume` with an id it has never seen starts a chat under that id](#agent---resume-with-an-id-it-has-never-seen-starts-a-chat-under-that-id).

## `agent --resume` with an id it has never seen starts a chat under that id

`agent --resume <a new uuid> '<prompt>'` started a new chat with that id, and cmux filed it under that id. `agent create-chat` prints a new id too, without making anything under `~/.cursor/chats`. Cursor has no `--session-id` or `--name`.

- **Measured:** Cursor Agent 2026.10.19, cmux 0.64.23.
- **In seamux:** Cursor's `identify` in [harness.server.ts](../app/lib/harness.server.ts).

## cmux records `~/.cursor` as every Cursor chat's directory

`cwd` in `cmux sessions list` was `/Users/<me>/.cursor` for every Cursor chat, wherever it ran: the hooks run with that as their directory. `~/.cursor/chats/<md5 of the folder>/<chat id>/meta.json` has the real one as `cwd`, with `title`, `createdAtMs` and `updatedAtMs`.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** `cursorChats` in [cursor.server.ts](../app/lib/cursor.server.ts).

## `active_for_surface` stays `false` for a live Cursor chat

`active_for_surface` and `active_for_workspace` were `false`, and `active_surface_session_id` `null`, while Cursor ran in that surface. `stored_pid_exists` was `true` for a running chat and `false` once it exited.

- **Measured:** Cursor Agent 2026.10.18, cmux 0.64.23.
- **In seamux:** Cursor's `markedActive: false` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [`active_for_surface` stays `false` for a live Codex session](codex.md#active_for_surface-stays-false-for-a-live-codex-session).

## cmux's lifecycle for Cursor is right

`agent_lifecycle` was `running` while a turn ran, `needsInput` while a command approval waited, and `idle` once the turn ended, was interrupted with Esc, or the approval was answered and the turn finished. It went `idle` a moment before Cursor wrote the turn's reply to the transcript.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** `cursorCard` in [board.server.ts](../app/lib/board.server.ts), through `lifecycle` on `LiveSession` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [cmux's lifecycle is unreliable for Codex](codex.md#cmuxs-lifecycle-is-unreliable-for-codex), [cmux's lifecycle is unreliable for OpenCode](opencode.md#cmuxs-lifecycle-is-unreliable-for-opencode).

## The transcript is JSONL that says nothing while a turn runs

cmux's record names it as `transcript_path`: `~/.cursor/projects/<folder with dashes>/agent-transcripts/<chat id>/<chat id>.jsonl`. Each line is `{"role":"user"|"assistant","message":{"content":[…]}}`, with `text` and `tool_use` (`name`, `input`) parts, or `{"type":"turn_ended","status":"success"}`. A prompt reaches it as `<timestamp>Monday, Oct 19, 2026, 5:43 PM (UTC-7)</timestamp>\n<user_query>\n…\n</user_query>`, and no line has a time of its own. Tools were named `Shell`, `Write` and `GetDynamicTools`. There is no token usage, and the context the status line shows ("Auto · 4.7%") is on the screen only.

Cursor writes a prompt and each reply as it has them, and keeps one `turn_ended`, the file's last line: when a turn starts it removes the one before, in the same file. A reply with no tool call is written only when it is done, so for a turn of text alone the file doesn't change until the turn ends. A turn interrupted before it wrote anything left nothing, not even its prompt.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** `summarizeCursor` and `loadCursorMessages` in [cursor.server.ts](../app/lib/cursor.server.ts). `follow` in [transcript.server.ts](../app/lib/transcript.server.ts) reads a file again from the start when it shrank or no longer ends a line where the last read stopped. With `turn_ended` gone, the 41 bytes it took are the start of the next prompt's line, whose JSON opens the same way every time and has no line break there, so each new turn reads the transcript again from the start.
- **See also:** [The record names the transcript](codex.md#the-record-names-the-transcript), for Codex.

## Cursor titles a chat after its first turn, and `/rename` renames it

The first turn's chat was titled "Pong Game", for a prompt asking for the word pong. `/rename <name>` sets `title` in `meta.json` and the name in the chat's SQLite store (`store.db`, table `meta`, a hex-encoded JSON value with `name`). `agent ls` lists chats by `meta.json`'s title, but resuming a chat whose `meta.json` alone had been edited wrote the store's name back over it.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** Cursor's `renameClosed` in [harness.server.ts](../app/lib/harness.server.ts) refuses, and asks for the chat to be resumed first.
- **See also:** [Codex names its own sessions after the first turn](names.md#codex-names-its-own-sessions-after-the-first-turn).

## The trust dialog defaults to trusting

A new folder opens on "⚠ Workspace Trust Required" with "▶ [a] Trust this workspace" and "[q] Quit", so Enter trusts. The banner ("Cursor Agent" on a line of its own, then the version) draws only after. A prompt given at launch waits for the dialog, then runs. The choice is kept as `~/.cursor/projects/<folder>/.workspace-trusted`. `agent --trust` skips the dialog. Signed out, Cursor shows "Press any key to log in..." instead.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** Cursor's `trust` and `ready` in [harness.server.ts](../app/lib/harness.server.ts), used by `acceptTrust` in [macros.server.ts](../app/lib/macros.server.ts).
- **See also:** [The trust dialog defaults to yes](codex.md#the-trust-dialog-defaults-to-yes) in Codex.

## The prompt box sits two columns in, between two rules

It is drawn between a rule of `▄` and one of `▀`, its first line led by `  → `, a line it wraps onto by four spaces. Empty, it shows "Plan, search, build anything" in a new chat and "Add a follow-up" after, with "ctrl+c to stop" at its right end while a turn runs. `!` on an empty line turns it to shell mode, led by `  ! `. The slash menu opens under the box, its rows led by three spaces and the highlighted one by `   → `. A command approval leads its options with `  → ` too, with no rule above.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** Cursor's `inputLead`, `inputIndent` and `boxTop` in [harness.server.ts](../app/lib/harness.server.ts), for `inputArea`, and `readCursorBox`.

## A paste shows in full and needs its own Enter, which can come too soon

`terminal.paste` of a message showed it in the box whole, lines and all, and a long one folded to "[Pasted text #1 +1 lines]", which the model got in full with no wrapper. cmux ends every paste with a carriage return: Cursor took that for a line break after a paste of `/` and of several lines, and sometimes for an Enter after a single line, which then sent itself. An Enter seamux pressed straight after the paste was lost: the message stayed in the box. Pressed once the box showed the message, it sent, and four messages in a row went once each. The box showed a paste within 600 ms.

Typed, the same messages fared worse: a three-line message lost its second line's break and some text, and 1,238 characters typed a hundred at a time arrived mangled. Shift+Enter is a line break.

- **Measured:** Cursor Agent 2026.10.19, cmux 0.64.23.
- **In seamux:** Cursor's `typesMessages: false`, `unsent: inCursorBox` and `shownWaitMs` in [harness.server.ts](../app/lib/harness.server.ts), and `Session.submit`.
- **See also:** [`terminal.paste` ends a paste with a carriage return of its own](cmux.md#terminalpaste-ends-a-paste-with-a-carriage-return-of-its-own), [An Enter that comes while Claude Code is still taking in a paste is lost](prompt-box.md#an-enter-that-comes-while-claude-code-is-still-taking-in-a-paste-is-lost).

## A slash command typed in full is what the menu picks

Typing `/` opens the menu, and it filters as more is typed. `/exit`, `/clear` and `/rename <name>` typed in full, then Enter, each ran. Pasted, a one-line command often sent itself on the paste's carriage return, and an Enter straight after a paste that didn't was lost, leaving `/exit` in the box over the open menu. `/exit` and `/quit` exit, `/clear` starts a new chat, `/rename` renames, `/resume` lists chats to resume.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, Claude Code 2.1.304 (its pasted `/rename` and `/exit`, unchanged), cmux 0.64.23.
- **In seamux:** Cursor's `typesCommands` in [harness.server.ts](../app/lib/harness.server.ts), and `command` in [macros.server.ts](../app/lib/macros.server.ts).

## Esc interrupts and puts the prompt back in the box

Esc while a 600-word reply was streaming stopped it and left the prompt in the box, as a draft. That turn wrote nothing to the transcript. `/exit` ends the process, and the workspace closes with it; cmux's record stays, with `stored_pid_exists: false`.

- **Measured:** Cursor Agent 2026.10.18, cmux 0.64.23.
- **In seamux:** `interrupt` in [macros.server.ts](../app/lib/macros.server.ts), which presses Esc for every harness, and `send`, which empties the box first.

## A command approval names the command, `y` runs it, and Esc asks what to do instead

Under a rule, the screen shows `$  <command> in <dir>`, a blank line, "Run this command?", "Hook requested approval • Not in allowlist: <program>", then "→ Run (once) (y)", "Run Everything (shift+tab)" and "Skip & tell the agent what to do instead (esc or n)". `y` ran it. Esc or `n` opened the box as "Tell the agent what to do instead (Enter to send, empty to skip, Esc to cancel)", Esc there went back to the approval, and Enter on it empty skipped the command, shown as "Rejected". Ctrl+C typed as `\x03` rejected it too. The agent was told and tried the same command again. Edits with its `Write` tool asked nothing. Shift+Tab, sent as cmux's `shift+tab` key, ran the command and put the chat in Run Everything mode, named at the right of the line under the prompt box: the next command, `date && hostname && uname -a`, ran without asking. A cleanup turn's compound `git` commands asked each time, "Not in allowlist: git status, git rev-parse, git branch, git worktree", then "Not in allowlist: git -C", and both drew Run Everything.

The approval comes from cmux's `beforeShellExecution` hook, which also sends it to cmux's Feed: when it was answered there (`agent.notification.decision`, `reason: "accepted"`, in `~/.cmuxterm/events.jsonl`), the command ran with no dialog. Which commands ask is cmux's and Cursor's allowlist's to say: `date`, `hostname` and `uname` asked, `ls` was allowed in `~/.cursor/cli-config.json`, and `sw_vers` and `curl` ran without asking once the Feed had answered. What the Feed decides on its own is unmeasured.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19, cmux 0.64.23.
- **In seamux:** `parseCursorApproval` in [cursor.server.ts](../app/lib/cursor.server.ts), `readCursorApproval` in [drive.server.ts](../app/lib/drive.server.ts), Cursor's `approveKey`, `approveAllKey` and `denyKeys` in [harness.server.ts](../app/lib/harness.server.ts), and `approveAll` in [macros.server.ts](../app/lib/macros.server.ts).
- **See also:** [An open approval is a tool call with no output](codex.md#an-open-approval-is-a-tool-call-with-no-output) in Codex.

## Cursor has no question dialog in its default mode

Asked to put a question with a structured tool, the agent looked for one and found none ("Tool "AskQuestion" not found"), and asked in its reply instead.

- **Measured:** Cursor Agent 2026.10.19, cmux 0.64.23.
- **In seamux:** `cursorCard` in [board.server.ts](../app/lib/board.server.ts) takes a reply ending on a question as waiting, through `endingQuestionIn`.

## `/clear` goes on in the same process, and cmux keeps the old chat beside the new

`/clear` started a new chat id at once (its folder under `~/.cursor/chats`), and cmux filed it after the next prompt, with the same `pid` and surface as the old one, whose record stayed with `stored_pid_exists: true`. The one cmux started last is the chat that runs.

- **Measured:** Cursor Agent 2026.10.18, cmux 0.64.23.
- **In seamux:** `listLive` in [drive.server.ts](../app/lib/drive.server.ts) keeps, of the sessions on one pid, the one with the latest `started_at`.
- **See also:** [cmux files a cleared chat's new id after `claude agents` does](session-state.md#cmux-files-a-cleared-chats-new-id-after-claude-agents-does).

## A resumed chat keeps its old pid in cmux

`agent --resume <id>` reopened the chat on its old surface in cmux until the next prompt, when cmux moved it to the new surface but kept the old process's pid, so `stored_pid_exists` was `false` for a chat that ran. The process's arguments have `--resume <id>`: `/Users/<me>/.local/bin/agent --use-system-ca …/cursor-agent/versions/<version>/index.js --resume <id>`.

- **Measured:** Cursor Agent 2026.10.19, cmux 0.64.23.
- **In seamux:** `runningCursorSessions` in [cursor.server.ts](../app/lib/cursor.server.ts), Cursor's `running` and `keepsOldPid` in [harness.server.ts](../app/lib/harness.server.ts), `listLive` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [`cmux sessions list` can lose a live Claude session's pid](cmux.md#cmux-sessions-list-can-lose-a-live-claude-sessions-pid); [A Cursor chat's reused pid has no launch command to tell it by](cmux.md#a-cursor-chats-reused-pid-has-no-launch-command-to-tell-it-by), which also holds for this old pid once another process takes it.

## `agent status` says whether it is signed in

It printed "✓ Logged in as <email>" and exited 0 when signed in, and "Not logged in" when not. `agent status --format json` has `isAuthenticated`. `agent login` opens a browser unless `NO_OPEN_BROWSER` is set; what it prints then is unmeasured, as is the JSON when signed out.

- **Measured:** Cursor Agent 2026.10.18 and 2026.10.19.
- **In seamux:** `askCursor` and Cursor's sign-in in [service.server.ts](../app/lib/service.server.ts).
- **See also:** [Signing in](signing-in.md).
