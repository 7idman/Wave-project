/**
 * services/cloudinaryUpload.js
 * Uploads a profile photo to Cloudinary and returns a short, real hosted
 * URL — replaces the old flow, which saved the raw base64 image data
 * directly into the users.avatar_url TEXT column (multi-megabyte strings
 * riding along on every profile fetch and admin user-list query).
 *
 * Requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
 * as Railway env vars — never hardcoded.
 */

const cloudinary = require("cloudinary").v2;

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB, matches the existing client-side limit — now also enforced server-side
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];

let configured = false;
function ensureConfigured() {
  if (configured) return true;
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) return false;
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
  configured = true;
  return true;
}

// dataUrl looks like "data:image/png;base64,iVBORw0KG..." — validated and
// size-checked here rather than trusting whatever the client claims about
// its own file size (the 5MB check in onAvatarPick is a UX nicety, not a
// security boundary).
async function uploadAvatar(dataUrl, userId) {
  if (!ensureConfigured()) return { success: false, reason: "not_configured" };
  if (!dataUrl || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return { success: false, reason: "invalid_image" };
  }

  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match) return { success: false, reason: "invalid_image" };
  const [, mime, base64Data] = match;
  if (!ALLOWED_MIME.includes(mime)) return { success: false, reason: "unsupported_type" };

  // Base64 is ~4/3 the size of the original bytes — check before ever
  // handing it to Cloudinary, not after.
  const approxBytes = base64Data.length * 0.75;
  if (approxBytes > MAX_UPLOAD_BYTES) return { success: false, reason: "too_large" };

  try {
    const result = await cloudinary.uploader.upload(dataUrl, {
      folder: "wave/avatars",
      public_id: `user_${userId}`,   // one avatar per user — re-uploading overwrites rather than accumulating
      overwrite: true,
      resource_type: "image",
      transformation: [{ width: 512, height: 512, crop: "fill", gravity: "face" }],
    });
    return { success: true, url: result.secure_url };
  } catch (err) {
    console.error("Cloudinary upload failed:", err.message);
    return { success: false, reason: "upload_failed" };
  }
}

module.exports = { uploadAvatar };
