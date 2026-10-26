"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { PlugZap } from "lucide-react";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { testInformaConnection } from "../actions";

type Feedback = { tone: "info" | "error"; text: string } | null;

/** Mirrors informaConfigStatus(): booleans and the base URL only, never the credentials. */
export interface InformaConfigView {
  baseUrl: string;
  baseUrlAllowed: boolean;
  hasUsername: boolean;
  hasPassword: boolean;
}

const Flag = ({ ok, okText, koText }: { ok: boolean; okText: string; koText: string }) =>
  ok ? <span className="text-mint-400">{okText}</span> : <span className="text-yellow-300">{koText}</span>;

export function InformaSettingsPanel({ config }: { config: InformaConfigView }) {
  const t = useTranslations("settings.informa");
  const [testing, startTest] = useTransition();
  const [test, setTest] = useState<Feedback>(null);
  const configured = config.baseUrlAllowed && config.hasUsername && config.hasPassword;

  return (
    <div className="space-y-4">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">{t("apiUrl")}</dt>
          <dd className="text-right">
            <span className="num break-all text-slate-300">{config.baseUrl}</span>
            {!config.baseUrlAllowed && <span className="block text-xs text-red-300">{t("urlNotAllowed")}</span>}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">{t("username")}</dt>
          <dd><Flag ok={config.hasUsername} okText={t("configuredM")} koText={t("notConfigured")} /></dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">{t("password")}</dt>
          <dd><Flag ok={config.hasPassword} okText={t("configuredF")} koText={t("notConfigured")} /></dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">{t("session")}</dt>
          <dd className="text-slate-300">{t("sessionAuto")}</dd>
        </div>
      </dl>
      <p className="text-xs text-slate-400">{t("help")}</p>
      <Button
        type="button"
        variant="secondary"
        disabled={!configured || testing}
        onClick={() =>
          startTest(async () => {
            const res = await testInformaConnection();
            setTest(res.ok ? { tone: "info", text: t("testOk", { ms: res.ms }) } : { tone: "error", text: res.error });
          })
        }
      >
        <PlugZap className="h-4 w-4" aria-hidden /> {testing ? t("testing") : t("test")}
      </Button>
      {test && <Alert tone={test.tone} title={test.tone === "info" ? t("testOkTitle") : t("testKoTitle")}>{test.text}</Alert>}
    </div>
  );
}
