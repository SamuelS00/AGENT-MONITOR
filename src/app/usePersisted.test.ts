import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { usePersisted } from "./usePersisted";

beforeEach(() => localStorage.clear());

describe("usePersisted", () => {
  it("uses the initial value and persists updates", () => {
    const { result } = renderHook(() => usePersisted("k", 1));
    expect(result.current[0]).toBe(1);
    act(() => result.current[1](2));
    expect(result.current[0]).toBe(2);
    expect(localStorage.getItem("k")).toBe("2");
  });

  it("restores a stored value", () => {
    localStorage.setItem("k", JSON.stringify({ a: true }));
    const { result } = renderHook(() => usePersisted("k", { a: false }));
    expect(result.current[0]).toEqual({ a: true });
  });

  it("falls back to the initial value on corrupt or blocked storage", () => {
    localStorage.setItem("k", "{not json");
    expect(renderHook(() => usePersisted("k", 5)).result.current[0]).toBe(5);
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => renderHook(() => usePersisted("other", 7))).not.toThrow();
    spy.mockRestore();
  });
});
