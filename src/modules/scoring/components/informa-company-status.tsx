import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { fmtDate, fmtEur, fmtNum } from "@/lib/format";
import type { InformaCompanyStatus, InformaRisk } from "../informa/map-informa-report";

/**
 * Informa "código de vida" of the company, shown before any figure: a special situation must not go unnoticed.
 * The literals (status.literal, subcodeLiteral, detail) are Informa's own data and are shown as received.
 */
export function InformaCompanyStatusAlert({ status, risk }: { status: InformaCompanyStatus; risk: InformaRisk }) {
  const t = useTranslations("scoring.informa.status");
  const code = status.code ? `${t("lifeCode", { code: status.code })}${status.literal ? ` (${status.literal})` : ""}` : t("noLifeCode");
  const event = [status.subcode && `${status.subcodeLiteral ?? t("subcode")} [${status.subcode}]`, status.detail].filter(Boolean).join(" · ");
  const since = status.since ? t("since", { date: fmtDate(status.since) }) : "";

  const [tone, title] =
    status.severity === "alert"
      ? (["error", t("alertTitle", { detail: status.subcodeLiteral ?? status.literal ?? status.code ?? "" })] as const)
      : status.severity === "warning"
        ? (["warning", t("warningTitle", { detail: status.subcodeLiteral ?? t("reviewStatus") })] as const)
        : status.severity === "unknown"
          ? (["warning", t("unknownTitle")] as const)
          : (["info", t("okTitle")] as const);

  const indicators = [
    risk.ratingInforma !== null && t("ratingInforma", { value: risk.ratingInforma }),
    risk.probabilidadFallo !== null && t("failureProbability", { value: fmtNum(risk.probabilidadFallo, 2) }),
    risk.opinionCredito !== null && t("creditOpinion", { value: fmtEur(risk.opinionCredito) }),
    risk.scoreLiquidez !== null && t("liquidityScore", { value: risk.scoreLiquidez }),
  ].filter(Boolean);

  return (
    <Alert tone={tone} title={title}>
      <p>
        {t("line", { code, since })}
        {event && ` ${event}.`}
      </p>
      {indicators.length > 0 && <p className="mt-1 text-xs opacity-80">{indicators.join(" · ")} {t("informative")}</p>}
    </Alert>
  );
}
