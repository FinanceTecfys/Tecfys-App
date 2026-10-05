import Link from "next/link";
import { redirect } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { dataScopeFor } from "@/lib/auth/scope";
import { fmtDate, fmtEur } from "@/lib/format";
import { requireRole } from "@/lib/supabase/auth";
import { listAssetTypes, listContractTypes, listDistributors } from "@/modules/catalog/data";
import { OperationForm } from "@/modules/contracts/components/operation-form";
import { clientExposure } from "@/modules/contracts/data";
import { identityFromCompany } from "@/modules/contracts/domain/operation";
import { RatingBadge } from "@/modules/scoring/components/badges";
import { getScoring, listScorings } from "@/modules/scoring/data";

export const metadata = { title: "Nueva operación" };

export default async function NewOperationPage({ searchParams }: PageProps<"/contracts/new">) {
  const user = await requireRole("operation.create");
  const scope = dataScopeFor(user);
  const { scoringId } = await searchParams;

  // Without a scoring: choose one of the approved scorings the user can reach.
  if (typeof scoringId !== "string") {
    const approved = await listScorings(scope, { status: "approved" });
    return (
      <>
        <PageHeader
          title="Nueva operación"
          description="Toda operación parte de un scoring aprobado. Elige el scoring del cliente."
          actions={<ButtonLink href="/scoring/new" variant="secondary">Nuevo scoring</ButtonLink>}
        />
        <Card bodyClassName="p-0">
          {approved.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">No hay scorings aprobados. Empieza por un nuevo scoring.</p>
          ) : (
            <Table>
              <thead><tr><Th>Fecha</Th><Th>Empresa</Th><Th>CIF</Th><Th>Rating</Th><Th right>Opinión de crédito</Th><Th /></tr></thead>
              <tbody>
                {approved.map((s) => (
                  <tr key={s.id} className="hover:bg-ink-800/50">
                    <Td>{fmtDate(s.created_at)}</Td>
                    <Td>{s.company?.name}</Td>
                    <Td mono>{s.company?.cif}</Td>
                    <Td><RatingBadge rating={s.rating} /></Td>
                    <Td right mono>{fmtEur(Number(s.credit_opinion))}</Td>
                    <Td right>
                      <Link href={`/contracts/new?scoringId=${s.id}`} className="text-sm font-medium text-mint-400 hover:underline">Crear operación</Link>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </>
    );
  }

  // Another partner's scoring reads as missing, same as a wrong id.
  const scoring = await getScoring(scoringId, scope);
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

  const [distributors, assetTypes, contractTypes, currentExposure] = await Promise.all([
    listDistributors(),
    listAssetTypes(),
    listContractTypes(),
    clientExposure(scoring.company.id),
  ]);
  const clusters = [...new Set(assetTypes.map((a) => a.cluster))].sort();
  // A partner originates for its own distributor and never sees the others.
  const lockedDistributorId = can(user.role, "records.viewAll") ? undefined : user.partnerDistributorId;

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
        distributors={lockedDistributorId === undefined ? distributors : distributors.filter((d) => d.id === lockedDistributorId)}
        assetTypes={assetTypes}
        contractTypes={contractTypes}
        clusters={clusters}
        today={new Date().toISOString().slice(0, 10)}
        canEditCatalog={can(user.role, "settings.access")}
        lockedDistributorId={lockedDistributorId}
      />
    </>
  );
}
