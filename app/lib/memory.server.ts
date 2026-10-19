// How hard macOS is pressed for memory, for the board's header and the
// dispatch bar, which asks before starting another chat on a loaded Mac.
// See knowledge/memory-pressure.md.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import type { MemoryPressure } from "./board.ts";

const run = promisify(execFile);

// The kernel's level: 1 normal, 2 warning, 4 critical.
export function pressureFromLevel(level: number): MemoryPressure | null {
  if (!Number.isInteger(level) || level < 1) return null;
  if (level >= 4) return "critical";
  if (level >= 2) return "warn";
  return "normal";
}

// null where it can't be read, as off macOS.
export async function memoryPressure(): Promise<MemoryPressure | null> {
  try {
    const { stdout } = await run(
      "sysctl",
      ["-n", "kern.memorystatus_vm_pressure_level"],
      { timeout: 2_000 },
    );
    return pressureFromLevel(Number(stdout.trim()));
  } catch {
    return null;
  }
}
