"use client";

import { useState, useTransition } from "react";
import { PlugZap } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { ErpSettings } from "../sync";
import { saveErpSettings, testHoldedConnection } from "../actions";

type Feedback = { tone: "info" | "error"; text: string } | null;

export function HoldedSettingsForm({ settings, configured }: { settings: ErpSettings; configured: boolean }) {
  const [saving, startSave] = useTransition();
  const [testing, startTest] = useTransition();
  const [saved, setSaved] = useState<Feedback>(null);
  const [test, setTest] = useState<Feedback>(null);

  return (
    <div className="space-y-4">
      <p className="text-xs text-slate-400">
        API key:{" "}
        {configured ? (
          <span className="text-mint-400">configurada en el servidor (HOLDED_API_KEY)</span>
        ) : (
          <span className="text-yellow-300">sin configurar: añade HOLDED_API_KEY a .env.local</span>
        )}
        . La clave nunca se guarda en la base de datos ni llega al navegador.
      </p>
      <form
        action={(fd) =>
          startSave(async () => {
            const res = await saveErpSettings({
              holded_base_url: String(fd.get("holded_base_url") ?? ""),
              include_credit_notes: fd.get("include_credit_notes") === "on",
              sync_lookback_days: String(fd.get("sync_lookback_days") ?? ""),
            });
            setSaved(res.ok ? { tone: "info", text: "Configuración guardada" } : { tone: "error", text: res.error });
          })
        }
        className="grid gap-3 md:grid-cols-[1fr_180px] md:items-end"
      >
        <Field label="URL base de la API" name="holded_base_url" defaultValue={settings.holded_base_url} required />
        <Field
          label="Días de solape"
          name="sync_lookback_days"
          type="number"
          min={0}
          max={365}
          defaultValue={settings.sync_lookback_days}
          hint="Re-lectura en cada sincronización incremental"
        />
        <label className="flex items-center gap-2 text-sm text-slate-300 md:col-span-2">
          <input type="checkbox" name="include_credit_notes" defaultChecked={settings.include_credit_notes} className="h-4 w-4 accent-mint-500" />
          Incluir facturas rectificativas (abonos)
        </label>
        <div className="flex flex-wrap gap-2 md:col-span-2">
          <Button type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar"}</Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!configured || testing}
            onClick={() =>
              startTest(async () => {
                const res = await testHoldedConnection();
                setTest(res.ok ? { tone: "info", text: `Conexión correcta (${res.data.ms} ms)` } : { tone: "error", text: res.error });
              })
            }
          >
            <PlugZap className="h-4 w-4" aria-hidden /> {testing ? "Probando…" : "Probar conexión"}
          </Button>
        </div>
      </form>
      {saved && <Alert tone={saved.tone}>{saved.text}</Alert>}
      {test && <Alert tone={test.tone} title={test.tone === "info" ? "Holded responde" : "No se pudo conectar"}>{test.text}</Alert>}
    </div>
  );
}
