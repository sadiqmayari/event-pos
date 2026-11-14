-- =====================================================================
-- Event POS — generate fake sales for testing totals, reports and stock.
-- Run in Supabase SQL Editor AFTER the migrations and seed, and after at least one staff user exists.
--
-- Uses the real sale logic (process_sale), so stock, invoice numbers, the stock ledger and totals
-- behave exactly like real sales. Sales are spread over the last p_days days (today = last day),
-- between 10:00 and 21:00 in p_tz. Random discounts, cash/card/split payments, random cashiers.
--
-- To remove them again before the event, run supabase/reset_test_data.sql.
-- =====================================================================

create or replace function public.generate_fake_sales(
  p_count int default 50,
  p_days  int default 4,
  p_tz    text default 'Asia/Karachi'
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_made     int := 0;
  v_skipped  int := 0;
  v_cashiers uuid[];
  v_items    jsonb;
  v_n        int;
  v_prod     record;
  v_total    bigint;
  v_method   text;
  v_card     bigint;
  v_received bigint;
  v_day      date;
  v_at       timestamptz;
  v_sale     jsonb;
  v_bill_t   text;
  v_bill_v   numeric;
begin
  select array_agg(id) into v_cashiers from public.profiles where active;
  if v_cashiers is null then
    raise exception 'Create at least one staff user first (Authentication → Users).';
  end if;

  for i in 1 .. p_count loop
    v_items := '[]'::jsonb;
    v_total := 0;
    v_n := 1 + floor(random() * 4)::int;              -- 1..4 different products

    for v_prod in
      select id, price, least(stock_qty, 1 + floor(random() * 3)::int) as qty, random() < 0.1 as disc
        from public.products
       where active and stock_qty > 0
       order by random() limit v_n
    loop
      v_items := v_items || jsonb_build_object(
        'product_id', v_prod.id, 'qty', v_prod.qty,
        'discount_type', case when v_prod.disc then 'percent' end,
        'discount_value', case when v_prod.disc then 10 end);
      v_total := v_total + v_prod.price * v_prod.qty;
    end loop;

    if jsonb_array_length(v_items) = 0 then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- occasional bill discount
    v_bill_t := null; v_bill_v := null;
    if random() < 0.15 then
      if random() < 0.5 then v_bill_t := 'percent'; v_bill_v := 5;
      else v_bill_t := 'amount'; v_bill_v := 100; end if;
    end if;

    v_method := case when random() < 0.55 then 'cash' when random() < 0.8 then 'card' else 'split' end;
    v_card := case when v_method = 'split' then greatest(1, (v_total / 2 / 100) * 100) end;
    v_received := case when v_method = 'cash' then (ceil(v_total / 1000.0) * 1000)::bigint end; -- rounded-up note

    v_day := current_date - (p_days - 1) + floor(random() * p_days)::int;
    v_at := ((v_day + time '10:00') + random() * interval '11 hours') at time zone p_tz;

    begin
      v_sale := public.process_sale(jsonb_build_object(
        'id', gen_random_uuid(),
        'items', v_items,
        'bill_discount_type', v_bill_t, 'bill_discount_value', v_bill_v,
        'payment_method', v_method,
        'cash_received', v_received,          -- null = exact (split cash part / card)
        'card_amount', v_card,
        'card_ref', case when v_method <> 'cash' then lpad(floor(random() * 10000)::text, 4, '0') end,
        'device_id', 'fake-generator',
        'client_tz', p_tz,
        'offline', true                       -- use the item prices as given (no PRICE_CHANGED check)
      ), v_cashiers[1 + floor(random() * array_length(v_cashiers, 1))::int], v_at);
      v_made := v_made + 1;
    exception when others then
      -- e.g. a discount bigger than a cheap bill, or stock ran out mid-run: skip that one
      v_skipped := v_skipped + 1;
    end;
  end loop;

  return jsonb_build_object('created', v_made, 'skipped', v_skipped);
end $$;

revoke execute on function public.generate_fake_sales(int, int, text) from public, anon, authenticated;

-- Make 50 sales over the last 4 days:
select public.generate_fake_sales(50, 4);
