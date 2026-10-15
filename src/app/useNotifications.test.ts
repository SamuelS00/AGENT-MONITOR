import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { useNotifications } from "./useNotifications";

vi.mock("@tauri-apps/plugin-notification", () => ({
  isPermissionGranted: vi.fn(),
  requestPermission: vi.fn(),
  sendNotification: vi.fn(),
}));
const event = { key: "fixture-event", title: "Needs input", body: "Fixture agent", sources: ["fixture"] };
beforeEach(() => {
  localStorage.clear();
  vi.resetAllMocks();
  vi.mocked(isPermissionGranted).mockResolvedValue(false);
  vi.mocked(requestPermission).mockResolvedValue("granted");
});

describe("notification preference and delivery", () => {
  it("defaults off and never asks permission on mount or while disabled", async () => {
    const { result } = renderHook(() => useNotifications(true));
    expect(result.current.notifyMe).toBe(false);
    await act(() => result.current.deliver([event]));
    expect(isPermissionGranted).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("asks only on opt-in, persists the granted preference, and restores without prompting", async () => {
    const first = renderHook(() => useNotifications(true));
    await act(() => first.result.current.setNotifyMe(true));
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(first.result.current.notifyMe).toBe(true);
    expect(localStorage.getItem("am.notifyMe")).toBe("true");
    first.unmount();
    const restored = renderHook(() => useNotifications(true));
    expect(restored.result.current.notifyMe).toBe(true);
    expect(requestPermission).toHaveBeenCalledTimes(1);
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    await act(() => restored.result.current.deliver([event]));
    expect(sendNotification).toHaveBeenCalledWith({ title: event.title, body: event.body });
  });

  it("keeps the preference off and explains denied or failed permission", async () => {
    vi.mocked(requestPermission).mockResolvedValue("denied");
    const { result } = renderHook(() => useNotifications(true));
    await act(() => result.current.setNotifyMe(true));
    expect(result.current.notifyMe).toBe(false);
    expect(result.current.notificationError).toMatch(/blocked/);
    vi.mocked(isPermissionGranted).mockRejectedValue(new Error("fixture failure"));
    await act(() => result.current.setNotifyMe(true));
    expect(result.current.notifyMe).toBe(false);
    expect(result.current.notificationError).toMatch(/fixture failure/);
  });

  it("deduplicates delivery, does not replay opted-out events, and stops when disabled", async () => {
    vi.mocked(isPermissionGranted).mockResolvedValue(true);
    const { result } = renderHook(() => useNotifications(true));
    await act(() => result.current.deliver([event]));
    await act(() => result.current.setNotifyMe(true));
    await act(() => result.current.deliver([event]));
    expect(sendNotification).not.toHaveBeenCalled();
    const fresh = { ...event, key: "fixture-fresh" };
    await act(() => result.current.deliver([fresh, fresh]));
    await act(() => result.current.deliver([fresh]));
    expect(sendNotification).toHaveBeenCalledTimes(1);
    await act(() => result.current.setNotifyMe(false));
    await act(() => result.current.deliver([{ ...event, key: "fixture-disabled" }]));
    expect(sendNotification).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("am.notifyMe")).toBe("false");
  });

  it("does not prompt or send in a browser or after OS permission is revoked", async () => {
    const browser = renderHook(() => useNotifications(false));
    await act(() => browser.result.current.setNotifyMe(true));
    expect(requestPermission).not.toHaveBeenCalled();
    expect(browser.result.current.notifyMe).toBe(false);
    localStorage.setItem("am.notifyMe", "true");
    const desktop = renderHook(() => useNotifications(true));
    await act(() => desktop.result.current.deliver([event]));
    expect(sendNotification).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(desktop.result.current.notificationError).toMatch(/blocked/);
  });

  it("does not enable or deliver after an in-flight permission operation is disabled", async () => {
    let resolve!: (granted: boolean) => void;
    vi.mocked(isPermissionGranted).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useNotifications(true));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.setNotifyMe(true);
    });
    await act(() => result.current.setNotifyMe(false));
    await act(async () => {
      resolve(false);
      await pending;
    });
    expect(result.current.notifyMe).toBe(false);
    expect(requestPermission).not.toHaveBeenCalled();
  });
});
