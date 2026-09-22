-- Contract draft: structured fiscal address on the company, the contract's
-- frozen identification snapshot, and the SEPA direct-debit mandate.
--
-- The snapshot columns are copied from the company when the draft is created,
-- so the generated contract always matches what is stored even if the company
-- record is corrected later. All nullable: contracts imported from the
-- Borrowing Base have none of this data.

-- ---------------------------------------------------------------------------
-- Company: structured fiscal address (companies.address is the street line)
-- ---------------------------------------------------------------------------
alter table companies
  add column fiscal_postal_code text,
  add column fiscal_city        text,
  add column fiscal_province    text,
  add column admin_nif          text;

-- ---------------------------------------------------------------------------
-- Contract: identification snapshot + delivery + product
-- ---------------------------------------------------------------------------
alter table contracts
  add column client_name             text,
  add column client_cif              text,
  add column fiscal_address          text,
  add column fiscal_postal_code      text,
  add column fiscal_city             text,
  add column fiscal_province         text,
  add column signatory_name          text,
  add column signatory_nif           text,
  add column signatory_address       text,
  add column contact_name            text,
  add column contact_phone           text,
  add column contact_email           text,
  add column delivery_same_as_fiscal boolean not null default true,
  add column delivery_address        text,
  add column guarantor_address       text,
  add column guarantor_representative     text,  -- when the guarantor is a company
  add column guarantor_representative_nif text,
  add column product_description     text;

-- ---------------------------------------------------------------------------
-- SEPA direct-debit mandate (one per contract; more fields can be added here)
-- ---------------------------------------------------------------------------
create table sepa_mandates (
  id                  uuid primary key default gen_random_uuid(),
  contract_id         uuid not null unique references contracts (id) on delete cascade,
  mandate_reference   text not null,
  debtor_name         text not null,
  debtor_address      text,
  debtor_postal_code  text,
  debtor_city         text,
  debtor_province     text,
  iban                text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  bic                 text check (bic is null or bic ~ '^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$'),
  recurrent           boolean not null default true,
  signed_place        text,
  signed_at           date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger sepa_mandates_updated_at before update on sepa_mandates
  for each row execute function set_updated_at();

alter table sepa_mandates enable row level security;
grant all on table sepa_mandates to service_role;
