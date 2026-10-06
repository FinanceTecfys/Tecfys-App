"use client";

import { useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtEur, fmtMonthKey } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MonthKey } from "../domain/month-key";
import { type ContractSchedule, rowsWithOutstanding } from "../domain/schedule";

/**
 * Month-by-month installment split and closing principal outstanding.
 *
 * With `collapsedRows` a longer schedule starts collapsed to that many rows
 * (the first ones and the last) and a button expands it to the full table and
 * back. View state only: the schedule itself is never changed.
 */
export function ScheduleTable({ schedule, currentKey, collapsedRows }: { schedule: ContractSchedule; currentKey?: MonthKey; collapsedRows?: number }) {
  const [expanded, setExpanded] = useState(false);
  const tableId = useId();
  const rows = rowsWithOutstanding(schedule);
  const collapsible = collapsedRows !== undefined && collapsedRows >= 2 && rows.length > collapsedRows;
  const visible = collapsible && !expanded ? [...rows.slice(0, collapsedRows - 1), rows[rows.length - 1]] : rows;
  const hidden = rows.length - visible.length;

  return (
    <>
      <div id={tableId}>
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
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-controls={tableId}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-ink-600 px-3 py-1.5 text-xs text-slate-300 transition hover:border-mint-500/60 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-mint-500"
        >
          {expanded ? <Minus className="h-3.5 w-3.5" aria-hidden /> : <Plus className="h-3.5 w-3.5" aria-hidden />}
          {expanded ? "Ver menos" : `Ver todas (${rows.length})`}
        </button>
      )}
    </>
  );
}
