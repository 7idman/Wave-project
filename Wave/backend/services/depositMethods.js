// ── Deposit destination configuration ────────────────────────────────────────
// This is where money actually lands when a user deposits by PayPal, crypto,
// or bank transfer. Every value below comes from an env var — set these in
// Railway (or a local .env for testing). Nothing here is a secret in the
// "don't expose it" sense — a PayPal email, a public wallet address, and
// bank routing details are all things you'd hand a depositor anyway — this
// endpoint is what the frontend calls to show them to a signed-in user.
//
// A method only appears to users once its env vars are actually set. Leaving
// a method unconfigured hides it from the deposit screen entirely rather
// than showing a blank/placeholder address that someone could accidentally
// send real money into.

function getPaypalMethod() {
  const email = process.env.DEPOSIT_PAYPAL_EMAIL; // <-- ADD YOUR PAYPAL EMAIL HERE (Railway env var)
  if (!email) return null;
  return {
    email,
    instructions: process.env.DEPOSIT_PAYPAL_INSTRUCTIONS
      || "Send as Friends & Family to avoid fees. Include your Wave account email in the note.",
  };
}

function getCryptoMethod() {
  // Add a wallet address env var per coin you want to accept. Only coins
  // with an address actually set will show up for depositors — comment out
  // or leave any of these unset to hide that coin.
  const coins = [
    { symbol: "BTC",  name: "Bitcoin",       network: "Bitcoin",        address: process.env.DEPOSIT_WALLET_BTC },  // <-- ADD YOUR BTC WALLET ADDRESS HERE
    { symbol: "ETH",  name: "Ethereum",      network: "ERC-20",         address: process.env.DEPOSIT_WALLET_ETH },  // <-- ADD YOUR ETH WALLET ADDRESS HERE
    { symbol: "USDT", name: "Tether",        network: "ERC-20",         address: process.env.DEPOSIT_WALLET_USDT }, // <-- ADD YOUR USDT (ERC-20) WALLET ADDRESS HERE
    { symbol: "USDC", name: "USD Coin",      network: "ERC-20",         address: process.env.DEPOSIT_WALLET_USDC }, // <-- ADD YOUR USDC (ERC-20) WALLET ADDRESS HERE
    { symbol: "SOL",  name: "Solana",        network: "Solana",         address: process.env.DEPOSIT_WALLET_SOL },  // <-- ADD YOUR SOL WALLET ADDRESS HERE
  ].filter(c => c.address);
  if (coins.length === 0) return null;
  return { coins };
}

function getBankTransferMethod() {
  const accountNumber = process.env.DEPOSIT_BANK_ACCOUNT_NUMBER; // <-- ADD YOUR BANK ACCOUNT NUMBER HERE
  if (!accountNumber) return null;
  return {
    bankName:      process.env.DEPOSIT_BANK_NAME      || "",   // <-- ADD YOUR BANK NAME HERE
    accountName:   process.env.DEPOSIT_BANK_ACCOUNT_NAME || "", // <-- ADD THE ACCOUNT HOLDER NAME HERE
    accountNumber,
    routingNumber: process.env.DEPOSIT_BANK_ROUTING_NUMBER || "", // <-- US ACH/wire routing number, if applicable
    iban:          process.env.DEPOSIT_BANK_IBAN       || "",     // <-- IBAN, if applicable outside the US
    swift:         process.env.DEPOSIT_BANK_SWIFT       || "",    // <-- SWIFT/BIC code, for international wires
    instructions:  process.env.DEPOSIT_BANK_INSTRUCTIONS
      || "Include your Wave account email as the wire/transfer reference so we can match your deposit.",
  };
}

function getDepositMethods() {
  const methods = {};
  const paypal = getPaypalMethod();
  const crypto = getCryptoMethod();
  const bank   = getBankTransferMethod();
  if (paypal) methods.paypal = paypal;
  if (crypto) methods.crypto = crypto;
  if (bank)   methods.bank_transfer = bank;
  return methods;
}

const VALID_METHODS = ["paypal", "crypto", "bank_transfer"];

module.exports = { getDepositMethods, VALID_METHODS };
