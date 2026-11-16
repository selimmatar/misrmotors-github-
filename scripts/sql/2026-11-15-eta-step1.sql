-- E-invoice (Egyptian Tax Authority) step 1: database changes. WRITTEN, NOT APPLIED (owner approval required).
-- Additive only: new columns and new tables. Nothing is dropped, renamed or changed. Safe to run twice.

-- Customers
alter table public.customers add column if not exists eta_receiver_type text default 'B' check (eta_receiver_type in ('B','P','F'));
alter table public.customers add column if not exists tax_registration_number text;
alter table public.customers add column if not exists national_id text;
alter table public.customers add column if not exists address_governorate text;
alter table public.customers add column if not exists address_region text;
alter table public.customers add column if not exists address_street text;
alter table public.customers add column if not exists address_building_number text;

-- Suppliers
alter table public.suppliers add column if not exists tax_registration_number text;

-- The accountant's registered item codes
create table if not exists public.eta_item_codes (
  code_id serial primary key,
  item_code text unique,
  code_type text check (code_type in ('EGS','GS1')),
  name text,
  keywords text[],
  default_unit text default 'EA',
  active boolean default true,
  created_at timestamptz default now(),
  created_by int references public.users(user_id) on delete set null
);

-- Products point at a code
alter table public.products add column if not exists eta_code_id int references public.eta_item_codes(code_id) on delete set null;
alter table public.products add column if not exists eta_unit_type text;

-- Learned name -> code memory
create table if not exists public.eta_code_memory (
  memory_id serial primary key,
  normalized_name text unique,
  core_name text,
  sample_name text,
  code_id int references public.eta_item_codes(code_id) on delete cascade,
  unit_type text,
  source text check (source in ('confirmed','imported')),
  confirmed_by int references public.users(user_id) on delete set null,
  confirmed_at timestamptz default now()
);
create index if not exists eta_code_memory_core_name_idx on public.eta_code_memory (core_name);
create index if not exists eta_code_memory_code_id_idx on public.eta_code_memory (code_id);

-- One row per customer invoice that touches the portal
create table if not exists public.eta_documents (
  doc_id serial primary key,
  invoice_id int unique references public.accounts_receivable(invoice_id) on delete cascade,
  document_type text check (document_type in ('I','C','D')),
  status text check (status in ('manual','pending_signature','submitted','valid','invalid','cancelled','rejected')),
  eta_uuid text,
  eta_long_id text,
  submission_uuid text,
  lines jsonb,
  totals jsonb,
  errors jsonb,
  created_by int references public.users(user_id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Lock-down: server (service key) only, no policies
alter table public.eta_item_codes enable row level security;
alter table public.eta_code_memory enable row level security;
alter table public.eta_documents enable row level security;
