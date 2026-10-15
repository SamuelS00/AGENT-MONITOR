import { isOrchestration } from "../model/orchestration";
import { useState } from "react";
import { useStore } from "../app/storeContext";
import { navFor } from "../ui/nav";
import { Banner, EmptyState, Kbd, Segmented } from "../ui/primitives";
import type { Capability } from "../model/types";
import type { SourceReliability } from "../types";

const TABS = ["Tools", "Data & privacy", "Appearance"] as const;
type Tab = (typeof TABS)[number];

const Setting = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="setting">
    <div className="grow">
      <div className="setting-title">{title}</div>
      {desc && <div className="setting-desc">{desc}</div>}
    </div>
    <div className="setting-ctl">{children}</div>
  </div>
);
const CAP: Record<SourceReliability, [string, string]> = {
  confirmed: ["●", "Confirmed"],
  inferred: ["◐", "Inferred"],
  unavailable: ["○", "Unavailable"],
};
const CAPS: [Capability, string][] = [
  ["process", "Process"],
  ["transcript", "Transcripts"],
  ["usage", "Usage"],
  ["hierarchy", "Hierarchy"],
];

export function Settings() {
  const [tab, setTab] = useState<Tab>("Tools");
  return (
    <div className="view settings">
      <nav className="settings-nav" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t} className={tab === t ? "on" : ""} aria-current={tab === t ? "page" : undefined} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </nav>
      <div className="scroll settings-body">
        <div className="settings-inner">
          <Banner>The monitor is read-only: it never writes to, or sends input to, an observed tool.</Banner>
          {tab === "Tools" && <Tools />}
          {tab === "Data & privacy" && <DataAndPrivacy />}
          {tab === "Appearance" && <Appearance />}
        </div>
      </div>
    </div>
  );
}

function Tools() {
  const { data } = useStore();
  if (!data.tools.length)
    return (
      <EmptyState title="No tools detected">Detection looks for known agent CLIs in running processes. Start one and refresh.</EmptyState>
    );
  return (
    <>
      <h2>Detected tools</h2>
      <p className="lede">What each adapter can actually observe. A circle marks the gap; nothing is assumed.</p>
      <div className="table">
        <div className="thead tools-grid">
          <span>Tool</span>
          {CAPS.map(([, l]) => (
            <span key={l}>{l}</span>
          ))}
        </div>
        {data.tools.map((t) => (
          <div key={t.name} className="trow tools-grid static">
            <span>
              <b>{t.name}</b>
              {t.version && <span className="muted mono"> {t.version}</span>}
              <span className="sub trunc mono">{t.path ?? "path unavailable"}</span>
              {t.note && <span className="sub">{t.note}</span>}
            </span>
            {CAPS.map(([c, l]) => (
              <span key={c} className={`cap cap-${t.capabilities[c]}`} aria-label={`${l}: ${CAP[t.capabilities[c]][1]}`}>
                <span aria-hidden>{CAP[t.capabilities[c]][0]}</span> {CAP[t.capabilities[c]][1]}
              </span>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function DataAndPrivacy() {
  // Facts about what the collector reads and keeps, not preferences: nothing here can be switched, because the
  // collector has no such options.
  const sources: [string, string][] = [
    ["Running processes", "Which agent CLIs are running and where. Standard user access."],
    ["Claude Code", "~/.claude/projects: transcripts and their subagents folders."],
    ["Codex", "~/.codex: rollout files, live and archived."],
    ["OpenCode", "~/.local/share/opencode/opencode.db, opened read-only."],
    ["Orca", "~/Library/Application Support/orca/orchestration.db, opened read-only: runs, workers and task titles."],
    ["Gemini CLI", "No session adapter yet. Process discovery only."],
  ];
  const keeps: [string, string][] = [
    ["Prompts and responses", "Never read or stored."],
    ["Process command lines", "Stored without flag values or free text, which can hold prompts or credentials."],
    [
      "Task titles",
      "Short titles the tools recorded themselves (Orca task, Claude subagent, OpenCode session), shown as what an agent works on.",
    ],
    ["Snapshots", "Metadata only, in a local SQLite database on this Mac. No account, no network traffic."],
  ];
  const never: [string, string][] = [
    ["Full Disk Access", "Not requested."],
    ["Control other apps", "Never requested. The monitor cannot drive or alter an agent."],
  ];
  return (
    <>
      <h2>Data &amp; privacy</h2>
      <p className="lede">Everything stays on this Mac. These are facts about the collector, not options.</p>
      <h3 className="mt">What it reads</h3>
      {sources.map(([t, d]) => (
        <Setting key={t} title={t} desc={d}>
          <span className="val-quiet">Read-only</span>
        </Setting>
      ))}
      <h3 className="mt">What it keeps</h3>
      {keeps.map(([t, d]) => (
        <Setting key={t} title={t} desc={d}>
          <span className="val-quiet" />
        </Setting>
      ))}
      <h3 className="mt">What it never asks for</h3>
      {never.map(([t, d]) => (
        <Setting key={t} title={t} desc={d}>
          <span className="val-quiet">Never</span>
        </Setting>
      ))}
    </>
  );
}

function Appearance() {
  const { data, index, theme, setTheme, density, setDensity, setSidebarW, setInspectorW } = useStore();
  const hasHistory = data.history.length > 0;
  const keys: [string, string][] = [
    ["⌘K", "Command palette"],
    [`⌘1–${navFor({ hasOrchestrations: index.roots.some(isOrchestration), hasHistory }).length}`, "Switch view"],
    ["⌘I", "Toggle inspector"],
    ["⌘\\", "Toggle sidebar"],
    ["⌘R", "Refresh"],
    ["↑ ↓ ← →", "Move and expand in trees"],
    ["*", "Expand everything below"],
    ["↵", "Open session in Explorer"],
  ];
  return (
    <>
      <h2>Appearance</h2>
      <Setting title="Theme" desc="Match system follows macOS appearance.">
        <Segmented
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Setting>
      <Setting title="Density" desc="Compact fits about 15% more rows.">
        <Segmented
          label="Density"
          value={density}
          onChange={setDensity}
          options={[
            { value: "regular", label: "Regular" },
            { value: "compact", label: "Compact" },
          ]}
        />
      </Setting>
      <Setting title="Pane sizes" desc="Drag a pane edge to resize it.">
        <button
          className="btn"
          onClick={() => {
            setSidebarW(216);
            setInspectorW(320);
          }}
        >
          Reset
        </button>
      </Setting>
      <h2 className="mt">Keyboard</h2>
      {keys.map(([k, d]) => (
        <Setting key={k} title={d}>
          <Kbd>{k}</Kbd>
        </Setting>
      ))}
    </>
  );
}
