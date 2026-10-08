# Misr Motors ERP — Handoff (written 2026-10-08)

Purpose: let a new Claude session continue this work without redoing or contradicting it.
Repo: `selimmatar/misrmotors-github-`. Working branch: `claude/code-review-github-push-vjfisg`.
Supabase project: `xpepwirzxsufrrjklzpg` (MisrMotors). No secrets are recorded here.

State at time of writing: `main` and the working branch were both at `daaab40` (the branch also holds this file after the
handoff commit). Production deployment of `daaab40`: GitHub deployment id **6948683844**, status `success`.
The previous deployment was id 6947596940 (commit `cc39aa3`), also `success`. The live app has NOT been opened or clicked
through by Claude.

Note: `CLAUDE.md`, `MISR_MOTORS_AUDIT_REPORT.md` and `.claude/` are local-only, untracked files listed in
`.git/info/exclude`. A fresh checkout will not have them. `CLAUDE.md` holds the project rules summarised in section 1.

---------------------------------------------------------------------
## 1. The user's goals, rules and preferences

Goal: make the ERP's workflows correct (Sales Order -> Delivery Permit -> Invoice/AR; SO -> PO -> AP -> GRN -> Inventory;
returns; printing; quotations), fixing the known bugs from the audit in approved batches, with review and tests.

Latest and most important instruction from the user:
> "Keep in mind all data is dummy so just make sure work flows are correct"

Because of that, row-level data cleanup is low priority; workflow correctness is the priority. (CLAUDE.md still says not
to assume rows are test data. The user has now said they are dummy. Do not rewrite CLAUDE.md Part 3 without asking.)

Standing rules the user gave (quoted or close to it):
- Governing flow: INVESTIGATE -> REPORT -> DECISIONS -> APPROVAL -> IMPLEMENT -> INDEPENDENT REVIEW -> TESTS ->
  REGRESSION -> PREVIEW -> APPROVAL -> COMMIT/PUSH -> APPROVAL -> PRODUCTION DEPLOY -> VERIFY -> CLOSE.
  Report format: STATUS / SCOPE / CHANGES / NOT CHANGED / TESTS / REVIEWER / DATABASE / GIT / PREVIEW / PRODUCTION /
  RISKS / NEXT ACTION.
- Work one batch at a time (CLAUDE.md Part 5.0). Do not use a later batch to silently fix an earlier one.
- Develop only on `claude/code-review-github-push-vjfisg`. Never commit/push/merge/deploy unless the user asks.
  Merging to `main` (which auto-deploys to production on Vercel) needs a fresh explicit ask each time.
  The user's recent asks were: "merge 4d to 4g to main and deploy" (done) and "Ok finish and tell me" (done: merged and
  deployed `daaab40`).
- Do not change authentication, RLS, roles, database structure, or historical financial data without the user's
  explicit approval of the exact change. The user said to **leave the RLS and login issue for now**.
- Do not turn Part 3 open business decisions into assumptions; ask.
- Never print or commit secrets. Do not widen DELETE, upload or print routes.
- "You are the QA engineer, take all decisions and delegate agents to each group": the user delegated code-level
  decisions. Claude used that for code-only choices and kept auth/RLS/schema and business-rule decisions for the user,
  until the user later said "Implement the recommendations after reviewing them and making sure they are the best
  decision at the time, but leave the RLS issue and login for now".
- Preferences seen: delegate to worktree-isolated subagents per group; use independent review; implement related
  sub-batches together ("you can implement abc together, no need to consume tokens and make each one on its own");
  remove the unit-cost column from the UI where it makes no sense; remove the Mark-as-paid button (done).
- The `misr-gate` mod was disabled at the user's instruction. Do not re-enable it.
- Commit trailers used in this session: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` and
  `Claude-Session: <session url>` at the end of every commit message. Do NOT put any model identifier elsewhere in repo
  artifacts.
- A stop hook (`~/.claude/stop-hook-git-check.sh`) repeatedly asks to push unpushed commits. It is a reminder, not an
  approval to merge to `main`. Pushing the working branch after a passing suite has been accepted by the user ("If passed push").

---------------------------------------------------------------------
## 2. Decisions approved or rejected, with reasoning

Stock (user, verbatim): "after SO approval it should be on hold and after DP approval it should be deducted".
- Implemented as a derived hold (no schema change): held(product) = ordered stock-line qty on SOs in
  `accountant_approved` / `ready_for_delivery` / `shipped`, minus qty delivered by APPROVED permits. Returns are NOT netted.
  `inventory.pending_outbound` is unused. Availability at SO creation = on-hand (non-returned) - held.
  Stock is deducted at DP APPROVE (409 `INSUFFICIENT_STOCK` if short). Permits approved before that change
  (DP-2026-0003/4/5/6) were never deducted and are not retroactively deducted.
- Rest of the open 4D-4G questions: user said "for the rest go with your recommendations" and later "Finish all".

Other approved decisions (the user accepted Claude's recommendations unless noted):
- Remove the Mark-as-paid button (user chose option "3"); `lib/ap-mark-paid.ts` was then deleted.
- Supplier-credit amount = receipt unit cost x VAT ratio (ratio = `po.total / sum(po item totals)` when total exceeds the
  item sum, else 1.0), capped at received quantity. This assumes VAT is the document's rate; VAT itself is still an open
  decision (14% hard-coded in 15+ places).
- Weighted-average cost on goods receipt (example: 10@100 + 10@140 -> 20 @ 120).
- Revenue KPI also counts `ready_for_delivery` orders (statuses: accountant_approved, ready_for_delivery, shipped,
  delivered). Approved by the user's "implement the recommendations".
- Invoices are strictly per delivery permit and only from APPROVED permits (`create-from-dps` returns 409
  `DP_NOT_APPROVED`); `create-from-so` is retired (410). Approved by the same instruction.
- Overdue vs partially paid in the AR status helper: overdue wins (`lib/ar-status.ts` order: paid, overdue,
  partially_paid, pending). Chosen because the AR screen already does this.
- SO reject: mapped to `cancelled` (normal order) or `rejected_quotation` (quotation-type), because the CHECK constraint
  rejects `rejected`. Every order in the DB is a normal order.
- GRN to PO status: complete -> `received`; partial -> `partially_received`; discrepancy on a completing receipt ->
  `received_with_issues`. Status follows the receipt that completes the PO.
- Upload allowlist: pdf, jpg/jpeg, png, gif, webp, heic/heif, doc, docx, 10 MB, MIME must match the extension
  (`image/jpg` tolerated). Applied to `/api/upload` and seven other upload routes.

Deliberately NOT decided / deferred (needs the user):
- Real authentication, role vocabulary, RLS, `handle_new_user()` (inserts into non-existent column `public.users.id`).
- VAT: always 14% or per document? Claude's recommendation was to keep 14% for now.
- Returns: credit notes / AR reduction. Recommendation: reduce AR through an explicit credit note, as its own batch.
- Whether prepaid/cash POs are "paid" at approval. Recommendation: no, mark paid only when a payment row exists.
  (Today: AP auto-paid at PO approval with `paid_amount` 0; 10 such rows were aligned in the DB, see section 4.)
- KPI definitions beyond the revenue statuses; retired quotation model; meaning of `subtotal` when a discount exists.
- PO over-order race (two simultaneous creates can both pass): needs a DB constraint, not approved.
- `supplier_credits_apply.sql` (adds po_id, receipt_id, applied_amount, CHECKs, unique index): deferred because nothing
  reads the new columns until a credit-apply step is built. Draft is in the session scratchpad only.
- Stock correction for permits approved before the deduction change: held. Product 4 already shows a 40-unit gap that
  equals DP 3's quantity, so a blind deduction would double-count.
- Two dead blocks left in `app/api/sales-orders/route.ts` (see section 6).

---------------------------------------------------------------------
## 3. What is done

All batches below are merged to `main` and deployed unless stated. Production runs `daaab40`.

- Batches 1A, 1B, 1C (money and invoices), 2 (returns), 3 (printing/documents), 4A-4C (purchasing/AP), 5 (DP/customers),
  6 (quotation edit/save/approve): done, tested, reviewed, deployed in earlier segments.
- 4D: PO over-order guard (`lib/po-over-order.ts`; 409 `PO_OVER_ORDER`, 400 `PO_UNKNOWN_SO_ITEM`).
- 4E costing and stock: weighted-average cost in `lib/goods-receiving.ts`; finalize-cost fixed (pre-tax base, stable
  idempotency key `po_finalize_cost_<poId>`, claim-first); warehouse transfers made safe (all items checked first, guarded
  deduct, undo on failure); derived stock hold (`lib/stock-hold.ts`) and deduction at DP approval (`lib/dp-stock.ts`);
  inventory screen shows an "On Hold" column.
- 4F: `lib/returns.ts` `removeReturnedItem` (receipt cost, supplier from PO, caps, 409s `CREDIT_SUPPLIER_UNRESOLVED`,
  `CREDIT_AMOUNT_ZERO`, `CREDIT_DUPLICATE`); `supplier-payments` POST and `/api/product-returns` return 410.
- 4G (no-schema part) plus review fixes.
- This final round (merged and deployed in `daaab40`):
  - Group 1 leftovers: PO PUT same-status approve no longer overwrites total/payment_type; the approval revert restores
    all changed columns (`buildApprovalRevert` in `lib/po-status.ts`); PO PUT over-order guard checks only increased or new
    lines (`linesWithIncreasedQuantity`); Customers-tab chips use the shared delivered statuses and note returns
    (`lib/customer-dp-chip.ts`); Create-DP remaining count excludes REJECTED permits (`lib/dp-planned.ts`);
    `payment-schedules` returns 500 with `schedulePaid:true, invoiceUpdated:false` when the invoice update fails;
    `lib/ap-mark-paid.ts` deleted.
  - Workflow: DP REJECT writes real columns (`rejected_at`, `rejected_by` only if the user exists, `rejection_reason`);
    transition guard `lib/dp-transitions.ts` (409 `DP_INVALID_TRANSITION`); server-side DP quantity cap (409
    `DP_OVER_QUANTITY`); SO reject status mapping; two dead calls removed from sales-orders PUT/POST.
  - Consistency: GRN statuses; `lib/enums.ts` synced to the live CHECKs; `lib/metrics/index.ts` no longer queries dropped
    `report_*` views; single AR status helper `lib/ar-status.ts`; `GRN over-receipt` guard already existed (409
    `OVER_RECEIPT`, now also returns `lines`).
  - Hardening (narrowing only): `lib/parse-id.ts`, DELETE with missing/blank/non-integer id returns 400 on customers,
    suppliers, products, inventory, AP, AR, and `DELETE /api/balance` always 400; SO/PO DELETE validate id, return 404 for
    unknown, and (review fix) 409 when dependents exist; `/api/upload` allowlist; `lib/html-escape.ts` applied to print
    routes (golden-file tests prove ordinary output is byte-identical).
  - Review fixes: rejecting a SUBMITTED_SIGNED permit that had made the SO "delivered" now takes the SO back
    (`ready_for_delivery`, fulfilment `READY_FOR_PICKUP` or `PARTIALLY_DELIVERED`); `image/jpg` accepted for jpg; PO PDF
    shows Arabic labels for `partially_received` / `received_with_issues`.
  - Decisions batch: revenue KPI, invoices only from APPROVED permits (+ `create-from-so` retired, the AR module menu item
    now points to "From Delivery Items"), shared `lib/upload-allowlist.ts`.

Vercel/GitHub deployments: GitHub deployment 6947596940 (`cc39aa3`, success) and 6948683844 (`daaab40`, success).
Check with `gh api repos/selimmatar/misrmotors-github-/deployments?sha=<full sha>` then `/deployments/<id>/statuses`.
The Vercel project id was not recorded in this session; read it from the Vercel MCP (`list_projects`) if needed.

---------------------------------------------------------------------
## 4. Live database changes made (project xpepwirzxsufrrjklzpg)

Applied on 2026-10-08 (all with guarded WHERE clauses):
1. `accounts_payable.paid_amount` set to the existing payment amount for invoice_id 14,15,16,17,18,19,20,21,22,24
   (they were `paid` with `paid_amount` 0; each has exactly one matching `supplier_payments` row). Generated `balance` is now 0.
2. `accounts_receivable.installment_months` 6 -> 1 for invoice_id 1,3,4 (cash / bank-transfer invoices with no payments).
   Invoices 2 and 5 were left at 6.
3. `supplier_credits` credit_id 1: `invoice_id` set to 10 (was NULL). Amount and reference_type unchanged.
4. `accounts_receivable` INV-2026-0005: `collected_amount` set equal to `amount` (966,330.63). Before it was 1,127,385.74
   because the invoice was credited twice (a `customer_payments` row of 161,055.11 plus a full 966,330.63
   `balance_entries` row made 46 seconds later with no `customer_payments` row). The duplicate balance entry was NOT
   touched.
5. Migration `fix_update_overdue_schedules_ap_status`: `update_overdue_schedules()` now tests `'partially_paid'` in the AP
   branch (was invalid `'partial'`). It is still NOT scheduled (no pg_cron job was created).

Restore notes for these: `restore_backup.sql` in the old session scratchpad (not in the repo). Summary: AP 14-22/24 had
paid_amount 0; AR 1,3,4 had installment_months 6; credit 1 had invoice_id NULL; INV-2026-0005 had collected 1,127,385.74.

Pending SQL (NOT applied; the Supabase MCP `execute_sql` hung on DELETE statements, probably waiting for a destructive
confirmation the session could not show; UPDATE and apply_migration worked). The user can run these in the Supabase SQL editor:
```sql
delete from accounts_payable where invoice_id in (1,5) and status='paid' and paid_amount=0
  and not exists (select 1 from supplier_payments where invoice_id in (1,5))
  and not exists (select 1 from supplier_credits where invoice_id in (1,5));
delete from goods_receipts where receipt_id in (5,12,15,16);   -- lines cascade; all lines are outsourced, stock unaffected
-- INV-2026-0002 (SO 7, billed whole SO, overlaps INV-2026-0005, no payments) is the duplicate invoice: delete it plus its
-- invoice_delivery_permits link rows only after confirming; DP-2026-0004's own share (72,394.56) then needs a new invoice.
```
Still unresolved data anomalies (dummy data, workflow-neutral): duplicate supplier payments on AP 11 (two of 2,565,000) and
AP 23 (two of 24,844.93); `balance_entries` 6 points at a deleted PO; payment 1 (11,400) has no balance entry; AP rows
1,2,5,6 are `paid` with no payment rows; PO 7's 100 stock units were received as outsourced lines so never reached
inventory; POs 4 and 5 order the same SO 6 lines twice. Full report (exact SELECTs and proposed SQL, all labelled NOT RUN):
the old scratchpad file `reconciliation_report.md`.

---------------------------------------------------------------------
## 5. Work in progress and next steps

Nothing is in progress. The "Approved decisions code batch" agent finished and is merged and deployed in `daaab40`.
This file is the only uncommitted work at the time of writing.

Planned next steps (in order):
1. The user (or Claude) walks the main flow once in the live app: Sales Order -> approve (stock goes on hold) -> Delivery
   Permit -> approve (stock drops) -> Invoice via "From Delivery Items". Also: Bank Transfer SO, a reject on a signed
   permit, a PO with two receipts. Fix anything that breaks.
2. Optional: the user runs the pending DELETEs above to clear duplicate rows.
3. Larger batches that need a decision first: returns credit notes / AR reduction; prepaid-PO payment rule; per-document
   VAT; real auth + RLS + role vocabulary; supplier-credit apply schema.

---------------------------------------------------------------------
## 6. Known open issues, risks, verified vs not verified

Verified: all 24 test suites pass against an in-memory fake DB; `tsc` reports 0 errors in new or touched files
(baseline ~517 pre-existing errors, now ~508; `next.config.mjs` ignores TS errors in build). Independent reviews found no blockers.
Not verified: nothing was clicked through in the live app; the Supabase inventory query in `lib/metrics/index.ts` was not
exercised by tests (FakeDb lacks embedded selects); lint was not run.

Open items:
- `app/api/sales-orders/route.ts` POST still inserts into the non-existent `quotation_requests` table and throws a 500
  after the order is saved (only reachable by a payload no UI sends). Left because removing it would hide a failure.
- `app/api/sales-orders/route.ts` PUT still has the `accountant_approved` -> create AR block: its main insert always
  fails (missing NOT NULL `invoice_number`), but the hybrid down-payment insert could succeed for a raw API caller.
  Left because it is financial behaviour.
- Five AR payment-status copies remain outside the shared helper: `accounts-receivable/payments/route.ts:224`,
  `payment-schedules/route.ts:~413` and `~584`, `accounts-receivable-module.tsx:369-382` (plus ~524, 624, 659, 682),
  `accountant-module.tsx:929-934`, `accounts-receivable/route.ts:150` (PUT trusts client-sent status).
- `payment-schedules` still double-writes `collected_amount`; both writes kept because neither was provably safe to drop.
  After a failed invoice update the schedule row is already marked paid; the AR module never posts schedule payments, so
  no automatic retry exists there.
- `DP_DELIVERED_STATUSES` in `lib/delivery-status.ts` still contains the phantom `DELIVERED`; removal needs its own
  change (used by sales-orders route, missing-items, delivery-status).
- Customers-tab chips use order-level `returnedQuantity`, not per-permit returns (API limitation).
- HR documents upload (`/api/hr/documents/upload`) has no file-type check. Other safe narrowings not done:
  `payment-schedules` DELETE (NaN id), `warehouses`/`couriers`/`users` DELETE id validation, `ai/payment-reminder-agent`
  email HTML unescaped.
- Security: 102 of 109 route files never check a user; most use the service-role client; RLS is `USING (true)`. The user
  chose to leave this for now.
- `image/*` file pickers can offer bmp/tiff/avif, which the upload routes refuse with 415.
- `update_overdue_schedules()` is fixed but never scheduled.
- SO approval does not re-check stock availability (accepted as designed); stock hold ignores returns.
- Two simultaneous PO creates can both pass the over-order check (needs a DB constraint).

---------------------------------------------------------------------
## 7. Test setup and conventions

Run the suites: `TEST_OUT=<scratch dir> bash lib/__tests__/run-tests.sh`. It compiles with `tsc` into `$TEST_OUT`, prints
`compiled (tsc reported N error line(s); new-file errors: M)` (M must be 0), then runs each node:test suite (24 now:
payment-type, invoicing, returns, invoicing-returns, so-edit, routes, print-totals, missing-items, print-routes,
goods-receiving, accounts-payable-payments, po-status, po-over-order, costing, transfers, legacy-paths, supplier-credits,
stock-hold, review-fixes, leftovers, workflow-fixes, consistency-fixes, hardening, decisions).
- A full run takes about 5-12 minutes. Run it in the background and never two at once. The log has no explicit "done" line:
  count `# fail 0` lines (24) and grep for `fail [1-9]`.
- After running, `git checkout tsconfig.tsbuildinfo`.
- Fake DB: `lib/__tests__/fake-db.ts` (in-memory, strict `===` comparisons so use numeric ids; supports `.or()`,
  `child(*)`, gte/gt/lte; no embedded selects). Route harness: `lib/__tests__/route-harness.ts` (`call`, `useDb`, stubs for
  `next/cache`, `@vercel/blob`, `lib/supabase/server`, `createServerClient`). Golden print fixtures in
  `lib/__tests__/fixtures/hardening/`.
- Register every new test file and suite name in `run-tests.sh` (file list, new-file-errors regex, suite loop).
  Merging parallel branches always conflicts there: keep the HEAD side and append each branch's entries.
- PostgREST gotchas: `.maybeSingle()` errors on multi-row results (use `.limit(1)`); an empty `.update({})` may return zero
  rows; long `.in()` lists exceed URL limits (chunk at 100).
- No DB transactions with the service-role client: safety comes from compare-and-swap writes with row-count checks, undo
  steps and `idempotency_log` (`lib/idempotency.ts`, unique `(operation_type, idempotency_key)`; deduct claim key
  `dp_stock_deduct_<permitId>`).
- Schema facts: all PKs are integers and not named `id` (so_id, po_id, permit_id, receipt_id, invoice_id, `users.user_id`;
  `accounts_payable` PK is `invoice_id`); DP number column is `permit_no`; never write generated columns (`balance`,
  `quantity_remaining`). Always re-read the live CHECK constraints before writing a status literal.
- Agent pattern used: worktree-isolated subagents, one per group, with a shared rules file, merged with
  `git merge --no-ff`, then a full suite run, then an independent read-only reviewer. Keep file ownership disjoint between
  parallel agents.
- Deploy: production deploys from a push to `main`. Branch pushes do not deploy.
- Commit style: short imperative subject, blank line, trailers (`Co-Authored-By`, `Claude-Session`).

---------------------------------------------------------------------
## 8. Things a new session must not redo or contradict

- Do not re-add the Mark-as-paid button, `lib/ap-mark-paid.ts`, `create-from-so`, or the old `rejected` SO status.
- Do not subtract returns from the stock hold, and do not retroactively deduct stock for old APPROVED permits without the
  user's say.
- Do not touch auth/RLS/roles or run schema changes without an explicit user decision. The user said to leave RLS and login.
- Do not merge to `main` or deploy without a fresh ask. Do not create a pull request unless asked.
- Do not modify `MISR_MOTORS_AUDIT_REPORT.md`.
- Another Claude session (`session_01QRb2bkWgGHmJSFkUWz7gxG`) asked for this handoff. The user confirmed it is theirs.
  Claude was asked only to write this file, not to message that session.
