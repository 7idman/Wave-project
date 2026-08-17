const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wave-http-tests-"));
const testDatabasePath = path.join(testDirectory, "http.db").replaceAll("\\", "/");
process.env.LIBSQL_URL = `file:${testDatabasePath}`;
process.env.OWNER_EMAIL = "";
process.env.JWT_SECRET = "http-test-jwt-secret-not-for-production";
process.env.SESSION_SECRET = "http-test-session-secret-not-for-production";

const db = require("../db");
const { app } = require("../server");
const { signAccessToken } = require("../middleware/auth");

let server;
let baseUrl;
let token;
let userId;

before(async () => {
  await db.initSchema();
  const inserted = await db.execute(
    "INSERT INTO users (email,password_hash,name,cash_balance,cash_balance_cents) VALUES (?,?,?,?,?)",
    ["http-user@example.com", "not-used", "HTTP User", 1000, 100000]
  );
  userId = inserted.lastInsertRowid;
  token = signAccessToken(userId);
  await db.execute(
    "INSERT INTO price_cache (symbol,price,change_24h,asset_type) VALUES ('AAPL',100,0,'stock') ON CONFLICT(symbol) DO UPDATE SET price=100"
  );
  await new Promise(resolve => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await db.closeDatabase();
  await fs.promises.rm(testDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

async function api(pathname, options = {}) {
  return fetch(`${baseUrl}${pathname}`, options);
}

test("health and authentication boundaries work over HTTP", async () => {
  const health = await api("/health");
  assert.equal(health.status, 200);
  assert.equal((await health.json()).status, "ok");

  const anonymous = await api("/api/portfolio");
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error, "Missing token");

  const forbidden = await api("/api/admin/summary", { headers: { authorization: `Bearer ${token}` } });
  assert.equal(forbidden.status, 403);
});

test("a fractional buy preserves asset precision and settles cash in exact cents", async () => {
  const response = await api("/api/trades", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "buy", symbol: "AAPL", amount: "0.12345678" }),
  });
  assert.equal(response.status, 201, await response.text());
  const user = await db.queryOne("SELECT cash_balance,cash_balance_cents FROM users WHERE id=?", [userId]);
  assert.equal(user.cash_balance_cents, 98764);
  assert.equal(user.cash_balance, 987.64);
  const transaction = await db.queryOne("SELECT amount,amount_cents,fee_cents,total_cents FROM transactions WHERE user_id=?", [userId]);
  assert.deepEqual(transaction, {
    amount: 0.12345678,
    amount_cents: null,
    fee_cents: 1,
    total_cents: 1236,
  });
});

test("HTTP money inputs reject sub-cent fiat values", async () => {
  const response = await api("/api/trades", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ type: "investment", amount: "1.001" }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /two decimal places/);
});
