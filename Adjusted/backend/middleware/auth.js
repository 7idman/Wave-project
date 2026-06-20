/**
 * middleware/auth.js
 * JWT Bearer token verification — async version for libSQL
 */

const jwt = require("jsonwebtoken");
const { queryOne, execute } = require("../db");

const JWT_SECRET = process.env.JWT_SECRET || "wave_jwt_secret_change_in_prod";

/** Short-lived access token — 15 minutes */
const signAccessToken = (userId) =>
  jwt.sign({ sub: userId }, JWT_SECRET, { expiresIn: "15m" });

/** Long-lived refresh token — 7 days, stored in DB */
const signRefreshToken = async (userId) => {
  const token   = jwt.sign({ sub: userId, type: "refresh" }, JWT_SECRET, { expiresIn: "7d" });
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await execute(
    "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES (?, ?, ?)",
    [userId, token, expires]
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
    req.user = user;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

module.exports = { authenticate, signAccessToken, signRefreshToken, JWT_SECRET };
