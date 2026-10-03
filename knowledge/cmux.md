# cmux

cmux is the terminal every chat seamux drives runs in, and the only way seamux writes to one. seamux speaks cmux's control socket itself and runs `cmux sessions list` for the rest. Everything here was measured against cmux 0.64.23 unless an entry says otherwise. `npm run test:cmux` (`tests-cmux/`) checks the same contract against a real cmux, and `tests/fake-cmux.ts` stands in for it everywhere else; a change to one goes with the others and with this page.

Entries about cmux that live in other domains:

- [`workspace.create` ignores `command`](launching.md#workspacecreate-ignores-command), and [its login shell doesn't read `~/.zshrc`](launching.md#that-login-shell-does-not-read-zshrc).
- [cmux's `any_agent_needs_input` goes stale](session-state.md#cmuxs-any_agent_needs_input-goes-stale).
- [cmux's wrapper passes `claude` subcommands straight through](background-sessions.md#cmuxs-wrapper-passes-claude-subcommands-straight-through).
- [`/rename` retitles the cmux tab, not the workspace](names.md#rename-retitles-the-tab-not-the-workspace-and-cmux-reports-a-new-title-late), and [cmux allows two workspaces with the same title](names.md#cmux-allows-two-workspaces-with-the-same-title).
- [cmux can read Claude Code's slash menu](slash-commands.md#cmux-can-read-claude-codes-slash-menu-but-it-is-no-source-for-a-list).
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

## A workspace closes itself when its `initial_command` exits

A chat started by hand, though, leaves its shell prompt behind after `/exit`, so seamux closes its tab once the agent is gone.

- **Measured:** not recorded.
- **In seamux:** `closeChat` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [`/exit` exits too, and the workspace closes a moment after cmux reports the session over](codex.md#exit-exits-too-and-the-workspace-closes-a-moment-after-cmux-reports-the-session-over).

## `surface.close` refuses a workspace's last tab

It answers `Cannot close the last surface`, so for the last tab seamux calls `workspace.close` instead.

- **Measured:** not recorded.
- **In seamux:** `closeChat` in [drive.server.ts](../app/lib/drive.server.ts).

## `cmux sessions list` can lose a live Claude session's pid

A live Claude Code session in a cmux surface can come back with `pid: null`, `stored_pid_exists: null`, `launch_backed: false` and empty `launch_arguments`, while `active_for_surface` is still `true` and the process, with that surface's `CMUX_SURFACE_ID`, is running. Its record in `~/.cmuxterm/claude-hook-sessions.json` has only the fields the `Stop` hook writes (`lastBody`, `lastSubtitle`, `hadPendingBackgroundWorkAtStop`) and none of `pid`, `pidStartSeconds` or `launchCommand`; the other 24 records at the time had them. `null` means cmux doesn't know, not that the process is gone, and treating it as dead left the chat's card saying "Not in a cmux surface". `claude agents --json` still lists the session with its pid, so seamux asks it about those rows.

- **Measured:** cmux 0.64.23, Claude Code 2.1.286, on one dispatched session; what drops the pid is unknown.
- **In seamux:** `listLive` and `runningClaudeSessions` in [drive.server.ts](../app/lib/drive.server.ts); the fake's `stored_pid_exists: null` in [tests/fake-cmux.ts](../tests/fake-cmux.ts), and the contract in [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).
- **See also:** [`active_for_surface` stays `false` for a live OpenCode session](opencode.md#active_for_surface-stays-false-for-a-live-opencode-session), where `stored_pid_exists` was never `null` and there is no `claude agents` to ask.
