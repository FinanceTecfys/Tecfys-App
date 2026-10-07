-- Atomic writes of an operation.
--
-- Creating a draft contract and editing one each touch several rows: the
-- contract, its equipment line, its SEPA mandate, its attachment metadata and
-- the company record. Done as separate PostgREST calls, a failure after the
-- first left a half-written contract. Each write is now ONE function call, so
-- it runs in one transaction: any error - a check constraint, a foreign key, a
-- unique violation - rolls back everything the call did.
--
-- The functions only write. Who may call them, the scoring / scope / draft
-- checks and the validation of every value stay in the server action, which is
-- the only caller: execute is granted to service_role alone. They run with the
-- caller's rights (security invoker) and an empty search_path.
--
-- Each argument is a JSON object with the column names of its table. The
-- column lists below are an allow-list: a key that is not listed is ignored,
-- so a caller can never set a status, a number or an owner through them.

-- ---------------------------------------------------------------------------
-- Create a DRAFT contract with its equipment line, SEPA mandate and attachment
-- rows, and refresh the company's identification. Returns { id, contract_number }.
--   p_contract     contracts columns (id optional: the caller may choose it so
--                  the attachment objects can be stored under it beforehand)
--   p_asset        contract_assets columns
--   p_mandate      sepa_mandates columns (reference = the new contract number)
--   p_company      companies columns to refresh
--   p_attachments  array of contract_attachments rows already in the bucket
-- ---------------------------------------------------------------------------
create or replace function public.create_draft_contract(
  p_contract    jsonb,
  p_asset       jsonb,
  p_mandate     jsonb,
  p_company     jsonb,
  p_attachments jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id      uuid;
  v_number  text;
  v_company uuid;
begin
  insert into public.contracts (
    id, company_id, scoring_id, distributor_id, rating, sector, created_by,
    asset_type_id, contract_type, signing_date, duration_months, installment, residual_value, purchase_value,
    has_guarantor, guarantor_name, guarantor_nif, guarantor_address, guarantor_representative, guarantor_representative_nif,
    client_name, client_cif, fiscal_address, fiscal_postal_code, fiscal_city, fiscal_province,
    signatory_name, signatory_nif, signatory_address, contact_name, contact_phone, contact_email,
    delivery_same_as_fiscal, delivery_address, product_description, notes,
    product_type, workflow_status
  )
  select
    coalesce(r.id, gen_random_uuid()), r.company_id, r.scoring_id, r.distributor_id, r.rating, r.sector, r.created_by,
    r.asset_type_id, r.contract_type, r.signing_date, r.duration_months, r.installment, r.residual_value, r.purchase_value,
    r.has_guarantor, r.guarantor_name, r.guarantor_nif, r.guarantor_address, r.guarantor_representative, r.guarantor_representative_nif,
    r.client_name, r.client_cif, r.fiscal_address, r.fiscal_postal_code, r.fiscal_city, r.fiscal_province,
    r.signatory_name, r.signatory_nif, r.signatory_address, r.contact_name, r.contact_phone, r.contact_email,
    r.delivery_same_as_fiscal, r.delivery_address, r.product_description, r.notes,
    'New', 'draft'
  from jsonb_populate_record(null::public.contracts, p_contract) r
  returning contracts.id, contracts.contract_number, contracts.company_id into v_id, v_number, v_company;

  insert into public.contract_assets (contract_id, asset_type_id, quantity, description, unit_cost)
  select v_id, a.asset_type_id, a.quantity, a.description, a.unit_cost
  from jsonb_populate_record(null::public.contract_assets, p_asset) a;

  insert into public.sepa_mandates (
    contract_id, mandate_reference, debtor_name, debtor_address, debtor_postal_code, debtor_city, debtor_province,
    iban, bic, signed_place, signed_at
  )
  select v_id, v_number, m.debtor_name, m.debtor_address, m.debtor_postal_code, m.debtor_city, m.debtor_province,
    m.iban, m.bic, m.signed_place, m.signed_at
  from jsonb_populate_record(null::public.sepa_mandates, p_mandate) m;

  insert into public.contract_attachments (contract_id, kind, file_name, mime_type, size_bytes, storage_path)
  select v_id, t.kind, t.file_name, t.mime_type, t.size_bytes, t.storage_path
  from jsonb_populate_recordset(null::public.contract_attachments, coalesce(p_attachments, '[]'::jsonb)) t;

  update public.companies c
  set address = n.address, fiscal_postal_code = n.fiscal_postal_code, fiscal_city = n.fiscal_city, fiscal_province = n.fiscal_province,
      admin_name = n.admin_name, admin_nif = n.admin_nif, phone = n.phone, email = n.email
  from jsonb_populate_record(null::public.companies, p_company) n
  where c.id = v_company;

  return jsonb_build_object('id', v_id, 'contract_number', v_number);
end;
$$;

-- ---------------------------------------------------------------------------
-- Edit a DRAFT contract: its terms and identification, its equipment line, its
-- SEPA mandate and the company's identification. Returns false - having written
-- nothing - when the contract does not exist or is no longer a draft.
-- The company, the scoring, the creator, the number and the status never change.
-- ---------------------------------------------------------------------------
create or replace function public.update_draft_contract(
  p_contract_id uuid,
  p_contract    jsonb,
  p_asset       jsonb,
  p_mandate     jsonb,
  p_company     jsonb
) returns boolean
language plpgsql security invoker set search_path = '' as $$
declare
  v_number  text;
  v_company uuid;
  v_lines   integer;
begin
  -- The status is part of the write: a draft signed in the meantime is not touched.
  update public.contracts c
  set distributor_id = r.distributor_id,
      asset_type_id = r.asset_type_id, contract_type = r.contract_type, signing_date = r.signing_date,
      duration_months = r.duration_months, installment = r.installment, residual_value = r.residual_value, purchase_value = r.purchase_value,
      has_guarantor = r.has_guarantor, guarantor_name = r.guarantor_name, guarantor_nif = r.guarantor_nif,
      guarantor_address = r.guarantor_address, guarantor_representative = r.guarantor_representative,
      guarantor_representative_nif = r.guarantor_representative_nif,
      client_name = r.client_name, client_cif = r.client_cif, fiscal_address = r.fiscal_address,
      fiscal_postal_code = r.fiscal_postal_code, fiscal_city = r.fiscal_city, fiscal_province = r.fiscal_province,
      signatory_name = r.signatory_name, signatory_nif = r.signatory_nif, signatory_address = r.signatory_address,
      contact_name = r.contact_name, contact_phone = r.contact_phone, contact_email = r.contact_email,
      delivery_same_as_fiscal = r.delivery_same_as_fiscal, delivery_address = r.delivery_address,
      product_description = r.product_description, notes = r.notes
  from jsonb_populate_record(null::public.contracts, p_contract) r
  where c.id = p_contract_id and c.workflow_status = 'draft'
  returning c.contract_number, c.company_id into v_number, v_company;
  if not found then
    return false;
  end if;

  -- The equipment line: a draft has exactly one; anything else is replaced by it.
  select count(*) into v_lines from public.contract_assets l where l.contract_id = p_contract_id;
  if v_lines = 1 then
    update public.contract_assets l
    set asset_type_id = a.asset_type_id, quantity = a.quantity, description = a.description, unit_cost = a.unit_cost
    from jsonb_populate_record(null::public.contract_assets, p_asset) a
    where l.contract_id = p_contract_id;
  else
    delete from public.contract_assets l where l.contract_id = p_contract_id;
    insert into public.contract_assets (contract_id, asset_type_id, quantity, description, unit_cost)
    select p_contract_id, a.asset_type_id, a.quantity, a.description, a.unit_cost
    from jsonb_populate_record(null::public.contract_assets, p_asset) a;
  end if;

  -- The mandate keeps its reference and its date; a draft without one gets it now.
  insert into public.sepa_mandates (
    contract_id, mandate_reference, debtor_name, debtor_address, debtor_postal_code, debtor_city, debtor_province,
    iban, bic, signed_place, signed_at
  )
  select p_contract_id, v_number, m.debtor_name, m.debtor_address, m.debtor_postal_code, m.debtor_city, m.debtor_province,
    m.iban, m.bic, m.signed_place, m.signed_at
  from jsonb_populate_record(null::public.sepa_mandates, p_mandate) m
  on conflict (contract_id) do update
  set debtor_name = excluded.debtor_name, debtor_address = excluded.debtor_address, debtor_postal_code = excluded.debtor_postal_code,
      debtor_city = excluded.debtor_city, debtor_province = excluded.debtor_province,
      iban = excluded.iban, bic = excluded.bic, signed_place = excluded.signed_place;

  update public.companies c
  set address = n.address, fiscal_postal_code = n.fiscal_postal_code, fiscal_city = n.fiscal_city, fiscal_province = n.fiscal_province,
      admin_name = n.admin_name, admin_nif = n.admin_nif, phone = n.phone, email = n.email
  from jsonb_populate_record(null::public.companies, p_company) n
  where c.id = v_company;

  return true;
end;
$$;

-- Callable by the server (service role) only: never by PUBLIC or the API roles.
revoke execute on function public.create_draft_contract(jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.update_draft_contract(uuid, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_draft_contract(jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.update_draft_contract(uuid, jsonb, jsonb, jsonb, jsonb) to service_role;
