-- =====================================================================
-- Event POS — 007: print stations
-- A laptop with a receipt printer registers as a "print station". Phones/tablets
-- without a printer send print jobs; the station picks them up (Realtime) and prints.
-- =====================================================================

create table public.print_stations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique check (length(trim(name)) > 0),
  device_id     text,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create table public.print_jobs (
  id                 uuid primary key default gen_random_uuid(),
  station_id         uuid not null references public.print_stations (id) on delete cascade,
  sale_id            uuid not null references public.sales (id) on delete cascade,
  reprint            boolean not null default false,
  status             text not null default 'queued' check (status in ('queued', 'printing', 'printed', 'failed')),
  error              text,
  requested_by       uuid references public.profiles (id) default auth.uid(),
  requested_by_name  text,
  requested_device   text,
  created_at         timestamptz not null default now(),
  printed_at         timestamptz
);
create index print_jobs_station_status_idx on public.print_jobs (station_id, status, created_at);

alter table public.print_stations enable row level security;
alter table public.print_jobs enable row level security;

-- any logged-in, active staff member may run a station or send jobs to one
grant select, insert on public.print_stations to authenticated;
grant update (name, device_id, last_seen_at) on public.print_stations to authenticated;
grant delete on public.print_stations to authenticated;

create policy print_stations_select on public.print_stations for select to authenticated using ((select public.is_staff()));
create policy print_stations_insert on public.print_stations for insert to authenticated with check ((select public.is_staff()));
create policy print_stations_update on public.print_stations for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));
create policy print_stations_delete on public.print_stations for delete to authenticated using ((select public.is_admin()));

grant select on public.print_jobs to authenticated;
grant insert (station_id, sale_id, reprint, requested_by_name, requested_device) on public.print_jobs to authenticated;
grant update (status, error, printed_at) on public.print_jobs to authenticated;

create policy print_jobs_select on public.print_jobs for select to authenticated using ((select public.is_staff()));
create policy print_jobs_insert on public.print_jobs for insert to authenticated
  with check ((select public.is_staff()) and requested_by = (select auth.uid()));
create policy print_jobs_update on public.print_jobs for update to authenticated
  using ((select public.is_staff())) with check ((select public.is_staff()));

-- live delivery of new jobs to the station, and of "printed" back to the phone
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'print_jobs') then
    alter publication supabase_realtime add table public.print_jobs;
  end if;
end $$;
