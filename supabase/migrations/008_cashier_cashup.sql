-- =====================================================================
-- Event POS — 008: cash-up per cashier
--
-- Each cashier is accountable for the cash they take. The admin can:
--   * give a cashier a change float  (entry type 'float')
--   * collect cash from a cashier    (entry type 'collection'), any number of times a day
-- Outstanding = floats given + cash taken in sales − cash already collected.
-- When collecting, the amount the cashier SHOULD hand over is snapshotted, so the
-- difference (over / short) is recorded permanently.
--
-- Also: a sale made offline and synced later counts on the day it was really made
-- (the device's time), not the sync time. All report functions use public.sale_time().
-- =====================================================================

create or replace function public.sale_time(s public.sales) returns timestamptz
language sql immutable as $$
  select case when s.synced_from_offline then coalesce(s.client_created_at, s.created_at) else s.created_at end
$$;

create table public.cashier_cash_entries (
  id             bigint generated always as identity primary key,
  cashier_id     uuid not null references public.profiles (id),
  cashier_name   text not null,
  day            date not null,
  tz             text not null,
  type           text not null check (type in ('float', 'collection')),
  amount         bigint not null check (amount >= 0),
  expected       bigint,            -- for collections: what the cashier owed at that moment
  difference     bigint,            -- for collections: amount − expected (negative = short)
  notes          text,
  recorded_by    uuid references public.profiles (id) default auth.uid(),
  recorded_by_name text,
  created_at     timestamptz not null default now()
);
create index cashier_cash_entries_day_idx on public.cashier_cash_entries (day, cashier_id);

alter table public.cashier_cash_entries enable row level security;
grant select on public.cashier_cash_entries to authenticated;
-- admins see everything; a cashier sees their own entries
create policy cashier_cash_entries_select on public.cashier_cash_entries for select to authenticated
  using ((select public.is_admin()) or cashier_id = (select auth.uid()));

-- ---------- per-cashier summary for one day ----------
create or replace function public.cashier_summary(p_day date, p_tz text)
returns table (
  cashier_id uuid, cashier_name text, invoices int, items int, total bigint, cash bigint, card bigint,
  voided_invoices int, floats bigint, collected bigint, outstanding bigint, last_collection_at timestamptz
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_day::timestamp at time zone p_tz);
  v_to   timestamptz := ((p_day + 1)::timestamp at time zone p_tz);
begin
  -- admins: everyone; cashiers: only themselves
  if not public.is_staff() then raise exception 'NOT_AUTHORIZED: please log in' using errcode = '42501'; end if;
  return query
  with s as (
    select x.* from public.sales x
     where public.sale_time(x) >= v_from and public.sale_time(x) < v_to
  ),
  e as (
    select * from public.cashier_cash_entries where day = p_day
  ),
  people as (
    select distinct s.cashier_id as id from s
    union
    select distinct e.cashier_id from e
    union  -- every active cashier, so a float can be given before their first sale
    select pr.id from public.profiles pr where pr.active and pr.role = 'cashier'
  )
  select p.id,
         coalesce(pr.full_name, (select max(s2.cashier_name) from s s2 where s2.cashier_id = p.id)),
         (select count(*) from s where s.cashier_id = p.id and s.status = 'completed')::int,
         (select coalesce(sum(s.items_count), 0) from s where s.cashier_id = p.id and s.status = 'completed')::int,
         (select coalesce(sum(s.total), 0) from s where s.cashier_id = p.id and s.status = 'completed')::bigint,
         (select coalesce(sum(s.cash_amount), 0) from s where s.cashier_id = p.id and s.status = 'completed')::bigint,
         (select coalesce(sum(s.card_amount), 0) from s where s.cashier_id = p.id and s.status = 'completed')::bigint,
         (select count(*) from s where s.cashier_id = p.id and s.status = 'voided')::int,
         (select coalesce(sum(e.amount), 0) from e where e.cashier_id = p.id and e.type = 'float')::bigint,
         (select coalesce(sum(e.amount), 0) from e where e.cashier_id = p.id and e.type = 'collection')::bigint,
         ((select coalesce(sum(e.amount), 0) from e where e.cashier_id = p.id and e.type = 'float')
          + (select coalesce(sum(s.cash_amount), 0) from s where s.cashier_id = p.id and s.status = 'completed')
          - (select coalesce(sum(e.amount), 0) from e where e.cashier_id = p.id and e.type = 'collection'))::bigint,
         (select max(e.created_at) from e where e.cashier_id = p.id and e.type = 'collection')
    from people p
    left join public.profiles pr on pr.id = p.id
   where public.is_admin() or p.id = auth.uid()
   order by 2;
end $$;

-- ---------- give float / collect cash ----------
create or replace function public.record_cashier_cash(
  p_cashier uuid, p_day date, p_tz text, p_type text, p_amount bigint, p_notes text default null
) returns public.cashier_cash_entries
language plpgsql security definer set search_path = '' as $$
declare
  v_row       public.cashier_cash_entries;
  v_name      text;
  v_expected  bigint;
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED: only admins can record cash' using errcode = '42501'; end if;
  if p_type not in ('float', 'collection') then raise exception 'INVALID_INPUT: type must be float or collection'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'INVALID_INPUT: amount must be 0 or more'; end if;
  select full_name into v_name from public.profiles where id = p_cashier;
  if v_name is null then raise exception 'INVALID_INPUT: unknown cashier'; end if;

  -- serialise entries for the same cashier + day so two admins can't double-collect
  perform pg_advisory_xact_lock(hashtextextended(p_cashier::text || p_day::text, 0));

  if p_type = 'collection' then
    select c.outstanding into v_expected from public.cashier_summary(p_day, p_tz) c where c.cashier_id = p_cashier;
    v_expected := coalesce(v_expected, 0);
  end if;

  insert into public.cashier_cash_entries (cashier_id, cashier_name, day, tz, type, amount, expected, difference, notes, recorded_by_name)
  values (p_cashier, v_name, p_day, p_tz, p_type, p_amount, v_expected,
          case when p_type = 'collection' then p_amount - v_expected end,
          nullif(trim(p_notes), ''), (select full_name from public.profiles where id = auth.uid()))
  returning * into v_row;

  perform public.write_audit('cash.' || p_type, 'cashier', p_cashier::text,
    jsonb_build_object('cashier', v_name, 'day', p_day, 'amount', p_amount, 'expected', v_expected, 'difference', v_row.difference));
  return v_row;
end $$;

-- ---------- existing reports: count offline sales on the day they were made ----------
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
    select (public.sale_time(x) at time zone p_tz)::date as day, x.*
      from public.sales x
     where public.sale_time(x) >= (p_from::timestamp at time zone p_tz)
       and public.sale_time(x) <  ((p_to + 1)::timestamp at time zone p_tz)
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

create or replace function public.top_products(p_from date, p_to date, p_tz text, p_limit int default 10)
returns table (product_id uuid, name text, category text, qty int, revenue bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception 'NOT_AUTHORIZED: admins only' using errcode = '42501'; end if;
  return query
  select i.product_id, max(i.name), max(i.category), sum(i.qty)::int, sum(i.line_total)::bigint
    from public.sale_items i join public.sales s on s.id = i.sale_id
   where s.status = 'completed'
     and public.sale_time(s) >= (p_from::timestamp at time zone p_tz)
     and public.sale_time(s) <  ((p_to + 1)::timestamp at time zone p_tz)
   group by i.product_id
   order by 4 desc, 5 desc
   limit p_limit;
end $$;

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
    from public.sales s
   where s.status = 'completed'
     and public.sale_time(s) >= (p_day::timestamp at time zone p_tz)
     and public.sale_time(s) <  ((p_day + 1)::timestamp at time zone p_tz);
  return jsonb_build_object('day', p_day, 'opening_float', v_float, 'cash_sales', v_cash,
                            'cash_invoices', v_n, 'expected', v_float + v_cash);
end $$;

revoke execute on function public.cashier_summary(date, text) from public, anon;
revoke execute on function public.record_cashier_cash(uuid, date, text, text, bigint, text) from public, anon;
grant execute on function public.cashier_summary(date, text) to authenticated;
grant execute on function public.record_cashier_cash(uuid, date, text, text, bigint, text) to authenticated;
grant execute on function public.sale_time(public.sales) to authenticated;
