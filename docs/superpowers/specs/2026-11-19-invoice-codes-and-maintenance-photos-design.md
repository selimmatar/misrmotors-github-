# Invoice codes (INV / MINV) + maintenance photo drafts — design

Owner request 2026-11-19. Status: WAITING FOR OWNER APPROVAL. Nothing is built yet.

Two parts. Part 1 can ship alone; part 2 uses part 1 (its invoices get MINV numbers).

---

## Part 1 — two invoice codes, each with its own sequence

### Why
Sales and maintenance invoices share one number sequence today (`INV-2026-0001` style, restarts every year).
The owner wants them told apart by the number itself, each counting on its own.

### Decided (owner)
- Sales invoices: `INV-` + number. Maintenance invoices: `MINV-` + number.
- Format: code + last two digits of the year + number: `INV-26-5567`, `MINV-26-5567` (in 2026).
- Not a basic-looking number: both sequences start at **5567** each year, then count up by 1
  (`INV-26-5567`, `INV-26-5568` … then `INV-27-5567` in 2027).
- The two sequences never clash (different code in front).

### Rules
- Applies to NEW invoices only. Existing invoices keep their numbers (`10503`, `INV-2026-0001`, `INV-2026-10525`,
  `INV-MNT-WO-…`); invoices already on the ETA portal cannot be renumbered anyway.
- Next number = highest existing number of that code and year + 1 (only `INV-<yy>-<digits>` /
  `MINV-<yy>-<digits>` count), or 5567 if none yet that year. The year is the invoice date's year (Cairo time).
  Old formats are ignored, so they cannot push the new sequence.
- Two invoices created at the same moment: the existing unique-number retry (`attemptOffset`, Postgres 23505) stays.
  Builder must confirm the unique index on `accounts_receivable.invoice_number` exists.
- Which code: an invoice is maintenance when it comes from the quick maintenance screen, from a photo draft
  (part 2), or from a maintenance work order; everything else (sales order / delivery permit / down payment) is INV.
- Change invoice number (feature from 2026-11-18): the new number must keep its code — a sales invoice cannot be
  given an `MINV-` number and a maintenance invoice cannot be given an `INV-` number (the code decides the tab).

### How the code is chosen (decided after reading lib/invoicing.ts)
- `nextInvoiceNumber(db, attemptOffset)` gets a third argument, the code. It reads only `INV-<yy>-<digits>` or
  `MINV-<yy>-<digits>` rows for the current year, so old numbers (`INV-2026-…`, `10503`, `INV-MNT-…`) never move
  the new counters (`INV-2026-…` has a 4-digit year, so it cannot match the 2-digit pattern).
- `createDpInvoices` picks the code from the invoice's sales order: a quick-maintenance order
  (`so_type = MAINTENANCE_PARTS` and note "Maintenance quick invoice") gets `MINV`, anything else `INV`.
  The order decides it, not the screen, so correct-and-reissue of a maintenance invoice also stays `MINV`.
- `createSoInvoice` (whole sales order) is always `INV`. A typed (manual) number is still used exactly as typed.

### Where the code changes (found by search)
- `lib/invoicing.ts` `nextInvoiceNumber` → takes the code (`INV` / `MINV`).
- `lib/maintenance-quick-invoice.ts` → asks for `MINV`; `isMaintenanceInvoice` also accepts `MINV-`.
- `lib/ar-tabs.ts`, `lib/due-schedule.ts` → treat `MINV-` as maintenance (keep `INV-MNT-` for old invoices).
- `lib/eta/rename-invoice.ts` → the "keep its code" rule above.
- Work-order invoice creation (`INV-MNT-WO-…`) → `MINV-` (owner to confirm, see open question 1).
- `scripts/sql/2026-11-17-maintenance-role.sql` view uses `like 'INV-MNT-%'` → add `MINV-%` (SQL change, owner approval).
- Tests that expect `INV-<year>-0001` are updated to the new format.

---

## Part 2 — maintenance worker sends a photo of a handwritten invoice

### Why
The maintenance worker writes invoices by hand. He is not comfortable with phones: no searching, no username or
password. He should tap one icon, take a photo, done. The accountant reviews it and turns it into an invoice.

### Goals
- One personal link per worker. The owner opens it once on the worker's phone and adds it to the home screen.
  It then looks and opens like an app (Android Chrome and iPhone Safari).
- Worker screen: one big "Take photo" button that opens the camera, then a big "Received" confirmation.
  Arabic by default, English switch, right-to-left in Arabic. Large text and touch targets.
- The photo is saved and read by AI (customer name, date, lines: description, quantity, price).
- The accountant sees new photo drafts in the **Maintenance** tab of Accounts Receivable: the photo beside the lines
  the AI read, all editable, picks the existing customer, then **Create invoice** (gets an `MINV-` number) or **Reject**.

### Non-goals
- No WhatsApp. No invoice is created without the accountant pressing Create.
- No automatic sending to the ETA portal (accountant sends as for any invoice).
- The worker link cannot see or change anything except uploading a photo.

### How (approach)
- **Link:** `/m/<secret>` — long random secret; only its hash is stored. Owner (admin) can create a link per worker,
  copy it, switch it off, and replace it. A switched-off link shows "This link is no longer active".
- **App-like icon:** a manifest per link so the home-screen icon opens that worker's page (Android), plus the
  iPhone home-screen tags. Company logo as icon.
- **Upload:** phone shrinks the photo before sending (fast on weak mobile data). Server accepts images only,
  size limit, a daily limit per link, and stores the photo in **private** Blob storage.
- **Reading:** server-side AI using the project's existing AI setup; if reading fails the draft still appears,
  just with empty lines for the accountant to type.
- **Create invoice:** calls the existing `createQuickMaintenanceInvoice` (same order + permit + invoice path the
  portal already accepts), so printing, ETA send, credit notes and payments work unchanged. A draft can be
  converted only once (status checked in the same database step).

### New database tables (owner approval needed — nothing existing is changed)
- `maintenance_upload_links`: id, worker name, secret hash, active, created by, created at, last used at.
- `maintenance_photo_drafts`: id, link id, photo (private Blob path), status (waiting / converted / rejected),
  AI-read data, customer id, invoice id (after converting), reject reason, reviewed by / at, created at.
- Access only through server routes (row level security on, no public access).

### Who can do what
- Worker link: upload only.
- Accountant / roles that already manage maintenance invoices: review, edit, create, reject.
- Admin: manage worker links.

---

## Owner answers (2026-11-19)
1. Work orders: OUT OF SCOPE. The work-order workflow is paused/in the pipeline. Work-order invoices keep
   `INV-MNT-WO-…` untouched; only quick maintenance invoices and photo drafts get `MINV-`.
2. Handwritten prices are written **before VAT** (VAT is added on top, as on the quick maintenance screen).
3. Start number is **5567** for both codes.
4. The code includes the last two digits of the year: `INV-26-5567`, `MINV-26-5567`. Assumed: each code starts
   again at 5567 in a new year (`INV-27-5567`), since the year already tells the years apart. Owner can change this.

## Order of work
1. Part 1 (codes) on its own branch + tests, owner reviews the pull request.
2. Part 2 after the two tables are approved.
