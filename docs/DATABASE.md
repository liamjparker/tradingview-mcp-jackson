# Database — Publishing TradingView Scans to Supabase

This document describes how the TradingView MCP connector publishes weekly scan
data (indicator values, price levels, quotes and screenshots) to the Supabase
database that backs the **portfolio app** ("Through The Cycle"), so the app can
display an up‑to‑date, historical view of the watchlist.

```
Mac mini ──> TradingView Desktop ──CDP──> TradingView MCP ──> Supabase ──> portfolio_app
            (you drive the scan)         (this repo)         (Postgres + Storage)   (reads tables)
```

## Tables

The connector writes to three tables. Two already existed in the app and are
reused as-is; one is new (additive) and created by the migrations in
`supabase/migrations/`.

| Table | Cardinality | Purpose | Written by connector |
|-------|-------------|---------|----------------------|
| `signals` | 1 row per ticker | **Latest** scan per ticker — what the app shows now | upsert on `id = TICKER` |
| `signal_snapshots` | 1 row per ticker per scan date | **Weekly history** (lightweight metrics) | upsert on `id = "TICKER_YYYY-MM-DD"` |
| `tradingview_scans` | 1 row per ticker per scan date | **Full raw archive** (every MCP field + screenshot ref) — NEW | upsert on `id = "TICKER_YYYY-MM-DD"` |

`signals` / `signal_snapshots` are **not altered** — the publisher maps onto their
existing columns. `tradingview_scans` is purely additive and never touches the
app's other tables.

### Column mapping

`signals` (latest per ticker):

| Column | Source |
|--------|--------|
| `id`, `ticker` | ticker (uppercased) |
| `name` | company/instrument name |
| `rating`, `rating_score` | your interpreted rating (`Strong Buy`…`Strong Sell`, −1.0…1.0) |
| `timeframe` | chart timeframe (default `W`) |
| `scanned_at` | scan date `YYYY-MM-DD` |
| `bx_trender` | `{ state, longTerm, shortTerm }` — from **THT Multi Timeframe BX** (monthly value) |
| `volume_profile` | `{ poc, vah, val, nodes }` — from **THT Volume Pro** boxes |
| `levels` | `{ pivots, support[], resistance[] }` |
| `rules_flags` | `{ breakout, trend_pullback, … }` — which `rules.json` conditions fired |
| `quote` | `{ last, low52, high52, volume, changePct, pctFromHigh }` |
| `chart_image_url` | public URL of the uploaded screenshot |

`signal_snapshots.metrics` (jsonb): `{ bxTrender: { state }, oscillators: { rsi, macd: { hist } }, moving_averages: { priceVsSma200Pct } }`.

`tradingview_scans` additionally stores the verbatim connector output:
`study_values`, `pine_lines`, `pine_labels`, `pine_tables`, `pine_boxes`,
`ohlcv_summary`, `indicators_applied`, plus `bias`, `screenshot_path`, `notes`.

### Screenshots

Uploaded to the public Storage bucket **`tradingview-charts`** at
`{TICKER}/{YYYY-MM-DD}.png`. The resulting public URL is written to both
`signals.chart_image_url` and `tradingview_scans.chart_image_url`.

## Setup

1. **Apply the migrations** to the Supabase project (they are *not* applied
   automatically — review them first). Either with the Supabase CLI:

   ```bash
   supabase db push          # applies supabase/migrations/*.sql
   ```

   …or paste each file in `supabase/migrations/` into the Supabase SQL editor
   in order. This creates `public.tradingview_scans` and the
   `tradingview-charts` Storage bucket.

2. **Configure credentials.** Copy `.env.example` to `.env` and fill in:

   ```
   SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=...        # service_role key (server-side only)
   ```

   The service-role key bypasses Row Level Security — keep it on the Mac mini,
   never in a browser.

3. **Verify:** `npm run tv -- db health` (or the `db_health_check` MCP tool)
   should report all three tables reachable.

## Publishing workflow (per ticker, weekly)

For each ticker in `rules.json` → `watchlist`:

1. `chart_set_symbol` + `chart_set_timeframe W`.
2. Read the chart honoring the free-plan 2-indicator cap (see `rules.json`):
   - `data_get_study_values` — BX Trender monthly value, RSI/MACD if shown.
   - `data_get_pine_boxes --filter "Volume Pro"` — POC / value-area zones.
   - `quote_get` — last price, 52-week range, volume.
3. `capture_screenshot` — note the returned `file_path`.
4. Interpret bias/rating using `rules.json` → `bias_criteria`.
5. `db_publish_scan` with the curated fields, the `raw` blobs, and
   `screenshot_path`. The tool uploads the screenshot, upserts `signals`,
   appends `signal_snapshots`, and archives `tradingview_scans`.

Or do the whole watchlist at once with `db_publish_scans` (array payload).

### CLI equivalent

```bash
npm run tv -- db health
npm run tv -- db publish --file scan.json      # scan.json = one object or an array
npm run tv -- db recent                         # latest signal per ticker
npm run tv -- db recent --ticker NVDA           # NVDA weekly history
```

### Example payload

```json
{
  "ticker": "NVDA",
  "name": "NVIDIA Corporation",
  "timeframe": "W",
  "rating": "Strong Buy",
  "rating_score": 0.8,
  "bias": "bullish",
  "bx_trender": { "state": "bullish", "longTerm": 1.1, "shortTerm": 4.2 },
  "volume_profile": { "poc": 118.5, "vah": 124, "val": 110.2 },
  "levels": { "support": [110, 102.5], "resistance": [128, 135.5] },
  "rules_flags": { "breakout": true },
  "quote": { "last": 123.8, "low52": 86.6, "high52": 153.1, "changePct": 1.4 },
  "oscillators": { "rsi": 64, "macd": { "hist": 0.5 } },
  "moving_averages": { "priceVsSma200Pct": 20.9 },
  "indicators_applied": ["THT Volume Pro", "THT Multi Timeframe BX"],
  "screenshot_path": "screenshots/tv_chart_2026-06-24.png"
}
```

## Security note — Row Level Security

The Supabase project currently has **RLS disabled on all tables**, so anyone with
the anon key can read/write every row (including `positions`, `debts`, etc.).
This connector uses the **service-role** key and works regardless of RLS. Enabling
RLS is recommended but must be paired with policies (and the app's read path
checked), so it is intentionally left out of these migrations. See
`supabase/migrations/` notes and Supabase docs on Row Level Security.
