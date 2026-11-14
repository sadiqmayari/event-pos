-- =====================================================================
-- Event POS — wipe ALL sales and put the sold stock back.
-- ⚠ Run this only BEFORE the event to clear test sales. It cannot be undone.
--   Products and staff are kept. Invoice numbers restart at 1.
-- =====================================================================

begin;

-- give back stock for completed (not voided) sales — voids already restored theirs
update public.products p
   set stock_qty = p.stock_qty + s.qty
  from (select i.product_id, sum(i.qty) as qty
          from public.sale_items i join public.sales sa on sa.id = i.sale_id
         where sa.status = 'completed'
         group by i.product_id) s
 where p.id = s.product_id;

delete from public.stock_movements where type in ('sale', 'void');
delete from public.sale_items;
delete from public.sales;
delete from public.cash_counts;
update public.invoice_counter set last_no = 0 where id = 1;

insert into public.audit_log (action, entity, details)
values ('test_data.reset', 'sales', jsonb_build_object('at', now()));

commit;
