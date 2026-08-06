/**
 * utils/referenceId.js
 * Shared reference ID generator for anything money-related that a user
 * might need to quote back to support — transfers, deposits, withdrawals.
 */

const crypto = require("crypto");

function generateReferenceId(prefix = "TRF") {
  return `${prefix}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

module.exports = { generateReferenceId };
