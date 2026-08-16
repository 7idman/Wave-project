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
});

test("a legacy schema marker reruns idempotent migrations automatically", async () => {
  await db.execute("DROP INDEX idx_bonus_grants_transaction");
  await db.execute("DROP TABLE strategy_mirror_jobs");
  await db.execute("UPDATE schema_meta SET value = '1' WHERE key = 'schema_version'");

  await db.initSchema();

  const version = await db.queryOne("SELECT value FROM schema_meta WHERE key = 'schema_version'");
  const jobsTable = await db.queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'strategy_mirror_jobs'"
  );
  const bonusIndex = await db.queryOne(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_bonus_grants_transaction'"
  );
  assert.match(version.value, /^[a-f0-9]{12}$/);
  assert.ok(jobsTable);
  assert.ok(bonusIndex);
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
