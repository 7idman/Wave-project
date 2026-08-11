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
 * PATCH /api/auth/profile          — Update name (phone goes through /api/phone; avatar through /api/account/avatar — both real-verification/real-upload flows, see routes/phone.js and routes/account.js)
 * PATCH /api/auth/password         — Change password
 */

const router   = require("express").Router();
const bcrypt   = require("bcryptjs");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const jwt      = require("jsonwebtoken");
const crypto   = require("crypto");
const { authenticator } = require("otplib");
const QRCode   = require("qrcode");
const { queryOne, queryAll, execute } = require("../db");
const { signAccessToken, signRefreshToken, JWT_SECRET, authenticate, TERMINATED_MESSAGE } = require("../middleware/auth");
const { generateReferralCode, linkReferral } = require("../services/referrals");
const { checkAndRecord: recordRate, peek: peekRate } = require("../services/rateLimit");
const { verifyTurnstileToken } = require("../services/turnstile");
const { logSecurityEvent } = require("../middleware/security");
const { getOrSetDeviceId, isDeviceTrusted, trustDevice } = require("../services/deviceTrust");
const { assessLoginRisk, assessSignupRisk } = require("../services/riskEngine");
const { normalizeToE164, lookupLineType, sendVerificationCode, checkVerificationCode } = require("../services/twilio");
const { sendVerificationEmail, sendNewDeviceLoginAlert } = require("../services/email");
const { isDisposableEmail } = require("../services/disposableEmail");

const EMAIL_VERIFY_TTL_MINUTES = parseInt(process.env.EMAIL_VERIFY_TTL_MINUTES || "60", 10);
const SIGNUP_PHONE_TTL_MINUTES = parseInt(process.env.SIGNUP_PHONE_TTL_MINUTES || "15", 10);

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function splitDisplayName(name = "") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

function cleanNamePart(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 80);
}

function makeDisplayName(firstName, lastName, fallback = "") {
  return `${cleanNamePart(firstName)} ${cleanNamePart(lastName)}`.trim() || String(fallback || "").trim();
}

function apiBaseUrl(req) {
  return (process.env.API_PUBLIC_URL || process.env.BACKEND_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");
}

function clientBaseUrl() {
  return (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/$/, "");
}

async function issueEmailVerification(user, req) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  await execute("DELETE FROM email_verification_tokens WHERE user_id = ? AND used_at IS NULL", [user.id]);
  await execute(
    "INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))",
    [user.id, tokenHash, `+${EMAIL_VERIFY_TTL_MINUTES} minutes`]
  );
  const verifyUrl = `${apiBaseUrl(req)}/api/auth/verify-email?token=${encodeURIComponent(token)}`;
  return sendVerificationEmail({ to: user.email, name: user.name, verifyUrl });
}

async function maybeSendNewDeviceEmail(user, req, wasTrusted) {
  if (wasTrusted || !user.email_verified) return;
  try {
    await sendNewDeviceLoginAlert({
      to: user.email,
      name: user.name,
      device: parseDevice(req.headers["user-agent"]),
      ip: req.ip,
      time: new Date().toISOString(),
    });
  } catch (err) {
    console.error("New-device login email failed:", err.message);
  }
}

// ── Safe user shape returned to frontend ────────────────────────────────────
// async — looks up real permissions from the `roles` table (users.role ->
// roles.role_key) instead of a per-user column. Every caller must `await` it.
const safeUser = async (u) => {
  const roleRow = u.role ? await queryOne("SELECT permissions FROM roles WHERE role_key = ?", [u.role]) : null;
  const permissions = roleRow ? JSON.parse(roleRow.permissions) : {};
  return {
    id:            u.id,
    email:         u.email,
    name:          u.name,
    firstName:     u.first_name    || null,
    lastName:      u.last_name     || null,
    emailVerified: Boolean(u.email_verified),
    cashBalance:   u.cash_balance,
    phone:         u.phone          || null,
    phoneVerified: u.phone_verified || 0,
    avatarUrl:     u.avatar_url     || null,
    dateOfBirth:   u.date_of_birth  || null,
    country:       u.country        || null,
    kycIdStatus:   u.kyc_id_status  || "pending",
    kycAddrStatus: u.kyc_addr_status|| "pending",
    createdAt:     u.created_at,
    role:          u.role           || "user",
    totpEnabled:   Boolean(u.totp_enabled),
    permissions,
  };
};

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
async function createSession(userId, req, deviceId) {
  const device = parseDevice(req.headers["user-agent"]);
  const ip     = req.ip;
  const r = await execute(
    "INSERT INTO sessions (user_id, device, ip, device_id) VALUES (?, ?, ?, ?)",
    [userId, device, ip, deviceId || null]
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
          await execute("UPDATE users SET google_id = ?, email_verified = 1, email_verified_at = COALESCE(email_verified_at, datetime('now')) WHERE id = ?", [profile.id, user.id]);
          user = await queryOne("SELECT * FROM users WHERE id = ?", [user.id]);
        } else {
          const { firstName, lastName } = splitDisplayName(name);
          const r = await execute(
            "INSERT INTO users (google_id, email, name, first_name, last_name, email_verified, email_verified_at, cash_balance) VALUES (?, ?, ?, ?, ?, 1, datetime('now'), 0)",
            [profile.id, email, name, firstName || null, lastName || null]
          );
          const ownerEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
          if (ownerEmail && email?.trim().toLowerCase() === ownerEmail) {
            await execute("UPDATE users SET role = 'owner' WHERE id = ?", [r.lastInsertRowid]);
          }
          try { await generateReferralCode(r.lastInsertRowid); } catch (e) { console.error("Referral code generation failed:", e.message); }
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
router.post("/signup-phone/send-code", async (req, res) => {
  try {
    const phone = normalizeToE164(req.body?.phone);
    const channel = req.body?.channel === "voice" || req.body?.channel === "call" ? "voice" : "sms";
    if (!phone) return res.status(400).json({ error: "Please enter a valid phone number." });

    const [phoneLimit, ipLimit] = await Promise.all([
      recordRate("signup_phone_send", `phone:${phone}`, { max: 5, windowMinutes: 30 }),
      recordRate("signup_phone_send", `ip:${req.ip}`, { max: 8, windowMinutes: 30 }),
    ]);
    if (!phoneLimit.allowed || !ipLimit.allowed) {
      return res.status(429).json({ error: "Too many verification requests. Please try again later." });
    }

    const lookup = await lookupLineType(phone);
    if (lookup.error === "twilio_not_configured") {
      console.error("Twilio is not configured - failing closed on signup phone verification.");
      return res.status(503).json({ error: "Phone verification is temporarily unavailable. Please try again later." });
    }
    if (!lookup.valid) return res.status(400).json({ error: "That doesn't look like a valid phone number." });
    if (lookup.lineType === "landline" && channel === "sms") {
      return res.status(400).json({ error: "Landline numbers need voice verification. Choose voice call or use a mobile number." });
    }
    if (lookup.lineType === "voip") {
      await logSecurityEvent("SIGNUP_VOIP_PHONE_DETECTED", { ip: req.ip, metadata: { phoneLast4: phone.slice(-4) } });
    }

    const sendResult = await sendVerificationCode(phone, channel);
    if (!sendResult.success) {
      return res.status(503).json({ error: "Couldn't send the verification code. Please try again." });
    }

    await logSecurityEvent("SIGNUP_PHONE_VERIFICATION_SENT", { ip: req.ip, metadata: { lineType: lookup.lineType, channel } });
    res.json({ message: channel === "voice" ? "Verification call started." : "Verification code sent.", phone, channel, lineType: lookup.lineType });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/signup-phone/verify-code", async (req, res) => {
  try {
    const phone = normalizeToE164(req.body?.phone);
    const { code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: "phone and code are required" });

    const verifyLimit = await recordRate("signup_phone_verify", `phone:${phone}`, { max: 6, windowMinutes: 15 });
    if (!verifyLimit.allowed) return res.status(429).json({ error: "Too many attempts. Please request a new code." });

    const check = await checkVerificationCode(phone, code);
    if (!check.approved) {
      await logSecurityEvent("SIGNUP_PHONE_VERIFICATION_FAILED", { ip: req.ip, metadata: { phoneLast4: phone.slice(-4) } });
      return res.status(401).json({ error: "Invalid or expired code." });
    }

    const token = crypto.randomBytes(32).toString("base64url");
    await execute(
      "INSERT INTO signup_phone_tokens (phone, token_hash, channel, expires_at) VALUES (?, ?, ?, datetime('now', ?))",
      [phone, hashToken(token), req.body?.channel === "voice" ? "voice" : "sms", `+${SIGNUP_PHONE_TTL_MINUTES} minutes`]
    );
    await logSecurityEvent("SIGNUP_PHONE_VERIFIED", { ip: req.ip, metadata: { phoneLast4: phone.slice(-4) } });
    res.json({ message: "Phone verified.", phone, phoneVerificationToken: token });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/verify-email", async (req, res) => {
  try {
    const token = String(req.query.token || "");
    if (!token) return res.status(400).send("Verification token is required.");
    const row = await queryOne(
      "SELECT id, user_id FROM email_verification_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > datetime('now')",
      [hashToken(token)]
    );
    if (!row) return res.status(400).send("This verification link is invalid or expired.");

    const used = await execute(
      "UPDATE email_verification_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')",
      [row.id]
    );
    if (used.rowsAffected !== 1) return res.status(400).send("This verification link is invalid or expired.");

    await execute(
      "UPDATE users SET email_verified = 1, email_verified_at = datetime('now'), updated_at = datetime('now') WHERE id = ? AND email_verified = 0",
      [row.user_id]
    );
    await logSecurityEvent("EMAIL_VERIFIED", { userId: row.user_id, ip: req.ip });
    res.redirect(`${clientBaseUrl()}/?emailVerified=1`);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

router.post("/resend-verification", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ error: "Email is required." });

    const [ipLimit, emailLimit] = await Promise.all([
      recordRate("email_verify_resend", `ip:${req.ip}`, { max: 8, windowMinutes: 30 }),
      recordRate("email_verify_resend", `email:${email}`, { max: 4, windowMinutes: 30 }),
    ]);
    if (!ipLimit.allowed || !emailLimit.allowed) {
      return res.status(429).json({ error: "Too many verification emails. Please try again later." });
    }

    const user = await queryOne("SELECT * FROM users WHERE email = ?", [email]);
    if (user && !user.email_verified) {
      const result = await issueEmailVerification(user, req);
      if (result.error) {
        console.error("Verification email resend failed:", result.error.message || result.error);
        return res.status(503).json({ error: "Couldn't send the verification email. Please try again." });
      }
    }

    res.json({ message: "If that account needs verification, a new link has been sent." });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/register", async (req, res) => {
  try {
    let { email, name, firstName, lastName, password, date_of_birth, country, referralCode, turnstileToken, phone, phoneVerificationToken } = req.body;
    firstName = cleanNamePart(firstName);
    lastName = cleanNamePart(lastName);
    if ((!firstName || !lastName) && name) {
      const split = splitDisplayName(name);
      firstName ||= split.firstName;
      lastName ||= split.lastName;
    }
    name = makeDisplayName(firstName, lastName, name);
    if (!email || !firstName || !lastName || !password)
      return res.status(400).json({ error: "email, first name, last name and password are required" });
    if (!phone || !phoneVerificationToken)
      return res.status(400).json({ error: "Please verify your phone number before creating your account." });

    // Bug fix: emails weren't normalized, so "User@x.com" and "user@x.com"
    // could register as two different accounts (SQLite TEXT comparison is
    // case-sensitive by default), and a returning user typing a different
    // case than they signed up with would fail to log in.
    email = email.trim().toLowerCase();
    const normalizedPhone = normalizeToE164(phone);
    if (!normalizedPhone) return res.status(400).json({ error: "Please enter a valid phone number." });

    // Signup rate limiting — separate IP and email limits, checked BEFORE
    // Turnstile so a flooded IP/email gets a cheap 429 without spending a
    // Cloudflare verification call on a request we're going to reject anyway.
    const ipLimit    = await recordRate("signup", `ip:${req.ip}`, { max: 5, windowMinutes: 30 });
    const emailLimit = await recordRate("signup", `email:${email}`, { max: 5, windowMinutes: 30 });
    if (!ipLimit.allowed || !emailLimit.allowed) {
      await logSecurityEvent("SIGNUP_BLOCKED", { ip: req.ip, metadata: { reason: "rate_limit", email } });
      return res.status(429).json({ error: "Too many signup attempts. Please try again later." });
    }

    if (await isDisposableEmail(email)) {
      await logSecurityEvent("SIGNUP_BLOCKED", { ip: req.ip, metadata: { reason: "disposable_email", email } });
      return res.status(400).json({ error: "Please use a permanent email address." });
    }

    // Turnstile — required on every signup, no progressive exception (unlike
    // login, there's no "trusted returning account" concept for a brand new
    // signup, so there's nothing to condition it on).
    const turnstileResult = await verifyTurnstileToken(turnstileToken, req.ip);
    if (!turnstileResult.success) {
      await logSecurityEvent("TURNSTILE_FAILED", { ip: req.ip, metadata: { route: "/register", reason: turnstileResult.reason } });
      return res.status(400).json({ error: "Verification failed — please try again.", code: "TURNSTILE_REQUIRED" });
    }

    // Risk engine — HIGH signup risk (e.g. many signups from this IP in a
    // short window, on top of repeated Turnstile failures) gets rejected
    // outright, matching the security architecture's "High Risk -> Reject
    // / manual review." MEDIUM isn't blocked here — Turnstile is already
    // mandatory for every signup regardless, so there's nothing further to
    // step up to short of rejecting, which per the doc should stay
    // reserved for HIGH to avoid blocking legitimate signups.
    const signupRisk = await assessSignupRisk({ ip: req.ip });
    await logSecurityEvent("RISK_ASSESSED", { ip: req.ip, metadata: { context: "signup", score: signupRisk.score, level: signupRisk.level, reasons: signupRisk.reasons, email } });
    if (signupRisk.level === "HIGH") {
      await logSecurityEvent("SIGNUP_BLOCKED", { ip: req.ip, metadata: { reason: "risk_high", email } });
      return res.status(403).json({ error: "We couldn't create your account right now. Please try again later or contact support." });
    }

    // Age check — must be 18+
    if (date_of_birth) {
      const age = (Date.now() - new Date(date_of_birth).getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      if (age < 18) return res.status(400).json({ error: "You must be 18 or older to register" });
    }

    const exists = await queryOne("SELECT id FROM users WHERE email = ?", [email]);
    if (exists) return res.status(409).json({ error: "Email already registered, Log in to continue" });

    const phoneTokenHash = hashToken(String(phoneVerificationToken));
    const phoneToken = await queryOne(
      "SELECT id FROM signup_phone_tokens WHERE token_hash = ? AND phone = ? AND used_at IS NULL AND expires_at > datetime('now')",
      [phoneTokenHash, normalizedPhone]
    );
    if (!phoneToken) return res.status(400).json({ error: "Phone verification expired. Please verify your phone again." });
    const consumedPhoneToken = await execute(
      "UPDATE signup_phone_tokens SET used_at = datetime('now') WHERE id = ? AND used_at IS NULL AND expires_at > datetime('now')",
      [phoneToken.id]
    );
    if (consumedPhoneToken.rowsAffected !== 1) {
      return res.status(400).json({ error: "Phone verification expired. Please verify your phone again." });
    }

    const hash = await bcrypt.hash(password, 12);
    const r = await execute(
    "INSERT INTO users (email, name, first_name, last_name, email_verified, password_hash, phone, phone_verified, date_of_birth, country, cash_balance, role) VALUES (?, ?, ?, ?, 0, ?, ?, 1, ?, ?, 0, ?)",
    [email, name, firstName, lastName, hash, normalizedPhone, date_of_birth || null, country || null, "user"]
    );
   const ownerEmail = (process.env.OWNER_EMAIL || "").trim().toLowerCase();
   if (ownerEmail && email === ownerEmail) {
   await execute("UPDATE users SET role=? WHERE id=?", ["owner", r.lastInsertRowid]);
    }

    // Every user gets their own referral code, and — if they signed up with
    // a friend's code — gets linked to that friend. Neither failure should
    // ever block account creation; the account itself already succeeded.
    try { await generateReferralCode(r.lastInsertRowid); } catch (e) { console.error("Referral code generation failed:", e.message); }
    try { await linkReferral(r.lastInsertRowid, referralCode); } catch (e) { console.error("Referral link failed:", e.message); }

    await logSecurityEvent("SIGNUP_SUCCESS", { userId: r.lastInsertRowid, ip: req.ip });

    const user = await queryOne("SELECT * FROM users WHERE id = ?", [r.lastInsertRowid]);
    const emailResult = await issueEmailVerification(user, req);
    if (emailResult.error) {
      console.error("Verification email send failed:", emailResult.error.message || emailResult.error);
      return res.status(202).json({
        message: "Account created, but we couldn't send the verification email. Use resend verification before signing in.",
        emailVerificationRequired: true,
        email,
      });
    }

    res.status(201).json({
      message: "Account created. Check your email to verify your account before signing in.",
      emailVerificationRequired: true,
      email,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Login ─────────────────────────────────────────────────────────────────────
// Progressive login protection thresholds — configurable via env rather
// than hardcoded, per the security architecture's own requirement.
const LOGIN_HARD_LIMIT          = parseInt(process.env.LOGIN_HARD_LIMIT || "10", 10);
const LOGIN_WINDOW_MINUTES      = parseInt(process.env.LOGIN_WINDOW_MINUTES || "15", 10);

router.post("/login", async (req, res) => {
  try {
    let { email, password, turnstileToken } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "email and password are required" });

    email = email.trim().toLowerCase(); // same normalization as register — see note above

    const { deviceId } = getOrSetDeviceId(req, res);

    // Progressive protection ladder:
    //   normal attempt -> repeated failures -> Turnstile required -> cooldown
    // Checked against BOTH ip and email (an attacker credential-stuffing
    // rotates IPs; a targeted attacker on one account might not) — either
    // one tripping the threshold is enough to step up requirements.
    const [ipFails, emailFails] = await Promise.all([
      peekRate("login_fail", `ip:${req.ip}`,       { windowMinutes: LOGIN_WINDOW_MINUTES }),
      peekRate("login_fail", `email:${email}`,     { windowMinutes: LOGIN_WINDOW_MINUTES }),
    ]);
    const recentFails = Math.max(ipFails.count, emailFails.count);

    if (recentFails >= LOGIN_HARD_LIMIT) {
      await logSecurityEvent("LOGIN_BLOCKED", { ip: req.ip, metadata: { reason: "cooldown", email } });
      return res.status(429).json({ error: "Too many failed attempts. Please try again in a few minutes." });
    }

    // Look up the user BEFORE assessing risk, so device trust (per-user)
    // factors into the score — but the response never reveals whether this
    // changed anything, so it can't be used to probe whether an email
    // exists. Risk computes the same way (userId: null) either way.
    const user = await queryOne("SELECT * FROM users WHERE email = ?", [email]);
    const deviceTrusted = user ? await isDeviceTrusted(user.id, deviceId) : false;

    const risk = await assessLoginRisk({
      userId: user?.id ?? null,
      ip: req.ip,
      deviceTrusted,
      recentFailedLogins: recentFails,
      accountCreatedAt: user?.created_at,
    });
    await logSecurityEvent("RISK_ASSESSED", { userId: user?.id ?? null, ip: req.ip, metadata: { context: "login", score: risk.score, level: risk.level, reasons: risk.reasons } });

    if (risk.actions.includes("REQUIRE_TURNSTILE")) {
      const turnstileResult = await verifyTurnstileToken(turnstileToken, req.ip);
      if (!turnstileResult.success) {
        await logSecurityEvent("TURNSTILE_FAILED", { ip: req.ip, metadata: { route: "/login", reason: turnstileResult.reason, riskLevel: risk.level } });
        return res.status(428).json({ error: "Additional verification required.", code: "TURNSTILE_REQUIRED" });
      }
    }

    if (!user || !user.password_hash) {
      await recordRate("login_fail", `ip:${req.ip}`,   { max: LOGIN_HARD_LIMIT, windowMinutes: LOGIN_WINDOW_MINUTES });
      await recordRate("login_fail", `email:${email}`, { max: LOGIN_HARD_LIMIT, windowMinutes: LOGIN_WINDOW_MINUTES });
      await logSecurityEvent("LOGIN_FAILED", { ip: req.ip, metadata: { email } });
      return res.status(401).json({ error: "Invalid credentials" }); // never reveal whether the email exists
    }

    if (user.account_status === "banned") return res.status(403).json({ error: user.ban_reason || TERMINATED_MESSAGE, code: "ACCOUNT_TERMINATED" });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await recordRate("login_fail", `ip:${req.ip}`,   { max: LOGIN_HARD_LIMIT, windowMinutes: LOGIN_WINDOW_MINUTES });
      await recordRate("login_fail", `email:${email}`, { max: LOGIN_HARD_LIMIT, windowMinutes: LOGIN_WINDOW_MINUTES });
      await logSecurityEvent("LOGIN_FAILED", { userId: user.id, ip: req.ip, metadata: { email } });
      return res.status(401).json({ error: "Invalid credentials" });
    }
    if (!user.email_verified) {
      await logSecurityEvent("LOGIN_BLOCKED", { userId: user.id, ip: req.ip, metadata: { reason: "email_unverified" } });
      return res.status(403).json({ error: "Please verify your email before signing in.", code: "EMAIL_VERIFICATION_REQUIRED" });
    }

    if (!deviceTrusted) await logSecurityEvent("NEW_DEVICE_LOGIN", { userId: user.id, ip: req.ip, metadata: { device: parseDevice(req.headers["user-agent"]) } });
    await logSecurityEvent("LOGIN_SUCCESS", { userId: user.id, ip: req.ip });

    // 2FA gate — password was correct, but don't issue real session tokens
    // yet. A short-lived (5 min) pending token carries just enough to prove
    // "this request already passed the password check" through to
    // POST /api/auth/2fa/verify, without creating a session or refresh
    // token until the TOTP code is confirmed too.
    //
    // Device trust is deferred to the 2FA step for these accounts — a
    // password alone isn't a full authentication when 2FA is enabled, so
    // this device shouldn't be marked trusted until the TOTP code clears too.
    if (user.totp_enabled) {
      const tempToken = jwt.sign({ sub: user.id, type: "2fa_pending", deviceTrusted, deviceId }, JWT_SECRET, { expiresIn: "5m" });
      return res.json({ requires2FA: true, tempToken });
    }

    // HIGH risk with no TOTP 2FA available — step up with a phone OTP
    // instead, if the account has a verified phone to send one to. If it
    // doesn't, there's no second factor to fall back on; Turnstile above
    // already applies, and the event is logged for audit, but the account
    // isn't hard-blocked with no way through (avoids locking out a
    // legitimate user who's simply never added a phone).
    if (risk.level === "HIGH" && user.phone_verified && user.phone) {
      const otpLimit = await recordRate("login_risk_otp_send", `user:${user.id}`, { max: 5, windowMinutes: 30 });
      if (!otpLimit.allowed) return res.status(429).json({ error: "Too many verification requests. Please try again later." });
      const sendResult = await sendVerificationCode(user.phone);
      if (sendResult.success) {
        await logSecurityEvent("HIGH_RISK_LOGIN_OTP_SENT", { userId: user.id, ip: req.ip, metadata: { score: risk.score, reasons: risk.reasons } });
        const tempToken = jwt.sign({ sub: user.id, type: "risk_otp_pending", deviceId, deviceTrusted }, JWT_SECRET, { expiresIn: "5m" });
        return res.json({ requiresOTP: true, tempToken });
      }
      // If Twilio itself is unreachable, fail through to Turnstile-only
      // protection rather than blocking a legitimate login entirely on an
      // external service outage — Turnstile has already been enforced above.
      console.error("High-risk login OTP send failed — proceeding on Turnstile alone:", user.id);
    }

    await trustDevice(user.id, deviceId, parseDevice(req.headers["user-agent"]));
    const sessionId    = await createSession(user.id, req, deviceId);
    const accessToken  = signAccessToken(user.id, sessionId);
    const refreshToken = await signRefreshToken(user.id, sessionId);
    maybeSendNewDeviceEmail(user, req, deviceTrusted);
    res.json({ accessToken, refreshToken, user: await safeUser(user) });
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
    const { deviceId } = getOrSetDeviceId(req, res);
    await trustDevice(req.user.id, deviceId, parseDevice(req.headers["user-agent"]));
    const sessionId     = await createSession(req.user.id, req, deviceId);
    const accessToken   = signAccessToken(req.user.id, sessionId);
    const refreshToken  = await signRefreshToken(req.user.id, sessionId);
    const clientURL     = process.env.CLIENT_URL || "http://localhost:5173";
    res.redirect(`${clientURL}/auth/callback?access=${accessToken}&refresh=${refreshToken}`);
  }
);

// ── Me ────────────────────────────────────────────────────────────────────────
router.get("/me", authenticate, async (req, res) => {
  res.json({ user: await safeUser(req.user) });
});

// ── Sessions (login/device history) ─────────────────────────────────────────
router.get("/sessions", authenticate, async (req, res) => {
  try {
    const rows = await queryAll(
      "SELECT id, device, ip, login_at, device_id FROM sessions WHERE user_id = ? AND logout_at IS NULL ORDER BY login_at DESC LIMIT 20",
      [req.user.id]
    );
    const trustedRows = await queryAll(
      "SELECT device_id, expires_at FROM trusted_devices WHERE user_id = ? AND expires_at > datetime('now')",
      [req.user.id]
    );
    const trustedSet = new Set(trustedRows.map(t => t.device_id));
    const sessions = rows.map(s => ({
      id:        s.id,
      device:    s.device,
      login_at:  s.login_at,
      current:   req.sessionId != null && Number(req.sessionId) === Number(s.id),
      trusted:   Boolean(s.device_id && trustedSet.has(s.device_id)),
    }));
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Revoke trust for a device WITHOUT necessarily ending the live session on
// it — the next login from that device will need to earn trust again
// (Turnstile step-up), even if the current session stays active until it
// naturally expires or the user signs it out separately.
router.delete("/trusted-devices/:sessionId", authenticate, async (req, res) => {
  try {
    const session = await queryOne(
      "SELECT device_id FROM sessions WHERE id = ? AND user_id = ?",
      [req.params.sessionId, req.user.id]
    );
    if (!session?.device_id) return res.status(404).json({ error: "Device not found" });

    await execute("DELETE FROM trusted_devices WHERE user_id = ? AND device_id = ?", [req.user.id, session.device_id]);
    await logSecurityEvent("DEVICE_TRUST_REVOKED", { userId: req.user.id, ip: req.ip });
    res.json({ message: "Device trust revoked. It'll need to verify again next time." });
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
    const { name } = req.body;
    const userId = req.user.id;
    const sets = [], vals = [];

    if (name) {
      const displayName = String(name).trim().replace(/\s+/g, " ");
      const split = splitDisplayName(displayName);
      sets.push("name = ?", "first_name = ?", "last_name = ?");
      vals.push(displayName, split.firstName || null, split.lastName || null);
    }
    if (sets.length === 0) return res.status(400).json({ error: "Nothing to update" });

    sets.push("updated_at = datetime('now')");
    vals.push(userId);
    await execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, vals);
    const updated = await queryOne("SELECT * FROM users WHERE id = ?", [userId]);
    res.json({ user: await safeUser(updated) });
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
      "UPDATE users SET password_hash = ?, last_sensitive_change_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [hash, req.user.id]
    );
    await logSecurityEvent("PASSWORD_CHANGED", { userId: req.user.id, ip: req.ip });
    res.json({ message: "Password updated successfully" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Two-factor authentication (TOTP) ─────────────────────────────────────────
// Setup is two-step on purpose: /setup generates a secret but doesn't touch
// totp_enabled or the real totp_secret yet, so an abandoned setup (user
// closes the QR modal without entering a code) can never leave the account
// half-configured or accidentally locked. Only /enable, after a valid code
// proves the user actually scanned it, promotes the pending secret to real.

function generateBackupCodes(count = 8) {
  // XXXX-XXXX, easy to read back off a screen or write down.
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

router.post("/2fa/setup", authenticate, async (req, res) => {
  try {
    if (req.user.totp_enabled) return res.status(400).json({ error: "2FA is already enabled" });

    const secret = authenticator.generateSecret();
    await execute("UPDATE users SET totp_secret_pending = ?, updated_at = datetime('now') WHERE id = ?", [secret, req.user.id]);

    const otpauth = authenticator.keyuri(req.user.email, "Wave", secret);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauth);

    res.json({ secret, qrCodeDataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/2fa/enable", authenticate, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user.totp_secret_pending) return res.status(400).json({ error: "Start setup first" });
    if (!code || !authenticator.check(String(code).trim(), user.totp_secret_pending))
      return res.status(400).json({ error: "Invalid code — check your authenticator app and try again" });

    const backupCodes = generateBackupCodes();
    const hashedCodes = await Promise.all(backupCodes.map(c => bcrypt.hash(c, 10)));

    await execute(
      "UPDATE users SET totp_secret = ?, totp_secret_pending = NULL, totp_enabled = 1, totp_backup_codes = ?, updated_at = datetime('now') WHERE id = ?",
      [user.totp_secret_pending, JSON.stringify(hashedCodes), req.user.id]
    );

    // Backup codes are shown once, in plaintext, right now — only the
    // bcrypt hashes are ever stored, same as the account password.
    res.json({ message: "Two-factor authentication enabled", backupCodes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/2fa/disable", authenticate, async (req, res) => {
  try {
    const { password, code } = req.body;
    const user = await queryOne("SELECT * FROM users WHERE id = ?", [req.user.id]);
    if (!user.totp_enabled) return res.status(400).json({ error: "2FA is not enabled" });
    if (!user.password_hash) return res.status(400).json({ error: "Account uses Google login — no password set" });

    const validPassword = password && await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(401).json({ error: "Incorrect password" });

    const validCode = code && authenticator.check(String(code).trim(), user.totp_secret);
    if (!validCode) return res.status(401).json({ error: "Invalid authenticator code" });

    await execute(
      "UPDATE users SET totp_secret = NULL, totp_secret_pending = NULL, totp_enabled = 0, totp_backup_codes = NULL, last_sensitive_change_at = datetime('now'), updated_at = datetime('now') WHERE id = ?",
      [req.user.id]
    );
    await logSecurityEvent("TWOFA_DISABLED", { userId: req.user.id, ip: req.ip });
    res.json({ message: "Two-factor authentication disabled" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2 of login when totp_enabled — takes the tempToken from /login and a
// 6-digit code (or a one-time backup code), then finally issues real
// session + tokens, same shape as a normal login response.
router.post("/2fa/verify", async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: "tempToken and code are required" });

    let payload;
    try {
      payload = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Login session expired — please sign in again" });
    }
    if (payload.type !== "2fa_pending") return res.status(401).json({ error: "Invalid token" });

    const user = await queryOne("SELECT * FROM users WHERE id = ?", [payload.sub]);
    if (!user || !user.totp_enabled) return res.status(401).json({ error: "Invalid token" });
    if (user.account_status === "banned") return res.status(403).json({ error: user.ban_reason || TERMINATED_MESSAGE, code: "ACCOUNT_TERMINATED" });
    if (!user.email_verified) return res.status(403).json({ error: "Please verify your email before signing in.", code: "EMAIL_VERIFICATION_REQUIRED" });

    const trimmedCode = String(code).trim();
    let usedBackupCode = false;

    let ok = authenticator.check(trimmedCode, user.totp_secret);
    if (!ok) {
      // Fall back to backup codes — each one works exactly once.
      const backupCodes = JSON.parse(user.totp_backup_codes || "[]");
      for (let i = 0; i < backupCodes.length; i++) {
        if (await bcrypt.compare(trimmedCode.toUpperCase(), backupCodes[i])) {
          ok = true;
          usedBackupCode = true;
          backupCodes.splice(i, 1);
          await execute("UPDATE users SET totp_backup_codes = ? WHERE id = ?", [JSON.stringify(backupCodes), user.id]);
          break;
        }
      }
    }
    if (!ok) return res.status(401).json({ error: "Invalid code" });

    // Full authentication now complete (password + TOTP) — this is the
    // point where a device earns trust for a 2FA-enabled account.
    const { deviceId: cookieDeviceId } = getOrSetDeviceId(req, res);
    const deviceId = payload.deviceId || cookieDeviceId;
    await trustDevice(user.id, deviceId, parseDevice(req.headers["user-agent"]));

    const sessionId    = await createSession(user.id, req, deviceId);
    const accessToken  = signAccessToken(user.id, sessionId);
    const refreshToken = await signRefreshToken(user.id, sessionId);
    maybeSendNewDeviceEmail(user, req, Boolean(payload.deviceTrusted));
    res.json({ accessToken, refreshToken, user: await safeUser(user), usedBackupCode });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2 of login for a HIGH-risk sign-in on an account WITHOUT TOTP 2FA
// enabled — a phone OTP step-up instead. Same shape and same rule as
// every other verification endpoint in this file: the backend asks Twilio
// directly whether phone+code check out, never trusts a client claim.
router.post("/risk-otp/verify", async (req, res) => {
  try {
    const { tempToken, code } = req.body;
    if (!tempToken || !code) return res.status(400).json({ error: "tempToken and code are required" });

    let payload;
    try {
      payload = jwt.verify(tempToken, JWT_SECRET);
    } catch {
      return res.status(401).json({ error: "Login session expired — please sign in again" });
    }
    if (payload.type !== "risk_otp_pending") return res.status(401).json({ error: "Invalid token" });

    const user = await queryOne("SELECT * FROM users WHERE id = ?", [payload.sub]);
    if (!user || !user.phone_verified || !user.phone) return res.status(401).json({ error: "Invalid token" });
    if (user.account_status === "banned") return res.status(403).json({ error: user.ban_reason || TERMINATED_MESSAGE, code: "ACCOUNT_TERMINATED" });
    if (!user.email_verified) return res.status(403).json({ error: "Please verify your email before signing in.", code: "EMAIL_VERIFICATION_REQUIRED" });

    const verifyLimit = await recordRate("login_risk_otp_verify", `user:${user.id}`, { max: 5, windowMinutes: 15 });
    if (!verifyLimit.allowed) return res.status(429).json({ error: "Too many attempts. Please try again later." });

    const check = await checkVerificationCode(user.phone, code);
    if (!check.approved) {
      await logSecurityEvent("HIGH_RISK_LOGIN_OTP_FAILED", { userId: user.id, ip: req.ip });
      return res.status(401).json({ error: "Invalid or expired code." });
    }

    const deviceId = payload.deviceId || getOrSetDeviceId(req, res).deviceId;
    await trustDevice(user.id, deviceId, parseDevice(req.headers["user-agent"]));
    await logSecurityEvent("HIGH_RISK_LOGIN_OTP_VERIFIED", { userId: user.id, ip: req.ip });

    const sessionId    = await createSession(user.id, req, deviceId);
    const accessToken  = signAccessToken(user.id, sessionId);
    const refreshToken = await signRefreshToken(user.id, sessionId);
    maybeSendNewDeviceEmail(user, req, Boolean(payload.deviceTrusted));
    res.json({ accessToken, refreshToken, user: await safeUser(user) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
