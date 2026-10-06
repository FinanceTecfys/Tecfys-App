-- Contract documents on ANY contract: besides the signatory's ID document and
-- the bank certificate, a contract can now hold the signed contract file itself
-- and one optional annex - four slots in all, also for the contracts imported
-- from the loan book, which have no app-generated draft.
--
-- Only the enum grows. contract_attachments keeps its shape and conventions
-- (RLS on with no policies, access granted to service_role only, at most one
-- file per contract and kind, files in the PRIVATE bucket "contract-attachments"
-- with the same type and size limits). Every slot stays optional: a contract
-- with none of the four documents is as valid as before, so nothing existing
-- changes.

alter type contract_attachment_kind add value if not exists 'contract';
alter type contract_attachment_kind add value if not exists 'extra';

-- Re-stated so this migration is self-contained on a fresh database.
grant all on table contract_attachments to service_role;
