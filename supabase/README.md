# Supabase migrations

Additive schema for publishing TradingView MCP scans to the portfolio database.
**These are not applied automatically** — review and apply them yourself.

| File | What it creates |
|------|-----------------|
| `migrations/20260624000001_tradingview_scans.sql` | `public.tradingview_scans` table (raw scan archive) + indexes |
| `migrations/20260624000002_tradingview_charts_storage.sql` | `tradingview-charts` public Storage bucket + public-read policy |

Neither migration alters existing tables (`signals`, `signal_snapshots`, etc.).

## Apply

```bash
# Supabase CLI (preferred)
supabase db push

# …or paste each file, in filename order, into the Supabase SQL editor.
```

See [`../docs/DATABASE.md`](../docs/DATABASE.md) for the full data model,
column mapping, credentials and publishing workflow.
