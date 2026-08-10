/**
 * services/autoInvest.js
 * Weekly recurring stock purchases. Stocks only (not crypto), per the
 * original design decision. $25 minimum weekly amount, enforced at plan
 * creation (routes/autoInvest.js) — this file just runs due plans.
 *
 * If a plan's weekly amount can't be covered when its turn comes up: skip
 * that week silently for the purchase itself, but tell the user why via
 * the existing notifyUser -> activity_log pattern. Never partial-buy,
 * never go negative, never fail loudly to the user over a routine skipped
 * week — insufficient balance on a recurring plan is a normal, expected
 * outcome, not an error state.
 */

const { queryAll, queryOne, execute } = require("../db");

async function notifyUser(userId, type, label) {
  await execute("INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, ?, ?, 0)", [userId, type, label]);
}

async function runDuePlan(plan) {
  const priceRow = await queryOne("SELECT price FROM price_cache WHERE symbol = ?", [plan.symbol]);
  const nextRunAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace("T", " ");

  if (!priceRow) {
    // Symbol went missing from price_cache since the plan was created —
    // extremely unlikely (stocks aren't delisted from Finnhub's feed
    // arbitrarily) but skip cleanly rather than crash the whole scheduler
    // run over one bad plan.
    await notifyUser(plan.user_id, "auto_invest_skipped", `Skipped this week's $${plan.weekly_amount} auto-invest into ${plan.symbol} — price unavailable.`);
    await execute("UPDATE auto_invest_plans SET last_run_at = datetime('now'), next_run_at = ? WHERE id = ?", [nextRunAt, plan.id]);
    return { status: "skipped", reason: "no_price" };
  }

  const price = priceRow.price;
  const shares = parseFloat((plan.weekly_amount / price).toFixed(8));

  // Same atomic guarded deduction as every other money-moving operation in
  // this codebase (trades.js buy/withdraw) — the balance check and the
  // deduction happen in one indivisible statement.
  const result = await execute(
    "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
    [plan.weekly_amount, plan.user_id, plan.weekly_amount]
  );

  if (result.rowsAffected === 0) {
    await notifyUser(plan.user_id, "auto_invest_skipped", `Skipped this week's $${plan.weekly_amount} auto-invest into ${plan.symbol} — insufficient balance.`);
    await execute("UPDATE auto_invest_plans SET last_run_at = datetime('now'), next_run_at = ? WHERE id = ?", [nextRunAt, plan.id]);
    return { status: "skipped", reason: "insufficient_balance" };
  }

  await execute(
    `INSERT INTO holdings (user_id, symbol, amount, updated_at) VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id, symbol) DO UPDATE SET amount = amount + excluded.amount, updated_at = excluded.updated_at`,
    [plan.user_id, plan.symbol, shares]
  );
  await execute(
    "INSERT INTO transactions (user_id, type, symbol, amount, price, fee, total, status, source) VALUES (?, 'buy', ?, ?, ?, 0, ?, 'completed', 'auto_invest')",
    [plan.user_id, plan.symbol, shares, price, plan.weekly_amount]
  );
  await notifyUser(plan.user_id, "auto_invest_executed", `Auto-invest: bought $${plan.weekly_amount} of ${plan.symbol} (${shares} shares)`);
  await execute("UPDATE auto_invest_plans SET last_run_at = datetime('now'), next_run_at = ? WHERE id = ?", [nextRunAt, plan.id]);

  return { status: "executed", shares, price };
}

async function runDuePlans() {
  const due = await queryAll(
    "SELECT * FROM auto_invest_plans WHERE status = 'active' AND next_run_at <= datetime('now')"
  );
  const results = [];
  for (const plan of due) {
    try {
      results.push(await runDuePlan(plan));
    } catch (err) {
      // One bad plan (e.g. a transient DB hiccup) must never take down the
      // rest of the run for every other user's plan.
      console.error(`Auto-invest plan ${plan.id} failed:`, err.message);
      results.push({ status: "error", planId: plan.id });
    }
  }
  return results;
}

// Checked hourly against real next_run_at timestamps rather than a naive
// weekly setInterval — survives Railway restarts/redeploys correctly,
// same reasoning as services/priceSnapshot.js.
function startAutoInvestSchedule(intervalMs = 60 * 60 * 1000) {
  runDuePlans().catch(err => console.error("Auto-invest run failed:", err.message));
  const handle = setInterval(() => {
    runDuePlans().catch(err => console.error("Auto-invest run failed:", err.message));
  }, intervalMs);
  return handle;
}

module.exports = { runDuePlans, runDuePlan, startAutoInvestSchedule };
