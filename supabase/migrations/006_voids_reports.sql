-- =====================================================================
-- Event POS — 006: voids, reports, end-of-day cash count (admin only)
-- Report functions take a timezone so "a day" means the viewer's local day.
-- =====================================================================

-- ---------- void / refund a whole invoice ----------
create or replace function public.void_sale(p_sale_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_sale public.sales;
  v_name text;
  r      record;
  v_qty  int;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only admins can void sales' using errcode = '42501';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: please give a reason for the void';
  end if;

  select * into v_sale from public.sales where id = p_sale_id for update;
  if not found then raise exception 'SALE_NOT_FOUND: sale does not exist'; end if;
  if v_sale.status = 'voided' then raise exception 'ALREADY_VOIDED: invoice #% is already voided', v_sale.invoice_no; end if;

  select full_name into v_name from public.profiles where id = auth.uid();

  -- put the stock back (lock products in a fixed order)
  perform 1 from public.products
   where id in (select product_id from public.sale_items where sale_id = p_sale_id) order by id for update;
  for r in select product_id, sum(qty)::int as qty from public.sale_items
            where sale_id = p_sale_id group by product_id order by product_id loop
    update public.products set stock_qty = stock_qty + r.qty where id = r.product_id returning stock_qty into v_qty;
    insert into public.stock_movements (product_id, delta, qty_after, type, reason, sale_id, user_id)
    values (r.product_id, r.qty, v_qty, 'void', 'Void of invoice #' || v_sale.invoice_no || ': ' || trim(p_reason), p_sale_id, auth.uid());
  end loop;

  update public.sales
     set status = 'voided', voided_at = now(), voided_by = auth.uid(), voided_by_name = v_name, void_reason = trim(p_reason)
   where id = p_sale_id;

  perform public.write_audit('sale.void', 'sale', p_sale_id::text,
    jsonb_build_object('invoice_no', v_sale.invoice_no, 'total', v_sale.total, 'reason', trim(p_reason)));

  return public.sale_json(p_sale_id);
end $$;

-- ---------- per-day totals ----------
create or replace function public.daily_summary(p_from date, p_to date, p_tz text)
returns table (
  day date, invoices int, items int, gross bigint, discounts bigint, total bigint,
  cash bigint, card bigint, voided_invoices int, voided_total bigint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED: admins only' using errcode = '42501'; end if;
  return query
  with d as (select generate_series(p_from, p_to, interval '1 day')::date as day),
  s as (
    select (created_at at time zone p_tz)::date as day, *
      from public.sales
     where created_at >= (p_from::timestamp at time zone p_tz)
       and created_at <  ((p_to + 1)::timestamp at time zone p_tz)
  )
  select d.day,
         count(s.id) filter (where s.status = 'completed')::int,
         coalesce(sum(s.items_count) filter (where s.status = 'completed'), 0)::int,
         coalesce(sum(s.subtotal) filter (where s.status = 'completed'), 0)::bigint,
         coalesce(sum(s.line_discount_total + s.bill_discount_amount) filter (where s.status = 'completed'), 0)::bigint,
         coalesce(sum(s.total) filter (where s.status = 'completed'), 0)::bigint,
         coalesce(sum(s.cash_amount) filter (where s.status = 'completed'), 0)::bigint,
         coalesce(sum(s.card_amount) filter (where s.status = 'completed'), 0)::bigint,
         count(s.id) filter (where s.status = 'voided')::int,
         coalesce(sum(s.total) filter (where s.status = 'voided'), 0)::bigint
    from d left join s on s.day = d.day
   group by d.day
   order by d.day;
end $$;

-- ---------- best sellers ----------
create or replace function public.top_products(p_from date, p_to date, p_tz text, p_limit int default 10)
returns table (product_id uuid, name text, category text, qty int, revenue bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED: admins only' using errcode = '42501'; end if;
  return query
  select i.product_id, max(i.name), max(i.category), sum(i.qty)::int, sum(i.line_total)::bigint
    from public.sale_items i join public.sales s on s.id = i.sale_id
   where s.status = 'completed'
     and s.created_at >= (p_from::timestamp at time zone p_tz)
     and s.created_at <  ((p_to + 1)::timestamp at time zone p_tz)
   group by i.product_id
   order by 4 desc, 5 desc
   limit p_limit;
end $$;

-- ---------- end-of-day cash ----------
-- Cash that should be in the drawer: opening float + cash taken (cash_amount is already net of change).
create or replace function public.expected_cash(p_day date, p_tz text)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_float bigint;
  v_cash  bigint;
  v_n     int;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED: admins only' using errcode = '42501'; end if;
  select opening_float into v_float from public.settings where id = 1;
  select coalesce(sum(cash_amount), 0), count(*) filter (where cash_amount > 0) into v_cash, v_n
    from public.sales
   where status = 'completed'
     and created_at >= (p_day::timestamp at time zone p_tz)
     and created_at <  ((p_day + 1)::timestamp at time zone p_tz);
  return jsonb_build_object('day', p_day, 'opening_float', v_float, 'cash_sales', v_cash,
                            'cash_invoices', v_n, 'expected', v_float + v_cash);
end $$;

create or replace function public.record_cash_count(p_day date, p_tz text, p_counted bigint, p_notes text default null)
returns public.cash_counts
language plpgsql security definer set search_path = '' as $$
declare
  v_exp jsonb;
  v_row public.cash_counts;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED: admins only' using errcode = '42501'; end if;
  if p_counted is null or p_counted < 0 then raise exception 'INVALID_INPUT: counted cash must be 0 or more'; end if;
  v_exp := public.expected_cash(p_day, p_tz);
  insert into public.cash_counts (day, tz, opening_float, expected_cash, counted_cash, notes, counted_by, counted_by_name)
  values (p_day, p_tz, (v_exp ->> 'opening_float')::bigint, (v_exp ->> 'expected')::bigint, p_counted,
          nullif(trim(p_notes), ''), auth.uid(), (select full_name from public.profiles where id = auth.uid()))
  returning * into v_row;
  perform public.write_audit('cash.count', 'cash_count', v_row.id::text,
    jsonb_build_object('day', p_day, 'expected', v_row.expected_cash, 'counted', p_counted, 'difference', v_row.difference));
  return v_row;
end $$;

-- the admin can set the event's first day from Settings
grant update (event_start_date, event_days) on public.settings to authenticated;

revoke execute on function public.void_sale(uuid, text) from public, anon;
revoke execute on function public.daily_summary(date, date, text) from public, anon;
revoke execute on function public.top_products(date, date, text, int) from public, anon;
revoke execute on function public.expected_cash(date, text) from public, anon;
revoke execute on function public.record_cash_count(date, text, bigint, text) from public, anon;
grant execute on function public.void_sale(uuid, text) to authenticated;
grant execute on function public.daily_summary(date, date, text) to authenticated;
grant execute on function public.top_products(date, date, text, int) to authenticated;
grant execute on function public.expected_cash(date, text) to authenticated;
grant execute on function public.record_cash_count(date, text, bigint, text) to authenticated;
