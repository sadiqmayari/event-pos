-- =====================================================================
-- Event POS — 002: Row Level Security + grants
-- Principle: anon gets nothing. Logged-in, active staff can read.
-- Only admins can change products/settings/staff. Stock, sales and voids
-- can ONLY change through security-definer functions (003+), so the
-- stock ledger and audit trail are always complete.
-- =====================================================================

-- ---------- role helpers (security definer → no RLS recursion) ----------
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active);
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and role = 'admin');
$$;

-- ---------- start from zero ----------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant usage on schema public to authenticated;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;

-- ---------- enable RLS everywhere ----------
alter table public.profiles        enable row level security;
alter table public.settings        enable row level security;
alter table public.products        enable row level security;
alter table public.invoice_counter enable row level security;
alter table public.sales           enable row level security;
alter table public.sale_items      enable row level security;
alter table public.stock_movements enable row level security;
alter table public.cash_counts     enable row level security;
alter table public.audit_log       enable row level security;

-- ---------- profiles ----------
grant select on public.profiles to authenticated;
grant update (full_name, role, active) on public.profiles to authenticated;

create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_staff()));
create policy profiles_update on public.profiles for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- settings ----------
grant select on public.settings to authenticated;
grant update (event_name, event_start_date, event_days, receipt_header, receipt_footer, opening_float)
  on public.settings to authenticated;

create policy settings_select on public.settings for select to authenticated
  using ((select public.is_staff()));
create policy settings_update on public.settings for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- ---------- products (stock_qty is deliberately NOT writable directly) ----------
grant select, delete on public.products to authenticated;
grant insert (name, sku, category, price, low_stock_threshold, active) on public.products to authenticated;
grant update (name, sku, category, price, low_stock_threshold, active) on public.products to authenticated;

create policy products_select on public.products for select to authenticated
  using ((select public.is_staff()));
create policy products_insert on public.products for insert to authenticated
  with check ((select public.is_admin()));
create policy products_update on public.products for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy products_delete on public.products for delete to authenticated
  using ((select public.is_admin()));

-- ---------- read-only for staff (writes only via functions) ----------
grant select on public.sales, public.sale_items, public.stock_movements to authenticated;

create policy sales_select on public.sales for select to authenticated
  using ((select public.is_staff()));
create policy sale_items_select on public.sale_items for select to authenticated
  using ((select public.is_staff()));
create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select public.is_staff()));

-- ---------- admin-only reads ----------
grant select on public.cash_counts, public.audit_log to authenticated;

create policy cash_counts_select on public.cash_counts for select to authenticated
  using ((select public.is_admin()));
create policy audit_log_select on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- invoice_counter: no grants, no policies → nobody but functions can touch it.

-- ---------- Realtime: live stock + live sales list on every device ----------
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'products') then
    alter publication supabase_realtime add table public.products;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sales') then
    alter publication supabase_realtime add table public.sales;
  end if;
end $$;
