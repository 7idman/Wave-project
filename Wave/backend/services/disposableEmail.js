const HIGH_RISK_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "sharklasers.com",
  "throwawaymail.com",
  "getnada.com",
]);

let disposableModulePromise = null;

function normalizeDomain(email) {
  if (!email || typeof email !== "string") return "";
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "";
  return email.slice(at + 1).trim().toLowerCase().replace(/\.$/, "");
}

async function loadDisposableModule() {
  if (!disposableModulePromise) {
    disposableModulePromise = import("@visulima/disposable-email-domains");
  }
  return disposableModulePromise;
}

async function isDisposableEmail(email) {
  const domain = normalizeDomain(email);
  if (!domain) return false;
  if (HIGH_RISK_DOMAINS.has(domain)) return true;

  try {
    const mod = await loadDisposableModule();
    if (typeof mod.isDisposableEmail === "function") return mod.isDisposableEmail(email);
    if (typeof mod.isDisposableDomain === "function") return mod.isDisposableDomain(domain);
  } catch (err) {
    console.error("Disposable email list unavailable:", err.message);
  }

  return HIGH_RISK_DOMAINS.has(domain);
}

module.exports = { isDisposableEmail };
