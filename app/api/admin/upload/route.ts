import { NextRequest, NextResponse } from "next/server";
import { isAdminSessionValid } from "@/lib/security/admin-session";
import { uploadEventAsset } from "@/lib/uploads/event-assets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Larger PDFs are more reliable via this route than Server Actions. */
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

    const form = await request.formData();
    const file = form.get("file");
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { success: false, error: "No file provided" },
        { status: 400 }
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
    const contentType =
      file.type ||
      (isPdf
        ? "application/pdf"
        : name.toLowerCase().endsWith(".png")
          ? "image/png"
          : "image/jpeg");

    const result = await uploadEventAsset({
      bytes,
      filename: name,
      contentType,
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
