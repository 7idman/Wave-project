/**
 * routes/clientErrors.js
 * POST /api/client-errors — frontend ErrorBoundary crash reports.
 * Deliberately NOT behind `authenticate` — the app may be in a broken or
 * unauthenticated state when a boundary fires, and this endpoint's only
 * job is "get this crash logged somewhere," not gate on a valid session.
 * Heavily rate-limited by IP instead, since it's unauthenticated.
 */

const router = require("express").Router();
const { execute } = require("../db");
const { checkAndRecord } = require("../services/rateLimit");

router.post("/", async (req, res) => {
  try {
    const limit = await checkAndRecord("client_error_report", `ip:${req.ip}`, { max: 30, windowMinutes: 60 });
    if (!limit.allowed) return res.status(429).json({ error: "Too many error reports." });

    const { message, stack, componentStack, boundary, url, userId } = req.body || {};
    await execute(
      "INSERT INTO client_errors (user_id, message, stack, component_stack, boundary, url) VALUES (?, ?, ?, ?, ?, ?)",
      [
        Number.isInteger(userId) ? userId : null,
        String(message || "").slice(0, 2000),
        String(stack || "").slice(0, 4000),
        String(componentStack || "").slice(0, 4000),
        String(boundary || "").slice(0, 100),
        String(url || "").slice(0, 500),
      ]
    );
    res.status(204).end();
  } catch (err) {
    // A failure to log a crash report should never itself surface as an
    // error to a client that's already dealing with a crash.
    console.error("Failed to record client error report:", err.message);
    res.status(204).end();
  }
});

module.exports = router;
