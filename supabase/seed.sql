-- Reference data. Contracts and clients are loaded with `npm run import:loan-book`.

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
