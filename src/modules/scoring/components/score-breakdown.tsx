import { Table, Td, Th } from "@/components/ui/table";
import { fmtNum, fmtPct } from "@/lib/format";
import type { RatioKey } from "../domain/criteria";
import type { RatioResult } from "../domain/engine";
import { RatingBadge } from "./badges";

const PERCENT_RATIOS: RatioKey[] = ["netMargin", "economicProfit", "financialProfit"];

function formatValue(key: RatioKey, value: RatioResult["value"]) {
  if (value === null) return <span className="text-slate-600">sin dato</span>;
  if (typeof value === "string") return value;
  if (PERCENT_RATIOS.includes(key)) return fmtPct(value);
  if (key === "paymentPeriod" || key === "collectionPeriod") return `${fmtNum(value, 0)} d`;
  if (key === "maturity") return `${fmtNum(value, 0)} años`;
  return fmtNum(value, 2);
}

export function ScoreBreakdown({ breakdown }: { breakdown: Record<RatioKey, RatioResult> }) {
  const rows = (Object.entries(breakdown) as [RatioKey, RatioResult][]).sort((a, b) => b[1].weight - a[1].weight);
  return (
    <Table>
      <thead>
        <tr>
          <Th>Ratio</Th>
          <Th right>Valor</Th>
          <Th>Rating</Th>
          <Th right>Nota</Th>
          <Th right>Peso</Th>
          <Th right>Aporta</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, r]) => (
          <tr key={key}>
            <Td>
              <div className="font-medium text-slate-100">{r.label}</div>
              <div className="text-[11px] text-slate-500">{r.formula}</div>
            </Td>
            <Td right mono>{formatValue(key, r.value)}</Td>
            <Td><RatingBadge rating={r.rating} /></Td>
            <Td right mono>{fmtNum(r.ratingScore, 1)}</Td>
            <Td right mono>{fmtPct(r.weight, 0)}</Td>
            <Td right mono className="text-mint-400">{fmtNum(r.contribution, 3)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
