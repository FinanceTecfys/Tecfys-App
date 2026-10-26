-- Everything a fresh cloud project needs that used to come only from the local
-- stack: `supabase db push` applies migrations, but never runs seed.sql and
-- never reads the [storage.buckets.*] sections of config.toml.
--
--   1. Reference data the loan book depends on (moved here from seed.sql):
--      contracts.contract_type references contract_types, and the loan-book
--      import maps the cluster columns onto asset_types by name - without them
--      the import fails (contract types) or silently drops every equipment line
--      (asset types).
--   2. The private "informa-reports" bucket (scoring PDF uploads), until now
--      declared only in config.toml. contract-attachments already has its own
--      migration (20260925000000).
--
-- Idempotent: every insert is ON CONFLICT DO NOTHING on the tables' unique keys,
-- so it is a no-op where the rows already exist (any local stack seeded before).

insert into contract_types (code, label, billing_lag_months) values
  ('Renting',        'Renting',                   0),
  ('Renting F',      'Renting F (starts +1 month)', 1),
  ('Renting RC',     'Renting RC',                0),
  ('Renting K',      'Renting K',                 0),
  ('Subscription',   'Subscription',              0),
  ('Subscription K', 'Subscription K',            0)
on conflict (code) do nothing;

-- One asset type per Loan book cluster column (Y:AI); more can be added in the app.
insert into asset_types (name, cluster) values
  ('Electrical Appliances',     'Electrical Appliances'),
  ('Laptops',                   'Laptops'),
  ('Móviles & Tablets',         'Móviles & Tablets'),
  ('TV',                        'TV'),
  ('Technological Accessories', 'Technological Accessories'),
  ('Small Appliances',          'Small Appliances'),
  ('Water Dispenser',           'Water Dispenser'),
  ('Other',                     'Other'),
  ('Hospitality Machinery',     'Hospitality Machinery'),
  ('Mobiliario general',        'Mobiliario general'),
  ('Mobility',                  'Mobility')
on conflict do nothing;

insert into distributors (name) values ('Direct') on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Private bucket for the Informa PDFs (mirrors config.toml). storage.objects
-- keeps RLS on with no policies: only the service role reads or writes it.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('informa-reports', 'informa-reports', false, 20971520, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
