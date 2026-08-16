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

async function fetchStockQuote(symbol) {
  const apiKey = process.env.FINNHUB_API_KEY;
  if (!apiKey) throw new Error("FINNHUB_API_KEY is not set");

  const res = await fetchWithTimeout(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${apiKey}`);
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
async function fetchStockPrices() {
  if (inFlightStockFetch) return inFlightStockFetch;
  inFlightStockFetch = runStockRefresh();
  try {
    return await inFlightStockFetch;
  } finally {
    inFlightStockFetch = null;
  }
}

async function runStockRefresh() {
  if (!process.env.FINNHUB_API_KEY) {
    console.warn("Stocks: FINNHUB_API_KEY not set — skipping stock price fetch");
    return { updated: 0, skipped: STOCK_SYMBOLS.length };
  }
  let updated = 0;
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < STOCK_SYMBOLS.length) {
      const symbol = STOCK_SYMBOLS[nextIndex++];
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
        // One bad symbol must never stop the rest of the refresh.
        console.error(`Stock price fetch failed for ${symbol}:`, err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: 4 }, () => worker()));
  return { updated, skipped: STOCK_SYMBOLS.length - updated };
}

module.exports = { fetchStockPrices, fetchStockQuote, STOCK_SYMBOLS, STOCK_NAMES };
