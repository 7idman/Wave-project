/**
 * services/stocks.js
 * Fetches real stock quotes from Finnhub and writes them into price_cache
 * (asset_type='stock'), so stocks slot into the exact same trading engine,
 * holdings table, and price-history snapshots already built for crypto —
 * no parallel system needed.
 *
 * Requires FINNHUB_API_KEY as a Railway environment variable — never
 * hardcode the key in source.
 */

const { execute } = require("../db");
const { fetchWithTimeout } = require("../utils/http");

// A curated, broad set across major sectors — not "all stocks," but wide
// enough to be useful. At the current 5-minute refresh cycle this averages
// ~8 calls/min, well inside Finnhub's 60/min free-tier limit even with
// this many symbols. Easy to extend further — just add to this list.
const STOCK_NAMES = {
  // Tech
  AAPL: "Apple Inc.", MSFT: "Microsoft Corp.", GOOGL: "Alphabet Inc.", AMZN: "Amazon.com Inc.",
  TSLA: "Tesla Inc.", NVDA: "NVIDIA Corp.", META: "Meta Platforms", NFLX: "Netflix Inc.",
  ADBE: "Adobe Inc.", CRM: "Salesforce Inc.", ORCL: "Oracle Corp.", INTC: "Intel Corp.",
  AMD: "Advanced Micro Devices", CSCO: "Cisco Systems", IBM: "IBM Corp.",
  // Finance
  JPM: "JPMorgan Chase", V: "Visa Inc.", MA: "Mastercard Inc.", BAC: "Bank of America",
  WFC: "Wells Fargo", GS: "Goldman Sachs", MS: "Morgan Stanley", AXP: "American Express",
  // Healthcare
  JNJ: "Johnson & Johnson", PFE: "Pfizer Inc.", UNH: "UnitedHealth Group",
  ABBV: "AbbVie Inc.", MRK: "Merck & Co.", LLY: "Eli Lilly and Co.",
  // Consumer
  WMT: "Walmart Inc.", PG: "Procter & Gamble", KO: "Coca-Cola Co.", PEP: "PepsiCo Inc.",
  MCD: "McDonald's Corp.", NKE: "Nike Inc.", SBUX: "Starbucks Corp.", DIS: "Walt Disney Co.",
  HD: "Home Depot Inc.", COST: "Costco Wholesale",
  // Energy & Industrials
  XOM: "Exxon Mobil Corp.", CVX: "Chevron Corp.", BA: "Boeing Co.", CAT: "Caterpillar Inc.", GE: "General Electric",
  // Telecom
  T: "AT&T Inc.", VZ: "Verizon Communications",
};
const STOCK_SYMBOLS = Object.keys(STOCK_NAMES);

// Finnhub counts requests in short windows, so sending the whole symbol list
// concurrently can receive HTTP 429 even when the five-minute average looks
// safe. All quote calls in this process share this queue and are kept below
// one request per second by default. The values remain configurable for paid
// plans without requiring a code change.
const DEFAULT_REQUEST_INTERVAL_MS = 1100;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 61_000;
const MAX_RATE_LIMIT_RETRIES = 1;

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function requestIntervalMs() {
  return positiveInteger(
    process.env.FINNHUB_REQUEST_INTERVAL_MS,
    DEFAULT_REQUEST_INTERVAL_MS
  );
}

function defaultCooldownMs() {
  return positiveInteger(
    process.env.FINNHUB_RATE_LIMIT_COOLDOWN_MS,
    DEFAULT_RATE_LIMIT_COOLDOWN_MS
  );
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function retryAfterMs(response) {
  const raw = response.headers.get("retry-after");
  if (!raw) return defaultCooldownMs();

  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.max(1000, Math.ceil(seconds * 1000));
  }

  const retryAt = Date.parse(raw);
  return Number.isFinite(retryAt)
    ? Math.max(1000, retryAt - Date.now())
    : defaultCooldownMs();
}

let requestQueue = Promise.resolve();
let nextRequestAt = 0;
let rateLimitUntil = 0;

function queueFinnhubRequest(url) {
  const request = requestQueue.then(async () => {
    const waitMs = Math.max(nextRequestAt, rateLimitUntil) - Date.now();
    if (waitMs > 0) await sleep(waitMs);

    const response = await fetchWithTimeout(url);
    nextRequestAt = Date.now() + requestIntervalMs();
    if (response.status === 429) {
      rateLimitUntil = Math.max(
        rateLimitUntil,
        Date.now() + retryAfterMs(response)
      );
    }
    return response;
  });

  // A failed request must not poison the shared queue for later refreshes.
  requestQueue = request.catch(() => undefined);
  return request;
}

async function fetchStockQuote(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY is not set");

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
  let res;
  for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
    res = await queueFinnhubRequest(url);
    if (res.status !== 429) break;
    if (attempt === MAX_RATE_LIMIT_RETRIES) {
      const error = new Error(`Finnhub rate limit persisted for ${symbol} after retry`);
      error.code = "FINNHUB_RATE_LIMITED";
      throw error;
    }
    console.warn(`Stocks: Finnhub rate-limited ${symbol}; waiting before one retry`);
  }

  if (!res.ok) throw new Error(`Finnhub request failed for ${symbol}: HTTP ${res.status}`);
  const data = await res.json();

  // Finnhub returns c:0 for an invalid/unknown symbol rather than an error
  // status — treat that as "no real data" instead of writing a fake $0 price.
  if (!data || typeof data.c !== "number" || data.c === 0) {
    throw new Error(`No quote data returned for ${symbol}`);
  }

  return {
    symbol,
    price: data.c,
    // Finnhub gives the day's absolute + percent change directly (dp) —
    // reuse that rather than recomputing it ourselves.
    change24h: typeof data.dp === "number" ? data.dp : 0,
  };
}

let inFlightStockFetch = null;
async function fetchStockPrices(options = {}) {
  if (inFlightStockFetch) return inFlightStockFetch;
  inFlightStockFetch = runStockRefresh(options);
  try {
    return await inFlightStockFetch;
  } finally {
    inFlightStockFetch = null;
  }
}

async function runStockRefresh({ onProgress } = {}) {
  if (!process.env.FINNHUB_API_KEY) {
    console.warn("Stocks: FINNHUB_API_KEY not set; skipping stock price fetch");
    return { total: STOCK_SYMBOLS.length, processed: 0, updated: 0, skipped: STOCK_SYMBOLS.length };
  }
  let updated = 0;
  let processed = 0;
  let rateLimited = false;
  for (const symbol of STOCK_SYMBOLS) {
    try {
      const quote = await fetchStockQuote(symbol);
      await execute(
        `INSERT INTO price_cache (symbol, price, change_24h, asset_type, updated_at)
         VALUES (?, ?, ?, 'stock', datetime('now'))
         ON CONFLICT(symbol) DO UPDATE SET price=excluded.price, change_24h=excluded.change_24h, asset_type='stock', updated_at=excluded.updated_at`,
        [quote.symbol, quote.price, quote.change24h]
      );
      updated++;
    } catch (err) {
      if (err.code === "FINNHUB_RATE_LIMITED") {
        console.warn(`Stocks: ${err.message}; ending this refresh early`);
        rateLimited = true;
      } else {
        // One bad symbol must never stop the rest of the refresh.
        console.error(`Stock price fetch failed for ${symbol}:`, err.message);
      }
    } finally {
      processed++;
      if (onProgress) {
        try {
          await onProgress({
            total: STOCK_SYMBOLS.length,
            processed,
            updated,
            skipped: processed - updated,
            lastSymbol: symbol,
          });
        } catch (progressError) {
          console.error("Stock refresh progress update failed:", progressError.message);
        }
      }
    }
    if (rateLimited) break;
  }
  return {
    total: STOCK_SYMBOLS.length,
    processed,
    updated,
    skipped: STOCK_SYMBOLS.length - updated,
    rateLimited,
  };
}

module.exports = { fetchStockPrices, fetchStockQuote, STOCK_SYMBOLS };
