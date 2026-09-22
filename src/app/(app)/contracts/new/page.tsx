import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { listAssetTypes, listContractTypes, listDistributors } from "@/modules/catalog/data";
import { OperationForm } from "@/modules/contracts/components/operation-form";
import { loadLoanBook } from "@/modules/contracts/data";
import { identityFromCompany } from "@/modules/contracts/domain/operation";
import { getScoring } from "@/modules/scoring/data";

export const metadata = { title: "Nueva operación" };

export default async function NewOperationPage({ searchParams }: PageProps<"/contracts/new">) {
  const { scoringId } = await searchParams;
  if (typeof scoringId !== "string") redirect("/scoring");

  const scoring = await getScoring(scoringId);
  if (!scoring?.company) redirect("/scoring");
  if (scoring.status !== "approved") {
    return (
      <>
        <PageHeader title="Nueva operación" />
        <Alert tone="warning" title="El scoring no está aprobado">
          Solo se pueden originar operaciones sobre un scoring aprobado.
        </Alert>
        <div className="mt-4">
          <ButtonLink href={`/scoring/${scoring.id}`} variant="secondary">Ver scoring</ButtonLink>
        </div>
      </>
    );
  }

  const [distributors, assetTypes, contractTypes, clientBook] = await Promise.all([
    listDistributors(),
    listAssetTypes(),
    listContractTypes(),
    loadLoanBook({ companyId: scoring.company.id }),
  ]);
  const clusters = [...new Set(assetTypes.map((a) => a.cluster))].sort();
  const currentExposure = clientBook.reduce((sum, c) => sum + Math.max(0, c.outstanding), 0);

  return (
    <>
      <PageHeader
        title="Nueva operación"
        description={`${scoring.company.name} · scoring ${scoring.rating} aprobado. Datos identificativos, orden SEPA y condiciones económicas; al crear el borrador se genera el contrato en Word.`}
      />
      <OperationForm
        scoring={{
          id: scoring.id,
          companyName: scoring.company.name,
          cif: scoring.company.cif,
          rating: scoring.rating,
          creditOpinion: Number(scoring.credit_opinion),
          currentExposure,
        }}
        identity={identityFromCompany(scoring.company)}
        distributors={distributors}
        assetTypes={assetTypes}
        contractTypes={contractTypes}
        clusters={clusters}
        today={new Date().toISOString().slice(0, 10)}
      />
    </>
  );
}
