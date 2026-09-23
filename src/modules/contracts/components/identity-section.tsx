"use client";

import { Card } from "@/components/ui/card";
import { Field, inputClass, Label } from "@/components/ui/field";
import type { IdentityPrefill } from "../domain/operation";

export interface IdentityState extends IdentityPrefill {
  deliverySameAsFiscal: boolean;
  deliveryAddress: string;
}

/** Section A: company identification, signatory, notifications and delivery address. */
export function IdentitySection({
  value,
  onChange,
  errors,
  signatoryIdAttachment,
}: {
  value: IdentityState;
  onChange: (patch: Partial<IdentityState>) => void;
  errors: Record<string, string>;
  /** Control to attach the signatory's DNI / NIE, next to their DNI. */
  signatoryIdAttachment?: React.ReactNode;
}) {
  const field = (key: keyof IdentityPrefill, label: string, extra?: Partial<React.ComponentProps<typeof Field>>) => (
    <Field label={label} name={key} value={value[key]} onChange={(e) => onChange({ [key]: e.target.value })} error={errors[key]} {...extra} />
  );

  return (
    <Card title="A · Datos identificativos" subtitle="Traídos del scoring; se congelan en el contrato al crear el borrador">
      <div className="grid gap-4 md:grid-cols-4">
        {field("clientName", "Razón social", { className: "md:col-span-3" })}
        {field("clientCif", "CIF / NIF")}
        {field("fiscalAddress", "Dirección fiscal", { className: "md:col-span-4" })}
        {field("fiscalPostalCode", "Código postal")}
        {field("fiscalCity", "Ciudad")}
        {field("fiscalProvince", "Provincia")}
        <div />
        {field("signatoryName", "Administrador / firmante", { className: "md:col-span-2" })}
        {field("signatoryNif", "DNI del firmante", { hint: "No viene en Informa" })}
        <div>{signatoryIdAttachment}</div>
        {field("signatoryAddress", "Domicilio del firmante", { className: "md:col-span-4", hint: "Opcional: si se deja vacío no aparece en el contrato" })}
        {field("contactName", "Contacto para notificaciones", { className: "md:col-span-2" })}
        {field("contactPhone", "Teléfono")}
        {field("contactEmail", "Email", { type: "email" })}
      </div>

      <div className="mt-6 border-t border-ink-700 pt-4">
        <Label>Domicilio de entrega</Label>
        <label className="mb-3 flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={value.deliverySameAsFiscal}
            onChange={(e) => onChange({ deliverySameAsFiscal: e.target.checked })}
            className="h-4 w-4 accent-mint-500"
          />
          Mismo que dirección fiscal
        </label>
        {value.deliverySameAsFiscal ? (
          <p className="text-sm text-slate-400">
            {[value.fiscalAddress, [value.fiscalPostalCode, value.fiscalCity].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}
          </p>
        ) : (
          <>
            <textarea
              aria-label="Domicilio de entrega"
              rows={2}
              value={value.deliveryAddress}
              onChange={(e) => onChange({ deliveryAddress: e.target.value })}
              placeholder="Calle, número, código postal y ciudad"
              className={inputClass}
            />
            {errors.deliveryAddress && <p className="mt-1 text-[11px] text-red-300">{errors.deliveryAddress}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
