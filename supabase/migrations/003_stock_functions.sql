-- =====================================================================
-- Event POS — 003: stock functions (admin only)
-- Errors are raised as 'CODE: human message' so the app can show them.
-- =====================================================================

-- Manual stock adjustment. Give EITHER p_delta (+5 / -2) OR p_new_qty (a recount).
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_reason     text,
  p_delta      int default null,
  p_new_qty    int default null,
  p_type       public.stock_movement_type default 'adjustment'
) returns public.products
language plpgsql security definer set search_path = '' as $$
declare
  v       public.products;
  v_delta int;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only admins can adjust stock' using errcode = '42501';
  end if;
  if p_type not in ('adjustment', 'initial') then
    raise exception 'INVALID_INPUT: invalid movement type';
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'REASON_REQUIRED: please give a reason';
  end if;
  if (p_delta is null) = (p_new_qty is null) then
    raise exception 'INVALID_INPUT: give either a change or a new quantity';
  end if;
  if p_new_qty is not null and p_new_qty < 0 then
    raise exception 'INVALID_INPUT: quantity cannot be negative';
  end if;

  select * into v from public.products where id = p_product_id for update;
  if not found then
    raise exception 'PRODUCT_NOT_FOUND: product does not exist';
  end if;

  v_delta := coalesce(p_delta, p_new_qty - v.stock_qty);
  if v_delta = 0 then
    return v;
  end if;
  if v.stock_qty + v_delta < 0 then
    raise exception 'NEGATIVE_STOCK: only % in stock', v.stock_qty;
  end if;

  update public.products set stock_qty = stock_qty + v_delta
   where id = p_product_id returning * into v;

  insert into public.stock_movements (product_id, delta, qty_after, type, reason, user_id)
  values (v.id, v_delta, v.stock_qty, p_type, trim(p_reason), auth.uid());

  return v;
end $$;

-- Bulk import / update from CSV rows (all-or-nothing).
-- Row keys: name, sku, category, price, stock_qty, low_stock_threshold.
-- Matches existing products by SKU, or by name when the row has no SKU.
-- p_stock_mode: 'set' = stock becomes the CSV value, 'add' = CSV value is added.
create or replace function public.import_products(p_rows jsonb, p_stock_mode text default 'set')
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r       jsonb;
  i       int := 0;
  v_ins   int := 0;
  v_upd   int := 0;
  v_id    uuid;
  v_old   int;
  v_new   int;
  v_name  text;
  v_sku   text;
  v_cat   text;
  v_price bigint;
  v_qty   int;
  v_thr   int;
begin
  if not public.is_admin() then
    raise exception 'NOT_AUTHORIZED: only admins can import products' using errcode = '42501';
  end if;
  if p_stock_mode not in ('set', 'add') then
    raise exception 'INVALID_INPUT: stock mode must be set or add';
  end if;
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'INVALID_INPUT: rows must be an array';
  end if;

  for r in select value from jsonb_array_elements(p_rows) loop
    i := i + 1;
    v_name := nullif(trim(r ->> 'name'), '');
    v_sku  := nullif(trim(r ->> 'sku'), '');
    v_cat  := nullif(trim(r ->> 'category'), '');
    if v_name is null then
      raise exception 'ROW_INVALID: row % has no name', i;
    end if;

    begin
      v_price := case when nullif(trim(r ->> 'price'), '') is null then null
                      else round((r ->> 'price')::numeric)::bigint end;
      v_qty   := case when nullif(trim(r ->> 'stock_qty'), '') is null then null
                      else (r ->> 'stock_qty')::numeric::int end;
      v_thr   := case when nullif(trim(r ->> 'low_stock_threshold'), '') is null then null
                      else (r ->> 'low_stock_threshold')::numeric::int end;
    exception when others then
      raise exception 'ROW_INVALID: row % (%) has an invalid number', i, v_name;
    end;

    if v_price < 0 or v_thr < 0 or (p_stock_mode = 'set' and v_qty < 0) then
      raise exception 'ROW_INVALID: row % (%) has a negative value', i, v_name;
    end if;

    v_id := null;
    if v_sku is not null then
      select id, stock_qty into v_id, v_old from public.products where sku = v_sku for update;
    else
      select id, stock_qty into v_id, v_old from public.products
       where sku is null and lower(name) = lower(v_name) limit 1 for update;
    end if;

    if v_id is null then
      if v_price is null then
        raise exception 'ROW_INVALID: row % (%) is a new product and needs a price', i, v_name;
      end if;
      if coalesce(v_qty, 0) < 0 then
        raise exception 'ROW_INVALID: row % (%) has negative stock', i, v_name;
      end if;
      insert into public.products (name, sku, category, price, stock_qty, low_stock_threshold)
      values (v_name, v_sku, coalesce(v_cat, 'General'), v_price, coalesce(v_qty, 0), coalesce(v_thr, 5))
      returning id into v_id;
      if coalesce(v_qty, 0) > 0 then
        insert into public.stock_movements (product_id, delta, qty_after, type, reason, user_id)
        values (v_id, v_qty, v_qty, 'import', 'CSV import (new product)', auth.uid());
      end if;
      v_ins := v_ins + 1;
    else
      v_new := case when v_qty is null then v_old
                    when p_stock_mode = 'set' then v_qty
                    else v_old + v_qty end;
      if v_new < 0 then
        raise exception 'ROW_INVALID: row % (%) would make stock negative', i, v_name;
      end if;
      update public.products
         set name = v_name,
             category = coalesce(v_cat, category),
             price = coalesce(v_price, price),
             low_stock_threshold = coalesce(v_thr, low_stock_threshold),
             stock_qty = v_new
       where id = v_id;
      if v_new <> v_old then
        insert into public.stock_movements (product_id, delta, qty_after, type, reason, user_id)
        values (v_id, v_new - v_old, v_new, 'import', 'CSV import (' || p_stock_mode || ')', auth.uid());
      end if;
      v_upd := v_upd + 1;
    end if;
  end loop;

  perform public.write_audit('product.import', 'product', null,
    jsonb_build_object('inserted', v_ins, 'updated', v_upd, 'stock_mode', p_stock_mode));

  return jsonb_build_object('inserted', v_ins, 'updated', v_upd);
end $$;

revoke execute on function public.adjust_stock(uuid, text, int, int, public.stock_movement_type) from public, anon;
revoke execute on function public.import_products(jsonb, text) from public, anon;
grant execute on function public.adjust_stock(uuid, text, int, int, public.stock_movement_type) to authenticated;
grant execute on function public.import_products(jsonb, text) to authenticated;
