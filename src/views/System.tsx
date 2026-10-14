import { useCallback, useState, useSyncExternalStore } from "react";
import { useStore } from "../app/storeContext";
import { STATUS_HINT, STATUS_LABEL, STATUS_ORDER } from "../model/status";
import { confirmed, estimated, unavailable, fmtTokens } from "../model/format";
import { Banner, Kbd, Segmented, StatusGlyph, Val } from "../ui/primitives";

const COLOR_GROUPS: [string, string[]][] = [
  [
    "Surface",
    [
      "surface-sidebar",
      "surface-content",
      "surface-raised",
      "surface-inspector",
      "surface-sunken",
      "surface-hover",
      "surface-active",
      "surface-selected",
    ],
  ],
  ["Line", ["line-subtle", "line-default", "line-strong"]],
  ["Text", ["text-primary", "text-secondary", "text-tertiary"]],
  ["Accent", ["accent", "accent-solid"]],
  ["Status", ["status-running", "status-waiting", "status-failed", "status-completed", "status-disconnected"]],
];

const noopSubscribe = () => () => {};

function Swatch({ name }: { name: string }) {
  // CSS custom properties live in the DOM, outside React state. useSyncExternalStore
  // re-reads them on every render, so the value follows theme changes without an effect.
  const getSnapshot = useCallback(() => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim(), [name]);
  const val = useSyncExternalStore(noopSubscribe, getSnapshot, () => "");
  return (
    <div className="swatch">
      <i style={{ background: `var(--${name})` }} />
      <span className="mono">--{name}</span>
      <span className="muted mono">{val}</span>
    </div>
  );
}

const Block = ({ id, title, children }: { id: string; title: string; children: React.ReactNode }) => (
  <section id={id} className="sys-block">
    <h2>{title}</h2>
    {children}
  </section>
);

export function System() {
  const { theme, setTheme } = useStore();
  const [seg, setSeg] = useState<"a" | "b">("a");
  return (
    <div className="view">
      <div className="subbar">
        <span className="muted">Living reference. Everything below renders from the same tokens and components the app uses.</span>
        <div className="grow" />
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
      </div>
      <div className="scroll">
        <div className="sys">
          <Block id="principles" title="Principles">
            <ol className="principles">
              <li>
                <b>Evidence over decoration.</b> Every value shows where it came from: confirmed, estimated or unavailable.
              </li>
              <li>
                <b>Lists before cards.</b> Rows, trees and tables carry the data. Containers are for grouping, not for decoration.
              </li>
              <li>
                <b>Color is a second channel.</b> Status uses a distinct glyph and a word. Accent marks selection and focus only.
              </li>
              <li>
                <b>Read-only, visibly.</b> No control implies it can change an observed process.
              </li>
              <li>
                <b>Native density.</b> 13px base, 28px rows, 4px grid. Hierarchy comes from weight and tone, not size or shadow.
              </li>
              <li>
                <b>Keyboard first.</b> Every list is navigable by arrows, every action is in the command palette.
              </li>
            </ol>
          </Block>
          <Block id="color" title="Color tokens">
            {COLOR_GROUPS.map(([g, names]) => (
              <div key={g}>
                <h3>{g}</h3>
                <div className="swatches">
                  {names.map((n) => (
                    <Swatch key={n} name={n} />
                  ))}
                </div>
              </div>
            ))}
          </Block>
          <Block id="type" title="Typography">
            <div className="type-list">
              {(
                [
                  ["xl", "20", "View titles, empty state headline (rare)"],
                  ["lg", "15", "Inspector title"],
                  ["md", "13", "Body, rows, controls"],
                  ["sm", "12", "Secondary text, sub-lines"],
                  ["xs", "11", "Column headers, tags, shortcuts"],
                ] as const
              ).map(([k, px, use]) => (
                <div key={k} className="type-row">
                  <span style={{ fontSize: `var(--fs-${k})` }}>Orchestrator → Agent → Subagent</span>
                  <span className="muted mono">
                    --fs-{k} · {px}px · {use}
                  </span>
                </div>
              ))}
              <div className="type-row">
                <span className="mono">claude-sonnet-5-5 · 182,400 · 14m 08s · pid 48213</span>
                <span className="muted mono">--font-mono · models, ids, numbers, paths. Tabular figures on.</span>
              </div>
            </div>
          </Block>
          <Block id="space" title="Space and radius">
            <div className="space-row">
              {[
                ["0", 2],
                ["1", 4],
                ["2", 6],
                ["3", 8],
                ["4", 12],
                ["5", 16],
                ["6", 24],
              ].map(([k, v]) => (
                <div key={k}>
                  <i style={{ width: Number(v), height: Number(v) }} />
                  <span className="mono muted">
                    sp-{k} {v}
                  </span>
                </div>
              ))}
            </div>
            <div className="space-row">
              {[
                ["xs", 3],
                ["sm", 5],
                ["md", 7],
                ["lg", 10],
              ].map(([k, v]) => (
                <div key={k}>
                  <i className="rad" style={{ borderRadius: Number(v) }} />
                  <span className="mono muted">
                    r-{k} {v}
                  </span>
                </div>
              ))}
            </div>
          </Block>
          <Block id="status" title="Status">
            <div className="table">
              {STATUS_ORDER.map((s) => (
                <div key={s} className="trow static sys-status">
                  <StatusGlyph status={s} />
                  <b>{STATUS_LABEL[s]}</b>
                  <span className="muted">{STATUS_HINT[s]}</span>
                </div>
              ))}
            </div>
          </Block>
          <Block id="reliability" title="Data reliability">
            <div className="table">
              <div className="trow static sys-status">
                <Val m={confirmed(182400)} fmt={fmtTokens} />
                <b>Confirmed</b>
                <span className="muted">Read directly from the tool's own record. Plain text.</span>
              </div>
              <div className="trow static sys-status">
                <Val m={estimated(12000)} fmt={fmtTokens} />
                <b>Estimated</b>
                <span className="muted">Derived, e.g. from output size. Prefixed with ≈ and underlined.</span>
              </div>
              <div className="trow static sys-status">
                <Val m={unavailable<number>()} fmt={fmtTokens} />
                <b>Unavailable</b>
                <span className="muted">Source does not provide it. Dash in tables, the word in the inspector. Never zero.</span>
              </div>
              <div className="trow static sys-status">
                <Val m={confirmed(310000)} fmt={fmtTokens} lowerBound />
                <b>Lower bound</b>
                <span className="muted">A sum where some members are unavailable.</span>
              </div>
              <div className="trow static sys-status">
                <span className="rel rel-confirmed">Confirmed</span>
                <b>Edge: confirmed</b>
                <span className="muted">Solid guide line. Delegation is recorded by the tool.</span>
              </div>
              <div className="trow static sys-status">
                <span className="tag tag-inf">inferred</span>
                <b>Edge: inferred</b>
                <span className="muted">Dotted guide line. Process ancestry only; never presented as delegation.</span>
              </div>
            </div>
          </Block>
          <Block id="components" title="Components">
            <h3>Buttons and controls</h3>
            <div className="demo-row">
              <button className="btn">Default</button>
              <button className="btn btn-primary">Primary</button>
              <button className="btn" disabled>
                Disabled
              </button>
              <button className="icon-btn" aria-label="Icon">
                ⌘
              </button>
              <button className="icon-btn on" aria-label="Pressed">
                ⌘
              </button>
              <Segmented
                label="Demo"
                value={seg}
                onChange={setSeg}
                options={[
                  { value: "a", label: "Tree" },
                  { value: "b", label: "Graph" },
                ]}
              />
              <input className="field" placeholder="Field" aria-label="Demo field" />
              <Kbd>⌘K</Kbd>
              <span className="tag">3 parallel</span>
              <span className="tag tag-par">∥</span>
              <span className="tag tag-inf">inferred</span>
            </div>
            <h3>Row states</h3>
            <div className="table demo-rows">
              {(
                [
                  ["Default", ""],
                  ["Hover", "hover-demo"],
                  ["Selected", "selected"],
                  ["Selected, pane unfocused", "selected unfocused-demo"],
                ] as const
              ).map(([l, c]) => (
                <div key={l} className={`trow demo-grid ${c}`}>
                  <StatusGlyph status="running" />
                  <span>Refactor handlers</span>
                  <span className="muted">{l}</span>
                </div>
              ))}
            </div>
            <h3>Feedback</h3>
            <div className="demo-col">
              <Banner>Info: sample data is shown instead of live observations.</Banner>
              <Banner tone="warn">Warn: the Codex adapter reports usage only after a session ends.</Banner>
              <Banner tone="error">Error: collector failed to read process list.</Banner>
              <div className="skeleton demo-sk">
                <div className="sk-row" style={{ ["--w" as string]: "72%" }} />
                <div className="sk-row" style={{ ["--w" as string]: "54%" }} />
              </div>
            </div>
          </Block>
          <Block id="motion" title="Motion">
            <p className="lede">
              90ms for hover and press, 160ms for panes and menus, <span className="mono">cubic-bezier(.2,.8,.2,1)</span>. The only looping
              animation is the running-state ring. All motion stops under reduced-motion.
            </p>
          </Block>
        </div>
      </div>
    </div>
  );
}
