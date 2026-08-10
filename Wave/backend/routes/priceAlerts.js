/**
 * routes/priceAlerts.js
 * POST   /api/price-alerts     — create an alert
 * GET    /api/price-alerts     — list current user's alerts
 * PATCH  /api/price-alerts/:id — cancel an alert
 */

const router = require("express").Router();
const { queryOne, queryAll, execute } = require("../db");

router.post("/", async (req, res) => {
  try {
    const { symbol, condition, targetPrice } = req.body;
    const price = parseFloat(targetPrice);

    if (!symbol) return res.status(400).json({ error: "symbol is required" });
    if (!["above", "below"].includes(condition)) return res.status(400).json({ error: "condition must be 'above' or 'below'" });
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "targetPrice must be a positive number" });

    const sym = symbol.toUpperCase();
    const priceRow = await queryOne("SELECT symbol FROM price_cache WHERE symbol = ?", [sym]);
    if (!priceRow) return res.status(400).json({ error: `${sym} isn't a tracked symbol` });

    const alert = await execute(
      "INSERT INTO price_alerts (user_id, symbol, condition, target_price) VALUES (?, ?, ?, ?)",
      [req.user.id, sym, condition, price]
    );
    const created = await queryOne("SELECT * FROM price_alerts WHERE id = ?", [alert.lastInsertRowid]);
    res.status(201).json({ alert: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/", async (req, res) => {
  try {
    const alerts = await queryAll(
      "SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50",
      [req.user.id]
    );
    res.json({ alerts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const alert = await queryOne("SELECT * FROM price_alerts WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    if (!alert) return res.status(404).json({ error: "Alert not found" });

    await execute("UPDATE price_alerts SET status = 'cancelled' WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
    const updated = await queryOne("SELECT * FROM price_alerts WHERE id = ?", [req.params.id]);
    res.json({ alert: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
