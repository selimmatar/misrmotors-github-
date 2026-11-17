-- Customers: several tax identities per customer (e.g. a mother company and its sister companies / branches, each
-- with its own tax number), chosen per invoice for the e-invoice portal. WRITTEN, NOT APPLIED (owner approval required).
-- Additive only: one new table, one new column, and a one-time copy of each customer's existing tax details into one
-- identity row. Nothing is dropped, renamed or changed. Safe to run twice.

create table if not exists public.customer_tax_identities (
  identity_id serial primary key,
  customer_id int not null references public.customers(customer_id) on delete cascade,
  name text not null,
  receiver_type text not null default 'B' check (receiver_type in ('B','P','F')),
  tax_registration_number text,
  national_id text,
  address_governorate text,
  address_region text,
  address_street text,
  address_building_number text,
  active boolean default true,
  created_at timestamptz default now()
);
create index if not exists customer_tax_identities_customer_id_idx on public.customer_tax_identities (customer_id);

-- Server-side access only (service role), like the other e-invoice tables: RLS on, no policies.
alter table public.customer_tax_identities enable row level security;

-- The identity an invoice is issued for (null: the customer's only identity, or its card fields when it has none)
alter table public.accounts_receivable add column if not exists eta_identity_id int references public.customer_tax_identities(identity_id) on delete set null;

-- One identity per customer that already has a tax number or a national ID, named after the customer. A customer
-- that already has an identity is skipped, so running this twice adds nothing.
insert into public.customer_tax_identities (
  customer_id, name, receiver_type, tax_registration_number, national_id,
  address_governorate, address_region, address_street, address_building_number
)
select
  c.customer_id, c.customer_name,
  case when c.eta_receiver_type in ('B','P','F') then c.eta_receiver_type else 'B' end,
  nullif(trim(c.tax_registration_number), ''), nullif(trim(c.national_id), ''),
  c.address_governorate, c.address_region, c.address_street, c.address_building_number
from public.customers c
where (coalesce(trim(c.tax_registration_number), '') <> '' or coalesce(trim(c.national_id), '') <> '')
  and coalesce(trim(c.customer_name), '') <> ''
  and not exists (select 1 from public.customer_tax_identities i where i.customer_id = c.customer_id);
