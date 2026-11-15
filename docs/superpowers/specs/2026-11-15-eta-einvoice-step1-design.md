# E-invoice (Egyptian Tax Authority) — Step 1: the data foundation

Status: draft for the owner's approval · 2026-11-15
Project: connect Misr Motors ERP to the ETA e-invoicing system, sending (sales) and receiving (purchases) together.
This document covers **step 1 only**: everything the connection needs inside the ERP, with **no call to the portal**.

## 1. Why

Today the accountant re-types every sales invoice on the ETA portal: the customer, every line, and for every line he
searches hundreds of item codes. The goal of the whole project is that an invoice made in the ERP goes to the portal
with one click, and that supplier invoices on the portal are matched to Accounts Payable automatically.

Step 1 prepares the data so that, when the connection is switched on (step 2), every invoice already has everything
the portal requires: the customer's tax identity and address, an item code and unit on every line, and totals
calculated exactly the way the portal calculates them.

## 2. Goals (step 1)

1. **Tax identity on cards.** Customers: receiver type (company / person / foreign), tax registration number,
   national ID (persons), structured address (governorate, city / district, street, building number). Suppliers:
   tax registration number.
2. **Company tax settings.** The company's tax registration number, name as registered, activity code, branch code
   and branch address; the portal environment (test / real); the go-live moment.
3. **Item codes without searching.** The accountant's own registered codes (EGS / GS1) are entered once. Every
   invoice line gets its code from:
   1. the product card (stock products),
   2. the **code memory** (any item name confirmed before, in any spelling seen before),
   3. **close spelling** of a remembered name,
   4. **keyword rules** per code (e.g. لقمة / مفك → hand tools),
   5. otherwise unknown — the accountant picks from his short code list.
   Every confirmation is remembered (exact spelling and core name), so each item is confirmed once in its life.
4. **Unit per line** (default "piece"), remembered with the code.
5. **Portal-exact totals.** From go-live, a new customer invoice's amount is calculated line by line exactly as the
   portal does (see §6), so the ERP and the portal always show the same total.
6. **Old invoices are "handled manually".** Every invoice created before go-live is treated as already entered on
   the portal by hand and is never sent. A single invoice can also be marked "already on the portal" with its ETA ID.
7. **An e-invoice preview** on every customer invoice: the lines as they would be sent, each line's code with a
   green / orange / red state, the portal totals, and a checklist of anything missing. Read-only in step 1.
8. **Pre-fill the memory** from the item names already in the system (all past sales-order lines) so the accountant
   reviews one list once instead of meeting items one by one.

## 3. Non-goals (step 1)

- No call to the portal: no login, no signing, no sending, no receiving, no status polling (steps 2–3).
- No credit / debit notes yet (step 2), no VAT summary (step 4).
- No change to quotations or sales-order screens (codes are not picked by sales reps).
- No change to purchase orders.

## 4. Anti-goals (would make this a failure even if it works)

- **Changing any existing invoice, payment or amount.** Old invoices keep their stored amounts and documents exactly.
- **Blocking normal work.** Missing tax data never stops anyone from creating orders, delivery permits or invoices;
  it only shows in the e-invoice preview (and will stop *sending* in step 2).
- **Identifying anyone by name.** Customers and suppliers are identified by tax number; names are display only.
- **A code the accountant did not choose.** The system only *suggests*; a code is used automatically only when it
  was confirmed before for that item (or the spelling is a near-identical typo of a confirmed one).
- **Secrets in the database or the chat.** Client ID / Secret go to Vercel environment variables (step 2); the
  token PIN never leaves the accountant's computer.

## 5. Approaches considered

| | Approach | Trade-off | Decision |
|---|---|---|---|
| A | **Separate e-invoice section**: new tables for codes, code memory and each invoice's portal record; a few new fields on customers, suppliers, products; company settings as key/values | Existing sales / invoicing tables untouched; easy to audit; clean switch-on | **Chosen** (owner delegated the choice) |
| B | Fields everywhere: code on every SO line, status columns on every invoice | Scattered; pushes code choice to sales reps | Rejected |
| C | No schema change: everything in settings JSON | Fragile, unqueryable, unsafe for tax data | Rejected |

Totals: (1) **per-line VAT for invoices created after go-live** (chosen) vs (2) keep today's total-level VAT and show
piaster differences (rejected: ERP and portal would disagree).

## 6. Totals — the rule from go-live

Portal rule (as known; to be re-checked against the ETA SDK document before step 2, see §11):
for each line `salesTotal = qty × unitPrice`, `discount = salesTotal × orderDiscountRate`, `netTotal = salesTotal −
discount`, `VAT (T1, V009, 14%) = netTotal × 14%`, `lineTotal = netTotal + VAT`; invoice totals are the sums.

ERP rule from go-live (one pure function `etaLines(lines, discountRate)` in `lib/eta/totals.ts`):

- every money value rounded to 2 decimals **per line** (`netTotal`, `VAT`, `lineTotal`); invoice totals are the
  sums of the rounded line values — so the document is internally consistent and the portal accepts it;
- the invoice amount stored in Accounts Receivable = that total;
- the same function produces the e-invoice preview and (step 2) the document sent — one source of truth.

**Which lines an invoice contains** (the input to `etaLines`) — the same lines the invoice already bills today:
for a delivery-permit invoice, each linked permit's items at the net quantity billed (delivered less returns known at
invoice time, as `evaluateDpInvoice` computes it), one ETA line per permit item (the same item on two permits stays
two lines); for a whole-order invoice, the order lines less returns. Unit price is the order line's price; the
discount rate is the order's `discount_amount` ÷ its pre-discount line total (`soDiscountBase`), applied to every
line. A line priced 0 is sent as a 0 line (builder's call: the portal accepts zero-value lines; re-checked in §11).

Where today's rule is used (`lib/invoicing.ts`: `netInvoiceValue`, `computeInvoiceAmount`, the over-invoicing checks
with `MONEY_TOLERANCE = 0.05`, and `dpInvoicePrintTotals` in the invoice print):

- invoices created **before** go-live keep today's rule everywhere (amount, print, checks);
- invoices created **after** go-live use `etaLines`;
- the over-invoicing check compares values with a tolerance of `max(0.05, 0.01 × number of lines)`, because
  per-line rounding can move a total by up to half a piaster per line;
- the print of a post-go-live invoice shows the per-line VAT totals (subtotal, VAT, total) from `etaLines`.

The switch is the go-live moment in company settings (`eta_go_live_at`); empty = today's rule everywhere, so merging
step 1 changes nothing until the owner sets the date.

## 7. Database changes (owner approval required)

All additive: new nullable columns and new tables; no column dropped or renamed, no existing row changed.

**customers** — `eta_receiver_type` text default `'B'` (B company / P person / F foreign), `tax_registration_number`
text, `national_id` text, `address_governorate` text, `address_region` text (city / district), `address_street`
text, `address_building_number` text.
**suppliers** — `tax_registration_number` text.
**products** — `eta_code_id` int → `eta_item_codes`, `eta_unit_type` text.

**eta_item_codes** (the accountant's registered codes) — `code_id` serial PK, `item_code` text unique (e.g.
`EG-123456789-MM-HAND`), `code_type` text (`EGS` | `GS1`), `name` text, `keywords` text[] (rule words, normalised),
`default_unit` text default `'EA'`, `active` bool default true, `created_at`, `created_by`.

**eta_code_memory** (name → code, learned) — `memory_id` serial PK, `normalized_name` text unique, `core_name` text,
`sample_name` text (as first written), `code_id` int → `eta_item_codes`, `unit_type` text, `source` text
(`confirmed` | `imported`), `confirmed_by` int → users, `confirmed_at`.

**eta_documents** (one per customer invoice that touches the portal; step 1 uses only `manual`) — `doc_id` serial
PK, `invoice_id` int unique → accounts_receivable, `document_type` text (`I` invoice / `C` credit / `D` debit),
`status` text (`manual` | `pending_signature` | `submitted` | `valid` | `invalid` | `cancelled` | `rejected`),
`eta_uuid` text, `eta_long_id` text, `submission_uuid` text, `lines` jsonb (frozen as sent), `totals` jsonb,
`errors` jsonb, `created_by`, `created_at`, `updated_at`.

**Company settings** — no schema change: keys in the existing `company_settings` table: `eta_rin`,
`eta_registered_name`, `eta_activity_code`, `eta_branch_id`, `eta_branch_governorate`, `eta_branch_region`,
`eta_branch_street`, `eta_branch_building_number`, `eta_environment` (`test` | `real`), `eta_go_live_at`.

RLS: the new tables follow the existing lockdown (server routes use the service key; no browser access).

## 8. Matching engine (`lib/eta/codes.ts`, pure, unit-tested)

1. **Normalise**: Arabic letter variants (أإآ→ا, ة→ه, ى→ي, ؤ→و, ئ→ي), remove diacritics and tatweel, Arabic / Persian
   digits → Latin, lower-case Latin, punctuation → space, collapse spaces.
2. **Core name**: drop brand words (a brand list kept in settings, seeded with common tool brands and editable),
   size / spec tokens (numbers, fractions like 3/8, units such as بوصه, مم, سم, متر, inch, n.m, نيوتن, درج, قطعه),
   and filler words. The core name is what decides the code.
3. **Lookup order**: product card code → memory by full normalised name → memory by core name → close spelling of a
   remembered core name (similarity ≥ 0.92 → automatic; 0.80–0.92 → suggested) → keyword rules → unknown.
4. **States**: green (automatic), orange (suggested — needs one confirmation), red (unknown — pick from the list).
5. **Conflicts**: if a core name is remembered for more than one code, a match on the core name alone is only
   *suggested* (orange), never automatic; a match on the full name always wins.
6. **Learning**: confirming a line stores both its full normalised name and its core name for that code and unit.
   Changing a remembered code updates the memory (with who and when).

Similarity: a normalised character-bigram score (Dice), chosen because it tolerates doubled or missing letters in
short Arabic names; thresholds are constants in one place and covered by tests with real names from the system.

## 9. Screens (step 1)

- **Customer card**: a "Tax (e-invoice)" section — receiver type, tax registration number (9 digits for companies),
  national ID (14 digits for persons), governorate (the 27 governorates as a list), city / district, street,
  building number. Validation is advisory (shows what the portal will reject); saving is never blocked.
- **Supplier card**: tax registration number.
- **Product card**: item code (pick from the code list), unit.
- **E-invoice settings** (new screen, Finance group; accountant, CEO, admin):
  - Company tax details and environment; go-live date (empty until the owner sets it; only CEO / admin can set or
    change it — builder's call, since it changes how new invoice amounts are calculated).
  - **Item codes**: add / edit the accountant's codes and their keywords.
  - **Code memory**: search, change, remove remembered names.
  - **Prepare from past items**: every distinct item name from past sales-order lines with its suggested code
    (green / orange / red); the accountant confirms all, edits some, or skips — saved as `imported`.
  - Brand words list.
- **Customer invoice**: an "E-invoice preview" panel — lines, code and unit per line with state and a confirm /
  change control, portal totals, missing-data checklist (customer tax number, address parts, company settings).
  Confirming a code here writes to the memory. Old invoices show "Handled manually".

All text in English and Arabic; works in both directions and on a phone.

## 10. Permissions

- E-invoice settings, item codes, memory, confirming codes: accountant, CEO, admin (new route rules).
- Customer / supplier tax fields: whoever can edit the card today.
- The future Send button (step 2): accountant, CEO, admin (owner decision).

## 11. Open items left to the builder / later steps

- **To re-check against the current ETA SDK documentation before step 2** (not needed for step 1 to work): exact
  rounding tolerances, the unit-type code list (step 1 offers a short list: EA piece, SET set, KGM kg, MTR metre,
  LTR litre, BOX box; editable later), receiver-name rules, address field limits.
- Seed brand list and keyword rules: a starting set is proposed in the plan and reviewed with the accountant.
- Step 2 (connection + signing program), step 3 (receiving + matching), step 4 (VAT summary) get their own designs.

## 12. Calls made on the owner's behalf (owner delegated the how on 2026-11-15)

- Approach A and per-line totals from go-live (§5, §6).
- The go-live switch: nothing changes for anyone until the date is set; only CEO / admin set it.
- Over-invoicing tolerance `max(0.05, 0.01 × lines)`.
- Bigram similarity with thresholds 0.92 (automatic) / 0.80 (suggested); core-name conflicts are never automatic.
- Old invoices are "handled manually" by the go-live date rather than by writing a row for each old invoice
  (no change to existing data).
- Short starting unit list; brand and keyword lists editable on the settings screen.

## 13. Testing

- Pure functions (normalise, core name, similarity, lookup, `etaLines`) with real item names from the system,
  including misspellings and brands ("ترولي عدة", "ترولى عده Stanley 7 درج", "تروللي عدة").
- Totals: the two Al Kasrawy invoices and the Bostanji order reproduced line by line; pre-go-live invoices unchanged.
- Over-invoicing checks with the new tolerance; the invoice print before / after go-live.
- Routes: permissions, validation; customer / supplier card save with the new fields.
- The full suite stays green; the existing golden prints stay byte-identical for pre-go-live invoices.
