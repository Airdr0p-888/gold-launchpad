/**
 * refresh-tokens.js
 * Fetches Ave.ai market data for all tokens in tokens.json and updates cached data.
 * Runs via GitHub Actions every 30 minutes.
 *
 * Usage: node refresh-tokens.js
 * Requires: AVE_API_KEY env var
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const TOKENS_FILE = path.join(__dirname, 'tokens.json');
const AVE_API_KEY = process.env.AVE_API_KEY || 'UgbYEGOBtEx8r3uLTxCJPx7sEaYYMvZ6219iLSdYBUIFwbzu3HZ9qMeMprSdkHp9';
const AVE_HOST = 'prod.ave-api.com';

function fetchAveToken(address) {
  return new Promise((resolve, reject) => {
    const url = `/v2/tokens?keyword=${encodeURIComponent(address)}&chain=bsc`;
    const req = https.request(
      {
        hostname: AVE_HOST,
        path: url,
        method: 'GET',
        headers: { 'X-API-KEY': AVE_API_KEY },
        timeout: 15000,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            const tokens = data?.data || [];
            const match = Array.isArray(tokens)
              ? tokens.find((t) => (t.token || '').toLowerCase() === address.toLowerCase())
              : null;
            resolve(match);
          } catch (e) {
            reject(new Error('JSON parse error: ' + e.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

async function main() {
  console.log('[refresh-tokens] Starting...');
  console.log('[refresh-tokens] Reading', TOKENS_FILE);

  const raw = fs.readFileSync(TOKENS_FILE, 'utf-8');
  const entries = JSON.parse(raw);

  console.log(`[refresh-tokens] Found ${entries.length} token(s)`);

  let updated = 0;
  for (const entry of entries) {
    const addr = entry.address;
    console.log(`[refresh-tokens] Fetching ${addr}...`);
    try {
      const match = await fetchAveToken(addr);
      if (match) {
        entry.cached = {
          symbol: match.symbol || entry.cached?.symbol || '',
          name: match.name || entry.cached?.name || '',
          price_usd: String(match.current_price_usd ?? entry.cached?.price_usd ?? ''),
          change_24h: String(match.price_change_24h ?? entry.cached?.change_24h ?? ''),
          volume_24h: String(match.tx_volume_u_24h ?? entry.cached?.volume_24h ?? ''),
          market_cap: String(match.market_cap ?? entry.cached?.market_cap ?? ''),
          holders: match.holders ?? entry.cached?.holders ?? 0,
          updated_at: Math.floor(Date.now() / 1000),
        };
        updated++;
        console.log(`  -> ${match.symbol}: $${match.current_price_usd} | ${match.price_change_24h}%`);
      } else {
        console.log(`  -> Not found on Ave.ai, keeping cached data`);
      }
    } catch (err) {
      console.log(`  -> Error: ${err.message}, keeping cached data`);
    }
  }

  // Write back
  fs.writeFileSync(TOKENS_FILE, JSON.stringify(entries, null, 2) + '\n', 'utf-8');
  console.log(`\n[refresh-tokens] Done. Updated ${updated}/${entries.length} token(s).`);

  // Exit with error if no tokens were updated (might indicate API issue)
  if (updated === 0 && entries.length > 0) {
    console.log('[refresh-tokens] WARNING: No tokens updated, API might be down.');
  }
}

main().catch((err) => {
  console.error('[refresh-tokens] Fatal error:', err.message);
  process.exit(1);
});
