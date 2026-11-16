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

alter table public.eta_documents drop constraint if exists eta_documents_invoice_doc_env_version_key;
alter table public.eta_documents add constraint eta_documents_invoice_doc_env_version_key unique (invoice_id, document_type, environment, version);
alter table public.eta_documents drop constraint if exists eta_documents_invoice_id_fkey;
alter table public.eta_documents add constraint eta_documents_invoice_id_fkey foreign key (invoice_id) references public.accounts_receivable (invoice_id) on delete restrict;
alter table public.eta_documents drop constraint if exists eta_documents_status_check;
alter table public.eta_documents add constraint eta_documents_status_check check (status in ('manual','pending_signature','submitted','valid','invalid','cancelled','rejected','needs_review'));
alter table public.eta_documents drop constraint if exists eta_documents_environment_check;
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

alter table public.accounts_receivable drop constraint if exists accounts_receivable_status_check;
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

-- Correct and reissue (spec §6.5a, ruling P1; task 7). Applied with apply_migration "eta_step2_reissue".
-- The new invoice of an open correction (a 'replaced' invoice whose replaced_by_invoice_id is null) is created here,
-- all or nothing, together with the move of the old invoice's permit links, payments, schedules, used credits and
-- collected amount. The caller (lib/invoicing.ts) prices the row exactly as a normal invoice. eta_undo_reissue puts
-- everything back when the over-invoicing re-check after the insert finds a concurrent invoice that came first.
-- Raised refusals carry their code in HINT (PostgREST: error.hint). A taken invoice number raises 23505 as a normal
-- insert does. Server only: execute is revoked from public, anon and authenticated.
create or replace function public.eta_reissue_invoice(p_old int, p_new_row jsonb, p_permit_ids int[], p_confirm_overpaid boolean default false)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_old public.accounts_receivable%rowtype;
  v_new_id int;
  v_permits int[] := coalesce(p_permit_ids, '{}'::int[]);
  v_customer int := nullif(p_new_row->>'customer_id', '')::int;
  v_amount numeric := round(nullif(p_new_row->>'amount', '')::numeric, 2);
  v_due date := coalesce(nullif(p_new_row->>'due_date', '')::date, current_date + 30);
  v_collected numeric;
  v_new_collected numeric;
  v_excess numeric;
  v_status text;
  v_name text;
  v_has_payments boolean;
begin
  if v_amount is null or v_amount <= 0 then
    raise exception 'The new invoice has no amount.' using errcode = 'P0001', hint = 'REISSUE_BAD_ROW';
  end if;
  select * into v_old from public.accounts_receivable where invoice_id = p_old for update;
  if not found or v_old.status is distinct from 'replaced' or v_old.replaced_by_invoice_id is not null then
    raise exception 'Invoice % is not open for correction.', p_old using errcode = 'P0001', hint = 'REISSUE_NOT_OPEN';
  end if;
  if exists (select 1 from public.invoice_delivery_permits l where l.permit_id = any(v_permits) and l.invoice_id <> p_old) then
    raise exception 'A delivery permit of the new invoice is already invoiced.' using errcode = 'P0001', hint = 'REISSUE_PERMIT_TAKEN';
  end if;
  if cardinality(v_permits) > 0 and exists (
    select 1 from public.invoice_delivery_permits l where l.invoice_id = p_old and not (l.permit_id = any(v_permits))
  ) then
    raise exception 'The new invoice must include every delivery permit of invoice %.', v_old.invoice_number
      using errcode = 'P0001', hint = 'REISSUE_MISSING_PERMITS';
  end if;

  v_collected := round(coalesce(v_old.collected_amount, 0), 2);
  v_has_payments := v_collected > 0.005
    or exists (select 1 from public.customer_payments p where p.invoice_id = p_old)
    or exists (select 1 from public.customer_credits c where c.used_in_invoice_id = p_old);
  if v_has_payments and v_customer is distinct from v_old.customer_id then
    select customer_name into v_name from public.customers where customer_id = v_old.customer_id;
    raise exception 'This invoice has payments from %. Move or refund them first', coalesce(v_name, 'another customer')
      using errcode = 'P0001', hint = 'PAYMENTS_OTHER_CUSTOMER';
  end if;
  v_excess := greatest(v_collected - v_amount, 0);
  if v_excess > 0.005 and not coalesce(p_confirm_overpaid, false) then
    raise exception 'The payments (%) exceed the new invoice (%). Confirm to keep % as customer credit.', v_collected, v_amount, v_excess
      using errcode = 'P0001', hint = 'REISSUE_OVERPAID';
  end if;
  if v_excess > 0.005 and v_customer is null then
    raise exception 'The new invoice has no customer, so the extra payment cannot be kept as customer credit.'
      using errcode = 'P0001', hint = 'REISSUE_OVERPAID_NO_CUSTOMER';
  end if;
  v_new_collected := least(v_collected, v_amount);
  -- lib/ar-status.ts computeArStatus: paid, then overdue by due date, then partially paid, else pending
  v_status := case
    when v_amount - v_new_collected <= 0.01 then 'paid'
    when v_due < current_date then 'overdue'
    when v_new_collected > 0 then 'partially_paid'
    else 'pending'
  end;

  insert into public.accounts_receivable (
    invoice_number, customer_id, so_id, source_delivery_permit_id, invoice_date, due_date, amount, collected_amount,
    payment_terms, installment_months, months_paid, status, replaces_invoice_id
  ) values (
    p_new_row->>'invoice_number', v_customer, nullif(p_new_row->>'so_id', '')::int,
    nullif(p_new_row->>'source_delivery_permit_id', '')::int, coalesce(nullif(p_new_row->>'invoice_date', '')::date, current_date),
    v_due, v_amount, v_new_collected, p_new_row->>'payment_terms', coalesce(nullif(p_new_row->>'installment_months', '')::int, 1),
    coalesce(v_old.months_paid, 0), v_status, p_old
  ) returning invoice_id into v_new_id;

  update public.invoice_delivery_permits set invoice_id = v_new_id where invoice_id = p_old and permit_id = any(v_permits);
  begin
    insert into public.invoice_delivery_permits (invoice_id, permit_id)
    select v_new_id, x from unnest(v_permits) as x
    where not exists (select 1 from public.invoice_delivery_permits l where l.permit_id = x);
  exception when unique_violation then
    raise exception 'A delivery permit of the new invoice was invoiced by another request.' using errcode = 'P0001', hint = 'REISSUE_PERMIT_TAKEN';
  end;
  update public.delivery_permits set invoice_id = v_new_id where permit_id = any(v_permits);

  update public.customer_payments set invoice_id = v_new_id where invoice_id = p_old;
  update public.payment_schedules set invoice_id = v_new_id
    where invoice_id = p_old and coalesce(schedule_type, '') <> 'payable' and not (po_id is not null and so_id is null);
  update public.customer_credits set used_in_invoice_id = v_new_id where used_in_invoice_id = p_old;
  if v_excess > 0.005 then
    insert into public.customer_credits (customer_id, amount, status, credit_type, reference_type, reference_id, invoice_id, description, notes)
    values (
      v_customer, v_excess, 'active', 'overpayment', 'eta_reissue', p_old, v_new_id,
      'Overpayment on ' || (p_new_row->>'invoice_number') || ' (moved from ' || v_old.invoice_number || ')',
      'Overpayment on ' || (p_new_row->>'invoice_number') || ' (moved from ' || v_old.invoice_number || ')'
    );
  end if;
  update public.accounts_receivable set replaced_by_invoice_id = v_new_id, collected_amount = 0, months_paid = 0 where invoice_id = p_old;
  return v_new_id;
end
$fn$;

create or replace function public.eta_undo_reissue(p_new int, p_moved_permit_ids int[])
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_new public.accounts_receivable%rowtype;
  v_old public.accounts_receivable%rowtype;
  v_credit numeric;
  v_moved int[] := coalesce(p_moved_permit_ids, '{}'::int[]);
begin
  select * into v_new from public.accounts_receivable where invoice_id = p_new for update;
  if not found or v_new.replaces_invoice_id is null then
    raise exception 'Invoice % is not a reissue.', p_new using errcode = 'P0001', hint = 'REISSUE_UNDO_REFUSED';
  end if;
  select * into v_old from public.accounts_receivable where invoice_id = v_new.replaces_invoice_id for update;
  if not found or v_old.replaced_by_invoice_id is distinct from p_new then
    raise exception 'Invoice % is not the reissue of its old invoice.', p_new using errcode = 'P0001', hint = 'REISSUE_UNDO_REFUSED';
  end if;
  if exists (select 1 from public.eta_documents d where d.invoice_id = p_new)
    or exists (select 1 from public.customer_credits c where c.reference_type = 'eta_reissue' and c.invoice_id = p_new and c.status is distinct from 'active') then
    raise exception 'Invoice % is already in use.', p_new using errcode = 'P0001', hint = 'REISSUE_UNDO_REFUSED';
  end if;
  select coalesce(sum(amount), 0) into v_credit from public.customer_credits c where c.reference_type = 'eta_reissue' and c.invoice_id = p_new;
  delete from public.customer_credits c where c.reference_type = 'eta_reissue' and c.invoice_id = p_new;
  update public.customer_payments set invoice_id = v_old.invoice_id where invoice_id = p_new;
  update public.payment_schedules set invoice_id = v_old.invoice_id
    where invoice_id = p_new and coalesce(schedule_type, '') <> 'payable' and not (po_id is not null and so_id is null);
  update public.customer_credits set used_in_invoice_id = v_old.invoice_id where used_in_invoice_id = p_new;
  update public.accounts_receivable
    set collected_amount = round(coalesce(v_new.collected_amount, 0) + v_credit, 2), months_paid = coalesce(v_new.months_paid, 0), replaced_by_invoice_id = null
    where invoice_id = v_old.invoice_id;
  delete from public.invoice_delivery_permits where invoice_id = p_new;
  insert into public.invoice_delivery_permits (invoice_id, permit_id) select v_old.invoice_id, x from unnest(v_moved) as x;
  update public.delivery_permits set invoice_id = null where invoice_id = p_new;
  update public.delivery_permits set invoice_id = v_old.invoice_id where permit_id = any(v_moved);
  delete from public.accounts_receivable where invoice_id = p_new;
end
$fn$;

revoke execute on function public.eta_reissue_invoice(int, jsonb, int[], boolean) from public, anon, authenticated;
revoke execute on function public.eta_undo_reissue(int, int[]) from public, anon, authenticated;
grant execute on function public.eta_reissue_invoice(int, jsonb, int[], boolean) to service_role;
grant execute on function public.eta_undo_reissue(int, int[]) to service_role;
