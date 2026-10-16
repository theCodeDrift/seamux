# Slash commands

Which slash commands a chat offers, for the board's own command picker, and what the slash menu does to a prompt box. Individual commands have their findings where they matter: [`/clear`](session-state.md#clear-keeps-the-process-and-changes-the-session-id), [`/rename`](names.md#rename-works-mid-turn-and-a-closed-chat-can-be-renamed-through-its-transcript), [`/exit`](dialogs.md#other-dialogs-are-waitingfor-dialog-open-and-a-digit-picks-and-confirms), and a typed slash command [running on Enter even with the menu open](prompt-box.md#a-long-paste-folds-into-a-placeholder-even-on-one-line-and-the-model-gets-it-as-pasted-content).

## cmux can read Claude Code's slash menu, but it is no source for a list

Typing `/` into a surface and calling `read-screen` shows the menu as text, a command and its description per row, filtered as more is typed. It shows about five rows at a time, the selected one is marked only by colour, and paging it means typing into the session's own prompt box. Esc closes the menu but leaves the `/`, so a paste after it went in as `//exit` and ran a turn.

- **Measured:** Claude Code 2.1.282.
- **See also:** [A headless session lists its slash commands when asked to initialize](#a-headless-session-lists-its-slash-commands-when-asked-to-initialize), what seamux does instead, and [Ctrl+E, Ctrl+U and Backspace empty a prompt box](prompt-box.md#ctrle-ctrlu-and-backspace-empty-a-prompt-box-a-line-at-a-time-in-claude-code-and-codex-alike), which clears a stray `/`.

## A skill named after other text in a prompt is called by the model

A slash command runs as one only at the very start of a prompt. Sent after a few lines of other text, `/probe daily` was logged as a plain user message, with no `<command-message>`, and the model called the Skill tool for `probe` itself, with `daily` as its arguments. A built-in command, which is no skill, gets no such help.

- **Measured:** Claude Code 2.1.295, launched with the prompt as its argument, in a throwaway workspace with a test skill.
- **In seamux:** the New session macro's default in [config.ts](../app/lib/config.ts), which puts Session information ahead of the prompt.
- **See also:** [A prompt command is logged as tags](transcripts.md#a-prompt-command-is-logged-as-tags-its-name-before-or-after-by-kind).

## A headless session lists its slash commands when asked to initialize

`claude -p --input-format stream-json --output-format stream-json --verbose --no-session-persistence`, sent `{"type":"control_request","request_id":"…","request":{"subtype":"initialize"}}` on stdin, answers with a `control_response` whose `response.response.commands` lists every command, each with `name`, `description` and `argumentHint`, in half a second to a second and a half; closing stdin then runs no turn. It covers built-ins, skills and MCP prompts for that folder, but not the terminal-only commands (`/add-dir`, `/artifacts` and others), and plugin skills can lose their prefix (`docs`, where the transcript's `skill_listing` says `anthropic-skills:docs`). Claude Code 2.1.282 printed the same list unasked, as a first line `{"type":"system","subtype":"commands_changed","commands":[...]}`, in about two seconds. 2.1.301 prints nothing before a prompt, so the board waited out its 20-second limit and offered no commands at all.

While it runs, `claude agents` lists the headless session as `kind: "interactive"`, `status: "idle"`, with a generated name and no sign it isn't a chat. The board showed each one as an idle card, "Not in a cmux surface", from the moment a `/` was typed into a reply box until the listing ended.

- **Measured:** the unasked line on Claude Code 2.1.282; the `initialize` answer and the `claude agents` row on 2.1.301.
- **In seamux:** [commands.server.ts](../app/lib/commands.server.ts), which sends `initialize`, still reads the old line, caches the list per folder and keeps the pids it runs, which `listAgents` in [board.server.ts](../app/lib/board.server.ts) leaves out; the fake's headless session in [tests/bin/claude](../tests/bin/claude) and [tests/commands.test.ts](../tests/commands.test.ts).
