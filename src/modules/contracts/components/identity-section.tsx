"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("operation.identity");
  const field = (key: keyof IdentityPrefill, extra?: Partial<React.ComponentProps<typeof Field>>) => (
    <Field label={t(key)} name={key} value={value[key]} onChange={(e) => onChange({ [key]: e.target.value })} error={errors[key]} {...extra} />
  );

  return (
    <Card title={t("title")} subtitle={t("subtitle")}>
      <div className="grid gap-4 md:grid-cols-4">
        {field("clientName", { className: "md:col-span-3" })}
        {field("clientCif")}
        {field("fiscalAddress", { className: "md:col-span-4" })}
        {field("fiscalPostalCode")}
        {field("fiscalCity")}
        {field("fiscalProvince")}
        <div />
        {field("signatoryName", { className: "md:col-span-2" })}
        {field("signatoryNif", { hint: t("signatoryNifHint") })}
        <div>{signatoryIdAttachment}</div>
        {field("signatoryAddress", { className: "md:col-span-4", hint: t("signatoryAddressHint") })}
        {field("contactName", { className: "md:col-span-2" })}
        {field("contactPhone")}
        {field("contactEmail", { type: "email" })}
      </div>

      <div className="mt-6 border-t border-ink-700 pt-4">
        <Label>{t("delivery")}</Label>
        <label className="mb-3 flex items-center gap-3 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={value.deliverySameAsFiscal}
            onChange={(e) => onChange({ deliverySameAsFiscal: e.target.checked })}
            className="h-4 w-4 accent-mint-500"
          />
          {t("sameAsFiscal")}
        </label>
        {value.deliverySameAsFiscal ? (
          <p className="text-sm text-slate-400">
            {[value.fiscalAddress, [value.fiscalPostalCode, value.fiscalCity].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}
          </p>
        ) : (
          <>
            <textarea
              aria-label={t("delivery")}
              rows={2}
              value={value.deliveryAddress}
              onChange={(e) => onChange({ deliveryAddress: e.target.value })}
              placeholder={t("deliveryPlaceholder")}
              className={inputClass}
            />
            {errors.deliveryAddress && <p className="mt-1 text-[11px] text-red-300">{errors.deliveryAddress}</p>}
          </>
        )}
      </div>
    </Card>
  );
}
