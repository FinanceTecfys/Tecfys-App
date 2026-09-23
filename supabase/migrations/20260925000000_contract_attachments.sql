-- Contract attachments: the signatory's ID document (DNI/NIE) and the bank
-- certificate that backs the SEPA mandate, uploaded in "Nueva operación".
--
-- The file lives in the PRIVATE storage bucket "contract-attachments"; this
-- table keeps its metadata. The app reaches both only through the service role,
-- and the user downloads a file through a server route that streams it - the
-- bucket is never public and no signed URL is handed out.
--
-- Optional by construction: a contract may have none, one or both, so existing
-- contracts and the imported loan book are unaffected.

create type contract_attachment_kind as enum ('id_document', 'bank_certificate');

create table contract_attachments (
  id            uuid primary key default gen_random_uuid(),
  contract_id   uuid not null references contracts (id) on delete cascade,
  kind          contract_attachment_kind not null,
  file_name     text not null,
  mime_type     text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  size_bytes    integer not null check (size_bytes > 0 and size_bytes <= 8388608),
  storage_path  text not null unique,
  created_at    timestamptz not null default now(),
  -- One file per kind: replacing a document replaces its row.
  unique (contract_id, kind)
);

alter table contract_attachments enable row level security;
grant all on table contract_attachments to service_role;

-- ---------------------------------------------------------------------------
-- Private bucket (also declared in supabase/config.toml for the local stack).
-- storage.objects keeps RLS on with no policies, so anon / authenticated can
-- neither list nor read it; only the service role, which bypasses RLS, can.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contract-attachments',
  'contract-attachments',
  false,
  8388608,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
