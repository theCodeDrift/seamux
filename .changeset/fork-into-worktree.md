---
"seamux": patch
---

Fork can start the new chat in a worktree of its own: tick Worktree beside Fork in a chat's full view, and seamux makes a worktree branched from what the chat has checked out, starts the fork there, and tells it so in its first prompt. Its card shows the new worktree. Before, a fork always ran in its parent's directory, and a fork that made a worktree itself still showed, and ran, in the parent's.
