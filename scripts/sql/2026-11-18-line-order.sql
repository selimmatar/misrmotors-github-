-- The order of a sales order's lines, and "Quote addressed to" on quotations (owner reports 2026-11-17 / 18: quotation
-- lines showed up scattered at approval, the person wants to choose the line order by dragging, and a quotation can
-- be made out to another name than the customer's).
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: two new nullable columns, one index and one trigger;
-- the backfill only fills rows where the new column is still empty. Safe to run twice.
--
--   sales_order_items.line_order   1..n per sales order: the order the lines are shown and printed in (sales order
--                                  screens, sales order print, delivery permits, invoices). Existing rows are numbered
--                                  by so_item_id, which is the order they were entered in, so nothing moves.
--
--   sales_quotations.addressed_to  "Quote addressed to" (owner request 2026-11-18): optional name the quotation is
--                                  made out to (e.g. a branch or sub-brand of the customer), printed on the quotation
--                                  instead of the customer name. The customer stays the real customer for everything
--                                  else. Empty for every existing quotation (nothing changes for them).
--
-- Quotation lines need no new column: sales_quotation_items.line_no (NOT NULL since the table was created) already
-- holds 1..n and is rewritten from the form's order on every save.
--
-- Until this runs the app keeps working: lines are shown in so_item_id order (the order they were entered in) and a
-- new order chosen on an existing sales order is not saved (lib/line-order.ts hasLineOrderColumn); a "Quote addressed
-- to" name is not saved either and the customer name is printed (lib/quotations/addressed-to.ts).

alter table public.sales_quotations add column if not exists addressed_to text;

alter table public.sales_order_items add column if not exists line_order int;

-- Backfill: number the still-empty rows of each order after the ones already numbered, in so_item_id order.
with numbered as (
  select i.so_item_id,
         coalesce((select max(n.line_order) from public.sales_order_items n where n.so_id = i.so_id and n.line_order is not null), 0)
           + row_number() over (partition by i.so_id order by i.so_item_id) as pos
  from public.sales_order_items i
  where i.line_order is null
)
update public.sales_order_items s
   set line_order = numbered.pos
  from numbered
 where s.so_item_id = numbered.so_item_id
   and s.line_order is null;

create index if not exists sales_order_items_so_id_line_order_idx on public.sales_order_items (so_id, line_order);

-- A line inserted without a position (e.g. by an older code path) goes to the end of its order.
create or replace function public.sales_order_items_default_line_order()
returns trigger
language plpgsql
as $$
begin
  if new.line_order is null then
    select coalesce(max(line_order), 0) + 1 into new.line_order
      from public.sales_order_items
     where so_id = new.so_id;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_order_items_default_line_order on public.sales_order_items;
create trigger sales_order_items_default_line_order
  before insert on public.sales_order_items
  for each row execute function public.sales_order_items_default_line_order();
