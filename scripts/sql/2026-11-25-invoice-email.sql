-- E-invoice e-mail to the customer (owner request 2026-11-24): when a customer invoice's e-invoice becomes VALID on
-- the real ETA portal, the customer is e-mailed the portal's PDF plus signed view / print links (lib/eta/invoice-email.ts,
-- lib/doc-links.ts, app/api/doc-link/[token]/route.ts, app/api/eta/invoice-email/route.ts). Every attempt is one row.
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: one new table with its indexes, and one new nullable
-- column on customers. Safe to run twice.
--
-- Until this runs the app keeps working: nothing is e-mailed automatically, and the invoice window says
-- "database update needed" instead of offering "Send again".
--
-- Owner correction 2026-11-26: invoice e-mails are now MANUAL ONLY ("Send" / "Send again"); the app writes only
-- trigger 'manual' rows with claim_key null. The 'auto' value and claim_key stay for compatibility (unused).
-- (Before that correction:) Once only: an automatic send first inserts its row with claim_key 'auto:<invoice_id>:<eta_uuid>:<attempt>'; the
-- unique index makes a second sender for the same invoice + portal document + attempt fail before anything is sent.
-- Manual sends ("Send again") have no claim_key (NULLs are distinct). Automatic retries: attempts 2 and 3 only.
-- The recipient column is called sent_to ("to" is a reserved word in SQL).

create table if not exists public.invoice_email_log (
  log_id bigserial primary key,
  invoice_id int not null references public.accounts_receivable(invoice_id) on delete cascade,
  eta_uuid text not null,
  environment text not null default 'real' check (environment in ('test','real')),
  sent_to text,
  status text not null check (status in ('sending','sent','failed','no_email','not_configured')),
  error text,
  sent_at timestamptz,
  attempt int not null default 1 check (attempt >= 1),
  trigger text not null check (trigger in ('auto','manual')),
  claim_key text,
  created_by int,
  created_at timestamptz not null default now()
);
create unique index if not exists invoice_email_log_claim_key_key on public.invoice_email_log (claim_key);
create index if not exists invoice_email_log_invoice_id_idx on public.invoice_email_log (invoice_id, eta_uuid);

-- Server-side access only (service role), like the other e-invoice tables: RLS on, no policies.
alter table public.invoice_email_log enable row level security;

comment on table public.invoice_email_log is
  'Customer e-mails of valid e-invoices: one row per attempt (auto = when the portal said valid, manual = Send again)';

-- The customer card's "Accountant email" (بريد المحاسب): where our invoice e-mails go (comma-separated allowed). When
-- empty the customer's main e-mail is used. Until this runs the card does not save it (the save says so).
alter table public.customers add column if not exists accountant_email text;

comment on column public.customers.accountant_email is
  'Invoice e-mails go to these addresses (comma-separated), null or empty = the main email';
