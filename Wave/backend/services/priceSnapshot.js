/**
 * services/priceSnapshot.js
 * Periodically copies price_cache into price_history, so there's a real
 * time series to chart later. Starts from whenever this first runs — there's
 * no way to backfill prices from before snapshotting began.
 */

const { queryAll, batch } = require("../db");
const { checkAlerts } = require("./priceAlerts");
const { runWithSchedulerLease } = require("./schedulerLease");

let inFlightSnapshot = null;
let scheduledRun = null;
async function takeSnapshot() {
  if (inFlightSnapshot) return inFlightSnapshot;
  inFlightSnapshot = runSnapshot();
  try {
    return await inFlightSnapshot;
  } finally {
    inFlightSnapshot = null;
  }
}

async function runSnapshot() {
  const prices = await queryAll("SELECT symbol, price, change_24h FROM price_cache");
  if (prices.length) {
    await batch(prices.map(price => ({
      sql: "INSERT INTO price_history (symbol, price, change_24h) VALUES (?, ?, ?)",
      args: [price.symbol, price.price, price.change_24h],
    })));
  }

  // Price alerts are checked on this same cadence, right after the fresh
  // snapshot — one scheduled job instead of a second independent interval
  // doing largely the same "look at price_cache" work.
  try {
    const alertResult = await checkAlerts();
    if (alertResult.triggered > 0) console.log(`Price alerts: ${alertResult.triggered} triggered`);
  } catch (err) {
    console.error("Price alert check failed (snapshot itself still succeeded):", err.message);
  }

  return prices.length;
}

// Every 15 minutes is enough resolution for a meaningful chart without
// writing to the database excessively at low traffic (current scale: one
// developer + a handful of testers).
function startPriceSnapshotSchedule(intervalMs = 15 * 60 * 1000) {
  const run = () => {
    if (scheduledRun) return scheduledRun;
    scheduledRun = runWithSchedulerLease("price-snapshot", intervalMs, takeSnapshot)
      .finally(() => { scheduledRun = null; });
    return scheduledRun;
  };
  run().catch(err => console.error("Price snapshot failed:", err.message));
  const handle = setInterval(() => {
    run().catch(err => console.error("Price snapshot failed:", err.message));
  }, intervalMs);
  return handle;
}

async function waitForPriceSnapshotIdle() {
  while (scheduledRun || inFlightSnapshot) {
    await Promise.allSettled([scheduledRun, inFlightSnapshot].filter(Boolean));
  }
}

module.exports = { startPriceSnapshotSchedule, waitForPriceSnapshotIdle };
