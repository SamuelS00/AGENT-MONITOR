import { useCallback, useRef, useState } from "react";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type { MonitorNotification } from "../model/notifications";
import { usePersisted } from "./usePersisted";

/** Permission is requested only in response to opting in, never on mount or refresh. */
export function useNotifications(canLive: boolean) {
  const [stored, setStored] = usePersisted("am.notifyMe", false);
  const notifyMe = stored === true;
  const [notificationError, setError] = useState<string>();
  const enabled = useRef(notifyMe);
  const generation = useRef(0);
  const seen = useRef(new Set<string>());

  const setNotifyMe = useCallback(
    async (value: boolean) => {
      const attempt = ++generation.current;
      enabled.current = false;
      setStored(false);
      setError(undefined);
      if (!value) return;
      if (!canLive) {
        setError("Notifications are available in the desktop app.");
        return;
      }
      try {
        let granted = await isPermissionGranted();
        if (attempt !== generation.current) return;
        if (!granted) granted = (await requestPermission()) === "granted";
        if (attempt !== generation.current) return;
        enabled.current = granted;
        setStored(granted);
        if (!granted) setError("Notifications are blocked. Allow Agent Monitor in macOS notification settings, then try again.");
      } catch (error) {
        if (attempt === generation.current) setError(`Notifications unavailable: ${String(error)}`);
      }
    },
    [canLive, setStored],
  );

  const deliver = useCallback(
    async (events: MonitorNotification[]) => {
      // Mark events even while opted out: enabling notifications never replays old transitions.
      const fresh = events.filter((event) => {
        if (seen.current.has(event.key)) return false;
        seen.current.add(event.key);
        return true;
      });
      if (!canLive || !enabled.current || !fresh.length) return;
      const attempt = generation.current;
      try {
        if (!(await isPermissionGranted())) {
          setError("Notifications are blocked in macOS notification settings.");
          return;
        }
        if (!enabled.current || attempt !== generation.current) return;
        for (const event of fresh) sendNotification({ title: event.title, body: event.body });
      } catch (error) {
        setError(`Notifications unavailable: ${String(error)}`);
      }
    },
    [canLive],
  );

  return { notifyMe, setNotifyMe, notificationError, deliver };
}
