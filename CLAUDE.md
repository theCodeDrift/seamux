# seamux

A board over every Claude Code session on this Mac, and the tools to drive and dispatch them. `README.md` covers how it works and links to `docs/getting-started.md` (setup and every setting) and `docs/remote-connections.md` (mDNS and the tunnel); keep them current when behaviour changes. `CONTRIBUTING.md` says what makes a proposal fit seamux; read it before drafting an issue or weighing one. Prose is checked with Taskless.

## Rules

- **seamux never destroys.** The tool has no `claude rm`, no `git worktree remove`, nothing that deletes a session, worktree or transcript. When something should be removed, the session that owns it does it: seamux sends it a prompt asking.
- **Localhost only, except mDNS and the tunnel.** The board always answers this Mac at localhost, and the Remote tab can open mDNS, the tunnel, or both, each on its own switch. `remoteGate` in `app/lib/remote.server.ts`, ahead of everything the server answers, decides every request by its socket and Host: always, a request from loopback addressed to `localhost`, `127.0.0.1` or `[::1]`; with mDNS on, one from anywhere addressed to this Mac's `.local` name, which needs the HTTP Basic credentials set; with the tunnel on, one from loopback, and never the network, addressed to the tunnel's hostname, which must carry a Cloudflare Access token that `remote.server.ts` verifies, in both the auth middleware and that gate. Everything but the tunnel must carry the HTTP Basic credentials whenever they're set. Every action also goes through `assertFromBoard` in `app/lib/guard.server.ts`. The dev server runs the gate as Vite middleware (`vite.config.ts`); the compiled server (`server/serve.ts`) runs it first too. Keep the two servers' checks the same, and never let a request from the network or the tunnel through on anything weaker.
- **Derive, don't store.** Session state comes from `claude agents --json`, cmux, and the transcripts on every poll. The store (`app/lib/store.server.ts`) holds only what nothing else records: subagent lifecycle, dispatch intent, pins, queued messages, and settings.
- **Always pass a surface to cmux.** cmux RPCs default to the caller's own surface, which is whatever terminal seamux runs in. The fake cmux in the tests refuses a surface call without one.
- **Blur what a chat says.** Any element that shows a session's content or where it runs (names, paths, branches, how long ago, prompts, replies, questions, files) carries the `sensitive` class, which the Debug tab's screenshot blur covers.
- **Ship a changeset with every change someone running seamux would notice.** See Release notes below: `patch` or `minor`, never `major` while seamux is `0.y.z`.
- **Verify tool behaviour by running it.** Several documented cmux and Claude Code behaviours turned out wrong. `knowledge/` records what each tool actually does, one file per domain; read `knowledge/index.md` before adding to it, and add every new finding there, in the same commit as the code that depends on it.

## Layout

- `app/lib/board.server.ts`: derives the board. `codex.server.ts`: reads Codex sessions, which have no `claude agents` of their own. `drive.server.ts`: every write verb, through cmux. `harness.server.ts`: what each harness (Claude Code, Codex) needs to know, and `Session`, the primitives every keystroke goes through: `clearInput`, `write`, `submit`, `press`, `keys`, `paste`, `type`, `screen`. `macros.server.ts`: the built-in macros made of them (send, resume, exit, rename, approve, answer a question, accept trust). A key sequence goes in a macro or a primitive, never straight into a verb, and a new harness supplies a `Harness` entry rather than branching on `engine`. `cmux.server.ts`: the connection to cmux, its control socket spoken directly, and `cmux sessions list`. `queue.server.ts`: sends queued messages once their chat is idle. `reconnect.server.ts`: resumes chats stopped on a failed request once the API answers again. `protocol.server.ts`: fan-out manifests and markers. `config.ts` / `config.server.ts`: settings and the system macros' defaults. `remote.server.ts`: the Remote tab's switches, the mDNS name and network check, the tunnel's settings, and the Access token check.
- `app/lib/paths.server.ts`: where the package is, and `SEAMUX_HOME`, where `.env`, `.seamux.json` and `data/` live: the checkout, or `~/.seamux` for an installed package. Read state from there, never from `process.cwd()` or a path relative to a module.
- `hooks/subagent-event.ts`, everything under `scripts/` and `server/serve.ts` run under plain Node with type stripping in a checkout, and so does everything they import: relative imports with `.ts` extensions, `import type`, no enums, no constructor parameter properties (`constructor(readonly x: T)`), which Node rejects and neither tsc nor the tests catch. `npm run build` bundles them into `dist/` (`scripts/build-dist.ts`) for an installed package, where Node won't strip types. `bin/seamux` runs the TypeScript in a checkout and `dist/` otherwise.
- `server/serve.ts`: the compiled board, which the supervisor runs in place of the dev server for an installed package, or with `SEAMUX_COMPILED=1` (`npm start`).
- `knowledge/`: what seamux has measured of Claude Code, Codex, cmux and the rest, one file per domain, cross-linked, with the code that depends on each finding. `knowledge/index.md` lists the domains and says how to keep them; `tests/knowledge.test.ts` checks its links and that every entry names the versions it was measured on.
- `skills/seamux-dispatch/SKILL.md` is a template; `scripts/setup.ts` renders it into `~/.claude/skills`, with the subagent hooks, whenever the board starts (and on `seamux setup`).

## Working on seamux

The board runs from the main checkout, on `main`, under `npm run seamux`, which keeps the dev server up and restarts it when needed. Never edit the main checkout directly: it is what the board serves.

1. Work in your own worktree, on your own branch. A session dispatched from the board with "new worktree" already has one, under `.claude/worktrees/`, branched from main; otherwise make one under `worktrees/<name>`.
2. If the change alters what someone running seamux gets, add a changeset in the same commit (see Release notes below). Commit, then run `npm run land` from the worktree. It waits for any other landing to finish, rebases your branch onto main, typechecks it, fast-forwards main, and restarts the board if dependencies or any `.server.ts` module changed; otherwise hot reload picks the change up within seconds.
3. If it reports a conflict, rebase onto main yourself, resolve, and run it again. main is untouched until a landing succeeds.
4. Once landed, as your very last step, remove your own worktree and branch (`git -C <main checkout> worktree remove <your worktree>`, then `git branch -d`), and never anyone else's. The user closes the chat from the board.

## Release notes

Releases come from changesets. Each change that someone running seamux would notice gets one `.changeset/<short-name>.md`, which becomes its line in `CHANGELOG.md`. Write the file by hand, since `npx changeset` is interactive:

```md
---
"seamux": patch
---

What changed, for someone running seamux: what they'll see, and anything they must do.
```

- **One change, one changeset.** A later commit on the same change extends the existing file instead of adding a second.
- **Pick the bump by what someone running seamux has to do.** seamux is pre-1.0, so only two are used, and never `major`:
  - **`minor`**: a change they may have to migrate to or adopt, such as a moved or renamed setting, a new requirement, a changed command, or a change to where seamux keeps its state. Say in the note what they must do.
  - **`patch`**: a bug fix, or a small addition that asks nothing of them.
- **No changeset** for what nobody running seamux sees: docs, CI, refactors, tooling.

On GitHub, `release-version.yml` keeps a "Version Packages" pull request open that folds pending changesets into `CHANGELOG.md` and bumps the version, and merging it releases: `release.yml` publishes the new version to npm through trusted publishing, once someone approves the `npm-production` environment, then tags `v<version>` and creates its GitHub Release from `CHANGELOG.md`.

## Checking changes

- `npm run typecheck` and `npm test`. `tests/` runs against `tests/fake-cmux.ts`, a stand-in for cmux's control socket and `cmux sessions list`, and never reaches the real cmux: `tests/setup.ts` replaces the socket path and drops the capability token. CI runs it.
- `npm run test:cmux`, from a cmux terminal, checks the same contract against the real cmux: `tests-cmux/` is the vendor contract, and never runs in CI. Run it after cmux updates, and whenever you change a cmux call. When it fails, cmux changed: update seamux, the fake to match what cmux now does (its refusals use cmux's own codes and words), and `knowledge/cmux.md`. A new cmux call gets all three: a contract test in `tests-cmux/`, the method in the fake, and a test in `tests/` of what seamux sends.
- Try new cmux or Claude Code calls against a throwaway session in its own cmux workspace, never against the user's live sessions, and close the workspace afterwards.
