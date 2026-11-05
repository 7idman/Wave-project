const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
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

test("boot failure exits non-zero instead of hanging", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-boot-fail-"));
  const dbUrl = "file:" + path.join(tmpDir, "boot-fail.db").replace(/\\/g, "/"); // Windows-safe
  const blocker = net.createServer();
  await new Promise(resolve => blocker.listen(0, resolve));
  const port = blocker.address().port;

  try {
    const child = spawn(
      process.execPath,
      ["-r", path.join(__dirname, "helpers", "offline-fetch.js"), "server.js"],
      {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: String(port), LIBSQL_URL: dbUrl },
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("process hung")); }, 120000);
      child.once("exit", c => { clearTimeout(timer); resolve(c); });
    });

    assert.equal(code, 1);
    assert.match(stderr, /Failed to start server/); // failed for the right reason
  } finally {
    await new Promise(resolve => blocker.close(resolve));
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("unhandled rejection triggers crash guard and exits with code 1", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-crash-guard-"));
  const dbUrl = "file:" + path.join(tmpDir, "crash-guard.db").replace(/\\/g, "/");

  try {
    const child = spawn(
      process.execPath,
      [
        "-r",
        path.join(__dirname, "helpers", "offline-fetch.js"),
        "-e",
        `const { start, stop, installCrashGuards } = require("./server");
         start().then(() => {
           installCrashGuards(stop);
           Promise.reject(new Error("simulated crash"));
         });`,
      ],
      {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: "0", LIBSQL_URL: dbUrl },
        stdio: ["ignore", "ignore", "pipe"],
      }
    );

    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("process hung")); }, 120000);
      child.once("exit", c => { clearTimeout(timer); resolve(c); });
    });

    assert.equal(code, 1);
    assert.match(stderr, /\[fatal\] Unhandled rejection:/);
    assert.match(stderr, /simulated crash/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

test("shutdown aborts hung background fetches and tolerates late errors", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wave-shutdown-test-"));
  const dbUrl = "file:" + path.join(tmpDir, "shutdown.db").replace(/\\/g, "/");

  try {
    const child = spawn(
      process.execPath,
      [
        "-r",
        path.join(__dirname, "helpers", "hanging-fetch.js"),
        "-e",
        `const { start, stop, installCrashGuards } = require("./server");
         const t0 = Date.now();
         start().then(async () => {
           installCrashGuards(stop);
           const pending = Promise.all([stop(), stop()]);          // idempotency
           Promise.reject(new Error("late error during shutdown")); // error arrives mid-shutdown
           const [a, b] = await pending;
           console.log(JSON.stringify({ a: a.timedOut, b: b.timedOut, ms: Date.now() - t0 }));
           setTimeout(() => process.exit(0), 500);                 // leave time for any late rejection
         });`,
      ],
      {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, PORT: "0", LIBSQL_URL: dbUrl },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });

    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("process hung")); }, 120000);
      child.once("exit", c => { clearTimeout(timer); resolve(c); });
    });

    assert.equal(code, 0, `expected exit code 0, got ${code}; stderr: ${stderr}`);

    const jsonLine = stdout.split("\n").map(l => l.trim()).find(l => l.startsWith('{"a":'));
    assert.ok(jsonLine, `expected JSON output from child in stdout: ${stdout}`);
    const data = JSON.parse(jsonLine);
    assert.equal(data.a, false, "first stop() call must not time out");
    assert.equal(data.b, false, "second stop() call must not time out");
    assert.ok(data.ms < 8000, `shutdown took ${data.ms}ms, expected < 8000ms`);

    assert.match(stderr, /\[warn\] Unhandled rejection during shutdown:/, "stderr must log warning about late unhandled rejection during shutdown");
    assert.doesNotMatch(stderr, /\[fatal\]/, "stderr must not log fatal crash guard messages during shutdown");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
