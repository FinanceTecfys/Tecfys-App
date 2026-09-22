"use client";

import { useState, useTransition } from "react";
import { Check, Plus, X } from "lucide-react";
import { inputClass, Label } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export interface CatalogOption {
  id: string;
  name: string;
}

/**
 * Select over a catalog (distributors, asset types) that can create a new
 * entry inline without leaving the form.
 */
export function CatalogSelect({
  label,
  name,
  options,
  value,
  onChange,
  onCreate,
  placeholder = "— Selecciona —",
  error,
  createExtra,
}: {
  label: string;
  name: string;
  options: CatalogOption[];
  value: string | null;
  onChange: (id: string | null) => void;
  onCreate: (name: string) => Promise<{ ok: true; data: CatalogOption } | { ok: false; error: string }>;
  placeholder?: string;
  error?: string;
  /** Extra input rendered next to the name while creating (e.g. cluster for asset types). */
  createExtra?: React.ReactNode;
}) {
  const [items, setItems] = useState(options);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    const nameValue = draft.trim();
    if (!nameValue) return;
    startTransition(async () => {
      const res = await onCreate(nameValue);
      if (!res.ok) return setCreateError(res.error);
      setItems((prev) => [...prev, res.data].sort((a, b) => a.name.localeCompare(b.name)));
      onChange(res.data.id);
      setDraft("");
      setCreateError(null);
      setAdding(false);
    });
  };

  return (
    <div>
      <Label htmlFor={name}>{label}</Label>
      {adding ? (
        <div className="space-y-2">
          <div className="flex gap-1">
            <input
              autoFocus
              id={name}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
                if (e.key === "Escape") setAdding(false);
              }}
              placeholder="Nombre"
              className={cn(inputClass, "border-mint-500")}
            />
            <button type="button" onClick={submit} disabled={pending} aria-label="Guardar" className="rounded-md bg-mint-500 px-3 text-ink-950 hover:bg-mint-400 disabled:opacity-50">
              <Check className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => setAdding(false)} aria-label="Cancelar" className="rounded-md border border-ink-700 px-3 text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          {createExtra}
        </div>
      ) : (
        <div className="flex gap-1">
          <select id={name} name={name} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} className={inputClass}>
            <option value="">{placeholder}</option>
            {items.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setAdding(true)}
            aria-label={`Crear ${label.toLowerCase()}`}
            title={`Crear ${label.toLowerCase()}`}
            className="rounded-md border border-mint-500/50 px-3 text-mint-400 transition hover:border-mint-500 hover:bg-mint-500/10"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      )}
      {(createError || error) && <p className="mt-1 text-[11px] text-red-300">{createError ?? error}</p>}
    </div>
  );
}
