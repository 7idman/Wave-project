/**
 * middleware/security.js
 * Composable security guards. Kept as small, stackable pieces (per-route
 * app.use chains) rather than one monolithic "security" middleware, so a
 * route can opt into exactly what it needs — same spirit as authenticate/
 * requirePermission in middleware/auth.js.
 */

const { verifyTurnstileToken } = require("../services/turnstile");
const { execute } = require("../db");

// Never store passwords, OTP codes, or third-party secrets/tokens in
// metadata — this is an audit trail, not a place to leak sensitive data
// into. Logging failures are swallowed on purpose: a broken audit log
// must never be the reason a real request fails.
async function logSecurityEvent(type, { userId = null, ip = null, metadata = {} } = {}) {
  try {
    await execute(
      "INSERT INTO security_events (type, user_id, ip, metadata) VALUES (?, ?, ?, ?)",
      [type, userId, ip || null, JSON.stringify(metadata)]
    );
  } catch (err) {
    console.error("Failed to log security event (non-fatal):", err.message);
  }
}

// Unconditional Turnstile requirement — use on routes that always need it
// (signup). For routes where it's only conditionally required (login,
// after repeated failures), check services/rateLimit.js's peek() first and
// call verifyTurnstileToken directly instead of this middleware.
function requireTurnstile() {
  return async (req, res, next) => {
    try {
      const token = req.body?.turnstileToken;
      const result = await verifyTurnstileToken(token, req.ip);
      if (!result.success) {
        await logSecurityEvent("TURNSTILE_FAILED", { ip: req.ip, metadata: { reason: result.reason, route: req.originalUrl } });
        return res.status(400).json({ error: "Verification failed — please try again.", code: "TURNSTILE_REQUIRED" });
      }
      next();
    } catch (err) {
      console.error("Turnstile middleware error:", err.message);
      return res.status(400).json({ error: "Verification failed — please try again.", code: "TURNSTILE_REQUIRED" });
    }
  };
}

module.exports = { requireTurnstile, logSecurityEvent };
