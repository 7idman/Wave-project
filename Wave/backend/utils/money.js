const MAX_SAFE_CENTS = Number.MAX_SAFE_INTEGER;

function assertSafeCents(cents) {
  if (!Number.isSafeInteger(cents) || Math.abs(cents) > MAX_SAFE_CENTS) {
    throw new RangeError("Money amount is outside the supported range");
  }
  return cents;
}

function parseMoneyToCents(value, { allowZero = false, allowNegative = false } = {}) {
  const raw = typeof value === "number" && Number.isFinite(value)
    ? String(value)
    : String(value ?? "").trim();
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new TypeError("Money amounts must use no more than two decimal places");

  const negative = match[1] === "-";
  if (negative && !allowNegative) throw new RangeError("Money amount cannot be negative");
  const whole = BigInt(match[2]);
  const fraction = BigInt((match[3] || "").padEnd(2, "0"));
  let centsBigInt = whole * 100n + fraction;
  if (negative) centsBigInt = -centsBigInt;
  const cents = Number(centsBigInt);
  assertSafeCents(cents);
  if (!allowZero && cents === 0) throw new RangeError("Money amount must be greater than zero");
  return cents;
}

function roundMoneyToCents(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) throw new TypeError("Money calculation produced an invalid amount");
  return assertSafeCents(Math.round((amount + Math.sign(amount) * Number.EPSILON) * 100));
}

function centsFromRate(baseCents, rate) {
  assertSafeCents(baseCents);
  const numericRate = Number(rate);
  if (!Number.isFinite(numericRate)) throw new TypeError("Money rate is invalid");
  return assertSafeCents(Math.round(baseCents * numericRate));
}

function dollarsFromCents(cents) {
  return assertSafeCents(Number(cents)) / 100;
}

module.exports = {
  parseMoneyToCents,
  roundMoneyToCents,
  centsFromRate,
  dollarsFromCents,
};
