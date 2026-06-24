import { z } from 'zod';
import { jsonResult } from './_format.js';
import * as core from '../core/publish.js';

export function registerPublishTools(server) {
  server.tool(
    'db_publish_scan',
    'Publish one ticker\'s weekly TradingView scan to the Supabase database. Upserts the curated signal (latest-per-ticker), appends a weekly snapshot to the history, archives the full raw connector output, and uploads the chart screenshot. Assemble the curated fields (bias, bx_trender, volume_profile, levels, quote) from the chart-reading tools first, then call this once per ticker.',
    {
      ticker: z.string().describe('Ticker symbol, e.g. "NVDA"'),
      name: z.string().optional().describe('Company / instrument name'),
      timeframe: z.string().optional().describe('Chart timeframe (default "W")'),
      scanned_at: z.string().optional().describe('Scan date YYYY-MM-DD (default today)'),
      rating: z.string().optional().describe('"Strong Buy" | "Buy" | "Neutral" | "Sell" | "Strong Sell"'),
      rating_score: z.coerce.number().optional().describe('Numeric rating -1.0..1.0'),
      bias: z.string().optional().describe('"bullish" | "bearish" | "neutral" (per rules.json bias_criteria)'),
      bx_trender: z.any().optional().describe('{ state, longTerm?, shortTerm? } — from THT Multi Timeframe BX'),
      volume_profile: z.any().optional().describe('{ poc, vah, val, nodes? } — from THT Volume Pro boxes'),
      levels: z.any().optional().describe('{ pivots?, support: [], resistance: [] }'),
      rules_flags: z.any().optional().describe('{ breakout?, trend_pullback?, ... } — rule conditions that fired'),
      quote: z.any().optional().describe('{ last, low52?, high52?, volume?, changePct?, pctFromHigh? }'),
      oscillators: z.any().optional().describe('{ rsi?, macd?: { hist } } — used to build the snapshot metrics'),
      moving_averages: z.any().optional().describe('{ priceVsSma200Pct?, ... } — used to build the snapshot metrics'),
      metrics: z.any().optional().describe('Explicit snapshot metrics jsonb (overrides oscillators/moving_averages assembly)'),
      raw: z.any().optional().describe('Raw connector capture: { study_values, pine_lines, pine_labels, pine_tables, pine_boxes, ohlcv_summary }'),
      indicators_applied: z.any().optional().describe('Which indicators were toggled visible during the scan'),
      screenshot_path: z.string().optional().describe('Local path to a chart screenshot PNG to upload (from capture_screenshot)'),
      notes: z.string().optional().describe('Free-text notes for the archive row'),
    },
    async (scan) => {
      try { return jsonResult(await core.publishScan(scan)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'db_publish_scans',
    'Publish multiple tickers\' scans in one call (batch). Pass an array of the same payload shape as db_publish_scan. Continues past individual failures.',
    {
      scans: z.array(z.any()).describe('Array of scan payloads (same shape as db_publish_scan input)'),
    },
    async ({ scans }) => {
      try { return jsonResult(await core.publishScans(scans)); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'db_health_check',
    'Verify the Supabase connection and that the signals / signal_snapshots / tradingview_scans tables are reachable. Use before publishing to confirm credentials are set.',
    {},
    async () => {
      try { return jsonResult(await core.dbHealthCheck()); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );

  server.tool(
    'db_get_recent_scans',
    'Read recent scans back from the database. Omit ticker for the latest signal per ticker; pass a ticker to get its weekly snapshot history.',
    {
      ticker: z.string().optional().describe('Ticker to fetch history for (omit for latest-per-ticker overview)'),
      limit: z.coerce.number().optional().describe('Max rows to return (default 10)'),
    },
    async ({ ticker, limit }) => {
      try { return jsonResult(await core.getRecentScans({ ticker, limit })); }
      catch (err) { return jsonResult({ success: false, error: err.message }, true); }
    },
  );
}
