"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

export type MenuItem =
  | { kind: "separator" }
  | {
      kind?: "item";
      label: string;
      href?: string;
      onSelect?: () => void;
      disabled?: boolean;
      /** Shown under the label — e.g. why an item is disabled. */
      hint?: string;
      danger?: boolean;
    };

// A "⋯" menu for table rows. The popup is `position: fixed`, placed from the
// trigger's bounding box, because the tables that use it sit inside an
// `overflow-x-auto` card — an absolutely positioned menu would be clipped by
// it on the last rows. Closes on outside click, Escape, scroll and resize.
export function ActionMenu({ items, label = "Actions" }: { items: MenuItem[]; label?: string }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const open = pos !== null;

  useEffect(() => {
    if (!open) return;
    const close = () => setPos(null);
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menu.current?.contains(target) || trigger.current?.contains(target)) return;
      close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        trigger.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) return setPos(null);
    const r = trigger.current?.getBoundingClientRect();
    if (!r) return;
    // Open upward when there isn't room below (a long menu on a low row).
    const menuHeight = items.length * 36 + 16;
    const below = r.bottom + 4;
    const top = below + menuHeight > window.innerHeight ? Math.max(8, r.top - menuHeight - 4) : below;
    setPos({ top, right: Math.max(8, window.innerWidth - r.right) });
  }

  const itemClass = (danger?: boolean, disabled?: boolean) =>
    `block w-full px-3 py-2 text-left text-sm ${
      disabled
        ? "cursor-not-allowed text-text-muted opacity-60"
        : danger
          ? "text-error hover:bg-error/10"
          : "text-text-dark hover:bg-surface"
    }`;

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] text-lg leading-none text-text-medium hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        ⋯
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          style={{ position: "fixed", top: pos.top, right: pos.right }}
          className="z-50 w-60 overflow-hidden rounded-[var(--radius-sm)] border border-dark-border/60 bg-white py-1 shadow-[var(--shadow-card)]"
        >
          {items.map((item, i) => {
            if (item.kind === "separator") {
              return <div key={i} role="separator" className="my-1 border-t border-dark-border/60" />;
            }
            const body = (
              <>
                <span className="block font-medium">{item.label}</span>
                {item.hint && <span className="block text-xs font-normal text-text-muted">{item.hint}</span>}
              </>
            );
            if (item.href && !item.disabled) {
              return (
                <Link key={i} role="menuitem" href={item.href} onClick={() => setPos(null)} className={itemClass(item.danger)}>
                  {body}
                </Link>
              );
            }
            return (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setPos(null);
                  item.onSelect?.();
                }}
                className={itemClass(item.danger, item.disabled)}
              >
                {body}
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
