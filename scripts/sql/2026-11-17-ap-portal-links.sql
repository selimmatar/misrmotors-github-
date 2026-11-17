-- Accounts Payable <-> ETA portal: the links a person made or removed. WRITTEN, NOT APPLIED (owner approval required).
-- Additive only: one new table, no change to existing tables or rows. Safe to run twice.
--   kind 'manual'   = a person linked this portal document to this AP invoice (many-to-many);
--   kind 'rejected' = a person removed this pair (an automatic match is never suggested again).
-- Automatic matches are not stored: they are worked out on every read (lib/eta/ap-match.ts) and overridden by these rows.
create table if not exists public.ap_portal_links (
  link_id serial primary key,
  received_id int not null references public.eta_received_documents(received_id) on delete cascade,
  ap_invoice_id int not null references public.accounts_payable(invoice_id) on delete cascade,
  kind text not null check (kind in ('manual','rejected')),
  created_by int references public.users(user_id) on delete set null,
  created_at timestamptz default now(),
  unique (received_id, ap_invoice_id)
);

create index if not exists ap_portal_links_ap_invoice_id_idx on public.ap_portal_links (ap_invoice_id);

-- Lock-down: server (service key) only, no policies
alter table public.ap_portal_links enable row level security;
