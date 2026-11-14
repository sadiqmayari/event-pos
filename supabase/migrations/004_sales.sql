-- =====================================================================
-- Event POS — 004: atomic sale processing
--
-- create_sale(p jsonb) is the ONLY way a sale is recorded. In one transaction it:
--   1. de-duplicates retries (the device generates the sale id → idempotent)
--   2. locks every product row in the cart (fixed order → no deadlocks)
--   3. blocks the sale if any line has insufficient stock
--   4. recomputes all money server-side (prices, discounts, change)
--   5. takes the next gapless invoice number
--   6. writes sale + items, decrements stock, writes the stock ledger
--
-- Two tills selling the last unit at the same moment: the second transaction
-- waits on the row lock, then sees stock 0 and gets INSUFFICIENT_STOCK.
--
-- Input:
-- {
--   "id": uuid, "device_id": text, "temp_no": text, "client_created_at": iso, "client_tz": text,
--   "offline": bool,                       -- true when synced from the offline queue
--   "items": [{ "product_id": uuid, "qty": int, "unit_price": int,
--               "discount_type": "amount"|"percent"|null, "discount_value": number|null }],
--   "bill_discount_type": "amount"|"percent"|null, "bill_discount_value": number|null,
--   "payment_method": "cash"|"card"|"split",
--   "cash_received": int|null, "card_amount": int|null, "card_ref": text|null
-- }
-- Errors (message 'CODE: text', JSON in DETAIL where useful):
--   NOT_AUTHORIZED, EMPTY_CART, INVALID_INPUT, PRODUCT_NOT_FOUND, PRODUCT_INACTIVE,
--   INSUFFICIENT_STOCK (detail: [{product_id,name,requested,available}]),
--   PRICE_CHANGED (detail: [{product_id,name,old_price,new_price}]),
--   INVALID_DISCOUNT, INSUFFICIENT_PAYMENT
-- =====================================================================

-- Money helper: discount amount for a base, never more than the base.
create or replace function public.calc_discount(p_base bigint, p_type text, p_value numeric)
returns bigint language plpgsql immutable set search_path = '' as $$
declare v bigint;
begin
  if p_type is null or p_value is null or p_value = 0 then return 0; end if;
  if p_value < 0 then raise exception 'INVALID_DISCOUNT: discount cannot be negative'; end if;
  if p_type = 'percent' then
    if p_value > 100 then raise exception 'INVALID_DISCOUNT: percent discount cannot exceed 100%%'; end if;
    v := round(p_base * p_value / 100.0);
  elsif p_type = 'amount' then
    v := round(p_value);
  else
    raise exception 'INVALID_DISCOUNT: unknown discount type %', p_type;
  end if;
  if v > p_base then
    raise exception 'INVALID_DISCOUNT: discount (Rs %) is more than the amount (Rs %)', v, p_base;
  end if;
  return v;
end $$;

-- Core logic. Not callable by clients directly (no grant) — used by create_sale and the fake-sales generator.
create or replace function public.process_sale(p jsonb, p_cashier uuid, p_created_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_id            uuid;
  v_offline       boolean := coalesce((p ->> 'offline')::boolean, false);
  v_cashier_name  text;
  v_item          jsonb;
  v_prod          public.products;
  v_qty           int;
  v_price         bigint;
  v_gross         bigint;
  v_disc          bigint;
  v_subtotal      bigint := 0;
  v_line_disc     bigint := 0;
  v_bill_type     text := nullif(p ->> 'bill_discount_type', '');
  v_bill_value    numeric := nullif(p ->> 'bill_discount_value', '')::numeric;
  v_bill_disc     bigint;
  v_total         bigint;
  v_method        text := p ->> 'payment_method';
  v_cash_received bigint := nullif(p ->> 'cash_received', '')::numeric;
  v_card          bigint := coalesce(nullif(p ->> 'card_amount', '')::numeric, 0);
  v_cash          bigint;
  v_change        bigint := 0;
  v_invoice       bigint;
  v_items_count   int := 0;
  v_short         jsonb := '[]'::jsonb;
  v_changed       jsonb := '[]'::jsonb;
  v_lines         jsonb := '[]'::jsonb;
  v_req           jsonb;
  v_line          jsonb;
  r               record;
begin
  -- ---------- validate envelope ----------
  begin
    v_id := (p ->> 'id')::uuid;
  exception when others then
    raise exception 'INVALID_INPUT: sale id must be a uuid';
  end;
  if v_id is null then raise exception 'INVALID_INPUT: sale id is required'; end if;

  -- serialize concurrent retries of the same sale, then return it if already saved
  perform pg_advisory_xact_lock(hashtextextended(v_id::text, 0));
  if exists (select 1 from public.sales where id = v_id) then
    return public.sale_json(v_id);
  end if;

  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_array_length(p -> 'items') = 0 then
    raise exception 'EMPTY_CART: the cart is empty';
  end if;
  if v_method is null or v_method not in ('cash', 'card', 'split') then
    raise exception 'INVALID_INPUT: payment method must be cash, card or split';
  end if;

  select full_name into v_cashier_name from public.profiles where id = p_cashier;
  if v_cashier_name is null then raise exception 'NOT_AUTHORIZED: unknown cashier'; end if;

  -- ---------- aggregate requested qty per product ----------
  for v_item in select value from jsonb_array_elements(p -> 'items') loop
    begin
      v_qty := (v_item ->> 'qty')::int;
      perform (v_item ->> 'product_id')::uuid;
    exception when others then
      raise exception 'INVALID_INPUT: each item needs a product id and a whole-number quantity';
    end;
    if v_qty is null or v_qty <= 0 then raise exception 'INVALID_INPUT: quantity must be at least 1'; end if;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id', pid, 'qty', qty) order by pid) into v_req
    from (select (x ->> 'product_id')::uuid as pid, sum((x ->> 'qty')::int)::int as qty
            from jsonb_array_elements(p -> 'items') x group by 1) t;

  -- ---------- lock product rows in a fixed order ----------
  perform 1 from public.products where id in (select product_id from jsonb_to_recordset(v_req) as t(product_id uuid, qty int))
   order by id for update;

  for r in select q.product_id, q.qty, pr.id as found, pr.name, pr.stock_qty, pr.active
             from jsonb_to_recordset(v_req) as q(product_id uuid, qty int)
             left join public.products pr on pr.id = q.product_id loop
    if r.found is null then
      raise exception 'PRODUCT_NOT_FOUND: a product in the cart no longer exists';
    end if;
    if not r.active and not v_offline then
      raise exception 'PRODUCT_INACTIVE: "%" is no longer for sale', r.name;
    end if;
    if r.stock_qty < r.qty then
      v_short := v_short || jsonb_build_object('product_id', r.product_id, 'name', r.name,
                                               'requested', r.qty, 'available', r.stock_qty);
    end if;
  end loop;

  if jsonb_array_length(v_short) > 0 then
    raise exception 'INSUFFICIENT_STOCK: not enough stock for %',
      (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(v_short) x)
      using detail = v_short::text;
  end if;

  -- ---------- price every line ----------
  for v_item in select value from jsonb_array_elements(p -> 'items') loop
    select * into v_prod from public.products where id = (v_item ->> 'product_id')::uuid;
    v_qty := (v_item ->> 'qty')::int;

    if v_offline then
      -- offline sale: the customer already paid the price shown at the time
      v_price := coalesce(nullif(v_item ->> 'unit_price', '')::numeric, v_prod.price);
    else
      v_price := v_prod.price;
      if v_item ? 'unit_price' and (v_item ->> 'unit_price')::numeric <> v_prod.price then
        v_changed := v_changed || jsonb_build_object('product_id', v_prod.id, 'name', v_prod.name,
                                                     'old_price', (v_item ->> 'unit_price')::numeric,
                                                     'new_price', v_prod.price);
      end if;
    end if;
    if v_price < 0 then raise exception 'INVALID_INPUT: price cannot be negative'; end if;

    v_gross := v_price * v_qty;
    v_disc := public.calc_discount(v_gross, nullif(v_item ->> 'discount_type', ''),
                                   nullif(v_item ->> 'discount_value', '')::numeric);
    v_subtotal := v_subtotal + (v_gross - v_disc);
    v_line_disc := v_line_disc + v_disc;
    v_items_count := v_items_count + v_qty;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'name', v_prod.name, 'sku', v_prod.sku, 'category', v_prod.category,
      'unit_price', v_price, 'qty', v_qty,
      'discount_type', nullif(v_item ->> 'discount_type', ''),
      'discount_value', nullif(v_item ->> 'discount_value', '')::numeric,
      'discount_amount', v_disc, 'line_total', v_gross - v_disc);
  end loop;

  if jsonb_array_length(v_changed) > 0 then
    raise exception 'PRICE_CHANGED: price changed for %',
      (select string_agg(x ->> 'name', ', ') from jsonb_array_elements(v_changed) x)
      using detail = v_changed::text;
  end if;

  v_bill_disc := public.calc_discount(v_subtotal, v_bill_type, v_bill_value);
  v_total := v_subtotal - v_bill_disc;

  -- ---------- payment ----------
  if v_method = 'cash' then
    v_card := 0;
    v_cash := v_total;
    if v_cash_received is null then v_cash_received := v_total; end if;
    if v_cash_received < v_cash then
      raise exception 'INSUFFICIENT_PAYMENT: cash received (Rs %) is less than the total (Rs %)', v_cash_received, v_total;
    end if;
    v_change := v_cash_received - v_cash;
  elsif v_method = 'card' then
    v_card := v_total;
    v_cash := 0;
    v_cash_received := null;
  else -- split
    if v_card <= 0 or v_card >= v_total then
      raise exception 'INSUFFICIENT_PAYMENT: card amount for a split payment must be between Rs 1 and Rs %', greatest(v_total - 1, 0);
    end if;
    v_cash := v_total - v_card;
    if v_cash_received is null then v_cash_received := v_cash; end if;
    if v_cash_received < v_cash then
      raise exception 'INSUFFICIENT_PAYMENT: cash received (Rs %) is less than the cash part (Rs %)', v_cash_received, v_cash;
    end if;
    v_change := v_cash_received - v_cash;
  end if;

  -- ---------- invoice number (gapless: row lock until commit) ----------
  update public.invoice_counter set last_no = last_no + 1 where id = 1 returning last_no into v_invoice;

  insert into public.sales (
    id, invoice_no, temp_no, device_id, created_at, client_created_at, client_tz,
    cashier_id, cashier_name, subtotal, line_discount_total,
    bill_discount_type, bill_discount_value, bill_discount_amount, total,
    payment_method, cash_amount, card_amount, cash_received, change_due, card_ref,
    items_count, synced_from_offline
  ) values (
    v_id, v_invoice, nullif(p ->> 'temp_no', ''), nullif(p ->> 'device_id', ''), p_created_at,
    nullif(p ->> 'client_created_at', '')::timestamptz, nullif(p ->> 'client_tz', ''),
    p_cashier, v_cashier_name, v_subtotal + v_line_disc, v_line_disc,
    v_bill_type::public.discount_type, case when v_bill_disc > 0 then v_bill_value end, v_bill_disc, v_total,
    v_method::public.payment_method, v_cash, v_card, v_cash_received, v_change,
    nullif(trim(p ->> 'card_ref'), ''),
    v_items_count, v_offline
  );

  for v_line in select value from jsonb_array_elements(v_lines) loop
    insert into public.sale_items (sale_id, product_id, name, sku, category, unit_price, qty,
                                   discount_type, discount_value, discount_amount, line_total)
    values (v_id, (v_line ->> 'product_id')::uuid, v_line ->> 'name', v_line ->> 'sku', v_line ->> 'category',
            (v_line ->> 'unit_price')::bigint, (v_line ->> 'qty')::int,
            case when (v_line ->> 'discount_amount')::bigint > 0 then (v_line ->> 'discount_type')::public.discount_type end,
            case when (v_line ->> 'discount_amount')::bigint > 0 then (v_line ->> 'discount_value')::numeric end,
            (v_line ->> 'discount_amount')::bigint, (v_line ->> 'line_total')::bigint);
  end loop;

  -- decrement stock + ledger (one movement per product)
  for r in select product_id, qty from jsonb_to_recordset(v_req) as t(product_id uuid, qty int) loop
    update public.products set stock_qty = stock_qty - r.qty where id = r.product_id
      returning stock_qty into v_qty;
    insert into public.stock_movements (product_id, delta, qty_after, type, reason, sale_id, user_id, created_at)
    values (r.product_id, -r.qty, v_qty, 'sale', 'Invoice #' || v_invoice, v_id, p_cashier, p_created_at);
  end loop;

  return public.sale_json(v_id);
end $$;

-- Full sale (with items) as JSON — used for receipts.
create or replace function public.sale_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(s) || jsonb_build_object('items', coalesce((
           select jsonb_agg(to_jsonb(i) - 'sale_id' order by i.id)
             from public.sale_items i where i.sale_id = s.id), '[]'::jsonb))
    from public.sales s where s.id = p_id;
$$;

-- Public entry point for the app.
create or replace function public.create_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_staff() then
    raise exception 'NOT_AUTHORIZED: please log in again' using errcode = '42501';
  end if;
  return public.process_sale(p, auth.uid(), now());
end $$;

revoke execute on function public.calc_discount(bigint, text, numeric) from public, anon;
revoke execute on function public.process_sale(jsonb, uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.sale_json(uuid) from public, anon, authenticated;
revoke execute on function public.create_sale(jsonb) from public, anon;
grant execute on function public.calc_discount(bigint, text, numeric) to authenticated;
grant execute on function public.create_sale(jsonb) to authenticated;
