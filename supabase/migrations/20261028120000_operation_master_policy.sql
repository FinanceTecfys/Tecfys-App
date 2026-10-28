-- "Nueva operación" goes through the company master policy, and a contract's
-- origination is permanent.
--
-- 1. A contract's scoring can no longer be deleted from under it:
--    contracts.scoring_id goes from ON DELETE SET NULL to ON DELETE RESTRICT.
--    (Nothing in the app or the scripts deletes scorings.)
--
-- 2. company_changes also records changes that come from an operation:
--    source 'operation' and the contract they came from (contract_id).
--
-- 3. create_draft_contract / update_draft_contract no longer overwrite the
--    company with whatever was typed. What the user types is still saved on
--    the contract's own snapshot columns (the Word draft reads those); toward
--    the company master the server action runs the same pure update policy as
--    a scoring (src/modules/companies/domain/update-policy.ts) and sends:
--      p_company  ONLY the columns the policy applies ({} = the master is not
--                 touched: always the case for a partner);
--      p_changes  the change rows: applied (staff) or pending (partner).
--    Both functions are dropped and recreated with the extra parameters; the
--    rest of their body is unchanged. Everything - contract, equipment line,
--    mandate, attachments, company, history - is still ONE transaction.
--    A pending change identical to one already waiting (same company, field and
--    value) is not recorded twice, so editing a draft again adds no duplicates.

-- ---------------------------------------------------------------------------
-- 1. Origination is permanent
-- ---------------------------------------------------------------------------
alter table contracts drop constraint if exists contracts_scoring_id_fkey;
alter table contracts add constraint contracts_scoring_id_fkey
  foreign key (scoring_id) references scorings (id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 2. Changes from an operation
-- ---------------------------------------------------------------------------
alter table company_changes add column if not exists contract_id uuid references contracts (id) on delete set null;
alter table company_changes drop constraint if exists company_changes_source_check;
alter table company_changes add constraint company_changes_source_check check (source in ('informa_pdf', 'informa_api', 'operation'));
comment on column company_changes.contract_id is 'operation: the contract whose creation or edit brought the change';

-- ---------------------------------------------------------------------------
-- 3. The operation writes
-- ---------------------------------------------------------------------------
drop function if exists public.create_draft_contract(jsonb, jsonb, jsonb, jsonb, jsonb);
drop function if exists public.update_draft_contract(uuid, jsonb, jsonb, jsonb, jsonb);

create or replace function public.create_draft_contract(
  p_contract    jsonb,
  p_asset       jsonb,
  p_mandate     jsonb,
  p_company     jsonb,
  p_attachments jsonb default '[]'::jsonb,
  p_changes     jsonb default '[]'::jsonb
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_id      uuid;
  v_number  text;
  v_company uuid;
  v_actor   uuid;
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
  returning contracts.id, contracts.contract_number, contracts.company_id, contracts.created_by into v_id, v_number, v_company, v_actor;

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

  perform public.apply_operation_company_changes(v_company, v_id, v_actor, p_company, p_changes);

  return jsonb_build_object('id', v_id, 'contract_number', v_number);
end;
$$;

create or replace function public.update_draft_contract(
  p_contract_id uuid,
  p_contract    jsonb,
  p_asset       jsonb,
  p_mandate     jsonb,
  p_company     jsonb,
  p_changes     jsonb default '[]'::jsonb,
  p_actor       uuid  default null
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

  perform public.apply_operation_company_changes(v_company, p_contract_id, p_actor, p_company, p_changes);

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- The company side of an operation write, shared by both functions above (it
-- runs inside their transaction): apply ONLY the columns the policy sent, then
-- record the changes - applied ones decided by the actor now, pending ones
-- once (an identical pending change already waiting is not repeated).
-- ---------------------------------------------------------------------------
create or replace function public.apply_operation_company_changes(
  p_company_id  uuid,
  p_contract_id uuid,
  p_actor       uuid,
  p_company     jsonb,
  p_changes     jsonb
) returns void
language plpgsql security invoker set search_path = '' as $$
begin
  if p_company is not null and p_company <> '{}'::jsonb then
    update public.companies c
    set name               = case when p_company ? 'name'               then n.name               else c.name end,
        address            = case when p_company ? 'address'            then n.address            else c.address end,
        fiscal_postal_code = case when p_company ? 'fiscal_postal_code' then n.fiscal_postal_code else c.fiscal_postal_code end,
        fiscal_city        = case when p_company ? 'fiscal_city'        then n.fiscal_city        else c.fiscal_city end,
        fiscal_province    = case when p_company ? 'fiscal_province'    then n.fiscal_province    else c.fiscal_province end,
        admin_name         = case when p_company ? 'admin_name'         then n.admin_name         else c.admin_name end,
        admin_nif          = case when p_company ? 'admin_nif'          then n.admin_nif          else c.admin_nif end,
        cnae               = case when p_company ? 'cnae'               then n.cnae               else c.cnae end,
        sector             = case when p_company ? 'sector'             then n.sector             else c.sector end,
        constitution_date  = case when p_company ? 'constitution_date'  then n.constitution_date  else c.constitution_date end,
        phone              = case when p_company ? 'phone'              then n.phone              else c.phone end,
        email              = case when p_company ? 'email'              then n.email              else c.email end,
        web                = case when p_company ? 'web'                then n.web                else c.web end,
        employees          = case when p_company ? 'employees'          then n.employees          else c.employees end
    from jsonb_populate_record(null::public.companies, p_company) n
    where c.id = p_company_id;
  end if;

  insert into public.company_changes (company_id, field, old_value, new_value, source, contract_id, status, created_by, decided_by, decided_at)
  select p_company_id, ch.field, ch.old_value, ch.new_value, 'operation', p_contract_id, ch.status::public.company_change_status, p_actor,
    case when ch.status = 'applied' then p_actor end,
    case when ch.status = 'applied' then now() end
  from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as ch(field text, old_value text, new_value text, status text)
  where ch.status = 'applied'
     or not exists (
       select 1 from public.company_changes x
       where x.company_id = p_company_id and x.field = ch.field and x.new_value = ch.new_value and x.status = 'pending'
     );
end;
$$;

-- Callable by the server (service role) only: never by PUBLIC or the API roles.
revoke execute on function public.create_draft_contract(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.update_draft_contract(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
revoke execute on function public.apply_operation_company_changes(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.create_draft_contract(jsonb, jsonb, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.update_draft_contract(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;
grant execute on function public.apply_operation_company_changes(uuid, uuid, uuid, jsonb, jsonb) to service_role;
