-- =====================================================================
-- Event POS — 009: cashiers see only their own sales; print stations are admin-only
--   * sales / sale_items: admins see all; a cashier sees only sales they made
--   * stock ledger: admins only
--   * only an admin login can run a print station (register it, claim and complete jobs).
--     Cashiers can still SEND print jobs to a station and read their status.
-- =====================================================================

drop policy if exists sales_select on public.sales;
create policy sales_select on public.sales for select to authenticated
  using ((select public.is_admin()) or (cashier_id = (select auth.uid()) and (select public.is_staff())));

drop policy if exists sale_items_select on public.sale_items;
create policy sale_items_select on public.sale_items for select to authenticated
  using (
    (select public.is_admin())
    or ((select public.is_staff()) and exists (
          select 1 from public.sales s where s.id = sale_items.sale_id and s.cashier_id = (select auth.uid())))
  );

drop policy if exists stock_movements_select on public.stock_movements;
create policy stock_movements_select on public.stock_movements for select to authenticated
  using ((select public.is_admin()));

-- print stations: admin only
drop policy if exists print_stations_insert on public.print_stations;
create policy print_stations_insert on public.print_stations for insert to authenticated
  with check ((select public.is_admin()));
drop policy if exists print_stations_update on public.print_stations;
create policy print_stations_update on public.print_stations for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- only the (admin) station updates job status
drop policy if exists print_jobs_update on public.print_jobs;
create policy print_jobs_update on public.print_jobs for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
