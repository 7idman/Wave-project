/**
 * routes/autoInvest.js
 * POST  /api/auto-invest/plans     — create a plan
 * GET   /api/auto-invest/plans     — list current user's plans
 * PATCH /api/auto-invest/plans/:id — pause / resume / cancel
 */

const router = require("express").Router();
const { queryOne, queryAll, execute } = require("../db");

const MIN_WEEKLY_AMOUNT = 25;

router.post("/plans", async (req, res) => {
  try {
    const { symbol, weeklyAmount } = req.body;
    const amount = parseFloat(weeklyAmount);

    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    if (!Number.isFinite(amount) || amount < MIN_WEEKLY_AMOUNT)
      return res.status(400).json({ error: `Minimum weekly amount is $${MIN_WEEKLY_AMOUNT}` });

    const sym = symbol.toUpperCase();
    const priceRow = await queryOne("SELECT symbol FROM price_cache WHERE symbol = ? AND asset_type = 'stock'", [sym]);
    if (!priceRow) return res.status(400).json({ error: `${sym} isn't a supported stock` });

    // First run happens on the next scheduler tick (within the hour) —
    // a new plan starts investing right away rather than making the user
    // wait a full week for their first purchase.
    const plan = await execute(
      "INSERT INTO auto_invest_plans (user_id, symbol, weekly_amount, status, next_run_at) VALUES (?, ?, ?, 'active', datetime('now'))",
      [req.user.id, sym, amount]
    );
    const created = await queryOne("SELECT * FROM auto_invest_plans WHERE id = ?", [plan.lastInsertRowid]);
    res.status(201).json({ plan: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/plans", async (req, res) => {
  try {
    const plans = await queryAll(
      "SELECT * FROM auto_invest_plans WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json({ plans });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/plans/:id", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "paused", "cancelled"].includes(status))
      return res.status(400).json({ error: "status must be 'active', 'paused', or 'cancelled'" });

    const plan = await queryOne("SELECT * FROM auto_invest_plans WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (!plan) return res.status(404).json({ error: "Plan not found" });

    // Resuming a paused plan schedules its next purchase for right away,
    // same as a brand-new plan — otherwise a plan paused for months would
    // silently wait out a next_run_at that's long since passed, or worse,
    // immediately fire for every missed week at once.
    const sets = ["status = ?"];
    const vals = [status];
    if (status === "active" && plan.status !== "active") {
      sets.push("next_run_at = datetime('now')");
    }
    vals.push(req.params.id, req.user.id);

    await execute(`UPDATE auto_invest_plans SET ${sets.join(", ")} WHERE id = ? AND user_id = ?`, vals);
    const updated = await queryOne("SELECT * FROM auto_invest_plans WHERE id = ?", [req.params.id]);
    res.json({ plan: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
