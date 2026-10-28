"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { decideCompanyChange } from "../actions";
import type { PendingCompanyChange } from "../data";

const sourceHref = (c: PendingCompanyChange): string | null =>
  c.source === "operation" ? (c.contractId ? `/contracts/${c.contractId}` : null) : c.scoringId ? `/scoring/${c.scoringId}` : null;

/**
 * Settings > "Cambios de clientes" (owner / admin): the differences partner
 * scorings and partner operations found against the company master. Each one is approved (applied to
 * the company) or rejected on its own; both are recorded.
 */
export function CompanyChangesPanel({ changes }: { changes: PendingCompanyChange[] }) {
  const t = useTranslations("companies.review");
  const tFields = useTranslations("companies.fields");
  const tSources = useTranslations("companies.sources");
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  if (changes.length === 0) return <p className="text-sm text-slate-400">{t("empty")}</p>;

  const decide = (id: string, approve: boolean) => {
    setError(null);
    setPendingId(id);
    start(async () => {
      const res = await decideCompanyChange({ id, approve });
      if (!res.ok) setError(res.error);
      setPendingId(null);
    });
  };

  return (
    <div className="space-y-4">
      {error && <Alert tone="error">{error}</Alert>}
      <Table>
        <thead>
          <tr>
            <Th>{t("client")}</Th>
            <Th>{t("field")}</Th>
            <Th>{t("current")}</Th>
            <Th>{t("proposed")}</Th>
            <Th>{t("source")}</Th>
            <Th>{t("date")}</Th>
            <Th right>{t("decision")}</Th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id}>
              <Td>
                <div className="text-slate-200">{c.company?.name ?? "—"}</div>
                <div className="num text-xs text-slate-500">{c.company?.cif}</div>
              </Td>
              <Td>{tFields(c.field)}</Td>
              <Td className="text-slate-400">{c.currentValue ?? t("emptyValue")}</Td>
              <Td className="text-slate-100">{c.newValue}</Td>
              <Td className="text-slate-400">
                {/* The record behind the change: the scoring (Informa) or the contract (operation). */}
                {sourceHref(c) ? <Link href={sourceHref(c)!} className="hover:text-mint-400">{tSources(c.source)}</Link> : tSources(c.source)}
              </Td>
              <Td className="text-slate-400">{fmtDate(c.createdAt)}</Td>
              <Td right>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" disabled={pendingId !== null} onClick={() => decide(c.id, true)}>{t("approve")}</Button>
                  <Button variant="danger" disabled={pendingId !== null} onClick={() => decide(c.id, false)}>{t("reject")}</Button>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
