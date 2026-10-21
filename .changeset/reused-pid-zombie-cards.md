---
"seamux": patch
---

A chat that had ended no longer comes back on the board when macOS gives its process id to another program. A Cursor chat closed at an approval could reappear for a moment, asking for that approval again, whenever another process briefly took its old id, as when closing another chat. The board now checks that the process at a chat's id started when cmux recorded it starting, for every harness.
