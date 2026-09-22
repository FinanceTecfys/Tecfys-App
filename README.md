# Tecfys App

Plataforma interna de Tecfys: **scoring de clientes → originación de la operación → contrato → loan book → waterfall de cartera**.

Stack: Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS v4 · Supabase (Postgres) · Vitest.

## Puesta en marcha (local)

```bash
npm install
supabase start                 # Postgres + API en :55421 (Studio en :55423)
cp .env.example .env.local     # rellena SUPABASE_SECRET_KEY con `supabase status`
npm run import:loan-book -- "Legacy/Tecfys Borrowing base_15092026_default alignment.xlsx"
npm run dev                    # http://localhost:3000
```

Los puertos de Supabase están en la franja 554xx para no chocar con otros proyectos locales.
El Excel del Borrowing Base contiene datos de clientes: **no se sube al repo** (`Legacy/*.xlsx` está en `.gitignore`).

## Flujo de negocio

1. **Scoring** (`/scoring/new`): se sube el PDF de Informa (o alta manual), se extraen los estados financieros,
   se calculan los ratios ponderados → puntuación /10 → rating AAA–C → decisión y opinión de crédito
   (EBITDA ajustado × prudencia). BB queda en revisión manual; CCC o peor, rechazado.
2. **Operación** (`/contracts/new?scoringId=…`, solo con scoring aprobado): distribuidor, tipo de activo
   (ambos se pueden crear en línea), coste del equipo, duración, residual, cuota, avalista.
   Calcula en vivo la **expected IRR**, el calendario principal/interés y el riesgo vivo frente a la opinión de crédito.
   También calcula la cuota necesaria para una IRR objetivo.
3. **Contrato**: el formulario tiene tres secciones: A · datos identificativos (del scoring, editables; domicilio
   de entrega), B · orden de domiciliación SEPA (IBAN validado, BIC deducido) y C · condiciones económicas con la
   descripción del producto. "Crear contrato borrador" congela esos datos en el contrato y permite **descargar el
   contrato en Word** relleno a partir de `templates/contract-template.docx` (ver `templates/README.md`).
   La firma vía **Signaturit** sigue siendo solo una interfaz (`src/modules/signature`); hasta entonces se marca
   como firmado manualmente y entra en el loan book.
4. **Loan book** (`/contracts`) y **Cartera / Waterfall** (`/portfolio`, réplica de la pestaña Summary).

## Arquitectura

```
src/
  app/(app)/…            rutas (server components); sin lógica de negocio
  components/ui|layout   UI compartida
  lib/                   env, cliente Supabase (solo servidor), formato
  modules/
    scoring/             domain/ (modelo, motor, tipos) · informa/ (parser PDF) · data · actions · components
    contracts/           domain/ (motor financiero del loan book) · data · actions · components
    catalog/             distribuidores, tipos de activo, tipos de contrato
    signature/           interfaz del proveedor de firma (Signaturit)
scripts/                 importador y reconciliación del Borrowing Base
supabase/                migraciones y seed
```

- `domain/` es TypeScript puro, sin dependencias de Next ni de Supabase: se usa igual en servidor, en el
  navegador (cálculo en vivo del formulario) y en los scripts.
- La base de datos guarda **solo los inputs** de cada contrato (las columnas tecleadas del Loan book). La IRR, el split
  principal/interés, el principal pendiente y el default se calculan siempre con el mismo motor.
- RLS activado en todas las tablas sin políticas: solo el servidor (secret key) accede. Las políticas llegan con la autenticación.

## Motor del loan book = Borrowing Base

`src/modules/contracts/domain/schedule.ts` replica la lógica del Excel (columnas HW/HX/HY/HZ/IA y los grids de
Principal, Interest y Principal Outstanding): dos horizontes (pago real V vs amortización N), residual en la IRR solo
si las cuotas no cubren el activo, liquidación del residual, Renting F con un mes de desfase, Gesico sin residual y
write-off del principal no recuperado en la fecha de cancelación.

```bash
npm run reconcile -- "Legacy/Tecfys Borrowing base_15092026_default alignment.xlsx"
```

compara celda a celda con el Excel. Resultado sobre el fichero del 15-sep-2026: **2.156 contratos, 0 diferencias**
en los tres grids (362.208 celdas cada uno) y en las filas 4, 5, 6, 14, 15, 22 y 28 de Summary durante 168 meses.

Detalles que la reconciliación destapó y que el motor respeta:
- El ID del Loan book (col. C) **no es único** y a veces es texto (`18340-1`); en BD es `loan_book_ref` y el
  identificador del contrato es `contract_number`.
- La col. F lleva a veces la fecha real de firma: los meses transcurridos siguen `DATEDIF(...,"m")` (meses completos).
- `RATE` se resuelve como Excel (Newton, 20 iteraciones, paso < 1e-7) con dos reglas de aceptación ajustadas al
  fichero: residuo |f| ≤ 1e-5 y rechazo de la raíz degenerada r = −1.

## Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` / `build` | servidor de desarrollo / build de producción |
| `npm test` | tests unitarios (motor financiero, pricing, scoring) |
| `npm run typecheck` · `npm run lint` | tipos y lint |
| `npm run db:types` | regenera `src/lib/supabase/database.types.ts` desde la BD local |
| `npm run import:loan-book -- <xlsx>` | carga (idempotente) el Loan book en Supabase |
| `npm run reconcile -- <xlsx>` | reconcilia el motor contra el Borrowing Base |
| `npm run template:build` | regenera la plantilla etiquetada del contrato desde `templates/source/` |

## Flujo de git

Ramas `feature/*` → PR contra `develop` → revisión → merge. `main` solo recibe releases desde `develop`.
