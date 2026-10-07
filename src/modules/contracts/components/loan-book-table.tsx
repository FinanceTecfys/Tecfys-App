"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtEur, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  columnsStorageKey,
  isDefaultColumns,
  LOAN_BOOK_COLUMNS,
  type LoanBookColumnKey,
  type LoanBookTableRow,
  parseStoredColumns,
  serializeColumns,
  toggleColumn,
} from "../domain/loan-book-columns";
import { LifecycleBadge, WorkflowBadge } from "./badges";
import { ColumnPicker } from "./column-picker";

interface Cell {
  right?: boolean;
  mono?: boolean;
  className?: string | ((r: LoanBookTableRow) => string | undefined);
  title?: (r: LoanBookTableRow) => string | undefined;
  render: (r: LoanBookTableRow, text: CellText) => React.ReactNode;
}

/** The few words a cell shows besides the row's own data, in the active language. */
interface CellText {
  yes: string;
  no: string;
  notAvailable: string;
}

const dash = <span className="text-slate-600">—</span>;
const text = (value: string | null) => value ?? "—";
const money = (value: number | null, decimals: 0 | 2 = 0) => (value === null ? dash : fmtEur(value, decimals));

/** One renderer per column of the registry: a column cannot be listed without a cell. */
const CELLS: Record<LoanBookColumnKey, Cell> = {
  contractNumber: {
    render: (r) => <Link href={`/contracts/${r.id}`} className="num font-medium text-slate-100 hover:text-mint-400">{r.contractNumber}</Link>,
  },
  loanBookRef: { mono: true, className: "text-slate-400", render: (r) => text(r.loanBookRef) },
  client: { className: "max-w-56 truncate", title: (r) => r.client, render: (r) => r.client },
  cif: { mono: true, className: "text-slate-400", render: (r) => text(r.cif) },
  country: { mono: true, className: "text-slate-400", render: (r) => text(r.country) },
  distributor: { className: "text-slate-400", render: (r) => text(r.distributor) },
  assetType: { className: "max-w-40 truncate text-slate-400", title: (r) => r.assetCluster ?? undefined, render: (r) => text(r.assetType) },
  assetCluster: { className: "max-w-40 truncate text-slate-400", title: (r) => r.assetCluster ?? undefined, render: (r) => text(r.assetCluster) },
  contractType: { className: "text-slate-400", render: (r) => r.contractType },
  rating: { mono: true, render: (r) => text(r.rating) },
  signingDate: { render: (r) => fmtDate(r.signingDate) },
  durationMonths: { right: true, mono: true, render: (r) => r.durationMonths },
  extensionMonths: {
    right: true,
    mono: true,
    className: (r) => (r.extensionMonths ? "text-yellow-300" : "text-slate-600"),
    render: (r) => (r.extensionMonths ? `+${r.extensionMonths}` : "—"),
  },
  elapsedMonths: { right: true, mono: true, render: (r) => r.elapsedMonths ?? dash },
  realMonths: { right: true, mono: true, render: (r) => r.realMonths ?? dash },
  installment: { right: true, mono: true, render: (r) => fmtEur(r.installment, 2) },
  cost: { right: true, mono: true, render: (r) => fmtEur(r.cost) },
  purchaseValue: { right: true, mono: true, render: (r) => fmtEur(r.purchaseValue) },
  expoAdjustment: { right: true, mono: true, render: (r) => (r.expoAdjustment === 0 ? dash : fmtEur(r.expoAdjustment, 2)) },
  residualValue: { right: true, mono: true, render: (r) => money(r.residualValue, 2) },
  expectedAnnualIrr: { right: true, mono: true, render: (r, text) => (r.expectedAnnualIrr === null ? text.notAvailable : fmtPct(r.expectedAnnualIrr, 1)) },
  status: { render: (r) => (r.lifecycleStatus ? <LifecycleBadge status={r.lifecycleStatus} /> : <WorkflowBadge status={r.workflowStatus} />) },
  cancelDate: { render: (r) => fmtDate(r.cancelDate) },
  additionalStatus: {
    render: (r) => (r.additionalStatus ? <Badge tone={r.additionalStatus.toLowerCase() === "gesico" ? "red" : "slate"}>{r.additionalStatus}</Badge> : dash),
  },
  settlementAmount: { right: true, mono: true, render: (r) => money(r.settlementAmount, 2) },
  outstanding: { right: true, mono: true, render: (r) => (r.outstanding === null ? "—" : fmtEur(r.outstanding)) },
  defaultAmount: {
    right: true,
    mono: true,
    className: (r) => (r.defaultAmount === null ? "text-slate-600" : "text-red-300"),
    render: (r) => (r.defaultAmount === null ? "—" : fmtEur(r.defaultAmount, 2)),
  },
  trancheLender: { className: "text-slate-400", render: (r) => text(r.trancheLender) },
  hasGuarantor: { className: (r) => (r.hasGuarantor ? undefined : "text-slate-600"), render: (r, text) => (r.hasGuarantor ? text.yes : text.no) },
};

// The choice lives in localStorage; a private window that refuses it still works for the session.
const CHANGE_EVENT = "tecfys:loan-book-columns";
const memory = new Map<string, string>();

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function writeStored(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    if (value === null) memory.delete(key);
    else memory.set(key, value);
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

/**
 * The loan-book table with its column chooser. The rows arrive already
 * filtered, sorted and paged by the server; only which columns are shown is
 * decided here, from the user's stored choice (the default set until read).
 */
export function LoanBookTable({ rows, userId }: { rows: LoanBookTableRow[]; userId: string }) {
  const storageKey = columnsStorageKey(userId);
  const stored = useSyncExternalStore(subscribe, () => readStored(storageKey), () => null);
  const visible = useMemo(() => parseStoredColumns(stored), [stored]);
  const columns = LOAN_BOOK_COLUMNS.filter((c) => visible.includes(c.key));
  const t = useTranslations("loanBook");
  const tCommon = useTranslations("common");
  const text: CellText = {
    yes: tCommon("yes"),
    no: tCommon("no"),
    notAvailable: t("notAvailable"),
  };

  return (
    <>
      <div className="flex justify-end border-b border-ink-700 px-4 py-2">
        <ColumnPicker
          columns={LOAN_BOOK_COLUMNS.map((c) => ({ ...c, label: t(`columns.${c.key}`) }))}
          visible={visible}
          onToggle={(key) => writeStored(storageKey, serializeColumns(toggleColumn(visible, key as LoanBookColumnKey)))}
          onReset={() => writeStored(storageKey, null)}
          canReset={!isDefaultColumns(visible)}
        />
      </div>
      <Table>
        <thead>
          <tr>
            {columns.map((c) => (
              <Th key={c.key} right={CELLS[c.key].right}>{t(`columns.${c.key}`)}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-ink-800/50">
              {columns.map((c) => {
                const cell = CELLS[c.key];
                const className = typeof cell.className === "function" ? cell.className(r) : cell.className;
                return (
                  <Td key={c.key} right={cell.right} mono={cell.mono} title={cell.title?.(r)} className={cn(className)}>
                    {cell.render(r, text)}
                  </Td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}
