/**
 * routes/managed.js
 * GET /api/managed/my — the user's managed account(s), with real computed
 * allocation percentages. Managed accounts are set up by an admin (after a
 * consultation), not self-service — there's no POST /subscribe here.
 */

const router = require("express").Router();
const { queryAll } = require("../db");
const { valuePortfolio } = require("../services/portfolioValuation");

router.get("/my", async (req, res) => {
  try {
    const userId = req.user.id;
    const rows = await queryAll(
      "SELECT id, created_at FROM portfolios WHERE user_id = ? AND type = 'managed' ORDER BY created_at DESC",
      [userId]
    );

    const portfolios = [];
    for (const row of rows) {
      const value = await valuePortfolio(row.id);
      const totalValue = value.totalValue;
      const allocation = value.holdings.map(h => ({
        symbol: h.symbol,
        value: h.value,
        pct: totalValue > 0 ? (h.value / totalValue) * 100 : 0,
      }));
      if (value.cashBalance > 0) {
        allocation.push({
          symbol: "Cash",
          value: value.cashBalance,
          pct: totalValue > 0 ? (value.cashBalance / totalValue) * 100 : 0,
        });
      }
      // Largest allocation first — most useful reading order for a snapshot view.
      allocation.sort((a, b) => b.value - a.value);

      portfolios.push({
        portfolioId: row.id,
        createdAt: row.created_at,
        cashBalance: value.cashBalance,
        holdingsValue: value.holdingsValue,
        totalValue,
        allocation,
      });
    }

    res.json({ portfolios });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
