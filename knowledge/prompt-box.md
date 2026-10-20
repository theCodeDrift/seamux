# The prompt box

Getting a message into a chat and sent, exactly as written. seamux types through cmux (`surface.send_text`, `surface.send_key` and `terminal.paste`), and Claude Code and Codex each decide for themselves what is a keypress, a paste, a line break or a submit. Most of what seamux knows the hard way is on this page.

In seamux every keystroke goes through a `Session` primitive in [harness.server.ts](../app/lib/harness.server.ts) (`clearInput`, `write`, `submit`, `type`, `paste`, `press`, `keys`), each harness says how it takes a message in its `Harness` entry there, and [macros.server.ts](../app/lib/macros.server.ts) builds the verbs from them. A fix to how a chat takes input belongs in one of those two files, never in a verb.

## Typed input that comes too fast is taken for a paste, and mangled

Claude Code 2.1.282 kept long `surface.send_text` input as typed. 2.1.285 treats typed input faster than about ten characters a millisecond as a paste: it shows "paste again to expand", keeps roughly the first 460 characters, and drops or reorders the rest, with or without a pause before the Enter. A 1,503-character message arrived as 481 characters; typed into a raw-mode reader instead of Claude Code, the same 3,003 characters arrived intact, so cmux isn't what drops them. 100 characters every 10 ms, or 200 every 20 ms, arrived intact up to 12,000 characters and unwrapped, also while a turn was running; 200 every 10 ms, or 400 every 20 ms, did not.

- **Measured:** Claude Code 2.1.285, cmux 0.64.23.
- **In seamux:** `TYPE_CHUNK` and `TYPE_GAP_MS`, used by `type`, in [harness.server.ts](../app/lib/harness.server.ts): 100 characters every 20 ms.
- **See also:** [A long paste folds into a placeholder](#a-long-paste-folds-into-a-placeholder-even-on-one-line-and-the-model-gets-it-as-pasted-content), [Codex folds long typed input](#codex-folds-long-typed-input-and-shows-a-paste-in-full), [Type into a raw-mode reader](measuring.md#type-into-a-raw-mode-reader).

## A long paste folds into a placeholder, even on one line, and the model gets it as pasted content

Claude Code shows a long paste as `[Pasted text #1]`, whether or not it holds a newline, and from about 1,000 characters the transcript, and so the model, gets it wrapped in `<pasted_content id="…">` tags; a 756-character paste arrived bare. A typed slash command still runs on Enter, even with the slash menu open.

- **Measured:** Claude Code 2.1.282 and 2.1.285.
- **In seamux:** Claude Code's `typesMessages: true` in [harness.server.ts](../app/lib/harness.server.ts), so a message is typed rather than pasted; [transcript.server.ts](../app/lib/transcript.server.ts) strips the tags from a message the board shows.
- **See also:** [Transcripts](transcripts.md), [Slash commands](slash-commands.md).

## An Enter that comes while Claude Code is still taking in a paste is lost

Sent straight after a burst of about 7,000 characters, typed or pasted, the Enter did nothing and the message stayed in the prompt box, unsent; one more Enter sometimes wasn't enough either. The prompt box is the lines between the last two rules on the screen, the first led by `❯`.

- **Measured:** Claude Code 2.1.285.
- **In seamux:** `submit`, `endsPromptBox` and `readPromptBox` in [harness.server.ts](../app/lib/harness.server.ts): after the Enter, seamux reads the box and tries again while the message is still in it, then gives up with `UnsentError`.
- **See also:** [A chat that has fallen behind](#a-chat-that-has-fallen-behind-shows-a-message-seconds-late-and-its-box-reads-empty-meanwhile), [A chat can ignore cmux's Enter](#a-chat-can-ignore-cmuxs-enter-while-a-lone-typed-carriage-return-sends).

## A chat that has fallen behind shows a message seconds late, and its box reads empty meanwhile

Two long-running chats were each left with a reply in the prompt box, unsent, while the board reported it sent: `submit` read the box 300 ms after its Enter, still empty, and took that for sent. The Enter had been lost, and the message showed up in the box afterwards. A chat a few seconds old does the same: a message typed into it showed in the box 0.2 to 4.2 seconds after the last key, against about 55 ms in a chat that had settled. An Enter sent once the box showed the message could still go unanswered for seconds, or be ignored outright, and a send-key Enter some seconds later sent it. Within its first ten or so seconds, such a chat also ignored the keys that empty the box, and took two Enters as line breaks, so three messages typed a few seconds apart went as one. A chat that had settled took six messages in a row, each sent as soon as the turn before ended, with about 570 ms from the first key to the box emptying, and did the same with every core of the Mac busy.

- **Measured:** Claude Code 2.1.294, cmux 0.64.23.
- **In seamux:** `submit` in [harness.server.ts](../app/lib/harness.server.ts) waits up to `SHOWN_WAIT_MS` for the box to show the message before its Enter, and each try then waits up to `SENT_WAIT_MS` for the box to empty, so a chat that is behind gets its Enter once it has caught up, and an Enter that is lost ends in `UnsentError` rather than passing for sent.
- **See also:** [An Enter that comes while Claude Code is still taking in a paste is lost](#an-enter-that-comes-while-claude-code-is-still-taking-in-a-paste-is-lost).

## A lone invisible character holds a message for a second Enter

Given a zero-width space, joiner or non-joiner, word joiner, byte-order mark, soft hyphen, direction mark or override, tag character, combining grapheme joiner, Hangul filler, Mongolian vowel separator or a variation selector outside an emoji, Claude Code strips it from the prompt box on Enter, shows "Removed 1 invisible character · review and press Enter to send" above the box, and sends nothing; the next Enter sends the stripped text. A joiner or variation selector inside an emoji is kept and goes on the first Enter, and so does a no-break space.

- **Measured:** Claude Code 2.1.285.
- **In seamux:** `UNSEEN` in [harness.server.ts](../app/lib/harness.server.ts) leaves invisible characters out when checking the box, and `submit` sends the second Enter.

## A chat once took cmux's Enter as a line break while a real Enter sent

A message sat in a long-running Claude Code chat's prompt box; `send_key` `enter` added an empty line under it instead of sending, and the user's own Enter on the keyboard a few minutes later sent it. It didn't reproduce in a fresh chat, even after bursts of up to 20,000 characters. Typed as text, `\r`, `\n` and `\r\n` each send a message once in a working chat, the `\n` of `\r\n` landing in the emptied box.

- **Measured:** Claude Code 2.1.285, cmux 0.64.23.
- **In seamux:** `submit` in [harness.server.ts](../app/lib/harness.server.ts) retries with a typed `\r`.
- **See also:** [`surface.send_key` encodes a key the way a keypress would be](cmux.md#surfacesend_key-encodes-a-key-the-way-a-keypress-would-be-and-the-cmux-command-goes-through-the-socket-too).

## A chat can ignore cmux's Enter while a lone typed carriage return sends

A message sat in a long-running Claude Code chat's prompt box; `send_key` `enter` changed nothing but a hint, "Image in clipboard · ctrl+v to paste", and a typed `\r\n` added a line break under the message, the pair taken for a paste. `send_text` with `\r` alone sent it. A fresh chat with the same name, mode and message sent on the first Enter.

- **Measured:** Claude Code 2.1.285, cmux 0.64.23.
- **In seamux:** `submit` in [harness.server.ts](../app/lib/harness.server.ts): each retry is a carriage return typed on its own.
- **See also:** [A chat once took cmux's Enter as a line break](#a-chat-once-took-cmuxs-enter-as-a-line-break-while-a-real-enter-sent).

## Shift+Enter is a line break in Claude Code's prompt box, and a typed one is not

`surface.send_key` with `shift+enter` between two typed lines leaves both in the box; a typed `\n` submits each line as its own message, and `ctrl+j` does nothing.

- **Measured:** Claude Code 2.1.285, cmux 0.64.23.
- **In seamux:** `write` in [harness.server.ts](../app/lib/harness.server.ts) presses `shift+enter` between lines.
- **See also:** [`surface.send_key` encodes a key the way a keypress would be](cmux.md#surfacesend_key-encodes-a-key-the-way-a-keypress-would-be-and-the-cmux-command-goes-through-the-socket-too), [Shift+Enter, Alt+Enter and Ctrl+Enter are line breaks in OpenCode](#shiftenter-altenter-and-ctrlenter-are-line-breaks-in-opencode-and-ctrlj-is-not).

## A prompt box in shell mode runs what it holds as shell commands

Typing `!` first in Claude Code's prompt box puts it in shell mode: the box is led by `!` instead of `❯`, even empty, where it shows the same `Try "…"` placeholder, and "! for shell mode" shows under it. Text typed after that, with Shift+Enter between lines, goes into the same box, and Enter runs every line as a shell command. A chat left with a `!` draft in its box took the close-session macro and `/exit` onto the end of the draft, sent nothing, and never closed.

- **Measured:** Claude Code 2.1.286, cmux 0.64.23.
- **In seamux:** `inputLead` in each `Harness`, and `clearInput` in [harness.server.ts](../app/lib/harness.server.ts), which refuses to type into a box still in shell mode.
- **See also:** [Ctrl+E, Ctrl+U and Backspace empty a prompt box](#ctrle-ctrlu-and-backspace-empty-a-prompt-box-a-line-at-a-time-in-claude-code-and-codex-alike), [A `!` command moves to the background after 120 seconds](transcripts.md#a--command-moves-to-the-background-after-120-seconds-and-its-output-leaves-the-transcript).

## A suggested next prompt reads as a draft on the screen, and only its faint style and the cursor tell it apart

After a turn, Claude Code can fill an empty prompt box with a suggestion of what to send next, such as `go ahead with 1-3` after a reply asking "Should I go ahead with 1–3?". It doesn't come after every turn. `surface.read_text` gives it as plain text after `❯ `, exactly as if it had been typed, and it once passed for a reply the user had typed and not sent. `terminal.replay` tells the two apart. Its `render_grid` has `row_spans`, each with a `style_id` into `styles`, and a `cursor`. The suggestion's span is `faint: true`, and the cursor stays at column 2, just after `❯ `. Typed text has `faint: false`, and the cursor sits after it. Typing anything clears the suggestion, even a prefix of it. Nothing in the transcript records it.

The empty box's placeholder, `Try "…"`, is faint too.

- **Measured:** Claude Code 2.1.289, cmux 0.64.23; the placeholder on Claude Code 2.1.294.
- **In seamux:** `promptBoxDraft` in [harness.server.ts](../app/lib/harness.server.ts) leaves faint text out of a draft. `submit` reads the box through `surface.read_text`, right after Enter, while the turn runs and no suggestion shows.
- **See also:** [A message unsent in the prompt box](#a-message-unsent-in-the-prompt-box-reads-back-from-the-screen-with-its-line-breaks), [A prompt box in shell mode runs what it holds](#a-prompt-box-in-shell-mode-runs-what-it-holds-as-shell-commands).

## A message unsent in the prompt box reads back from the screen, with its line breaks

A row of Claude Code's box is the terminal's width less 2 cells, its first two cells `❯ ` or two spaces. Claude Code wraps a draft at words, and breaks a word longer than a row where the row is full, so a row that ends short of the width with room for the next row's first word was ended by a typed line break, and a blank row is a blank line. Read that way off `terminal.replay`, two replies left unsent in long-running chats came back exactly as typed, blank line and all, and so did a 300-character word and a two-line draft in a fresh one. Moving a draft out of the box is Ctrl+E, Ctrl+U and Backspace, as for any draft, and sending it as it stands is Enter alone.

- **Measured:** Claude Code 2.1.294, cmux 0.64.23.
- **In seamux:** `promptBoxDraft` in [harness.server.ts](../app/lib/harness.server.ts), read by `readDraft` in [drive.server.ts](../app/lib/drive.server.ts) for each chat at rest into its card's `unsentDraft`; `sendDraft` and `takeDraft` in [macros.server.ts](../app/lib/macros.server.ts), each only while the box still holds the draft the card showed.
- **See also:** [`terminal.replay` draws the screen as runs of styled text](cmux.md#terminalreplay-draws-the-screen-as-runs-of-styled-text-where-surfaceread_text-has-only-the-text), [A chat that has fallen behind](#a-chat-that-has-fallen-behind-shows-a-message-seconds-late-and-its-box-reads-empty-meanwhile).

## Ctrl+E, Ctrl+U and Backspace empty a prompt box a line at a time, in Claude Code and Codex alike

Each typed on its own: Ctrl+E goes to the end of the line, Ctrl+U deletes back to its start, Backspace joins the empty line to the one above, and in an empty box in shell mode leaves it. Sent in one `send_text`, the three did less. None of them stops a running turn, where Esc and Ctrl+C do, and Ctrl+C on an idle chat also shows "Press Ctrl-C again to exit". `send_key` `ctrl+u` did nothing in Claude Code; the typed `\x15` works. Claude Code then shows "Ctrl+Y to paste deleted text". Up on the first line recalls history, so the cursor can't be moved to the end of the box that way. OpenCode's box empties the same way: `clearInput`'s three bytes, typed, emptied four lines in four rounds, where `send_key` `ctrl+u` and `ctrl+c` left them. So does Cursor's, a line a round, and an empty one in shell mode left it in one.

- **Measured:** Claude Code 2.1.286, Codex 0.156.1, cmux 0.64.23; OpenCode 1.18.34, cmux 0.64.25; Cursor Agent 2026.10.18, cmux 0.64.23.
- **In seamux:** `CLEAR_KEYS` and `clearInput` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [A prompt box in shell mode](#a-prompt-box-in-shell-mode-runs-what-it-holds-as-shell-commands).

## Codex folds long typed input, and shows a paste in full

Codex is the other way round from Claude Code. It folds long *typed* input into `[Pasted Content N chars]`, from what looks like its own burst detection, but shows a `terminal.paste` in full, and a paste submits itself without an Enter, even across lines.

- **Measured:** Codex 0.156.1.
- **In seamux:** Codex's `typesMessages: false` in [harness.server.ts](../app/lib/harness.server.ts).
- **See also:** [`terminal.paste` ends a paste with a carriage return of its own](cmux.md#terminalpaste-ends-a-paste-with-a-carriage-return-of-its-own), the Enter that submits it. [Typed input that comes too fast is taken for a paste](#typed-input-that-comes-too-fast-is-taken-for-a-paste-and-mangled), [Codex](codex.md), [OpenCode keeps a pasted message whole and submits it](#opencode-keeps-a-pasted-message-whole-and-submits-it-as-codex-does), the same way.

## OpenCode keeps a pasted message whole and submits it, as Codex does

`terminal.paste` of three lines, with no Enter after it, started a turn: OpenCode stored the message with its `\n`s and a trailing space, and showed all three lines. Forty lines, 607 characters, arrived and showed in full, with no placeholder. Typed, the same text loses its line breaks: `cmux send` of `first line\nsecond line` sent the prompt as `first linesecond line`, also with no Enter. So a message for OpenCode wants pasting, as Codex's does.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [`terminal.paste` ends a paste with a carriage return of its own](cmux.md#terminalpaste-ends-a-paste-with-a-carriage-return-of-its-own), the Enter that submits it. [Codex folds long typed input, and shows a paste in full](#codex-folds-long-typed-input-and-shows-a-paste-in-full), [A long paste folds into a placeholder](#a-long-paste-folds-into-a-placeholder-even-on-one-line-and-the-model-gets-it-as-pasted-content) in Claude Code, [OpenCode](opencode.md).

## Shift+Enter, Alt+Enter and Ctrl+Enter are line breaks in OpenCode, and Ctrl+J is not

Between two typed words, `surface.send_key` with `shift+enter`, `alt+enter` or `ctrl+enter` left a line break in OpenCode's prompt box, and `ctrl+j` left nothing, as in Claude Code. The [keybinds docs](https://opencode.ai/docs/keybinds/) give `input_newline` as all four. A paste keeps line breaks without any of them.

- **Measured:** OpenCode 1.18.34, cmux 0.64.25.
- **See also:** [Shift+Enter is a line break in Claude Code's prompt box](#shiftenter-is-a-line-break-in-claude-codes-prompt-box-and-a-typed-one-is-not), [OpenCode keeps a pasted message whole](#opencode-keeps-a-pasted-message-whole-and-submits-it-as-codex-does).

## A path in a prompt is only text, and reading it outside the folder needs an approval

Typed with `surface.send_text`, `[Image #1: /tmp/…/a.png]` stays as written: Claude Code doesn't turn it into an attachment of its own. Claude reads the file with Read, but in manual mode a file outside the chat's folder opens a permission prompt first, offering to allow the whole directory for the session.

- **Measured:** Claude Code 2.1.283.
- **In seamux:** [attachments.ts](../app/lib/attachments.ts) and [attachments.server.ts](../app/lib/attachments.server.ts).
- **See also:** [Codex won't open a bare path it's handed](#codex-wont-open-a-bare-path-its-handed), [A permission prompt's "No" has no fixed number](dialogs.md#a-permission-prompts-no-has-no-fixed-number).

## Codex won't open a bare path it's handed

Pasted `[Image #1: /tmp/…/a.png]`, and even `[Image #1, attached as the local file …]`, Codex answered "I can't access the image from that path here" without trying. Told to `open it with your image viewing tool`, it called its image viewer at once; `open it from disk` worked for a text file. A paste of the path isn't made into an attachment either.

- **Measured:** Codex 0.157.1.
- **In seamux:** `sentAttachment` in [attachments.ts](../app/lib/attachments.ts).
- **See also:** [A path in a prompt is only text](#a-path-in-a-prompt-is-only-text-and-reading-it-outside-the-folder-needs-an-approval).
