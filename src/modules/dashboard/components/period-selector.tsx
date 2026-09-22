"use client";

import { useState } from "react";
import { inputClass, Label } from "@/components/ui/field";
import { PERIOD_PRESETS, type Period, type PeriodPreset } from "../domain/analytics";

/**
 * Period of the dashboard. A plain GET form: the server reads the params,
 * resolves the period and recomputes the aggregates.
 */
export function PeriodSelector({ period }: { period: Period }) {
  const [preset, setPreset] = useState<PeriodPreset>(period.preset);

  return (
    <form className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="preset">Periodo</Label>
        <select
          id="preset"
          name="preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value as PeriodPreset)}
          className={`${inputClass} w-52`}
        >
          {Object.entries(PERIOD_PRESETS).map(([value, { label }]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>
      {preset === "custom" && (
        <>
          <div>
            <Label htmlFor="from">Desde</Label>
            <input id="from" name="from" type="month" defaultValue={period.fromInput} className={`${inputClass} w-40`} />
          </div>
          <div>
            <Label htmlFor="to">Hasta</Label>
            <input id="to" name="to" type="month" defaultValue={period.toInput} className={`${inputClass} w-40`} />
          </div>
        </>
      )}
      <button className="rounded-md border border-ink-600 px-4 py-2 text-sm text-slate-200 transition hover:border-mint-500/60">
        Aplicar
      </button>
    </form>
  );
}
