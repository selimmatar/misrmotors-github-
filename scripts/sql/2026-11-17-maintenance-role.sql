-- WRITTEN, NOT APPLIED. Maintenance quick invoice (spec docs/superpowers/specs/2026-11-17-maintenance-quick-invoice-design.md).
-- Additive and safe to run more than once. Touches no amounts.
--
-- 1. The new login role 'maintenance' (owner-approved 2026-11-17): users.roles may hold it. Until this runs, saving an
--    account with the Maintenance role is refused by the database (users_roles_check).
-- 2. accounts_receivable.is_maintenance: the maintenance flag of a customer invoice (Accounts Receivable "Maintenance"
--    tab). The app works without it: work-order invoices (INV-MNT-...) and quick maintenance invoices (their sales order
--    has so_type 'MAINTENANCE_PARTS' and notes starting 'Maintenance quick invoice') are recognised anyway.

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'users_roles_check' and pg_get_constraintdef(oid) like '%maintenance%'
  ) then
    alter table public.users drop constraint if exists users_roles_check;
    alter table public.users add constraint users_roles_check
      check (roles <@ array['admin', 'ceo', 'accountant', 'sales-rep', 'po-rep', 'warehouse-rep', 'shipment', 'maintenance']::text[]);
  end if;
end $$;

alter table public.accounts_receivable add column if not exists is_maintenance boolean not null default false;

-- Existing maintenance invoices: the work-order ones and any quick ones made before this ran.
update public.accounts_receivable ar
set is_maintenance = true
where ar.is_maintenance = false
  and (
    ar.invoice_number like 'INV-MNT-%'
    or exists (
      select 1 from public.sales_orders so
      where so.so_id = ar.so_id and so.so_type = 'MAINTENANCE_PARTS' and so.notes like 'Maintenance quick invoice%'
    )
  );
