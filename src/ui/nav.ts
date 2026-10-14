import { Activity, ChartNoAxesGantt, History, ListTree, Settings } from "lucide-react";
import type { View } from "../app/storeContext";

export const NAV: { view: View; label: string; icon: typeof Activity; key: string }[] = [
  { view: "monitor", label: "Monitor", icon: Activity, key: "1" },
  { view: "explorer", label: "Execution Explorer", icon: ListTree, key: "2" },
  { view: "timeline", label: "Timeline", icon: ChartNoAxesGantt, key: "3" },
  { view: "history", label: "History & Analytics", icon: History, key: "4" },
  { view: "settings", label: "Settings", icon: Settings, key: "5" },
];
