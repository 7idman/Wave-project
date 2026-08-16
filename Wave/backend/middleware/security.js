/**
 * middleware/security.js
 * Composable security guards. Kept as small, stackable pieces (per-route
 * app.use chains) rather than one monolithic "security" middleware, so a
 * route can opt into exactly what it needs — same spirit as authenticate/
 * requirePermission in middleware/auth.js.
 */

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

module.exports = { logSecurityEvent };
