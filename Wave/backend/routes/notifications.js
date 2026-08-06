/**
 * routes/notifications.js
 * GET /api/notifications/updates — Site announcements, newest first
 */

const router = require("express").Router();
const { queryAll, execute } = require("../db");
const { configured } = require("../services/push");

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

router.get("/push/config", (req, res) => res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || "", enabled: configured() }));

router.post("/push/subscribe", async (req, res) => {
  try {
    if (!req.body?.endpoint) return res.status(400).json({ error: "Invalid push subscription" });
    await execute(
      "INSERT INTO push_subscriptions (user_id,endpoint,subscription_json) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id,subscription_json=excluded.subscription_json,updated_at=datetime('now')",
      [req.user.id, req.body.endpoint, JSON.stringify(req.body)]
    );
    res.status(201).json({ message: "Balance update notifications ON" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/push/subscribe", async (req, res) => {
  try {
    if (!req.body?.endpoint) return res.status(400).json({ error: "Invalid push subscription" });
    await execute("DELETE FROM push_subscriptions WHERE user_id=? AND endpoint=?", [req.user.id, req.body.endpoint]);
    res.json({ message: "Balance update notifications off" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
