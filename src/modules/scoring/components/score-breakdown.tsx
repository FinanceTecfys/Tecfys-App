import { Table, Td, Th } from "@/components/ui/table";
import { fmtNum, fmtPct } from "@/lib/format";
import type { BreakdownRow } from "../domain/preview";
import type { RatioKey } from "../domain/ratings";
import { RatingBadge } from "./badges";

const PERCENT_RATIOS: RatioKey[] = ["netMargin", "economicProfit", "financialProfit"];

function formatValue(key: RatioKey, value: BreakdownRow["value"]) {
  if (value === null) return <span className="text-slate-600">sin dato</span>;
  if (typeof value === "string") return value;
  if (PERCENT_RATIOS.includes(key)) return fmtPct(value);
  if (key === "paymentPeriod" || key === "collectionPeriod") return `${fmtNum(value, 0)} d`;
  if (key === "maturity") return `${fmtNum(value, 0)} años`;
  return fmtNum(value, 2);
}

/**
 * The scoring ratio by ratio: value, rating and contribution. The two columns
 * that expose the model - the score of the rating ("Nota") and the weight
 * ("Peso") - only exist when the rows carry them (breakdownRows withModel),
 * which is decided on the server for the roles allowed to see the model.
 */
export function ScoreBreakdown({ rows }: { rows: BreakdownRow[] }) {
  const withModel = rows.some((r) => r.weight !== undefined);
  return (
    <Table>
      <thead>
        <tr>
          <Th>Ratio</Th>
          <Th right>Valor</Th>
          <Th>Rating</Th>
          {withModel && <Th right>Nota</Th>}
          {withModel && <Th right>Peso</Th>}
          <Th right>Aporta</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td>
              <div className="font-medium text-slate-100">{r.label}</div>
              <div className="text-[11px] text-slate-500">{r.formula}</div>
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
