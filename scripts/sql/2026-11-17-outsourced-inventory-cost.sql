-- Outsourced items stored in a warehouse: give the existing rows their real cost (one-time backfill).
-- WRITTEN, NOT APPLIED (owner approval required). Changes only inventory.unit_cost, only on rows where
-- is_outsourced = true and unit_cost = 0 (rows stored by lib/goods-receiving.ts storeOutsourced before 2026-11-17,
-- which always wrote 0). New receipts and later cost finalizations set the cost in the app. Safe to run twice:
-- an updated row no longer has unit_cost = 0.
--
-- Match: inventory.so_number = sales_orders.so_number of purchase_order_items.source_so_id, and
-- trim(inventory.outsourced_name) = trim(purchase_order_items.outsourced_name) on an outsourced PO line.
-- Cost per unit: the PO line's landed cost (landed_cost / quantity) when its PO's cost is finalized, else unit_price.
-- A row whose candidate PO lines give more than one distinct cost is ambiguous and is NOT updated.

-- 1. Review first: every candidate row with its matched cost(s). ambiguous = true rows are skipped by step 2.
with candidates as (
  select i.inventory_id,
         i.so_number,
         trim(i.outsourced_name) as outsourced_name,
         i.quantity,
         poi.po_item_id,
         po.po_number,
         coalesce(po.cost_finalized, false) as cost_finalized,
         round(
           case when coalesce(po.cost_finalized, false) and coalesce(poi.landed_cost, 0) > 0 and coalesce(poi.quantity, 0) > 0
                then poi.landed_cost / poi.quantity
                else coalesce(poi.unit_price, 0) end, 2) as cost
  from public.inventory i
  join public.sales_orders so on so.so_number = i.so_number
  join public.purchase_order_items poi
    on poi.source_so_id = so.so_id
   and poi.item_type = 'outsourced'
   and trim(poi.outsourced_name) = trim(i.outsourced_name)
  join public.purchase_orders po on po.po_id = poi.po_id
  where i.is_outsourced = true
    and i.unit_cost = 0
)
select inventory_id, so_number, outsourced_name, quantity,
       count(distinct cost) > 1 as ambiguous,
       array_agg(distinct cost order by cost) as costs,
       string_agg(distinct po_number || ' line ' || po_item_id, ', ') as po_lines
from candidates
group by inventory_id, so_number, outsourced_name, quantity
order by ambiguous desc, so_number, inventory_id;

-- 2. The backfill: only rows with exactly one distinct cost.
begin;

with candidates as (
  select i.inventory_id,
         round(
           case when coalesce(po.cost_finalized, false) and coalesce(poi.landed_cost, 0) > 0 and coalesce(poi.quantity, 0) > 0
                then poi.landed_cost / poi.quantity
                else coalesce(poi.unit_price, 0) end, 2) as cost
  from public.inventory i
  join public.sales_orders so on so.so_number = i.so_number
  join public.purchase_order_items poi
    on poi.source_so_id = so.so_id
   and poi.item_type = 'outsourced'
   and trim(poi.outsourced_name) = trim(i.outsourced_name)
  join public.purchase_orders po on po.po_id = poi.po_id
  where i.is_outsourced = true
    and i.unit_cost = 0
),
resolved as (
  select inventory_id, min(cost) as cost
  from candidates
  group by inventory_id
  having count(distinct cost) = 1
)
update public.inventory i
   set unit_cost = r.cost
  from resolved r
 where i.inventory_id = r.inventory_id
   and i.is_outsourced = true
   and i.unit_cost = 0
   and r.cost > 0;

commit;
