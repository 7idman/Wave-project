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
const SQLiteStore    = require("connect-sqlite3")(session);
const passport       = require("passport");
const rateLimit      = require("express-rate-limit");
const { initSchema } = require("./db");
const { authenticate } = require("./middleware/auth");

const authRoutes      = require("./routes/auth");
const priceRoutes     = require("./routes/prices");
const tradeRoutes     = require("./routes/trades");
const portfolioRoutes = require("./routes/portfolio");
const txRoutes        = require("./routes/transactions");

const app  = express();
const PORT = process.env.PORT || 4000;

// ── Rate limiter — applied directly to auth routes ────────────────────────────
// Concept: limits each IP to 10 login/register attempts per 15 minutes.
// Prevents brute-force password attacks on a financial platform.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
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

// ── Body parser — 10mb for base64 avatar uploads ──────────────────────────────
app.use(express.json({ limit: "10mb" }));

// ── Session + Passport ────────────────────────────────────────────────────────
// Concept: connect-sqlite3 stores sessions in a file on disk instead of RAM.
// This prevents the MemoryStore memory leak where sessions pile up forever
// and eventually crash the server when it runs out of RAM.
app.use(session({
  store: new SQLiteStore({ db: "sessions.db", dir: "/tmp" }),
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
// Concept: each route is registered ONCE only. The rate limiter is passed
// as middleware directly to the specific routes that need it, not by
// registering the same router multiple times (which caused double-handling).
app.use("/api/auth",         authLimiter, authRoutes);
app.use("/api/prices",       priceRoutes);
app.use("/api/trades",       authenticate, tradeRoutes);
app.use("/api/portfolio",    authenticate, portfolioRoutes);
app.use("/api/transactions", authenticate, txRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ── JSON error handler ────────────────────────────────────────────────────────
// Concept: this MUST be registered last, after all routes. Express identifies
// error handlers by their 4 arguments (err, req, res, next). Any route that
// calls next(err) or throws will land here, returning clean JSON instead of
// the default HTML error page that confuses the frontend.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ── Boot ──────────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initSchema();
    priceRoutes.fetchLivePrices().catch(console.warn);
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