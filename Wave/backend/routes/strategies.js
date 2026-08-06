/**
 * routes/strategies.js
 * GET  /api/strategies               — list active strategies users can copy
 * POST /api/strategies/:id/subscribe — connect to a strategy (real money, real portfolio)
 */

const router = require("express").Router();
const crypto = require("crypto");
const { queryOne, queryAll, execute } = require("../db");
const { valuePortfolio } = require("../services/portfolioValuation");

function generateReferenceId() {
  return "TRF-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

router.get("/", async (req, res) => {
  try {
    const strategies = await queryAll(
      "SELECT id, name, description, fee, status FROM strategies WHERE status = 'active' ORDER BY id"
    );
    res.json({ strategies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Everything the Signal Copier page needs: each portfolio the user has
// connected, its real current value/holdings, how much they've actually
// put in (so the frontend can show real unrealized P&L, not a fake
// "profit" number), and their real mirrored-trade history.
router.get("/my", async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await queryAll(
      `SELECT p.id AS portfolio_id, p.strategy_id, s.name AS strategy_name, s.fee
       FROM portfolios p JOIN strategies s ON s.id = p.strategy_id
       WHERE p.user_id = ? AND p.type = 'copier'
       ORDER BY p.created_at DESC`,
      [userId]
    );

    const portfolios = [];
    for (const row of rows) {
      const value = await valuePortfolio(row.portfolio_id);
      const contributedRow = await queryOne(
        "SELECT COALESCE(SUM(amount),0) AS total FROM internal_transfers WHERE portfolio_id = ? AND direction = 'to_portfolio'",
        [row.portfolio_id]
      );
      const contributed = contributedRow.total;
      const trades = await queryAll(
        `SELECT st.symbol, st.side, stm.mirrored_amount, stm.mirrored_price, stm.created_at
         FROM strategy_trade_mirrors stm JOIN strategy_trades st ON st.id = stm.strategy_trade_id
         WHERE stm.portfolio_id = ? ORDER BY stm.created_at DESC LIMIT 20`,
        [row.portfolio_id]
      );
      portfolios.push({
        portfolioId: row.portfolio_id,
        strategyId: row.strategy_id,
        strategyName: row.strategy_name,
        fee: row.fee,
        cashBalance: value.cashBalance,
        holdingsValue: value.holdingsValue,
        totalValue: value.totalValue,
        holdings: value.holdings,
        contributed,
        unrealizedPnl: value.totalValue - contributed,
        trades: trades.map(t => ({
          symbol: t.symbol,
          side: t.side,
          amount: t.mirrored_amount,
          price: t.mirrored_price,
          value: t.mirrored_amount * t.mirrored_price,
          createdAt: t.created_at,
        })),
      });
    }

    res.json({ portfolios });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/:id/subscribe", async (req, res) => {
  const userId = req.user.id;
  const strategyId = parseInt(req.params.id, 10);
  let deducted = false;
  let fee = 0;

  try {
    const strategy = await queryOne(
      "SELECT id, name, fee, status FROM strategies WHERE id = ?",
      [strategyId]
    );
    if (!strategy) return res.status(404).json({ error: "Strategy not found" });
    if (strategy.status !== "active")
      return res.status(400).json({ error: "This strategy isn't accepting new subscribers right now" });

    const existing = await queryOne(
      "SELECT id FROM portfolios WHERE user_id = ? AND type = 'copier' AND strategy_id = ?",
      [userId, strategyId]
    );
    if (existing) return res.status(409).json({ error: "You're already connected to this strategy" });

    fee = strategy.fee;

    // Step 1: guarded atomic deduction. This single UPDATE is its own atomic
    // unit — it either deducts the full fee or (if balance is insufficient)
    // affects 0 rows and changes nothing. Nothing downstream runs unless
    // this really succeeded.
    const deduction = await execute(
      "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
      [fee, userId, fee]
    );
    if (deduction.rowsAffected === 0)
      return res.status(400).json({ error: "Insufficient balance" });
    deducted = true;

    // Step 2: create the copier portfolio, seeded with the fee.
    // If this throws, the catch block below refunds the deduction from
    // step 1 — see comment there for why this can't just be one batch.
    const created = await execute(
      "INSERT INTO portfolios (user_id, type, strategy_id, cash_balance) VALUES (?, 'copier', ?, ?)",
      [userId, strategyId, fee]
    );
    const portfolioId = created.lastInsertRowid;

    // Audit records — best-effort. If these fail, the money movement above
    // already succeeded correctly; we log the failure but don't reverse a
    // successful transfer over a bookkeeping-record error.
    const referenceId = generateReferenceId();
    try {
      await execute(
        `INSERT INTO internal_transfers (user_id, direction, portfolio_id, amount, reference_id, verification_status, status)
         VALUES (?, 'to_portfolio', ?, ?, ?, 'not_required', 'completed')`,
        [userId, portfolioId, fee, referenceId]
      );
      await execute(
        "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'transfer', ?, ?)",
        [userId, `Connected to ${strategy.name} (${referenceId})`, fee]
      );
    } catch (auditErr) {
      console.error("Signal Copier: audit log write failed after successful transfer", auditErr.message);
    }

    const user = await queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
    res.status(201).json({
      message: `Connected to ${strategy.name}`,
      portfolioId,
      referenceId,
      cashBalance: user.cash_balance,
    });
  } catch (err) {
    // Compensating refund: if the deduction (step 1) already succeeded but
    // anything after it threw, put the fee back rather than leave it
    // vanished with no portfolio to show for it. This is a fallback, not
    // the primary safety mechanism — step 1's own guarded UPDATE is what
    // prevents an overdraw in the first place.
    if (deducted) {
      try {
        await execute(
          "UPDATE users SET cash_balance = cash_balance + ?, updated_at = datetime('now') WHERE id = ?",
          [fee, userId]
        );
        console.error(`Signal Copier: refunded $${fee} to user ${userId} after subscribe failure:`, err.message);
      } catch (refundErr) {
        console.error(`Signal Copier: REFUND FAILED for user ${userId}, amount $${fee} — needs manual admin correction:`, refundErr.message);
      }
    }
    res.status(500).json({ error: "Something went wrong connecting to this strategy. " + (deducted ? "Your balance has been refunded." : "") });
  }
});

module.exports = router;
