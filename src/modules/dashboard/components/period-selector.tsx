"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { inputClass, Label } from "@/components/ui/field";
import { PERIOD_PRESETS, type Period, type PeriodPreset } from "../domain/analytics";

/**
 * Period of the dashboard. A plain GET form: the server reads the params,
 * resolves the period and recomputes the aggregates.
 */
export function PeriodSelector({ period }: { period: Period }) {
  const t = useTranslations("dashboard.period");
  const tCommon = useTranslations("common.actions");
  const [preset, setPreset] = useState<PeriodPreset>(period.preset);

  return (
    <form className="flex flex-wrap items-end gap-2">
      <div>
        <Label htmlFor="preset">{t("label")}</Label>
        <select
          id="preset"
          name="preset"
          value={preset}
          onChange={(e) => setPreset(e.target.value as PeriodPreset)}
          className={`${inputClass} w-52`}
        >
          {(Object.keys(PERIOD_PRESETS) as PeriodPreset[]).map((value) => (
            <option key={value} value={value}>{t(value)}</option>
          ))}
        </select>
      </div>
      {preset === "custom" && (
        <>
          <div>
            <Label htmlFor="from">{t("from")}</Label>
            <input id="from" name="from" type="month" defaultValue={period.fromInput} className={`${inputClass} w-40`} />
          </div>
          <div>
            <Label htmlFor="to">{t("to")}</Label>
            <input id="to" name="to" type="month" defaultValue={period.toInput} className={`${inputClass} w-40`} />
          </div>
        </>
      )}
      <button className="rounded-md border border-ink-600 px-4 py-2 text-sm text-slate-200 transition hover:border-mint-500/60">
        {tCommon("apply")}
      </button>
    </form>
  );
}
