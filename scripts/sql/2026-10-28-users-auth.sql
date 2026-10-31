-- Logins (security plan Task 1). Adds login fields to the empty users table and a server-only audit table.
-- Safe to run more than once. Touches no financial data.

alter table public.users add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;
alter table public.users add column if not exists username text unique;
alter table public.users add column if not exists phone text unique;
alter table public.users add column if not exists login_method text not null default 'email';
alter table public.users add column if not exists roles text[] not null default '{}';
alter table public.users add column if not exists employee_id int references public.hr_employees(employee_id) on delete set null;
alter table public.users add column if not exists must_change_password boolean not null default false;
alter table public.users add column if not exists last_login_at timestamptz;
alter table public.users alter column password_hash drop not null;
alter table public.users alter column role drop not null; -- the old single role; new accounts use roles[]

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'users_login_method_check') then
    alter table public.users add constraint users_login_method_check check (login_method in ('email', 'username', 'phone'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_roles_check') then
    alter table public.users add constraint users_roles_check
      check (roles <@ array['admin', 'ceo', 'accountant', 'sales-rep', 'po-rep', 'warehouse-rep', 'shipment']::text[]);
  end if;
end $$;

create table if not exists public.auth_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  mode text,
  decision text,
  path text,
  method text,
  user_id int,
  roles text,
  reason text
);
alter table public.auth_audit enable row level security; -- no policies: only the server (service key) reads or writes it
