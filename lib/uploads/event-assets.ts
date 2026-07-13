/**
 * Upload event banners / ticket templates to Supabase Storage.
 * Shared by server actions and /api/admin/upload (PDF-friendly).
 */
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { getSupabaseAdmin } from "@/lib/supabase/server";

export const EVENT_ASSETS_BUCKET = "event-assets";

export type UploadResult = { success: boolean; path?: string; error?: string };

export async function uploadEventAsset(opts: {
  bytes: ArrayBuffer | Uint8Array;
  filename: string;
  contentType: string;
  slug: string;
}): Promise<UploadResult> {
  const maxSize = 10 * 1024 * 1024;
  const data =
    opts.bytes instanceof Uint8Array
      ? opts.bytes
      : new Uint8Array(opts.bytes);

  if (data.byteLength > maxSize) {
    return { success: false, error: "File too large (max 10MB)" };
  }

  const safeSlug =
    (opts.slug || "event").replace(/[^a-z0-9-]/gi, "-").toLowerCase() ||
    "event";
  let ext = (opts.filename.split(".").pop() || "bin")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!ext || ext.length > 5) {
    ext = opts.contentType.includes("pdf")
      ? "pdf"
      : opts.contentType.includes("png")
        ? "png"
        : "jpg";
  }
  const storedName = `${safeSlug}-${Date.now()}.${ext}`;
  const contentType =
    opts.contentType ||
    (ext === "pdf"
      ? "application/pdf"
      : ext === "png"
        ? "image/png"
        : ext === "webp"
          ? "image/webp"
          : "image/jpeg");

  const supabaseAdmin = getSupabaseAdmin();
  if (supabaseAdmin) {
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      const exists = (buckets || []).some((b) => b.name === EVENT_ASSETS_BUCKET);
      if (!exists) {
        const { error: createErr } = await supabaseAdmin.storage.createBucket(
          EVENT_ASSETS_BUCKET,
          {
            public: true,
            fileSizeLimit: maxSize,
            // Allow images + PDF (do not restrict to images only)
            allowedMimeTypes: [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "application/pdf",
            ],
          }
        );
        if (createErr) {
          console.warn("[event-assets] createBucket:", createErr.message);
        }
      } else {
        // Ensure PDF is allowed if bucket was created image-only
        try {
          await supabaseAdmin.storage.updateBucket(EVENT_ASSETS_BUCKET, {
            public: true,
            fileSizeLimit: maxSize,
            allowedMimeTypes: [
              "image/jpeg",
              "image/png",
              "image/webp",
              "image/gif",
              "application/pdf",
            ],
          });
        } catch {
          // ignore — older projects may not allow update
        }
      }
    } catch (e) {
      console.warn("[event-assets] bucket ensure:", e);
    }

    const objectPath = `events/${safeSlug}/${storedName}`;
    const { error: upErr } = await supabaseAdmin.storage
      .from(EVENT_ASSETS_BUCKET)
      .upload(objectPath, data, {
        contentType,
        upsert: true,
      });

    if (upErr) {
      console.error("[event-assets] upload:", upErr);
      return {
        success: false,
        error:
          `Storage upload failed: ${upErr.message}. ` +
          `If this is a PDF, open Supabase → Storage → event-assets → Configuration ` +
          `and allow MIME type application/pdf (or clear restricted MIME list).`,
      };
    }

    const { data: pub } = supabaseAdmin.storage
      .from(EVENT_ASSETS_BUCKET)
      .getPublicUrl(objectPath);

    if (!pub?.publicUrl) {
      return {
        success: false,
        error: "Upload succeeded but could not get public URL",
      };
    }
    return { success: true, path: pub.publicUrl };
  }

  if (process.env.VERCEL) {
    return {
      success: false,
      error:
        "SUPABASE_SERVICE_ROLE_KEY is required for uploads on Vercel.",
    };
  }

  // Local filesystem fallback
  const uploadDir = path.join(process.cwd(), "public", "images", "events");
  await mkdir(uploadDir, { recursive: true });
  const filePath = path.join(uploadDir, storedName);
  await writeFile(filePath, data);
  return { success: true, path: `/images/events/${storedName}` };
}
