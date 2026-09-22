import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { fmtNum, fmtPct } from "@/lib/format";
import { ActiveToggle, NewAssetTypeForm, NewDistributorForm } from "@/modules/catalog/components/catalog-forms";
import { listAssetTypes, listContractTypes, listDistributors } from "@/modules/catalog/data";
import { DECISION_LABELS, type RatioKey } from "@/modules/scoring/domain/criteria";
import { RatingBadge } from "@/modules/scoring/components/badges";
import { getActiveCriteria } from "@/modules/scoring/data";

export const metadata = { title: "Configuración" };

export default async function SettingsPage() {
  const [distributors, assetTypes, contractTypes, criteria] = await Promise.all([
    listDistributors(),
    listAssetTypes(),
    listContractTypes(),
    getActiveCriteria(),
  ]);
  const clusters = [...new Set(assetTypes.map((a) => a.cluster))].sort();
  const c = criteria.config;

  return (
    <>
      <PageHeader title="Configuración" description="Catálogos de originación y modelo de scoring vigente." />
      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Distribuidores" subtitle={`${distributors.length} registrados`}>
          <NewDistributorForm />
          <div className="mt-4 max-h-96 overflow-y-auto">
            <Table>
              <thead><tr><Th>Nombre</Th><Th>CIF</Th><Th>Estado</Th></tr></thead>
              <tbody>
                {distributors.map((d) => (
                  <tr key={d.id}>
                    <Td>{d.name}</Td>
                    <Td mono className="text-slate-400">{d.cif ?? "—"}</Td>
                    <Td><ActiveToggle id={d.id} active={d.active} kind="distributor" /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card title="Tipos de activo" subtitle="Cada tipo pertenece a un grupo del Loan book">
          <NewAssetTypeForm clusters={clusters} />
          <div className="mt-4 max-h-96 overflow-y-auto">
            <Table>
              <thead><tr><Th>Tipo</Th><Th>Grupo</Th><Th>Estado</Th></tr></thead>
              <tbody>
                {assetTypes.map((a) => (
                  <tr key={a.id}>
                    <Td>{a.name}</Td>
                    <Td className="text-slate-400">{a.cluster}</Td>
                    <Td><ActiveToggle id={a.id} active={a.active} kind="assetType" /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </Card>

        <Card title="Tipos de contrato">
          <Table>
            <thead><tr><Th>Código</Th><Th>Descripción</Th><Th right>Desfase facturación</Th></tr></thead>
            <tbody>
              {contractTypes.map((t) => (
                <tr key={t.code}>
                  <Td mono>{t.code}</Td>
                  <Td>{t.label}</Td>
                  <Td right mono>{t.billing_lag_months ? `+${t.billing_lag_months} mes` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card title="Modelo de scoring" subtitle={criteria.version ? `Versión ${criteria.version}` : "Modelo por defecto (sin versión guardada)"}>
          <Table>
            <thead><tr><Th>Ratio</Th><Th right>Peso</Th><Th>Fórmula</Th></tr></thead>
            <tbody>
              {(Object.entries(c.weights) as [RatioKey, number][]).sort((a, b) => b[1] - a[1]).map(([key, w]) => (
                <tr key={key}>
                  <Td>{c.ratios[key].label}</Td>
                  <Td right mono>{fmtPct(w, 0)}</Td>
                  <Td className="text-slate-400">{c.ratios[key].formula}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="mt-5 grid grid-cols-4 gap-2 text-xs">
            {c.scoreBuckets.map(([rating, lower]) => (
              <div key={rating} className="rounded-md border border-ink-700 p-2">
                <RatingBadge rating={rating} />
                <div className="num mt-1 text-slate-400">≥ {fmtNum(lower, 1)}</div>
                <div className="text-slate-500">{DECISION_LABELS[c.decisionRules[rating]]}</div>
                <div className="num text-slate-500">prudencia {fmtPct(c.prudence[rating], 0)}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}
