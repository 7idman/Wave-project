/**
 * Weekly recurring stock purchases. Each due plan is claimed and executed in
 * one transaction so concurrent scheduler instances cannot buy it twice.
 */

const { queryAll, withTransaction } = require("../db");
const { runWithSchedulerLease } = require("./schedulerLease");
const { dollarsFromCents } = require("../utils/money");

async function runDuePlan(plan) {
  const nextRunAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");

  return withTransaction(async tx => {
    // Advancing next_run_at doubles as an atomic claim of this occurrence.
    const claim = await tx.execute(
      "UPDATE auto_invest_plans SET last_run_at = datetime('now'), next_run_at = ? WHERE id = ? AND status = 'active' AND next_run_at <= datetime('now')",
      [nextRunAt, plan.id]
    );
    if (claim.rowsAffected === 0) {
      return { status: "skipped", reason: "already_processed" };
    }

    const priceRow = await tx.queryOne(
      "SELECT price FROM price_cache WHERE symbol = ?",
      [plan.symbol]
    );
    if (!priceRow) {
      await tx.execute(
        "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, ?, ?, 0)",
        [plan.user_id, "auto_invest_skipped", `Skipped this week's $${plan.weekly_amount} auto-invest into ${plan.symbol} — price unavailable.`]
      );
      return { status: "skipped", reason: "no_price" };
    }

    const weeklyAmount = dollarsFromCents(plan.weekly_amount_cents);
    const price = priceRow.price;
    const shares = parseFloat((weeklyAmount / price).toFixed(8));
    const deduction = await tx.execute(
      "UPDATE users SET cash_balance_cents = cash_balance_cents - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance_cents >= ?",
      [plan.weekly_amount_cents, plan.user_id, plan.weekly_amount_cents]
    );

    if (deduction.rowsAffected === 0) {
      await tx.execute(
        "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, ?, ?, 0)",
        [plan.user_id, "auto_invest_skipped", `Skipped this week's $${plan.weekly_amount} auto-invest into ${plan.symbol} — insufficient balance.`]
      );
      return { status: "skipped", reason: "insufficient_balance" };
    }

    await tx.execute(
      `INSERT INTO holdings (user_id, symbol, amount, updated_at) VALUES (?, ?, ?, datetime('now'))
       ON CONFLICT(user_id, symbol) DO UPDATE SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
      [plan.user_id, plan.symbol, shares]
    );
    await tx.execute(
      "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, fee_cents, total, total_cents, status, source) VALUES (?, 'buy', ?, ?, ?, 0, 0, ?, ?, 'completed', 'auto_invest')",
      [plan.user_id, plan.symbol, shares, price, weeklyAmount, plan.weekly_amount_cents]
    );
    await tx.execute(
      "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, ?, ?, 0)",
      [plan.user_id, "auto_invest_executed", `Auto-invest: bought $${plan.weekly_amount} of ${plan.symbol} (${shares} shares)`]
    );
    return { status: "executed", shares, price };
  });
}

let inFlightDuePlans = null;
let scheduledRun = null;
async function runDuePlans() {
  if (inFlightDuePlans) return inFlightDuePlans;
  inFlightDuePlans = executeDuePlans();
  try {
    return await inFlightDuePlans;
  } finally {
    inFlightDuePlans = null;
  }
}

async function executeDuePlans() {
  const due = await queryAll(
    "SELECT * FROM auto_invest_plans WHERE status = 'active' AND next_run_at <= datetime('now')"
  );
  const results = [];
  for (const plan of due) {
    try {
      results.push(await runDuePlan(plan));
    } catch (err) {
      // A transient failure for one plan must not block everyone else's run.
      console.error(`Auto-invest plan ${plan.id} failed:`, err.message);
      results.push({ status: "error", planId: plan.id });
    }
  }
  return results;
}

function startAutoInvestSchedule(intervalMs = 60 * 60 * 1000) {
  const run = () => {
    if (scheduledRun) return scheduledRun;
    scheduledRun = runWithSchedulerLease("auto-invest", intervalMs, runDuePlans)
      .finally(() => { scheduledRun = null; });
    return scheduledRun;
  };
  run().catch(err => console.error("Auto-invest run failed:", err.message));
  const handle = setInterval(() => {
    run().catch(err => console.error("Auto-invest run failed:", err.message));
  }, intervalMs);
  return handle;
}

async function waitForAutoInvestIdle() {
  while (scheduledRun || inFlightDuePlans) {
    await Promise.allSettled([scheduledRun, inFlightDuePlans].filter(Boolean));
  }
}

module.exports = { startAutoInvestSchedule, waitForAutoInvestIdle };
