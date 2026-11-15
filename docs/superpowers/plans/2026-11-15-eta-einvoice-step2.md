# E-invoice (ETA) Step 2 — The Connection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send customer invoices and whole-invoice credit notes to the ETA portal (signed on the accountant's PC), cancel, print, correct and reissue an invoice after reversal (sales order / delivery permit corrections with automatic stock), and pull supplier e-invoices into the ERP.

**Architecture:** Pure logic in `lib/eta/` (canonical text, document builder, portal client, state machine, receive), thin routes under `app/api/eta/` (logged-in users) plus two device / cron entry points outside `/api/eta` (`/api/eta-signer/*`, `/api/eta-sync`) that check their own secret. A Windows signer (`signer/`, .NET 8) pulls waiting documents and posts CAdES-BES signatures. Linking a reissued invoice (links, payment moves) is one Postgres function so it is all-or-nothing.

**Tech Stack:** Next.js app router, TypeScript, Supabase (Postgres + RPC), node:test with FakeDb + route-harness, `pkijs` + `asn1js` (CMS parsing on the server), .NET 8 (signer), GitHub Actions (Windows build of the signer).

**Spec:** `docs/superpowers/specs/2026-11-15-eta-einvoice-step2-design.md` (approved 2026-11-15, including §7 database, §8 access paths, §6.5a replace). Step 1 spec and code are the base (branch `claude/eta-design`).

## Global Constraints

- Nothing changes for any invoice while `company_settings.eta_go_live_at` is empty and environment is not `test`; invoices before go-live stay "handled manually" (never sent to the real portal).
- Test (preprod) results never change an invoice's real badge, real delete / edit guard, or real status; every `eta_documents` row carries `environment` (`test` | `real`).
- Never send what the ERP did not bill: Send is refused when the step-1 preview has any `missing` item, including `amount_mismatch`.
- Never resubmit after a portal 202; a 422 `DuplicateSubmission` means "already submitted — check status".
- Secrets: `ETA_CLIENT_ID`, `ETA_CLIENT_SECRET`, `ETA_TEST_CLIENT_ID`, `ETA_TEST_CLIENT_SECRET`, `CRON_SECRET` read from env only, never logged, never returned (settings shows only set / not set). Signer key shown once, stored as SHA-256 hash only. The token PIN never reaches the ERP.
- Portal hosts: test identity `https://id.preprod.eta.gov.eg`, API `https://api.preprod.invoicing.eta.gov.eg`; real identity `https://id.eta.gov.eg`, API `https://api.invoicing.eta.gov.eg`. Token `POST /connect/token`, `grant_type=client_credentials`, Basic auth, cached until `expires_in` − 60 s.
- Portal rate limits respected: details 2/s, printout 1 per 5 s, search 1 per 2 s; on 429 obey `Retry-After`.
- Batches of at most 20 documents per submission; status checks for one submission at most every 30 s.
- Document: `documentType` `"i"` / `"c"`, `documentTypeVersion` `"1.0"`, taxes `T1` / `V009` / rate `14`, `internalId` = ERP invoice number, `dateTimeIssued` = invoice `created_at` in UTC (`YYYY-MM-DDTHH:mm:ssZ`), amounts with at most 5 decimals.
- DB changes only as spec §7 plus Ruling R1 below; migration SQL kept in `scripts/sql/2026-11-15-eta-step2.sql`, applied by the controller with `apply_migration` (name `eta_step2`) after Task 1's review.
- Route files export only HTTP handlers and `dynamic`; inside `lib/` use relative imports.
- Every new string EN + AR in `lib/i18n-context.tsx`, inserted before `"so.print-plain"`; screens work at phone width and RTL.
- Permissions: `/api/eta/*` rule stays accountant (CEO / admin always pass); environment and signer pairing CEO / admin only (checked in the route from `x-mm-roles`). `PUBLIC_PATHS` gains exactly `/api/eta-signer/next`, `/api/eta-signer/signed`, `/api/eta-signer/ping`, `/api/eta-sync`.
- Tests: new file `lib/__tests__/eta2.test.ts` (suite `eta2`, tests numbered F1, F2 …), registered in `lib/__tests__/run-tests.sh`. Full suite: `S=<scratchpad>; TEST_OUT=$S/full bash lib/__tests__/run-tests.sh` → every group `fail 0`. `npx tsc --noEmit -p .` stays at the 525-line baseline. Afterwards `git checkout -- tsconfig.tsbuildinfo next-env.d.ts`. Snapshot guards (`fixtures/ui-1b/protected.json`, `fixtures/ui-1c/t1.json`, `t2.json`) edited only for entries a task changes; new component files added to `a11y-scan.ts` OWNED.
- No live portal calls in tests (inject `fetch`). No writes to the production database except the controller's migration.

**Owner revision (2026-11-15):** an invoice is never edited alone. "Correct and reissue" reopens the sales order and delivery permits of a reversed invoice; the new invoice is made the normal way from them (spec §6.5a). No per-invoice custom lines.

## Review Focus

1. The invoice (lines, customer, amount) changes after Send but before signing — it must go back to "needs review", never be signed or submitted with stale content.
2. Submit returns 202 and the follow-up call fails / times out, or a retry hits 422 `DuplicateSubmission` — the document stays "submitted", is never sent twice, and the next follow-up resolves it.
3. Reissue of an invoice that has part payments (same customer) — on creating the new invoice, payments, schedules and collected amount move to it; the old one stops counting everywhere; the customer's balance is unchanged. Different customer with payments → creating the new invoice is refused with no change. A return during the open correction creates no customer credit.
4. A test-environment send of a real invoice — its real badge stays "Not sent", delete / edit stay allowed, and a later real send works.
5. A received supplier document seen again with a new status (supplier cancelled it) — the row is updated, not duplicated; an issuer tax number on no supplier card is flagged "unknown supplier".

Each line is pinned by a test in the owning task (Tasks 4, 5, 7, 4, 8).

---

### Task 1: Database changes

**Files:**
- Create: `scripts/sql/2026-11-15-eta-step2.sql`
- Test: `lib/__tests__/eta2.test.ts` (new, suite `eta2`)

**Interfaces:**
- Produces (exact names):
  - `eta_documents` add: `environment text not null default 'real' check in ('test','real')`, `version int not null default 1`, `canonical text`, `document jsonb`, `signature text`, `references text[]`, `submitted_at`, `checked_at`, `validated_at timestamptz`, `needs_review boolean default false`; status check widened to add `needs_review`. Drop the step-1 unique on `invoice_id`; add unique (`invoice_id`, `document_type`, `environment`, `version`). FK on `invoice_id` changed from `on delete cascade` to `on delete restrict`.
  - `eta_signers` (`signer_id serial pk`, `key_hash text unique not null`, `name text`, `created_by int references users`, `created_at`, `last_seen_at`, `unlocked boolean default false`, `revoked_at timestamptz`).
  - `eta_received_documents` (`received_id serial pk`, `uuid text not null`, `environment`, `document_type`, `issuer_id`, `issuer_name`, `supplier_id int references suppliers on delete set null`, `internal_id`, `date_issued timestamptz`, `net`, `vat`, `total numeric`, `status text`, `lines jsonb`, `raw jsonb`, `first_seen_at`, `updated_at`; unique (`uuid`, `environment`)).
  - `accounts_receivable` add `replaces_invoice_id`, `replaced_by_invoice_id int references accounts_receivable on delete restrict`; status check recreated with the four current values plus `replaced`.
  - `dp_corrections` (`correction_id serial pk`, `permit_id int references delivery_permits`, `invoice_id int references accounts_receivable`, `lines jsonb` (product, before, after), `stock_moves jsonb`, `created_by int references users`, `created_at`).
  - Function `eta_link_reissue(p_old int, p_new int, p_user int) returns void` (security definer, one transaction) — body in Task 7, created here as the final SQL statement of this file.
  - RLS on for the three new tables, no policies.
- The test may allow `drop constraint` only for the two named constraints (step-1 `eta_documents_invoice_id_key` and the AR status check, plus the `invoice_id` FK it recreates); every other statement additive.

- [ ] **Step 1: Write the failing test** `F1. step-2 migration`: the file exists; no statement starts with `drop table|truncate|delete|update|alter table … drop column|rename`; every `drop constraint` names one of the allowed constraints and is followed by its re-`add`; it contains each table / column / function name above.
- [ ] **Step 2: Run** → F1 fails.
- [ ] **Step 3: Write the SQL** (idempotent where Postgres allows; the function via `create or replace`).
- [ ] **Step 4: Run** → F1 passes. (The controller applies it and verifies with a read-only `information_schema` query.)
- [ ] **Step 5: Commit** `E-invoice step 2: database`.

### Task 2: Canonical text and document builder

**Files:**
- Create: `lib/eta/serialize.ts`, `lib/eta/document.ts`
- Test: `lib/__tests__/eta2.test.ts`

**Interfaces:**
- Consumes: `EtaPreview` (`lib/eta/preview.ts`), `readEtaSettings` (`lib/eta/store.ts`).
- Produces:
  - `canonicalize(doc: unknown): string` — the SDK serialization: walk from the document root; for an object, for each property in order: `"NAME"` (invariant upper-case) then its value; simple value → `"value"` with the value's JSON text unchanged (numbers exactly as written in the JSON sent); array → `"NAME"` then, for each element, `"NAME"` followed by the element's serialization. Signatures are excluded.
  - `toEtaJson(doc: EtaDocument): string` — the exact body text sent; numbers formatted by one function `etaNumber(n)` (up to 5 decimals, no exponent, trailing zeros trimmed). `canonicalize` is applied to `JSON.parse(toEtaJson(doc))` so signed text and sent text cannot differ.
  - `buildInvoiceDocument(preview: EtaPreview, settings: EtaSettings, issuedAt: string): EtaDocument`
  - `buildCreditNoteDocument(invoiceSnapshot: EtaDocument, invoiceUuid: string, issuedAt: string): EtaDocument` — same lines / totals, `documentType "c"`, `references: [invoiceUuid]`.
  - `EtaDocument` type with the spec §6.2 fields.

- [ ] **Step 1: Failing tests**
  - `F2. canonical text matches the SDK rules` — a small fixture `{ issuer: { address: { branchID: "0" } }, invoiceLines: [{ quantity: 1.0, taxableItems: [{ taxType: "T1" }] }] }` serializes to `"ISSUER""ADDRESS""BRANCHID""0""INVOICELINES""INVOICELINES""QUANTITY""1.0"…` (keep the literal `1.0` by building the fixture from JSON text).
  - `F3. invoice document from a preview` — a preview shaped like sample invoice 10363 (two lines EG-100060455-P13 qty 1 unit 30948 and EG-100060455-P52 qty 1 unit 14200, VAT 14%) gives lines with `itemType "EGS"`, `unitType "EA"`, taxable item `{ taxType: "T1", subType: "V009", rate: 14, amount: 4332.72 }`, totals `totalSalesAmount 45148`, `netAmount 45148`, tax total 6320.72, `totalAmount 51468.72`, `internalID` = invoice number, `receiver.type "B"`.
  - `F4. credit note mirrors the invoice` — `documentType "c"`, `references` = [uuid], identical lines and totals, `internalID` unchanged.
  - `F5. signed text equals sent text` — `canonicalize(JSON.parse(toEtaJson(d)))` is stable for amounts like 0.1 + 0.2 and 1234.5 (no float noise, no exponent).
- [ ] **Step 2: Run** → fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → pass.
- [ ] **Step 5: Commit** `E-invoice: canonical text and document builder`.

### Task 3: Portal client and plain-word errors

**Files:**
- Create: `lib/eta/portal.ts`, `lib/eta/portal-errors.ts`, `lib/eta/preprod-root-ca.pem` (the SDK's preprod root CA, downloaded from `https://sdk.invoicing.eta.gov.eg/files/preprod-root-ca.crt`)
- Test: `lib/__tests__/eta2.test.ts`

**Interfaces:**
- Produces:
  - `type EtaEnv = "test" | "real"`; `portalConfig(env: EtaEnv): { idUrl; apiUrl; clientId?; clientSecret? }` (from env vars; `credentialsSet(env): boolean`).
  - `createPortal(env: EtaEnv, deps?: { fetch?: typeof fetch; now?: () => number }): EtaPortal` with methods `submit(docsJson: string[])`, `getSubmission(uuid)`, `getDetails(uuid)`, `cancel(uuid, reason)`, `searchReceived({ from, to, continuationToken? })`, `printout(uuid): Promise<ArrayBuffer>`, `documentType(id)`. Token cached per env; 429 → waits `Retry-After` (max 2 retries) then throws `EtaBusyError`. Test env uses an https agent trusting the preprod CA for those hosts only.
  - `plainError(code: string, message?: string, lang: "en" | "ar"): string` for `BadStructure`, `MaximumSizeExceeded`, `DuplicateSubmission`, `IncorrectSubmitter`, `Forbidden`, `OperationPeriodOver`, `IncorrectState`, `ActiveReferencingDocuments`, `NotReady`, `TooManyRequests`, `invalid_client`, plus a generic fallback that includes the portal message.
- [ ] **Step 1: Failing tests** with a fake `fetch`: `F6` token requested once for two calls and again after expiry; Basic header = base64(`id:secret`); `F7` submit posts `{"documents":[…]}` raw text to `/api/v1.0/documentsubmissions/` and returns accepted / rejected arrays; `F8` 429 with `Retry-After: 1` retried then succeeds; `F9` missing credentials → `credentialsSet` false and calls throw a readable error without the secret in it; `F10` `plainError("OperationPeriodOver", …, "ar")` returns Arabic text.
- [ ] **Step 2–4: Run → fail; implement; run → pass.**
- [ ] **Step 5: Commit** `E-invoice: portal client`.

### Task 4: Send queue, signer access and submit

**Files:**
- Create: `lib/eta/send.ts`, `lib/eta/signer-auth.ts`, `lib/eta/cms.ts`, `app/api/eta/send/route.ts`, `app/api/eta/signer/route.ts` (pair / revoke / status, CEO-admin for POST/DELETE), `app/api/eta-signer/next/route.ts`, `app/api/eta-signer/signed/route.ts`, `app/api/eta-signer/ping/route.ts`
- Modify: `lib/auth/permissions.ts` (`PUBLIC_PATHS`), `app/api/eta/settings/route.ts` (`eta_environment` only CEO / admin, values `test` | `real`), `app/api/accounts-receivable/route.ts` (DELETE / PUT guard), `lib/invoicing.ts` only if an edit path exists there, `package.json` (`pkijs`, `asn1js`)
- Test: `lib/__tests__/eta2.test.ts`, `lib/__tests__/auth-*.test.ts` that list public paths

**Interfaces:**
- Consumes: Task 2 builders, Task 3 portal.
- Produces:
  - `queueSend(db, invoiceIds: number[], env: EtaEnv, userId: number | null): Promise<{ queued: number[]; refused: { invoiceId: number; reasons: string[] }[] }>` — refuses missing / mismatch / handled-manually (real) / already live; creates the row (`pending_signature`, `document`, `canonical`, next `version`).
  - `nextForSigner(db, signerId, limit = 20)` — rebuilds each document; if `canonical` differs, sets `needs_review` and skips it; returns `{ docId, canonical }[]`.
  - `acceptSignatures(db, items: { docId; signature }[], deps)` — `cms.ts` `checkSignature(signatureB64, canonical, rin): { ok: true } | { ok: false; reason }` (SignedData parses, detached content hash = SHA-256 of `canonical`, signer certificate subject / serial holds the environment's RIN); then one portal submission for the batch; stores `eta_uuid`, `eta_long_id`, `submission_uuid`, `status submitted`, `submitted_at`; rejected documents → `invalid` with `errors`.
  - `followUp(db, deps, { now })` — for `submitted` rows whose `checked_at` is older than 30 s: `getSubmission`; sets `valid` / `invalid` (errors from `getDetails` validation results) / keeps `submitted`.
  - `signerFromRequest(db, request): Promise<{ signerId } | null>` (header `x-eta-signer-key`, SHA-256 compare, not revoked; updates `last_seen_at`).
  - `liveRealDocument(db, invoiceId): Promise<boolean>` — a real row in `pending_signature | submitted | valid` or a credit note; AR DELETE / PUT refuse with `{ code: "ETA_LIVE" }` and the spec text.
  - Signer protocol: `GET /api/eta-signer/next` → `{ environment, rin, documents: [{ docId, canonical }] }`; `POST /api/eta-signer/signed` `{ items: [{ docId, signature }] }`; `POST /api/eta-signer/ping` `{ unlocked: boolean, version }`. Each calls `followUp` after its work.
- [ ] **Step 1: Failing tests**
  - `F11` queueSend refuses an invoice with `missing` items and one that is handled manually (real), queues a ready one; a second Send of the same invoice is refused as already live.
  - `F12` signer routes: no key / wrong key / revoked key → 401; right key → documents; `PUBLIC_PATHS` contains exactly the four new paths and `/api/eta/signer` still needs a login (existing decide tests updated).
  - `F13` (Review Focus 1) invoice amount changed after Send → `next` returns nothing for it and the row is `needs_review`.
  - `F14` signature over different text → refused, row stays `pending_signature`, no portal call; good signature (test certificate generated in the test with `node:crypto` + pkijs) → one submit call, row `submitted` with uuid / longId.
  - `F15` (Review Focus 2) follow-up throws after 202 → row stays `submitted`, no second submit; next `followUp` with portal `valid` → `valid`; a 422 `DuplicateSubmission` on submit → row marked "already submitted — check status", never resubmitted.
  - `F16` (Review Focus 4) a `test` row never blocks AR DELETE; a `real` `valid` row does (`ETA_LIVE`).
- [ ] **Step 2–4: Run → fail; implement; run → pass.**
- [ ] **Step 5: Commit** `E-invoice: send queue, signer access, submit and follow-up`.

### Task 5: Credit note, cancel, send again, portal PDF

**Files:**
- Create: `app/api/eta/credit-note/route.ts`, `app/api/eta/cancel/route.ts`, `app/api/eta/printout/route.ts`
- Modify: `lib/eta/send.ts` (`queueCreditNote`, `sendAgain`), `app/api/eta/preview/route.ts` (GET adds `documents` per environment and the cancel window)
- Test: `lib/__tests__/eta2.test.ts`

**Interfaces:**
- Produces: `queueCreditNote(db, invoiceId, env, userId)` (only on a `valid` invoice document without an active credit note; builds from the stored `document` snapshot); `sendAgain(db, invoiceId, env, userId)` (only after `invalid`; new `version`); `cancelOnPortal(db, docId, reason, deps)` (`valid` only; refuses when an active credit note exists; maps `OperationPeriodOver` to plain words; sets `cancelled`); `cancelWindowHours(env, deps)` cached per env from `documentType`; printout streams the PDF (`application/pdf`) for our `valid` / `cancelled` documents and for received documents (by `received_id`). The preview GET runs the throttled `followUp` before answering, so opening an invoice refreshes its status.
- [ ] **Step 1: Failing tests** `F17` credit note only after valid, references the uuid, uses the snapshot even if the invoice changed later; second credit note refused; `F18` cancel refused with an active credit note; `OperationPeriodOver` → plain message, status unchanged; `F19` send again after invalid creates version 2, refused while version 1 is still live.
- [ ] **Step 2–4: Run → fail; implement; run → pass.**
- [ ] **Step 5: Commit** `E-invoice: credit note, cancel, send again, printout`.

### Task 6: Replaced invoices stop counting everywhere

**Files:**
- Create: `lib/ar-live.ts` (`LIVE_AR_STATUSES`, `excludeReplaced(query)`)
- Modify: every reader of `accounts_receivable` that sums, lists for collection, checks over-invoicing or reports (the files listed by `grep -rln 'from("accounts_receivable")' app lib` excluding tests and `lib/eta`): add `excludeReplaced` or an explicit `status` filter; `lib/ar-status.ts` keeps `replaced` untouched (a replaced invoice's status is never recomputed).
- Test: `lib/__tests__/eta2.test.ts`

**Interfaces:**
- Produces: `excludeReplaced<T>(q: T): T` (`.neq("status", "replaced")`), used by Task 7.
- [ ] **Step 1: Failing tests** `F20` guard: every non-test, non-ETA file that queries `accounts_receivable` either calls `excludeReplaced` / filters `status`, or is listed in an explicit `REPLACED_VISIBLE` allowlist inside the test with a one-line reason (the AR list screen and the invoice PDF show replaced invoices on purpose); `F21` over-invoicing (`loadSoInvoicingState`) ignores a replaced invoice; customer balance (route used by the customers screen) excludes it.
- [ ] **Step 2–4: Run → fail; implement; run → pass** (full suite: no behaviour change while no invoice is `replaced`).
- [ ] **Step 5: Commit** `AR: replaced invoices stop counting`.

### Task 7: Correct and reissue

**Files:**
- Modify: `scripts/sql/2026-11-15-eta-step2.sql` (function body), `lib/invoicing.ts` (`createDpInvoices` / `createSoInvoice`: detect a reissue and call the link step), `app/api/sales-orders/route.ts` PUT (allowed while the order has an open correction even where today's rules would lock it; nothing loosened otherwise), the return-credit step used by `lib/returns.ts` (no customer credit while the permit's invoice is an open correction)
- Create: `lib/eta/reissue.ts`, `app/api/eta/reissue/route.ts` (POST start), `app/api/delivery-permits/correct/route.ts`
- Test: `lib/__tests__/eta2.test.ts`

**Interfaces:**
- Consumes: Task 6 `excludeReplaced`; `lib/dp-stock.ts` (`takeFromRow`, `undoMoves`, `StockMove`).
- Produces:
  - `startReissue(db, invoiceId, userId): { ok: true } | { ok: false; code; message }` — only when the invoice's real document is `cancelled` or has a `valid` credit note and the invoice is not already `replaced`; sets `status 'replaced'`.
  - `openCorrection(db, { soId? ; permitId? }): Promise<{ oldInvoiceId: number } | null>` — a `replaced` invoice with `replaced_by_invoice_id is null` linked to that order / permit.
  - `correctPermit(db, permitId, lines: { permitItemId; quantity }[], userId)` — only with an open correction; new quantity ≥ already-returned quantity; stock difference applied with the dp-stock helpers (shortage → refused, nothing changed; failure → undone); writes `dp_corrections`.
  - `eta_link_reissue(p_old, p_new, p_user)` — in one transaction: sets both links, moves `customer_payments.invoice_id`, `payment_schedules.invoice_id`, `customer_credits.used_in_invoice_id` and `collected_amount` to the new invoice, recomputes its status; refuses (raises) when customers differ and the old invoice has payments.
  - Invoice creation: when the permits / order belong to an open correction, after insert it calls `eta_link_reissue`; a refusal deletes the just-created invoice and returns `PAYMENTS_OTHER_CUSTOMER` with the spec text; an overpayment needs `confirmOverpaid: true`.
- [ ] **Step 1: Failing tests** `F22` start refused while the real document is valid without credit note; `F23` (Review Focus 3) same customer with a part payment: start → old `replaced`, its permits not invoiced; create the new invoice from them → payments moved, new status `partially_paid`, links both ways, customer balance unchanged; `F24` different customer with payments → creation refused, nothing changed; `F25` correct permit: 5 → 3 returns 2 to stock, 3 → 4 takes 1 (shortage refused with no change), below returned quantity refused, outside an open correction refused (approved permits stay locked); `F26` a return during an open correction creates no customer credit; after the new invoice exists, returns behave as today; `F27` sales-order edit allowed with an open correction and refused as today without one.
- [ ] **Step 2: Run** → fail. **Step 3:** implement (FakeDb gets an `rpc("eta_link_reissue")` stand-in mirroring the SQL; `F23` exercises it). **Step 4:** run → pass.
- [ ] **Step 5: Commit** `E-invoice: correct and reissue`. The controller re-applies the function with `apply_migration` `eta_step2_reissue`.

### Task 8: Receive supplier e-invoices

**Files:**
- Create: `lib/eta/receive.ts`, `app/api/eta/received/route.ts` (GET list, POST check now), `app/api/eta-sync/route.ts` (cron: `Authorization: Bearer ${CRON_SECRET}`; runs receive + `followUp`)
- Modify: `vercel.json` (`"crons": [{ "path": "/api/eta-sync", "schedule": "17 3 * * *" }]`)
- Test: `lib/__tests__/eta2.test.ts`

**Interfaces:**
- Produces: `receiveSupplierDocuments(db, env, deps, { since? }): Promise<{ added; updated; unknownSuppliers }>` — search `direction=Received` in 30-day windows from `since` (default: last received date, first run 90 days back), pages by `continuationToken`, details for new uuids only (≤ 2/s), upserts on (`uuid`, `environment`), matches `supplier_id` by `suppliers.tax_registration_number = issuerId`.
- [ ] **Step 1: Failing tests** `F28` two pages with continuation token → all stored once; `F29` (Review Focus 5) same uuid with status `cancelled` → updated, not duplicated; issuer not on any card → `supplier_id null` and counted in `unknownSuppliers`; `F30` `/api/eta-sync` without / wrong bearer → 401, right bearer → runs.
- [ ] **Step 2–4: Run → fail; implement; run → pass.**
- [ ] **Step 5: Commit** `E-invoice: receive supplier e-invoices`.

### Task 9: Screens

**Files:**
- Modify: `components/accounting/eta-preview-dialog.tsx` (Send / Send again / Credit note / Cancel / Portal PDF / Correct and reissue by state, test label, "Portal has not answered — check again" after 24 h submitted, "older than 7 days" warning before Send, plain portal errors on invalid), `components/modules/accounts-receivable-module.tsx` (badge per row, "Send all ready", Replaced / Replaces links, "payments waiting for the new invoice"), `components/modules/e-invoice-settings-module.tsx` (environment CEO/admin, credentials set / not set, signer connect / last seen / unlocked / disconnect with the key shown once, Waiting to be signed, Sent today), `components/modules/accounts-payable-module.tsx` (tab "Supplier e-invoices"), `lib/i18n-context.tsx`, `lib/__tests__/a11y-scan.ts`
- Create: `components/accounting/eta-reissue-dialog.tsx` (explains the steps, starts the correction, links to the order / permits), `components/accounting/supplier-einvoices.tsx`, `components/delivery/correct-permit-dialog.tsx` (shown on a permit only with an open correction; delivery-permits module modified to render it)
- Test: `lib/__tests__/eta2.test.ts` (source assertions), existing snapshot / a11y suites

- [ ] **Step 1: Failing test** `F31. screens wired`: dialog renders actions by state from the preview's `documents`; AR renders the badge and `<EtaReissueDialog`; the delivery-permits module renders `<CorrectPermitDialog` only when the permit has an open correction; AP renders `<SupplierEInvoices`; the signer key text appears only in the response handler of the pair call; every new key has EN and AR.
- [ ] **Step 2–4: Run → fail; implement; run full suite → pass, tsc at baseline.**
- [ ] **Step 5: Commit** `E-invoice: send, credit note, replace and supplier e-invoice screens`.

### Task 10: The Windows signer

**Files:**
- Create: `signer/MisrMotorsSigner.csproj` (.NET 8, `net8.0-windows`, WinForms tray, single-file publish), `signer/Program.cs`, `signer/SignerLoop.cs`, `signer/CadesSigner.cs`, `signer/Config.cs`, `signer/README.md` (install, pairing, PIN, troubleshooting in plain words, EN + AR), `signer/tests/…` (xUnit), `.github/workflows/signer.yml` (windows-latest: test + `dotnet publish -r win-x64 --self-contained -p:PublishSingleFile=true`, upload artifact)

**Interfaces:**
- Consumes: the Task 4 signer protocol.
- Produces: `CadesSigner.Sign(string canonical, X509Certificate2 cert): string` — `SignedCms` detached over UTF-8 bytes, SHA-256, signed attributes signing time, content type and ESS signing-certificate-v2 (hash of the certificate); returns Base64. Certificate chosen from `CurrentUser\My` with a private key whose subject / organisation identifier contains the configured RIN; others refused. PIN entered once at start through the token driver's prompt (`CspParameters` / CNG key opened once and kept for the session); never written anywhere. Poll every 10 s; ping every 60 s with `unlocked`.
- [ ] **Step 1: Failing xUnit tests**: signature verifies with `SignedCms.CheckSignature` over the same text and fails over changed text; signed attributes include signing-certificate-v2; certificate filter refuses a certificate without the RIN.
- [ ] **Step 2–4:** run in CI (`signer.yml`) → fail; implement; run → pass. If a .NET SDK can be installed in the build environment, run the tests locally too; otherwise CI is the evidence.
- [ ] **Step 5: Commit** `E-invoice: Windows signer`.

### Task 11: Finish

- [ ] Full suite + tsc once more; re-read the whole diff against the spec (§2 goals, §4 anti-goals).
- [ ] Push the branch; report to the owner in plain words: what to try on the test portal once the test credentials are in Vercel, how to install the signer; merge only on the owner's OK.
