# Memory pressure

How macOS reports that it is running short of memory, which the board shows in its header and the dispatch bar asks about before starting another chat. Measured on macOS 26.5.1, on a 16 GB Mac running twelve Claude Code chats.

## `kern.memorystatus_vm_pressure_level` gives the kernel's pressure level without root

`sysctl -n kern.memorystatus_vm_pressure_level` printed `1` with no privileges and returned in a few milliseconds. The value is the kernel's own level, the one that decides when macOS starts closing apps: `1` normal, `2` warning, `4` critical, as in `DISPATCH_MEMORYPRESSURE_NORMAL`, `_WARN` and `_CRITICAL`. There is no `3`. seamux calls `2` "Memory pressure" and `4` "System loaded".

Only `1` was seen live. `2` and `4` are unmeasured here: `memory_pressure -S -l warn`, which simulates pressure, printed `sysctl: kern.memorypressure_manual_trigger failed : Operation not permitted` without root.

- **Measured:** macOS 26.5.1.
- **In seamux:** `memoryPressure` and `pressureFromLevel` in [memory.server.ts](../app/lib/memory.server.ts).
- **See also:** [Free memory is not the signal](#free-memory-is-not-the-signal).

## Free memory is not the signal

At level `1`, `memory_pressure -Q` reported `System-wide memory free percentage: 61%` while `vm.swapusage` showed 3,022 MB of 4,096 MB of swap in use and twelve `claude` processes held about 3 GB between them. A threshold on free memory or swap would have read that Mac as both fine and nearly full. The kernel's level weighs compression and swap itself, so seamux reads that and nothing else.

- **Measured:** macOS 26.5.1, Claude Code 2.1.301.
- **In seamux:** [memory.server.ts](../app/lib/memory.server.ts).
- **See also:** [`kern.memorystatus_vm_pressure_level` gives the kernel's pressure level without root](#kernmemorystatus_vm_pressure_level-gives-the-kernels-pressure-level-without-root).
