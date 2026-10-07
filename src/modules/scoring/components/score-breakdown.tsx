import { useTranslations } from "next-intl";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtNum, fmtPct } from "@/lib/format";
import type { BreakdownRow } from "../domain/preview";
import type { RatioKey } from "../domain/ratings";
import { RatingBadge } from "./badges";

const PERCENT_RATIOS: RatioKey[] = ["netMargin", "economicProfit", "financialProfit"];

/**
 * The scoring ratio by ratio: value, rating and contribution. The two columns
 * that expose the model - the score of the rating ("Nota") and the weight
 * ("Peso") - only exist when the rows carry them (breakdownRows withModel),
 * which is decided on the server for the roles allowed to see the model.
 *
 * The name and the formula of each ratio come from the message catalogue by
 * the ratio's key, not from the label stored with the scoring, so a scoring
 * saved long ago reads in the user's language too.
 */
export function ScoreBreakdown({ rows }: { rows: BreakdownRow[] }) {
  const t = useTranslations("scoring.breakdownTable");
  const tRatios = useTranslations("scoring.ratios");
  const withModel = rows.some((r) => r.weight !== undefined);

  const formatValue = (key: RatioKey, value: BreakdownRow["value"]) => {
    if (value === null) return <span className="text-slate-600">{t("noData")}</span>;
    if (typeof value === "string") return value;
    if (PERCENT_RATIOS.includes(key)) return fmtPct(value);
    if (key === "paymentPeriod" || key === "collectionPeriod") return t("days", { value: fmtNum(value, 0) });
    if (key === "maturity") return t("years", { value: fmtNum(value, 0) });
    return fmtNum(value, 2);
  };

  return (
    <Table>
      <thead>
        <tr>
          <Th>{t("ratio")}</Th>
          <Th right>{t("value")}</Th>
          <Th>{t("rating")}</Th>
          {withModel && <Th right>{t("score")}</Th>}
          {withModel && <Th right>{t("weight")}</Th>}
          <Th right>{t("contribution")}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td>
              <div className="font-medium text-slate-100">{tRatios.has(`${r.key}.label`) ? tRatios(`${r.key}.label`) : r.label}</div>
              <div className="text-[11px] text-slate-500">{tRatios.has(`${r.key}.formula`) ? tRatios(`${r.key}.formula`) : r.formula}</div>
            </Td>
            <Td right mono>{formatValue(r.key, r.value)}</Td>
            <Td><RatingBadge rating={r.rating} /></Td>
            {withModel && <Td right mono>{fmtNum(r.ratingScore, 1)}</Td>}
            {withModel && <Td right mono>{fmtPct(r.weight, 0)}</Td>}
            <Td right mono className="text-mint-400">{fmtNum(r.contribution, 3)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
