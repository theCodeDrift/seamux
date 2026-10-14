---
"seamux": patch
---

A worktree the dispatch bar makes, and its branch, now end in a short random id (`.claude/worktrees/fix-the-login-k3f9`, branch `worktree-fix-the-login-k3f9`) rather than the next free number. Two prompts that open with the same words no longer reuse a name once the first worktree is gone, so a later chat can't land on an earlier one's branch, such as one still open in a pull request.
