# seamux

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
