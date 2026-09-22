"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
          Estado importado del Loan book: <span className="font-semibold">{unknownImported}</span>. Se mantiene salvo que elijas otro.
        </Alert>
      )}
      <Field
        label="Fecha de cancelación"
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
        hint="Vacío = el contrato sigue vivo hasta su término"
      />
      <SelectField
        label="Estado adicional"
        name="additionalStatus"
        value={status}
        disabled={!cancelDate}
        onChange={(e) => {
          setStatus(e.target.value);
          if (!statusAllowsSettlement(e.target.value)) setSettlement("");
        }}
        options={ADDITIONAL_STATUSES.map((s) => ({ value: s.code, label: s.legacy ? `${s.label} (heredado)` : s.label }))}
        placeholder="— Sin estado —"
        error={fieldErrors.additionalStatus}
      />
      {definition && <p className="-mt-2 text-[11px] text-slate-500">{definition.description}</p>}
      {allowsSettlement && (
        <Field
          label="Importe cobrado en la liquidación"
          name="settlementAmount"
          type="number"
          step="0.01"
          min={0}
          suffix="€"
          value={settlement}
          onChange={(e) => setSettlement(e.target.value)}
          error={fieldErrors.settlementAmount}
          hint={`Sustituye al valor residual en el mes de liquidación. Principal pendiente hoy: ${outstanding.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })}`}
        />
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {saved && <Alert tone="info">Cancelación guardada: el loan book y la cartera se han recalculado.</Alert>}
      <Button type="submit" disabled={saving} className="w-full">
        {saving ? "Guardando…" : "Guardar cancelación"}
      </Button>
    </form>
  );
}
