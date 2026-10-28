-- Company master record with a change history.
--
--   COMPANY  = the current truth about the client. Updated from new Informa data,
--              never silently: every change is recorded in company_changes.
--   SCORING  = an immutable point-in-time snapshot; a new report always makes a
--              new scoring, existing scorings are never modified.
--   CONTRACT = keeps the scoring it was originated with (contracts.scoring_id),
--              untouched by anything here.
--
-- What changes, and who may change it, is decided in the application by a pure,
-- unit-tested policy (src/modules/companies/domain/update-policy.ts):
--   * Informa-authoritative identity fields (legal name, fiscal address,
--     administrator name / NIF, CNAE, sector, constitution date): a real
--     difference is applied and recorded when the scoring is made by Tecfys
--     staff (owner / admin / sales); a partner's scoring never changes the
--     master - the difference is recorded as PENDING for an owner / admin;
--   * Tecfys-maintained fields (phone, email, web, employees): only filled
--     when empty, never overwritten;
--   * a value is never replaced by an empty one; a new CIF creates the company.
--
-- 1. company_changes: one row per field change, applied / pending / rejected.
-- 2. record_scoring(): the scoring, the company write and its change rows (and
--    the receipt's company link) in ONE transaction.
-- 3. decide_company_change(): an owner / admin approves (applies to the
--    company) or rejects a pending change, atomically.
-- Both functions are security invoker, empty search_path, execute for the
-- service role only (same pattern as 20261001000000_atomic_contract_writes).

create type company_change_status as enum ('applied', 'pending', 'rejected');

create table if not exists company_changes (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references companies (id) on delete cascade,
  field       text not null check (field in (
                'name', 'address', 'fiscal_postal_code', 'fiscal_city', 'fiscal_province',
                'admin_name', 'admin_nif', 'cnae', 'sector', 'constitution_date',
                'phone', 'email', 'web', 'employees')),
  old_value   text,
  new_value   text not null check (btrim(new_value) <> ''),
  source      text not null check (source in ('informa_pdf', 'informa_api')),
  scoring_id  uuid references scorings (id) on delete set null,
  status      company_change_status not null,
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  decided_by  uuid references auth.users (id) on delete set null,
  decided_at  timestamptz,
  -- Pending until someone decides; applied / rejected always carry when.
  constraint company_changes_decided check ((status = 'pending') = (decided_at is null))
);
create index if not exists company_changes_company_idx on company_changes (company_id, created_at desc);
create index if not exists company_changes_pending_idx on company_changes (created_at) where status = 'pending';

comment on table company_changes is 'History of the company master record: every field change from Informa, applied, pending review (partner scorings) or rejected';
comment on column company_changes.status is 'applied: written to companies; pending: awaits an owner / admin; rejected: never written';

-- Same as every app table: RLS on and forced, no policy, service role only.
alter table company_changes enable row level security;
alter table company_changes force row level security;
grant all on table company_changes to service_role;

-- ---------------------------------------------------------------------------
-- Store a scoring with its company write and change history, atomically.
--   p_scoring     scorings columns (allow-listed below)
--   p_company     create: the new company's columns; update: ONLY the columns
--                 the policy applies ({} = the master is not touched)
--   p_changes     [{ field, old_value, new_value, status: applied|pending }]
--   p_company_id  the existing company; omitted (null) to create it from p_company
--   p_source      informa_pdf | informa_api (omitted when there are no changes)
--   p_report_id   the Informa receipt to link to the company, if any
-- Returns { scoring_id, company_id }.
-- ---------------------------------------------------------------------------
create or replace function public.record_scoring(
  p_scoring    jsonb,
  p_company    jsonb,
  p_changes    jsonb default '[]'::jsonb,
  p_company_id uuid  default null,
  p_source     text  default null,
  p_report_id  uuid  default null
) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare
  v_company uuid := p_company_id;
  v_scoring uuid;
  v_actor   uuid := nullif(p_scoring ->> 'created_by', '')::uuid;
begin
  if v_company is null then
    insert into public.companies (
      cif, name, country, sector, cnae, address, fiscal_postal_code, fiscal_city, fiscal_province,
      phone, email, web, constitution_date, employees, admin_name, admin_nif
    )
    select n.cif, n.name, coalesce(n.country, 'ES'), n.sector, n.cnae, n.address, n.fiscal_postal_code, n.fiscal_city, n.fiscal_province,
      n.phone, n.email, n.web, n.constitution_date, n.employees, n.admin_name, n.admin_nif
    from jsonb_populate_record(null::public.companies, p_company) n
    on conflict (cif) do nothing
    returning id into v_company;
    -- Created by a concurrent request in the meantime: link to it, change nothing.
    if v_company is null then
      select c.id into v_company from public.companies c where c.cif = p_company ->> 'cif';
    end if;
  elsif p_company is not null and p_company <> '{}'::jsonb then
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
    where c.id = v_company;
  end if;

  insert into public.scorings (
    company_id, informa_report_id, criteria_id, criteria_snapshot, financials, ratios, breakdown,
    total_score, rating, decision, prudence, adjusted_ebitda, credit_opinion, status, created_by,
    report_source, report_date, report_file_name, report_file_sha256, report_fetched_at
  )
  select v_company, s.informa_report_id, s.criteria_id, s.criteria_snapshot, s.financials, s.ratios, s.breakdown,
    s.total_score, s.rating, s.decision, s.prudence, s.adjusted_ebitda, s.credit_opinion, s.status, s.created_by,
    s.report_source, s.report_date, s.report_file_name, s.report_file_sha256, s.report_fetched_at
  from jsonb_populate_record(null::public.scorings, p_scoring) s
  returning id into v_scoring;

  insert into public.company_changes (company_id, field, old_value, new_value, source, scoring_id, status, created_by, decided_by, decided_at)
  select v_company, ch.field, ch.old_value, ch.new_value, p_source, v_scoring, ch.status::public.company_change_status, v_actor,
    case when ch.status = 'applied' then v_actor end,
    case when ch.status = 'applied' then now() end
  from jsonb_to_recordset(coalesce(p_changes, '[]'::jsonb)) as ch(field text, old_value text, new_value text, status text);

  if p_report_id is not null then
    update public.informa_reports r set company_id = v_company where r.id = p_report_id;
  end if;

  return jsonb_build_object('scoring_id', v_scoring, 'company_id', v_company);
end;
$$;

-- ---------------------------------------------------------------------------
-- Approve (apply to the company) or reject ONE pending change. Returns
-- 'applied' | 'rejected', or 'not_pending' / 'not_found' having written nothing.
-- ---------------------------------------------------------------------------
create or replace function public.decide_company_change(
  p_change_id uuid,
  p_approve   boolean,
  p_actor     uuid
) returns text
language plpgsql security invoker set search_path = '' as $$
declare
  r public.company_changes%rowtype;
begin
  select * into r from public.company_changes where id = p_change_id for update;
  if not found then return 'not_found'; end if;
  if r.status <> 'pending' then return 'not_pending'; end if;

  if p_approve then
    update public.companies c
    set name               = case r.field when 'name'               then r.new_value          else c.name end,
        address            = case r.field when 'address'            then r.new_value          else c.address end,
        fiscal_postal_code = case r.field when 'fiscal_postal_code' then r.new_value          else c.fiscal_postal_code end,
        fiscal_city        = case r.field when 'fiscal_city'        then r.new_value          else c.fiscal_city end,
        fiscal_province    = case r.field when 'fiscal_province'    then r.new_value          else c.fiscal_province end,
        admin_name         = case r.field when 'admin_name'         then r.new_value          else c.admin_name end,
        admin_nif          = case r.field when 'admin_nif'          then r.new_value          else c.admin_nif end,
        cnae               = case r.field when 'cnae'               then r.new_value          else c.cnae end,
        sector             = case r.field when 'sector'             then r.new_value          else c.sector end,
        constitution_date  = case r.field when 'constitution_date'  then r.new_value::date    else c.constitution_date end,
        phone              = case r.field when 'phone'              then r.new_value          else c.phone end,
        email              = case r.field when 'email'              then r.new_value          else c.email end,
        web                = case r.field when 'web'                then r.new_value          else c.web end,
        employees          = case r.field when 'employees'          then r.new_value::integer else c.employees end
    where c.id = r.company_id;
  end if;

  update public.company_changes
  set status = case when p_approve then 'applied' else 'rejected' end::public.company_change_status,
      decided_by = p_actor,
      decided_at = now()
  where id = p_change_id;
  return case when p_approve then 'applied' else 'rejected' end;
end;
$$;

revoke execute on function public.record_scoring(jsonb, jsonb, jsonb, uuid, text, uuid) from public, anon, authenticated;
revoke execute on function public.decide_company_change(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.record_scoring(jsonb, jsonb, jsonb, uuid, text, uuid) to service_role;
grant execute on function public.decide_company_change(uuid, boolean, uuid) to service_role;
