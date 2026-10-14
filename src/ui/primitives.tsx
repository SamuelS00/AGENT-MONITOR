import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type MouseEvent as RMouseEvent } from "react";
import type { AgentStatus, Metric } from "../model/types";
import { STATUS_LABEL } from "../model/status";

/* Status glyph: shape + color + label. Never color alone. */
export function StatusGlyph({ status, size = 12, label = false }: { status: AgentStatus; size?: number; label?: boolean }) {
  const c = `var(--status-${status})`;
  const g = (() => {
    switch (status) {
      case "running":
        return (
          <>
            <circle className="glyph-pulse" cx="6" cy="6" r="3.2" fill="none" stroke={c} strokeWidth="1.2" />
            <circle cx="6" cy="6" r="3.2" fill={c} />
          </>
        );
      case "waiting":
        return (
          <>
            <circle cx="6" cy="6" r="4.2" fill="none" stroke={c} strokeWidth="1.3" />
            <path d="M6 1.8a4.2 4.2 0 0 0 0 8.4Z" fill={c} />
          </>
        );
      case "completed":
        return <path d="M2.4 6.4 5 9l4.8-5.6" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />;
      case "failed":
        return (
          <>
            <rect x="1.6" y="1.6" width="8.8" height="8.8" rx="2.2" fill={c} />
            <path d="m4.3 4.3 3.4 3.4M7.7 4.3 4.3 7.7" stroke="var(--surface-content)" strokeWidth="1.4" strokeLinecap="round" />
          </>
        );
      case "disconnected":
        return <circle cx="6" cy="6" r="4.1" fill="none" stroke={c} strokeWidth="1.3" strokeDasharray="1.9 1.9" />;
      case "idle":
        return <circle cx="6" cy="6" r="4.1" fill="none" stroke={c} strokeWidth="1.3" />;
      default:
        return <path d="M6 1.7 10.3 6 6 10.3 1.7 6Z" fill="none" stroke={c} strokeWidth="1.3" strokeLinejoin="round" />;
    }
  })();
  return (
    <span className={`status status-${status}`} title={STATUS_LABEL[status]}>
      <svg width={size} height={size} viewBox="0 0 12 12" role="img" aria-label={STATUS_LABEL[status]}>
        {g}
      </svg>
      {label && <span className="status-label">{STATUS_LABEL[status]}</span>}
    </span>
  );
}

/* Metric display. Confirmed: plain. Estimated: "≈" + dotted underline. Unavailable: dash or word. */
export function Val<T>({
  m,
  fmt,
  verbose = false,
  lowerBound = false,
}: {
  m: Metric<T>;
  fmt: (v: T) => string;
  verbose?: boolean;
  lowerBound?: boolean;
}) {
  if (m.reliability === "unavailable" || m.value === undefined)
    return (
      <span className="val val-na" title={`Unavailable${m.source ? ` · ${m.source}` : ""}`} aria-label="Unavailable">
        {verbose ? "Unavailable" : "—"}
      </span>
    );
  const text = fmt(m.value);
  if (m.reliability === "inferred")
    return (
      <span className="val val-est" title={`Inferred or estimated${m.source ? ` · ${m.source}` : ""}`}>
        <span aria-hidden>{lowerBound ? "≥" : "≈"}</span>
        {text}
        <span className="sr-only"> (estimated)</span>
      </span>
    );
  return (
    <span className="val" title={m.source ? `Confirmed · ${m.source}` : undefined}>
      {lowerBound && (
        <span aria-hidden title="Lower bound: some agents report no usage">
          ≥
        </span>
      )}
      {text}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; title?: string }[];
  label: string;
}) {
  return (
    <div className="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          className={o.value === value ? "on" : ""}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function SkeletonRows({ n = 6 }: { n?: number }) {
  return (
    <div className="skeleton" aria-busy="true" aria-label="Loading">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="sk-row" style={{ ["--w" as string]: `${55 + ((i * 17) % 35)}%` }} />
      ))}
    </div>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "warn" | "error"; children: ReactNode }) {
  return (
    <div className={`banner banner-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

/* Drag handle for resizable panes. dir=1 grows when dragging right. */
export function Resizer({ onDrag, onReset, side }: { onDrag: (dx: number) => void; onReset: () => void; side: "left" | "right" }) {
  const start = useRef(0);
  const down = (e: RMouseEvent) => {
    start.current = e.clientX;
    e.preventDefault();
    const move = (m: MouseEvent) => {
      onDrag(m.clientX - start.current);
      start.current = m.clientX;
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.classList.remove("resizing");
    };
    document.body.classList.add("resizing");
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };
  return (
    <div
      className={`resizer resizer-${side}`}
      role="separator"
      aria-orientation="vertical"
      onMouseDown={down}
      onDoubleClick={onReset}
      title="Drag to resize, double-click to reset"
    />
  );
}

/* Menus */
export interface MenuItem {
  label: string;
  shortcut?: string;
  onSelect?: () => void;
  disabled?: boolean;
  separator?: boolean;
  checked?: boolean;
}

export function Menu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });
  const [active, setActive] = useState(-1);
  const enabled = items.map((it, i) => (it.separator || it.disabled ? -1 : i)).filter((i) => i >= 0);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(x, window.innerWidth - r.width - 8), y: Math.min(y, window.innerHeight - r.height - 8) });
    ref.current?.focus();
  }, [x, y]);
  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", away);
    window.addEventListener("blur", onClose);
    return () => {
      window.removeEventListener("mousedown", away);
      window.removeEventListener("blur", onClose);
    };
  }, [onClose]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const d = e.key === "ArrowDown" ? 1 : -1;
      const i = enabled.indexOf(active);
      setActive(enabled[(i + d + enabled.length) % enabled.length] ?? enabled[0]);
    } else if (e.key === "Enter" && active >= 0) {
      items[active].onSelect?.();
      onClose();
    }
  };
  return (
    <div
      ref={ref}
      className="menu"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={key}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" role="separator" />
        ) : (
          <button
            key={i}
            role="menuitem"
            disabled={it.disabled}
            className={i === active ? "active" : ""}
            onMouseEnter={() => setActive(i)}
            onClick={() => {
              it.onSelect?.();
              onClose();
            }}
          >
            <span className="menu-check">{it.checked ? "✓" : ""}</span>
            <span className="menu-label">{it.label}</span>
            {it.shortcut && <Kbd>{it.shortcut}</Kbd>}
          </button>
        ),
      )}
    </div>
  );
}

export function useMenu() {
  const [m, setM] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const close = useCallback(() => setM(null), []);
  const open = useCallback((e: RMouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setM({ x: e.clientX, y: e.clientY, items });
  }, []);
  const openAt = useCallback((el: HTMLElement, items: MenuItem[]) => {
    const r = el.getBoundingClientRect();
    setM({ x: r.left, y: r.bottom + 4, items });
  }, []);
  return { open, openAt, node: m ? <Menu {...m} onClose={close} /> : null };
}

export const copy = (text: string) => {
  void navigator.clipboard?.writeText(text).catch(() => undefined);
};
