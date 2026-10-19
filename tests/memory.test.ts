// How macOS's memory pressure level reads (app/lib/memory.server.ts).

import { describe, expect, it } from "vitest";

import { pressureFromLevel } from "~/lib/memory.server";

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
