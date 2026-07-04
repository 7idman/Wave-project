/**
 * routes/transactions.js
 * GET /api/transactions      — Paginated transaction history
 * GET /api/transactions/:id  — Single transaction detail
 */

const router = require("express").Router();
const { queryOne, queryAll } = require("../db");

router.get("/", async (req, res) => {
  try {
    const userId = req.user.id;
    const limit  = Math.min(parseInt(req.query.limit)  || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const symbol = req.query.symbol?.toUpperCase();
    const type   = req.query.type;

    let sql    = "SELECT * FROM transactions WHERE user_id = ?";
    const args = [userId];
    if (symbol) { sql += " AND symbol = ?"; args.push(symbol); }
    if (type)   { sql += " AND type = ?";   args.push(type);   }
    sql += " ORDER BY created_at DESC LIMIT ? OFFSET ?";
    args.push(limit, offset);

    const txs      = await queryAll(sql, args);
    const countRow = await queryOne(
      "SELECT COUNT(*) as c FROM transactions WHERE user_id = ?",
      [userId]
    );

    res.json({ transactions: txs, total: Number(countRow.c), limit, offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const tx = await queryOne(
      "SELECT * FROM transactions WHERE id = ? AND user_id = ?",
      [req.params.id, req.user.id]
    );
    if (!tx) return res.status(404).json({ error: "Transaction not found" });
    res.json(tx);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
