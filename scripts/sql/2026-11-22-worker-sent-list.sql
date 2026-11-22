-- WRITTEN, NOT APPLIED. Additive only (one new function, nothing dropped or changed).
-- Owner, 2026-11-22: a maintenance number cancelled BEFORE its invoice was made (spoiled page, rejected photo, cancelled
-- by the office, invoice not created) is free again: the next worker number is the lowest freed one, then the sequence
-- goes on. A number that was on a made invoice is never handed to a worker again.
--
-- take_maintenance_number(p_link_id) hands out the worker's number under the SAME lock as take_invoice_number
-- (scripts/sql/2026-11-21-shared-invoice-numbers.sql), so a freed number is taken exactly once, by a worker or by the
-- office. Until this is applied lib/shared-invoice-numbers.ts takeWorkerNumber claims a freed number with a guarded
-- update (status must still be 'released') and gets new numbers from take_invoice_number.
--
-- The worker's "sent" list on his link page needs no database change.

create or replace function public.take_maintenance_number(p_link_id bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_start bigint;
  v_next bigint;
begin
  perform pg_advisory_xact_lock(hashtext('invoice_number_slots'));

  select nullif(trim(setting_value), '')::bigint into v_start
    from company_settings where setting_key = 'shared_invoice_start';
  if v_start is null then
    return null;
  end if;

  -- His open reservation (no photo yet) comes back again.
  if p_link_id is not null then
    select number into v_next from invoice_number_slots
      where link_id = p_link_id and kind = 'maintenance' and status = 'reserved' and draft_id is null
      order by number limit 1;
    if found then
      return v_next;
    end if;
  end if;

  -- The lowest number freed before its invoice was made. Never one that was on an invoice ("invoice taken back", or
  -- an invoice row with that number, also a cancelled one), and, like sales reuse, never below a number already on the
  -- real tax portal.
  select s.number into v_next from invoice_number_slots s
    where s.status = 'released'
      and s.number >= v_start
      and coalesce(s.note, '') <> 'invoice taken back'
      and not exists (
        select 1 from accounts_receivable a
          where a.invoice_number = s.number::text or a.invoice_number like 'X%-' || s.number::text
      )
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
      set kind = 'maintenance', status = 'reserved', link_id = p_link_id, draft_id = null, invoice_id = null,
          note = 'reused', updated_at = now()
      where number = v_next;
    return v_next;
  end if;

  -- Nothing freed: the next new number (same lock; advisory locks are re-entrant in one transaction).
  return public.take_invoice_number('maintenance', p_link_id, false);
end;
$$;

revoke all on function public.take_maintenance_number(bigint) from public, anon, authenticated;
grant execute on function public.take_maintenance_number(bigint) to service_role;
