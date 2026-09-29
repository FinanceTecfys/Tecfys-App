"use client";

import { useState, useTransition } from "react";
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
  const [testing, startTest] = useTransition();
  const [test, setTest] = useState<Feedback>(null);
  const configured = config.baseUrlAllowed && config.hasUsername && config.hasPassword;

  return (
    <div className="space-y-4">
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">URL de la API (INFORMA_API_URL)</dt>
          <dd className="text-right">
            <span className="num break-all text-slate-300">{config.baseUrl}</span>
            {!config.baseUrlAllowed && <span className="block text-xs text-red-300">No permitida: debe ser https y de un dominio informa.es</span>}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Usuario (INFORMA_USERNAME)</dt>
          <dd><Flag ok={config.hasUsername} okText="configurado" koText="sin configurar" /></dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Contraseña (INFORMA_PASSWORD)</dt>
          <dd><Flag ok={config.hasPassword} okText="configurada" koText="sin configurar" /></dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-slate-400">Sesión</dt>
          <dd className="text-slate-300">automática (POST /login)</dd>
        </div>
      </dl>
      <p className="text-xs text-slate-400">
        Configura el usuario y la contraseña del portal de Informa en el entorno del servidor (.env.local): nunca se
        guardan en la base de datos ni llegan al navegador. La aplicación obtiene la sesión sola con POST /login y la
        renueva cuando caduca (código 10005). La prueba inicia sesión y consulta la empresa de demostración A00000000.
      </p>
      <Button
        type="button"
        variant="secondary"
        disabled={!configured || testing}
        onClick={() =>
          startTest(async () => {
            const res = await testInformaConnection();
            setTest(res.ok ? { tone: "info", text: `Conexión correcta (${res.ms} ms)` } : { tone: "error", text: res.error });
          })
        }
      >
        <PlugZap className="h-4 w-4" aria-hidden /> {testing ? "Probando…" : "Probar conexión"}
      </Button>
      {test && <Alert tone={test.tone} title={test.tone === "info" ? "Informa responde" : "No se pudo conectar"}>{test.text}</Alert>}
    </div>
  );
}
