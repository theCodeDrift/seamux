# Memory pressure

How macOS reports how much memory is in use and when it is running short, which the board shows in its header and the dispatch bar asks about before starting another chat. Measured on macOS 26.5.1, on a 16 GB Mac running twelve Claude Code chats.

## `kern.memorystatus_vm_pressure_level` gives the kernel's pressure level without root

`sysctl -n kern.memorystatus_vm_pressure_level` printed `1` with no privileges and returned in a few milliseconds. The value is the kernel's own level, the one that decides when macOS starts closing apps: `1` normal, `2` warning, `4` critical, as in `DISPATCH_MEMORYPRESSURE_NORMAL`, `_WARN` and `_CRITICAL`. There is no `3`. seamux colours its memory figure amber at `2` and red at `4`, and asks before dispatching at `4`.

`1` and `2` were seen live; `4` is unmeasured here: `memory_pressure -S -l warn`, which simulates pressure, printed `sysctl: kern.memorypressure_manual_trigger failed : Operation not permitted` without root. At `2` the Mac felt normal in use: 8.1 GB of 9.2 GB swap in use, about 81% of memory used as Activity Monitor counts it, and nothing closed. Level `2` means macOS is compressing and swapping to keep up, not that it has started closing apps, so a warning label there read as an alarm that never came.

- **Measured:** macOS 26.5.1.
- **In seamux:** `memoryUsage` and `pressureFromLevel` in [memory.server.ts](../app/lib/memory.server.ts).
- **See also:** [Free memory is not the signal](#free-memory-is-not-the-signal), [`kern.memorystatus_level` is the kernel's available memory, and what `memory_pressure` prints](#kernmemorystatus_level-is-the-kernels-available-memory-and-what-memory_pressure-prints), [`vm_stat` and `vm.swapusage` give memory in use the way Activity Monitor counts it](#vm_stat-and-vmswapusage-give-memory-in-use-the-way-activity-monitor-counts-it).

## Free memory is not the signal

At level `1`, `memory_pressure -Q` reported `System-wide memory free percentage: 61%` while `vm.swapusage` showed 3,022 MB of 4,096 MB of swap in use and twelve `claude` processes held about 3 GB between them. A threshold on free memory or swap would have read that Mac as both fine and nearly full. The kernel's level weighs compression and swap itself, so seamux decides by that and nothing else: the free percentage shows how far along the Mac is, and the tooltip what is in use, but neither sets the colour or asks before a dispatch.

- **Measured:** macOS 26.5.1, Claude Code 2.1.301.
- **In seamux:** [memory.server.ts](../app/lib/memory.server.ts).
- **See also:** [`kern.memorystatus_vm_pressure_level` gives the kernel's pressure level without root](#kernmemorystatus_vm_pressure_level-gives-the-kernels-pressure-level-without-root).

## `kern.memorystatus_level` is the kernel's available memory, and what `memory_pressure` prints

`sysctl -n kern.memorystatus_level` printed `40`, without root, in the same moments `memory_pressure -Q` printed `System-wide memory free percentage: 40%`: the two are one value, the share of memory the kernel counts as still available once it has weighed compression and swap. It moves with the pressure level: `61` at level `1`, and `35` to `40` at level `2`. Its value at level `4` is unmeasured, so where on it macOS turns critical is unknown. seamux's header shows `100` less it, the share no longer available, as the closest the kernel comes to how near the Mac is to closing apps. `kern.vm_pressure_level_transition_threshold` read `30` and may be the point it turns on, but nothing here showed it.

- **Measured:** macOS 26.5.1.
- **In seamux:** `loadFromLevel` in [memory.server.ts](../app/lib/memory.server.ts).
- **See also:** [Free memory is not the signal](#free-memory-is-not-the-signal).

## `vm_stat` and `vm.swapusage` give memory in use the way Activity Monitor counts it

Activity Monitor's "Memory Used" is app memory, wired and compressed. `vm_stat`, without root and in a few milliseconds, prints each as a page count under its page size: `Anonymous pages` less `Pages purgeable`, `Pages wired down`, and `Pages occupied by compressor`. sysctl has no single name for wired or compressor-occupied pages (`vm.compressor_bytes_used` is the compressed data, not the pages holding it), so seamux parses `vm_stat`. `sysctl -n hw.memsize kern.memorystatus_vm_pressure_level kern.memorystatus_level vm.swapusage` prints the four values one per line, the last as `total = 9216.00M  used = 8105.19M  free = 1110.81M  (encrypted)`. Swap grows on demand: its total went from 7,168 MB to 9,216 MB and back within minutes.

- **Measured:** macOS 26.5.1.
- **In seamux:** `memoryUsage`, `usedFromVmStat` and `swapFromSysctl` in [memory.server.ts](../app/lib/memory.server.ts).
- **See also:** [Free memory is not the signal](#free-memory-is-not-the-signal).
