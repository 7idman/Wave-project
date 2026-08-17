const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, test } = require("node:test");

const testDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wave-runtime-tests-"));
const testDatabasePath = path.join(testDirectory, "runtime.db").replaceAll("\\", "/");
process.env.LIBSQL_URL = `file:${testDatabasePath}`;
process.env.OWNER_EMAIL = "";
process.env.PORT = "0";
process.env.JWT_SECRET = "runtime-test-jwt-secret-not-for-production";
process.env.SESSION_SECRET = "runtime-test-session-secret-not-for-production";
delete process.env.FINNHUB_API_KEY;

global.fetch = async () => new Response("{}", {
  status: 200,
  headers: { "content-type": "application/json" },
});

const { start, stop } = require("../server");

after(async () => {
  await fs.promises.rm(testDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("runtime starts on an assigned port and drains cleanly", async () => {
  const server = await start();
  assert.equal(server.listening, true);
  assert.ok(Number(server.address().port) > 0);

  const result = await stop({ timeoutMs: 5000 });
  assert.deepEqual(result, { timedOut: false });
  assert.equal(server.listening, false);
});
