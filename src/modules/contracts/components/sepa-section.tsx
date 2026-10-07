"use client";

import { useTranslations } from "next-intl";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { useTranslate } from "@/i18n/client";
import { bicMatchesIbanCountry, deriveBic, IBAN_ERROR_MESSAGES, isValidBic, normalizeIban, validateIban } from "../domain/sepa";

export interface SepaState {
  iban: string;
  debtorName: string;
  /** False until the analyst edits the debtor name; until then it follows the company name. */
  debtorNameEdited: boolean;
  bic: string;
  /** True while the BIC shown is the one derived from the IBAN. */
  bicDerived: boolean;
}

/** Section B: SEPA direct-debit mandate. Live feedback; the server re-validates. */
export function SepaSection({
  value,
  onChange,
  errors,
  bankCertificateAttachment,
}: {
  value: SepaState;
  onChange: (patch: Partial<SepaState>) => void;
  errors: Record<string, string>;
  /** Control to attach the bank certificate, next to the IBAN. */
  bankCertificateAttachment?: React.ReactNode;
}) {
  const t = useTranslations("operation.sepa");
  const translate = useTranslate();
  const normalized = normalizeIban(value.iban);
  // Only complain once the IBAN looks complete, not while it is being typed.
  const check = normalized.length >= 15 ? validateIban(normalized) : null;
  const ibanError = errors.sepaIban ?? (check && !check.ok ? translate(IBAN_ERROR_MESSAGES[check.error]) : undefined);
  const bicWarning =
    value.bic && isValidBic(value.bic) && check?.ok && !bicMatchesIbanCountry(value.bic, normalized)
      ? t("bicCountryMismatch")
      : undefined;

  function onIban(raw: string) {
    const derived = deriveBic(raw);
    // Keep a BIC typed by the analyst; refresh one we derived ourselves.
    if (value.bicDerived || !value.bic) onChange({ iban: raw, bic: derived ?? "", bicDerived: derived !== null });
    else onChange({ iban: raw });
  }

  return (
    <Card title={t("title")} subtitle={t("subtitle")}>
      <div className="grid gap-4 md:grid-cols-4">
        <Field
          label={t("iban")}
          name="sepaIban"
          className="md:col-span-2"
          value={value.iban}
          onChange={(e) => onIban(e.target.value)}
          placeholder="ES00 0000 0000 0000 0000 0000"
          error={ibanError}
          hint={check?.ok ? t("ibanValid") : undefined}
          autoComplete="off"
        />
        <Field
          label={t("bic")}
          name="sepaBic"
          value={value.bic}
          onChange={(e) => onChange({ bic: e.target.value, bicDerived: false })}
          error={errors.sepaBic ?? bicWarning}
          hint={value.bicDerived ? t("bicDerived") : t("bicOptional")}
          autoComplete="off"
        />
        <div>{bankCertificateAttachment}</div>
        <Field
          label={t("debtor")}
          name="sepaDebtorName"
          className="md:col-span-3"
          value={value.debtorName}
          onChange={(e) => onChange({ debtorName: e.target.value, debtorNameEdited: true })}
          error={errors.sepaDebtorName}
        />
      </div>
      <p className="mt-3 text-[11px] text-slate-500">
        {t("note")}
      </p>
    </Card>
  );
}
