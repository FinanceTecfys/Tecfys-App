import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/supabase/auth";
import { ScoringWizard } from "@/modules/scoring/components/scoring-wizard";
import { getActiveCriteria } from "@/modules/scoring/data";
import { EMPTY_FINANCIALS } from "@/modules/scoring/domain/financials";
import { previewScore, sectorNames } from "@/modules/scoring/domain/preview";
import { isInformaConfigured } from "@/modules/scoring/informa/server";

export const metadata = { title: "Nuevo scoring" };

export default async function NewScoringPage() {
  await requireRole("scoring.run");
  const criteria = await getActiveCriteria();
  return (
    <>
      <PageHeader
        title="Nuevo scoring"
        description={`Modelo de scoring ${criteria.version ? `v${criteria.version}` : "por defecto"}: ratios ponderados, rating AAA–C y opinión de crédito.`}
      />
      {/* The model stays here, on the server: the wizard only receives sector names and computed results. */}
      <ScoringWizard
        sectors={sectorNames(criteria.config)}
        initialPreview={previewScore(EMPTY_FINANCIALS, criteria.config)}
        informaConfigured={isInformaConfigured()}
      />
    </>
  );
}
