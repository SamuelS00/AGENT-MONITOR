import { useState } from "react";
import { usePersisted } from "../app/usePersisted";
import { useStore } from "../app/storeContext";
import { Banner, EmptyState, Kbd, Segmented } from "../ui/primitives";
import type { Capability } from "../model/types";
import type { SourceReliability } from "../types";

const TABS = ["Tools", "Integrations", "Permissions", "Privacy", "Appearance"] as const;
type Tab = (typeof TABS)[number];

function Switch({ on, onChange, label, disabled }: { on: boolean; onChange?: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} disabled={disabled} className="switch" onClick={() => onChange?.(!on)}>
      <i />
    </button>
  );
}
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
          <Banner>
            Prototype: preferences are saved on this Mac but the collector does not read them yet. The monitor never writes to observed
            tools.
          </Banner>
          {tab === "Tools" && <Tools />}
          {tab === "Integrations" && <Integrations />}
          {tab === "Permissions" && <Permissions />}
          {tab === "Privacy" && <Privacy />}
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

function Integrations() {
  const [on, setOn] = usePersisted<Record<string, boolean>>("am.integrations", { claude: true, codex: true, opencode: true });
  const items: [string, string, string, boolean][] = [
    ["claude", "Claude Code session files", "~/.claude/projects (read-only)", true],
    ["codex", "Codex session files", "~/.codex/sessions (read-only)", true],
    ["opencode", "OpenCode storage", "~/.local/share/opencode (read-only)", true],
    ["gemini", "Gemini CLI", "No session adapter yet. Process discovery only.", false],
  ];
  return (
    <>
      <h2>Integrations</h2>
      <p className="lede">Adapters read local files the tools already write. They never send input to, or change, a running session.</p>
      <Setting title="Process discovery" desc="Lists running agent CLIs and their working directories.">
        <span className="val-quiet">Always on</span>
      </Setting>
      {items.map(([k, t, d, avail]) => (
        <Setting key={k} title={t} desc={d}>
          <Switch on={avail && (on[k] ?? false)} disabled={!avail} label={t} onChange={(v) => setOn({ ...on, [k]: v })} />
        </Setting>
      ))}
    </>
  );
}

function Permissions() {
  const rows: [string, string, string][] = [
    ["Process listing", "Read which agent CLIs are running.", "Standard user access"],
    ["Files in your home folder", "Read session files written by agent tools.", "Not checked"],
    ["Full Disk Access", "Not requested. Only needed for protected folders.", "Not required"],
    ["Control other apps", "Never requested. The monitor cannot drive or alter an agent.", "Never"],
  ];
  return (
    <>
      <h2>Permissions</h2>
      <p className="lede">macOS permissions the monitor uses, and the ones it deliberately never asks for.</p>
      {rows.map(([t, d, s]) => (
        <Setting key={t} title={t} desc={d}>
          <span className="val-quiet">{s}</span>
        </Setting>
      ))}
    </>
  );
}

function Privacy() {
  const [redact, setRedact] = usePersisted("am.redact", true);
  const [paths, setPaths] = usePersisted("am.paths", true);
  const [ret, setRet] = usePersisted("am.retention", "30");
  return (
    <>
      <h2>Privacy &amp; local collection</h2>
      <p className="lede">Everything stays in a local database on this Mac. No account, no network traffic.</p>
      <Setting title="Store prompts and responses" desc="Message content is never collected.">
        <Switch on={false} disabled label="Store prompts" />
      </Setting>
      <Setting title="Store working directory paths" desc="Needed to group sessions by project.">
        <Switch on={paths} onChange={setPaths} label="Store paths" />
      </Setting>
      <Setting title="Shorten home folder to ~" desc="Applies to paths shown in the interface.">
        <Switch on={redact} onChange={setRedact} label="Shorten home" />
      </Setting>
      <Setting title="Keep history for">
        <select className="field" value={ret} onChange={(e) => setRet(e.target.value)} aria-label="Retention">
          <option value="7">7 days</option>
          <option value="30">30 days</option>
          <option value="90">90 days</option>
          <option value="0">Forever</option>
        </select>
      </Setting>
      <Setting title="Clear local history" desc="Not available in this prototype.">
        <button className="btn" disabled>
          Clear…
        </button>
      </Setting>
    </>
  );
}

function Appearance() {
  const { theme, setTheme, density, setDensity, setSidebarW, setInspectorW } = useStore();
  const keys: [string, string][] = [
    ["⌘K", "Command palette"],
    ["⌘1–5", "Switch view"],
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
