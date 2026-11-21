-- One invoice number sequence shared by sales invoices (made in the system) and maintenance invoices (pre-printed
-- carbon booklet, photo upload). Owner, 2026-11-21. Every number handed out has one row here.
--   kind:   sales | maintenance
--   status: reserved (a worker holds it, or a sales invoice is being made)
--           used     (on an invoice)
--           released (spoiled or cancelled before the portal: the next sales invoice may take it)
-- The starting number is company_settings.shared_invoice_start; until it is set the old INV/MINV numbering stays.

create table if not exists public.invoice_number_slots (
  number bigint primary key,
  kind text not null check (kind in ('sales', 'maintenance')),
  status text not null check (status in ('reserved', 'used', 'released')),
  link_id bigint references public.maintenance_upload_links(id),
  draft_id bigint,
  invoice_id integer,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.invoice_number_slots enable row level security;
create index if not exists invoice_number_slots_link_idx on public.invoice_number_slots (link_id, status);

-- Hands out a number under one lock, so the office and a worker can never get the same one.
--   p_kind 'maintenance' + p_link_id: the worker's open reservation (no photo yet) is returned again if he has one.
--   p_reuse: a sales invoice takes the lowest released number first, but only when no higher number is already on the
--            real tax portal (the portal order must keep rising).
-- Returns null when the starting number is not set.
create or replace function public.take_invoice_number(p_kind text, p_link_id bigint, p_reuse boolean)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start bigint;
  v_next bigint;
  v_max_ar bigint;
begin
  perform pg_advisory_xact_lock(hashtext('invoice_number_slots'));

  select nullif(trim(setting_value), '')::bigint into v_start
    from company_settings where setting_key = 'shared_invoice_start';
  if v_start is null then
    return null;
  end if;

  if p_kind = 'maintenance' and p_link_id is not null then
    select number into v_next from invoice_number_slots
      where link_id = p_link_id and kind = 'maintenance' and status = 'reserved' and draft_id is null
      order by number limit 1;
    if found then
      return v_next;
    end if;
  end if;

  if p_reuse then
    select s.number into v_next from invoice_number_slots s
      where s.status = 'released'
        and s.number >= v_start
        and not exists (
          select 1 from invoice_number_slots h
            join eta_documents d on d.invoice_id = h.invoice_id
            where h.number > s.number
              and coalesce(d.environment, 'real') = 'real'
              and (d.document_type = 'C' or d.status not in ('needs_review', 'invalid'))
        )
      order by s.number limit 1;
    if found then
      update invoice_number_slots
        set kind = p_kind, status = 'reserved', link_id = p_link_id, draft_id = null, invoice_id = null,
            note = 'reused', updated_at = now()
        where number = v_next;
      return v_next;
    end if;
  end if;

  select max(invoice_number::bigint) into v_max_ar from accounts_receivable
    where invoice_number ~ '^[0-9]{1,15}$';
  select greatest(v_start, coalesce(max(number) + 1, v_start), coalesce(v_max_ar + 1, v_start))
    into v_next from invoice_number_slots;

  insert into invoice_number_slots (number, kind, status, link_id) values (v_next, p_kind, 'reserved', p_link_id);
  return v_next;
end;
$$;

revoke all on function public.take_invoice_number(text, bigint, boolean) from public, anon, authenticated;
grant execute on function public.take_invoice_number(text, bigint, boolean) to service_role;
