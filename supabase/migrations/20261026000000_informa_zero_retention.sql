-- Informa zero retention.
--
-- Business rule: Tecfys does not store Informa reports. Neither the uploaded PDF
-- nor the raw API response is kept anywhere (Storage, DB, logs, temp files).
-- The PDF is parsed in memory and discarded at the end of the request; what is
-- persisted is the mapped data the scoring needs (scorings.financials) and the
-- provenance of the report below.
--
-- 1. informa_reports becomes a provenance RECEIPT, issued by the server when a
--    report is parsed or fetched and owned by whoever did it (the partner
--    ownership check of createScoring still runs on it). It loses:
--      storage_path  only existed to point at the PDF in the informa-reports bucket;
--      parsed        a copy of the report's mapped content, kept even when no
--                    scoring was ever made from it.
--    and gains the provenance fields: file_sha256 (pdf), report_date, fetched_at (api).
-- 2. Each scoring carries the provenance of its report, copied server-side from
--    the receipt by createScoring (never from the browser). Older scorings are
--    backfilled from the receipt they link.
-- 3. The informa-reports bucket is NOT removed here: Supabase forbids direct
--    SQL deletes on storage tables (storage.protect_delete). It is emptied and
--    deleted through the Storage API by scripts/purge-informa-reports.ts
--    (docs/DEPLOYMENT.md), and config.toml no longer declares it.
--
-- Idempotent: "if exists / if not exists" everywhere, backfills only fill nulls.

alter table informa_reports
  drop column if exists storage_path,
  drop column if exists parsed,
  add column if not exists file_sha256 text,
  add column if not exists report_date date,
  add column if not exists fetched_at  timestamptz;

alter table informa_reports drop constraint if exists informa_reports_file_sha256_check;
alter table informa_reports add constraint informa_reports_file_sha256_check check (file_sha256 ~ '^[0-9a-f]{64}$');

update informa_reports set fetched_at = created_at where source = 'informa_api' and fetched_at is null;

comment on table informa_reports is
  'Provenance receipt of an Informa report used for scoring. The report itself (PDF or API response) is never stored';
comment on column informa_reports.file_sha256 is 'pdf: SHA-256 (hex) of the uploaded bytes, computed in memory; the file is not kept';
comment on column informa_reports.report_date is 'The report''s own date: PDF header "Fecha", API fechaUltimoDatoIncluidoInforme';
comment on column informa_reports.fetched_at is 'api: when the report was fetched from Informa';

alter table scorings
  add column if not exists report_source      text,
  add column if not exists report_date        date,
  add column if not exists report_file_name   text,
  add column if not exists report_file_sha256 text,
  add column if not exists report_fetched_at  timestamptz;

alter table scorings drop constraint if exists scorings_report_source_check;
alter table scorings add constraint scorings_report_source_check check (report_source in ('pdf', 'api'));
alter table scorings drop constraint if exists scorings_report_file_sha256_check;
alter table scorings add constraint scorings_report_file_sha256_check check (report_file_sha256 ~ '^[0-9a-f]{64}$');

update scorings s
set report_source      = case r.source when 'informa_pdf' then 'pdf' when 'informa_api' then 'api' end,
    report_date        = r.report_date,
    report_file_name   = case when r.source = 'informa_pdf' then r.file_name end,
    report_file_sha256 = r.file_sha256,
    report_fetched_at  = r.fetched_at
from informa_reports r
where r.id = s.informa_report_id
  and s.report_source is null
  and r.source in ('informa_pdf', 'informa_api');

comment on column scorings.report_source      is 'Where the financials came from: pdf (uploaded Informa PDF) or api (Informa API); null = typed by hand';
comment on column scorings.report_date        is 'The Informa report''s own date, when it states one';
comment on column scorings.report_file_name   is 'pdf: original file name (the file itself is not kept)';
comment on column scorings.report_file_sha256 is 'pdf: SHA-256 (hex) of the uploaded bytes';
comment on column scorings.report_fetched_at  is 'api: when the report was fetched';
