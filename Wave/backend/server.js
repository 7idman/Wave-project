/**
 * server.js — Wave Crypto Platform Backend
 * Stack: Node.js + Express + @libsql/client (Turso / local SQLite)
 *
 * Run:
 *   npm run dev    (development — auto-restarts)
 *   npm start      (production)
 */

require("dotenv").config();

const express        = require("express");
const cors           = require("cors");
const session        = require("express-session");
const MemoryStore    = require("memorystore")(session);
const passport       = require("passport");
const rateLimit      = require("express-rate-limit");
const { initSchema, execute } = require("./db");
const { authenticate } = require("./middleware/auth");

const authRoutes      = require("./routes/auth");
const priceRoutes     = require("./routes/prices");
const tradeRoutes     = require("./routes/trades");
const portfolioRoutes = require("./routes/portfolio");
const txRoutes        = require("./routes/transactions");
const notificationRoutes = require("./routes/notifications");
const requestRoutes = require("./routes/requests");
const adminRoutes = require("./routes/admin");
const transferRoutes = require("./routes/transfers");
const strategyRoutes = require("./routes/strategies");
const managedRoutes = require("./routes/managed");
const accountRoutes = require("./routes/account");
const { startPriceSnapshotSchedule } = require("./services/priceSnapshot");
const { fetchStockPrices } = require("./services/stocks");

const app  = express();
const PORT = process.env.PORT || 4000;

// Bug fix: Railway (and most hosts) put your app behind a reverse proxy, so
// the real client IP arrives in an X-Forwarded-For header rather than as the
// raw socket address. Without this, express-rate-limit's authLimiter either
// throttles everyone as if they share one IP, or — on express-rate-limit v7+
// — throws an "ERR_ERL_UNEXPECTED_X_FORWARDED_FOR" validation error outright.
// It also means req.ip (now used for session device history) always resolved
// to the proxy's address instead of the visitor's.
app.set("trust proxy", 1);

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Concept: limits each IP to 10 login/register attempts per 15 minutes.
// Only applied to /login and /register — NOT to /me or other auth routes.
// This prevents brute-force password attacks without locking out normal users.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minute window
  max: 10,                   // max 10 attempts per IP per window
  message: { error: "Too many attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── CORS ──────────────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  process.env.CLIENT_URL || "http://localhost:5173",
  "http://localhost:5173",
  "http://localhost:4173",
  "http://localhost:3000",
];
app.use(cors({
  origin: (origin, cb) => {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
}));

// ── Body parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));

// ── Session ───────────────────────────────────────────────────────────────────
// Concept: memorystore keeps sessions in RAM like the default MemoryStore,
// but automatically deletes expired sessions every hour via a cleanup timer.
// This prevents the memory leak where sessions pile up forever and eventually
// crash the server. No native C++ compilation needed — works on any OS.
app.use(session({
  store: new MemoryStore({
    checkPeriod: 60 * 60 * 1000, // clean up expired sessions every 1 hour
  }),
  secret:            process.env.SESSION_SECRET || "wave_session_secret",
  resave:            false,
  saveUninitialized: false,
  cookie: {
    secure:   process.env.NODE_ENV === "production",
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    maxAge:   7 * 24 * 60 * 60 * 1000, // 7 days
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Routes ────────────────────────────────────────────────────────────────────
// Concept: rate limiter is applied ONLY to login and register, not to all
// auth routes. /api/auth/me (called on every page load to verify the user
// is still logged in) is deliberately excluded so normal browsing never
// triggers the lockout.
app.use("/api/auth/login",    authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth",          authRoutes);
app.use("/api/prices",        priceRoutes);
app.use("/api/trades",        authenticate, tradeRoutes);
app.use("/api/portfolio",     authenticate, portfolioRoutes);
app.use("/api/transactions",  authenticate, txRoutes);
app.use("/api/notifications", authenticate, notificationRoutes);
app.use("/api/requests", authenticate, requestRoutes);
app.use("/api/admin", authenticate, adminRoutes);
app.use("/api/transfers", authenticate, transferRoutes);
app.use("/api/strategies", authenticate, strategyRoutes);
app.use("/api/managed", authenticate, managedRoutes);
app.use("/api/account", authenticate, accountRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ── JSON error handler ────────────────────────────────────────────────────────
// Concept: this MUST be the last thing registered. Express identifies error
// handlers by their 4 arguments (err, req, res, next). Any unhandled error
// in any route lands here and returns clean JSON instead of an HTML page —
// which was causing "Unexpected token < is not valid JSON" in the frontend.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initSchema();
    const cleanup = await execute("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')");
if (cleanup.rowsAffected > 0) {
  console.log(`🧹 Cleared ${cleanup.rowsAffected} expired refresh token(s)`);
}
    priceRoutes.fetchLivePrices().catch(console.warn);
    fetchStockPrices().then(r=>console.log(`Stocks: ${r.updated} updated, ${r.skipped} skipped`)).catch(console.warn);
    setInterval(() => { fetchStockPrices().catch(console.warn); }, 5 * 60 * 1000);
    startPriceSnapshotSchedule();
    app.listen(PORT, () => {
      console.log(`🚀 Wave API running on http://localhost:${PORT}`);
      console.log(`📦 Database: ${process.env.LIBSQL_URL || "file:wave.db"}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
}

start();