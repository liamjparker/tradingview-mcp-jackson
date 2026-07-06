import { readFileSync } from 'fs';
import { register } from '../router.js';
import * as core from '../../core/publish.js';

function loadPayload(opts) {
  if (opts.file) return JSON.parse(readFileSync(opts.file, 'utf8'));
  if (opts.json) return JSON.parse(opts.json);
  throw new Error('Provide a scan payload with --file <path.json> or --json \'{...}\'.');
}

register('db', {
  description: 'Publish/read TradingView scans to the Supabase portfolio database',
  subcommands: new Map([
    ['health', {
      description: 'Check Supabase connection + tables',
      handler: () => core.dbHealthCheck(),
    }],
    ['publish', {
      description: 'Publish a scan payload (JSON object, or array) to the database',
      options: {
        file: { type: 'string', short: 'f', description: 'Path to a JSON file with the scan payload' },
        json: { type: 'string', short: 'j', description: 'Inline JSON scan payload' },
      },
      handler: (opts) => {
        const payload = loadPayload(opts);
        return Array.isArray(payload) ? core.publishScans(payload) : core.publishScan(payload);
      },
    }],
    ['recent', {
      description: 'Read recent scans (latest per ticker, or one ticker\'s history)',
      options: {
        ticker: { type: 'string', short: 't', description: 'Ticker to fetch weekly history for' },
        limit: { type: 'string', short: 'n', description: 'Max rows (default 10)' },
      },
      handler: (opts) => core.getRecentScans({ ticker: opts.ticker, limit: opts.limit ? Number(opts.limit) : undefined }),
    }],
  ]),
});
