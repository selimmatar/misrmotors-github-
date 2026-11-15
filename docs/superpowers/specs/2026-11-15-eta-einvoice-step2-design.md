# E-invoice (Egyptian Tax Authority) — Step 2: the connection

Status: for the owner's approval · 2026-11-15
Builds on step 1 (`docs/superpowers/specs/2026-11-15-eta-einvoice-step1-design.md`, branch `claude/eta-design`).
Step 2 connects the ERP to the ETA portal: **sending** customer invoices and credit notes (signed with the company's
USB token) and **receiving** the supplier invoices addressed to the company. Matching received invoices to purchase
orders is step 3; the monthly VAT summary is step 4.

ETA facts below come from the official SDK, https://sdk.invoicing.eta.gov.eg/ (pages read 2026-11-15; the SDK says
"Last Update 08-12-2022"). Anything marked **(verify in test)** must be confirmed on the portal's test environment
before go-live.

## 1. Why

The accountant re-types every sales invoice on the portal and downloads supplier invoices by hand. After step 1 every
invoice in the ERP already knows its codes, units, customer tax identity and portal-exact totals. Step 2 makes one
button send it, and makes supplier invoices appear in the ERP on their own. Success: the accountant does not open the
portal to issue an invoice or a credit note, and does not type supplier invoices.

## 2. Goals

1. **Send an invoice with one button.** On a customer invoice whose e-invoice preview has nothing missing, "Send to
   portal" (accountant, CEO, admin) puts it in the **waiting to be signed** list. Several can be sent at once ("Send
   all ready").
2. **Signing on the accountant's computer.** A small Windows program (the **signer**) runs in the background on the
   computer that has the USB token. Every few seconds it asks the ERP for documents waiting to be signed, signs them
   with the token, and hands the signatures back. The token and its PIN never leave that computer.
3. **The ERP submits and follows up.** With the signature back, the ERP submits to the portal, stores the portal's
   IDs (uuid, longId, submission uuid), checks the result until the portal says **valid** or **invalid** (with the
   portal's reasons in plain words), and shows the status on the invoice.
4. **Credit note for the whole invoice.** On a valid invoice, "Credit note for the whole invoice" prepares a credit
   note that repeats the invoice's sent lines exactly, references the invoice's portal uuid, and keeps the same
   internal number (as the accountant does today, e.g. credit note for 10363). It is signed and sent the same way.
5. **Cancel on the portal** while the portal still allows it (the window comes from the portal itself, see §6.5).
5a. **Replace an invoice** after its credit note or cancel: clone, edit, re-issue with a new number; both invoices
   labelled and linked; the old one stops counting; payments move (§6.5a).
6. **Portal printout.** Valid documents get "Portal PDF" (the portal's own printout with its QR code).
7. **Receive supplier invoices.** The ERP pulls every document where the company is the receiver (invoices, credit
   notes, debit notes) into a **Supplier e-invoices** list under Accounts Payable: supplier (recognised by tax
   number), their number, date, net, VAT, total, lines, status, and the portal printout. A daily automatic pull plus a
   "Check now" button.
8. **Test first.** A setting chooses the portal's **test** or **real** environment. Everything can be tried on the
   test portal with test credentials; test results never change the real status of an invoice.
9. **Signer health.** The settings screen shows whether the signer is online (last seen), and the send list says
   "the signer is offline — invoices will go out when the accountant's computer is on".

## 3. Non-goals (step 2)

- Matching supplier invoices to purchase orders, creating payables from them, or rejecting a supplier invoice on the
  portal (step 3).
- Partial credit notes (the owner reverses whole invoices only), debit notes we issue, receipts (e-receipt / POS).
- Changing balances by a credit note alone: a credit note on the portal does not by itself change Accounts Receivable.
  Balances change only through "Replace invoice" (§6.5a) or the return / customer credit recorded as today (§6.4).
- Foreign currency invoices (all invoices are EGP).
- Sending invoices created before go-live (they stay "handled manually"; step 1 rule).

## 4. Anti-goals (a failure even if it works)

- **An invoice sent twice**, or a test send counted as a real one.
- **Anything sent that differs from what the ERP billed** (preview total ≠ stored amount is refused — step 1 Ruling 6).
- **Secrets exposed:** the ETA Client ID / Secret anywhere but Vercel environment variables; the token PIN anywhere
  but the accountant's computer; the signer key shown more than once or stored in clear.
- **A stuck invoice nobody sees:** every document is always in a visible state with a plain next step.
- **Any change to today's invoicing while go-live is empty**, and any change to existing financial records.
- **A website talking to the token** through the browser (fragile; browsers keep restricting it).

## 5. Approaches considered

| | How signing happens | Trade-off |
|---|---|---|
| A | The web page talks to a signing program on the PC (localhost) | Works only while the page is open on that PC; browsers increasingly block pages from reaching local programs |
| **B (chosen)** | A background signer on the PC **pulls** waiting documents from the ERP, signs, posts back; the ERP submits | Needs the PC on with the token plugged in; otherwise documents wait (visibly). Only outgoing connections, no browser involvement, can be triggered from any device |
| C | A paid third-party ETA connector | Least to build; monthly fee, invoices pass through another company, dependent on them |

The owner chose **B** on 2026-11-15.

## 6. How it works

### 6.1 Sending flow

```
Accountant presses Send (any device)
  → ERP builds the document from the step-1 preview (refused if anything is missing or amount_mismatch)
  → eta_documents row: status pending_signature, document JSON + its canonical text stored
Signer (on the token PC) polls GET /api/eta/signer/next every ~10 s
  → receives up to N documents' canonical text
  → signs each with the token (CAdES-BES, SHA-256) → POST /api/eta/signer/signed
ERP verifies the signature is a valid CMS over exactly that text
  → submits to the portal (POST /api/v1.0/documentsubmissions/) → status submitted (+ uuid, longId, submission uuid)
  → follows up (GET /api/v1.0/documentsubmissions/{uuid}) until valid / invalid
```

- **Follow-up without a scheduler:** status checks run whenever the signer polls and whenever someone opens Accounts
  Receivable or the send list, at most once per submission every 30 s and within the portal's rate limits. Plus the
  daily automatic job (§6.6). A document still "submitted" after 24 h shows "Portal has not answered — check again".
- **Invalid:** the portal's validation errors are shown in plain words next to the invoice; after fixing (e.g. a
  customer's address), "Send again" creates a new document version (same internal number). A rejected (by the customer)
  or cancelled document is final.
- **Batching:** one portal submission per signer delivery, at most 20 documents (the portal states no count limit,
  only a size limit; 20 keeps each submission small).
- **Changes after Send:** before handing a document to the signer the ERP rebuilds it; if the invoice, its lines or
  the customer changed since Send, it goes back to "needs review" instead of being signed.
- **Deleting an invoice on the portal:** an invoice with a real document waiting, sent, valid or credited cannot be
  deleted or edited in the ERP; the message says "cancel it on the portal or issue a credit note first". This only
  affects invoices sent after go-live; today's delete / edit is unchanged for everything else. Test documents never
  block.
- **Test sends of pre-go-live invoices** are labelled TEST and skip nothing else; they never touch real status.
- **Duplicates:** the portal refuses an identical submission within 10 minutes (422 DuplicateSubmission); the ERP
  never resubmits after a successful 202, and treats 422 as "already submitted — check status".

### 6.2 The document

- Built server-side from the step-1 preview (`buildEtaPreview`): issuer = company settings (RIN, registered name,
  activity code, branch id and address), receiver = customer card (type B/P/F, id, address), lines = preview lines
  (`description` = item name, `itemType` EGS/GS1, `itemCode`, `unitType`, `quantity`, `unitValue.amountEGP`,
  `salesTotal`, `discount`, `netTotal`, `taxableItems` = T1 / V009 / 14 "general goods", `total`, `internalCode`),
  totals, `documentType` "i" (invoice) or "c" (credit note), `documentTypeVersion` "1.0", `internalId` = the ERP
  invoice number.
- `dateTimeIssued` = the invoice's creation time in UTC (never in the future). Whether the portal refuses invoices
  issued too long before sending is **(verify in test)**; the send list warns when an invoice is older than 7 days.
- Amounts: the step-1 per-line rule (2 decimals per line) already makes every portal equation hold
  (salesTotal = quantity × unit value, net = sales − discount, VAT = net × 14%, total = net + VAT); written with up to
  5 decimals as the portal allows. Exactness is **(verify in test)** with real invoices before go-live.
- The **canonical text** that is signed follows the portal's serialization rules exactly (property names upper-cased,
  each name and simple value in double quotes, array name before the array and before each element, values unchanged).
  It is computed by the ERP, not by the signer, and stored with the document, so what is signed is exactly what is sent.
- The sent document (lines and totals) is stored as a snapshot; credit notes, prints and step 3 read the snapshot.

### 6.3 The signer program

- A small Windows program (.NET, one `.exe`), installed once on the accountant's computer, starts with Windows, sits in
  the tray (green = connected, red = problem).
- **Pairing:** in E-invoice settings the CEO or admin presses "Connect a signer": the ERP shows a one-time signer key
  once; it is pasted into the signer. The ERP stores only its hash. "Disconnect" revokes it. One signer at a time.
- The signer only reaches `/api/eta/signer/*` with that key: it can read documents waiting for signature and post
  signatures — nothing else in the ERP.
- Signing: finds the company's certificate on the token through Windows (the token's own driver exposes it), signs the
  canonical text as CAdES-BES (SHA-256, signing time, signing-certificate-v2), and Windows / the token driver asks for
  the PIN. The certificate must be the company's ETA e-seal (issued to RIN 100060455) — the signer refuses others.
- **PIN (owner chose 2026-11-15):** the accountant types the PIN once when the signer starts (each morning); it is
  never saved on disk. The token stays unlocked while the signer runs and locks when the computer is turned off. The signer has two states the ERP shows: *unlocked* (signs by itself)
  and *PIN needed* (documents wait; the tray shows "N invoices waiting — enter PIN to sign"). If the token driver asks
  for the PIN on every signature, the signer works in "sign now" mode: one prompt signs everything waiting.
- **Test portal certificate:** the signer accepts the certificate issued to the RIN configured for the selected
  environment (test settings may hold a different test RIN); whether the real token works on the test portal is
  **(verify in test)**.
- Logs locally; updates are manual (a new `.exe`).

### 6.4 Credit notes

- Button on a **valid** invoice: "Credit note for the whole invoice" (accountant, CEO, admin), with a confirm step that
  says plainly: the portal invoice will be reversed; record the return / customer credit in the ERP as usual.
- Lines and totals = the invoice's sent snapshot; `references` = [invoice uuid]; `internalId` = the invoice number;
  same issuer and receiver (portal rules for credit notes).
- Shown on the invoice: "Credited on the portal on {date}" with its own status and printout. At most one credit note per
  invoice.

### 6.5 Cancel

- "Cancel on portal" on a valid invoice or credit note, only while the portal's cancel window is open
  (`PUT /api/v1.0/documents/state/{uuid}/state`, status cancelled, with a reason). The window is read from the portal's
  document-type settings (`GET /api/v1.0/documenttypes/{id}`) and cached; if it cannot be read, the button is shown and
  the portal's answer (OperationPeriodOver) is shown in plain words.
- An invoice with an active credit note cannot be cancelled (the portal refuses it too).

### 6.5a Replace an invoice (owner request, confirmed 2026-11-15)

- **When:** only on an invoice whose real portal document is fully reversed — a **valid credit note** or **cancelled**.
  Never while the invoice is still live on the portal (no two live invoices for one sale).
- **"Replace invoice"** (accountant, CEO, admin) opens a new customer invoice pre-filled as a copy of the old one: same
  customer, sales order and delivery-permit links, same lines, discount and VAT rule. Before saving, the accountant can
  edit the customer, item names, quantities, unit prices, discount and date, and types the new invoice number (as today).
- **Labelled and linked:** the old invoice shows "Replaced by {new number}", the new one "Replaces {old number}"; each
  label opens the other invoice. Both directions are stored (`replaces_invoice_id` / `replaced_by_invoice_id`).
- **The old invoice in the ERP:** kept for history with status **Replaced** (and its credit note / cancel). From that
  moment it no longer counts in the customer's balance, ageing, statements, reports or the "already invoiced" /
  over-invoicing checks, so the new invoice can bill the same delivery permits.
- **Payments:** payments already applied to the old invoice move to the new one automatically, in the same action. If
  the new invoice is for a **different customer**, the replace is refused while the old invoice has payments, with the
  message "This invoice has payments from {customer}. Move or refund them first" — money is never moved between
  customers automatically. If the moved payments exceed the new amount, the difference is shown and the replace needs
  a confirm (the overpayment stays as the customer's credit, as today).
- The new invoice is an ordinary invoice: it goes through the step-1 preview and "Send to portal" like any other.
- Replace happens in one database transaction (new invoice, links, old status, payment moves) — all or nothing.

### 6.6 Receiving supplier invoices

- `GET /api/v1.0/documents/search?direction=Received` with paging (`continuationToken`) over 30-day windows, then
  `GET /api/v1.0/documents/{uuid}/details` for the lines of new ones, within the portal's rate limits.
- Stored once per portal uuid; status updates (e.g. the supplier cancels) overwrite status only.
- Supplier recognised by `issuerId` = supplier card tax number; unknown ones are listed as "Unknown supplier — add this
  tax number to a supplier card".
- Runs daily by itself (a Vercel cron calling `/api/eta/sync` with a secret) and on "Check now"; the first run goes back
  90 days.
- Read-only in step 2: no payable is created or changed.

### 6.7 Environments and credentials

- E-invoice settings: environment **test** or **real** (CEO / admin only).
- Credentials are Vercel environment variables only: `ETA_CLIENT_ID`, `ETA_CLIENT_SECRET` (real) and
  `ETA_TEST_CLIENT_ID`, `ETA_TEST_CLIENT_SECRET` (test). The owner adds them in Vercel; they are never sent in chat.
  The settings screen shows only "set / not set".
- Test: identity `https://id.preprod.eta.gov.eg`, API `https://api.preprod.invoicing.eta.gov.eg` (the portal's test
  certificates need its test root CA trusted for those calls only). Real: `https://id.eta.gov.eg`,
  `https://api.invoicing.eta.gov.eg`. Login: `POST /connect/token`, client credentials, token cached until it expires
  (1 hour).
- In **test**, any invoice can be sent (go-live does not apply) so real invoices can be tried; every document row
  carries its environment, and the invoice's badge shows only **real** results. A test document is labelled "TEST".

## 7. Database changes (owner approval required)

Additive except one constraint change on a table created in step 1 (empty in production apart from test rows):

- `eta_documents`: add `environment` (test / real), `version` (1, 2… for "send again"), `canonical` text, `document`
  jsonb, `signature` text, `references` text[], `submitted_at`, `checked_at`, `validated_at`, `printout_ok`.
  Replace the unique `invoice_id` with unique (`invoice_id`, `document_type`, `environment`, `version`), so an invoice
  can have its credit note, test sends, and re-sends. Add the `rejected` meaning "rejected by the customer".
- `eta_signers`: `signer_id`, `key_hash`, `name`, `created_by`, `created_at`, `last_seen_at`, `revoked_at`.
- `eta_received_documents`: `uuid` unique, `environment`, `document_type`, `issuer_id`, `issuer_name`,
  `supplier_id` (nullable), `internal_id`, `date_issued`, `net`, `vat`, `total`, `status`, `lines` jsonb, `raw` jsonb,
  `first_seen_at`, `updated_at`.
- RLS on, no policies (server only), as in step 1.
- `accounts_receivable` (existing financial table — additive only): `replaces_invoice_id`, `replaced_by_invoice_id`
  (nullable references), and the status value **replaced**. Every place that sums or checks customer invoices (balance,
  ageing, statements, reports, over-invoicing, Orders to invoice) must exclude `replaced` — the builder lists them all
  and tests each. No existing row changes until someone uses Replace.

## 8. Permissions and access (owner approval required — touches auth)

- Send, send again, credit note, cancel, portal PDF, receiving list, Check now: accountant, CEO, admin
  (`/api/eta` rule already gives exactly these roles).
- Environment, connect / disconnect signer: CEO, admin.
- **New non-login access paths:** `/api/eta/signer/*` (signer key, checked by the route) and `/api/eta/sync` (cron
  secret). Middleware lets these two through without a login session; the routes refuse anything without a valid key.

## 9. Screens

- **Accounts Receivable row:** e-invoice badge — Not sent · Waiting to be signed · Sent · Valid ✓ · Invalid (why) ·
  Cancelled · Credited · Handled manually · TEST. The step-1 "E-invoice" window gains Send / Send again / Credit note /
  Cancel / Portal PDF depending on state.
- **E-invoice settings:** environment; credentials set / not set; signer (connect, last seen, disconnect); a
  **Waiting to be signed** list and a **Sent today** list.
- **Accounts Payable → Supplier e-invoices:** list with supplier, number, date, total, status, unknown-supplier flag,
  lines on open, portal PDF, Check now.
- EN / AR, phone width and RTL, as everywhere.

## 10. Testing

- Pure, unit-tested: canonical serialization (against the SDK's own example and sample invoice 10363's shape), document
  builder (invoice and credit note from the step-1 preview), portal error → plain words, state transitions.
- Routes with the existing FakeDb / route harness: send, signer next / signed (key checks, wrong key, revoked key,
  signature that does not match the text), submit and follow-up with a fake portal (202, 422 duplicate, 429 retry-after,
  invalid with errors), cancel, receive (paging, unknown supplier, status update).
- Signer: unit tests for the signing call with a test certificate; a manual checklist on the accountant's PC with the
  real token on the **test** portal.
- Acceptance on the test portal before go-live: one invoice, one with a discount, one credit note, one cancel, one
  receive — all valid.

## 11. Calls made on the owner's behalf (owner delegated the how)

1. Signing approach B (owner chose it explicitly).
2. Whole-invoice credit notes only (owner: returns reverse the whole invoice).
3. Credit notes do not change ERP balances; the return is recorded as today.
4. `dateTimeIssued` = the invoice's creation time; warning after 7 days.
5. Batches of at most 20 documents; status checks piggyback on signer polls and screen opens plus one daily job.
6. Test sends never change the real badge.
7. One signer at a time, paired by a one-time key.
8. Receiving goes back 90 days on the first run.
9. An invoice on the real portal can't be deleted / edited in the ERP (cancel or credit note first).
10. A document is rebuilt before signing; if the invoice changed since Send it goes back to "needs review".
11. The signer's certificate rule follows the selected environment's RIN.

Owner decision: PIN typed once per day when the signer starts, never saved (option A, 2026-11-15).

## 12. Waiting on the owner / accountant

- Test-portal registration of the ERP (test Client ID / Secret) and later the real one — added in Vercel by the owner.
- Branch code; the item-code list; company details in E-invoice settings.
- The accountant's Windows version and token brand (to confirm the token's driver exposes the certificate to Windows).
- Approval of §7 (database) and §8 (access paths).
- Token brand: confirms whether the driver keeps the token unlocked after one PIN (else "sign now" mode).

## 13. Left to the builder

- Signer polling interval and batch size within the limits above; tray UI details.
- How the Windows `.exe` is built (this environment has no .NET SDK; a hosted Windows build or a local build on the
  owner's PC are both acceptable).
- Exact plain-word texts for portal error codes.
