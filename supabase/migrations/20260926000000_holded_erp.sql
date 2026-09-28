-- ERP module: Holded sales invoices replicated into the platform.
--
-- holded_sales_invoices mirrors the Holded "Revenue" sales export (sheet
-- "Holded", header row 5) column for column. It is filled either by the API
-- sync (Holded API v2: /api/v2/invoices + /api/v2/credit-notes) or, while the
-- API key is not available, by importing that Excel. Both go through the same
-- pure mapper (src/modules/erp/domain), so the two sources land in one shape.
--
-- Num (the Holded document number, e.g. "TP-S-26-07874" or "CN260351") is the
-- natural key: every write is an upsert on it, so a re-sync never duplicates.
-- Credit notes keep Holded's sign convention: their amounts are negative.
--
-- The Holded API key is NOT stored here: it lives in the server environment
-- (HOLDED_API_KEY). erp_settings only holds non-secret connection settings.
--
-- RLS on, no policies: only the service role (server-side) reads or writes.

create table holded_sales_invoices (
  id                    uuid primary key default gen_random_uuid(),
  num                   text not null unique,
  holded_id             text,
  doc_type              text not null default 'invoice' check (doc_type in ('invoice', 'creditnote')),
  date                  timestamptz not null,
  operation_date        timestamptz,
  due_date              timestamptz,
  client                text,
  description           text,
  tags                  text,
  account               text,
  payment_method        text,
  project               text,
  subtotal              numeric not null,
  vat                   numeric,
  withholding           numeric,
  employees             numeric,
  equivalence_surcharge numeric,
  total                 numeric not null,
  collected             numeric,
  pending               numeric,
  status                text,
  collected_date        timestamptz,
  digital_signature     text,
  sii                   text,
  source                text not null check (source in ('api', 'excel')),
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger holded_sales_invoices_updated_at before update on holded_sales_invoices
  for each row execute function set_updated_at();

-- Not unique: Num is the key; a renumbered document must not block the upsert.
create index holded_sales_invoices_holded_id_idx on holded_sales_invoices (holded_id);
create index holded_sales_invoices_date_idx on holded_sales_invoices (date desc, num desc);
-- The incremental sync re-reads every invoice that is still open.
create index holded_sales_invoices_open_idx on holded_sales_invoices (date) where pending <> 0;

comment on table holded_sales_invoices is 'Holded sales invoices and credit notes (Holded sales export layout)';
comment on column holded_sales_invoices.num is 'Holded "Num": document number, natural unique key';
comment on column holded_sales_invoices.operation_date is 'Holded "Operation date"';
comment on column holded_sales_invoices.due_date is 'Holded "Due"';
comment on column holded_sales_invoices.payment_method is 'Holded "P.Method"';
comment on column holded_sales_invoices.vat is 'Holded "IVA"';
comment on column holded_sales_invoices.withholding is 'Holded "Retención" (positive, subtracted from the total)';
comment on column holded_sales_invoices.employees is 'Holded "Empleados"';
comment on column holded_sales_invoices.equivalence_surcharge is 'Holded "Rec. de eq."';
comment on column holded_sales_invoices.collected is 'Holded "Collected" (exported as text like "768.35€", stored numeric)';
comment on column holded_sales_invoices.collected_date is 'Holded "Collected date"';
comment on column holded_sales_invoices.digital_signature is 'Holded "Digital signature"';

-- ---------------------------------------------------------------------------
-- Sync log: one row per API sync or Excel import. The last successful API run
-- drives the incremental window of the next one.
-- ---------------------------------------------------------------------------
create table holded_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (source in ('api', 'excel')),
  status        text not null default 'running' check (status in ('running', 'success', 'error')),
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  window_start  date,
  window_end    date,
  fetched       integer not null default 0,
  created       integer not null default 0,
  updated       integer not null default 0,
  skipped       integer not null default 0,
  invalid       integer not null default 0,
  error         text,
  -- Rejected rows and non-fatal warnings (capped), shown next to the counts.
  messages      text[] not null default '{}',
  triggered_by  text
);
create index holded_sync_runs_started_idx on holded_sync_runs (started_at desc);

-- ---------------------------------------------------------------------------
-- Non-secret ERP connection settings: a single row (id is always true).
-- ---------------------------------------------------------------------------
create table erp_settings (
  id                    boolean primary key default true check (id),
  holded_base_url       text not null default 'https://api.holded.com',
  include_credit_notes  boolean not null default true,
  sync_lookback_days    integer not null default 31 check (sync_lookback_days between 0 and 365),
  updated_at            timestamptz not null default now()
);
create trigger erp_settings_updated_at before update on erp_settings
  for each row execute function set_updated_at();
insert into erp_settings (id) values (true) on conflict (id) do nothing;

alter table holded_sales_invoices enable row level security;
alter table holded_sync_runs      enable row level security;
alter table erp_settings          enable row level security;
grant all on table holded_sales_invoices to service_role;
grant all on table holded_sync_runs      to service_role;
grant all on table erp_settings          to service_role;
