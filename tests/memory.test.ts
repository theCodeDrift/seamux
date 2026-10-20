// How macOS's memory use and pressure level read (app/lib/memory.server.ts).

import { describe, expect, it } from "vitest";

import { memoryTitle } from "~/components/memory-pressure";
import {
  loadFromLevel,
  pressureFromLevel,
  swapFromSysctl,
  usedFromVmStat,
} from "~/lib/memory.server";

describe("pressureFromLevel", () => {
  it("reads the kernel's levels", () => {
    expect(pressureFromLevel(1)).toBe("normal");
    expect(pressureFromLevel(2)).toBe("warn");
    expect(pressureFromLevel(4)).toBe("critical");
  });

  it("gives nothing for what isn't a level", () => {
    expect(pressureFromLevel(0)).toBeNull();
    expect(pressureFromLevel(Number(""))).toBeNull();
    expect(pressureFromLevel(Number("abc"))).toBeNull();
  });
});

describe("loadFromLevel", () => {
  it("is what the kernel no longer counts as available", () => {
    expect(loadFromLevel(40)).toBe(60);
    expect(loadFromLevel(100)).toBe(0);
  });

  it("gives nothing for what isn't a percentage", () => {
    expect(loadFromLevel(Number(undefined))).toBeNull();
    expect(loadFromLevel(Number("abc"))).toBeNull();
    expect(loadFromLevel(101)).toBeNull();
  });
});

// vm_stat's output on macOS 26.5.1, cut to the lines it reads and one it
// doesn't.
const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     3113.
Pages wired down:                             233474.
Pages purgeable:                                   2.
Anonymous pages:                              241832.
Pages occupied by compressor:                 381442.
`;

describe("usedFromVmStat", () => {
  it("counts app memory, wired and compressed, as Activity Monitor does", () => {
    expect(usedFromVmStat(VM_STAT)).toBe(
      (241832 - 2 + 233474 + 381442) * 16384,
    );
  });

  it("gives nothing when a count is missing", () => {
    expect(usedFromVmStat(VM_STAT.replace(/^Pages wired.*$/m, ""))).toBeNull();
    expect(usedFromVmStat("")).toBeNull();
  });
});

describe("swapFromSysctl", () => {
  it("reads vm.swapusage", () => {
    expect(
      swapFromSysctl(
        "total = 9216.00M  used = 8105.19M  free = 1110.81M  (encrypted)",
      ),
    ).toEqual({ used: 8105.19 * 2 ** 20, total: 9216 * 2 ** 20 });
  });

  it("gives nothing for what isn't swap usage", () => {
    expect(swapFromSysctl("")).toBeNull();
  });
});

describe("memoryTitle", () => {
  it("says how much memory and swap are in use", () => {
    expect(
      memoryTitle({
        pressure: "warn",
        load: 60,
        used: 13 * 2 ** 30,
        total: 16 * 2 ** 30,
        swapUsed: 7.9 * 2 ** 30,
        swapTotal: 9 * 2 ** 30,
      }),
    ).toMatch(
      /^macOS counts 40% of memory as still available\. Using 13\.0 GB of 16\.0 GB memory, with 7\.9 GB of 9\.0 GB swap in use\. macOS reports memory pressure/,
    );
  });
});
