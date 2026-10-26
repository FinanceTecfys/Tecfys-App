"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
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
  const t = useTranslations("operation.schedule");
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
              <Th>{t("number")}</Th>
              <Th>{t("month")}</Th>
              <Th right>{t("installment")}</Th>
              <Th right>{t("principal")}</Th>
              <Th right>{t("interest")}</Th>
              <Th right>{t("outstanding")}</Th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r, idx) => (
              <tr key={r.key} className={cn(r.key === currentKey && "bg-mint-500/5")}>
                <Td mono className="text-slate-500">{r.isResidual ? t("residualShort") : r.age + 1}</Td>
                <Td>
                  {fmtMonthKey(r.key)}
                  {r.isResidual && <span className="ml-2 text-[11px] text-slate-500">{t("residualTag")}</span>}
                  {hidden > 0 && idx === visible.length - 2 && <div className="text-[11px] text-slate-600">{t("moreMonths", { count: hidden })}</div>}
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
              <Td>{t("total")}</Td>
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
          {expanded ? t("showLess") : t("showAll", { count: rows.length })}
        </button>
      )}
    </>
  );
}
