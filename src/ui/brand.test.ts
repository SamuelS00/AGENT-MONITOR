import { describe, expect, it } from "vitest";
import { brandOf, nodeBrandColor, splitModel } from "./brand";
import { confirmed, unavailable } from "../model/format";

describe("brandOf", () => {
  it("prefers the recorded provider over model and tool", () => {
    expect(brandOf("openai", "claude-x", "claude")).toBe("openai");
    expect(brandOf("Google", undefined, "codex")).toBe("google");
  });

  it("falls back to the model id, then the tool name", () => {
    expect(brandOf(undefined, "claude-sonnet-5-5", "x")).toBe("anthropic");
    expect(brandOf(undefined, "gpt-5", "x")).toBe("openai");
    expect(brandOf(undefined, "gemini-2.5-pro", "x")).toBe("google");
    expect(brandOf(undefined, undefined, "Codex CLI")).toBe("openai");
    expect(brandOf(undefined, undefined, "opencode")).toBe("opencode");
  });

  it("reports unknown instead of guessing", () => {
    expect(brandOf(undefined, "mystery", "tool")).toBe("unknown");
  });
});

describe("splitModel", () => {
  it("separates name and version, dropping dates and the claude prefix", () => {
    expect(splitModel("claude-sonnet-5-5")).toEqual({ name: "Sonnet", version: "5.5" });
    expect(splitModel("claude-haiku-4-5-20251001")).toEqual({ name: "Haiku", version: "4.5" });
  });

  it("keeps the full id when nothing can be parsed", () => {
    expect(splitModel("-").name).toBe("-");
  });
});

describe("nodeBrandColor", () => {
  it("colors a node by the model it ran, and not at all when the model is unavailable", () => {
    const base = { tool: "Orca", provider: undefined };
    expect(nodeBrandColor({ ...base, model: confirmed("claude-opus-5-5") })).toBe("#d97757");
    expect(nodeBrandColor({ ...base, model: confirmed("gpt-5.6-luna") })).toBe("#10a37f");
    expect(nodeBrandColor({ ...base, model: unavailable<string>() })).toBeUndefined();
  });
});
