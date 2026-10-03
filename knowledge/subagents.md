# Subagents

The subagents a Claude Code chat starts with its Agent tool. Neither cmux nor `claude agents` knows about them. seamux learns when one starts and stops from the `SubagentStart` and `SubagentStop` hooks, which `scripts/setup.ts` installs, and reads what each one is from the transcripts Claude Code keeps for it. Subagent lifecycle is one of the few things the store holds, since nothing else records it.

## Helper agents fire `SubagentStop` with an empty `agent_type` and never fire `SubagentStart`

Claude Code runs internal helper agents, between turns among other times, and they reach the hook too. The hook ignores them. Counting them showed three subagents where there was one.

- **Measured:** not recorded.
- **In seamux:** `recordHook` in [store.server.ts](../app/lib/store.server.ts) drops a payload without an `agent_type`.
- **See also:** [`status: busy` does not mean a turn is running](session-state.md#status-busy-does-not-mean-a-turn-is-running), since the same helpers keep a chat busy.

## The global hook is required

A hook fires in the session that starts the subagent, so a hook in seamux's own project settings would only ever see seamux's own subagents. seamux installs it in the user's `~/.claude/settings.json`.

- **Measured:** not recorded.
- **In seamux:** `writeHooks` in [scripts/setup.ts](../scripts/setup.ts), and the hook itself, [hooks/subagent-event.ts](../hooks/subagent-event.ts), which records the payload and exits 0 whatever happens.

## Claude Code records subagents on disk

Each session's transcript directory holds `subagents/agent-<id>.jsonl` and `agent-<id>.meta.json`, with the description, type, parent tool call and spawn depth. Neither cmux nor `claude agents` knows about subagents, but the transcripts do. The board reads descriptions from there rather than storing them.

- **Measured:** not recorded.
- **In seamux:** `toSubagent` in [board.server.ts](../app/lib/board.server.ts).
- **See also:** [Transcripts](transcripts.md), [An OpenCode subagent is a child session](opencode.md#an-opencode-subagent-is-a-child-session), and [cmux lists it as a session of its own](opencode.md#cmux-lists-an-opencode-subagent-as-a-session-of-its-own).
