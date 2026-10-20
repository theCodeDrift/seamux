# Contributing

Issues and pull requests are welcome. For anything bigger than a fix, open an issue first so we can agree on the shape before you build it.

## Proposing a change

seamux is a board over cmux: it reads what cmux, Claude Code, Codex and Cursor already record, and drives sessions through cmux. A proposal fits when it:

- **Meets a distinct need.** Say what you can't do today, or what the board doesn't show. A need described well is worth more than a solution.
- **Reworks the board rather than bolting onto it.** If a feature doesn't fit the board as it is, propose how the board should change to hold it, rather than adding a mode, a toggle or a second kind of card beside what's there.
- **Drives cmux.** seamux learns which sessions exist, and where, from cmux and its hooks. If cmux can't see or do something, ask the cmux team first. A workaround in seamux, such as reading state off the screen, is the last resort.
- **Justifies any new architecture.** New stored state, a new process, a new config format or a new dependency each need a reason the existing pieces can't cover. The store holds only what nothing else records.

One issue, one feature. If a proposal covers two things that need different approaches, split it.

A new agent arrives measured, not configured: findings in a page of its own under [knowledge/](knowledge/index.md) first (what cmux reports for it, where its transcripts are, how it takes input, and the versions measured), as [Codex](knowledge/codex.md) has, then the engine. A pull request that only adds findings is welcome on its own.

If an agent drafts your issue or pull request, point it at this file and `CLAUDE.md`.

## Setting up

Follow [Getting started](docs/getting-started.md): macOS, cmux, Claude Code and Node 24 or later, then `npm install` and `npm run seamux`.

## Making a change

The board you're running serves from your checkout, and hot reload applies every saved file within seconds, so a half-finished change breaks the board you're using. Work in a git worktree on its own branch instead, and bring the change into the checkout the board runs from once it's done:

1. Make a worktree, under `worktrees/` or `.claude/worktrees/` (both gitignored), branched from the latest `main`, and run `npm install` in it. Don't symlink `node_modules` into it.
2. Commit, then run `npm run land` from the worktree. It rebases your branch onto `main`, typechecks it, fast-forwards `main`, restarts the board if dependencies or a `.server.ts` module changed, and pushes `main` to `origin`. Run `npm run land -- --no-push` to keep the landing local, as in a clone you can't push from.

For a pull request, push your branch and open the PR against `main` instead of landing it. A maintainer can ask Claude about it with a comment: `@claude /review` reviews it (incrementally after the first time; `@claude /review all` from scratch), and `@claude /focus` (or `@claude /focus 5`) points a human reviewer at the few sections most worth their attention. Both only read and comment, and never run for anyone but a maintainer.

## Checking a change

- `npm run typecheck`, `npm test` and `npm run build` must pass; CI runs all three on every pull request.
- There are two test suites:
  - **`tests/`** (`npm test`) runs against a fake cmux (`tests/fake-cmux.ts`), which speaks cmux's socket protocol and answers `cmux sessions list`. It needs neither cmux nor Claude Code installed, never touches your real sessions, and runs in CI.
  - **`tests-cmux/`** (`npm run test:cmux`) is the vendor contract: the same behaviour checked against a real cmux, from a cmux terminal. It works only in throwaway workspaces it creates and closes, and never runs in CI. Run it after updating cmux; a failure means cmux changed something seamux relies on.
- A new cmux call needs a contract test in `tests-cmux/`, the method taught to the fake (which refuses methods it doesn't know), and a test in `tests/` of what seamux sends.
- Try a new cmux or Claude Code call against a throwaway session in its own cmux workspace, never against sessions you care about, and close the workspace afterwards.
- Several documented cmux and Claude Code behaviours turned out wrong when seamux ran them. [knowledge/](knowledge/index.md) records them by domain, and says how to add to it. Add to it when a tool surprises you, and say which version you measured.
- `npm run check` must pass, and CI runs it too; a pre-commit hook, which `npm install` sets up, checks the files you stage. [Taskless](https://taskless.io) checks the rules below that a single file can show, such as an action without `assertFromBoard` or a cmux call without a surface; its rules are in `.taskless/rules/`.

## Release notes

If your change alters what someone running seamux gets, add a changeset: run `npx changeset` and describe the change for them. It becomes the change's line in `CHANGELOG.md` when seamux next releases. Docs, CI and refactors need none. A pull request without a changeset gets a warning, never a failure.

seamux is pre-1.0, so a changeset is one of two bumps, never `major`:

- **`minor`**: a change people may have to migrate to or adopt, such as a moved setting, a new requirement or a changed command. Say in the changeset what they must do.
- **`patch`**: a bug fix, or a small addition that asks nothing of them.

Releases are cut by merging the "Version Packages" pull request that GitHub Actions keeps open, which publishes to npm, tags the release and creates its GitHub Release.

## Rules the code keeps

`CLAUDE.md` lists them in full, and agents working on seamux read it. The ones a change most often runs into:

- **seamux never destroys.** No command deletes a session, worktree or transcript. When something should go, seamux asks the session that owns it.
- **Localhost only, except mDNS and the tunnel.** Every action goes through `assertFromBoard` in `app/lib/guard.server.ts`.
- **Derive, don't store.** Session state comes from `claude agents`, cmux and the transcripts on every poll. The store holds only what nothing else records.
- **Always pass a surface to cmux.** Its RPCs default to the caller's own terminal.

## Screenshots

To share a screenshot of your board in an issue, turn on **Blur cards for screenshots** in the cog menu's Debug tab first. Mark any new element that shows what a chat says or where it runs with the `sensitive` class, so the blur covers it.
