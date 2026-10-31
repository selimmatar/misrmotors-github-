-- Database lock-down (Row Level Security). WRITTEN, NOT APPLIED.
--
-- Apply ONLY after the owner has switched AUTH_MODE=on in Vercel and confirmed everyone can log in and work.
-- Never apply while AUTH_MODE=off or AUTH_MODE=test.
--
-- What it does, in plain words:
--   Today some tables have "open door" rules that let anyone holding the public (browser) key read or change rows.
--   The app itself never uses those doors: every screen goes through the app's server, which uses the private server
--   key and is not affected by these rules. This script removes every open-door rule in the public schema and turns
--   on the lock for the document-number counters table, which has no lock at all today.
--   After it runs, the public key can no longer read or change any business table directly.
--
-- Undo: the dropped rules are listed by the first query below; save its output before applying if you want to be able
-- to recreate them.

-- 1. (Run first, keep the output) The open-door rules that will be removed.
select schemaname, tablename, policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and roles && array['public', 'anon', 'authenticated']::name[]
order by tablename, policyname;

-- 2. Remove them and lock the counters table, all in one go.
begin;

do $$
declare
  p record;
begin
  for p in
    select tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and roles && array['public', 'anon', 'authenticated']::name[]
  loop
    execute format('drop policy if exists %I on public.%I', p.policyname, p.tablename);
  end loop;
end
$$;

alter table public.document_number_counters enable row level security;

commit;

-- 3. Check: must return 0 rows.
select schemaname, tablename, policyname, roles
from pg_policies
where schemaname = 'public'
  and roles && array['public', 'anon', 'authenticated']::name[];
