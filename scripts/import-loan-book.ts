/**
 * Load the Borrowing Base "Loan book" tab into the local Supabase database.
 *
 *   npm run import:loan-book -- "Legacy/Tecfys Borrowing base_15092026_default alignment.xlsx"
 *
 * Idempotent: contracts previously imported (contract_number "LB-...") are
 * deleted and re-inserted; companies, distributors and asset types are upserted.
 * Only the typed-in inputs are stored - the engine recomputes everything else.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import { type LoanBookRow, readBorrowingBase } from "./lib/borrowing-base-workbook";

config({ path: ".env.local" });

type Insert<T extends keyof Database["public"]["Tables"]> = Database["public"]["Tables"][T]["Insert"];

const BATCH = 500;

async function main() {
  const path = process.argv[2];
  if (!path) throw new Error("Usage: npm run import:loan-book -- <path to Borrowing Base xlsx>");
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SECRET_KEY missing in .env.local");
  const sb = createClient<Database>(url, key, { auth: { persistSession: false } });

  const { loanBook } = await readBorrowingBase(path);
  console.log(`Read ${loanBook.length} contracts`);

  // --- companies (one per CIF; contracts without a CIF get a name-based key)
  const companyKey = (r: LoanBookRow) =>
    r.cif ? r.cif.replace(/[\s.-]/g, "").toUpperCase() : `SINCIF-${(r.clientName ?? r.code).toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 40)}`;
  const companies = new Map<string, Insert<"companies">>();
  for (const r of loanBook) {
    const cif = companyKey(r);
    if (!companies.has(cif)) {
      companies.set(cif, { cif, name: r.clientName ?? cif, country: r.country ?? "ES", sector: r.sector });
    }
  }
  await upsertInBatches(sb, "companies", [...companies.values()], "cif");
  const companyIds = await idMap(sb, "companies", "cif");

  // --- distributors: most frequent spelling wins for each case-insensitive name
  const spellings = new Map<string, Map<string, number>>();
  for (const r of loanBook) {
    if (!r.partner) continue;
    const k = r.partner.trim().toLowerCase();
    const m = spellings.get(k) ?? new Map<string, number>();
    m.set(r.partner.trim(), (m.get(r.partner.trim()) ?? 0) + 1);
    spellings.set(k, m);
  }
  const { data: existingDistributors } = await sb.from("distributors").select("id, name");
  const distributorIds = new Map((existingDistributors ?? []).map((d) => [d.name.trim().toLowerCase(), d.id]));
  const newDistributors = [...spellings.entries()]
    .filter(([k]) => !distributorIds.has(k))
    .map(([, m]) => ({ name: [...m.entries()].sort((a, b) => b[1] - a[1])[0][0] }));
  if (newDistributors.length) {
    const { data, error } = await sb.from("distributors").insert(newDistributors).select("id, name");
    if (error) throw error;
    for (const d of data) distributorIds.set(d.name.trim().toLowerCase(), d.id);
  }

  // --- asset types (seeded from the cluster columns)
  const { data: assetTypes, error: atErr } = await sb.from("asset_types").select("id, name");
  if (atErr) throw atErr;
  const assetTypeIds = new Map(assetTypes.map((a) => [a.name.toLowerCase(), a.id]));

  // --- contracts: replace the previous import
  const { error: delErr } = await sb.from("contracts").delete().like("contract_number", "LB-%");
  if (delErr) throw delErr;

  const used = new Map<string, number>();
  const contracts: Insert<"contracts">[] = [];
  const assetsByNumber = new Map<string, { asset_type_id: string; quantity: number }[]>();
  for (const r of loanBook) {
    const n = (used.get(r.code) ?? 0) + 1;
    used.set(r.code, n);
    const contractNumber = n === 1 ? `LB-${r.code}` : `LB-${r.code}-${n}`;
    const main = [...r.assets].sort((a, b) => b.quantity - a.quantity)[0];
    contracts.push({
      contract_number: contractNumber,
      loan_book_ref: r.code,
      company_id: companyIds.get(companyKey(r))!,
      distributor_id: r.partner ? distributorIds.get(r.partner.trim().toLowerCase()) ?? null : null,
      asset_type_id: main ? assetTypeIds.get(main.cluster.toLowerCase()) ?? null : null,
      contract_type: r.contractType,
      tranche_lender: r.trancheLender,
      product_type: r.productType,
      rating: r.rating,
      sector: r.sector,
      country: r.country,
      signing_date: r.signingDate,
      duration_months: Math.max(0, Math.round(r.durationMonths)),
      installment: r.installment,
      residual_value: r.residualValue,
      purchase_value: r.purchaseValue,
      expo_adjustment: r.expoAdjustment,
      has_guarantor: r.endorsement,
      cancel_date: r.cancelDate,
      additional_status: r.additionalStatus,
      residual_waived: r.residualWaived,
      amortize_over_real_life: r.amortizeOverRealLife,
      workflow_status: "signed",
      notes: `Imported from Loan book row ${r.row}`,
    });
    assetsByNumber.set(
      contractNumber,
      r.assets.flatMap((a) => {
        const id = assetTypeIds.get(a.cluster.toLowerCase());
        return id ? [{ asset_type_id: id, quantity: Math.round(a.quantity) }] : [];
      }),
    );
  }

  const contractIds = new Map<string, string>();
  for (let i = 0; i < contracts.length; i += BATCH) {
    const { data, error } = await sb.from("contracts").insert(contracts.slice(i, i + BATCH)).select("id, contract_number");
    if (error) throw error;
    for (const c of data) contractIds.set(c.contract_number, c.id);
  }

  const lines: Insert<"contract_assets">[] = [];
  for (const [number, assets] of assetsByNumber) {
    const contractId = contractIds.get(number)!;
    for (const a of assets) lines.push({ contract_id: contractId, ...a });
  }
  for (let i = 0; i < lines.length; i += BATCH) {
    const { error } = await sb.from("contract_assets").insert(lines.slice(i, i + BATCH));
    if (error) throw error;
  }

  console.log(`Imported ${contracts.length} contracts, ${companies.size} companies, ${distributorIds.size} distributors, ${lines.length} asset lines`);
}

async function upsertInBatches(
  sb: ReturnType<typeof createClient<Database>>,
  table: "companies",
  rows: Insert<"companies">[],
  onConflict: string,
) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + BATCH), { onConflict, ignoreDuplicates: true });
    if (error) throw error;
  }
}

async function idMap(sb: ReturnType<typeof createClient<Database>>, table: "companies", keyCol: "cif") {
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(`id, ${keyCol}`).range(from, from + 999);
    if (error) throw error;
    for (const row of data) out.set(row[keyCol], row.id);
    if (data.length < 1000) break;
  }
  return out;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
