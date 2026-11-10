---
"seamux": patch
---

A markdown file open in the file viewer now follows links written relative to its project's root, as a session writes them, such as `content/slides/deck.pdf` in `content/drafts/prep.md`: a link that names no file beside the document, but does name one under the nearest folder with a `.git`, opens that one.
