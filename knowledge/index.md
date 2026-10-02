# What seamux knows

seamux stands on tools it doesn't own: Claude Code, Codex, cmux, cloudflared, macOS, Vite and React Router. Their documentation, and what anyone would assume of them, turned out wrong often enough that seamux trusts only what it has measured. This collection is that record: what each tool actually does, which version showed it, and what seamux does about it.

Read the domain before you touch the code that leans on it. When a tool surprises you, write it down here before you write the fix.

## Domains

| Domain | What it covers |
| --- | --- |
| [Claude Code](claude-code.md) | The harness seamux was built around: `claude agents`, launching with a chosen id, and every Claude Code entry in the other domains |
| [Session state](session-state.md) | Whether a Claude Code chat is working, waiting or gone: `claude agents`, its `status` and `waitingFor`, `/clear`, resuming |
| [Background sessions](background-sessions.md) | Chats moved to the background, `claude attach`, and what `claude agents` can't tell apart |
| [Transcripts](transcripts.md) | What Claude Code writes to its `.jsonl` transcripts, and what it leaves out |
| [Subagents](subagents.md) | The `SubagentStart` and `SubagentStop` hooks, helper agents, and the subagent records on disk |
| [cmux](cmux.md) | The control socket, surfaces, workspaces and keys |
| [Launching](launching.md) | Starting a chat in a new cmux workspace: the shell, `PATH`, the wrappers and the trust dialog |
| [The prompt box](prompt-box.md) | Typing into a chat: pastes, Enter, line breaks, shell mode, emptying a draft, and paths |
| [Dialogs](dialogs.md) | Permission prompts, AskUserQuestion, and the other numbered dialogs, and the keys that answer them |
| [Slash commands](slash-commands.md) | Listing a chat's slash commands, and why the slash menu isn't the way |
| [Names](names.md) | Renaming chats and workspaces, in Claude Code, Codex and cmux |
| [Codex](codex.md) | Everything Codex does differently, from its transcripts to its approvals |
| [OpenCode](opencode.md) | Measured before its engine: how cmux registers it, its SQLite sessions, its lifecycle, approvals and keys |
| [Signing in](signing-in.md) | Detecting an expired login and signing Claude Code or Codex in without a terminal |
| [Cloudflare Tunnel](cloudflare-tunnel.md) | cloudflared, its hostname, and Cloudflare Access |
| [mDNS](mdns.md) | Reaching the board by this Mac's `.local` name |
| [Vite and React Router](vite-and-react-router.md) | The dev server, `.env`, cross-origin actions, and what browsers cache |
| [Measuring](measuring.md) | How to find these things out without touching anyone's real sessions |

## For agents: keeping this collection

You are a keeper of this collection, not only a reader. Every agent working on seamux is. What follows is how it stays trustworthy.

### When to add

Add an entry whenever a tool did something you didn't expect, or something its documentation doesn't say, or the opposite of what an existing entry says. Add it in the same commit as the code that depends on it. A finding with no code yet is still worth a commit of its own.

Don't add what the tool's documentation already says correctly, what the code makes plain on its own, or what was true only of your machine that afternoon.

### What an entry looks like

One finding is one `##` heading in one domain file. The heading is the claim, as a sentence without a full stop, so that the table of contents reads as a list of facts:

```md
## `/clear` keeps the process and changes the session id

What happened, in plain words: what you sent, what came back, what you
expected instead. Exact strings, codes and key names in backticks.

- **Measured:** Claude Code 2.1.283.
- **In seamux:** `processKey` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [A chat moved to the background keeps its old transcript apart](background-sessions.md#a-chat-moved-to-the-background-keeps-its-old-transcript-apart).
```

- **The claim is the heading.** Someone skimming the headings should come away right, even without reading a body.
- **Say how you know.** Name what you ran and what it printed. "A 1,503-character message arrived as 481 characters" is a finding; "long messages get truncated" is a rumour.
- **`Measured:` is required.** Name every tool's version that took part: Claude Code, Codex, cmux, cloudflared, macOS, Vite, React Router. Some older entries say "not recorded"; whoever next re-measures one fills it in.
- **`In seamux:` points at the code** that depends on the finding, by file and, where there is one, the function or constant. Leave it out only when nothing depends on it yet. Link files, not line numbers, which drift.
- **`See also:` links the entries a reader needs next**, in any domain. Link generously: a finding about the prompt box is often half a finding about cmux. When you link A to B, ask whether B should link back to A.
- **Unmeasured is a word worth using.** If you didn't check something, say it's unmeasured, so nobody mistakes your silence for a result.

### Where it goes

Put an entry in the domain a reader would look in first, and link to it from any other domain it touches. If two would do equally well, choose the one whose code it changes. An entry about one harness in a shared domain also gets a line on that harness's page, so [Claude Code](claude-code.md) and [Codex](codex.md) each list everything known about them.

Start a new domain file when a topic has three or more entries that sit awkwardly where they are, or when a new tool arrives. Each agent harness has its own file, as [Claude Code](claude-code.md) and [Codex](codex.md) do, holding what belongs to it alone and linking every entry about it in the shared domains. A new harness gets one too, and [CONTRIBUTING.md](../CONTRIBUTING.md) asks for its findings before its engine. A new file opens with one paragraph on what it covers and which tools it was measured against, then the entries. Add it to the table above.

### When a tool changes

A newer version that behaves differently doesn't erase the old entry, since people run older versions. Rewrite the entry to say what the newest measured version does, keep the older behaviour in a sentence naming its version ("2.1.282 kept long input as typed; 2.1.285 treats…"), and update `Measured:`. If the change makes the heading false, change the heading, then fix every link to it.

When `npm run test:cmux` fails, cmux changed: the entry in [cmux](cmux.md), the fake in `tests/fake-cmux.ts` and the code all change together. [CLAUDE.md](../CLAUDE.md) has the rest.

If you find an entry is wrong, fix it, and say in the body what the earlier claim was and why it was wrong. A finding that overturned another is itself a finding.

### Curating

- **Keep links working.** A heading is an anchor; renaming one breaks every link to it. Search for the old anchor across `knowledge/`, the code and the other docs before renaming. `npm test` runs [tests/knowledge.test.ts](../tests/knowledge.test.ts), which fails on a link to a file or heading that doesn't exist, on an entry without `Measured:`, and on a page missing from the table above.
- **Merge duplicates.** Two entries saying the same thing become one, with the other's evidence folded in and its links pointed at the survivor.
- **Split entries that grow two claims.** If the heading needs an "and" that joins two unrelated facts, it's two entries.
- **Move entries that landed in the wrong domain**, and fix their links.
- **Code comments point here.** When code leans on a finding, its comment links to the domain file (`knowledge/prompt-box.md`), not to a copy of the finding. One record, kept in one place.

### Voice

These pages set the tone for every agent that reads them, so write the way they're written:

- Plain, declarative sentences in the present tense for what a tool does, and the past tense for what you saw happen. "Pressing `3` stayed and `1` exited."
- Concrete over general: the exact error text, the key, the number of characters, the version.
- No hedging you can measure away. If you're unsure, measure; if you can't, say what's unmeasured.
- British spelling, as the rest of seamux uses: behaviour, colour, honour.
- No exclamation marks, no "simply", no "just", no em dashes. A colon or a full stop does the job.
- Write for the next reader, who will trust you. Make it safe for them to.
