# Contract template

| File | What it is |
|---|---|
| `source/Tecfys contract Template.docx` | Tecfys' Word contract as delivered by legal. **Never edited by hand in this repo.** |
| `contract-template.docx` | Tagged copy used by the app (docxtemplater). **Generated**, do not edit. |

Regenerate the tagged copy after any change to the source:

```bash
npx tsx scripts/build-contract-template.ts
```

The script replaces the `xxx` markers run by run. Every rule states the exact
runs it expects, so if legal rewrites a paragraph the script **fails** and names
it instead of leaving `xxx` in the contract. The "Condiciones Particulares" live
in text boxes that Word stores twice (`mc:Choice` + VML `mc:Fallback`); both
copies are tagged.

Changes applied to the tagged copy on top of the source:
- Guarantor line: `(en adelante El Cliente)` → `(en adelante El Avalista)` (copy-paste error in the source).
- Product description: the `XXX, ` placeholder was 5 pt; it now takes the paragraph's 8 pt.

## Field → tag mapping

Data comes from the contract's frozen snapshot (`contracts`) and its `sepa_mandates` row,
mapped by `buildContractTemplateData()` in `src/modules/contracts/domain/contract-template.ts`.

| Contract field (Condiciones Particulares) | Tag | Source / format |
|---|---|---|
| Contrato nº (header, Anexo I title, remission to Anexo I) | `{contract_number}` | `contracts.contract_number` |
| Cliente: razón social | `{client_name}` | `client_name` |
| Cliente: CIF | `{client_cif}` | `client_cif` |
| Cliente: domicilio fiscal ("…en Calle …") | `{client_fiscal_address}` | street (leading "Calle"/"C/" stripped, the template prints "Calle") + postcode + city (province) |
| Representada por / DNI | `{signatory_name}` / `{signatory_nif}` | `signatory_name` / `signatory_nif` |
| "y domicilio …" of the signatory | `{#signatory_address}…{signatory_address}{/signatory_address}` | optional: omitted when empty |
| Avalista (whole clause) | `{#has_guarantor}…{/has_guarantor}{^has_guarantor}Sin avalista{/has_guarantor}` | `has_guarantor` |
| Avalista: nombre / CIF / domicilio | `{guarantor_name}` / `{guarantor_nif}` / `{guarantor_address}` | guarantor columns |
| Avalista: representada por / DNI | `{#guarantor_representative}…{/guarantor_representative}` + `{guarantor_representative_nif}` | only when the guarantor is a company |
| Descripción del producto | `{product_description}` | `product_description` |
| Mínimo de XX cuotas | `{duration_months}` | `duration_months` |
| Importe mensual de la cuota | `{installment}` | `1.234,56` (es-ES, always grouped) |
| Domicilio de entrega | `{delivery_address}` | fiscal address in full when `delivery_same_as_fiscal`, else `delivery_address` |
| SEPA: nombre del deudor | `{sepa_debtor_name}` | `sepa_mandates.debtor_name` |
| SEPA: dirección del deudor | `{sepa_debtor_street}` | `debtor_address` |
| SEPA: código postal | `{sepa_debtor_postal_code}` | `debtor_postal_code` |
| SEPA: ciudad (provincia) | `{sepa_debtor_city}` | `debtor_city` (+ province when different) |
| SEPA: IBAN (replaces the literal "ES") | `{sepa_iban}` | grouped by 4 |
| SEPA: fecha / lugar | `{sepa_date}` / `{sepa_place}` | draft date `dd/mm/aaaa` / debtor city |
| Notificaciones: contacto / teléfono / email | `{contact_name}` / `{contact_phone}` / `{contact_email}` | contact columns |

Fixed in the template (not data): Tecfys' identification and signatory, SEPA creditor
identifier, "Pago recurrente: Sí", Tecfys' notification address, general terms, signature lines.

Stored but **not printed** because the template has no place for them: BIC and mandate
reference (`sepa_mandates.bic`, `mandate_reference` = contract number), residual value,
signing date.
