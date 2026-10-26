"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Columns3 } from "lucide-react";

/**
 * Column chooser of a table: a button that opens a checklist of the columns.
 * Presentation only - the caller owns which columns are visible and where the
 * choice is kept.
 */
export function ColumnPicker({
  columns,
  visible,
  onToggle,
  onReset,
  canReset,
}: {
  columns: readonly { key: string; label: string; locked?: boolean }[];
  visible: readonly string[];
  onToggle: (key: string) => void;
  onReset: () => void;
  canReset: boolean;
}) {
  const t = useTranslations("loanBook.columnPicker");
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // Close on a click outside or on Escape, giving the focus back to the button.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={t("choose")}
        title={t("choose")}
        className="inline-flex items-center gap-2 rounded-md border border-ink-600 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-mint-500/60 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500"
      >
        <Columns3 className="h-4 w-4" aria-hidden />
        {t("button")}
        <span className="num text-slate-500">{visible.length}/{columns.length}</span>
      </button>
      {open && (
        <div
          id={panelId}
          role="group"
          aria-label={t("visible")}
          className="absolute right-0 z-20 mt-2 w-64 rounded-lg border border-ink-600 bg-ink-900 shadow-xl shadow-black/40"
        >
          <ul className="max-h-80 overflow-y-auto p-2">
            {columns.map((c) => (
              <li key={c.key}>
                <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 text-sm text-slate-200 hover:bg-ink-800 has-[:disabled]:cursor-default has-[:disabled]:text-slate-500">
                  <input
                    type="checkbox"
                    checked={visible.includes(c.key)}
                    disabled={c.locked}
                    onChange={() => onToggle(c.key)}
                    className="h-4 w-4 shrink-0 accent-mint-500"
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-3 border-t border-ink-700 px-4 py-2 text-xs">
            <span className="text-slate-500">{t("savedHere")}</span>
            <button type="button" onClick={onReset} disabled={!canReset} className="text-mint-400 hover:underline disabled:text-slate-600 disabled:no-underline">
              {t("reset")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
