import { notFound } from "next/navigation";
import { z } from "zod";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { can } from "@/lib/auth/permissions";
import { dataScopeFor } from "@/lib/auth/scope";
import { requireRole } from "@/lib/supabase/auth";
import { listAssetTypes, listContractTypes, listDistributors } from "@/modules/catalog/data";
import { OperationForm } from "@/modules/contracts/components/operation-form";
import { clientExposure, contractAssetQuantity, getContract } from "@/modules/contracts/data";
import { identityFromOperationInput, isEditableDraft, operationInputFromContract } from "@/modules/contracts/domain/operation";
import { getScoring } from "@/modules/scoring/data";

export const metadata = { title: "Editar operación" };

/** Reopen a DRAFT in the operation form, pre-filled with what was saved. */
export default async function EditOperationPage({ params }: PageProps<"/contracts/[id]/edit">) {
  const user = await requireRole("operation.create");
  const scope = dataScopeFor(user);
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  // Another partner's draft reads as missing, same as a wrong id.
  const contract = await getContract(id, scope);
  if (!contract) notFound();

  const back = (
    <div className="mt-4">
      <ButtonLink href={`/contracts/${contract.id}`} variant="secondary">Volver al contrato</ButtonLink>
    </div>
  );
  if (!isEditableDraft(contract.workflow_status)) {
    return (
      <>
        <PageHeader title={`Contrato ${contract.contract_number}`} />
        <Alert tone="warning" title="Este contrato ya no se puede editar">
          Solo se editan los contratos en borrador. Uno enviado a firma o firmado conserva las condiciones con las que se firmó.
        </Alert>
        {back}
      </>
    );
  }
  const scoring = contract.scoring_id ? await getScoring(contract.scoring_id, scope) : null;
  if (!scoring?.company) {
    return (
      <>
        <PageHeader title={`Contrato ${contract.contract_number}`} />
        <Alert tone="warning" title="Borrador sin scoring de origen">
          La operación se edita sobre el scoring del que nació, y este borrador no tiene uno accesible.
        </Alert>
        {back}
      </>
    );
  }

  const [distributors, assetTypes, contractTypes, currentExposure, quantity] = await Promise.all([
    listDistributors(),
    listAssetTypes(),
    listContractTypes(),
    // Signed contracts only, so the draft being edited is not counted twice.
    clientExposure(scoring.company.id),
    contractAssetQuantity(contract.id),
  ]);
  const clusters = [...new Set(assetTypes.map((a) => a.cluster))].sort();
  // A partner originates for its own distributor and never sees the others.
  const lockedDistributorId = can(user.role, "records.viewAll") ? undefined : user.partnerDistributorId;
  const initial = operationInputFromContract(contract, quantity);

  return (
    <>
      <PageHeader
        title={`Editar borrador ${contract.contract_number}`}
        description={`${scoring.company.name} · scoring ${scoring.rating}. Cambia cualquier dato; al guardar se recalculan el calendario y la expected IRR.`}
        actions={<ButtonLink href={`/contracts/${contract.id}`} variant="secondary">Cancelar</ButtonLink>}
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
        identity={identityFromOperationInput(initial)}
        distributors={lockedDistributorId === undefined ? distributors : distributors.filter((d) => d.id === lockedDistributorId)}
        assetTypes={assetTypes}
        contractTypes={contractTypes}
        clusters={clusters}
        today={new Date().toISOString().slice(0, 10)}
        canEditCatalog={can(user.role, "settings.access")}
        lockedDistributorId={lockedDistributorId}
        edit={{ contractId: contract.id, contractNumber: contract.contract_number, initial }}
      />
    </>
  );
}
