-- Least privilege for the API roles.
--
-- The app reaches every table through the service role only (RLS is on with no
-- policies), so anon and authenticated need nothing in schema public. Supabase's
-- default privileges for objects created by postgres still handed them
-- TRUNCATE / REFERENCES / TRIGGER (and, on older stacks, everything) on each
-- table, and UPDATE on each sequence. None of it is reachable through PostgREST
-- today, but it is not needed either: revoke it, and stop new tables and
-- sequences from getting it again.
--
-- Idempotent: revoking a privilege that is not held is a no-op. service_role is
-- not touched: its grants come from the core schema migration and from each
-- later migration's explicit "grant all on table ... to service_role".

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

-- Tables and sequences created from now on by the migration role (postgres).
-- Objects created by supabase_admin are the platform's own and are not ours to change.
alter default privileges for role postgres in schema public revoke all on tables    from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;
