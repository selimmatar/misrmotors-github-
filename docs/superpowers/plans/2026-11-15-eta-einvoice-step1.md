# E-invoice (ETA) Step 1 — Data Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every customer invoice everything the ETA portal needs (customer tax identity, item code + unit per line, portal-exact totals) without calling the portal.

**Architecture:** A separate e-invoice section: pure logic in `lib/eta/` (normalise / match codes, per-line totals, invoice preview), thin API routes under `app/api/eta/`, additive DB changes, and two screens (E-invoice settings; e-invoice preview on a customer invoice). Behaviour changes only after the owner sets the go-live date.

**Tech Stack:** Next.js app router, TypeScript, Supabase (Postgres), node:test with FakeDb + route-harness.

**Spec:** `docs/superpowers/specs/2026-11-15-eta-einvoice-step1-design.md` (approved 2026-11-15, DB changes included)

## Global Constraints

- DB changes are additive only (new nullable columns, new tables); no existing row is written. Migration via Supabase `apply_migration` on project `xpepwirzxsufrrjklzpg`; the SQL is also kept in `scripts/sql/2026-11-15-eta-step1.sql`.
- Nothing changes for any invoice while `company_settings.eta_go_live_at` is empty; invoices created before go-live keep today's amount rule, print and checks (golden prints byte-identical).
- Missing tax data never blocks creating orders, DPs or invoices.
- Customers / suppliers are matched by tax number, never by name.
- Route files export only HTTP handlers and `dynamic`; inside `lib/` use relative imports.
- Every new string in English and Arabic in `lib/i18n-context.tsx`, inserted before `"so.print-plain"`.
- New routes get rules in `lib/auth/permissions.ts`: e-invoice settings / codes / memory / preview read+write for `["accountant"]` (CEO and admin always pass); setting `eta_go_live_at` only CEO / admin (checked in the route via `x-mm-roles`).
- Tests: FakeDb + route-harness, new files registered in `lib/__tests__/run-tests.sh` (file list and suite list). Full suite: `S=<scratchpad>; TEST_OUT=$S/full bash lib/__tests__/run-tests.sh` → every group `fail 0`. `npx tsc --noEmit -p .` stays at the 525-line baseline. Afterwards `git checkout -- tsconfig.tsbuildinfo next-env.d.ts`.
- New component folders added to `lib/__tests__/a11y-scan.ts` OWNED (finance); snapshot guards (`fixtures/ui-1b/protected.json`, `fixtures/ui-1c/t1.json`) edited only for the entry a task changes.

## Review Focus

1. A name that is only a brand or size ("Stanley", "3/8") — core name is empty; matching must fall back to the full name and never match everything.
2. Tax numbers typed with Arabic digits or spaces ("١٠٠ ٢٣٤ ٥٦٧") — stored as 9 Latin digits; anything else is flagged, never silently cut.
3. An invoice with an order discount and a partly returned DP — preview lines use the net billed quantity and the order's discount rate; a fully returned line is left out.
4. Go-live empty (today) — amount, print and over-invoicing checks are exactly as before for every invoice.
5. Two people confirming the same new name at once — the memory keeps one row (unique `normalized_name`, upsert), no error shown.

Each line is pinned by a test in the task that owns the code (Tasks 2, 6, 5, 3, 4).

---

### Task 1: Database changes

**Files:**
- Create: `scripts/sql/2026-11-15-eta-step1.sql`
- Test: `lib/__tests__/eta.test.ts` (new; register in `run-tests.sh` as suite `eta`)

**Interfaces:**
- Produces: columns and tables exactly as spec §7 (names, types, defaults, FKs, `unique` on `eta_item_codes.item_code`, `eta_code_memory.normalized_name`, `eta_documents.invoice_id`); RLS enabled on the three new tables with no policies (service role only), matching `scripts/sql/2026-10-28-rls-lockdown.sql`.

- [ ] **Step 1: Write the failing test** `E1. the step-1 migration only adds` — reads the SQL file and asserts it matches no `/\b(drop|alter\s+column|rename|update|delete|truncate)\b/i`, and contains `add column if not exists` for each of the 10 columns and `create table if not exists` for the 3 tables.
- [ ] **Step 2: Run** the suite → E1 fails (file missing).
- [ ] **Step 3: Write the SQL** (idempotent `if not exists`), then apply it with `apply_migration` (name `eta_step1`).
- [ ] **Step 4: Run** → E1 passes; confirm with a read-only `information_schema.columns` query that the 10 columns and 3 tables exist.
- [ ] **Step 5: Commit** `E-invoice step 1: database (additive)`.

### Task 2: Normalise and match item codes

**Files:**
- Create: `lib/eta/normalize.ts`, `lib/eta/codes.ts`
- Test: `lib/__tests__/eta.test.ts`

**Interfaces:**
- Produces:
  - `normalizeName(s: string): string` — spec §8.1.
  - `coreName(normalized: string, brands: string[]): string` — spec §8.2; returns `""` when nothing is left.
  - `similarity(a: string, b: string): number` — Dice over character bigrams of the strings without spaces, 0..1.
  - `type CodeState = "green" | "orange" | "red"`
  - `interface EtaCode { codeId: number; itemCode: string; name: string; keywords: string[]; defaultUnit: string; active: boolean }`
  - `interface MemoryRow { normalizedName: string; coreName: string; codeId: number; unitType: string }`
  - `matchCode(input: { name: string; productCodeId?: number | null; productUnit?: string | null }, ctx: { codes: EtaCode[]; memory: MemoryRow[]; brands: string[] }): { codeId: number | null; unit: string; state: CodeState; by: "product" | "memory" | "core" | "close" | "keyword" | "none" }`
  - constants `AUTO_SIMILARITY = 0.92`, `SUGGEST_SIMILARITY = 0.80`, `DEFAULT_BRANDS: string[]` (seed: stanley, king tony, kingtony, bosch, makita, total, ingco, dewalt, crown, tolsen, black decker, ستانلي, بوش, ماكيتا, توتال, انجكو, كينج توني), `SIZE_WORDS` (بوصه, انش, مم, سم, متر, م, inch, mm, cm, n.m, نيوتن, درج, قطعه, pcs, pc).

- [ ] **Step 1: Write the failing tests**
  - `E2. normalise`: `normalizeName("ترولى عده  Stanley")` === `normalizeName("ترولي عدة stanley")`; `normalizeName("لقمة ١٧")` === `"لقمه 17"`; tatweel / diacritics removed.
  - `E3. core name`: `coreName(normalizeName("ترولي عدة Stanley 7 درج"), DEFAULT_BRANDS)` === `"ترولي عده"`; `coreName(normalizeName("طقم لقم 3/8"), …)` === `"طقم لقم"`; `coreName(normalizeName("Stanley"), …)` === `""`.
  - `E4. match order` with codes HAND (keywords ["لقمه","مفك","بنسه"]), GARAGE (keywords ["ترولي","باتيناج"]) and memory `{ "ترولي عده" → GARAGE }`:
    - `"ترولى عده Stanley"` → GARAGE, green, by `core`
    - `"تروللي عدة"` → GARAGE, green, by `close` (similarity ≥ 0.92)
    - `"لقمة 19 تصادمية"` → HAND, orange, by `keyword`
    - `"شيء جديد"` → null, red
    - product code wins: `{ name: "x", productCodeId: HAND }` → HAND, green, by `product`
    - `"Stanley"` (empty core) with no full-name memory → red, never matched by core
    - core conflict: memory has `"طقم لقم"` under two codes → `"طقم لقم كبير"` is orange, not green.
- [ ] **Step 2: Run** → fail (modules missing).
- [ ] **Step 3: Implement** both files (pure, no I/O). Lookup order spec §8.3; conflicts spec §8.5; units default to the memory row's unit, else the code's `defaultUnit`, else `"EA"`.
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `E-invoice: item-code matching engine`.

### Task 3: Per-line totals and the go-live switch

**Files:**
- Create: `lib/eta/totals.ts`
- Modify: `lib/invoicing.ts` (amount rule and tolerance after go-live), `app/api/invoices/ar/[id]/pdf/route.ts` (print totals after go-live)
- Test: `lib/__tests__/eta.test.ts`

**Interfaces:**
- Produces:
  - `interface EtaLineIn { name: string; quantity: number; unitPrice: number }`
  - `interface EtaLineOut extends EtaLineIn { salesTotal: number; discount: number; netTotal: number; vat: number; total: number }`
  - `etaLines(lines: EtaLineIn[], discountRate: number): { lines: EtaLineOut[]; totals: { sales: number; discount: number; net: number; vat: number; total: number } }` — spec §6, 2-decimal rounding per line, totals are sums of rounded line values, lines with quantity ≤ 0 dropped.
  - `isAfterGoLive(createdAt: string | null | undefined, goLiveAt: string | null | undefined): boolean` — false when `goLiveAt` empty.
  - `etaTolerance(lineCount: number): number` = `max(0.05, 0.01 × lineCount)`.
  - In `lib/invoicing.ts`: `SoInvoicingState` gains `etaGoLiveAt?: string | null` (loaded from `company_settings` by `loadSoInvoicingState`); `evaluateDpInvoice` / `evaluateAfterInsert` / `computeWholeOrderAmount` use `etaLines(...).totals.total` and `etaTolerance` when `isAfterGoLive(now, etaGoLiveAt)`, today's functions otherwise.

- [ ] **Step 1: Write the failing tests**
  - `E5. etaLines`: Al Kasrawy Agouza lines (24 lines from the paper, discount 0) → totals `{ net: 97456, vat: 13643.84, total: 111099.84 }`; Abu Rawash 5 lines → `{ net: 121640, vat: 17029.6, total: 138669.6 }`; a 10 % discount case where per-line VAT differs from total-level VAT by ≥ 0.01, asserting `totals.vat === Σ round2(lineNet × 0.14)`.
  - `E6. go-live off changes nothing` (Review Focus 4): with `etaGoLiveAt` empty, `evaluateDpInvoice` returns the same `newValue` as before for the existing invoicing fixtures (re-run `invoicing` suite unchanged).
  - `E7. go-live on`: an invoice created after go-live gets `amount === etaLines(...).totals.total`; an order with 30 lines whose sum of line roundings exceeds 0.05 is still invoiceable in full.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** `lib/eta/totals.ts`; wire into `lib/invoicing.ts` (read `eta_go_live_at` once in `loadSoInvoicingState`); the AR print uses `etaLines` totals for invoices with `created_at` after go-live.
- [ ] **Step 4: Run** the full suite → every group `fail 0`, golden prints unchanged.
- [ ] **Step 5: Commit** `E-invoice: per-line totals from go-live`.

### Task 4: Settings, codes and memory APIs

**Files:**
- Create: `lib/eta/store.ts`, `app/api/eta/settings/route.ts`, `app/api/eta/codes/route.ts`, `app/api/eta/memory/route.ts`, `app/api/eta/memory/prepare/route.ts`
- Modify: `lib/auth/permissions.ts`
- Test: `lib/__tests__/eta.test.ts`

**Interfaces:**
- Consumes: Task 2 (`normalizeName`, `coreName`, `matchCode`, `DEFAULT_BRANDS`).
- Produces:
  - `ETA_SETTING_KEYS` (spec §7 list plus `eta_brands` as a JSON array string); `readEtaSettings(db): Promise<Record<string, string>>`; `loadMatchContext(db): Promise<{ codes: EtaCode[]; memory: MemoryRow[]; brands: string[] }>`; `rememberCode(db, { name, codeId, unitType, userId, source }): Promise<void>` — upsert on `normalized_name` and on `core_name` row (core only when non-empty).
  - `GET/PUT /api/eta/settings` — PUT ignores unknown keys; changing `eta_go_live_at` needs `ceo` or `admin` in `x-mm-roles` (403 otherwise); `eta_rin` stored as 9 Latin digits (Arabic digits converted) else 400.
  - `GET/POST/PUT /api/eta/codes` — list / add / edit (`item_code` unique → 409 on duplicate; keywords stored normalised).
  - `GET/POST/DELETE /api/eta/memory` — list (search `q`), confirm (`{ name, codeId, unitType }` → `rememberCode`), remove (`?id`).
  - `GET /api/eta/memory/prepare` — distinct `sales_order_items` names (outsourced name or product name) not yet in memory, each with `matchCode` result; `POST` `{ items: { name, codeId, unitType }[] }` saves them with `source = "imported"`.
  - permission rules: `rule("/api/eta", ["accountant"], ["accountant"])`.

- [ ] **Step 1: Write the failing tests**
  - `E8. settings`: PUT `eta_rin: "١٠٠ ٢٣٤ ٥٦٧"` stores `"100234567"`; `"12345"` → 400; PUT `eta_go_live_at` as accountant → 403, as ceo → 200.
  - `E9. codes`: add two codes; duplicate `item_code` → 409.
  - `E10. memory upsert` (Review Focus 5): confirming `"ترولي عدة"` twice (same and different code) leaves one row per normalised name with the latest code.
  - `E11. prepare`: with SO lines "ترولي عدة", "ترولى عده", "لقمة 17", "دريل" and memory empty, GET returns 3 distinct core items with states; POST saves them as `imported`.
  - permissions: `ruleFor("/api/eta/memory")` allows accountant, denies sales-rep.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `E-invoice: settings, codes and memory`.

### Task 5: Customer, supplier and product fields

**Files:**
- Modify: `app/api/customers/route.ts` (POST/PUT/GET map the 7 fields), `app/api/suppliers/route.ts` (tax number), `app/api/products/route.ts` (`eta_code_id`, `eta_unit_type`), `lib/types.ts` (`Customer`, `Supplier`, `Product` optional fields), `components/parties/edit-party-dialog.tsx` (tax section for `kind === "customer"`: receiver type, tax number, national ID, governorate list of 27, region, street, building number; `kind === "supplier"`: tax number), `components/modules/product-module.tsx` (code + unit pickers fed by `/api/eta/codes`)
- Create: `lib/eta/egypt.ts` — `GOVERNORATES: { ar: string; en: string }[]` (27), `cleanTaxNumber(s): string | null` (Latin 9 digits or null), `cleanNationalId(s): string | null` (14 digits or null)
- Test: `lib/__tests__/eta.test.ts`

**Interfaces:**
- Produces: API field names `receiverType`, `taxRegistrationNumber`, `nationalId`, `governorate`, `region`, `street`, `buildingNumber` (customers); `taxRegistrationNumber` (suppliers); `etaCodeId`, `etaUnitType` (products). Invalid tax number / national ID is saved as typed and flagged (`taxWarnings: string[]` in the response), never refused (spec §9).

- [ ] **Step 1: Write the failing tests**
  - `E12. cleanTaxNumber` (Review Focus 2): `"١٠٠-٢٣٤-٥٦٧"` → `"100234567"`; `"12345"` → null; `cleanNationalId("2 9 0 0 1 0 1 1 2 3 4 5 6 7")` → 14 digits.
  - `E13. customer PUT` saves and returns the 7 fields; a bad tax number is saved with a warning; omitted fields are untouched.
  - `E14. supplier PUT` saves `taxRegistrationNumber`; `E15. product PUT` saves `etaCodeId` / `etaUnitType`.
  - `GOVERNORATES.length === 27`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement** routes, types, dialog section and product pickers; i18n EN/AR.
- [ ] **Step 4: Run** the full suite → pass; update snapshot guards only for changed modules.
- [ ] **Step 5: Commit** `E-invoice: tax fields on customers, suppliers and products`.

### Task 6: Invoice preview

**Files:**
- Create: `lib/eta/preview.ts`, `app/api/eta/preview/route.ts`
- Test: `lib/__tests__/eta.test.ts`

**Interfaces:**
- Consumes: Task 2 `matchCode`, Task 3 `etaLines` / `isAfterGoLive`, Task 4 `loadMatchContext` / `readEtaSettings`, `loadSoInvoicingState` + the net-quantity logic of `evaluateDpInvoice` (extract `billedLinesForInvoice(state, invoice)` into `lib/invoicing.ts` and reuse it — no second copy).
- Produces:
  - `buildEtaPreview(db, invoiceId: number): Promise<EtaPreview | null>`
  - `interface EtaPreview { invoiceId: number; invoiceNumber: string; handledManually: boolean; customer: { name: string; receiverType: string; taxRegistrationNumber: string | null }; lines: (EtaLineOut & { codeId: number | null; itemCode: string | null; unit: string; state: CodeState })[]; totals: ReturnType<typeof etaLines>["totals"]; missing: ("company_rin" | "company_activity" | "company_address" | "customer_tax_number" | "customer_address" | "line_codes")[] }`
  - `GET /api/eta/preview?invoiceId=N`.
  - `POST /api/eta/preview` `{ invoiceId, etaUuid? }` → marks one invoice "already on the portal": upserts `eta_documents` (`status = "manual"`, `eta_uuid` when given); `DELETE ?invoiceId` removes a `manual` mark (only `manual` rows).
  - `handledManually` = invoice `created_at` before go-live, or go-live empty, or an `eta_documents` row with status `manual`.

- [ ] **Step 1: Write the failing tests**
  - `E16. preview lines` (Review Focus 3): order with 10 % discount, DP of 3 lines, 1 unit of line 2 returned before invoicing, line 3 fully returned → 2 lines, line 2 quantity net, discount applied, totals from `etaLines`.
  - `E17. states and missing`: customer without tax number → `missing` contains `customer_tax_number`; a line remembered → green, a keyword line → orange, an unknown → red and `missing` contains `line_codes`.
  - `E18. handled manually`: go-live empty → `handledManually: true`; invoice after go-live → false; after `POST { invoiceId, etaUuid: "ABC" }` → true with the uuid kept; DELETE clears it; DELETE never removes a non-manual row.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `E-invoice: invoice preview`.

### Task 7: Screens

**Files:**
- Create: `components/modules/e-invoice-settings-module.tsx` (company details, environment, go-live — disabled unless CEO/admin; item codes; code memory; "Prepare from past items" review list with confirm-all / edit / skip; brand words), `components/accounting/eta-preview-dialog.tsx` (lines with code state and a confirm / change control that posts to `/api/eta/memory`, totals, missing checklist, "Handled manually" note, and "Already on the portal" with an optional ETA ID field)
- Modify: `components/layout/nav-config.ts` (module `e-invoice-settings`, Finance group, for accountant / ceo / admin), `components/dashboard/dashboard.tsx` (render it), `components/modules/accounts-receivable-module.tsx` (row action "E-invoice" opening the dialog), `lib/i18n-context.tsx`, `lib/__tests__/a11y-scan.ts`, sidebar tests that list role screens
- Test: `lib/__tests__/eta.test.ts` (source assertions), existing sidebar / a11y / snapshot suites

- [ ] **Step 1: Write the failing tests** `E19. screens wired`: nav has `e-invoice-settings` for accountant, ceo, admin and not for sales-rep; AR module renders `<EtaPreviewDialog`; settings module disables the go-live input unless `ceo` / `admin`.
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement**; all text EN/AR; works at phone width and RTL.
- [ ] **Step 4: Run** the full suite and tsc → all `fail 0`, tsc at baseline; update guards for the changed modules only.
- [ ] **Step 5: Commit** `E-invoice: settings screen and invoice preview`.

### Task 8: Finish

- [ ] Full suite + tsc once more on the branch; re-read the whole diff against the spec (§2 goals 1–8, §4 anti-goals).
- [ ] Push the branch; report to the owner in plain words with what to try; merge only on the owner's OK.
