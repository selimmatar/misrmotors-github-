-- Accounts Payable <-> ETA portal, item by item: the line pairs the accountant confirmed or took apart, remembered per
-- supplier. WRITTEN, NOT APPLIED (owner approval required). Additive only: one new table, no change to existing tables
-- or rows. Safe to run twice.
--   portal_name  the portal line's description, normalized (lib/eta/normalize.ts normalizeName); '' when unknown
--   portal_code  the supplier's own item code of the portal line (internalCode, else itemCode); '' when unknown
--   our_key      our side: 'p:<product_id>', or 'n:<normalized item name>' for an item without a product card
--   kind         'confirmed' = the same item (scored up next time); 'rejected' = never pair them automatically
-- Until this runs the comparison works without memory and saving a pair is refused with "database update needed"
-- (lib/eta/ap-line-compare.ts).
create table if not exists public.ap_line_pair_memory (
  memory_id serial primary key,
  supplier_id int not null references public.suppliers(supplier_id) on delete cascade,
  portal_name text not null default '',
  portal_code text not null default '',
  our_key text not null,
  product_id int,
  our_name text,
  portal_description text,
  kind text not null check (kind in ('confirmed','rejected')),
  created_by int references public.users(user_id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (supplier_id, portal_name, portal_code, our_key)
);

create index if not exists ap_line_pair_memory_supplier_id_idx on public.ap_line_pair_memory (supplier_id);

-- Lock-down: server (service key) only, no policies
alter table public.ap_line_pair_memory enable row level security;

-- Check (read-only): the table exists with RLS on and no policies.
-- select relname, relrowsecurity from pg_class where relname = 'ap_line_pair_memory';
-- select count(*) from pg_policies where tablename = 'ap_line_pair_memory';  -- 0
