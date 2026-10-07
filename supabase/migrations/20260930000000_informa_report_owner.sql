-- Ownership of an Informa report: who fetched it from the API or uploaded its PDF.
--
-- A scoring links the report it was computed from. Without an owner, any user
-- could link any report by id - a partner, the report another partner paid for.
-- Same pattern as scorings.created_by / contracts.created_by: the app scopes by
-- it (a partner only reaches the reports it created) and the column is nullable,
-- so the reports that exist today keep created_by = null and stay reachable by
-- the Tecfys roles only, exactly like every other record with no creator.
--
-- The table keeps its conventions: RLS on with no policies, access through the
-- service role (granted in the core schema migration; re-stated here).

alter table informa_reports add column if not exists created_by uuid references auth.users (id) on delete set null;
create index if not exists informa_reports_created_by_idx on informa_reports (created_by) where created_by is not null;

comment on column informa_reports.created_by is 'Auth user that fetched or uploaded the report; null for rows older than this column';

grant all on table informa_reports to service_role;
