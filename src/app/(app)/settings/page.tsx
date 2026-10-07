import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Table, Td, Th } from "@/components/ui/table";
import { can } from "@/lib/auth/permissions";
import { fmtNum, fmtPct } from "@/lib/format";
import { requireRole, type SessionUser } from "@/lib/supabase/auth";
import { ActiveToggle, NewAssetTypeForm, NewDistributorForm } from "@/modules/catalog/components/catalog-forms";
import { listAssetTypes, listContractTypes, listDistributors } from "@/modules/catalog/data";
import { HoldedSettingsForm } from "@/modules/erp/components/holded-settings-form";
import { getErpSettings } from "@/modules/erp/data";
import { isHoldedConfigured } from "@/modules/erp/holded/server";
import { InformaSettingsPanel } from "@/modules/scoring/components/informa-settings-panel";
import { informaConfigStatus } from "@/modules/scoring/informa/server";
import type { RatioKey } from "@/modules/scoring/domain/criteria";
import { RatingBadge } from "@/modules/scoring/components/badges";
import { getActiveCriteria } from "@/modules/scoring/data";
import { PreferencesForm } from "@/modules/settings/components/preferences-form";
import { SettingsTabs } from "@/modules/settings/components/settings-tabs";
import { resolveSettingsTab, settingsTabsFor } from "@/modules/settings/domain/tabs";
import { UsersPanel } from "@/modules/users/components/users-panel";
import { listUsers } from "@/modules/users/data";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getTranslations("settings"))("title") };
}

/**
 * Settings as tabs: ?tab= picks the tab and only that tab's data is loaded.
 *
 * The page is open to every role, because everyone sets their own language
 * and theme here ("Preferencias"). Each tab is gated on the server by its own
 * capability: resolveSettingsTab only ever returns a tab the role may open, so
 * the administration tabs are neither listed nor rendered for sales or
 * partners, whatever ?tab= says.
 */
export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const user = await requireRole("preferences.manage");
  const tab = resolveSettingsTab((await searchParams).tab, user.role);
  const t = await getTranslations("settings");

  return (
    <>
      <PageHeader title={t("title")} description={can(user.role, "settings.access") ? t("description") : t("descriptionPersonal")} />
      <SettingsTabs tabs={settingsTabsFor(user.role)} active={tab} />
      {tab === "users" && <UsersTab user={user} />}
      {tab === "distributors" && <DistributorsTab />}
      {tab === "assets" && <AssetTypesTab />}
      {tab === "scoring" && <ScoringModelTab />}
      {tab === "apis" && <ApisTab />}
      {tab === "preferences" && <PreferencesTab user={user} />}
    </>
  );
}

async function UsersTab({ user }: { user: SessionUser }) {
  const t = await getTranslations("settings.users");
  // Same roles as Settings today; checked on its own so the two can diverge safely.
  if (!can(user.role, "users.manage")) return <Alert tone="warning" title={(await getTranslations("common"))("noPermission")}>{t("noPermission")}</Alert>;
  const [users, distributors] = await Promise.all([listUsers(), listDistributors({ activeOnly: true })]);
  return (
    <Card title={t("title")} subtitle={t("subtitle", { count: users.length })}>
      <UsersPanel actor={{ id: user.id, role: user.role }} users={users} distributors={distributors.map((d) => ({ id: d.id, name: d.name }))} />
    </Card>
  );
}

async function DistributorsTab() {
  const t = await getTranslations("settings.distributors");
  const distributors = await listDistributors();
  return (
    <Card title={t("title")} subtitle={t("subtitle", { count: distributors.length })}>
      <NewDistributorForm />
      <div className="mt-4 max-h-[32rem] overflow-y-auto">
        <Table>
          <thead><tr><Th>{t("name")}</Th><Th>{t("cif")}</Th><Th>{t("status")}</Th></tr></thead>
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
  );
}

async function AssetTypesTab() {
  const t = await getTranslations("settings.assets");
  const [assetTypes, contractTypes] = await Promise.all([listAssetTypes(), listContractTypes()]);
  const clusters = [...new Set(assetTypes.map((a) => a.cluster))].sort();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title={t("title")} subtitle={t("subtitle")}>
        <NewAssetTypeForm clusters={clusters} />
        <div className="mt-4 max-h-96 overflow-y-auto">
          <Table>
            <thead><tr><Th>{t("type")}</Th><Th>{t("cluster")}</Th><Th>{t("status")}</Th></tr></thead>
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

      <Card title={t("contractTypesTitle")}>
        <Table>
          <thead><tr><Th>{t("code")}</Th><Th>{t("descriptionColumn")}</Th><Th right>{t("billingLag")}</Th></tr></thead>
          <tbody>
            {contractTypes.map((type) => (
              <tr key={type.code}>
                <Td mono>{type.code}</Td>
                <Td>{type.label}</Td>
                <Td right mono>{type.billing_lag_months ? t("billingLagValue", { months: type.billing_lag_months }) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

async function ScoringModelTab() {
  const t = await getTranslations("settings.scoringModel");
  const tScoring = await getTranslations("scoring");
  const criteria = await getActiveCriteria();
  const c = criteria.config;
  return (
    <div className="space-y-4">
      <Alert tone="info" title={t("readOnlyTitle")}>
        {t("readOnlyBody")}
      </Alert>
      <Card title={t("title")} subtitle={criteria.version ? t("version", { version: criteria.version }) : t("defaultVersion")}>
        <Table>
          <thead><tr><Th>{t("ratio")}</Th><Th right>{t("weight")}</Th><Th>{t("formula")}</Th></tr></thead>
          <tbody>
            {(Object.entries(c.weights) as [RatioKey, number][]).sort((a, b) => b[1] - a[1]).map(([key, w]) => (
              <tr key={key}>
                <Td>{tScoring(`ratios.${key}.label`)}</Td>
                <Td right mono>{fmtPct(w, 0)}</Td>
                <Td className="text-slate-400">{tScoring(`ratios.${key}.formula`)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <div className="mt-5 grid grid-cols-4 gap-2 text-xs">
          {c.scoreBuckets.map(([rating, lower]) => (
            <div key={rating} className="rounded-md border border-ink-700 p-2">
              <RatingBadge rating={rating} />
              <div className="num mt-1 text-slate-400">≥ {fmtNum(lower, 1)}</div>
              <div className="text-slate-500">{tScoring(`decisions.${c.decisionRules[rating]}`)}</div>
              <div className="num text-slate-500">{t("prudence", { value: fmtPct(c.prudence[rating], 0) })}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

async function ApisTab() {
  const t = await getTranslations("settings.apis");
  const erpSettings = await getErpSettings();
  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Card title={t("holdedTitle")} subtitle={t("holdedSubtitle")}>
        <HoldedSettingsForm settings={erpSettings} configured={isHoldedConfigured()} />
      </Card>

      <Card title={t("informaTitle")} subtitle={t("informaSubtitle")}>
        <InformaSettingsPanel config={informaConfigStatus()} />
      </Card>
    </div>
  );
}

/** The user's own language and theme mode: the one tab every role has. */
async function PreferencesTab({ user }: { user: SessionUser }) {
  const t = await getTranslations("preferences");
  return (
    <Card title={t("title")} subtitle={t("subtitle")}>
      {/* Keyed by the stored values: after a save the form starts again from what the server holds. */}
      <PreferencesForm key={`${user.language}:${user.theme}`} language={user.language} theme={user.theme} />
    </Card>
  );
}
