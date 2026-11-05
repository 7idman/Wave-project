/**
 * server.js — Wave Crypto Platform Backend
 * Stack: Node.js + Express + @libsql/client (Turso / local SQLite)
 *
 * Run:
 *   npm run dev    (development — auto-restarts)
 *   npm start      (production)
 */

require("dotenv").config();

const { validateProductionSecrets } = require("./lib/productionSecrets");

validateProductionSecrets();

const express        = require("express");
const cors           = require("cors");
const session        = require("express-session");
const passport       = require("passport");
const { initSchema, execute, closeDatabase } = require("./db");
const { authenticate } = require("./middleware/auth");
const { databaseRateLimit } = require("./middleware/databaseRateLimit");

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
const referralRoutes = require("./routes/referrals");
const phoneRoutes = require("./routes/phone");
const clientErrorRoutes = require("./routes/clientErrors");
const autoInvestRoutes = require("./routes/autoInvest");
const priceAlertRoutes = require("./routes/priceAlerts");
const { startAutoInvestSchedule, waitForAutoInvestIdle } = require("./services/autoInvest");
const { startPriceSnapshotSchedule, waitForPriceSnapshotIdle } = require("./services/priceSnapshot");
const { startStrategyMirrorSchedule, waitForStrategyMirrorIdle } = require("./services/strategyMirroring");
const { startStockRefreshSchedule, waitForStockRefreshIdle } = require("./services/stockRefreshJobs");
const {
  LibsqlSessionStore,
  startSessionCleanupSchedule,
  waitForSessionCleanupIdle,
} = require("./services/libsqlSessionStore");
const { runWithSchedulerLease } = require("./services/schedulerLease");
const shutdownSignal = require("./lib/shutdownSignal");

const app  = express();
const PORT = Number.parseInt(process.env.PORT || "4000", 10);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) {
  throw new Error("PORT must be an integer between 0 and 65535");
}
const SHUTDOWN_TIMEOUT_MS = Math.max(1000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 10000);
const httpSessionStore = new LibsqlSessionStore();
let activeServer = null;
let shutdownInFlight = null;
const scheduleHandles = new Set();
const backgroundTasks = new Map();
app.disable("x-powered-by");

// Railway puts the app behind a reverse proxy. Trust one proxy hop so the
// shared database limiter and security logs use the actual visitor IP.
app.set("trust proxy", 1);

// ── Rate limiter ──────────────────────────────────────────────────────────────
// Concept: limits each IP to 10 login/register attempts per 15 minutes.
// Only applied to /login and /register — NOT to /me or other auth routes.
// This prevents brute-force password attacks without locking out normal users.
const authLimiter = databaseRateLimit({ scope: "auth_ip", max: 10, windowMinutes: 15 });

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
    const error = new Error(`CORS blocked: ${origin}`);
    error.status = 403;
    cb(error);
  },
  credentials: true,
}));

// ── Body parser ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: "10mb" }));
app.use(require("cookie-parser")());

// ── Session ───────────────────────────────────────────────────────────────────
// Sessions live in libSQL rather than process memory. Railway restarts no
// longer log Passport users out, and every replica sees the same session.
app.use(session({
  store:             httpSessionStore,
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
app.use("/api/auth/2fa/verify", authLimiter);
app.use("/api/phone/send-code", authLimiter);
app.use("/api/phone/verify-code", authLimiter);
app.use("/api/auth/risk-otp/verify", authLimiter);
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
app.use("/api/referrals", authenticate, referralRoutes);
app.use("/api/phone", authenticate, phoneRoutes);
app.use("/api/client-errors", clientErrorRoutes); // no `authenticate` — see routes/clientErrors.js for why
app.use("/api/auto-invest", authenticate, autoInvestRoutes);
app.use("/api/price-alerts", authenticate, priceAlertRoutes);

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
function trackBackgroundTask(name, task) {
  backgroundTasks.set(name, task);
  const done = () => backgroundTasks.delete(name);
  task.then(done, done);
  return task;
}

function rememberScheduleHandle(handle) {
  if (handle) scheduleHandles.add(handle);
  return handle;
}

function stopSchedules() {
  for (const handle of scheduleHandles) clearInterval(handle);
  scheduleHandles.clear();
}

function closeHttpServer(server) {
  if (!server?.listening) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function start() {
  shutdownSignal.reset();
  if (activeServer?.listening) return activeServer;

  await initSchema();
  const cleanup = await execute("DELETE FROM refresh_tokens WHERE expires_at < datetime('now')");
  if (cleanup.rowsAffected > 0) {
    console.log(`[info] Cleared ${cleanup.rowsAffected} expired refresh token(s)`);
  }

  trackBackgroundTask(
    "crypto-price-warmup",
    runWithSchedulerLease("crypto-price-warmup", 60 * 1000, priceRoutes.fetchLivePrices)
      .catch(error => console.warn("Crypto price warmup failed:", error.message))
  );
  const stockSchedule = startStockRefreshSchedule();
  rememberScheduleHandle(stockSchedule.refreshHandle);
  rememberScheduleHandle(stockSchedule.pollHandle);
  rememberScheduleHandle(startPriceSnapshotSchedule());
  rememberScheduleHandle(startAutoInvestSchedule());
  rememberScheduleHandle(startStrategyMirrorSchedule());
  rememberScheduleHandle(startSessionCleanupSchedule(httpSessionStore));

  activeServer = await new Promise((resolve, reject) => {
    const server = app.listen(PORT, () => {
      server.removeListener("error", reject);
      const address = server.address();
      const listeningPort = typeof address === "object" && address ? address.port : PORT;
      console.log(`[info] Wave API running on http://localhost:${listeningPort}`);
      console.log(`[info] Database: ${process.env.LIBSQL_URL || "file:wave.db"}`);
      resolve(server);
    });
    server.once("error", reject);
  });
  return activeServer;
}

async function stop({ timeoutMs = SHUTDOWN_TIMEOUT_MS } = {}) {
  if (shutdownInFlight) return shutdownInFlight;
  shutdownInFlight = (async () => {
    stopSchedules();
    shutdownSignal.abort();
    const drains = new Map([
      ...backgroundTasks,
      ["stock-refresh", waitForStockRefreshIdle()],
      ["price-snapshot", waitForPriceSnapshotIdle()],
      ["auto-invest", waitForAutoInvestIdle()],
      ["strategy-mirror", waitForStrategyMirrorIdle()],
      ["session-cleanup", waitForSessionCleanupIdle()],
    ]);
    const pendingDrains = new Set(drains.keys());
    for (const [name, promise] of drains) {
      const done = () => pendingDrains.delete(name);
      promise.then(done, done);     // never promise.finally(): that creates a new unhandled rejection
    }

    const gracefulWork = Promise.all([
      closeHttpServer(activeServer),
      Promise.allSettled([...drains.values()]),
    ]);

    let timeoutHandle;
    const timedOut = await Promise.race([
      gracefulWork.then(() => false),
      new Promise(resolve => {
        timeoutHandle = setTimeout(() => resolve(true), timeoutMs);
        timeoutHandle.unref?.();
      }),
    ]);
    if (timeoutHandle) clearTimeout(timeoutHandle);

    if (timedOut) {
      activeServer?.closeAllConnections?.();
      console.warn("[warn] shutdown drain timed out; still pending:", [...pendingDrains].join(", "));
      return { timedOut: true };
    }
    await closeDatabase();
    activeServer = null;
    return { timedOut: false };
  })();
  return shutdownInFlight;
}

function installShutdownHandlers() {
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      console.log(`[info] ${signal} received; shutting down gracefully`);
      stop().then(({ timedOut }) => {
        if (timedOut) console.warn(`[warn] Shutdown exceeded ${SHUTDOWN_TIMEOUT_MS}ms; forcing exit so durable workers can recover.`);
        process.exit(0);
      }).catch(error => {
        console.error("[error] Graceful shutdown failed:", error.message);
        process.exit(1);
      });
    });
  }
}

let fatalInProgress = false;

function installCrashGuards(drain) {
  const onFatal = label => error => {
    if (shutdownInFlight) {
      console.warn(`[warn] ${label} during shutdown:`, error);
      return;
    }
    console.error(`[fatal] ${label}:`, error);
    if (fatalInProgress) return;
    fatalInProgress = true;
    setTimeout(() => process.exit(1), SHUTDOWN_TIMEOUT_MS + 10_000).unref?.();
    Promise.resolve().then(() => drain())
      .catch(err => console.error("[fatal] drain failed:", err))
      .finally(() => process.exit(1));
  };
  process.on("unhandledRejection", onFatal("Unhandled rejection"));
  process.on("uncaughtException", onFatal("Uncaught exception"));
}

if (require.main === module) {
  start().then(() => {
    installShutdownHandlers();
    installCrashGuards(stop);
  }).catch(error => {
    stopSchedules();
    console.error("[error] Failed to start server:", error.message);
    process.exit(1);
  });
}

module.exports = { app, start, stop, installCrashGuards };
