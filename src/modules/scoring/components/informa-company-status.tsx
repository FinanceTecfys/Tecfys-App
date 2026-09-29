import { Alert } from "@/components/ui/alert";
import { fmtDate, fmtEur, fmtNum } from "@/lib/format";
import type { InformaCompanyStatus, InformaRisk } from "../informa/map-informa-report";

/** Informa "código de vida" of the company, shown before any figure: a special situation must not go unnoticed. */
export function InformaCompanyStatusAlert({ status, risk }: { status: InformaCompanyStatus; risk: InformaRisk }) {
  const code = status.code ? `código de vida ${status.code}${status.literal ? ` (${status.literal})` : ""}` : "sin código de vida";
  const event = [status.subcode && `${status.subcodeLiteral ?? "subcódigo"} [${status.subcode}]`, status.detail].filter(Boolean).join(" · ");
  const since = status.since ? ` desde ${fmtDate(status.since)}` : "";

  const [tone, title] =
    status.severity === "alert"
      ? (["error", `Empresa en situación especial: ${status.subcodeLiteral ?? status.literal ?? status.code}`] as const)
      : status.severity === "warning"
        ? (["warning", `Incidencia registral: ${status.subcodeLiteral ?? "revisar estado"}`] as const)
        : status.severity === "unknown"
          ? (["warning", "Informa no indica el estado de la empresa"] as const)
          : (["info", "Empresa activa según Informa"] as const);

  const indicators = [
    risk.ratingInforma !== null && `Rating Informa ${risk.ratingInforma}`,
    risk.probabilidadFallo !== null && `probabilidad de fallo ${fmtNum(risk.probabilidadFallo, 2)} %`,
    risk.opinionCredito !== null && `opinión de crédito ${fmtEur(risk.opinionCredito)}`,
    risk.scoreLiquidez !== null && `score de liquidez ${risk.scoreLiquidez}`,
  ].filter(Boolean);

  return (
    <Alert tone={tone} title={title}>
      <p>
        Estado Informa: {code}
        {since}.{event && ` ${event}.`}
      </p>
      {indicators.length > 0 && <p className="mt-1 text-xs opacity-80">{indicators.join(" · ")} (informativo: el scoring usa el modelo Tecfys)</p>}
    </Alert>
  );
}
