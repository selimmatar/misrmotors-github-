-- "Send to customer" for quotations and sales orders (owner request 2026-11-27): a person presses Send, the customer's
-- purchasing contact (and/or main e-mail) gets the document as a PDF. Manual only. Additive: one nullable column on
-- customers and one new log table. Safe to run twice. Until it runs the Send window says "database update needed".

alter table public.customers add column if not exists salesperson_email text;
comment on column public.customers.salesperson_email is
  'The customer''s purchasing contact: quotations and sales orders are e-mailed here (comma-separated allowed)';

create table if not exists public.document_email_log (
  log_id bigserial primary key,
  doc_kind text not null check (doc_kind in ('quotation','sales-order')),
  doc_id int not null,
  sent_to text,
  status text not null check (status in ('sending','sent','failed','no_email','not_configured')),
  error text,
  sent_at timestamptz,
  attempt int not null default 1 check (attempt >= 1),
  created_by int,
  created_at timestamptz not null default now()
);
create index if not exists document_email_log_doc_idx on public.document_email_log (doc_kind, doc_id);

-- Server-side access only (service role): RLS on, no policies.
alter table public.document_email_log enable row level security;
comment on table public.document_email_log is 'Quotation / sales order e-mails to customers: one row per Send';
