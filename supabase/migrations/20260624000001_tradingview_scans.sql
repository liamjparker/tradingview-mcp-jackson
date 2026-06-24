-- TradingView MCP — weekly scan capture
--
-- ADDITIVE migration. Creates one new table: public.tradingview_scans.
-- It does NOT alter the existing signals / signal_snapshots tables, which the
-- portfolio app already reads and which the MCP publisher continues to populate.
--
-- Purpose: a durable, append-only history of EVERY raw scan the TradingView MCP
-- connector publishes — one row per (ticker, scan date). It keeps the full raw
-- connector output (study values, Pine levels/labels/boxes/tables, OHLCV summary)
-- alongside the curated fields that get mirrored into `signals`, plus the
-- screenshot reference. `signals` holds the latest-per-ticker view for the app;
-- `signal_snapshots` holds the lightweight weekly history; `tradingview_scans`
-- holds the complete raw archive for auditing / reprocessing.

create table if not exists public.tradingview_scans (
  id            text primary key,                       -- "{TICKER}_{YYYY-MM-DD}", e.g. "NVDA_2026-06-24"
  ticker        text not null,
  name          text,
  timeframe     text,                                   -- "W", "D", "60", ...
  scanned_at    date not null default current_date,     -- the scan's logical date (weekly cadence)
  scanned_ts    timestamptz not null default now(),     -- exact moment the scan ran
  source        text not null default 'tradingview-mcp',

  -- Curated / interpreted fields (mirror of what is written to public.signals)
  rating          text,                                 -- "Strong Buy" | "Buy" | "Neutral" | "Sell" | ...
  rating_score    numeric,                              -- -1.0 .. 1.0
  bias            text,                                 -- "bullish" | "bearish" | "neutral"
  bx_trender      jsonb,                                -- { state, longTerm, shortTerm }
  volume_profile  jsonb,                                -- { poc, vah, val, nodes }
  levels          jsonb,                                -- { pivots, support[], resistance[] }
  rules_flags     jsonb,                                -- { breakout, trend_pullback, ... }
  quote           jsonb,                                -- { last, low52, high52, volume, changePct, pctFromHigh }

  -- Raw connector capture (verbatim MCP tool output — for audit / reprocessing)
  study_values        jsonb,                            -- data_get_study_values -> studies[]
  pine_lines          jsonb,                            -- data_get_pine_lines  -> studies[]
  pine_labels         jsonb,                            -- data_get_pine_labels -> studies[]
  pine_tables         jsonb,                            -- data_get_pine_tables -> studies[]
  pine_boxes          jsonb,                            -- data_get_pine_boxes  -> studies[]
  ohlcv_summary       jsonb,                            -- data_get_ohlcv(summary:true)
  indicators_applied  jsonb,                            -- which indicators were toggled visible during the scan

  -- Screenshot
  screenshot_path  text,                                -- local path on the scanning machine (Mac mini)
  chart_image_url  text,                                -- public Supabase Storage URL (tradingview-charts bucket)

  notes        text,
  created_at   timestamptz not null default now()
);

create index if not exists tradingview_scans_ticker_idx     on public.tradingview_scans (ticker);
create index if not exists tradingview_scans_scanned_at_idx on public.tradingview_scans (scanned_at desc);

comment on table public.tradingview_scans is
  'Append-only archive of TradingView MCP weekly scans. One row per (ticker, scan date). Raw connector output + curated fields + screenshot reference.';
