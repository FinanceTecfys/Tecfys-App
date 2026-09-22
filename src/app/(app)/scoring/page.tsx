import Link from "next/link";
import { Plus } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtDate, fmtEur, fmtNum } from "@/lib/format";
import { DecisionBadge, RatingBadge, ScoringStatusBadge } from "@/modules/scoring/components/badges";
import { listScorings } from "@/modules/scoring/data";

export const metadata = { title: "Scoring" };

export default async function ScoringListPage() {
  const scorings = await listScorings();
  return (
    <>
      <PageHeader
        title="Scoring de clientes"
        description="Primer paso de toda operación: sin scoring aprobado no se puede originar un contrato."
        actions={
          <ButtonLink href="/scoring/new">
            <Plus className="h-4 w-4" aria-hidden /> Nuevo scoring
          </ButtonLink>
        }
      />
      <Card bodyClassName="p-0">
        {scorings.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            Todavía no hay scorings. Empieza subiendo un informe de Informa.
          </p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Fecha</Th>
                <Th>Empresa</Th>
                <Th>CIF</Th>
                <Th right>Puntuación</Th>
                <Th>Rating</Th>
                <Th>Decisión</Th>
                <Th>Estado</Th>
                <Th right>Opinión de crédito</Th>
              </tr>
            </thead>
            <tbody>
              {scorings.map((s) => (
                <tr key={s.id} className="hover:bg-ink-800/50">
                  <Td>{fmtDate(s.created_at)}</Td>
                  <Td>
                    <Link href={`/scoring/${s.id}`} className="font-medium text-slate-100 hover:text-mint-400">
                      {s.company?.name}
                    </Link>
                  </Td>
                  <Td mono>{s.company?.cif}</Td>
                  <Td right mono>{fmtNum(Number(s.total_score), 2)}</Td>
                  <Td><RatingBadge rating={s.rating} /></Td>
                  <Td><DecisionBadge decision={s.decision} /></Td>
                  <Td><ScoringStatusBadge status={s.status} /></Td>
                  <Td right mono>{fmtEur(Number(s.credit_opinion))}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
