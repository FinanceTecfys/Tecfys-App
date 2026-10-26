# Deployment: Vercel + Supabase cloud

Two environments, each with **its own Supabase project** and its own Vercel
environment. Nothing in the code changes between them; only environment
variables and dashboard settings do.

| Environment | URL | Supabase project | Vercel environment |
|---|---|---|---|
| Production | https://app.tecfys.com | `tecfys-prod` | Production (branch `main`) |
| Staging | https://staging.tecfys.com | `tecfys-staging` | Preview, branch `develop`, with the staging domain assigned |

Repeat sections 1-6 for each environment. Commands are PowerShell, run from the
repository root.

---

## 1. Supabase project

1. Create the project in the Supabase dashboard. Use **Postgres 17**, which
   matches `[db] major_version` in `supabase/config.toml`, and an EU region.
   Keep the database password in the password manager.
2. Link the repository and push the migrations:

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push --dry-run   # lists every migration it will apply
   npx supabase db push
   ```

   `db push` applies `supabase/migrations/*` in order. It does **not** run
   `supabase/seed.sql`, which is intentionally empty, and it does **not** read
   `config.toml`. The migrations already create everything the app needs in the
   database:
   - the schema and RLS (forced on every table);
   - the revoked API-role privileges;
   - the reference data: contract types, asset types and the `Direct` distributor;
   - the **private** storage bucket `contract-attachments`;
   - the Informa provenance columns (zero retention, see below).

   They were verified to apply cleanly from zero with `supabase db reset`.
3. Remove the `informa-reports` bucket. An older migration (`20261004000000`)
   still creates it, empty. Migrations cannot delete it, because Supabase
   forbids SQL deletes on storage tables. Remove it through the Storage API,
   with the shell variables of [section 5](#5-first-owner) set:

   ```powershell
   npm run purge:informa-reports -- --dry-run   # counts only
   npm run purge:informa-reports                # deletes its files and the bucket
   ```

   It is safe to re-run: a second run reports "nothing to purge". It touches no
   other bucket, and it fails if the number of files in `contract-attachments`
   changes.
4. Run the checks in [section 7.1](#71-database-run-in-the-sql-editor) before
   going further.

### Informa: zero retention

Tecfys does **not** store Informa reports, so there is no `informa-reports`
bucket. Neither the uploaded PDF nor the raw API response is kept anywhere:
not in Storage, the database, logs or temp files.

- The PDF is parsed in memory and discarded at the end of the request.
- The API response is mapped in memory, and only the mapped fields reach the
  browser.
- What is persisted is only:
  - the mapped financial data on the scoring (`scorings.financials`);
  - the report's provenance: source (`pdf` / `api`), the report's own date,
    and, for a PDF, its file name and the SHA-256 of its bytes, or, for the
    API, the fetch time.
- The provenance is kept on the scoring (`scorings.report_*`) and on a receipt
  without content (`informa_reports`), which proves who parsed or fetched it.

## 2. Supabase dashboard settings (from config.toml, by hand)

These live only in `supabase/config.toml`, which the hosted project never
reads. Set them in each project.

### Authentication > URL Configuration

| Setting | Production | Staging | config.toml |
|---|---|---|---|
| Site URL | `https://app.tecfys.com` | `https://staging.tecfys.com` | `[auth] site_url` |
| Redirect URLs | `https://app.tecfys.com`, `https://staging.tecfys.com` | same | `[auth] additional_redirect_urls` |

The app sends `redirectTo = SITE_URL` with every invitation, and the email
templates build the link on `{{ .RedirectTo }}`. If that URL is missing from
Redirect URLs, Supabase silently falls back to the Site URL.

### Authentication > Sign In / Providers

| Setting | Value | config.toml |
|---|---|---|
| Allow new users to sign up | **OFF** (users are invited only) | `[auth] enable_signup = false` |
| Email provider | **Enabled** (email + password login) | `[auth.email] enable_signup = true` |
| Confirm email | ON (the default). Invited users confirm by setting their password. | `[auth.email] enable_confirmations` (local: false) |
| Secure password change | OFF | `[auth.email] secure_password_change = false` |
| Minimum password length | 10, to match the app's set-password form (`MIN_PASSWORD_LENGTH`) | `[auth] minimum_password_length = 6` (local) |
| Anonymous sign-ins, manual linking, phone, MFA, external providers | OFF (the defaults) | as in config.toml |
| Email OTP expiration | 3600 s (how long invitation links stay valid) | `[auth.email] otp_expiry = 3600` |

Warning: "Allow new users to sign up" and the Email provider are two different
switches. Disabling the **Email provider** also disables password **login**.
Only the sign-up switch goes off.

### Authentication > Email Templates

Paste the HTML exactly. The subjects come from `config.toml`, and both
templates link to `{{ .RedirectTo }}/auth/set-password?token_hash=...`.

| Template | Subject | Body |
|---|---|---|
| Invite user | `Invitacion a la plataforma de Tecfys` | `supabase/templates/invite.html` |
| Reset password | `Nueva contrasena para la plataforma de Tecfys` | `supabase/templates/recovery.html` |

### Authentication > SMTP Settings and Rate Limits

- **Custom SMTP is required.** Locally, mail goes to Mailpit (`[local_smtp]`).
  Supabase's built-in sender only delivers to project team members, at a few
  emails per hour. Configure a provider (sender e.g.
  `no-reply@tecfys.com`, sender name `Tecfys`) and add its SPF/DKIM DNS records
  (section 4).
- Rate limit, emails sent per hour: raise it from the default to fit invitations
  (local `[auth.rate_limit] email_sent = 2` is a local-only value).

### Project Settings > API, and Storage

| Setting | Value | config.toml |
|---|---|---|
| Exposed schemas | `public`, `graphql_public` (the default) | `[api] schemas` |
| Max rows | 1000 (the default; the scripts paginate in pages of 1000) | `[api] max_rows` |
| Storage, global file size limit | 50 MB (the default); each bucket's own limit comes from its migration | `[storage] file_size_limit` |

### Project Settings > API Keys

Copy the **publishable** key and a **secret** key into the Vercel variables
(section 3). Never use the secret key anywhere but server-side variables.

## 3. Vercel

1. Import the GitHub repository. Framework preset: Next.js. Build command:
   `next build` (the default). Node.js version: 24.x, as used in development.
2. Environment variables. All of them are **server-only**: there is no
   `NEXT_PUBLIC_` variable, and none must ever be created. Set them per
   environment (Production = prod project, Preview = staging project). The
   server validates them at startup (`src/lib/env.ts`, `src/instrumentation.ts`)
   and, if any is missing or invalid, logs `Invalid server environment` naming
   it and answers every request with 500 instead of serving a half-configured app.

   | Name | Required | Notes |
   |---|---|---|
   | `SUPABASE_URL` | yes | `https://<project-ref>.supabase.co` |
   | `SUPABASE_SECRET_KEY` | yes | secret key: mark it **Sensitive** |
   | `SUPABASE_PUBLISHABLE_KEY` | yes | publishable key, used for auth sessions only |
   | `SITE_URL` | yes | `https://app.tecfys.com` (Production) / `https://staging.tecfys.com` (Preview) |
   | `HOLDED_API_KEY` | no | ERP sync (Sensitive) |
   | `INFORMA_API_URL` | no | `https://services.informa.es/api/v2` |
   | `INFORMA_USERNAME` | no | Sensitive |
   | `INFORMA_PASSWORD` | no | Sensitive |
   | `INFORMA_SESSION` | no | normally unset |
   | `SIGNATURIT_API_URL` | no | not wired yet |
   | `SIGNATURIT_TOKEN` | no | not wired yet (Sensitive) |

   `.env.example` lists the same names with a comment each.
3. Domains: add `app.tecfys.com` to Production. Add `staging.tecfys.com` and
   assign it to the `develop` branch (Settings > Domains > Git branch).

## 4. DNS (tecfys.com zone)

| Record | Name | Value |
|---|---|---|
| CNAME | `app` | the target Vercel shows for the domain (e.g. `cname.vercel-dns.com`) |
| CNAME | `staging` | same |
| TXT/CNAME | as given by the SMTP provider | SPF / DKIM (and DMARC) for the sender domain |

Wait until Vercel shows each domain as valid, with its certificate issued.

## 5. First owner

Run this once per project. It is safe to run again. It reads the same variables
as the app. Values set in the shell win over `.env.local`, so point it at the
cloud project explicitly:

```powershell
$env:SUPABASE_URL = "https://<project-ref>.supabase.co"
$env:SUPABASE_SECRET_KEY = "<secret key>"
$env:SUPABASE_PUBLISHABLE_KEY = "<publishable key>"
$env:SITE_URL = "https://app.tecfys.com"      # or https://staging.tecfys.com
npm run bootstrap:owner -- --dry-run          # prints the target and what it would do
npm run bootstrap:owner
```

- It invites `finance@tecfys.com`. The `seed_owner_profile` trigger gives the
  new user the owner profile, and the email links to
  `SITE_URL/auth/set-password`.
- Second run: `Done already`. It never changes another user's role, and it
  refuses (`Not bootstrapping`) if someone else already holds the owner role.
- Invitation not received yet? Run `npm run bootstrap:owner -- --resend`.
- Afterwards the owner invites everyone else from Configuración > Usuarios.

Close the PowerShell window afterwards (or `Remove-Item Env:SUPABASE_*`), so a
later local command does not target the cloud.

## 6. Data

With the same shell variables set as in section 5:

```powershell
npm run import:loan-book -- "Legacy/Tecfys Borrowing base_15092026_default alignment.xlsx"
npm run import:holded -- "<path to the Holded export .xlsx>"   # or: npm run sync:holded (needs HOLDED_API_KEY)
```

- The import prints `Target project <host>` before writing. Check it.
- On an empty project it was verified to import 2,156 contracts, 1,282
  companies, 45 distributors and 2,401 equipment lines.
- It is idempotent: a re-run replaces the `LB-*` contracts.
- It refuses to run, naming what is missing, if the reference data of migration
  `20261004000000` is absent.

## 7. Post-deploy verification

### 7.1 Database (run in the SQL editor)

```sql
-- service_role (the app) bypasses RLS; postgres must too, because RLS is FORCED
-- and later data migrations run as postgres.
select rolname, rolbypassrls from pg_roles where rolname in ('postgres', 'service_role');
-- expect: both true

-- RLS on every public table, forced on all but profiles, no grant to the API roles.
select c.relname, c.relrowsecurity, c.relforcerowsecurity,
       has_table_privilege('anon', c.oid, 'select') as anon_select,
       has_table_privilege('authenticated', c.oid, 'select') as auth_select
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' order by 1;
-- expect: relrowsecurity true everywhere, relforcerowsecurity false only for profiles,
--         anon_select / auth_select false everywhere

-- Private bucket, no storage policies, no informa-reports bucket (zero retention).
select id, public from storage.buckets;  -- expect: contract-attachments f (only)
select count(*) from pg_policy where polrelid = 'storage.objects'::regclass;  -- expect: 0
```

If `postgres` lacks BYPASSRLS, stop and raise it before running any data
migration. The app itself is unaffected, because it uses service_role.

### 7.2 The public API is closed (anon key)

```powershell
$u = "https://<project-ref>.supabase.co"; $k = "<publishable key>"
foreach ($t in "companies","contracts","scorings","profiles","contract_attachments","informa_reports","holded_sales_invoices") {
  try { Invoke-RestMethod "$u/rest/v1/$t?select=*&limit=1" -Headers @{ apikey = $k } | Out-Null; "OPEN  $t" }
  catch { "closed $t ($($_.Exception.Response.StatusCode.value__))" }
}
Invoke-RestMethod -Method Post "$u/storage/v1/object/list/contract-attachments" -Headers @{ apikey = $k } -ContentType "application/json" -Body '{"prefix":""}'
```

Expected: every table answers `closed (401)`, which is permission denied. The
bucket listing returns an empty array.

### 7.3 Application

1. **Startup:** /login loads. A 500 everywhere means a missing variable; the
   Vercel runtime logs show `Invalid server environment` with its name.
2. **Invitation end to end:**
   - The owner completes the bootstrap invitation: the email arrives, the link
     starts with this environment's `SITE_URL`, a password can be set, and
     login works.
   - Then invite a test user (role sales) and do the same.
   - On staging, the link must say `staging.tecfys.com`.
3. **Roles:** the test user sees the sales screens only. A partner sees only
   their own scorings and operations.
4. **Scoring:** run "Buscar en Informa por CIF". Settings > Informa > "Probar
   conexion" must pass. Upload an Informa PDF and save the scoring:
   - The scoring page shows its provenance: "PDF de Informa «file» (no
     conservado) · informe del dd/mm/yyyy".
   - Storage still holds only `contract-attachments`.
   - A PDF over 4 MB is refused with a translated message, before any upload.
5. **Contract generation:** create an operation with a small ID document and
   bank certificate. Download the draft `.docx` (the template is bundled with
   the function) and open each attachment.
6. **Loan book and dashboard:** totals match the local reconciliation. The
   Excel / PDF export downloads.
7. **ERP:** /erp shows the imported invoices. "Sincronizar" works when
   `HOLDED_API_KEY` is set.

## 8. Known platform limits

- **Request body: 4.5 MB per Vercel Function request and response.**
  - **Informa PDFs** are capped at **4 MB**, checked both in the browser and in
    the action. The 81 real Informa Comercial reports on hand weigh 185 KB to
    1.1 MB (median 762 KB).
  - **Contract attachments** still accept up to 8 MB each, two per form,
    through a Server Action. On Vercel, anything over ~4.5 MB in one submission
    fails with `413 FUNCTION_PAYLOAD_TOO_LARGE`. Until they upload directly to
    Storage (a future branch), keep them small.
  - Also check that the loan-book PDF export stays under the response limit.
- Informa keeps its session in server memory, per function instance. A cold
  instance simply logs in again.
- Long Holded syncs run inside one request: keep the function's maximum
  duration at the plan's default or above.
