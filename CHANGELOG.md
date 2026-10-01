# seamux

## 0.2.2

### Patch Changes

- 5bf48ae: When seamux can't reach cmux, the board now says why and how to fix it on a full-page notice, instead of two warnings and a failed send each time: seamux started outside cmux, cmux not running or not installed, cmux's socket turned off, or a socket password it doesn't have. seamux also finds the `cmux` command in cmux's app bundle when it isn't on your `PATH`.
- b98f750: Two messages sent to the same chat at once now arrive in the order they were sent, where before either could go first.
- 5671185: Cards have a minimize button between pin and close: it folds the card down to its name and buttons, and the restore button in its place opens it back up. The browser remembers which cards are minimized.
- c200c43: Two things typed into the same chat at once, such as a queued message going out while you send one, no longer interleave their keys: the board types into a chat one action at a time.
- 7a78b4a: A chat whose pid cmux has lost track of is no longer shown as "Not in a cmux surface": seamux asks Claude Code whether it's still running, so you can reply to it and stop it from the board again.
- b98f750: Chats that stop on a failed request, such as "Can't reach the API server", "529 Overloaded" or "Your computer went to sleep mid-response", now pick themselves back up. The board checks every 10 seconds whether the API answers, and once it does, sends each such chat `continue`: 30 seconds after the error, then 60 and 120 seconds after each one that follows, then leaves it to you. ATTENTION no longer shows a card for these errors; the chat's own card shows the error muted in place of a reply. ATTENTION's card also keeps the service's name in view beside a long status.
- 984a9b8: Before typing a message, `/exit` or `/rename` into a Claude Code or Codex chat, the board now empties its prompt box, so a draft left there is no longer sent along with the message, and a box in shell mode (led by `!`) no longer runs it as shell commands or keeps a close from going through. Claude Code keeps what was cleared: press Ctrl+Y in the chat to get it back.
- f561f8b: The board through the Cloudflare tunnel no longer gets stuck on an old stylesheet after an update, which left it without colours: everything the board answers through the tunnel tells Cloudflare not to cache it, and the dev server's stylesheet gets a new URL each time it starts. If the board through the tunnel still looks unstyled after updating, purge the hostname's cache in the Cloudflare dashboard once.

## 0.2.1

### Patch Changes

- 8e035e7: A message holding an invisible character, such as a zero-width space or soft hyphen that came in with pasted text, now gets sent. Claude Code strips the character and waits for a second Enter, which seamux didn't notice, so the message sat in the chat's prompt box under "Removed 1 invisible character". seamux now presses that Enter.
- 2c9d99a: A long message sent to a Claude Code chat now arrives whole and gets sent. Before, Claude Code 2.1.285 could take one for a paste, drop parts of it, and miss the Enter, which left the message sitting unsent in the chat's prompt box while the board showed nothing sent. seamux now types it a little at a time, with Shift+Enter between lines instead of pasting, and, if the message is still in the box, types a carriage return to send it, since a chat can ignore cmux's Enter or take it as a line break. If it still won't go, the board says so, and a queued message isn't typed a second time.

## 0.2.0

### Minor Changes

- d38d8b1: The first public release. seamux installs from npm and runs as a compiled board with `npx seamux`, keeping its settings and state in `~/.seamux` (or `SEAMUX_HOME`). The first run installs the subagent hooks and the dispatch skill, and later runs keep them up to date; `npx seamux uninstall` removes them, and keeps the board from starting until `npx seamux setup`. It finds `claude`, cmux and your shell wherever they're installed, and the header shows the version you run.

  - The dispatch bar can start work in any directory, and its picker finds repos under the usual code folders (`~/code`, `~/Developer`, `~/projects`, `~/src` and a few more), not only `~/code`. Fan-out manifests take a `cwd` starting with `~/`.
  - New sessions start in your own login shell (`$SHELL`) rather than always zsh, so they get the same PATH and tools a terminal does.
  - Debug → **Blur cards for screenshots** blurs what each chat says and where it runs, for sharing a screenshot or attaching one to a bug report.
  - The Remote tab names the `.env` it reads, wherever seamux keeps it.

- 9535956: seamux talks to cmux's control socket itself instead of through the `cmux` command, which it still needs on your PATH for `cmux sessions list`. Run from a cmux terminal, as the board usually is, it uses the access cmux gives that terminal and there is nothing to do. If you've turned on cmux's socket password, set `CMUX_SOCKET_PASSWORD` in seamux's `.env` or environment: seamux no longer picks up the password saved in cmux's Settings.
- 635e97c: The board now runs in one of three modes: local, mDNS or the Cloudflare tunnel, never mDNS and the tunnel together. Turning one on in the Remote tab turns the other off, and a `.seamux.json` with both on keeps the tunnel. In local and tunnel mode the board answers only requests from this Mac addressed to `localhost`, `127.0.0.1` or `[::1]`, plus the tunnel's hostname in tunnel mode, so reaching it by any other name or IP address is refused. Whenever `SEAMUX_USER` and `SEAMUX_PASS` are set, every request asks for them, from this Mac too and for every file the dev server serves, which closes a gap where files under seamux's home, such as `data/seamux.db`, could be read on localhost without them. Only requests through the tunnel skip them, since Cloudflare Access logs those in. Without credentials the board no longer turns red or calls itself "seamux (unsecured)", since it then answers only this Mac.

### Patch Changes

- d4b075d: In the dispatch bar, a Tab in the directory field that settles on one directory (the only match, or the one picked with the arrow keys) now puts the cursor back in the prompt, so you can keep typing.
- ff0e3c9: The board loads on a Mac where Claude Code has never run, and on one with only Codex installed. Before, a missing `~/.claude/projects` or `claude` command took the whole board down with an error page.
- 7029fc4: Queued messages now go when a chat's reply ends on a question. Before, a turn that ended by asking something, such as "Want me to also…?", put the chat in Waiting and held its queue until you typed into it yourself. The queue still holds while a permission prompt or other dialog is open.
- ba2f0b6: The chat view now shows commands run with `!` and what they printed. One still running says so, since its output only reaches the terminal until it finishes, and one Claude Code moved to the background after its two minutes shows what it has written so far, such as a login's URL and code, where before the view showed nothing at all.
