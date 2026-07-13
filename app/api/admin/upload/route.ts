import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/security/admin-session";
import { getSupabaseAdmin } from "@/lib/supabase/server";
import {
  EVENT_ASSETS_BUCKET,
  ensureEventAssetsBucket,
  uploadEventAsset,
} from "@/lib/uploads/event-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Two modes:
 * 1) POST JSON { mode: "sign", filename, contentType, slug, size }
 *    → returns signedUrl + token + publicUrl (browser uploads to Supabase; avoids Vercel 413)
 * 2) POST multipart FormData (small files) → server uploads (legacy / local)
 */
export async function POST(request: NextRequest) {
  try {
    const ok = await isAdminSessionValid();
    if (!ok) {
      return NextResponse.json(
        {
          success: false,
          error:
            "Admin session expired. Sign out and sign in again, then retry.",
        },
        { status: 401 }
      );
    }

    const contentTypeHeader = request.headers.get("content-type") || "";

    // --- Signed URL for direct-to-Supabase upload (PDFs / larger files) ---
    if (contentTypeHeader.includes("application/json")) {
      const body = await request.json();
      if (body?.mode !== "sign") {
        return NextResponse.json(
          { success: false, error: "Unknown JSON mode" },
          { status: 400 }
        );
      }

      const filename = String(body.filename || "upload.bin");
      const contentType = String(
        body.contentType || "application/octet-stream"
      );
      const slug = String(body.slug || "event");
      const size = Number(body.size || 0);

      if (size > 10 * 1024 * 1024) {
        return NextResponse.json(
          { success: false, error: "File too large (max 10MB)" },
          { status: 400 }
        );
      }

      const isImage = contentType.startsWith("image/");
      const isPdf =
        contentType === "application/pdf" ||
        filename.toLowerCase().endsWith(".pdf");
      if (!isImage && !isPdf) {
        return NextResponse.json(
          {
            success: false,
            error: "Only image files (JPG/PNG/WEBP) or PDF are allowed",
          },
          { status: 400 }
        );
      }

      const admin = getSupabaseAdmin();
      if (!admin) {
        return NextResponse.json(
          {
            success: false,
            error: "SUPABASE_SERVICE_ROLE_KEY is required for uploads.",
          },
          { status: 500 }
        );
      }

      await ensureEventAssetsBucket(admin);

      const safeSlug =
        slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "event";
      let ext = (filename.split(".").pop() || "bin")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      if (!ext || ext.length > 5) {
        ext = isPdf ? "pdf" : "jpg";
      }
      const objectPath = `events/${safeSlug}/${safeSlug}-${Date.now()}.${ext}`;

      const { data, error } = await admin.storage
        .from(EVENT_ASSETS_BUCKET)
        .createSignedUploadUrl(objectPath);

      if (error || !data) {
        console.error("[api/admin/upload] signed URL:", error);
        return NextResponse.json(
          {
            success: false,
            error:
              error?.message ||
              "Could not create signed upload URL. Check Storage bucket event-assets.",
          },
          { status: 400 }
        );
      }

      const { data: pub } = admin.storage
        .from(EVENT_ASSETS_BUCKET)
        .getPublicUrl(objectPath);

      return NextResponse.json({
        success: true,
        mode: "sign",
        path: objectPath,
        token: data.token,
        signedUrl: data.signedUrl,
        publicUrl: pub.publicUrl,
        contentType: isPdf
          ? "application/pdf"
          : contentType || "image/jpeg",
      });
    }

    // --- Multipart (small files only; Vercel ~4.5MB limit) ---
    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
      );
    }

    // Soft guard: prefer signed flow for larger payloads
    if (file.size > 3.5 * 1024 * 1024) {
      return NextResponse.json(
        {
          success: false,
          error:
            "File too large for direct server upload (Vercel limit). Use signed upload.",
          code: "USE_SIGNED",
        },
        { status: 413 }
      );
    }

    const name = file.name || "upload.bin";
    const isImage = (file.type || "").startsWith("image/");
    const isPdf =
      file.type === "application/pdf" || name.toLowerCase().endsWith(".pdf");

    if (!isImage && !isPdf) {
      return NextResponse.json(
        {
          success: false,
          error: "Only image files (JPG/PNG/WEBP) or PDF are allowed",
        },
        { status: 400 }
      );
    }

    const slug = String(form.get("slug") || "event");
    const bytes = await file.arrayBuffer();
    const result = await uploadEventAsset({
      bytes,
      filename: name,
      contentType:
        file.type ||
        (isPdf
          ? "application/pdf"
          : name.toLowerCase().endsWith(".png")
            ? "image/png"
            : "image/jpeg"),
      slug,
    });

    if (!result.success) {
      return NextResponse.json(result, { status: 400 });
    }
    return NextResponse.json(result);
  } catch (err) {
    console.error("[api/admin/upload]", err);
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "Upload failed",
      },
      { status: 500 }
    );
  }
}
