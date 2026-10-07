import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/supabase/auth";
import { ScoringWizard } from "@/modules/scoring/components/scoring-wizard";
import { getActiveCriteria } from "@/modules/scoring/data";
import { EMPTY_FINANCIALS } from "@/modules/scoring/domain/financials";
import { previewScore, sectorNames } from "@/modules/scoring/domain/preview";
import { isInformaConfigured } from "@/modules/scoring/informa/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("scoring.new"))("title") };
}

export default async function NewScoringPage() {
  await requireRole("scoring.run");
  const criteria = await getActiveCriteria();
  const t = await getTranslations("scoring.new");
  return (
    <>
      <PageHeader title={t("title")} description={criteria.version ? t("descriptionVersion", { version: criteria.version }) : t("descriptionDefault")} />
      {/* The model stays here, on the server: the wizard only receives sector names and computed results. */}
      <ScoringWizard
        sectors={sectorNames(criteria.config)}
        initialPreview={previewScore(EMPTY_FINANCIALS, criteria.config)}
        informaConfigured={isInformaConfigured()}
      />
    </>
  );
}
