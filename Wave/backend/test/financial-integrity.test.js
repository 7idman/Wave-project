const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

// Each run gets a private file database because libSQL transactions use a
// separate connection and therefore cannot share SQLite's `:memory:` state.
// Setting this before the first require is important: db.js creates its client
// at module load.
const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wave-financial-tests-"));
const testDatabasePath = path.join(testDirectory, "financial.db").replaceAll("\\", "/");
process.env.LIBSQL_URL = `file:${testDatabasePath}`;
process.env.OWNER_EMAIL = "";

const db = require("../db");
const { applyDepositBonus } = require("../services/promotions");
const { checkReferralBonus } = require("../services/referrals");
const {
  enqueueStrategyMirrorJobs,
  processPendingStrategyMirrorJobs,
  processStrategyMirrorJobsForTrade,
  retryStrategyMirrorJob,
} = require("../services/strategyMirroring");
const { checkAndRecord } = require("../services/rateLimit");
const { parseMoneyToCents, roundMoneyToCents, centsFromRate, dollarsFromCents } = require("../utils/money");

let sequence = 0;

async function createUser({ cashBalance = 0, referralCode = null } = {}) {
  sequence += 1;
  const inserted = await db.execute(
    `INSERT INTO users (email, name, cash_balance, referral_code)
     VALUES (?, ?, ?, ?)`,
    [`financial-test-${sequence}@example.com`, `Financial Test ${sequence}`, cashBalance, referralCode]
  );
  return inserted.lastInsertRowid;
}

async function createDeposit(userId, total) {
  const inserted = await db.execute(
    `INSERT INTO transactions
       (user_id, type, symbol, amount, price, fee, total, status)
     VALUES (?, 'deposit', 'USD', ?, 1, 0, ?, 'completed')`,
    [userId, total, total]
  );
  return inserted.lastInsertRowid;
}

async function createMirrorFixture({ cashBalance = 1000 } = {}) {
  const adminId = await createUser();
  const subscriberId = await createUser();
  await db.execute(
    `INSERT INTO price_cache (symbol, price, change_24h, asset_type)
     VALUES ('AAPL', 100, 0, 'stock')
     ON CONFLICT(symbol) DO UPDATE SET price = excluded.price, asset_type = 'stock'`
  );
  const strategyPortfolio = await db.execute(
    "INSERT INTO portfolios (user_id, type, cash_balance) VALUES (NULL, 'strategy', 10000)"
  );
  const strategy = await db.execute(
    "INSERT INTO strategies (name, description, fee, portfolio_id) VALUES (?, '', 0, ?)",
    [`Recovery Strategy ${sequence}`, strategyPortfolio.lastInsertRowid]
  );
  const copier = await db.execute(
    "INSERT INTO portfolios (user_id, type, strategy_id, cash_balance) VALUES (?, 'copier', ?, ?)",
    [subscriberId, strategy.lastInsertRowid, cashBalance]
  );
  const trade = await db.execute(
    `INSERT INTO strategy_trades (strategy_id, symbol, side, amount, price, admin_id)
     VALUES (?, 'AAPL', 'buy', 1, 100, ?)`,
    [strategy.lastInsertRowid, adminId]
  );
  const queued = await db.withTransaction(tx => enqueueStrategyMirrorJobs(tx, {
    strategyId: strategy.lastInsertRowid,
    tradeId: trade.lastInsertRowid,
    proportion: 0.1,
  }));
  assert.equal(queued, 1);
  return {
    subscriberId,
    portfolioId: copier.lastInsertRowid,
    tradeId: trade.lastInsertRowid,
  };
}

before(async () => {
  await db.initSchema();
});

after(async () => {
  await db.closeDatabase();
  await fs.promises.rm(testDirectory, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
});

test("schema fingerprint is automatic and required integrity indexes exist", async () => {
  const version = await db.queryOne("SELECT value FROM schema_meta WHERE key = 'schema_version'");
  assert.match(version.value, /^[a-f0-9]{12}$/);
  assert.notEqual(version.value, "1");

  const indexes = await db.queryAll(
    `SELECT name FROM sqlite_master
     WHERE type = 'index'
       AND name IN (
         'idx_bonus_grants_transaction',
         'idx_strategy_trade_mirrors_trade_portfolio',
         'idx_strategy_mirror_jobs_status_claimed'
       )`
  );
  assert.equal(indexes.length, 3);

  const infrastructureTables = await db.queryAll(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name IN ('http_sessions', 'scheduler_leases', 'stock_refresh_jobs')`
  );
  assert.equal(infrastructureTables.length, 3);
});

test("fiat helpers parse and settle exact cents without floating-point drift", () => {
  assert.equal(parseMoneyToCents("0.10") + parseMoneyToCents("0.20"), 30);
  assert.equal(roundMoneyToCents(10.005), 1001);
  assert.equal(centsFromRate(10000, 0.001), 10);
  assert.equal(dollarsFromCents(12345), 123.45);
  assert.throws(() => parseMoneyToCents("1.001"), /two decimal places/);
});

test("legacy fiat writes are deterministically rounded into the cents ledger", async () => {
  const userId = await createUser({ cashBalance: 10.239 });
  const user = await db.queryOne("SELECT cash_balance, cash_balance_cents FROM users WHERE id = ?", [userId]);
  assert.equal(user.cash_balance_cents, 1024);
  assert.equal(user.cash_balance, 10.24);
});

test("shared rate limits remain exact under concurrent replica-style calls", async () => {
  const identifier = `ip:concurrent-${Date.now()}`;
  const results = await Promise.all(Array.from({ length: 12 }, () =>
    checkAndRecord("test_shared_ip", identifier, { max: 10, windowMinutes: 15 })
  ));
  assert.equal(results.filter(result => result.allowed).length, 10);
  assert.equal(Math.max(...results.map(result => result.count)), 12);
});

test("a legacy schema marker reruns idempotent migrations automatically", async () => {
  await db.execute("DROP INDEX idx_bonus_grants_transaction");
  await db.execute("DROP TABLE strategy_mirror_jobs");
  await db.execute("DROP TABLE http_sessions");
  await db.execute("DROP TABLE scheduler_leases");
  await db.execute("DROP TABLE stock_refresh_jobs");
  await db.execute("UPDATE schema_meta SET value = '1' WHERE key = 'schema_version'");

  await db.initSchema();

  const version = await db.queryOne("SELECT value FROM schema_meta WHERE key = 'schema_version'");
  const jobsTable = await db.queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'strategy_mirror_jobs'"
  );
  const bonusIndex = await db.queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_bonus_grants_transaction'"
  );
  const infrastructureTables = await db.queryAll(
    `SELECT name FROM sqlite_master
     WHERE type = 'table'
       AND name IN ('http_sessions', 'scheduler_leases', 'stock_refresh_jobs')`
  );
  assert.match(version.value, /^[a-f0-9]{12}$/);
  assert.ok(jobsTable);
  assert.ok(bonusIndex);
  assert.equal(infrastructureTables.length, 3);
});

test("failed financial transactions roll back every write", async () => {
  const userId = await createUser({ cashBalance: 50 });
  await assert.rejects(
    db.withTransaction(async tx => {
      await tx.execute("UPDATE users SET cash_balance = cash_balance - 25 WHERE id = ?", [userId]);
      await tx.execute(
        "INSERT INTO activity_log (user_id, type, label, amount) VALUES (?, 'test', 'must roll back', 25)",
        [userId]
      );
      throw new Error("forced rollback");
    }),
    /forced rollback/
  );
  const user = await db.queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
  const activity = await db.queryOne("SELECT id FROM activity_log WHERE user_id = ? AND type = 'test'", [userId]);
  assert.equal(user.cash_balance, 50);
  assert.equal(activity, null);
});

test("concurrent deposit bonus calls credit exactly once", async () => {
  const userId = await createUser({ cashBalance: 100 });
  const transactionId = await createDeposit(userId, 100);
  const promotion = await db.execute(
    `INSERT INTO promotions
       (name, bonus_pct, min_tier, min_deposit, lock_days, start_at, end_at)
     VALUES (?, 0.10, 'bronze', 100, 7, '2020-01-01 00:00:00', '2099-01-01 00:00:00')`,
    [`Concurrency Bonus ${sequence}`]
  );

  const results = await Promise.all([
    applyDepositBonus(userId, 100, transactionId),
    applyDepositBonus(userId, 100, transactionId),
  ]);
  assert.equal(results.filter(Boolean).length, 1);

  const user = await db.queryOne("SELECT cash_balance FROM users WHERE id = ?", [userId]);
  const grants = await db.queryOne(
    "SELECT COUNT(*) AS count FROM bonus_grants WHERE transaction_id = ? AND promotion_id = ?",
    [transactionId, promotion.lastInsertRowid]
  );
  assert.equal(user.cash_balance, 110);
  assert.equal(grants.count, 1);
  const alternatePromotion = await db.execute(
    `INSERT INTO promotions
       (name, bonus_pct, min_tier, min_deposit, lock_days, start_at, end_at)
     VALUES (?, 0.20, 'bronze', 100, 7, '2020-01-01 00:00:00', '2099-01-01 00:00:00')`,
    [`Alternate Bonus ${sequence}`]
  );
  await assert.rejects(
    db.execute(
      `INSERT INTO bonus_grants (user_id, promotion_id, transaction_id, amount, unlock_at)
       VALUES (?, ?, ?, 10, datetime('now', '+7 days'))`,
      [userId, alternatePromotion.lastInsertRowid, transactionId]
    ),
    /UNIQUE/i
  );
});

test("concurrent referral checks pay both parties exactly once", async () => {
  const referrerId = await createUser({ referralCode: `REF${sequence}` });
  const refereeId = await createUser({ cashBalance: 100 });
  await db.execute(
    "INSERT INTO referrals (referrer_id, referee_id, status, threshold_amount) VALUES (?, ?, 'pending', 100)",
    [referrerId, refereeId]
  );
  await createDeposit(refereeId, 100);

  const results = await Promise.all([
    checkReferralBonus(refereeId),
    checkReferralBonus(refereeId),
  ]);
  assert.equal(results.filter(Boolean).length, 1);

  const referrer = await db.queryOne("SELECT cash_balance FROM users WHERE id = ?", [referrerId]);
  const referee = await db.queryOne("SELECT cash_balance FROM users WHERE id = ?", [refereeId]);
  const grants = await db.queryOne(
    "SELECT COUNT(*) AS count FROM referral_bonus_grants WHERE user_id IN (?, ?)",
    [referrerId, refereeId]
  );
  assert.equal(referrer.cash_balance, 10);
  assert.equal(referee.cash_balance, 105);
  assert.equal(grants.count, 2);
});

test("concurrent mirror workers apply one subscriber trade exactly once", async () => {
  const fixture = await createMirrorFixture();
  await Promise.all([
    processStrategyMirrorJobsForTrade(fixture.tradeId),
    processStrategyMirrorJobsForTrade(fixture.tradeId),
  ]);

  const portfolio = await db.queryOne("SELECT cash_balance FROM portfolios WHERE id = ?", [fixture.portfolioId]);
  const holding = await db.queryOne(
    "SELECT amount FROM portfolio_holdings WHERE portfolio_id = ? AND symbol = 'AAPL'",
    [fixture.portfolioId]
  );
  const mirrors = await db.queryOne(
    "SELECT COUNT(*) AS count FROM strategy_trade_mirrors WHERE strategy_trade_id = ? AND portfolio_id = ?",
    [fixture.tradeId, fixture.portfolioId]
  );
  const activity = await db.queryOne(
    "SELECT COUNT(*) AS count FROM activity_log WHERE user_id = ? AND type = 'strategy_mirror'",
    [fixture.subscriberId]
  );
  const job = await db.queryOne(
    "SELECT status, attempt_count FROM strategy_mirror_jobs WHERE strategy_trade_id = ?",
    [fixture.tradeId]
  );
  assert.equal(portfolio.cash_balance, 900);
  assert.equal(holding.amount, 1);
  assert.equal(mirrors.count, 1);
  assert.equal(activity.count, 1);
  assert.equal(job.status, "completed");
  assert.equal(job.attempt_count, 1);
});

test("a stale processing job is reclaimed after a simulated restart", async () => {
  const fixture = await createMirrorFixture();
  await db.execute(
    `UPDATE strategy_mirror_jobs
     SET status = 'processing', attempt_count = 1, claimed_at = datetime('now', '-10 minutes')
     WHERE strategy_trade_id = ?`,
    [fixture.tradeId]
  );

  await processPendingStrategyMirrorJobs();

  const portfolio = await db.queryOne("SELECT cash_balance FROM portfolios WHERE id = ?", [fixture.portfolioId]);
  const mirrors = await db.queryOne(
    "SELECT COUNT(*) AS count FROM strategy_trade_mirrors WHERE strategy_trade_id = ?",
    [fixture.tradeId]
  );
  const job = await db.queryOne(
    "SELECT status, attempt_count FROM strategy_mirror_jobs WHERE strategy_trade_id = ?",
    [fixture.tradeId]
  );
  assert.equal(portfolio.cash_balance, 900);
  assert.equal(mirrors.count, 1);
  assert.equal(job.status, "completed");
  assert.equal(job.attempt_count, 2);
});

test("an admin can retry a skipped mirror after fixing its funding issue", async () => {
  const fixture = await createMirrorFixture({ cashBalance: 0 });
  await processStrategyMirrorJobsForTrade(fixture.tradeId);
  const skipped = await db.queryOne(
    "SELECT id, status FROM strategy_mirror_jobs WHERE strategy_trade_id = ?",
    [fixture.tradeId]
  );
  assert.equal(skipped.status, "skipped");

  await db.execute(
    "UPDATE portfolios SET cash_balance = 1000 WHERE id = ?",
    [fixture.portfolioId]
  );
  assert.equal(await retryStrategyMirrorJob(skipped.id), true);
  await processPendingStrategyMirrorJobs();

  const portfolio = await db.queryOne("SELECT cash_balance FROM portfolios WHERE id = ?", [fixture.portfolioId]);
  const job = await db.queryOne("SELECT status FROM strategy_mirror_jobs WHERE id = ?", [skipped.id]);
  const mirrors = await db.queryOne(
    "SELECT COUNT(*) AS count FROM strategy_trade_mirrors WHERE strategy_trade_id = ?",
    [fixture.tradeId]
  );
  assert.equal(portfolio.cash_balance, 900);
  assert.equal(job.status, "completed");
  assert.equal(mirrors.count, 1);
});

test("migration refuses to guess when historical duplicate bonuses exist", async () => {
  const userId = await createUser();
  const transactionId = await createDeposit(userId, 100);
  const promotion = await db.execute(
    `INSERT INTO promotions
       (name, bonus_pct, min_tier, min_deposit, lock_days, start_at, end_at)
     VALUES (?, 0.10, 'bronze', 100, 7, '2020-01-01 00:00:00', '2099-01-01 00:00:00')`,
    [`Migration Guard ${sequence}`]
  );
  await db.execute("DROP INDEX idx_bonus_grants_transaction");
  await db.execute(
    `INSERT INTO bonus_grants (user_id, promotion_id, transaction_id, amount, unlock_at)
     VALUES (?, ?, ?, 10, datetime('now', '+7 days'))`,
    [userId, promotion.lastInsertRowid, transactionId]
  );
  const duplicate = await db.execute(
    `INSERT INTO bonus_grants (user_id, promotion_id, transaction_id, amount, unlock_at)
     VALUES (?, ?, ?, 10, datetime('now', '+7 days'))`,
    [userId, promotion.lastInsertRowid, transactionId]
  );
  await db.execute("UPDATE schema_meta SET value = 'legacy' WHERE key = 'schema_version'");

  await assert.rejects(db.initSchema(), /require financial reconciliation/);

  await db.execute("DELETE FROM bonus_grants WHERE id = ?", [duplicate.lastInsertRowid]);
  await db.initSchema();
  const restored = await db.queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_bonus_grants_transaction'"
  );
  assert.ok(restored);
});

test("migration refuses to guess when historical duplicate mirrors exist", async () => {
  const fixture = await createMirrorFixture();
  await processStrategyMirrorJobsForTrade(fixture.tradeId);
  const mirror = await db.queryOne(
    `SELECT user_id, portfolio_id, mirrored_amount, mirrored_price
     FROM strategy_trade_mirrors
     WHERE strategy_trade_id = ?`,
    [fixture.tradeId]
  );
  await db.execute("DROP INDEX idx_strategy_trade_mirrors_trade_portfolio");
  const duplicate = await db.execute(
    `INSERT INTO strategy_trade_mirrors
       (strategy_trade_id, user_id, portfolio_id, mirrored_amount, mirrored_price)
     VALUES (?, ?, ?, ?, ?)`,
    [fixture.tradeId, mirror.user_id, mirror.portfolio_id, mirror.mirrored_amount, mirror.mirrored_price]
  );
  await db.execute("UPDATE schema_meta SET value = 'legacy' WHERE key = 'schema_version'");

  await assert.rejects(db.initSchema(), /require financial reconciliation/);

  await db.execute("DELETE FROM strategy_trade_mirrors WHERE id = ?", [duplicate.lastInsertRowid]);
  await db.initSchema();
  const restored = await db.queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_strategy_trade_mirrors_trade_portfolio'"
  );
  assert.ok(restored);
});

test("Finnhub quote requests are paced and a 429 is retried", async () => {
  const originalFetch = global.fetch;
  const originalWarn = console.warn;
  const originalApiKey = process.env.FINNHUB_API_KEY;
  const originalInterval = process.env.FINNHUB_REQUEST_INTERVAL_MS;
  const originalCooldown = process.env.FINNHUB_RATE_LIMIT_COOLDOWN_MS;
  const requestTimes = [];
  const warnings = [];
  let requestCount = 0;

  process.env.FINNHUB_API_KEY = "financial-test-key";
  process.env.FINNHUB_REQUEST_INTERVAL_MS = "10";
  process.env.FINNHUB_RATE_LIMIT_COOLDOWN_MS = "25";
  console.warn = (...parts) => warnings.push(parts.join(" "));
  global.fetch = async () => {
    requestTimes.push(Date.now());
    requestCount += 1;
    if (requestCount === 1) {
      return {
        ok: false,
        status: 429,
        headers: { get: () => null },
      };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ c: 123.45, dp: 0.5 }),
    };
  };

  try {
    const { fetchStockQuote } = require("../services/stocks");
    const [apple, microsoft] = await Promise.all([
      fetchStockQuote("AAPL"),
      fetchStockQuote("MSFT"),
    ]);

    assert.equal(requestCount, 3);
    assert.deepEqual(apple, {
      symbol: "AAPL",
      price: 123.45,
      change24h: 0.5,
    });
    assert.deepEqual(microsoft, {
      symbol: "MSFT",
      price: 123.45,
      change24h: 0.5,
    });
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /rate-limited AAPL/);
    assert.ok(requestTimes[1] - requestTimes[0] >= 20);
    assert.ok(requestTimes[2] - requestTimes[1] >= 7);
  } finally {
    global.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalApiKey === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = originalApiKey;
    if (originalInterval === undefined) delete process.env.FINNHUB_REQUEST_INTERVAL_MS;
    else process.env.FINNHUB_REQUEST_INTERVAL_MS = originalInterval;
    if (originalCooldown === undefined) delete process.env.FINNHUB_RATE_LIMIT_COOLDOWN_MS;
    else process.env.FINNHUB_RATE_LIMIT_COOLDOWN_MS = originalCooldown;
  }
});

test("HTTP sessions survive store instances and can be destroyed", async () => {
  const { LibsqlSessionStore } = require("../services/libsqlSessionStore");
  const firstStore = new LibsqlSessionStore();
  const secondStore = new LibsqlSessionStore();
  const sid = `session-${Date.now()}`;
  const sessionData = {
    cookie: {
      expires: new Date(Date.now() + 60_000),
      maxAge: 60_000,
    },
    passport: { user: 42 },
  };
  const callStore = (store, method, ...args) => new Promise((resolve, reject) => {
    store[method](...args, (error, value) => error ? reject(error) : resolve(value));
  });

  await callStore(firstStore, "set", sid, sessionData);
  const restored = await callStore(secondStore, "get", sid);
  assert.deepEqual(restored.passport, { user: 42 });

  restored.passport.user = 84;
  await callStore(secondStore, "set", sid, restored);
  await callStore(secondStore, "touch", sid, restored);
  const touched = await callStore(firstStore, "get", sid);
  assert.equal(touched.passport.user, 84);

  await callStore(firstStore, "destroy", sid);
  assert.equal(await callStore(secondStore, "get", sid), null);
});

test("distributed scheduler leases allow only one replica per interval", async () => {
  const { tryAcquireSchedulerLease } = require("../services/schedulerLease");
  const jobName = `lease-test-${Date.now()}`;

  assert.equal(await tryAcquireSchedulerLease(jobName, 60_000, "replica-a"), true);
  assert.equal(await tryAcquireSchedulerLease(jobName, 60_000, "replica-b"), false);

  await db.execute(
    "UPDATE scheduler_leases SET lease_until = datetime('now', '-1 second') WHERE job_name = ?",
    [jobName]
  );
  assert.equal(await tryAcquireSchedulerLease(jobName, 60_000, "replica-b"), true);
  await db.execute("DELETE FROM scheduler_leases WHERE job_name = ?", [jobName]);
});

test("concurrent stock refresh requests share one durable asynchronous job", async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalApiKey = process.env.FINNHUB_API_KEY;
  const originalInterval = process.env.FINNHUB_REQUEST_INTERVAL_MS;
  let requestCount = 0;

  process.env.FINNHUB_API_KEY = "stock-job-test-key";
  process.env.FINNHUB_REQUEST_INTERVAL_MS = "1";
  console.log = () => {};
  global.fetch = async () => {
    requestCount += 1;
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ c: 100 + requestCount, dp: 0.25 }),
    };
  };

  const {
    enqueueStockRefresh,
    getStockRefreshJob,
    processPendingStockRefreshJobs,
  } = require("../services/stockRefreshJobs");

  try {
    const requests = await Promise.all([
      enqueueStockRefresh({ source: "admin" }),
      enqueueStockRefresh({ source: "admin" }),
    ]);
    assert.equal(requests.filter(result => result.created).length, 1);
    assert.equal(requests[0].job.id, requests[1].job.id);

    await processPendingStockRefreshJobs();
    const completed = await getStockRefreshJob(requests[0].job.id);
    assert.equal(completed.status, "completed");
    assert.equal(completed.total, 46);
    assert.equal(completed.processed, 46);
    assert.equal(completed.updated, 46);
    assert.equal(completed.skipped, 0);
    assert.equal(requestCount, 46);

    const next = await enqueueStockRefresh({ source: "admin" });
    assert.equal(next.created, true);
    assert.notEqual(next.job.id, completed.id);
  } finally {
    await db.execute("DELETE FROM stock_refresh_jobs");
    global.fetch = originalFetch;
    console.log = originalLog;
    if (originalApiKey === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = originalApiKey;
    if (originalInterval === undefined) delete process.env.FINNHUB_REQUEST_INTERVAL_MS;
    else process.env.FINNHUB_REQUEST_INTERVAL_MS = originalInterval;
  }
});
