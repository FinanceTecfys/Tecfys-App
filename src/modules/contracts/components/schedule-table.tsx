import { Table, Td, Th } from "@/components/ui/table";
import { fmtEur, fmtMonthKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthKey } from "../domain/month-key";
import { type ContractSchedule, rowsWithOutstanding } from "../domain/schedule";

/** Month-by-month installment split and closing principal outstanding. */
export function ScheduleTable({ schedule, currentKey, maxRows }: { schedule: ContractSchedule; currentKey?: MonthKey; maxRows?: number }) {
  const rows = rowsWithOutstanding(schedule);
  const visible = maxRows && rows.length > maxRows ? [...rows.slice(0, maxRows - 1), rows[rows.length - 1]] : rows;
  const hidden = rows.length - visible.length;

  return (
    <Table>
      <thead>
        <tr>
          <Th>#</Th>
          <Th>Mes</Th>
          <Th right>Cuota</Th>
          <Th right>Principal</Th>
          <Th right>Interés</Th>
          <Th right>Principal pendiente</Th>
        </tr>
      </thead>
      <tbody>
        {visible.map((r, idx) => (
          <tr key={r.key} className={cn(r.key === currentKey && "bg-mint-500/5")}>
            <Td mono className="text-slate-500">{r.isResidual ? "RV" : r.age + 1}</Td>
            <Td>
              {fmtMonthKey(r.key)}
              {r.isResidual && <span className="ml-2 text-[11px] text-slate-500">valor residual</span>}
              {hidden > 0 && idx === visible.length - 2 && <div className="text-[11px] text-slate-600">… {hidden} meses más</div>}
            </Td>
            <Td right mono>{fmtEur(r.installment, 2)}</Td>
            <Td right mono>{fmtEur(r.principal, 2)}</Td>
            <Td right mono>{fmtEur(r.interest, 2)}</Td>
            <Td right mono className={cn(Math.abs(r.outstanding) < 0.005 && "text-slate-500")}>{fmtEur(Math.abs(r.outstanding) < 0.005 ? 0 : r.outstanding, 2)}</Td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr className="font-semibold">
          <Td />
          <Td>Total</Td>
          <Td right mono>{fmtEur(schedule.totals.installments, 2)}</Td>
          <Td right mono>{fmtEur(schedule.totals.principal, 2)}</Td>
          <Td right mono>{fmtEur(schedule.totals.interest, 2)}</Td>
          <Td />
        </tr>
      </tfoot>
    </Table>
  );
}
