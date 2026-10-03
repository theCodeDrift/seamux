# Codex

Codex is the second harness seamux drives, and it differs from [Claude Code](claude-code.md) almost everywhere: it has no `claude agents`, cmux's view of it goes stale, and it takes input the other way round. So everything a card says about a Codex session comes from its transcript. Measured against codex-cli 0.156.1 under cmux 0.64.23, launched through `cmux-codex-wrapper` with cmux's Codex hooks installed (`cmux hooks setup codex`), unless an entry says otherwise.

In seamux, Codex's reading is [codex.server.ts](../app/lib/codex.server.ts), and its driving is the `codex` entry in `HARNESSES` in [harness.server.ts](../app/lib/harness.server.ts). A new harness follows the same shape, and arrives measured: its findings get a page like this one before its engine is written ([CONTRIBUTING.md](../CONTRIBUTING.md)).

Codex entries that live in other domains:

- [Codex folds long typed input, and shows a paste in full](prompt-box.md#codex-folds-long-typed-input-and-shows-a-paste-in-full).
- [Ctrl+E, Ctrl+U and Backspace empty a prompt box](prompt-box.md#ctrle-ctrlu-and-backspace-empty-a-prompt-box-a-line-at-a-time-in-claude-code-and-codex-alike), in Codex too.
- [Codex won't open a bare path it's handed](prompt-box.md#codex-wont-open-a-bare-path-its-handed).
- [Codex names its own sessions after the first turn](names.md#codex-names-its-own-sessions-after-the-first-turn).
- [`codex login --device-auth` needs no input](signing-in.md#codex-login---device-auth-needs-no-input).

## Codex is not on the launch shell's `PATH` either

A pnpm-managed Node puts it in `~/Library/pnpm/nodejs/<version>/bin`, next to `node`; the server's Node directory covers it. Inside cmux, `codex` resolves to a per-launch shim in `$TMPDIR/cmux-cli-shims/`, which forwards to the wrapper.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `BIN_DIRS` in [bins.server.ts](../app/lib/bins.server.ts).
- **See also:** [That login shell does not read `~/.zshrc`](launching.md#that-login-shell-does-not-read-zshrc).

## The trust dialog defaults to yes

A new folder asks "Trust this folder?" with "1. Trust and continue" selected, so Enter accepts it. The decision is saved, and a resume in the same folder does not ask again.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** Codex's `trust` in [harness.server.ts](../app/lib/harness.server.ts), used by `acceptTrust` in [macros.server.ts](../app/lib/macros.server.ts).
- **See also:** [A new folder stops on a trust dialog that nothing reports](launching.md#a-new-folder-stops-on-a-trust-dialog-that-nothing-reports), Claude Code's, which defaults to no.

## A prompt given at launch waits for the trust dialog

`codex '<prompt>'` shows the dialog first and submits the prompt once it is accepted; cmux files the session under its surface about two seconds later. Codex has no `--session-id` or `--name`, so a dispatch waits for that record to learn the id.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `codexSessionIn` and `CODEX_FILED_MS` in [drive.server.ts](../app/lib/drive.server.ts).

## cmux knows a Codex session only after its first prompt

Before that there is no record in `~/.cmuxterm/codex-hook-sessions.json`. A resumed session keeps pointing at its old, closed surface until its next prompt, when it moves to the new one.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** [drive.server.ts](../app/lib/drive.server.ts) remembers where it resumed a Codex session until cmux catches up.
- **See also:** [A resumed chat is invisible for a few seconds](session-state.md#a-resumed-chat-is-invisible-for-a-few-seconds), [cmux knows an OpenCode session only after its first prompt](opencode.md#cmux-knows-an-opencode-session-only-after-its-first-prompt), where a resumed session also moves on its next prompt.

## `active_for_surface` stays `false` for a live Codex session

`active_surface_session_id` is `null` too. Filtering on it, as the Claude path does, drops every Codex session; `surface_id` with `stored_pid_exists` finds them.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `listLive` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [`active_for_surface` stays `false` for a live OpenCode session](opencode.md#active_for_surface-stays-false-for-a-live-opencode-session).

## cmux's lifecycle is unreliable for Codex

It goes `running` on a prompt and `idle` when a turn completes, but stays `running` while an approval dialog is open (never `needsInput`), after Esc interrupts a turn, and after `/quit` ends the process. The transcript is the signal: a turn is over at its `task_complete` or `turn_aborted` event.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `summarizeCodex` in [codex.server.ts](../app/lib/codex.server.ts).
- **See also:** [`status: busy` does not mean a turn is running](session-state.md#status-busy-does-not-mean-a-turn-is-running), Claude Code's version of the same lesson, and [cmux's lifecycle is unreliable for OpenCode](opencode.md#cmuxs-lifecycle-is-unreliable-for-opencode), OpenCode's.

## The record names the transcript

`transcript_path` points at `~/.codex/sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl`. Session ids are UUIDv7. Each line has a `type` and a `payload`: `session_meta` (cwd, version), `event_msg` of type `task_started` (with `model_context_window`), `item_completed` (the user's prompt), `token_count` (usage) and `task_complete` (with `last_agent_message`), and `response_item` for messages and tool calls. Reasoning is encrypted.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `indexCodexTranscripts`, `summarizeCodex` and `loadCodexMessages` in [codex.server.ts](../app/lib/codex.server.ts).
- **See also:** [Transcripts do not record the context window](transcripts.md#transcripts-do-not-record-the-context-window), which Codex's do, and [cmux has no transcript for OpenCode](opencode.md#cmux-has-no-transcript-for-opencode-whose-sessions-live-in-sqlite), whose record names none.

## An open approval is a tool call with no output

The screen shows "Would you like to run the following command?" with "1. Yes, proceed (y)", an always-allow, and "3. No, and tell Codex what to do differently (esc)". Typing `y` approves with no Enter.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `parseCodexApproval` in [codex.server.ts](../app/lib/codex.server.ts), `readCodexApproval` in [drive.server.ts](../app/lib/drive.server.ts), and Codex's `approveKey` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [A permission prompt's "No" has no fixed number](dialogs.md#a-permission-prompts-no-has-no-fixed-number), [A waiting permission prompt looks like a running tool call](opencode.md#a-waiting-permission-prompt-looks-like-a-running-tool-call) in OpenCode.

## Esc interrupts, `/quit` exits, and `codex resume <id>` resumes

The interrupt is logged as `turn_aborted` with `reason: interrupted`. `codex queue --thread <id> --message <text>` queues a message natively. `codex agents` is a TUI only, with no `--json`, so it cannot stand in for `claude agents`.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** Codex's `resumeArgs` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [Esc twice interrupts a turn](opencode.md#esc-twice-interrupts-a-turn) in OpenCode, [`/exit` ends OpenCode and leaves cmux's record](opencode.md#exit-ends-opencode-and-leaves-cmuxs-record), [`opencode -s <id>` resumes on the old surface until the next prompt](opencode.md#opencode--s-id-resumes-on-the-old-surface-until-the-next-prompt).

## `/exit` exits too, and the workspace closes a moment after cmux reports the session over

A `workspace.list` or `surface.list` in between can find the workspace gone, so closing a tab treats cmux's `not_found` as already closed.

- **Measured:** Codex 0.156.1, cmux 0.64.23.
- **In seamux:** `closeChat` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [A workspace closes itself when its `initial_command` exits](cmux.md#a-workspace-closes-itself-when-its-initial_command-exits).
