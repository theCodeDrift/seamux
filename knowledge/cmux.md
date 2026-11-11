# cmux

cmux is the terminal every chat seamux drives runs in, and the only way seamux writes to one. seamux speaks cmux's control socket itself and runs `cmux sessions list` for the rest. Everything here was measured against cmux 0.64.23 unless an entry says otherwise. `npm run test:cmux` (`tests-cmux/`) checks the same contract against a real cmux, and `tests/fake-cmux.ts` stands in for it everywhere else; a change to one goes with the others and with this page.

Entries about cmux that live in other domains:

- [`workspace.create` ignores `command`](launching.md#workspacecreate-ignores-command), and [its login shell doesn't read `~/.zshrc`](launching.md#that-login-shell-does-not-read-zshrc).
- [cmux's `any_agent_needs_input` goes stale](session-state.md#cmuxs-any_agent_needs_input-goes-stale), and [cmux files a cleared chat's new id after `claude agents` does](session-state.md#cmux-files-a-cleared-chats-new-id-after-claude-agents-does).
- [cmux's wrapper passes `claude` subcommands straight through](background-sessions.md#cmuxs-wrapper-passes-claude-subcommands-straight-through).
- [`/rename` retitles the cmux tab, not the workspace](names.md#rename-retitles-the-tab-not-the-workspace-and-cmux-reports-a-new-title-late), and [cmux allows two workspaces with the same title](names.md#cmux-allows-two-workspaces-with-the-same-title).
- [cmux can read Claude Code's slash menu](slash-commands.md#cmux-can-read-claude-codes-slash-menu-but-it-is-no-source-for-a-list).
- Cursor under cmux: [cmux registers Cursor through hooks, not a wrapper](cursor.md#cmux-registers-cursor-through-hooks-not-a-wrapper), [cmux files a Cursor chat only once its first turn is over](cursor.md#cmux-files-a-cursor-chat-only-once-its-first-turn-is-over), [cmux records `~/.cursor` as every Cursor chat's directory](cursor.md#cmux-records-cursor-as-every-cursor-chats-directory), [A resumed chat keeps its old pid in cmux](cursor.md#a-resumed-chat-keeps-its-old-pid-in-cmux).
- Codex under cmux: [cmux knows a Codex session only after its first prompt](codex.md#cmux-knows-a-codex-session-only-after-its-first-prompt), [`active_for_surface` stays `false`](codex.md#active_for_surface-stays-false-for-a-live-codex-session), [cmux's lifecycle is unreliable for Codex](codex.md#cmuxs-lifecycle-is-unreliable-for-codex).
- How cmux's keys and text reach Claude Code: [The prompt box](prompt-box.md).

## cmux's control socket speaks one JSON line each way

A request is `{"id","method","params"}` and a newline, and the reply `{"id","ok":true,"result"}` or `{"id","ok":false,"error":{"code","message"}}`; one connection takes several requests in a row. With `CMUX_SOCKET_CAPABILITY` set, as it is in every cmux terminal, each request line is prefixed `_cmux_capability_v1 <token> `. With `CMUX_SOCKET_PASSWORD` set, the connection opens with `auth <password>`, answered `OK: Authenticated` or `ERROR: …`. `cmux read-screen` is `surface.read_text`, whose `text` is the screen without the command's trailing newline.

`cmux sessions list` is not on the socket at all: it reads `~/.cmuxterm/*-hook-sessions.json` and works out from them which sessions are live. seamux runs the command rather than repeating that logic.

- **Measured:** cmux 0.64.23, by pointing the `cmux` command at a socket that logged what it sent.
- **In seamux:** `cmuxRpc` in [cmux.server.ts](../app/lib/cmux.server.ts); the fake in [tests/fake-cmux.ts](../tests/fake-cmux.ts).
- **See also:** [Point a client at a socket that logs](measuring.md#point-a-client-at-a-socket-that-logs).

## cmux refuses a process it didn't start, in plain text

cmux's Settings, under Automation, set its Socket Control Mode (`automation.socketControlMode`): Off, cmux processes only (the default), Automation mode (any process of this macOS user), Password mode, and Full open access. In the default mode, seamux started from another terminal gets the line `Access denied - only processes started inside cmux can connect` rather than a JSON reply, so it used to report "unreadable reply". `cmux sessions list` still works, since it doesn't use the socket, so the board listed every chat and failed every send. A terminal that isn't cmux's also lacks the `cmux` command on its `PATH`; it is in the app bundle at `Contents/Resources/bin/cmux`. With the socket Off nothing listens, just as when cmux isn't running, so seamux tells the two apart by whether cmux's app is in `ps`.

- **Measured:** cmux 0.64. The mode names are from cmux's English strings. The refusal's wording is from the cmux binary and a user's report; it is unmeasured from outside cmux here.
- **In seamux:** `ACCESS_DENIED`, `cmuxTrouble`, `cmuxAppRunning` and `cmuxCommand` in [cmux.server.ts](../app/lib/cmux.server.ts), and the board's explanation in [cmux-problem.tsx](../app/components/cmux-problem.tsx).
- **See also:** [cmux's control socket speaks one JSON line each way](#cmuxs-control-socket-speaks-one-json-line-each-way).

## cmux RPCs default to the caller's own surface

A call without a `surface_id` acts on whatever terminal seamux itself runs in. seamux always resolves the surface server-side and passes it explicitly, and the fake cmux refuses a surface call without one.

- **Measured:** not recorded.
- **In seamux:** `target` in [harness.server.ts](../app/lib/harness.server.ts), which every `Session` primitive passes. [CLAUDE.md](../CLAUDE.md) makes it a rule.

## `surface.send_key` encodes a key the way a keypress would be, and the `cmux` command goes through the socket too

Into a raw-mode reader, `enter` arrived as `\r` and `shift+enter` as `ESC[27;2;13~`; with the kitty keyboard protocol on (`ESC[>1u`) they were `\r` and `ESC[13;2u`, and with all its flags (`ESC[>31u`) `ESC[13u` and `ESC[13;2u`. `surface.send_text` writes its text as it is. `cmux send-key` is a client of the same socket: pointed at a missing one it fails with "Socket not found".

- **Measured:** cmux 0.64.23.
- **In seamux:** `press` and `write` on `Session` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [Shift+Enter is a line break in Claude Code's prompt box](prompt-box.md#shiftenter-is-a-line-break-in-claude-codes-prompt-box-and-a-typed-one-is-not), [A chat can ignore cmux's Enter](prompt-box.md#a-chat-can-ignore-cmuxs-enter-while-a-lone-typed-carriage-return-sends), [Type into a raw-mode reader](measuring.md#type-into-a-raw-mode-reader).

## `terminal.paste` ends a paste with a carriage return of its own

Into a raw-mode reader, `terminal.paste` of `hello paste` arrived as `hello paste`, then a separate `\r`; with bracketed paste on, as `ESC[200~hello paste ESC[201~`, then `\r`. The text asked for had no line break at its end. This is the Enter behind "a paste submits itself" in Codex and OpenCode, and what Cursor takes for an Enter, a line break or nothing. `surface.send_text` passes an escape sequence through, but in more than one write (`ESC`, then `[200~hello\rworld ESC`, then `[201~`), turning `\n` into `\r`, so it is no way to paste without the carriage return: a harness reading a lone `ESC` as the Esc key would be interrupted.

- **Measured:** cmux 0.64.23.
- **In seamux:** `paste` on `Session` in [harness.server.ts](../app/lib/harness.server.ts), and Cursor's `unsent` and `typesCommands` there.
- **See also:** [Codex folds long typed input, and shows a paste in full](prompt-box.md#codex-folds-long-typed-input-and-shows-a-paste-in-full), [OpenCode keeps a pasted message whole and submits it](prompt-box.md#opencode-keeps-a-pasted-message-whole-and-submits-it-as-codex-does), [A paste shows in full and needs its own Enter, which can come too soon](cursor.md#a-paste-shows-in-full-and-needs-its-own-enter-which-can-come-too-soon), [Type into a raw-mode reader](measuring.md#type-into-a-raw-mode-reader).

## A workspace closes itself when its `initial_command` exits

A chat started by hand, though, leaves its shell prompt behind after `/exit`, so seamux closes its tab once the agent is gone. So does one seamux started that failed, or was closed within seconds of starting: its launch command keeps the shell there to show how the agent exited ([launching.md](launching.md#claude-code-exits-0-when-the-user-quits-and-1-when-the-trust-dialog-is-refused)).

- **Measured:** not recorded.
- **In seamux:** `closeChat` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [`/exit` exits too, and the workspace closes a moment after cmux reports the session over](codex.md#exit-exits-too-and-the-workspace-closes-a-moment-after-cmux-reports-the-session-over).

## `terminal.replay` draws the screen as runs of styled text, where `surface.read_text` has only the text

Its `render_grid` has the terminal's `columns`, `row_spans` (each a run of text in one style, with its `row`, `column`, `cell_width` and `style_id`), `styles` (each with its `id` and flags such as `faint`) and the `cursor`. A row with nothing on it has no span. It says nothing of where a row's text was wrapped: a typed line break and a wrapped row look alike, and only how full the row is tells them apart ([A message unsent in the prompt box](prompt-box.md#a-message-unsent-in-the-prompt-box-reads-back-from-the-screen-with-its-line-breaks)).

- **Measured:** cmux 0.64.23.
- **In seamux:** `readDraft` in [drive.server.ts](../app/lib/drive.server.ts), `ReplayGrid` and `promptBoxDraft` in [harness.server.ts](../app/lib/harness.server.ts); `terminal.replay` in [tests/fake-cmux.ts](../tests/fake-cmux.ts) and [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).
- **See also:** [A suggested next prompt reads as a draft on the screen](prompt-box.md#a-suggested-next-prompt-reads-as-a-draft-on-the-screen-and-only-its-faint-style-and-the-cursor-tell-it-apart).

## `surface.read_text` takes `lines` to reach into the scrollback

Without it, `surface.read_text` returns the screen. With `lines`, it returns the last that many lines of screen and scrollback: after `seq 1 20000`, `lines: 50` gave 50 lines, and `scrollback: true` or `lines: 100000` gave 20,005 lines and 109,290 characters, so a board polling a shell has to bound it. A line longer than the terminal comes back whole: a 200-character line in a 79-column terminal read as one line of 200.

- **Measured:** cmux 0.64.23.
- **In seamux:** nothing yet: the board's terminal reads [`terminal.replay`](#terminalreplay-hands-over-240-rows-of-scrollback-however-many-there-are) for its colours, and gets less history for it.

## A terminal's size belongs to cmux's window, and nothing on the socket resizes it

A workspace created unfocused, which nothing has drawn, was 79 columns by 31 rows by `stty size`. `surface.resize` is `method_not_found`, and `terminal.viewport` with `columns: 44, rows: 30` answered `columns: 79, rows: 31` and changed nothing. So a phone shows the terminal at cmux's width and scrolls sideways.

- **Measured:** cmux 0.64.23, on a throwaway workspace.
- **In seamux:** the terminal panel in [terminal-dialog.tsx](../app/components/terminal-dialog.tsx).

## `surface.send_key` knows the keys a shell needs, and a key a shell doesn't bind leaves bytes on its line

Besides the keys [below](#surfacesend_key-encodes-a-key-the-way-a-keypress-would-be-and-the-cmux-command-goes-through-the-socket-too), cmux takes `up`, `down`, `left`, `right`, `backspace`, `delete`, `ctrl+c`, `ctrl+d`, `ctrl+l`, `ctrl+z`, `home`, `end` and `pageup`, and refuses anything else with `invalid_params: Unknown key`. In zsh, `up` recalled the last line, `left` and `backspace` edited it, `tab` completed `ech` to `echo`, `ctrl+c` stopped a `sleep`, and `ctrl+d` at an empty prompt ended the shell and closed its workspace. After `pageup`, which zsh doesn't bind there, the next line typed began with a stray `~`, the end of the key's escape sequence.

- **Measured:** cmux 0.64.23, zsh 5.9, on a throwaway workspace.
- **In seamux:** `TERMINAL_KEYS` in [terminal.ts](../app/lib/terminal.ts), which leaves out `ctrl+d` and `pageup`.

## A closed workspace answers every surface call `not_found`

After a shell exits, `surface.read_text` and `surface.send_key` on its surface answer `not_found: Workspace not found`, and `workspace.list` can still list the workspace for a moment after `workspace.close` returns: about 3 seconds after a shell's `exit`, and right after a close, where two seconds later it had gone. Ask a surface itself whether it's there, rather than the list.

- **Measured:** cmux 0.64.23, on throwaway workspaces.
- **In seamux:** `closed` in [terminal.server.ts](../app/lib/terminal.server.ts).
- **See also:** [A workspace closes itself when its `initial_command` exits](#a-workspace-closes-itself-when-its-initial_command-exits).

## `terminal.replay` hands over 240 rows of scrollback, however many there are

After `seq 1 2000`, `render_grid` had `history_rows: 1975`, `scrollback_rows: 240`, and 240 rows in `scrollback_spans`, and `scrollback`, `scrollback_rows`, `max_scrollback`, `scrollback_limit`, `history_rows`, `limit`, `lines`, `rows` and `max_rows`, each set to 1000, changed none of that. `scrollback_spans` number their rows from 0, oldest first, and the row after the last is the screen's row 0. Each `styles` entry has `foreground` and `background` as hex, whatever the program set (palette, 256 or true colour), with `foreground_source` and `background_source` of `default`, `palette` or `rgb`, and `bold`, `italic`, `underline`, `strikethrough`, `inverse` and `invisible`. An inverse style holds the colours from before the swap. `terminal_foreground` and `terminal_background` are the terminal's own. A span says where it starts: `a`, ten columns' gap, `b` came as spans at columns 0 and 11 with nothing between, and an emoji had `cell_width: 2` for one character, so a line is put back together by column. A 200-character line came as three rows, of 79, 79 and 42 cells, so wrapped lines stay broken. On the alternate screen, as under a full-screen program, `active_screen` is `alternate` and `scrollback_rows` is 0. A reply carried 34 KB for 271 rows, 6 KB of it the theme, sent again every time.

- **Measured:** cmux 0.64.23, on throwaway workspaces.
- **In seamux:** `Terminal.grid` in [harness.server.ts](../app/lib/harness.server.ts), `terminalContent` in [terminal.server.ts](../app/lib/terminal.server.ts).
- **See also:** [`terminal.replay` draws the screen as runs of styled text](#terminalreplay-draws-the-screen-as-runs-of-styled-text-where-surfaceread_text-has-only-the-text), [`surface.read_text` takes `lines`](#surfaceread_text-takes-lines-to-reach-into-the-scrollback).

## `surface.close` refuses a workspace's last tab

It answers `Cannot close the last surface`, so for the last tab seamux calls `workspace.close` instead.

- **Measured:** not recorded.
- **In seamux:** `closeChat` in [drive.server.ts](../app/lib/drive.server.ts).

## `cmux sessions list` can lose a live Claude session's pid

A live Claude Code session in a cmux surface can come back with `pid: null`, `stored_pid_exists: null`, `launch_backed: false` and empty `launch_arguments`, while `active_for_surface` is still `true` and the process, with that surface's `CMUX_SURFACE_ID`, is running. Its record in `~/.cmuxterm/claude-hook-sessions.json` has only the fields the `Stop` hook writes (`lastBody`, `lastSubtitle`, `hadPendingBackgroundWorkAtStop`) and none of `pid`, `pidStartSeconds` or `launchCommand`; the other 24 records at the time had them. `null` means cmux doesn't know, not that the process is gone, and treating it as dead left the chat's card saying "Not in a cmux surface". `claude agents --json` still lists the session with its pid, so seamux asks it about those rows.

- **Measured:** cmux 0.64.23, Claude Code 2.1.286, on one dispatched session; what drops the pid is unknown.
- **In seamux:** `listLive` and `runningClaudeSessions` in [drive.server.ts](../app/lib/drive.server.ts); the fake's `stored_pid_exists: null` in [tests/fake-cmux.ts](../tests/fake-cmux.ts), and the contract in [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).
- **See also:** [`active_for_surface` stays `false` for a live OpenCode session](opencode.md#active_for_surface-stays-false-for-a-live-opencode-session), where `stored_pid_exists` was never `null` and there is no `claude agents` to ask.

## `cmux sessions list` takes a reused pid for a live session

cmux decides `stored_pid_exists` by whether any process has the pid it stored, not whether that process is the session's. A Codex session whose workspace had been closed five days earlier still came back with `stored_pid_exists: true`, because macOS had given its pid to `geodMachServiceBridge`. Its `launch_arguments` began `/opt/homebrew/bin/codex`, while its `stored_pid_arguments` held only the new process's path. The board kept its card live and sent every close to a workspace that no longer existed (`Workspace not found`). A live session's `stored_pid_arguments` is the command it was launched with: identical to `launch_arguments` for Codex, and starting with the same `claude` path for Claude Code. So seamux counts a session as dead when its stored pid's arguments are known and don't include its launch command's path. It doesn't ask `workspace.list` instead, because that lists only one window's workspaces (its reply carries a `window_id`).

- **Measured:** cmux 0.64.23, Codex 0.157.1, Claude Code 2.1.296, on one dead Codex session and on a throwaway one started for the purpose.
- **In seamux:** `pidReused` in `listLive` in [drive.server.ts](../app/lib/drive.server.ts); `launch_arguments` and `stored_pid_arguments` in [tests/fake-cmux.ts](../tests/fake-cmux.ts) and [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).
- **See also:** [`cmux sessions list` can lose a live Claude session's pid](#cmux-sessions-list-can-lose-a-live-claude-sessions-pid).

## A Cursor chat's reused pid has no launch command to tell it by

A Cursor record has empty `launch_arguments`, since cmux registers Cursor through its hooks, not a wrapper, so the launch-command check above never fires for it. A Cursor chat left at an approval when its workspace closed kept `agent_lifecycle: "needsInput"` and its old pid, and its card came back on the board, asking for that approval again, for as long as some short-lived process held that pid, as when closing another chat. Each record in the hook file `store_path` names (`~/.cmuxterm/<agent>-hook-sessions.json`, under `sessions`, keyed by session id) has `pidStartSeconds` and `pidStartMicroseconds`, when the session's process started, which `cmux sessions list --json` doesn't print. For every live Claude Code session it matched `ps -o lstart=` (run with `TZ=UTC`, `LC_ALL=C`) to the second, and for a Codex record whose pid had passed to a `react-router dev` it was five days earlier than that process's start. So seamux counts a record as dead when the process at its pid started at another time than the hook file records. That holds for every harness, and for a pid gone to another process of the same harness, which the launch command can't tell apart. A harness whose resumed chat keeps the old pid (Cursor) still asks its own list of running chats.

- **Measured:** cmux 0.64.23, Cursor Agent 2026.10.19-6bbf2c4, Claude Code 2.1.306, Codex 0.156.1, on the records in the hook files at the time, three live Claude Code sessions, one dead Codex session and one dead Cursor chat.
- **In seamux:** `pidsHandedOn` in `listLive` in [drive.server.ts](../app/lib/drive.server.ts); `store_path` in [tests/fake-cmux.ts](../tests/fake-cmux.ts), the test in [tests/drive.test.ts](../tests/drive.test.ts), and the contract in [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).
- **See also:** [`cmux sessions list` takes a reused pid for a live session](#cmux-sessions-list-takes-a-reused-pid-for-a-live-session); [cmux registers Cursor through hooks, not a wrapper](cursor.md#cmux-registers-cursor-through-hooks-not-a-wrapper).
