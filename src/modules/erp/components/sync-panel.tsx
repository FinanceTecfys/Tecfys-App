"use client";

import { useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { SyncCounts } from "../domain/sync-plan";
import { syncHolded } from "../actions";

export interface LastRunView {
  source: string;
  status: string;
  finishedAt: string | null;
  startedAt: string;
  counts: SyncCounts;
  error: string | null;
  messages: string[];
}

const fmtStamp = (iso: string) =>
  new Date(iso).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Madrid" });

function Counts({ counts }: { counts: SyncCounts }) {
  const items: [string, number][] = [
    ["Leídas", counts.fetched],
    ["Creadas", counts.created],
    ["Actualizadas", counts.updated],
    ["Sin cambios", counts.skipped],
    ["Descartadas", counts.invalid],
  ];
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {items.map(([label, n]) => (
        <div key={label} className="flex gap-1.5">
          <dt className="text-slate-500">{label}</dt>
          <dd className={`num ${label === "Descartadas" && n > 0 ? "text-orange-300" : "text-slate-200"}`}>{n.toLocaleString("es-ES")}</dd>
        </div>
      ))}
    </dl>
  );
}

function Messages({ messages }: { messages: string[] }) {
  if (!messages.length) return null;
  return (
    <details className="text-xs text-slate-400">
      <summary className="cursor-pointer hover:text-slate-200">{messages.length} avisos</summary>
      <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </details>
  );
}

export function SyncPanel({ configured, lastRun }: { configured: boolean; lastRun: LastRunView | null }) {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ ok: true; counts: SyncCounts; messages: string[] } | { ok: false; error: string } | null>(null);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="button"
          disabled={!configured || pending}
          onClick={() =>
            start(async () => {
              const res = await syncHolded();
              setResult(res.ok ? { ok: true, ...res.data } : res);
            })
          }
        >
          <RefreshCw className={`h-4 w-4 ${pending ? "animate-spin" : ""}`} aria-hidden />
          {pending ? "Sincronizando…" : "Sincronizar con Holded"}
        </Button>
        <p className="text-xs text-slate-400">
          {lastRun ? (
            <>
              Última {lastRun.source === "excel" ? "importación (Excel)" : "sincronización"}:{" "}
              <span className="text-slate-200">{fmtStamp(lastRun.finishedAt ?? lastRun.startedAt)}</span>
              {lastRun.status === "error" && <span className="text-red-300"> · con error</span>}
              {lastRun.status === "running" && <span className="text-yellow-300"> · en curso</span>}
            </>
          ) : (
            "Todavía no se ha sincronizado."
          )}
        </p>
      </div>
      {!configured && (
        <Alert tone="warning" title="API de Holded sin configurar">
          Añade HOLDED_API_KEY al entorno del servidor (.env.local) y reinicia. Mientras tanto puedes cargar el Excel de Holded con{" "}
          <code className="num">npm run import:holded -- &quot;ruta.xlsx&quot;</code>.
        </Alert>
      )}
      {result && !result.ok && <Alert tone="error" title="La sincronización ha fallado">{result.error}</Alert>}
      {result?.ok ? (
        <div className="space-y-2">
          <Counts counts={result.counts} />
          <Messages messages={result.messages} />
        </div>
      ) : (
        !result &&
        lastRun && (
          <div className="space-y-2">
            <Counts counts={lastRun.counts} />
            {lastRun.error && <p className="text-xs text-red-300">{lastRun.error}</p>}
            <Messages messages={lastRun.messages} />
          </div>
        )
      )}
    </div>
  );
}
