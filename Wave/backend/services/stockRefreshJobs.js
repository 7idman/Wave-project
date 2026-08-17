const { execute, queryOne, withTransaction } = require("../db");
const { fetchStockPrices, STOCK_SYMBOLS } = require("./stocks");
const { runWithSchedulerLease } = require("./schedulerLease");

const DEFAULT_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 15 * 1000;
const STALE_JOB_MINUTES = 5;

function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    total: row.total,
    processed: row.processed,
    updated: row.updated,
    skipped: row.skipped,
    lastSymbol: row.last_symbol,
    error: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function getStockRefreshJob(jobId) {
  return publicJob(await queryOne("SELECT * FROM stock_refresh_jobs WHERE id = ?", [jobId]));
}

async function getLatestStockRefreshJob() {
  return publicJob(await queryOne("SELECT * FROM stock_refresh_jobs ORDER BY id DESC LIMIT 1"));
}

async function enqueueStockRefresh({ requestedBy = null, source = "scheduled" } = {}) {
  const safeSource = source === "admin" ? "admin" : "scheduled";
  try {
    return await withTransaction(async tx => {
      const active = await tx.queryOne(
        "SELECT * FROM stock_refresh_jobs WHERE active_key = 1 LIMIT 1"
      );
      if (active) return { job: publicJob(active), created: false };

      const inserted = await tx.execute(
        `INSERT INTO stock_refresh_jobs
           (requested_by, source, status, active_key, total)
         VALUES (?, ?, 'pending', 1, ?)`,
        [requestedBy, safeSource, STOCK_SYMBOLS.length]
      );
      const job = await tx.queryOne(
        "SELECT * FROM stock_refresh_jobs WHERE id = ?",
        [inserted.lastInsertRowid]
      );
      return { job: publicJob(job), created: true };
    });
  } catch (error) {
    // The unique active_key is the cross-replica guard. If another replica
    // inserted first, return that shared job rather than creating duplicates.
    if (!/UNIQUE/i.test(error.message || "")) throw error;
    const concurrent = await queryOne(
      "SELECT * FROM stock_refresh_jobs WHERE active_key = 1 LIMIT 1"
    );
    if (!concurrent) throw error;
    return { job: publicJob(concurrent), created: false };
  }
}

async function claimStockRefreshJob() {
  return withTransaction(async tx => {
    const candidate = await tx.queryOne(
      `SELECT * FROM stock_refresh_jobs
       WHERE status = 'pending'
          OR (status = 'processing' AND claimed_at <= datetime('now', ?))
       ORDER BY id
       LIMIT 1`,
      [`-${STALE_JOB_MINUTES} minutes`]
    );
    if (!candidate) return null;

    const claim = await tx.execute(
      `UPDATE stock_refresh_jobs
       SET status = 'processing', processed = 0, updated = 0, skipped = 0,
           last_symbol = NULL, last_error = NULL, claimed_at = datetime('now'),
           completed_at = NULL, updated_at = datetime('now')
       WHERE id = ?
         AND (status = 'pending'
              OR (status = 'processing' AND claimed_at <= datetime('now', ?)))`,
      [candidate.id, `-${STALE_JOB_MINUTES} minutes`]
    );
    if (claim.rowsAffected === 0) return null;
    return tx.queryOne("SELECT * FROM stock_refresh_jobs WHERE id = ?", [candidate.id]);
  });
}

async function runClaimedJob(job) {
  try {
    const result = await fetchStockPrices({
      onProgress: async progress => {
        if (progress.processed % 5 !== 0 && progress.processed !== progress.total) return;
        await execute(
          `UPDATE stock_refresh_jobs
           SET total = ?, processed = ?, updated = ?, skipped = ?,
               last_symbol = ?, updated_at = datetime('now')
           WHERE id = ? AND status = 'processing'`,
          [
            progress.total,
            progress.processed,
            progress.updated,
            progress.skipped,
            progress.lastSymbol,
            job.id,
          ]
        );
      },
    });

    await execute(
      `UPDATE stock_refresh_jobs
       SET status = 'completed', active_key = NULL, total = ?, processed = ?,
           updated = ?, skipped = ?, last_error = NULL,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ? AND status = 'processing'`,
      [result.total, result.processed, result.updated, result.skipped, job.id]
    );
    console.log(`[info] Stock refresh ${job.id}: ${result.updated} updated, ${result.skipped} skipped`);
  } catch (error) {
    await execute(
      `UPDATE stock_refresh_jobs
       SET status = 'failed', active_key = NULL, last_error = ?,
           completed_at = datetime('now'), updated_at = datetime('now')
       WHERE id = ?`,
      [String(error.message || error).slice(0, 500), job.id]
    );
    console.error(`Stock refresh ${job.id} failed:`, error.message);
  }
  return getStockRefreshJob(job.id);
}

let localDrain = null;
let schedulingInFlight = null;
async function processPendingStockRefreshJobs() {
  if (localDrain) return localDrain;
  localDrain = (async () => {
    const job = await claimStockRefreshJob();
    return job ? runClaimedJob(job) : null;
  })();
  try {
    return await localDrain;
  } finally {
    localDrain = null;
  }
}

function triggerStockRefreshProcessing() {
  processPendingStockRefreshJobs().catch(error => {
    console.error("Stock refresh worker failed:", error.message);
  });
}

function startStockRefreshSchedule({
  refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
} = {}) {
  const schedule = () => {
    if (schedulingInFlight) return schedulingInFlight;
    schedulingInFlight = (async () => {
      if (!process.env.FINNHUB_API_KEY) return;
      await runWithSchedulerLease("stock-refresh-schedule", refreshIntervalMs, async () => {
        await execute("DELETE FROM stock_refresh_jobs WHERE active_key IS NULL AND created_at < datetime('now', '-30 days')");
        await enqueueStockRefresh({ source: "scheduled" });
      });
      triggerStockRefreshProcessing();
    })().finally(() => { schedulingInFlight = null; });
    return schedulingInFlight;
  };

  schedule().catch(error => console.error("Stock refresh scheduling failed:", error.message));
  const refreshHandle = setInterval(() => {
    schedule().catch(error => console.error("Stock refresh scheduling failed:", error.message));
  }, refreshIntervalMs);
  const pollHandle = setInterval(triggerStockRefreshProcessing, pollIntervalMs);
  return { refreshHandle, pollHandle };
}

async function waitForStockRefreshIdle() {
  while (schedulingInFlight || localDrain) {
    await Promise.allSettled([schedulingInFlight, localDrain].filter(Boolean));
  }
}

module.exports = {
  enqueueStockRefresh,
  getStockRefreshJob,
  getLatestStockRefreshJob,
  processPendingStockRefreshJobs,
  triggerStockRefreshProcessing,
  startStockRefreshSchedule,
  waitForStockRefreshIdle,
};
