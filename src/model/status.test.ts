import { describe, expect, it } from "vitest";
import { STATUS_HINT, STATUS_LABEL, STATUS_ORDER, isActive } from "./status";

describe("status", () => {
  it("has a label and hint for every ordered status", () => {
    expect(new Set(STATUS_ORDER).size).toBe(STATUS_ORDER.length);
    for (const s of STATUS_ORDER) {
      expect(STATUS_LABEL[s]).toBeTruthy();
      expect(STATUS_HINT[s]).toBeTruthy();
    }
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...STATUS_ORDER].sort());
  });

  it("treats only running, waiting and idle as active", () => {
    const active = STATUS_ORDER.filter(isActive);
    expect(active.sort()).toEqual(["idle", "running", "waiting"]);
  });
});
