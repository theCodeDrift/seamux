# Getting started

This page covers installing seamux, running the board, and every setting it has. To reach the board from your phone or another computer, see [Remote connections](remote-connections.md).

## What you need

- **macOS** with [cmux](https://cmux.dev), in `/Applications` or `~/Applications` (or set `SEAMUX_CMUX_APP`), and its `cmux` command on your `PATH`. seamux drives sessions by typing into their cmux terminals, so a session outside cmux is shown but can't be driven.
- **Claude Code**, with `claude` on your `PATH` (`~/.local/bin` is where the installer puts it).
- **Codex**, optionally, installed with npm or pnpm (next to `node`) or Homebrew. Run `cmux hooks setup codex` once so cmux tracks its sessions.
- **Node 24** or later, for `node:sqlite`, and in a clone for running TypeScript directly.
- **A shell whose startup files set up your `PATH`.** Every session seamux starts runs in an interactive instance of your login shell (`$SHELL`), so it gets the same tools a terminal opened by hand does. zsh and bash are tested.

## Install and run

There are two ways to run seamux: the published package, which runs a compiled board, or a clone of this repo, which runs the dev server so a change goes live as soon as it's saved.

### From npm

```bash
npx seamux   # run the board on http://127.0.0.1:54321 and keep it running
```

The first run sets seamux up: it installs the subagent hooks and the dispatch skill, and says what it changed (see [What setup changes](#what-setup-changes-outside-seamux)). Later runs keep them up to date, quietly unless something changed.

seamux keeps its settings and state in `~/.seamux`: its `.env`, `.seamux.json`, and `data/`. Set `SEAMUX_HOME` to keep them somewhere else. It also keeps copies of the hook and the fan-out CLI in `~/.seamux/bin`, which sessions call, since npx's cache can be emptied at any time. Each start of the board refreshes them, so upgrading seamux upgrades them too.

### From a clone

```bash
npm install
npm run seamux   # set seamux up, then run the board on http://127.0.0.1:54321 and keep it running
```

A clone keeps its settings and state in the clone itself, all gitignored. `npm start` builds and runs the compiled board instead of the dev server, as the npm package does.

### Running the board

Run the board in its own cmux workspace. Started from any other terminal it can list your chats but not send them anything, since cmux only lets programs started inside it type into its terminals, unless its Settings, under Automation, set Socket Control Mode to Automation mode; the board then covers itself with what's wrong and how to fix it. It supervises the server: it restarts it if it exits or stops answering, and refuses to run twice.

When the board's page loads but none of its buttons work, its scripts never started in that browser. After ten seconds the page then shows **Buttons not working? Restart the board** at the bottom, a link to `/restart`. That page asks the supervisor to restart the board's server, clears the browser's cache for the board, and goes back to the board once the new server answers. Sessions keep running. It works from a phone over mDNS or the tunnel, as long as the browser is signed in to the board, and the error page links to it too.

The same command is `bin/seamux`, the package's `seamux` bin: in a clone, run `npm link` once and `seamux` starts the board from anywhere. With a command, such as `seamux list`, it's the fan-out CLI the README describes.

### What setup changes outside seamux

Starting the board, or `npx seamux setup`, writes to two places outside seamux's own directory, when they aren't already right. Both are safe to repeat and both can be undone:

- **`~/.claude/settings.json`** gets `SubagentStart` and `SubagentStop` hooks that run seamux's subagent hook, so the board can see subagents in every session. The file is backed up first.
- **`~/.claude/skills/seamux-dispatch/`** gets the fan-out skill, rendered with the path of the `seamux` command sessions call.

### Uninstall

```bash
npx seamux uninstall   # or, in a clone, bin/seamux uninstall
```

That takes seamux's hooks out of `~/.claude/settings.json`, and nothing else there, and removes the seamux-dispatch skill. It also remembers the uninstall: from then on the board won't start, and says to run `npx seamux setup` (or `bin/seamux setup`), which installs both again. To remove seamux entirely, delete `~/.seamux`, or the clone. Its `data/` holds seamux's store, fan-out records and logs, and nothing any session needs: your sessions and transcripts are Claude Code's and Codex's, and stay where they are.

## Set a password

Put `SEAMUX_USER` and `SEAMUX_PASS` in the `.env` in seamux's home (`~/.seamux/.env`, or at the root of a clone, where it's gitignored), or in the environment, and the board asks for them with HTTP Basic auth before serving anything:

```bash
SEAMUX_USER=you
SEAMUX_PASS=something-long
```

It reads them on every request, so a change to `.env` takes effect without a restart. Set, they're asked for by every request, from this Mac too, and for every file the board serves; only a request through the Cloudflare tunnel skips them, since Cloudflare Access logs it in. With either one unset the board answers only this Mac, and mDNS won't turn on.

## Settings

Most settings live in the board. Click the cog beside the seamux name.

### General

<!-- Screenshot: the General tab -->

- **Default agent**: what the dispatch bar starts new sessions with, Claude Code or Codex. An agent that isn't installed is greyed out. The dispatch bar has a picker to change it for one dispatch. Fan-out workers always run Claude Code, since they rely on its hooks and the dispatch skill.
- **Worktrees**: whether the dispatch bar's "new worktree" switch starts on.
- **Notifications**: desktop notifications when a chat starts waiting while the board isn't the focused window. Turning it on asks the browser for permission and then sends a test notification, "Desktop Notifications are Enabled", and the choice is kept in this browser rather than the store. Browsers only allow notifications on a secure origin, so the switch is greyed out on the plain-HTTP `.local` address.
- **Directories**: what the dispatch bar's directory picker offers. When this is empty, the picker lists directories with live sessions, past dispatches, and every git repo up to two levels under the usual code folders in your home directory (`~/code`, `~/Developer`, `~/projects`, `~/src` and a few more). Any directory can be added or dispatched into, inside your home directory or not. ↓ or the chevron opens the whole list, whatever is already in the field; typing narrows it. Tab completes a partly typed path as a shell does, from that list and from the directories on disk: all the way when only one directory fits, otherwise as far as every fitting directory agrees, then opens the list of them.

### Macros

<!-- Screenshot: the Macros tab -->

Macros are prompts seamux sends into a session for you. `{{name}}` variables are filled in when the prompt is sent.

| Macro | Sent | Variables |
| --- | --- | --- |
| Session information | Filled into the new session's `{{session_information}}` for every session seamux dispatches. It tells the session it runs inside seamux, its name and directory, and where to report a problem with seamux. When you clear a chat from the board, seamux sends `/clear`, pauses, then sends this again, with How to worktree when the chat is in a worktree. Leave it empty to say nothing | `name`, `cwd` |
| New session | Wrapped around the first prompt of every session seamux dispatches. Must contain `{{prompt}}`, and defaults to `{{session_information}}`, then `{{how_to_worktree}}`, then `# User prompt` and `{{prompt}}`. One without `{{session_information}}` gets it at the start. A prompt that is a skill, such as `/gtd daily`, still runs: the agent reads it after the macros and calls the skill itself | `prompt`, `cwd`, `session_information`, `how_to_worktree` |
| How to worktree | Filled into the new session's `{{how_to_worktree}}` whenever the session starts in a new worktree; empty otherwise. By default it has the session follow the repo's own worktree convention from its CLAUDE.md or AGENTS.md, or, when there is none, propose one to you before starting: worktrees under the directory seamux used and gitignored, each starting from the latest main unless told otherwise, dependencies installed in the worktree, all work done there. Once you agree, the session records it in the repo's agent instructions, so later sessions just follow it. A New session macro without `{{how_to_worktree}}` gets it at the end | `worktree`, `branch`, `repo`, `worktrees` |
| Close session | When you close an idle chat, before it exits. Defaults to a cleanup prompt asking the session to remove its own worktree. Leave it empty to exit straight away | `cwd`, `repo`, `siblings` |

`{{siblings}}` is a sentence naming the other live sessions under the same repo. Without it, a session can't know that another session is using the same repo.

The chat shows a macro it sent by its name, such as `✦ Close session ✦`, rather than its text, and a new session's first message as the names of its macros, then what you typed. A card's last prompt shows only what you typed. It recognises the macro by its text as set now, so one sent before you edited it shows in full.

### Themes

A theme repaints the board, on every browser that has it open. Pick one from the list on the left and this browser previews it until you leave the tab; no other board changes. **Make active**, beside Save, switches every open board to it at once. `seamux` is the built-in one.

**Add** starts a theme. Its name, lowercase letters, digits and dashes, is fixed once saved; its label is what the list shows. Each theme has a Light and a Dark variant, each JSON of token to value:

```json
{
  "--brand-primary": "#f5b301",
  "--brand-secondary": "#e0661b",
  "--radius": "0.5rem"
}
```

- A variant needs only `--brand-primary` and `--brand-secondary`. The board works out the rest of its palette from them: in light, a near-white ground tinted with the brand; in dark, a very dark one. Anything else you set replaces what was worked out.
- Leave a variant empty and it's made from the other's brand colours.
- Colours are hex, `rgb()`, `hsl()`, `oklch()`, `oklab()` or `transparent`; `--radius` is 0 to 4rem or 0 to 64px. Every colour token in `app/app.css` can be set except the two engine colours, Claude Code's and Codex's. Anything else is refused when you save, with where and why.
- Three tokens take an image: `--background-image`, behind the whole page; `--input-image`, behind every text box (the dispatch box, each card's reply line, and the chat's reply box); and `--watermark-image`, fitted into the bottom-right corner behind the board, smaller on a phone, as strong as `--watermark-opacity` (0 to 1 or 0% to 100%, 0.2 unless you set it). An image is a `data:` URL of a PNG, JPEG, WebP, GIF or SVG of at most 100 kB, base64 or percent-encoded; anything that would load from a server is refused. Each variant sets its own, so dark can use a different picture.
- Saving keeps the values as numbers, so the editor shows them back in a standard form: `oklch(56% 0.19 272)` comes back as `oklch(0.56 0.19 272)`.
- **Export**, under the `⋯`, saves a theme as `<name>.seamux-theme.json` to share. **Import**, below the list, opens one as a new theme for you to look over and save; tokens this seamux doesn't know, from a newer one, are left out and listed. A theme file is the theme's name, label and variants under `"seamux-theme": 1`.
- While you edit a theme, this browser shows the draft before you save it, in light or dark as the editor's tab says. **Revert** puts back what's saved.

**Allow POST /theme/set**, the switch below the editor, lets a script switch every board's theme, and light or dark with it. It can only be turned on from this Mac, and turns off from anywhere. It answers a JSON POST, never a GET or a form, from this Mac or over mDNS, with the board's user and password like every request whenever they're set, never through the tunnel, and never from another website: a POST that carries an `Origin` other than the board's own is refused, which a script never sends:

```sh
curl -u "$SEAMUX_USER:$SEAMUX_PASS" -X POST -H 'content-type: application/json' \
  -d '{"name": "pink-candy", "color": "light"}' http://localhost:54321/theme/set
```

Over mDNS, use `http://<name>.local:54321/theme/set`.

`name` is a saved theme, or `seamux`. `color`, `light` or `dark`, is optional: with it, every browser switches to it, including one opened later, until that browser's own toggle switches it back; without it, each browser keeps its own. It answers 204; 400 for any other body, 403 with the switch off or from another website, 404 for a theme that doesn't exist, 415 for anything but JSON. The newest swap wins: every board takes whichever was made last.

### Remote

Switches on remote connections: mDNS for your own network, and a Cloudflare tunnel for anywhere else. See [Remote connections](remote-connections.md).

### Debug

- **Blur cards for screenshots**: blurs what each chat says, where it runs and when (names, paths, branches, how long ago, prompts, replies, questions, queued messages and open files) while the columns, layout and controls stay readable, so the board can go in a screenshot or a bug report. Kept in this browser only.
- **Diagnostics**: sends a snapshot of how this browser lays out the board to the Mac, for triage from a phone. It records the screen size, the media queries that match, the safe areas, which stylesheets are loaded and whether they carry the phone layout's rules, and every column's and card's size and computed style. It also records the service worker's state and recent script errors. A snapshot is sent when the board loads, a second after the window is resized or turned, and when you press **Send now**. The tab shows the last one, and the Mac keeps it in `data/diagnostics/latest.json`, with the last 50 in `data/diagnostics/log.jsonl`.
- **Clear this browser's cache for the board**: a link to `/reset`, which answers with `Clear-Site-Data: "cache"` and goes back to the board. It gets a browser that is stuck on old code working again, and keeps drafts, settings and the Access login. The error page links to it too.
- **Clear autocomplete cache**: forgets every folder's slash commands, so each is listed again the next time you type `/`.
- **Clear all themes**: removes every saved theme, after asking once more, and puts the board back on `seamux`.

### In the browser

Some choices are kept in the browser rather than the store: light or dark (the board follows the OS until you pick the other one with the header toggle, and again once you flip it back), whether DONE is shown, whether to send desktop notifications, whether to send diagnostics, and whether to blur cards for screenshots.

## `.seamux.json`

`.seamux.json`, in seamux's home (`~/.seamux`, or the root of a clone, gitignored), is how the board runs there. Starting the board writes it, and `npm run land` reads it to find the board:

```json
{ "port": 54321 }
```

Edit the port there, or start the board once with `SEAMUX_PORT` set, and it's kept for later runs. The Remote tab's switches are kept here too, as `remote`, `mdns` and `tunnel`.

## Environment variables

All optional. Each can go in `.env` or the environment, except `SEAMUX_HOME`, which says where that `.env` is.

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEAMUX_PORT` | from `.seamux.json` | Port for the board, saved to `.seamux.json` |
| `SEAMUX_USER`, `SEAMUX_PASS` | unset | HTTP Basic credentials for the board, asked for by every request except the tunnel's. Unset leaves the board open to this Mac only, and keeps mDNS off |
| `SEAMUX_CF_TOKEN`, `SEAMUX_CF_DOMAIN`, `SEAMUX_CF_TEAM`, `SEAMUX_CF_AUD` | unset | The Cloudflare tunnel's token and hostname, and the Cloudflare Access team and AUD tag. All four are needed. See [Remote connections](remote-connections.md) |
| `SEAMUX_CF_TUNNEL` | unset | The tunnel's id, shown in the Remote tab |
| `SEAMUX_HOME` | the clone, or `~/.seamux` | Where seamux keeps `.env`, `.seamux.json` and `data/` |
| `SEAMUX_COMPILED` | unset | `1` makes a clone run the compiled board, as `npm start` does |
| `SEAMUX_DB` | `data/seamux.db` | The SQLite store |
| `CMUX_SOCKET_PATH` | set in every cmux terminal, else `~/.local/state/cmux/cmux.sock` | cmux's control socket |
| `CMUX_SOCKET_PASSWORD` | unset | cmux's socket password, if you've turned on its password mode. seamux doesn't read the one saved in cmux's Settings |
| `SEAMUX_CMUX_APP` | `/Applications/cmux.app`, else `~/Applications/cmux.app` | Where cmux is installed, for its wrappers that launch each agent |
| `SEAMUX_DISPATCH_DIR` | `data/dispatches` | Fan-out manifests and completion markers |
| `SEAMUX_POLL` | unset | `1` makes hot reload poll for file changes. It already polls on WSL's `/mnt/` drives |
