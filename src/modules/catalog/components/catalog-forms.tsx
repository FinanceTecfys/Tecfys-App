"use client";

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field, SelectField } from "@/components/ui/field";
import { createAssetType, createDistributor, setAssetTypeActive, setDistributorActive } from "../actions";

export function NewDistributorForm() {
  const t = useTranslations("settings.distributors");
  const tCommon = useTranslations("common");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          const res = await createDistributor({ name: String(fd.get("name") ?? ""), cif: String(fd.get("cif") ?? ""), email: String(fd.get("email") ?? "") });
          if (!res.ok) return setError(res.error);
          setError(null);
          ref.current?.reset();
        })
      }
      className="grid gap-3 md:grid-cols-[1fr_160px_1fr_auto] md:items-end"
    >
      <Field label={t("newLabel")} name="name" required error={error ?? undefined} />
      <Field label={t("cif")} name="cif" />
      <Field label={t("email")} name="email" type="email" />
      <Button type="submit" disabled={pending}>{tCommon("actions.add")}</Button>
    </form>
  );
}

export function NewAssetTypeForm({ clusters }: { clusters: string[] }) {
  const t = useTranslations("settings.assets");
  const tCommon = useTranslations("common");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={(fd) =>
        start(async () => {
          const res = await createAssetType({ name: String(fd.get("name") ?? ""), cluster: String(fd.get("cluster") ?? "") });
          if (!res.ok) return setError(res.error);
          setError(null);
          ref.current?.reset();
        })
      }
      className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end"
    >
      <Field label={t("newLabel")} name="name" required error={error ?? undefined} />
      <SelectField label={t("clusterLabel")} name="cluster" options={clusters.map((c) => ({ value: c, label: c }))} />
      <Button type="submit" disabled={pending}>{tCommon("actions.add")}</Button>
    </form>
  );
}

export function ActiveToggle({ id, active, kind }: { id: string; active: boolean; kind: "distributor" | "assetType" }) {
  const t = useTranslations("common.status");
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (kind === "distributor" ? await setDistributorActive(id, !active) : await setAssetTypeActive(id, !active)))}
      className={active ? "text-xs text-mint-400 hover:underline" : "text-xs text-slate-500 hover:underline"}
    >
      {active ? t("active") : t("inactive")}
    </button>
  );
}
