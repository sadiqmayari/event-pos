-- =====================================================================
-- Event POS — 005: receipt logo (stored as a small PNG data URL in settings)
-- =====================================================================

alter table public.settings
  add column if not exists logo_data_url text
  check (logo_data_url is null or (logo_data_url like 'data:image/%' and length(logo_data_url) < 300000));

grant update (logo_data_url) on public.settings to authenticated;
