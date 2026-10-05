import { PageHeader } from "@/components/ui/page-header";
import { requireRole } from "@/lib/supabase/auth";
import { ScoringWizard } from "@/modules/scoring/components/scoring-wizard";
import { getActiveCriteria } from "@/modules/scoring/data";
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
      <ScoringWizard criteria={criteria.config} informaConfigured={isInformaConfigured()} />
    </>
  );
}
