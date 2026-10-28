---
"seamux": patch
---

A file path with spaces in a reply, such as `~/Dropbox/2026-10-27 Receipt (1).pdf`, links as one path to the file viewer, written bare or as inline code, rather than stopping at its first space. The board looks for it on disk first, so words after a path that only look like the rest of it stay prose.
