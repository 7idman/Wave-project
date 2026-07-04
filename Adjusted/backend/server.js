/**
 * server.js — Wave Crypto Platform Backend
 * Stack: Node.js + Express + @libsql/client (Turso / local SQLite)
 *
 * Install:
 *   npm install
 *
 * Setup:
 *   cp .env.example .env   (fill in JWT_SECRET, SESSION_SECRET)
 *
 * Run:
 *   npm run dev    (development — auto-restarts)
 *   npm start      (production)
 */

require("dotenv").config();
const rateLimit = require("express-rate-limit");

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // max 10 attempts per IP per 15 min
  message: { error: "Too many attempts, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

const express   = require("express");
const cors      = require("cors");
const session   = require("express-session");
const passport  = require("passport");
const { initSchema } = require("./db");
const { authenticate } = require("./middleware/auth");

const authRoutes      = require("./routes/auth");
const priceRoutes     = require("./routes/prices");
const tradeRoutes     = require("./routes/trades");
const portfolioRoutes = require("./routes/portfolio");
const txRoutes        = require("./routes/transactions");

const app  = express();
const PORT = process.env.PORT || 4000;

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

// ── Session + Passport (for Google OAuth) ────────────────────────────────────
app.use(session({
  secret:            process.env.SESSION_SECRET || "wave_session_secret",
  resave:            false,
  saveUninitialized: false,
  cookie: {
      secure:   process.env.NODE_ENV === "production",
  sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
  maxAge:   7 * 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth/login",    authLimiter, authRoutes);
app.use("/api/auth/register", authLimiter, authRoutes);
app.use("/api/auth",          authRoutes);
app.use("/api/prices",       priceRoutes);
app.use("/api/trades",       authenticate, tradeRoutes);
app.use("/api/portfolio",    authenticate, portfolioRoutes);
app.use("/api/transactions", authenticate, txRoutes);

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (_, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// ── Boot: init DB schema first, then start HTTP server ───────────────────────
// ── JSON error handler (must be registered last) ──────────────────────────
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});
async function start() {
  try {
    await initSchema();                          // creates tables + runs migrations
    priceRoutes.fetchLivePrices().catch(console.warn);   // ← add this line
    app.listen(PORT, () => {                       // creates tables + runs migrations
      console.log(`🚀 Wave API running on http://localhost:${PORT}`);
      console.log(`📦 Database: ${process.env.LIBSQL_URL || "file:wave.db"}`);
    });
  } catch (err) {
    console.error("❌ Failed to start server:", err.message);
    process.exit(1);
  }
}

start();
