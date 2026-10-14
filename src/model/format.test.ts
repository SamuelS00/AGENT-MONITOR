import { describe, expect, it } from "vitest";
import { confirmed, estimated, fmtAgo, fmtDuration, fmtTokens, unavailable } from "./format";

describe("fmtDuration", () => {
  it("formats each magnitude", () => {
    expect(fmtDuration(0)).toBe("0s");
    expect(fmtDuration(59_999)).toBe("59s");
    expect(fmtDuration(61_000)).toBe("1m 01s");
    expect(fmtDuration(3_660_000)).toBe("1h 01m");
    expect(fmtDuration(90_000_000)).toBe("1d 1h");
  });

  it("clamps negative durations to zero", () => {
    expect(fmtDuration(-5_000)).toBe("0s");
  });
});

describe("fmtTokens", () => {
  it("abbreviates thousands and millions", () => {
    expect(fmtTokens(999)).toBe("999");
    expect(fmtTokens(1_000)).toBe("1k");
    expect(fmtTokens(1_250)).toBe("1.3k");
    expect(fmtTokens(250_000)).toBe("250k");
    expect(fmtTokens(1_500_000)).toBe("1.5M");
  });
});

describe("fmtAgo", () => {
  const now = 1_000_000_000;
  it("describes elapsed time relative to now", () => {
    expect(fmtAgo(now - 2_000, now)).toBe("just now");
    expect(fmtAgo(now - 30_000, now)).toBe("30s ago");
    expect(fmtAgo(now - 5 * 60_000, now)).toBe("5m ago");
    expect(fmtAgo(now - 3 * 3_600_000, now)).toBe("3h ago");
    expect(fmtAgo(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("treats future timestamps as just now", () => {
    expect(fmtAgo(now + 60_000, now)).toBe("just now");
  });
});

describe("metric constructors", () => {
  it("keep reliability and source, and never invent a value", () => {
    expect(confirmed(3, "log")).toEqual({ value: 3, reliability: "confirmed", source: "log" });
    expect(estimated(3)).toEqual({ value: 3, reliability: "inferred", source: undefined });
    const na = unavailable<number>("db");
    expect(na).toEqual({ reliability: "unavailable", source: "db" });
    expect("value" in na).toBe(false);
  });
});
