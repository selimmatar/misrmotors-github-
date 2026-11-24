-- E-invoice: the optional parts of a receiver's portal address (postal code, floor, room, landmark, additional
-- information), kept when the address is copied from an earlier portal document ("Get address from the portal").
-- WRITTEN, NOT APPLIED (owner approval required). Additive only: new nullable columns, nothing dropped, renamed or
-- changed. Safe to run twice. Until it is applied the lookup fills the four required fields only.

alter table public.customers add column if not exists address_postal_code text;
alter table public.customers add column if not exists address_floor text;
alter table public.customers add column if not exists address_room text;
alter table public.customers add column if not exists address_landmark text;
alter table public.customers add column if not exists address_additional_info text;

alter table public.customer_tax_identities add column if not exists address_postal_code text;
alter table public.customer_tax_identities add column if not exists address_floor text;
alter table public.customer_tax_identities add column if not exists address_room text;
alter table public.customer_tax_identities add column if not exists address_landmark text;
alter table public.customer_tax_identities add column if not exists address_additional_info text;

-- the automatic lookup reads its one-day "not found" memory from workflow_events by event type and tax number
create index if not exists workflow_events_type_value_idx on public.workflow_events (event_type, new_value, performed_at);
