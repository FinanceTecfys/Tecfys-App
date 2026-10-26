-- Defence in depth: Row Level Security on every app table.
--
-- The app reaches the database through the service role only (server side,
-- src/lib/supabase/server.ts), and the permission matrix is enforced in the
-- application layer. That does not change here. What this migration closes is
-- the back door: a leaked anon key or a plain authenticated session talking to
-- PostgREST / GraphQL directly must not reach any app data.
--
-- Three layers, each sufficient on its own:
--   1. anon / authenticated hold no privileges on public tables or sequences
--      (20260929000000_revoke_api_role_privileges, re-stated below);
--   2. RLS is ENABLED on every table in schema public, with no policy that lets
--      anon read or write anything;
--   3. RLS is FORCED, so even the table owner is subject to it unless the owner
--      role itself has BYPASSRLS.
--
-- The service role keeps working: BYPASSRLS is an attribute of the role, so RLS
-- (forced or not) never applies to it. The block below refuses to run on a
-- stack where that does not hold, rather than silently locking the app out.
--
-- Storage needs no change: both buckets (informa-reports, contract-attachments)
-- are private, storage.objects has RLS on with no policies, so anon /
-- authenticated can neither list nor download; files are streamed by the app's
-- own routes through the service role.
--
-- Idempotent: enabling / forcing RLS twice, revoking what is not held and the
-- drop-then-create of each policy are all no-ops on a second run.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'service_role' and rolbypassrls) then
    raise exception 'service_role must have BYPASSRLS: forcing RLS would lock the app out';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1 + 2 + 3. Every table in public, including any added before this migration
-- without RLS. profiles is enabled but NOT forced: the owner-seed trigger
-- (seed_owner_profile) and current_app_role() below are SECURITY DEFINER and
-- read / write it as the table owner, which must not depend on the owner
-- having BYPASSRLS on every platform.
-- ---------------------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')
    order by c.relname
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    if t.relname <> 'profiles' then
      execute format('alter table public.%I force row level security', t.relname);
    end if;
  end loop;
end;
$$;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Per-user policy PATTERN (scorings, contracts).
--
-- INERT TODAY. The app reads and writes as the service role, which bypasses
-- these policies; anon / authenticated have no SELECT on the tables and no
-- EXECUTE on the helper, so the policies are never reached. They are the
-- reviewed, tested expression of the real rule (src/lib/auth/scope.ts) for the
-- day a read switches to the user's own session:
--   owner / admin / sales  see every row;
--   partner                sees only the rows it created (created_by);
--   no profile / inactive  sees nothing.
--
-- To switch a read to per-user RLS, a future migration grants
--   grant select on table public.<table> to authenticated;
--   grant execute on function public.current_app_role() to authenticated;
-- and the data layer reads that table with the user's session client instead
-- of db(). Writes stay on the service role (no INSERT / UPDATE / DELETE policy).
-- ---------------------------------------------------------------------------

-- The caller's app role, or null when it has no profile or an inactive one.
-- SECURITY DEFINER so a policy can read profiles without the caller holding any
-- privilege on it; empty search_path and fully-qualified names, no dynamic SQL.
create or replace function public.current_app_role() returns public.user_role
language sql stable security definer set search_path = '' as $$
  select p.role
  from public.profiles p
  where p.user_id = auth.uid() and p.active;
$$;
revoke execute on function public.current_app_role() from public, anon, authenticated;
grant execute on function public.current_app_role() to service_role;

comment on function public.current_app_role() is
  'App role of the calling auth user (null if no active profile); used by the per-user RLS pattern';

drop policy if exists scorings_select_staff_or_own on public.scorings;
create policy scorings_select_staff_or_own on public.scorings
  for select to authenticated
  using (
    (select public.current_app_role()) in ('owner', 'admin', 'sales')
    or (created_by = (select auth.uid()) and (select public.current_app_role()) is not null)
  );

drop policy if exists contracts_select_staff_or_own on public.contracts;
create policy contracts_select_staff_or_own on public.contracts
  for select to authenticated
  using (
    (select public.current_app_role()) in ('owner', 'admin', 'sales')
    or (created_by = (select auth.uid()) and (select public.current_app_role()) is not null)
  );
