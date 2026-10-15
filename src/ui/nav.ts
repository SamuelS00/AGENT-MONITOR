import { Activity, LayoutList, ChartNoAxesGantt, History, ListTree, Settings } from "lucide-react";
import type { View } from "../app/storeContext";

export interface NavItem {
  view: View;
  label: string;
  icon: typeof Activity;
  key: string;
}

const ALL: Omit<NavItem, "key">[] = [
  { view: "overview", label: "Overview", icon: LayoutList },
  { view: "monitor", label: "Monitor", icon: Activity },
  { view: "explorer", label: "Execution Explorer", icon: ListTree },
  { view: "timeline", label: "Timeline", icon: ChartNoAxesGantt },
  { view: "history", label: "History & Analytics", icon: History },
  { view: "settings", label: "Settings", icon: Settings },
];

/** What the user can reach right now. History needs stored sessions and the design reference is a sample-mode aid, so a
 *  screen that could only ever be empty or developer-facing is not offered. Shortcuts follow the visible order. */
export function navFor(opts: { hasOrchestrations: boolean; hasHistory: boolean }): NavItem[] {
  return ALL.filter((n) => (n.view !== "history" || opts.hasHistory) && (n.view !== "overview" || opts.hasOrchestrations)).map((n, i) => ({
    ...n,
    key: String(i + 1),
  }));
}

/** Whether a view may be shown for this data. `system` is the design reference, offered only with sample data. */
export function viewAvailable(view: View, opts: { hasOrchestrations: boolean; hasHistory: boolean; sample: boolean }): boolean {
  if (view === "overview") return opts.hasOrchestrations;
  if (view === "system") return opts.sample;
  if (view === "history") return opts.hasHistory;
  return true;
}
