-- Maintenance photo drafts (spec docs/superpowers/specs/2026-11-19-invoice-codes-and-maintenance-photos-design.md, Part 2).
-- The maintenance worker opens his personal link (/m/<secret>), takes a photo of a handwritten invoice, and the
-- accountant turns it into an MINV invoice from the Maintenance tab of Accounts Receivable.
-- Owner-approved 2026-11-19 ("Build part 2"). Additive only: two new tables, nothing existing is changed. Safe to run twice.
--
-- Only the SHA-256 hash of each link's secret is stored. Row level security is on with no policies: the tables are
-- reached only through the server routes (service role), never from the browser.

create table if not exists public.maintenance_upload_links (
  id bigserial primary key,
  worker_name text not null,
  secret_hash text not null unique,
  active boolean not null default true,
  created_by int,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.maintenance_photo_drafts (
  id bigserial primary key,
  link_id bigint not null references public.maintenance_upload_links(id),
  photo_path text not null,
  photo_type text not null,
  -- waiting: for the accountant; converting: an invoice is being made right now; converted / rejected: done
  status text not null default 'waiting' check (status in ('waiting', 'converting', 'converted', 'rejected')),
  -- the AI reading of the photo: reading -> done / failed (failed still shows the draft, with empty lines)
  read_status text not null default 'reading' check (read_status in ('reading', 'done', 'failed')),
  read_data jsonb,
  customer_id int,
  invoice_id int,
  invoice_number text,
  reject_reason text,
  reviewed_by int,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists maintenance_photo_drafts_status_idx on public.maintenance_photo_drafts (status, created_at desc);
create index if not exists maintenance_photo_drafts_link_idx on public.maintenance_photo_drafts (link_id, created_at desc);

alter table public.maintenance_upload_links enable row level security;
alter table public.maintenance_photo_drafts enable row level security;
