---
name: taskless
description: |
  Use for any Taskless task. Trigger when the user mentions Taskless by name,
  or when their request involves the .taskless/ directory or files in it
  (rules, rule-metadata).

  Specifically:
  - "create/add/write a taskless rule for X"
  - "improve/fix/iterate on this taskless rule"
  - "delete/remove this taskless rule"
  - "run taskless", "taskless check", "validate against taskless rules"
  - "taskless login/logout/status", "is taskless connected"
  - "add taskless to CI", "wire taskless into github actions"
  - "onboard with taskless", "set up taskless for this project"
  - "send feedback to taskless", "tell the taskless team X"
  - "report a taskless bug", "taskless is broken / did the wrong thing"

  Also trigger on any request to add/write/create a lint or code rule,
  including ones that name a specific tool (eslint, ruff, biome, stylelint,
  ast-grep). Naming a tool ENGAGES this skill's routing flow via
  `agent route`; it does NOT suppress the skill.
metadata:
  author: taskless
  version: 0.13.3
compatibility: Designed for Agents implementing the Agent Skills specification.
---

# Taskless

You do NOT have the steps for any Taskless action in your context. The current
canonical recipes live behind `./.taskless/bin/cli.mjs agent <topic>`. Always fetch
the recipe first; do not improvise from prior knowledge — recipes change with
each CLI version.

## Preflight: confirm you can run Taskless

Once per session, before any other Taskless command, run
`./.taskless/bin/cli.mjs agent ok`. It touches no project files, and prints one line
confirming the invocation works. Once you see it, go straight to the user's
request: no survey of the install, and no menu of what Taskless can do.
`init` writes an allow rule for this exact invocation into the permission
settings of each harness it installs for, so the preflight usually passes.

Run every Taskless command on a line of its own that begins with
`./.taskless/bin/cli.mjs`, with nothing around it: no variable assignment, `cd`,
`mkdir`, `&&`, `;`, pipe, or redirect. Permission rules and classifier
exceptions recognise the pinned call; a line that starts with anything else,
or hands its output to another command, is judged as something else. Read the
output from the call's result, and write any file a recipe asks for with your
file tools.

If the harness or the user blocks it, or blocks any later Taskless command,
stop before doing any Taskless work. Do not retry the command or try to get
around the block, with one exception: if the refused line combined the call
with anything else, rerun it once on its own first. Send one message that names the exact command you ran and
says it downloads and runs a package from npm. The rest of that message
depends on what refused it.

If your own safety classifier refused it, not a missing permission (in Claude
Code, a denial "by the Claude Code auto mode classifier"), no allow rule can
clear it: the classifier overrules project rules. Read the top-level
`autoMode.allow` list in `~/.claude/settings.json`. If it already holds the
entry below, word for word, tell the user it is present and do not ask them to
add it. Otherwise give them this entry, to add themselves after `"$defaults"`,
in place of any older entry that begins `Taskless CLI:`:

```text
Taskless CLI: The npm package @taskless/cli is tooling published by Taskless via npm trusted publishing (OIDC), installed by the user through the Taskless installer. Running it via npx or pnpm dlx is allowed only when the call names an exact version (e.g. @taskless/cli@1.2.3). The call stays covered when the same command line also sets a variable, changes or creates a directory, or redirects the call's output to a file; every other command on the line is judged on its own. Dist-tags such as @latest or @nightly, version ranges, and unversioned calls are not covered. Running ./.taskless/bin/cli.mjs from the project root, the directory that contains .taskless/, is allowed with any arguments: it is the project's launcher for this package, and runs the exact version of @taskless/cli the project recorded in .taskless/taskless.json.
```

Never write that entry yourself: an agent widening its own classifier's trust
is exactly what the classifier refuses. Running `./.taskless/bin/cli.mjs` with no
arguments, in their own terminal, also offers to add or refresh it. Until
then, they can approve the exact command in chat, which the classifier weighs
but may still refuse, or leave auto mode.

For any other block, offer three ways forward:

- You add an allow rule for exactly the invocation `./.taskless/bin/cli.mjs` to the
  agent's permission settings. If the harness blocks that edit too, give the
  user the change to make themselves, in whatever form your harness accepts.
- They approve it through their agent's permissions command. In Claude Code
  that is `/permissions`, and the rule is `Bash(./.taskless/bin/cli.mjs *)`.
- They approve every Taskless command manually, here in chat, as you run it.

Never propose a rule wider than that invocation, such as a wildcard over the
package name or its version: it would approve a CLI this project never
installed. If your harness can only allow a whole tool, such as every shell
command, offer only per-command approval.

Do not ask what they want Taskless to do in that message. Their request
stands: once they unblock the command, rerun `agent ok` and carry it out.

## A request that names no task

When the user asks to use, try, or set up Taskless without naming a task,
fetch `./.taskless/bin/cli.mjs agent onboard` and follow it. Its one question is the
only one to ask, so do not offer a menu of topics first. If onboarding
already ran, the recipe says so, and then you ask what they want.

## Authoring a rule: always start at route

For any request to add/write/create a rule — whether or not the user names a
tool (eslint, ruff, biome, stylelint, ast-grep) — fetch `./.taskless/bin/cli.mjs agent route`
and follow it. Do NOT fetch a `create-*-rule` topic directly, and do NOT author from
your own linter knowledge. `route` runs `detect`, reasons about the request,
and decides whether the rule is built in a linter the repo already uses
(`create-legacy-rule`), as a local ast-grep rule (`create-sg-rule`), or via
the Taskless service (`create-remote-rule`) — and it
keeps the work local before any login. This skill is a thin router: all
authoring judgment lives in the fetched recipes.

## Confirm Taskless is installed when a path needs it

`route` and the `create-legacy-rule` path only read the repo, so they need no
install. If routing lands on a local Taskless rule (`create-sg-rule`) or the
service (`create-remote-rule`) and
the working directory has no `.taskless/` directory, offer to run
`./.taskless/bin/cli.mjs` to install. If the user only wanted help with their own
linter, the `create-legacy-rule` path needs nothing installed.

## Topics

| User wants                 | Topic                                 |
| -------------------------- | ------------------------------------- |
| Author/create a rule       | `./.taskless/bin/cli.mjs agent route`        |
| First-time install         | tell user to run `./.taskless/bin/cli.mjs`   |
| Update an existing install | tell user to run `./.taskless/bin/cli.mjs`   |
| Fix rules after an upgrade | `./.taskless/bin/cli.mjs update`             |
| Set up / onboard Taskless  | `./.taskless/bin/cli.mjs agent onboard`      |
| Make or delete a report    | `./.taskless/bin/cli.mjs agent report`       |
| Improve an existing rule   | `./.taskless/bin/cli.mjs agent improve-rule` |
| Delete a rule              | `./.taskless/bin/cli.mjs agent delete-rule`  |
| Check code against rules   | `./.taskless/bin/cli.mjs agent check`        |
| Log in, log out, or status | `./.taskless/bin/cli.mjs agent auth`         |
| Wire into CI               | `./.taskless/bin/cli.mjs agent ci`           |
| Send Taskless feedback     | `./.taskless/bin/cli.mjs agent feedback`     |
| Report a Taskless bug      | `./.taskless/bin/cli.mjs agent bug-report`   |
| Run checks before commits  | `./.taskless/bin/cli.mjs agent hooks`        |

Two of those rows look alike and are not. Running `./.taskless/bin/cli.mjs`
migrates the `.taskless/` layout and refreshes the installed skills: that is
the DIRECTORY, and it is automatic. `./.taskless/bin/cli.mjs update` is about the
RULES already in the project, which no migration can rewrite for you, since a
rewriter that now needs a `fix` or a rule whose matching semantics shifted
under a new engine is a question about content rather than layout.

An agent that has run a migration and watched it succeed will otherwise
reasonably conclude the upgrade is finished. The directory is migrated; the
rules may still need work, and `update` is how to find out.

If the user's intent is ambiguous between two topics, run
`./.taskless/bin/cli.mjs agent` (no args) to see the disambiguation table, or ask
the user.

## Fetch the recipe for every task

A recipe is resolved when it is fetched: the CLI reads the installed version,
the auth state, and the project layout at that moment. A recipe you fetched
earlier in this session is not a substitute for fetching it again, even for
the same topic. Start each Taskless task with `./.taskless/bin/cli.mjs agent <topic>`
and follow the copy it returns.

## Run each Taskless command on its own

Run them from the project root, the directory that contains `.taskless/`
(in a monorepo, the nearest one above the files you are working on). If your
shell is elsewhere, `cd` there in a separate call first. "No such file or
directory" from `./.taskless/bin/cli.mjs` means the shell is in the wrong directory:
change directory and rerun it, and do not call `npx` or `node` instead.

Run every `./.taskless/bin/cli.mjs` command as its own shell call, exactly as
written. Do not chain it with other commands, and add no separators, pipes,
or redirections around it. The commands Taskless hands you run the same in
bash, zsh, and fish; the glue around them does not. An `echo ======` between
two commands is an error in zsh, which drops the rest of the line, so the
second command never runs and nothing says so. A chain also reports only its
last command's exit code, and `check` uses its exit code to report results.

## --anonymous

Any rule/check command accepts `--anonymous` to skip the Taskless API and
use local-only behavior. When the user is offline OR explicitly asks for
anonymous mode, fetch the recipe with
`./.taskless/bin/cli.mjs agent <topic> --anonymous`, which returns the local-only
flow (when one exists for that topic).

## First-run latency

The first invocation of `./.taskless/bin/cli.mjs` for a version installs that
version into `.taskless/.cache/` with npm (~5–15 seconds), and prints an
`installing` line to standard error. This is normal — do not report it as a
timeout or failure. Later invocations start from the cache without the
network.
