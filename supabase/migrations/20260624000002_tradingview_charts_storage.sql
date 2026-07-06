-- TradingView MCP — screenshot storage bucket
--
-- ADDITIVE migration. Creates a public Storage bucket for chart screenshots.
-- The publisher uploads PNGs to:  tradingview-charts/{TICKER}/{YYYY-MM-DD}.png
-- and writes the resulting public URL into:
--   * public.signals.chart_image_url          (latest per ticker, read by the app)
--   * public.tradingview_scans.chart_image_url (per-scan archive)
--
-- Bucket is PUBLIC so the app can render images by URL without signing.
-- Uploads are performed with the service-role key (server-side), which bypasses
-- Storage RLS — so no INSERT policy is strictly required. A public read policy is
-- added for clarity / in case the bucket is later switched to a stricter mode.

insert into storage.buckets (id, name, public)
values ('tradingview-charts', 'tradingview-charts', true)
on conflict (id) do nothing;

-- Public read access to objects in this bucket.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename  = 'objects'
      and policyname = 'tradingview_charts_public_read'
  ) then
    create policy "tradingview_charts_public_read"
      on storage.objects for select
      using ( bucket_id = 'tradingview-charts' );
  end if;
end$$;
