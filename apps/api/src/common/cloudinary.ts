import { v2 as cloudinary } from "cloudinary";

// Configured from CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud>). The
// SDK reads that env var automatically on first use; this just flips on
// https and fails loudly if the var is missing so a misconfigured deploy
// doesn't silently accept KYC uploads it can't store.
let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!process.env.CLOUDINARY_URL) {
    throw new Error("CLOUDINARY_URL is not set — document upload is unavailable");
  }
  cloudinary.config({ secure: true });
  configured = true;
}

export interface UploadedAsset {
  publicId: string;
  resourceType: string; // 'image' | 'raw' | 'video'
  bytes: number;
  format?: string;
}

/**
 * Uploads a buffer as a private ("authenticated") asset — never publicly
 * reachable by URL. Staff read it through {@link signedDownloadUrl}.
 */
export function uploadPrivateBuffer(
  buffer: Buffer,
  opts: { folder: string; publicId?: string; filename?: string },
): Promise<UploadedAsset> {
  ensureConfigured();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicId,
        type: "authenticated",
        resource_type: "auto",
        overwrite: true,
        use_filename: !opts.publicId,
        unique_filename: !opts.publicId,
        filename_override: opts.filename,
      },
      (err, result) => {
        if (err || !result) return reject(err ?? new Error("Cloudinary upload failed"));
        resolve({
          publicId: result.public_id,
          resourceType: result.resource_type,
          bytes: result.bytes,
          format: result.format,
        });
      },
    );
    stream.end(buffer);
  });
}

/** Short-lived signed URL for a private asset (default 10 minutes). */
export function signedDownloadUrl(
  publicId: string,
  resourceType = "image",
  ttlSeconds = 600,
): string {
  ensureConfigured();
  return cloudinary.url(publicId, {
    type: "authenticated",
    resource_type: resourceType,
    sign_url: true,
    secure: true,
    expires_at: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
}

export function destroyAsset(publicId: string, resourceType = "image"): Promise<unknown> {
  ensureConfigured();
  return cloudinary.uploader.destroy(publicId, { type: "authenticated", resource_type: resourceType });
}
