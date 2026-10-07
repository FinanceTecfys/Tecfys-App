"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("erp.sync");
  const items = (["fetched", "created", "updated", "skipped", "invalid"] as const).map((key) => [key, counts[key]] as const);
  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs">
      {items.map(([key, n]) => (
        <div key={key} className="flex gap-1.5">
          <dt className="text-slate-500">{t(key)}</dt>
          <dd className={`num ${key === "invalid" && n > 0 ? "text-orange-300" : "text-slate-200"}`}>{n.toLocaleString("es-ES")}</dd>
        </div>
      ))}
    </dl>
  );
}

function Messages({ messages }: { messages: string[] }) {
  const t = useTranslations("erp.sync");
  if (!messages.length) return null;
  return (
    <details className="text-xs text-slate-400">
      <summary className="cursor-pointer hover:text-slate-200">{t("notices", { count: messages.length })}</summary>
      <ul className="mt-2 max-h-40 list-disc space-y-0.5 overflow-y-auto pl-5">
        {messages.map((m, i) => <li key={i}>{m}</li>)}
      </ul>
    </details>
  );
}

export function SyncPanel({ configured, lastRun }: { configured: boolean; lastRun: LastRunView | null }) {
  const t = useTranslations("erp.sync");
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
          {pending ? t("running") : t("run")}
        </Button>
        <p className="text-xs text-slate-400">
          {lastRun ? (
            <>
              {lastRun.source === "excel" ? t("lastImport") : t("lastSync")}{" "}
              <span className="text-slate-200">{fmtStamp(lastRun.finishedAt ?? lastRun.startedAt)}</span>
              {lastRun.status === "error" && <span className="text-red-300">{t("withError")}</span>}
              {lastRun.status === "running" && <span className="text-yellow-300">{t("inProgress")}</span>}
            </>
          ) : (
            t("never")
          )}
        </p>
      </div>
      {!configured && (
        <Alert tone="warning" title={t("notConfiguredTitle")}>
          {t("notConfiguredBody")}{" "}
          <code className="num">npm run import:holded -- &quot;file.xlsx&quot;</code>.
        </Alert>
      )}
      {result && !result.ok && <Alert tone="error" title={t("failedTitle")}>{result.error}</Alert>}
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
