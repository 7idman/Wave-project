const { Resend } = require("resend");

let resendClient = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

function fromAddress() {
  return process.env.RESEND_FROM_EMAIL || "Wave <onboarding@resend.dev>";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendEmail({ to, subject, html, text, tags }) {
  const resend = getResendClient();
  if (!resend) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[email:dev] ${subject} -> ${to}`);
      if (text) console.warn(text);
      return { skipped: true, reason: "resend_not_configured" };
    }
    return { error: new Error("Resend is not configured") };
  }

  const result = await resend.emails.send({
    from: fromAddress(),
    to: [to],
    subject,
    html,
    text,
    tags,
  });
  if (result.error) return { error: result.error };
  return { data: result.data };
}

async function sendVerificationEmail({ to, name, verifyUrl }) {
  const safeName = name || "there";
  const htmlName = escapeHtml(safeName);
  const htmlUrl = escapeHtml(verifyUrl);
  const subject = "Verify your Wave email";
  const text = `Hi ${safeName}, verify your Wave account by opening this link: ${verifyUrl}\n\nThis link expires in 60 minutes.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:24px">Verify your Wave email</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${htmlName}, confirm this email address to finish setting up your Wave account.</p>
      <p style="margin:26px 0">
        <a href="${htmlUrl}" style="display:inline-block;background:#14C88A;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Verify email</a>
      </p>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">This link expires in 60 minutes. If you did not create a Wave account, you can ignore this email.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "email_verification" }] });
}

async function sendNewDeviceLoginAlert({ to, name, device, ip, time }) {
  const safeName = name || "there";
  const htmlName = escapeHtml(safeName);
  const htmlDevice = escapeHtml(device || "Unknown device");
  const htmlIp = escapeHtml(ip);
  const htmlWhen = escapeHtml(time || new Date().toISOString());
  const subject = "New sign-in to your Wave account";
  const when = time || new Date().toISOString();
  const text = `Hi ${safeName}, your Wave account was accessed from ${device || "a new device"} at ${when}${ip ? ` from IP ${ip}` : ""}. If this was not you, change your password and revoke unknown sessions.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:22px">New Wave sign-in</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${htmlName}, we noticed a sign-in to your account.</p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:18px 0;color:#374151">
        <div><strong>Device:</strong> ${htmlDevice}</div>
        <div><strong>Time:</strong> ${htmlWhen}</div>
        ${ip ? `<div><strong>IP:</strong> ${htmlIp}</div>` : ""}
      </div>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">If this was you, no action is needed. If not, change your password and revoke unknown sessions from Settings.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "new_device_login" }] });
}

async function sendPasswordResetEmail({ to, name, resetUrl }) {
  const safeName = name || "there";
  const htmlName = escapeHtml(safeName);
  const htmlUrl = escapeHtml(resetUrl);
  const subject = "Reset your Wave password";
  const text = `Hi ${safeName}, reset your Wave password by opening this link: ${resetUrl}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email — your password will not change.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:24px">Reset your Wave password</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${htmlName}, we received a request to reset your Wave password.</p>
      <p style="margin:26px 0">
        <a href="${htmlUrl}" style="display:inline-block;background:#14C88A;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Reset password</a>
      </p>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">This link expires in 30 minutes. If you did not request this, you can safely ignore this email — your password will not be changed.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "password_reset" }] });
}

async function sendWithdrawalEmailCode({ to, name, code, amount }) {
  const safeName = name || "there";
  const htmlName = escapeHtml(safeName);
  const htmlAmount = escapeHtml(amount);
  const subject = `${code} is your Wave withdrawal code`;
  const text = `Hi ${safeName}, your verification code for a $${amount} withdrawal is: ${code}\n\nThis code expires in 10 minutes. If you did not request this withdrawal, secure your account immediately and contact support.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:24px">Confirm your withdrawal</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${htmlName}, enter this code to confirm your $${htmlAmount} withdrawal request:</p>
      <div style="margin:24px 0;text-align:center">
        <span style="display:inline-block;font-size:32px;font-weight:800;letter-spacing:8px;background:#F3F4F6;padding:16px 24px;border-radius:12px;color:#111827">${code}</span>
      </div>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">This code expires in 10 minutes. If you did not request this withdrawal, please secure your account and contact support immediately.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "withdrawal_otp" }] });
}

async function sendLoginEmailCode({ to, name, code }) {
  const safeName = name || "there";
  const htmlName = escapeHtml(safeName);
  const subject = `${code} is your Wave sign-in code`;
  const text = `Hi ${safeName}, your Wave sign-in verification code is: ${code}\n\nThis code expires in 10 minutes. If you did not try to sign in, someone may have your password — change it immediately.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:24px">Confirm it's you</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${htmlName}, enter this code to finish signing in to Wave:</p>
      <div style="margin:24px 0;text-align:center">
        <span style="display:inline-block;font-size:32px;font-weight:800;letter-spacing:8px;background:#F3F4F6;padding:16px 24px;border-radius:12px;color:#111827">${code}</span>
      </div>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">This code expires in 10 minutes. If you did not try to sign in, someone may have your password — change it immediately and contact support.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "login_otp" }] });
}

module.exports = {
  sendEmail,
  sendVerificationEmail,
  sendNewDeviceLoginAlert,
  sendPasswordResetEmail,
  sendWithdrawalEmailCode,
  sendLoginEmailCode,
};
