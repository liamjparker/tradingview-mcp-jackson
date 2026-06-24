import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeScannedAt,
  scanId,
  buildMetrics,
  buildSignalsRow,
  buildSnapshotRow,
  buildScanRow,
} from '../src/core/publish.js';

const sampleScan = {
  ticker: 'nvda',
  name: 'NVIDIA Corporation',
  timeframe: 'W',
  scanned_at: '2026-06-24',
  rating: 'Strong Buy',
  rating_score: 0.8,
  bias: 'bullish',
  bx_trender: { state: 'bullish', longTerm: 1.1, shortTerm: 4.2 },
  volume_profile: { poc: 118.5, vah: 124, val: 110.2, nodes: [] },
  levels: { pivots: { p: 120.1 }, support: [110, 102.5], resistance: [128, 135.5] },
  rules_flags: { breakout: true },
  quote: { last: 123.8, low52: 86.6, high52: 153.1, volume: 412000000, changePct: 1.4, pctFromHigh: -19.1 },
  oscillators: { rsi: 64, macd: { hist: 0.5 } },
  moving_averages: { priceVsSma200Pct: 20.9 },
  raw: {
    study_values: [{ name: 'Relative Strength Index', values: { RSI: '64' } }],
    pine_boxes: [{ name: 'THT Volume Pro', zones: [{ high: 124, low: 110 }] }],
    ohlcv_summary: { high: 130, low: 100 },
  },
  indicators_applied: ['THT Volume Pro', 'THT Multi Timeframe BX'],
  screenshot_path: '/tmp/nvda.png',
  notes: 'weekly scan',
};

test('normalizeScannedAt keeps plain dates and trims timestamps', () => {
  assert.equal(normalizeScannedAt('2026-06-24'), '2026-06-24');
  assert.equal(normalizeScannedAt('2026-06-24T18:30:00Z'), '2026-06-24');
});

test('normalizeScannedAt defaults to today (YYYY-MM-DD)', () => {
  assert.match(normalizeScannedAt(undefined), /^\d{4}-\d{2}-\d{2}$/);
});

test('scanId upper-cases ticker and joins with date', () => {
  assert.equal(scanId('nvda', '2026-06-24'), 'NVDA_2026-06-24');
});

test('buildSignalsRow maps to the signals contract with uppercase id', () => {
  const row = buildSignalsRow(sampleScan, { scannedAt: '2026-06-24', chartImageUrl: 'https://x/y.png' });
  assert.equal(row.id, 'NVDA');
  assert.equal(row.ticker, 'NVDA');
  assert.equal(row.rating, 'Strong Buy');
  assert.equal(row.rating_score, 0.8);
  assert.equal(row.chart_image_url, 'https://x/y.png');
  assert.deepEqual(row.volume_profile, sampleScan.volume_profile);
  assert.deepEqual(row.quote, sampleScan.quote);
});

test('buildSignalsRow defaults timeframe to W and nulls missing fields', () => {
  const row = buildSignalsRow({ ticker: 'aapl' }, { scannedAt: '2026-06-24' });
  assert.equal(row.timeframe, 'W');
  assert.equal(row.rating, null);
  assert.equal(row.chart_image_url, null);
});

test('buildSnapshotRow builds composite id and metrics', () => {
  const row = buildSnapshotRow(sampleScan, { scannedAt: '2026-06-24' });
  assert.equal(row.id, 'NVDA_2026-06-24');
  assert.equal(row.ticker, 'NVDA');
  assert.deepEqual(row.metrics, {
    bxTrender: { state: 'bullish' },
    oscillators: { rsi: 64, macd: { hist: 0.5 } },
    moving_averages: { priceVsSma200Pct: 20.9 },
  });
});

test('buildMetrics prefers an explicit metrics object', () => {
  const explicit = { custom: true };
  assert.deepEqual(buildMetrics({ ...sampleScan, metrics: explicit }), explicit);
});

test('buildScanRow carries raw capture, screenshot and bias', () => {
  const row = buildScanRow(sampleScan, { scannedAt: '2026-06-24', chartImageUrl: 'https://x/y.png' });
  assert.equal(row.id, 'NVDA_2026-06-24');
  assert.equal(row.bias, 'bullish');
  assert.equal(row.source, 'tradingview-mcp');
  assert.deepEqual(row.study_values, sampleScan.raw.study_values);
  assert.deepEqual(row.pine_boxes, sampleScan.raw.pine_boxes);
  assert.deepEqual(row.ohlcv_summary, sampleScan.raw.ohlcv_summary);
  assert.equal(row.screenshot_path, '/tmp/nvda.png');
  assert.equal(row.chart_image_url, 'https://x/y.png');
  assert.deepEqual(row.indicators_applied, ['THT Volume Pro', 'THT Multi Timeframe BX']);
  // null-safe when raw is absent
  const bare = buildScanRow({ ticker: 'msft' }, { scannedAt: '2026-06-24' });
  assert.equal(bare.study_values, null);
  assert.equal(bare.pine_boxes, null);
});
