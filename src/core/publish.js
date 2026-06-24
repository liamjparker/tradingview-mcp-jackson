/**
 * Core Supabase publishing logic.
 *
 * Maps live TradingView MCP scan output into the portfolio app's Supabase tables:
 *   - public.signals           — latest scan per ticker (upsert on id = ticker)
 *   - public.signal_snapshots  — weekly history    (upsert on id = "{ticker}_{date}")
 *   - public.tradingview_scans — full raw archive   (upsert on id = "{ticker}_{date}")
 * and uploads chart screenshots to the `tradingview-charts` Storage bucket.
 *
 * Configuration (env, loaded from .env via dotenv):
 *   SUPABASE_URL                  — project URL, e.g. https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY     — service-role key (server-side writes; bypasses RLS)
 *                                   (SUPABASE_KEY is accepted as a fallback)
 *
 * The mapping helpers (normalizeScannedAt, buildSignalsRow, buildSnapshotRow,
 * buildScanRow) are pure and dependency-free so they can be unit-tested without
 * a network connection or the supabase client installed.
 */
import 'dotenv/config';
import { readFileSync } from 'fs';
import { basename } from 'path';

const STORAGE_BUCKET = 'tradingview-charts';
const DEFAULT_TIMEFRAME = 'W';

// --- Configuration ----------------------------------------------------------

export function getConfig() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;
  return { url, key };
}

let _client = null;
async function getSupabase() {
  if (_client) return _client;
  const { url, key } = getConfig();
  if (!url || !key) {
    throw new Error(
      'Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY ' +
      '(in a .env file or the environment). See docs/DATABASE.md.',
    );
  }
  let createClient;
  try {
    ({ createClient } = await import('@supabase/supabase-js'));
  } catch {
    throw new Error(
      "Missing dependency '@supabase/supabase-js'. Run `npm install` in the repo root.",
    );
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

// --- Pure mapping helpers (no I/O) ------------------------------------------

/** Normalize a scan date to YYYY-MM-DD. Defaults to today (UTC). */
export function normalizeScannedAt(scanned_at) {
  if (!scanned_at) return new Date().toISOString().slice(0, 10);
  // Accept full ISO timestamps or plain dates; keep only the date part.
  const d = new Date(scanned_at);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(scanned_at).slice(0, 10);
}

export function scanId(ticker, scannedAt) {
  return `${String(ticker).toUpperCase()}_${scannedAt}`;
}

/**
 * Build the `metrics` jsonb for signal_snapshots. Uses an explicit metrics
 * object if provided, otherwise assembles one from oscillators / moving_averages
 * / bx_trender — matching the shape the app already stores.
 */
export function buildMetrics(scan) {
  if (scan.metrics && typeof scan.metrics === 'object') return scan.metrics;
  const metrics = {};
  if (scan.bx_trender?.state) metrics.bxTrender = { state: scan.bx_trender.state };
  if (scan.oscillators) metrics.oscillators = scan.oscillators;
  if (scan.moving_averages) metrics.moving_averages = scan.moving_averages;
  return metrics;
}

/** Row for public.signals (latest per ticker). */
export function buildSignalsRow(scan, { scannedAt, chartImageUrl } = {}) {
  const ticker = String(scan.ticker).toUpperCase();
  return {
    id: ticker,
    ticker,
    name: scan.name ?? null,
    rating: scan.rating ?? null,
    rating_score: scan.rating_score ?? null,
    timeframe: scan.timeframe ?? DEFAULT_TIMEFRAME,
    scanned_at: scannedAt,
    chart_image_url: chartImageUrl ?? scan.chart_image_url ?? null,
    bx_trender: scan.bx_trender ?? null,
    volume_profile: scan.volume_profile ?? null,
    levels: scan.levels ?? null,
    rules_flags: scan.rules_flags ?? null,
    quote: scan.quote ?? null,
  };
}

/** Row for public.signal_snapshots (weekly history). */
export function buildSnapshotRow(scan, { scannedAt } = {}) {
  const ticker = String(scan.ticker).toUpperCase();
  return {
    id: scanId(ticker, scannedAt),
    ticker,
    scanned_at: scannedAt,
    timeframe: scan.timeframe ?? DEFAULT_TIMEFRAME,
    rating: scan.rating ?? null,
    rating_score: scan.rating_score ?? null,
    metrics: buildMetrics(scan),
  };
}

/** Row for public.tradingview_scans (full raw archive). */
export function buildScanRow(scan, { scannedAt, chartImageUrl } = {}) {
  const ticker = String(scan.ticker).toUpperCase();
  const raw = scan.raw || {};
  return {
    id: scanId(ticker, scannedAt),
    ticker,
    name: scan.name ?? null,
    timeframe: scan.timeframe ?? DEFAULT_TIMEFRAME,
    scanned_at: scannedAt,
    source: 'tradingview-mcp',
    rating: scan.rating ?? null,
    rating_score: scan.rating_score ?? null,
    bias: scan.bias ?? null,
    bx_trender: scan.bx_trender ?? null,
    volume_profile: scan.volume_profile ?? null,
    levels: scan.levels ?? null,
    rules_flags: scan.rules_flags ?? null,
    quote: scan.quote ?? null,
    study_values: raw.study_values ?? null,
    pine_lines: raw.pine_lines ?? null,
    pine_labels: raw.pine_labels ?? null,
    pine_tables: raw.pine_tables ?? null,
    pine_boxes: raw.pine_boxes ?? null,
    ohlcv_summary: raw.ohlcv_summary ?? null,
    indicators_applied: scan.indicators_applied ?? null,
    screenshot_path: scan.screenshot_path ?? null,
    chart_image_url: chartImageUrl ?? scan.chart_image_url ?? null,
    notes: scan.notes ?? null,
  };
}

// --- Storage ----------------------------------------------------------------

/**
 * Upload a local screenshot PNG to the tradingview-charts bucket.
 * Returns the public URL. Path: {TICKER}/{scannedAt}.png
 */
export async function uploadScreenshot({ filePath, ticker, scannedAt }) {
  const supabase = await getSupabase();
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch (err) {
    throw new Error(`Could not read screenshot at ${filePath}: ${err.message}`);
  }
  const ext = (basename(filePath).split('.').pop() || 'png').toLowerCase();
  const objectPath = `${String(ticker).toUpperCase()}/${scannedAt}.${ext}`;
  const { error } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(objectPath, bytes, { contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`, upsert: true });
  if (error) throw new Error(`Screenshot upload failed: ${error.message}`);
  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(objectPath);
  return data?.publicUrl || null;
}

// --- Publish ----------------------------------------------------------------

/**
 * Publish one ticker's scan to Supabase.
 * Writes signals (upsert), signal_snapshots (upsert), tradingview_scans (upsert),
 * and uploads the screenshot if `screenshot_path` is provided.
 */
export async function publishScan(scan) {
  if (!scan || !scan.ticker) throw new Error('publishScan requires a `ticker`.');
  const supabase = await getSupabase();
  const scannedAt = normalizeScannedAt(scan.scanned_at);

  let chartImageUrl = scan.chart_image_url ?? null;
  let screenshotUploaded = false;
  if (scan.screenshot_path) {
    chartImageUrl = await uploadScreenshot({
      filePath: scan.screenshot_path,
      ticker: scan.ticker,
      scannedAt,
    });
    screenshotUploaded = true;
  }

  const signalsRow = buildSignalsRow(scan, { scannedAt, chartImageUrl });
  const snapshotRow = buildSnapshotRow(scan, { scannedAt });
  const scanRow = buildScanRow(scan, { scannedAt, chartImageUrl });

  const written = [];
  const errors = [];

  const sig = await supabase.from('signals').upsert(signalsRow, { onConflict: 'id' });
  if (sig.error) errors.push(`signals: ${sig.error.message}`); else written.push('signals');

  const snap = await supabase.from('signal_snapshots').upsert(snapshotRow, { onConflict: 'id' });
  if (snap.error) errors.push(`signal_snapshots: ${snap.error.message}`); else written.push('signal_snapshots');

  const arc = await supabase.from('tradingview_scans').upsert(scanRow, { onConflict: 'id' });
  if (arc.error) errors.push(`tradingview_scans: ${arc.error.message}`); else written.push('tradingview_scans');

  if (errors.length) {
    return {
      success: false, ticker: signalsRow.ticker, scanned_at: scannedAt,
      written, errors, chart_image_url: chartImageUrl, screenshot_uploaded: screenshotUploaded,
    };
  }
  return {
    success: true, ticker: signalsRow.ticker, scanned_at: scannedAt,
    snapshot_id: snapshotRow.id, written, chart_image_url: chartImageUrl,
    screenshot_uploaded: screenshotUploaded,
  };
}

/** Publish many tickers in one call. Continues past individual failures. */
export async function publishScans(scans) {
  if (!Array.isArray(scans)) throw new Error('publishScans expects an array.');
  const results = [];
  for (const scan of scans) {
    try { results.push(await publishScan(scan)); }
    catch (err) { results.push({ success: false, ticker: scan?.ticker, error: err.message }); }
  }
  const published = results.filter(r => r.success).length;
  return { success: published === results.length, published, total: results.length, results };
}

/** Connectivity / configuration check. */
export async function dbHealthCheck() {
  const { url, key } = getConfig();
  if (!url || !key) {
    return {
      success: false, configured: false,
      error: 'SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY not set.',
      hint: 'Add them to a .env file in the repo root. See docs/DATABASE.md.',
    };
  }
  const supabase = await getSupabase();
  const checks = {};
  for (const table of ['signals', 'signal_snapshots', 'tradingview_scans']) {
    const { error, count } = await supabase.from(table).select('id', { count: 'exact', head: true });
    checks[table] = error ? { ok: false, error: error.message } : { ok: true, rows: count ?? null };
  }
  const ok = Object.values(checks).every(c => c.ok);
  return { success: ok, configured: true, project_url: url, tables: checks };
}

/** Read recent scans (curated) from signals or a ticker's history. */
export async function getRecentScans({ ticker, limit = 10 } = {}) {
  const supabase = await getSupabase();
  if (ticker) {
    const { data, error } = await supabase
      .from('signal_snapshots')
      .select('id, ticker, scanned_at, timeframe, rating, rating_score, metrics')
      .eq('ticker', String(ticker).toUpperCase())
      .order('scanned_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(error.message);
    return { success: true, ticker: String(ticker).toUpperCase(), count: data.length, snapshots: data };
  }
  const { data, error } = await supabase
    .from('signals')
    .select('ticker, name, rating, rating_score, timeframe, scanned_at, chart_image_url')
    .order('scanned_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return { success: true, count: data.length, signals: data };
}
