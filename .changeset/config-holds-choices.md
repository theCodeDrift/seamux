---
"seamux": minor
---

Project colours are kept in seamux's store instead of each browser, so every browser and device shows the same ones. Those a browser kept before move over the first time it opens the board, unless the project already has a colour. Pins move into the settings too. The first start after upgrading clears queued messages, subagent records and what each dispatched session was started for, so send anything still queued first. From now on, an upgrade that changes one of those tables starts it afresh instead of migrating it. Settings, themes, macros, pins and colours are always kept.
