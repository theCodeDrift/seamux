---
"seamux": minor
---

The dispatch bar's "new worktree" now puts the worktree in `.agents/.worktrees/` when the repo has that directory, the place every agent harness shares, ahead of `.claude/worktrees/` and then `worktrees/`. Worktrees there are coloured with their repo and their files open from the board like any other worktree's. To adopt it in a repo, create `.agents/.worktrees/` with a tracked `.gitkeep`, ignore everything else in it (`.agents/.worktrees/*` and `!.agents/.worktrees/.gitkeep`), and keep the old locations ignored while worktrees still live there. If you customised the How to worktree macro, `{{worktrees}}` now names this directory too.
