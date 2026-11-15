-- E-invoice (Egyptian Tax Authority) step 2: database changes. WRITTEN, NOT APPLIED (owner approval required).
-- Additive, except four constraints that are dropped and re-added in the same file (see the do-blocks):
--   eta_documents unique(invoice_id) -> unique(invoice_id, document_type, environment, version)
--   eta_documents FK invoice_id: on delete cascade -> on delete restrict
--   eta_documents status check + accounts_receivable status check: widened (needs_review / replaced)
-- Constraint names were auto-generated in step 1, so they are looked up in pg_constraint. Safe to run twice.

-- eta_documents: new columns
alter table public.eta_documents add column if not exists environment text not null default 'real';
alter table public.eta_documents add column if not exists version int not null default 1;
alter table public.eta_documents add column if not exists canonical text;
alter table public.eta_documents add column if not exists document jsonb;
alter table public.eta_documents add column if not exists signature text;
alter table public.eta_documents add column if not exists "references" text[];
alter table public.eta_documents add column if not exists submitted_at timestamptz;
alter table public.eta_documents add column if not exists checked_at timestamptz;
alter table public.eta_documents add column if not exists validated_at timestamptz;

-- accounts_receivable: reissue links
alter table public.accounts_receivable add column if not exists replaces_invoice_id int references public.accounts_receivable(invoice_id) on delete restrict;
alter table public.accounts_receivable add column if not exists replaced_by_invoice_id int references public.accounts_receivable(invoice_id) on delete restrict;

-- Drop (by lookup) the constraints that change; each is re-added by name straight after.
do $$
declare r record;
begin
  -- step-1 single-column unique on invoice_id, the old FK, and the old status check
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.eta_documents'::regclass
      and (
        (c.contype = 'u' and c.conkey = array[(select a.attnum from pg_attribute a where a.attrelid = c.conrelid and a.attname = 'invoice_id')])
        or (c.contype = 'f' and c.confrelid = 'public.accounts_receivable'::regclass)
        or (c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%status%')
        or (c.contype = 'c' and pg_get_constraintdef(c.oid) ilike '%environment%')
      )
  loop
    execute format('alter table public.eta_documents drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.eta_documents add constraint eta_documents_invoice_doc_env_version_key unique (invoice_id, document_type, environment, version);
alter table public.eta_documents add constraint eta_documents_invoice_id_fkey foreign key (invoice_id) references public.accounts_receivable (invoice_id) on delete restrict;
alter table public.eta_documents add constraint eta_documents_status_check check (status in ('manual','pending_signature','submitted','valid','invalid','cancelled','rejected','needs_review'));
alter table public.eta_documents add constraint eta_documents_environment_check check (environment in ('test','real'));

do $$
declare r record;
begin
  -- the accounts_receivable status check (pending | partially_paid | paid | overdue)
  for r in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.accounts_receivable'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%status%'
  loop
    execute format('alter table public.accounts_receivable drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.accounts_receivable add constraint accounts_receivable_status_check check (status in ('pending','partially_paid','paid','overdue','replaced'));

-- Signing devices
create table if not exists public.eta_signers (
  signer_id serial primary key,
  key_hash text unique not null,
  name text,
  created_by int references public.users(user_id) on delete set null,
  created_at timestamptz default now(),
  last_seen_at timestamptz,
  unlocked boolean default false,
  revoked_at timestamptz
);

-- Documents received from suppliers
create table if not exists public.eta_received_documents (
  received_id serial primary key,
  uuid text not null,
  environment text not null default 'real' check (environment in ('test','real')),
  document_type text,
  issuer_id text,
  issuer_name text,
  supplier_id int references public.suppliers(supplier_id) on delete set null,
  internal_id text,
  date_issued timestamptz,
  net numeric,
  vat numeric,
  total numeric,
  status text,
  lines jsonb,
  raw jsonb,
  first_seen_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (uuid, environment)
);

-- Correct-and-reissue: what was changed on a delivery permit
create table if not exists public.dp_corrections (
  correction_id serial primary key,
  permit_id int references public.delivery_permits(permit_id),
  invoice_id int references public.accounts_receivable(invoice_id),
  lines jsonb,
  stock_moves jsonb,
  created_by int references public.users(user_id) on delete set null,
  created_at timestamptz default now()
);

-- Lock-down: server (service key) only, no policies
alter table public.eta_signers enable row level security;
alter table public.eta_received_documents enable row level security;
alter table public.dp_corrections enable row level security;
