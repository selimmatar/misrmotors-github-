# Maintenance quick invoice — design (short)

Owner request 2026-11-17. Approved approach: A.

## Why
A maintenance person needs to bill maintenance work quickly, without the work-order process. Accountant sees
maintenance invoices separately from sales invoices.

## Goals
- New login role `maintenance` (owner approved the role change). It sees ONE screen: "Maintenance invoice".
- Screen: pick an existing customer, add lines (name, quantity, unit price before VAT; 14% VAT added, totals shown),
  press Create invoice. Nothing else (no list editing, no payments, no portal).
- The invoice lands in Accounts Receivable, flagged as maintenance.
- Accounts Receivable shows two tabs: Sales and Maintenance. Maintenance tab also shows the existing work-order
  maintenance invoices (INV-MNT-…).

## Non-goals
- No change to the existing work-order maintenance process (it stays beside the new screen).
- The maintenance user cannot send to the ETA portal, take payments, edit or delete invoices.
- No stock movement (lines are services typed by name).

## Approaches
- **A (chosen):** on Create, the server makes a small maintenance sales order (lines as outsourced/service lines),
  a delivery permit already approved (no stock taken), and the invoice from it — the same shape as invoice 10503,
  which the portal accepted. Printing, ETA send, credit notes, correct-and-reissue and payments work unchanged.
- B: a new invoice-only record with its own lines — cleaner data, but print/ETA/credit/reissue all need changes. Rejected.

## Decided
- Invoice number: the normal invoice numbering.
- E-invoice: the accountant checks codes (prediction suggests) and sends, as for other invoices.
- One server call creates order + permit + invoice; if any step fails, the earlier ones are undone (no half records).
- Flag: the AR row is marked maintenance (builder picks the field; existing INV-MNT- invoices count as maintenance).

## Left to the builder
- Exact field for the maintenance flag and the sales-order type value; the screen layout (keep it as simple as the
  shipping screen); role wiring in lib/auth (roles, permissions, role-nav) with tests; i18n Arabic + English.
