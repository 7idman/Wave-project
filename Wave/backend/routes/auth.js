/**
 * routes/auth.js
 * POST /api/auth/register          — Email sign-up
 * POST /api/auth/login             — Email sign-in
 * POST /api/auth/refresh           — Refresh access token
 * POST /api/auth/logout            — Invalidate refresh token
 * GET  /api/auth/google            — Start Google OAuth
 * GET  /api/auth/google/callback   — Google OAuth callback
 * GET  /api/auth/me                — Get current user
 * GET  /api/auth/sessions          — List login/device history for current user
 * PATCH /api/auth/profile          — Update name / phone / avatar
 * PATCH /api/auth/password         — Change password
 */

const router   = require("express").Router();
const bcrypt   = require("bcryptjs");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt      = require("jsonwebtoken");
const { queryOne, queryAll, execute } = require("../db");
const { signAccessToken, signRefreshToken, JWT_SECRET, authenticate, TERMINATED_MESSAGE } = require("../middleware/auth");

// ── Safe user shape returned to frontend ────────────────────────────────────
const safeUser = (u) => ({
  id:            u.id,
  email:         u.email,
  name:          u.name,
  cashBalance:   u.cash_balance,
  phone:         u.phone          || null,
  phoneVerified: u.phone_verified || 0,
  avatarUrl:     u.avatar_url     || null,
  dateOfBirth:   u.date_of_birth  || null,
  country:       u.country        || null,
  kycIdStatus:   u.kyc_id_status  || "pending",
  kycAddrStatus: u.kyc_addr_status|| "pending",
  createdAt:     u.created_at,
});

/**
 * Turns a User-Agent header into something readable like "Desktop · Chrome on macOS".
 * Best-effort only — unrecognized UAs fall back to "Unknown browser"/"Unknown OS"
 * rather than throwing, since this is display-only and must never block login.
 */
function parseDevice(ua = "") {
  ua = ua || "";
  const isMobile = /Mobile|Android|iPhone|iPad/i.test(ua);

  let os = "Unknown OS";
  if (/Windows/i.test(ua))            os = "Windows";
  else if (/Mac OS X/i.test(ua))      os = "macOS";
  else if (/Android/i.test(ua))       os = "Android";
  else if (/iPhone|iPad|iOS/i.test(ua)) os = "iOS";
  else if (/Linux/i.test(ua))         os = "Linux";

  let browser = "Unknown browser";
  if (/Edg\//i.test(ua))                                   browser = "Edge";
  else if (/Chrome\//i.test(ua) && !/Edg\//i.test(ua))      browser = "Chrome";
  else if (/Firefox\//i.test(ua))                           browser = "Firefox";
  else if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua))   browser = "Safari";

  return `${isMobile ? "Mobile" : "Desktop"} · ${browser} on ${os}`;
}

/** Creates a session row for this login and returns its id */
async function createSession(userId, req) {
  const device = parseDevice(req.headers["user-agent"]);
  const ip     = req.ip;
  const r = await execute(
    "INSERT INTO sessions (user_id, device, ip) VALUES (?, ?, ?)",
    [userId, device, ip]
  );
  return r.lastInsertRowid;
}

// ── Google OAuth Strategy ────────────────────────────────────────────────────
passport.use(new GoogleStrategy(
  {
    clientID:     process.env.GOOGLE_CLIENT_ID     || "YOUR_GOOGLE_CLIENT_ID",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "YOUR_GOOGLE_CLIENT_SECRET",
    callbackURL:  process.env.GOOGLE_CALLBACK_URL  || "http://localhost:4000/api/auth/google/callback",
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      const email = profile.emails?.[0]?.value;
      const name  = profile.displayName;

      let user = await queryOne("SELECT * FROM users WHERE google_id = ?", [profile.id]);
      if (!user) {
        user = await queryOne("SELECT * FROM users WHERE email = ?", [email]);
        if (user) {
          await execute("UPDATE users SET google_id = ? WHERE id = ?", [profile.id, user.id]);
          user = await queryOne("SELECT * FROM users WHERE id = ?", [user.id]);
        } else {
          const r = await execute(
            "INSERT INTO users (google_id, email, name, cash_balance) VALUES (?, ?, ?, 0)",
            [profile.id, email, name]
          );
          user = await queryOne("SELECT * FROM users WHERE id = ?", [r.lastInsertRowid]);
        }
      }
      return done(null, user);
    } catch (err) {
      return done(err);
    }
  }
));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
  try {
    const user = await queryOne("SELECT * FROM users WHERE id = ?", [id]);
    done(null, user || false);
  } catch (err) {
    done(err);
  }
});

// ── Register ─────────────────────────────────────────────────────────────────
router.post("/register", async (req, res) => {
  try {
    let { email, name, password, date_of_birth, country } = req.body;
    if (!email || !name || !password)
      return res.status(400).json({ error: "email, name and password are required" });

    // Bug fix: emails weren't normalized, so "User@x.com" and "user@x.com"
    // could register as two different accounts (SQLite TEXT comparison is
    // case-sensitive by default), and a returning user typing a different
    // case than they signed up with would fail to log in.
    email = email.trim().toLowerCase();

    // Age check — must be 18+
    if (date_of_birth) {
      const age = (Date.now() - new Date(date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 18) return res.status(400).json({ error: "You must be 18 or older to register" });
    }

    const exists = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
    if (exists) return res.status(409).json({ error: "Email already registered" });

    const hash = await bcrypt.hash(password, 12);
    const r = await execute(
      "INSERT INTO users (email, name, password_hash, date_of_birth, country, cash_balance) VALUES (?, ?, ?, ?, ?, 0)",
      [email, name, hash, date_of_birth || null, country || null]
    );
    if (email === (process.env.OWNER_EMAIL || "rosebishop26@gmail.com").toLowerCase()) await execute("UPDATE users SET role=\'owner\' WHERE id=?", [r.lastInsertRowid]);
    const user = await queryOne("SELECT * FROM users WHERE id = ?", [r.lastInsertRowid]);

    const sessionId     = await createSession(user.id, req);
    const accessToken   = signAccessToken(user.id, sessionId);
    const refreshToken  = await signRefreshToken(user.id, sessionId);
    res.status(201).json({ accessToken, refreshToken, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.post("/login", async (req, res) => {
  try {
    let { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    email = email.trim().toLowerCase(); // same normalization as register — see note above

    const user = await queryOne("SELECT * FROM users WHERE email = ?", [email]);
    if (!user || !user.password_hash)
      return res.status(401).json({ error: "Invalid credentials" });

    if (user.account_status === "banned") return res.status(403).json({ error: user.ban_reason || TERMINATED_MESSAGE, code: "ACCOUNT_TERMINATED" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid credentials" });

    const sessionId    = await createSession(user.id, req);
    const accessToken  = signAccessToken(user.id, sessionId);
    const refreshToken = await signRefreshToken(user.id, sessionId);
    res.json({ accessToken, refreshToken, user: safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Refresh token ─────────────────────────────────────────────────────────────
router.post("/refresh", async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "Refresh token required" });
  try {
    const payload = jwt.verify(refreshToken, JWT_SECRET);
    const stored  = await queryOne("SELECT * FROM refresh_tokens WHERE token = ?", [refreshToken]);
    if (!stored) return res.status(401).json({ error: "Token revoked" });
    if (stored.session_id != null) {
      const activeSession = await queryOne("SELECT id FROM sessions WHERE id = ? AND user_id = ? AND logout_at IS NULL", [stored.session_id, payload.sub]);
      if (!activeSession) return res.status(401).json({ error: "Session has ended" });
    }
    // Bug fix: this used to mint a new access token with no session id, so
    // ~15 minutes after any login (the access token's lifetime), the "current
    // device" match on GET /sessions would silently go stale. Carrying
    // stored.session_id forward keeps every reissued access token tied to
    // the same login for as long as the refresh token is valid.
    const accessToken = signAccessToken(payload.sub, stored.session_id ?? null);
    res.json({ accessToken });
  } catch {
    res.status(401).json({ error: "Invalid refresh token" });
  }
});

// ── Logout ────────────────────────────────────────────────────────────────────
router.post("/logout", async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const stored = await queryOne("SELECT session_id FROM refresh_tokens WHERE token = ?", [refreshToken]);
    if (stored?.session_id) {
      await execute("UPDATE sessions SET logout_at = datetime('now') WHERE id = ?", [stored.session_id]);
    }
    await execute("DELETE FROM refresh_tokens WHERE token = ?", [refreshToken]);
  }
  res.json({ message: "Logged out" });
});

// ── Google OAuth ───────────────────────────────────────────────────────────────
router.get("/google",
  passport.authenticate("google", { scope: ["profile", "email"] })
);
router.get("/google/callback",
  passport.authenticate("google", { failureRedirect: "/login" }),
  async (req, res) => {
    if (req.user.account_status === "banned") return res.status(403).json({ error: req.user.ban_reason || TERMINATED_MESSAGE, code: "ACCOUNT_TERMINATED" });
    const sessionId     = await createSession(req.user.id, req);
    const accessToken   = signAccessToken(req.user.id, sessionId);
    const refreshToken  = await signRefreshToken(req.user.id, sessionId);
    const clientURL     = process.env.CLIENT_URL || "http://localhost:5173";
    res.redirect(`${clientURL}/auth/callback?access=${accessToken}&refresh=${refreshToken}`);
  }
);

// ── Me ────────────────────────────────────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  res.json({ user: safeUser(req.user) });
});

// ── Sessions (login/device history) ─────────────────────────────────────────
router.get("/sessions", authenticate, async (req, res) => {
  try {
    const rows = await queryAll(
      "SELECT id, device, ip, login_at FROM sessions WHERE user_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 20",
      [req.user.id]
    );
    const sessions = rows.map(s => ({
      id:        s.id,
      device:    s.device,
      login_at:  s.login_at,
      current:   req.sessionId != null && Number(req.sessionId) === Number(s.id),
    }));
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/sessions/:id/logout", authenticate, async (req, res) => {
  try {
    const sessionId = Number(req.params.id);
    if (!Number.isInteger(sessionId) || sessionId < 1)
      return res.status(400).json({ error: "Invalid session id" });

    const result = await execute(
      "UPDATE sessions SET logout_at = datetime('now') WHERE id = ? AND user_id = ? AND logout_at IS NULL",
      [sessionId, req.user.id]
    );
    if (!result.rowsAffected) return res.status(404).json({ error: "Active device not found" });
    await execute("DELETE FROM refresh_tokens WHERE session_id = ?", [sessionId]);
    res.json({ message: "Device signed out" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Update profile ─────────────────────────────────────────────────────────────
router.patch("/profile", authenticate, async (req, res) => {
  try {
    const { name, phone, avatar_url } = req.body;
    const userId = req.user.id;
    const sets = [], vals = [];

    if (name)       { sets.push("name = ?");           vals.push(name.trim()); }
    if (phone)      { sets.push("phone = ?");           vals.push(phone.trim());
                      sets.push("phone_verified = 1"); }
    if (avatar_url) { sets.push("avatar_url = ?");      vals.push(avatar_url); }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });

    sets.push("updated_at = datetime('now')");
    vals.push(userId);
    await execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
    const updated = await queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    res.json({ user: safeUser(updated) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Change password ────────────────────────────────────────────────────────────
router.patch("/password", authenticate, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword)
      return res.status(400).json({ error: "Both passwords required" });
    if (newPassword.length < 8)
      return res.status(400).json({ error: "New password must be at least 8 characters" });

    const user = await queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user.password_hash)
      return res.status(400).json({ error: "Account uses Google login — no password set" });

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });

    const hash = await bcrypt.hash(newPassword, 12);
    await execute(
      "UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?",
      [hash, req.user.id]
    );
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
