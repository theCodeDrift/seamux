---
"seamux": patch
---

A session in a new worktree no longer offers to fast-forward your local default branch. The How to worktree line still says how far behind the remote it is, as context, and once the session has merged its own work into that branch, by landing or merging a pull request, it fast-forwards the branch itself, asking you only when it can't fast-forward, so the chat no longer sits waiting on a question with one answer.
