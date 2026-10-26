---
"seamux": patch
---

A new worktree from the dispatch bar starts from the remote's default branch, fetched just before it is made, not from whatever the checkout last pulled, so it is no longer days or hundreds of commits behind. seamux leaves your local default branch where it is: the How to worktree macro tells the session what it was branched from and how far behind the local branch is, and the session offers to fast-forward it. When the fetch fails, the session is told so, with the commit and date it started from instead. The macro has a new `{{base}}` variable for this, and also has the session suggest adding a fresh start to the repo's own worktree convention when that convention lacks one. A How to worktree macro you have customised keeps your text, so add `{{base}}` to it to get the new line. Forks into a new worktree still branch from what their chat has checked out.
