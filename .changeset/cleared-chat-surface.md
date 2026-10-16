---
"seamux": patch
---

A chat just cleared with `/clear` no longer flashes up as idle and "Not in a cmux surface" for one refresh. Claude Code moves to the new session id a moment before cmux does, and the board now finds the chat by its process while cmux catches up.
