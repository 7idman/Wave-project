/**
 * middleware/auth.js
 * JWT Bearer token verification — async version for libSQL
 */

const jwt    = require("jsonwebtoken");
const crypto = require("crypto");
const { queryOne, execute } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "wave_jwt_secret_change_in_prod";

/**
 * Short-lived access token — 15 minutes.
 * sessionId (optional) is embedded as `sid` so any authenticated request can
 * be traced back to the exact login/device it came from — this is what
 * powers "current device" detection on GET /auth/sessions.
 */
const signAccessToken = (userId, sessionId = null) =>
  jwt.sign({ sub: userId, sid: sessionId }, JWT_SECRET, { expiresIn: "15m" });

/**
 * Long-lived refresh token — 7 days, stored in DB.
 * sessionId is stored alongside it so that /auth/refresh (which reissues an
 * access token every ~15 min) can carry the *same* session id forward, and
 * so /auth/logout can look up which session to close without needing the
 * access token to still be valid.
 */
const signRefreshToken = async (userId, sessionId = null) => {
  // jti (JWT ID) guarantees uniqueness even if two tokens are issued for the
  // same user within the same second, which otherwise produces byte-identical
  // signed JWTs and trips the UNIQUE constraint on refresh_tokens.token.
  const token   = jwt.sign({ sub: userId, type: "refresh", jti: crypto.randomUUID() }, JWT_SECRET, { expiresIn: "7d" });
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await execute(
    "INSERT INTO refresh_tokens (user_id, token, expires_at, session_id) VALUES (?, ?, ?, ?)",
    [userId, token, expires, sessionId]
  );
  return token;
};

/** Express middleware — validates Authorization: Bearer <token> */
const authenticate = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    const user    = await queryOne("SELECT * FROM users WHERE id = ?", [payload.sub]);
    if (!user) return res.status(401).json({ error: "User not found" });
    req.user      = user;
    req.sessionId = payload.sid ?? null;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = { authenticate, signAccessToken, signRefreshToken, JWT_SECRET };