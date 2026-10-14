---
"seamux": patch
---

Open a PDF linked from a rendered HTML page in the file viewer: Chrome blocked it, with `ERR_BLOCKED_BY_CLIENT`, because the new tab inherited the page's sandbox. A link that opens the PDF in the page itself, or asks to download it, now saves the file instead.
