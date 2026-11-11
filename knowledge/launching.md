# Launching

Starting a chat in a new cmux workspace: dispatching, forking and resuming all come down to `workspace.create` with a command to run. What that command runs in, and what stops it before the chat is ready, are on this page.

## `workspace.create` ignores `command`

The field is `initial_command`, run through `zsh -lc`.

- **Measured:** not recorded.
- **In seamux:** `launch` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [A workspace closes itself when its `initial_command` exits](cmux.md#a-workspace-closes-itself-when-its-initial_command-exits).

## An unfocused `workspace.create` without `initial_command` doesn't start until it gets input

Until then `surface.health` says `render_health: not_started`, `surface.read_text` answers `internal_error: Failed to read terminal text`, `terminal.replay` succeeds with no `render_grid` in its reply, and it stayed that way for as long as anyone waited, here over a minute. `surface.send_text` of an empty string didn't start it. Ctrl+U (`\x15`) did, answered `queued: true`, and left a prompt with nothing on its line, readable 0.16 s later; `surface.send_key` `enter` did too, with a blank line above the prompt. `surface.health` said `not_started` even after the shell was up and answering, so it is no test for this. Once started it is the user's own interactive zsh in the given `cwd`, with `~/.zshrc` read and `claude` defined as cmux's wrapper function, and `exit` closes its workspace. `initial_command: "exec /bin/zsh -il"` also starts one, but `claude` is then a plain command, without cmux's wrapper function. cmux reports no session for either.

- **Measured:** cmux 0.64.23, on throwaway workspaces.
- **In seamux:** `start` and `readTerminal` in [terminal.server.ts](../app/lib/terminal.server.ts); `unstarted` in [tests/fake-cmux.ts](../tests/fake-cmux.ts) and the contract in [tests-cmux/contract.test.ts](../tests-cmux/contract.test.ts).
- **See also:** [A closed workspace answers every surface call `not_found`](cmux.md#a-closed-workspace-answers-every-surface-call-not_found).

## That login shell does not read `~/.zshrc`

So neither `claude` nor `node` is on its `PATH`, and nor is anything else `~/.zshrc` sets up, such as pnpm's `npx`. seamux wraps the launch in `zsh -ic` (the user's own shell, run from `/bin/sh` so a failed start keeps its terminal: [below](#claude-code-exits-0-when-the-user-quits-and-1-when-the-trust-dialog-is-refused)), which reads it and runs fine on cmux's tty, then launches through cmux's own `cmux-claude-wrapper`, which also registers the session with cmux, with `~/.local/bin` and the server's Node directory prepended. Launching `claude` directly starts a session cmux never learns about, which the board then cannot drive.

- **Measured:** cmux 0.64.23.
- **In seamux:** `launch` in [drive.server.ts](../app/lib/drive.server.ts), `BIN_DIRS` in [bins.server.ts](../app/lib/bins.server.ts), and each harness's `wrapper` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [Codex is not on the launch shell's `PATH` either](codex.md#codex-is-not-on-the-launch-shells-path-either), [cmux's wrapper passes `claude` subcommands straight through](background-sessions.md#cmuxs-wrapper-passes-claude-subcommands-straight-through), [cmux registers an OpenCode session launched without a wrapper](opencode.md#cmux-registers-an-opencode-session-launched-without-a-wrapper), through its plugin.

## A new folder stops on a trust dialog that nothing reports

Before Claude Code starts, it asks whether the folder is trusted: no `claude agents` row, no transcript, cmux sees no input needed. Its default is "No, exit". Choosing a folder to dispatch into is that decision, so every launch watches the new surface for the dialog and answers yes.

Its rows are unnumbered, No first, and `down` then `enter` accepts.

- **Measured:** Claude Code 2.1.289, cmux 0.64.23.
- **In seamux:** `acceptTrust` in [macros.server.ts](../app/lib/macros.server.ts), started from `launch` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [Codex's trust dialog defaults to yes](codex.md#the-trust-dialog-defaults-to-yes), [Dialogs](dialogs.md), [A tool's own confirmation numbers nothing](dialogs.md#a-tools-own-confirmation-numbers-nothing-puts-no-first-and-ignores-digits), [OpenCode asks nothing in a new folder](opencode.md#a-new-folder-asks-nothing).

## Claude Code exits 0 when the user quits, and 1 when the trust dialog is refused

`/exit` and a double Ctrl+C both end `claude` with status 0. Choosing "No, exit" on the trust dialog ends it with 1, and leaves the dialog on the screen. A chat that dies while starting leaves nothing anywhere else: no transcript, no `claude agents` row, no cmux record, only a per-session scratch directory under `/tmp/claude-<uid>/`, and with `initial_command` its workspace closes with it, taking whatever it printed. So seamux runs the agent under `/bin/sh`, which waits for it, and when it exits with an error, or with any status within 15 seconds of starting, prints `seamux: <agent> exited with status N after Ns.` and runs the user's shell there instead of letting the workspace close. A clean `/exit` later on still closes the workspace. The board reads that line off the screen to report the chat as failed to start.

- **Measured:** Claude Code 2.1.322, cmux 0.64.23, in throwaway workspaces: `/exit`, Ctrl+C twice, the trust dialog refused, each under `/bin/sh -c 'claude; echo EXIT=$?'`, then the launch command itself, refused (kept open, the line under the dialog) and `/exit`ed after 15 seconds (closed).
- **In seamux:** `launchCommand` and `failedStarts` in [launches.server.ts](../app/lib/launches.server.ts), `sessionIn` and `listLive` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [A workspace closes itself when its `initial_command` exits](cmux.md#a-workspace-closes-itself-when-its-initial_command-exits).

Resuming has a launch finding of its own: [A resumed chat is invisible for a few seconds](session-state.md#a-resumed-chat-is-invisible-for-a-few-seconds).
