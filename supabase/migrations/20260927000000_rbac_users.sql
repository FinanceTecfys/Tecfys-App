-- Role-based access control: one role per user, and who created each record.
--
-- profiles links a Supabase Auth user to its app role. A signed-in user with no
-- profile, or an inactive one, has NO access to the app (least privilege).
--
--   owner    everything; the root role: exactly one (finance@tecfys.com), never
--            deleted or demoted by the app. Only the owner manages admins.
--   admin    everything operational, all settings and user management, except
--            anything that touches the owner or another admin.
--   sales    dashboard, loan book, waterfall, run scoring, create operations.
--   partner  run scoring and create operations only, and only sees the
--            scorings / operations it created. Tied to the distributor it
--            represents (partner_distributor_id).
--
-- The permission matrix itself lives in src/lib/auth/permissions.ts and is
-- enforced in the application layer (proxy, Server Components, Server Actions,
-- route handlers, data layer). This migration does NOT add per-user RLS
-- policies: RLS stays on with no policies, so only the service role (server
-- side) reads or writes. Per-user policies are a documented follow-up.

create type user_role as enum ('owner', 'admin', 'sales', 'partner');

create table profiles (
  user_id                uuid primary key references auth.users (id) on delete cascade,
  role                   user_role not null,
  -- The distributor a partner represents; always null for the other roles.
  partner_distributor_id uuid references distributors (id) on delete restrict,
  active                 boolean not null default true,
  created_by             uuid references auth.users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint profiles_distributor_only_for_partners check (role = 'partner' or partner_distributor_id is null)
);
create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

-- Exactly one owner: a second owner row is rejected by the database itself.
create unique index profiles_single_owner on profiles (role) where role = 'owner';
create index profiles_partner_distributor_idx on profiles (partner_distributor_id) where partner_distributor_id is not null;

comment on table profiles is 'App role of each Supabase Auth user (RBAC); no row or inactive = no access';
comment on column profiles.partner_distributor_id is 'Distributor a partner represents; null for owner / admin / sales';

alter table profiles enable row level security;
grant all on table profiles to service_role;

-- ---------------------------------------------------------------------------
-- Owner seed: finance@tecfys.com, looked up by email in auth.users.
-- Idempotent. If the user does not exist yet (fresh stack, `supabase db reset`)
-- the trigger below gives it the owner profile the moment it is created.
-- ---------------------------------------------------------------------------
insert into profiles (user_id, role)
select id, 'owner' from auth.users where lower(email) = 'finance@tecfys.com'
on conflict do nothing;

create or replace function public.seed_owner_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if lower(new.email) = 'finance@tecfys.com' then
    insert into public.profiles (user_id, role) values (new.id, 'owner') on conflict do nothing;
  end if;
  return new;
end;
$$;
revoke execute on function public.seed_owner_profile() from public, anon, authenticated;

create trigger seed_owner_profile after insert on auth.users
  for each row execute function public.seed_owner_profile();

-- ---------------------------------------------------------------------------
-- Ownership: who created each scoring and each contract / operation.
-- Null for everything that predates this migration and for the imported loan
-- book. Partners only reach the rows they created; the Pipeline module will
-- aggregate partner activity on these columns.
-- ---------------------------------------------------------------------------
alter table scorings  add column created_by uuid references auth.users (id) on delete set null;
alter table contracts add column created_by uuid references auth.users (id) on delete set null;
create index scorings_created_by_idx  on scorings (created_by)  where created_by is not null;
create index contracts_created_by_idx on contracts (created_by) where created_by is not null;

comment on column scorings.created_by  is 'Auth user that ran the scoring; null for rows older than RBAC';
comment on column contracts.created_by is 'Auth user that created the operation; null for the imported loan book';
