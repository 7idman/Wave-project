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

module.exports = router;