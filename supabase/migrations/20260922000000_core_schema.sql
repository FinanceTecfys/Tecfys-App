-- Tecfys core schema: clients, scoring, catalog and the renting loan book.
--
-- The loan book stores only the INPUTS of each contract (the columns of the
-- Borrowing Base "Loan book" tab that are typed in, not computed). Everything
-- derived - expected IRR, principal / interest split, principal outstanding,
-- default write-off, portfolio summary - is computed by the TypeScript engine in
-- src/modules/contracts/domain so there is a single implementation of the maths.
--
-- RLS is enabled on every table with no policies: only the service role (used
-- server-side by the Next.js app) can read or write. Policies arrive with auth.

create type credit_rating as enum ('AAA', 'AA', 'A', 'BBB', 'BB', 'CCC', 'CC', 'C');
create type scoring_decision as enum ('auto', 'limited', 'manual', 'reject');
create type scoring_status as enum ('approved', 'pending_review', 'rejected');
create type scoring_source as enum ('informa_pdf', 'informa_api', 'manual');
create type contract_workflow_status as enum ('draft', 'pending_signature', 'signed', 'cancelled');

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Clients
-- ---------------------------------------------------------------------------
create table companies (
  id                uuid primary key default gen_random_uuid(),
  cif               text not null unique,
  name              text not null,
  country           text not null default 'ES',
  sector            text,
  cnae              text,
  address           text,
  phone             text,
  email             text,
  web               text,
  constitution_date date,
  employees         integer,
  admin_name        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create trigger companies_updated_at before update on companies
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Scoring
-- ---------------------------------------------------------------------------
-- Versioned scoring model (weights, tiers, buckets, prudence, sector map).
-- When no row is active the app falls back to DEFAULT_CRITERIA in code.
create table scoring_criteria (
  id         uuid primary key default gen_random_uuid(),
  version    integer not null unique,
  config     jsonb not null,
  is_active  boolean not null default false,
  notes      text,
  created_at timestamptz not null default now()
);
create unique index scoring_criteria_one_active on scoring_criteria (is_active) where is_active;

-- Parsed Informa report. The original PDF lives in the informa-reports bucket.
create table informa_reports (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid references companies (id) on delete set null,
  source         scoring_source not null,
  file_name      text,
  storage_path   text,
  reference_year integer,
  parsed         jsonb not null,
  created_at     timestamptz not null default now()
);
create index informa_reports_company on informa_reports (company_id);

create table scorings (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references companies (id) on delete restrict,
  informa_report_id uuid references informa_reports (id) on delete set null,
  criteria_id       uuid references scoring_criteria (id) on delete set null,
  criteria_snapshot jsonb not null,
  financials        jsonb not null,
  ratios            jsonb not null,
  breakdown         jsonb not null,
  total_score       numeric(6, 3) not null,
  rating            credit_rating not null,
  decision          scoring_decision not null,
  prudence          numeric(6, 4) not null,
  adjusted_ebitda   numeric(16, 2),
  credit_opinion    numeric(16, 2) not null,
  status            scoring_status not null,
  review_note       text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index scorings_company on scorings (company_id);
create trigger scorings_updated_at before update on scorings
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Catalog
-- ---------------------------------------------------------------------------
-- Partner / distributor that originates the deal (Loan book col J).
create table distributors (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cif        text,
  email      text,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index distributors_name_key on distributors (lower(btrim(name)));

-- Asset clusters follow the Loan book columns Y:AI.
create table asset_types (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  cluster    text not null,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index asset_types_name_key on asset_types (lower(btrim(name)));

-- Contract type drives the billing clock: "Renting F" starts billing one month
-- after signing, every other type bills in the signing month.
create table contract_types (
  code                 text primary key,
  label                text not null,
  billing_lag_months   integer not null default 0 check (billing_lag_months >= 0)
);

-- ---------------------------------------------------------------------------
-- Loan book
-- ---------------------------------------------------------------------------
create sequence contract_number_seq start 1;

create table contracts (
  id                      uuid primary key default gen_random_uuid(),
  contract_number         text not null unique
                            default 'TCF-' || lpad(nextval('contract_number_seq')::text, 6, '0'),
  loan_book_ref           text,  -- Loan book col C: not unique, sometimes text ("18340-1")
  company_id              uuid not null references companies (id) on delete restrict,
  scoring_id              uuid references scorings (id) on delete set null,
  distributor_id          uuid references distributors (id) on delete set null,       -- col J
  asset_type_id           uuid references asset_types (id) on delete set null,
  contract_type           text not null references contract_types (code),              -- col AL
  tranche_lender          text,                                                        -- col B
  product_type            text,                                                        -- col Q
  rating                  text,                                                        -- col L
  sector                  text,                                                        -- col K
  signing_date            date not null,                                               -- cols D/E
  duration_months         integer not null check (duration_months >= 0),               -- col N
  installment             numeric        not null,                                     -- col M
  residual_value          numeric       ,                                              -- col AR
  purchase_value          numeric        not null,                                     -- -col BE
  expo_adjustment         numeric        not null default 0,                           -- col AS
  has_guarantor           boolean not null default false,                              -- col AT
  guarantor_name          text,
  guarantor_nif           text,
  cancel_date             date,                                                        -- col R
  additional_status       text,                                                        -- col U (FC, CAT, Gesico...)
  residual_waived         boolean not null default false,  -- Gesico: residual never collected
  amortize_over_real_life boolean not null default false,  -- changes_rationale item 23 override
  workflow_status         contract_workflow_status not null default 'draft',
  notes                   text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index contracts_company on contracts (company_id);
create index contracts_loan_book_ref on contracts (loan_book_ref);
create index contracts_signing on contracts (signing_date);
create trigger contracts_updated_at before update on contracts
  for each row execute function set_updated_at();

-- Equipment lines of a contract (quantities by asset type, cols Y:AI).
create table contract_assets (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts (id) on delete cascade,
  asset_type_id uuid not null references asset_types (id) on delete restrict,
  quantity      integer not null default 1 check (quantity >= 0),
  description   text,
  unit_cost     numeric(14, 2)
);
create index contract_assets_contract on contract_assets (contract_id);

-- E-signature requests (Signaturit). Filled by the signature module.
create table signature_requests (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references contracts (id) on delete cascade,
  provider    text not null default 'signaturit',
  external_id text,
  status      text not null default 'created',
  payload     jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index signature_requests_contract on signature_requests (contract_id);
create trigger signature_requests_updated_at before update on signature_requests
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: locked down until auth is added
-- ---------------------------------------------------------------------------
alter table companies          enable row level security;
alter table scoring_criteria   enable row level security;
alter table informa_reports    enable row level security;
alter table scorings           enable row level security;
alter table distributors       enable row level security;
alter table asset_types        enable row level security;
alter table contract_types     enable row level security;
alter table contracts          enable row level security;
alter table contract_assets    enable row level security;
alter table signature_requests enable row level security;

-- Only the server (service role) gets table privileges; anon/authenticated get none.
grant usage on schema public to service_role;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
