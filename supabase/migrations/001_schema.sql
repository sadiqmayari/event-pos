-- =====================================================================
-- Event POS — 001: schema
-- Run in Supabase → SQL Editor (in order: 001, 002, 003, ...).
-- Money is stored as whole rupees (bigint). Timestamps are timestamptz.
-- =====================================================================

-- ---------- enums ----------
create type public.user_role as enum ('cashier', 'admin');
create type public.stock_movement_type as enum ('initial', 'import', 'adjustment', 'sale', 'void');
create type public.payment_method as enum ('cash', 'card', 'split');
create type public.sale_status as enum ('completed', 'voided');
create type public.discount_type as enum ('amount', 'percent');

-- ---------- staff ----------
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        public.user_role not null default 'cashier',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- event settings (single row) ----------
create table public.settings (
  id                int primary key default 1 check (id = 1),
  event_name        text not null default 'Event Sale',
  event_start_date  date,
  event_days        int not null default 4 check (event_days between 1 and 31),
  receipt_header    text not null default '',
  receipt_footer    text not null default 'Thank you for shopping with us!',
  opening_float     bigint not null default 0 check (opening_float >= 0),
  updated_at        timestamptz not null default now()
);
insert into public.settings (id) values (1);

-- ---------- products ----------
create table public.products (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null check (length(trim(name)) > 0),
  sku                  text unique check (sku is null or length(trim(sku)) > 0),
  category             text not null default 'General',
  price                bigint not null check (price >= 0),
  stock_qty            int not null default 0 check (stock_qty >= 0),
  low_stock_threshold  int not null default 5 check (low_stock_threshold >= 0),
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index products_category_idx on public.products (category);
create index products_name_idx on public.products (lower(name));

-- ---------- invoice counter (gapless; locked inside create_sale) ----------
create table public.invoice_counter (
  id       int primary key default 1 check (id = 1),
  last_no  bigint not null default 0
);
insert into public.invoice_counter (id) values (1);

-- ---------- sales ----------
create table public.sales (
  id                    uuid primary key,             -- generated on the device → idempotent retries
  invoice_no            bigint not null unique,
  temp_no               text,                         -- provisional number if made offline
  device_id             text,
  created_at            timestamptz not null default now(),
  client_created_at     timestamptz,
  client_tz             text,
  cashier_id            uuid not null references public.profiles (id),
  cashier_name          text not null,
  subtotal              bigint not null check (subtotal >= 0),
  line_discount_total   bigint not null default 0 check (line_discount_total >= 0),
  bill_discount_type    public.discount_type,
  bill_discount_value   numeric(12, 2),
  bill_discount_amount  bigint not null default 0 check (bill_discount_amount >= 0),
  total                 bigint not null check (total >= 0),
  payment_method        public.payment_method not null,
  cash_amount           bigint not null default 0 check (cash_amount >= 0),
  card_amount           bigint not null default 0 check (card_amount >= 0),
  cash_received         bigint,
  change_due            bigint not null default 0 check (change_due >= 0),
  card_ref              text,
  items_count           int not null default 0,
  status                public.sale_status not null default 'completed',
  voided_at             timestamptz,
  voided_by             uuid references public.profiles (id),
  voided_by_name        text,
  void_reason           text,
  synced_from_offline   boolean not null default false
);
create index sales_created_at_idx on public.sales (created_at desc);
create index sales_cashier_idx on public.sales (cashier_id);
create index sales_status_idx on public.sales (status);

create table public.sale_items (
  id               bigint generated always as identity primary key,
  sale_id          uuid not null references public.sales (id) on delete cascade,
  product_id       uuid not null references public.products (id) on delete restrict,
  name             text not null,
  sku              text,
  category         text,
  unit_price       bigint not null check (unit_price >= 0),
  qty              int not null check (qty > 0),
  discount_type    public.discount_type,
  discount_value   numeric(12, 2),
  discount_amount  bigint not null default 0 check (discount_amount >= 0),
  line_total       bigint not null check (line_total >= 0)
);
create index sale_items_sale_idx on public.sale_items (sale_id);
create index sale_items_product_idx on public.sale_items (product_id);

-- ---------- stock ledger: every stock change is a row here ----------
create table public.stock_movements (
  id          bigint generated always as identity primary key,
  product_id  uuid not null references public.products (id) on delete cascade,
  delta       int not null,
  qty_after   int not null,
  type        public.stock_movement_type not null,
  reason      text,
  sale_id     uuid references public.sales (id) on delete set null,
  user_id     uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);
create index stock_movements_product_idx on public.stock_movements (product_id, created_at desc);

-- ---------- end-of-day cash reconciliation ----------
create table public.cash_counts (
  id               bigint generated always as identity primary key,
  day              date not null,
  tz               text not null,
  opening_float    bigint not null default 0,
  expected_cash    bigint not null,
  counted_cash     bigint not null check (counted_cash >= 0),
  difference       bigint generated always as (counted_cash - expected_cash) stored,
  notes            text,
  counted_by       uuid references public.profiles (id),
  counted_by_name  text,
  created_at       timestamptz not null default now()
);

-- ---------- audit trail ----------
create table public.audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid,
  actor_name  text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index audit_log_created_idx on public.audit_log (created_at desc);

-- =====================================================================
-- Triggers
-- =====================================================================

-- updated_at
create or replace function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger products_touch before update on public.products
  for each row execute function public.touch_updated_at();
create trigger settings_touch before update on public.settings
  for each row execute function public.touch_updated_at();

-- create a profile automatically for every new auth user (default role: cashier)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill profiles for users that already exist
insert into public.profiles (id, email, full_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

-- write an audit row (used by triggers and functions)
create or replace function public.write_audit(p_action text, p_entity text, p_entity_id text, p_details jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_name text;
begin
  select full_name into v_name from public.profiles where id = auth.uid();
  insert into public.audit_log (actor_id, actor_name, action, entity, entity_id, details)
  values (auth.uid(), v_name, p_action, p_entity, p_entity_id, p_details);
end $$;

-- audit product create / edit / delete (stock-only changes are in stock_movements instead)
create or replace function public.audit_products() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.write_audit('product.create', 'product', new.id::text, to_jsonb(new));
    return new;
  elsif tg_op = 'UPDATE' then
    if (to_jsonb(old) - 'stock_qty' - 'updated_at') is distinct from (to_jsonb(new) - 'stock_qty' - 'updated_at') then
      perform public.write_audit('product.update', 'product', new.id::text,
        jsonb_build_object('old', to_jsonb(old) - 'updated_at', 'new', to_jsonb(new) - 'updated_at'));
    end if;
    return new;
  else
    perform public.write_audit('product.delete', 'product', old.id::text, to_jsonb(old));
    return old;
  end if;
end $$;

create trigger products_audit after insert or update or delete on public.products
  for each row execute function public.audit_products();

-- protect staff roles: never remove the last active admin; audit role/active changes
create or replace function public.guard_profiles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.role = 'admin' and old.active and (new.role <> 'admin' or not new.active) then
    if not exists (select 1 from public.profiles
                   where role = 'admin' and active and id <> old.id) then
      raise exception 'LAST_ADMIN: cannot remove the last active admin';
    end if;
  end if;
  if new.role is distinct from old.role or new.active is distinct from old.active then
    perform public.write_audit('staff.update', 'profile', new.id::text,
      jsonb_build_object('email', new.email,
                         'old', jsonb_build_object('role', old.role, 'active', old.active),
                         'new', jsonb_build_object('role', new.role, 'active', new.active)));
  end if;
  return new;
end $$;

create trigger profiles_guard before update on public.profiles
  for each row execute function public.guard_profiles();
