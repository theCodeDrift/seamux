# Launching

Starting a chat in a new cmux workspace: dispatching, forking and resuming all come down to `workspace.create` with a command to run. What that command runs in, and what stops it before the chat is ready, are on this page.

## `workspace.create` ignores `command`

The field is `initial_command`, run through `zsh -lc`.

- **Measured:** not recorded.
- **In seamux:** `launch` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [A workspace closes itself when its `initial_command` exits](cmux.md#a-workspace-closes-itself-when-its-initial_command-exits).

## That login shell does not read `~/.zshrc`

So neither `claude` nor `node` is on its `PATH`, and nor is anything else `~/.zshrc` sets up, such as pnpm's `npx`. seamux wraps the launch in `exec zsh -ic`, which reads it and runs fine on cmux's tty, then launches through cmux's own `cmux-claude-wrapper`, which also registers the session with cmux, with `~/.local/bin` and the server's Node directory prepended. Launching `claude` directly starts a session cmux never learns about, which the board then cannot drive.

- **Measured:** cmux 0.64.23.
- **In seamux:** `launch` in [drive.server.ts](../app/lib/drive.server.ts), `BIN_DIRS` in [bins.server.ts](../app/lib/bins.server.ts), and each harness's `wrapper` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [Codex is not on the launch shell's `PATH` either](codex.md#codex-is-not-on-the-launch-shells-path-either), [cmux's wrapper passes `claude` subcommands straight through](background-sessions.md#cmuxs-wrapper-passes-claude-subcommands-straight-through), [cmux registers an OpenCode session launched without a wrapper](opencode.md#cmux-registers-an-opencode-session-launched-without-a-wrapper), through its plugin.

## A new folder stops on a trust dialog that nothing reports

Before Claude Code starts, it asks whether the folder is trusted: no `claude agents` row, no transcript, cmux sees no input needed. Its default is "No, exit". Choosing a folder to dispatch into is that decision, so every launch watches the new surface for the dialog and answers yes.

- **Measured:** not recorded.
- **In seamux:** `acceptTrust` in [macros.server.ts](../app/lib/macros.server.ts), started from `launch` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [Codex's trust dialog defaults to yes](codex.md#the-trust-dialog-defaults-to-yes), [Dialogs](dialogs.md), [OpenCode asks nothing in a new folder](opencode.md#a-new-folder-asks-nothing).

Resuming has a launch finding of its own: [A resumed chat is invisible for a few seconds](session-state.md#a-resumed-chat-is-invisible-for-a-few-seconds).
