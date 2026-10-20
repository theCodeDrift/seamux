// How much of the Mac's memory is in use and how hard macOS is pressed for
// it, for the board's header and the dispatch bar, which asks before starting
// another chat on a loaded Mac. See knowledge/memory-pressure.md.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MemoryPressure, MemoryUsage } from "./board.ts";

const run = promisify(execFile);

// The kernel's level: 1 normal, 2 warning, 4 critical.
export function pressureFromLevel(level: number): MemoryPressure | null {
  if (!Number.isInteger(level) || level < 1) return null;
  if (level >= 4) return "critical";
  if (level >= 2) return "warn";
  return "normal";
}

// Memory in use as Activity Monitor counts it: app memory (anonymous pages
// that can't be purged), wired, and what the compressor occupies. null when
// `vm_stat`'s output doesn't have them.
export function usedFromVmStat(text: string): number | null {
  const pageSize = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const count = (name: string) =>
    Number(new RegExp(`^${name}:\\s+(\\d+)\\.`, "m").exec(text)?.[1]);
  const pages =
    count("Anonymous pages") -
    count("Pages purgeable") +
    count("Pages wired down") +
    count("Pages occupied by compressor");
  const used = pages * pageSize;
  return Number.isFinite(used) && used >= 0 ? used : null;
}

// `vm.swapusage`, as "total = 9216.00M  used = 8105.19M  free = …".
export function swapFromSysctl(
  text: string,
): { used: number; total: number } | null {
  const mb = (name: string) =>
    Number(new RegExp(`${name} = ([\\d.]+)M`).exec(text)?.[1]) * 2 ** 20;
  const used = mb("used");
  const total = mb("total");
  return Number.isFinite(used) && Number.isFinite(total)
    ? { used, total }
    : null;
}

// null where it can't be read, as off macOS.
export async function memoryUsage(): Promise<MemoryUsage | null> {
  try {
    const [vm, sysctl] = await Promise.all([
      run("vm_stat", [], { timeout: 2_000 }),
      run(
        "sysctl",
        [
          "-n",
          "hw.memsize",
          "kern.memorystatus_vm_pressure_level",
          "vm.swapusage",
        ],
        { timeout: 2_000 },
      ),
    ]);
    const [memsize, level, swapusage = ""] = sysctl.stdout.trim().split("\n");
    const total = Number(memsize);
    const used = usedFromVmStat(vm.stdout);
    const pressure = pressureFromLevel(Number(level));
    const swap = swapFromSysctl(swapusage);
    if (!pressure || used === null || !(total > 0) || !swap) return null;
    return {
      pressure,
      used,
      total,
      swapUsed: swap.used,
      swapTotal: swap.total,
    };
  } catch {
    return null;
  }
}
