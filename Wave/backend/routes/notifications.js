/**
 * routes/notifications.js
 * GET /api/notifications/updates — Site announcements, newest first
 */

const router = require("express").Router();
const { queryAll } = require("../db");

router.get("/updates", async (req, res) => {
  try {
    const rows = await queryAll(
      "SELECT id, title, body, created_at FROM site_updates ORDER BY created_at DESC LIMIT 20"
    );
    res.json({ updates: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/activity", async (req, res) => {
  try {
    const activities = await queryAll(
      `SELECT id, type, symbol AS label, total AS amount, created_at FROM transactions WHERE user_id = ?
       UNION ALL
       SELECT id, type, label, amount, created_at FROM activity_log WHERE user_id = ?
       ORDER BY created_at DESC, id DESC LIMIT 20`,
      [req.user.id, req.user.id]
    );
    res.json({ activities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
