/**
 * Durable strategy-trade mirroring.
 *
 * The strategy trade and its subscriber jobs are committed together. Workers
 * claim jobs atomically, and the actual balance/holding change, mirror audit
 * row, activity entry, and job completion share one transaction. This makes a
 * restart safe at every boundary and allows multiple server instances.
 */

const { queryAll, queryOne, withTransaction } = require("../db");

const MAX_ATTEMPTS = 5;
const STALE_CLAIM_MINUTES = 5;
const DEFAULT_BATCH_SIZE = 50;

async function enqueueStrategyMirrorJobs(tx, { strategyId, tradeId, proportion }) {
  const subscribers = await tx.queryAll(
    "SELECT id, user_id FROM portfolios WHERE type = 'copier' AND strategy_id = ?",
    [strategyId]
  );

  let queued = 0;
  for (const subscriber of subscribers) {
    const inserted = await tx.execute(
      `INSERT OR IGNORE INTO strategy_mirror_jobs
         (strategy_trade_id, user_id, portfolio_id, proportion)
       VALUES (?, ?, ?, ?)`,
      [tradeId, subscriber.user_id, subscriber.id, proportion]
    );
    queued += inserted.rowsAffected;
  }
  return queued;
}

async function claimJob(jobId) {
  return withTransaction(async tx => {
    const claim = await tx.execute(
      `UPDATE strategy_mirror_jobs
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           claimed_at = datetime('now'),
           updated_at = datetime('now'),
           last_error = NULL
       WHERE id = ?
         AND attempt_count < ?
         AND (
           status IN ('pending', 'retry')
           OR (status = 'processing' AND claimed_at <= datetime('now', ?))
         )`,
      [jobId, MAX_ATTEMPTS, `-${STALE_CLAIM_MINUTES} minutes`]
    );
    return claim.rowsAffected > 0;
  });
}

async function finishJob(tx, jobId, status, lastError = null) {
  await tx.execute(
    `UPDATE strategy_mirror_jobs
     SET status = ?, completed_at = datetime('now'), last_error = ?, updated_at = datetime('now')
     WHERE id = ? AND status = 'processing'`,
    [status, lastError, jobId]
  );
}

async function applyClaimedJob(jobId) {
  return withTransaction(async tx => {
    const job = await tx.queryOne(
      `SELECT j.id, j.user_id, j.portfolio_id, j.proportion, j.status,
              t.id AS trade_id, t.strategy_id, t.symbol, t.side, t.price,
              s.name AS strategy_name,
              p.user_id AS portfolio_user_id, p.type AS portfolio_type,
              p.strategy_id AS portfolio_strategy_id
       FROM strategy_mirror_jobs j
       JOIN strategy_trades t ON t.id = j.strategy_trade_id
       JOIN strategies s ON s.id = t.strategy_id
       JOIN portfolios p ON p.id = j.portfolio_id
       WHERE j.id = ? AND j.status = 'processing'`,
      [jobId]
    );
    if (!job) return { jobId, status: "not_claimed" };

    const existingMirror = await tx.queryOne(
      "SELECT mirrored_amount, mirrored_price FROM strategy_trade_mirrors WHERE strategy_trade_id = ? AND portfolio_id = ?",
      [job.trade_id, job.portfolio_id]
    );
    if (existingMirror) {
      await finishJob(tx, jobId, "completed");
      return {
        jobId,
        portfolioId: job.portfolio_id,
        status: "completed",
        mirroredQty: existingMirror.mirrored_amount,
        mirroredDollar: existingMirror.mirrored_amount * existingMirror.mirrored_price,
        recovered: true,
      };
    }

    if (
      job.portfolio_type !== "copier"
      || job.portfolio_strategy_id !== job.strategy_id
      || job.portfolio_user_id !== job.user_id
    ) {
      const reason = "Subscriber portfolio no longer matches this strategy";
      await finishJob(tx, jobId, "skipped", reason);
      return { jobId, portfolioId: job.portfolio_id, status: "skipped", reason };
    }

    const value = await tx.queryOne(
      `SELECT p.cash_balance AS cash_balance,
              COALESCE(SUM(ph.amount * pc.price), 0) AS holdings_value
       FROM portfolios p
       LEFT JOIN portfolio_holdings ph ON ph.portfolio_id = p.id
       LEFT JOIN price_cache pc ON pc.symbol = ph.symbol
       WHERE p.id = ?
       GROUP BY p.id, p.cash_balance`,
      [job.portfolio_id]
    );
    const totalValue = Number(value?.cash_balance || 0) + Number(value?.holdings_value || 0);
    const price = Number(job.price);
    const proportion = Number(job.proportion);
    if (!Number.isFinite(totalValue) || totalValue <= 0 || !Number.isFinite(price) || price <= 0 || !Number.isFinite(proportion) || proportion <= 0) {
      const reason = "Portfolio value or mirror sizing is unavailable";
      await finishJob(tx, jobId, "skipped", reason);
      return { jobId, portfolioId: job.portfolio_id, status: "skipped", reason };
    }

    const mirroredDollar = Number((totalValue * proportion).toFixed(8));
    const mirroredQty = Number((mirroredDollar / price).toFixed(8));
    if (mirroredDollar <= 0 || mirroredQty <= 0) {
      const reason = "Mirror amount rounds to zero";
      await finishJob(tx, jobId, "skipped", reason);
      return { jobId, portfolioId: job.portfolio_id, status: "skipped", reason };
    }

    if (job.side === "buy") {
      const deduction = await tx.execute(
        "UPDATE portfolios SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
        [mirroredDollar, job.portfolio_id, mirroredDollar]
      );
      if (deduction.rowsAffected === 0) {
        const reason = "Insufficient cash";
        await finishJob(tx, jobId, "skipped", reason);
        return { jobId, portfolioId: job.portfolio_id, status: "skipped", reason };
      }
      await tx.execute(
        `INSERT INTO portfolio_holdings (portfolio_id, symbol, amount, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT(portfolio_id, symbol) DO UPDATE
         SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
        [job.portfolio_id, job.symbol, mirroredQty]
      );
    } else {
      const deduction = await tx.execute(
        "UPDATE portfolio_holdings SET amount = amount - ?, updated_at = datetime('now') WHERE portfolio_id = ? AND symbol = ? AND amount >= ?",
        [mirroredQty, job.portfolio_id, job.symbol, mirroredQty]
      );
      if (deduction.rowsAffected === 0) {
        const reason = "Insufficient holdings";
        await finishJob(tx, jobId, "skipped", reason);
        return { jobId, portfolioId: job.portfolio_id, status: "skipped", reason };
      }
      await tx.execute(
        "UPDATE portfolios SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
        [mirroredDollar, job.portfolio_id]
      );
    }

    await tx.execute(
      `INSERT INTO strategy_trade_mirrors
         (strategy_trade_id, user_id, portfolio_id, mirrored_amount, mirrored_price)
       VALUES (?, ?, ?, ?, ?)`,
      [job.trade_id, job.user_id, job.portfolio_id, mirroredQty, price]
    );
    await tx.execute(
      "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'strategy_mirror', ?, 0)",
      [job.user_id, `${job.strategy_name}: ${job.side === "buy" ? "bought" : "sold"} ${job.symbol} mirrored into your copier account`]
    );
    await finishJob(tx, jobId, "completed");
    return { jobId, portfolioId: job.portfolio_id, status: "completed", mirroredDollar, mirroredQty };
  });
}

async function recordJobFailure(jobId, error) {
  const message = String(error?.message || error || "Unknown mirror error").slice(0, 500);
  return withTransaction(async tx => {
    const job = await tx.queryOne(
      "SELECT attempt_count, status FROM strategy_mirror_jobs WHERE id = ?",
      [jobId]
    );
    if (!job) return "missing";
    if (job.status !== "processing") return job.status;
    const status = job.attempt_count >= MAX_ATTEMPTS ? "failed" : "retry";
    await tx.execute(
      `UPDATE strategy_mirror_jobs
       SET status = ?, last_error = ?, claimed_at = NULL, updated_at = datetime('now')
       WHERE id = ? AND status = 'processing'`,
      [status, message, jobId]
    );
    return status;
  });
}

async function processJob(jobId) {
  if (!await claimJob(jobId)) return { jobId, status: "not_claimed" };
  try {
    return await applyClaimedJob(jobId);
  } catch (error) {
    const status = await recordJobFailure(jobId, error);
    console.error(`Strategy mirror job ${jobId} failed:`, error.message);
    return { jobId, status, reason: error.message };
  }
}

async function findRunnableJobs({ tradeId = null, limit = DEFAULT_BATCH_SIZE } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || DEFAULT_BATCH_SIZE, 200));
  const params = [MAX_ATTEMPTS, `-${STALE_CLAIM_MINUTES} minutes`];
  let tradeFilter = "";
  if (tradeId != null) {
    tradeFilter = "AND strategy_trade_id = ?";
    params.push(tradeId);
  }
  params.push(safeLimit);
  return queryAll(
    `SELECT id
     FROM strategy_mirror_jobs
     WHERE attempt_count < ?
       AND (
         status IN ('pending', 'retry')
         OR (status = 'processing' AND claimed_at <= datetime('now', ?))
       )
       ${tradeFilter}
     ORDER BY id
     LIMIT ?`,
    params
  );
}

async function markExhaustedJobs() {
  const exhausted = await queryOne(
    `SELECT id FROM strategy_mirror_jobs
     WHERE attempt_count >= ?
       AND (
         status IN ('pending', 'retry')
         OR (status = 'processing' AND claimed_at <= datetime('now', ?))
       )
     LIMIT 1`,
    [MAX_ATTEMPTS, `-${STALE_CLAIM_MINUTES} minutes`]
  );
  if (!exhausted) return { rowsAffected: 0 };
  return withTransaction(async tx => tx.execute(
    `UPDATE strategy_mirror_jobs
     SET status = 'failed',
         last_error = COALESCE(last_error, 'Maximum retry attempts reached'),
         updated_at = datetime('now')
     WHERE attempt_count >= ?
       AND (
         status IN ('pending', 'retry')
         OR (status = 'processing' AND claimed_at <= datetime('now', ?))
       )`,
    [MAX_ATTEMPTS, `-${STALE_CLAIM_MINUTES} minutes`]
  ));
}

async function drainJobs(options = {}) {
  await markExhaustedJobs();
  const jobs = await findRunnableJobs(options);
  const results = [];
  for (const job of jobs) results.push(await processJob(job.id));
  return results;
}

let scheduledDrain = null;
async function processPendingStrategyMirrorJobs(options = {}) {
  if (scheduledDrain) return scheduledDrain;
  scheduledDrain = drainJobs(options);
  try {
    return await scheduledDrain;
  } finally {
    scheduledDrain = null;
  }
}

async function getTradeJobResults(tradeId) {
  const rows = await queryAll(
    `SELECT j.id AS job_id, j.portfolio_id, j.status, j.last_error,
            m.mirrored_amount, m.mirrored_price
     FROM strategy_mirror_jobs j
     LEFT JOIN strategy_trade_mirrors m
       ON m.strategy_trade_id = j.strategy_trade_id
      AND m.portfolio_id = j.portfolio_id
     WHERE j.strategy_trade_id = ?
     ORDER BY j.id`,
    [tradeId]
  );
  return rows.map(row => ({
    jobId: row.job_id,
    portfolioId: row.portfolio_id,
    status: row.status,
    ...(row.last_error ? { reason: row.last_error } : {}),
    ...(row.mirrored_amount != null ? {
      mirroredQty: row.mirrored_amount,
      mirroredDollar: row.mirrored_amount * row.mirrored_price,
    } : {}),
  }));
}

async function processStrategyMirrorJobsForTrade(tradeId) {
  await drainJobs({ tradeId, limit: 200 });
  return getTradeJobResults(tradeId);
}

async function retryStrategyMirrorJob(jobId) {
  const result = await withTransaction(async tx => tx.execute(
    `UPDATE strategy_mirror_jobs
     SET status = 'pending', attempt_count = 0, claimed_at = NULL,
         completed_at = NULL, last_error = NULL, updated_at = datetime('now')
     WHERE id = ? AND status IN ('failed', 'skipped')`,
    [jobId]
  ));
  return result.rowsAffected > 0;
}

async function listStrategyMirrorJobs({ status = null, limit = 100 } = {}) {
  const safeLimit = Math.max(1, Math.min(Number(limit) || 100, 200));
  const params = [];
  const where = status ? "WHERE j.status = ?" : "";
  if (status) params.push(status);
  params.push(safeLimit);
  return queryAll(
    `SELECT j.id, j.strategy_trade_id, j.user_id, j.portfolio_id, j.status,
            j.attempt_count, j.last_error, j.created_at, j.updated_at,
            t.symbol, t.side, s.name AS strategy_name
     FROM strategy_mirror_jobs j
     JOIN strategy_trades t ON t.id = j.strategy_trade_id
     JOIN strategies s ON s.id = t.strategy_id
     ${where}
     ORDER BY j.id DESC
     LIMIT ?`,
    params
  );
}

function startStrategyMirrorSchedule(intervalMs = 30 * 1000) {
  processPendingStrategyMirrorJobs().catch(error => console.error("Strategy mirror recovery failed:", error.message));
  const handle = setInterval(() => {
    processPendingStrategyMirrorJobs().catch(error => console.error("Strategy mirror recovery failed:", error.message));
  }, intervalMs);
  return handle;
}

module.exports = {
  enqueueStrategyMirrorJobs,
  processPendingStrategyMirrorJobs,
  processStrategyMirrorJobsForTrade,
  retryStrategyMirrorJob,
  listStrategyMirrorJobs,
  startStrategyMirrorSchedule,
};
