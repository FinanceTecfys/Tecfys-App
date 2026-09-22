-- Loan book management: contract country and the early-cancellation settlement.
--
-- settlement_amount is what was actually collected to settle a contract
-- cancelled before term (CAP: paid by the partner, CAC: prepaid by the client,
-- CS, partial cancellation). The Borrowing Base carries that figure typed over
-- the residual value (col. AR, see changes_rationale item 15: the residual is
-- "a purchase option or a negotiated cancellation settlement"); here it is a
-- field of its own so the contractual residual is preserved. Nullable: every
-- imported contract has it null and reconciles exactly as before.

alter table contracts
  add column country           text,
  add column settlement_amount numeric check (settlement_amount is null or settlement_amount >= 0);

comment on column contracts.country is 'Loan book col. I';
comment on column contracts.settlement_amount is
  'Amount collected to settle an early cancellation; replaces the residual in the settlement month';
