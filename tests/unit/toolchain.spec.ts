// Toolchain smoke test: proves vitest runs and TypeScript type-checks.
import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs the test runner", () => {
    expect(1 + 1).toBe(2);
  });
});
