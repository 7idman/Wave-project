const { Resend } = require("resend");

let resendClient = null;

function getResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!resendClient) resendClient = new Resend(apiKey);
  return resendClient;
}

function isEmailConfigured() {
  return Boolean(process.env.RESEND_API_KEY);
}

function fromAddress() {
  return process.env.RESEND_FROM_EMAIL || "Wave <onboarding@resend.dev>";
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
  const subject = "Verify your Wave email";
  const text = `Hi ${safeName}, verify your Wave account by opening this link: ${verifyUrl}\n\nThis link expires in 60 minutes.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:24px">Verify your Wave email</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${safeName}, confirm this email address to finish setting up your Wave account.</p>
      <p style="margin:26px 0">
        <a href="${verifyUrl}" style="display:inline-block;background:#14C88A;color:#fff;text-decoration:none;padding:13px 18px;border-radius:10px;font-weight:700">Verify email</a>
      </p>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">This link expires in 60 minutes. If you did not create a Wave account, you can ignore this email.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "email_verification" }] });
}

async function sendNewDeviceLoginAlert({ to, name, device, ip, time }) {
  const safeName = name || "there";
  const subject = "New sign-in to your Wave account";
  const when = time || new Date().toISOString();
  const text = `Hi ${safeName}, your Wave account was accessed from ${device || "a new device"} at ${when}${ip ? ` from IP ${ip}` : ""}. If this was not you, change your password and revoke unknown sessions.`;
  const html = `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;padding:28px;color:#111827">
      <h1 style="margin:0 0 12px;font-size:22px">New Wave sign-in</h1>
      <p style="line-height:1.6;color:#4b5563">Hi ${safeName}, we noticed a sign-in to your account.</p>
      <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;padding:14px;margin:18px 0;color:#374151">
        <div><strong>Device:</strong> ${device || "Unknown device"}</div>
        <div><strong>Time:</strong> ${when}</div>
        ${ip ? `<div><strong>IP:</strong> ${ip}</div>` : ""}
      </div>
      <p style="line-height:1.6;color:#6b7280;font-size:13px">If this was you, no action is needed. If not, change your password and revoke unknown sessions from Settings.</p>
    </div>
  `;
  return sendEmail({ to, subject, html, text, tags: [{ name: "type", value: "new_device_login" }] });
}

module.exports = {
  isEmailConfigured,
  sendEmail,
  sendVerificationEmail,
  sendNewDeviceLoginAlert,
};
