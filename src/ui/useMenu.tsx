import { useCallback, useState, type MouseEvent as RMouseEvent } from "react";
import { Menu, type MenuItem } from "./primitives";

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
