# git

What git does when seamux makes a worktree for dispatched work: the fetch that brings the remote's default branch up to date, and the branch made from it. Measured against git 2.50.1 (Apple Git-155).

## `git fetch origin main` leaves `origin/main` alone in a single-branch clone

A clone made with `--single-branch --branch other` fetches only `+refs/heads/other:refs/remotes/origin/other`. In one, `git fetch origin main` wrote only `FETCH_HEAD`, and `git rev-parse --verify origin/main` still found nothing afterwards. `git fetch origin +refs/heads/main:refs/remotes/origin/main` made `origin/main` and moved it to the remote's tip. In a full clone, the plain form moves `origin/main` too, but the full refspec works in both kinds of clone, so seamux always uses it.

- **Measured:** git 2.50.1 (Apple Git-155), against a local bare remote.
- **In seamux:** `freshBase` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [A single-branch clone has no `origin/HEAD`](#a-single-branch-clone-has-no-originhead).

## A single-branch clone has no `origin/HEAD`

A full `git clone` sets `refs/remotes/origin/HEAD` to the remote's default branch, and `git symbolic-ref --short refs/remotes/origin/HEAD` prints `origin/main`. A `--single-branch` clone left it unset. `git ls-remote --symref origin HEAD` still named the default branch, as `ref: refs/heads/main` then a tab and `HEAD`, so seamux asks the remote when `origin/HEAD` is missing.

- **Measured:** git 2.50.1 (Apple Git-155), against a local bare remote.
- **In seamux:** `freshBase` in [drive.server.ts](../app/lib/drive.server.ts).
- **See also:** [`git fetch origin main` leaves `origin/main` alone in a single-branch clone](#git-fetch-origin-main-leaves-originmain-alone-in-a-single-branch-clone).

## A branch made from `origin/main` tracks it unless given `--no-track`

`git worktree add <path> -b feat origin/main` set `branch.feat.merge` to `refs/heads/main`, so `git pull` in the new branch pulls main. What `git push` then does depends on `push.default`, unmeasured here. With `--no-track` before the start point, `branch.feat.merge` was unset and the worktree still started at `origin/main`'s commit. seamux's worktree branches track nothing until the session pushes them.

- **Measured:** git 2.50.1 (Apple Git-155), with the default `branch.autoSetupMerge`.
- **In seamux:** `createWorktree` in [drive.server.ts](../app/lib/drive.server.ts).
