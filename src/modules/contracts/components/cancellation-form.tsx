"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/field";
import { updateContractCancellation } from "../actions";
import { ADDITIONAL_STATUSES, findStatus, statusAllowsSettlement } from "../domain/cancellation";

/** Edit the cancellation of a contract; the loan book recomputes on save. */
export function CancellationForm({
  contractId,
  cancelDate: initialDate,
  additionalStatus: initialStatus,
  settlementAmount: initialSettlement,
  outstanding,
}: {
  contractId: string;
  cancelDate: string | null;
  additionalStatus: string | null;
  settlementAmount: number | null;
  /** Principal outstanding today, shown as a hint for the settlement. */
  outstanding: number;
}) {
  const router = useRouter();
  const t = useTranslations("contract.cancellation");
  const tStatuses = useTranslations("contract.additionalStatuses");
  const [cancelDate, setCancelDate] = useState(initialDate ?? "");
  const [status, setStatus] = useState(findStatus(initialStatus)?.code ?? "");
  const [settlement, setSettlement] = useState(initialSettlement === null ? "" : String(initialSettlement));
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState(false);
  const [saving, startSaving] = useTransition();

  const definition = findStatus(status);
  const allowsSettlement = statusAllowsSettlement(status);
  // An imported value the editor does not offer is kept until it is changed.
  const unknownImported = initialStatus && !findStatus(initialStatus) ? initialStatus : null;

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSaved(false);
    startSaving(async () => {
      const res = await updateContractCancellation({
        contractId,
        cancelDate,
        additionalStatus: status,
        settlementAmount: allowsSettlement && settlement !== "" ? Number(settlement) : "",
      });
      if (!res.ok) {
        setError(res.error);
        setFieldErrors(res.fieldErrors ?? {});
        return;
      }
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {unknownImported && (
        <Alert tone="info">
          {t("imported", { status: unknownImported })}
        </Alert>
      )}
      <Field
        label={t("cancelDate")}
        name="cancelDate"
        type="date"
        value={cancelDate}
        onChange={(e) => {
          setCancelDate(e.target.value);
          if (!e.target.value) {
            setStatus("");
            setSettlement("");
          }
        }}
        error={fieldErrors.cancelDate}
        hint={t("cancelDateHint")}
      />
      <SelectField
        label={t("additionalStatus")}
        name="additionalStatus"
        value={status}
        disabled={!cancelDate}
        onChange={(e) => {
          setStatus(e.target.value);
          if (!statusAllowsSettlement(e.target.value)) setSettlement("");
        }}
        options={ADDITIONAL_STATUSES.map((s) => ({ value: s.code, label: s.legacy ? tStatuses("legacySuffix", { label: tStatuses(`${s.key}.label`) }) : tStatuses(`${s.key}.label`) }))}
        placeholder={t("noStatus")}
        error={fieldErrors.additionalStatus}
      />
      {definition && <p className="-mt-2 text-[11px] text-slate-500">{tStatuses(`${definition.key}.description`)}</p>}
      {allowsSettlement && (
        <Field
          label={t("settlement")}
          name="settlementAmount"
          type="number"
          step="0.01"
          min={0}
          suffix="€"
          value={settlement}
          onChange={(e) => setSettlement(e.target.value)}
          error={fieldErrors.settlementAmount}
          hint={t("settlementHint", { outstanding: outstanding.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }) })}
        />
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">{t("saved")}</Alert>}
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? t("saving") : t("save")}
      </Button>
    </form>
  );
}
