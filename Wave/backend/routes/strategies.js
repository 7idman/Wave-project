/**
 * routes/strategies.js
 * GET  /api/strategies               — list active strategies users can copy
 * POST /api/strategies/:id/subscribe — connect to a strategy (real money, real portfolio)
 */

const router = require("express").Router();
const crypto = require("crypto");
const { queryOne, queryAll, withTransaction } = require("../db");
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

  try {
    const referenceId = generateReferenceId();
    const outcome = await withTransaction(async tx => {
      const strategy = await tx.queryOne(
        "SELECT id, name, fee, status FROM strategies WHERE id = ?",
        [strategyId]
      );
      if (!strategy) return { error: "Strategy not found", status: 404 };
      if (strategy.status !== "active") {
        return { error: "This strategy isn't accepting new subscribers right now", status: 400 };
      }

      const existing = await tx.queryOne(
        "SELECT id FROM portfolios WHERE user_id = ? AND type = 'copier' AND strategy_id = ?",
        [userId, strategyId]
      );
      if (existing) return { error: "You're already connected to this strategy", status: 409 };

      const deduction = await tx.execute(
        "UPDATE users SET cash_balance = cash_balance - ?, updated_at = datetime('now') WHERE id = ? AND cash_balance >= ?",
        [strategy.fee, userId, strategy.fee]
      );
      if (deduction.rowsAffected === 0) return { error: "Insufficient balance", status: 400 };

      const created = await tx.execute(
        "INSERT INTO portfolios (user_id, type, strategy_id, cash_balance) VALUES (?, 'copier', ?, ?)",
        [userId, strategyId, strategy.fee]
      );
      const portfolioId = created.lastInsertRowid;
      await tx.execute(
        `INSERT INTO internal_transfers (user_id, direction, portfolio_id, amount, reference_id, verification_status, status)
         VALUES (?, 'to_portfolio', ?, ?, ?, 'not_required', 'completed')`,
        [userId, portfolioId, strategy.fee, referenceId]
      );
      await tx.execute(
        "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'transfer', ?, ?)",
        [userId, `Connected to ${strategy.name} (${referenceId})`, strategy.fee]
      );
      const user = await tx.queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
      return { portfolioId, cashBalance: user.cash_balance, strategyName: strategy.name };
    });
    if (outcome.error) return res.status(outcome.status).json({ error: outcome.error });
    res.status(201).json({
      message: `Connected to ${outcome.strategyName}`,
      portfolioId: outcome.portfolioId,
      referenceId,
      cashBalance: outcome.cashBalance,
    });
  } catch (err) {
    res.status(500).json({ error: "Something went wrong connecting to this strategy." });
  }
});

module.exports = router;
