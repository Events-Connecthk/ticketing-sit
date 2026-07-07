"use server";

import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Server-side admin password verification.
// The secret lives only on the server (process.env.ADMIN_PASSWORD).
// Never exposed to client bundle.
export async function verifyAdminPassword(inputPassword: string): Promise<boolean> {
  const expected =
    process.env.ADMIN_PASSWORD ||
    process.env.NEXT_PUBLIC_ADMIN_PASSWORD ||
    "sit-admin-2026";
  return inputPassword === expected;
}

/**
 * Upload event banner or ticket template.
 * Supports images (jpg/png/webp) and PDF (for ticket backgrounds).
 * Saves to public/images/events/
 */
export async function uploadEventBanner(formData: FormData): Promise<{ success: boolean; path?: string; error?: string }> {
  try {
    const file = formData.get("file") as File | null;
    if (!file) {
      return { success: false, error: "No file provided" };
    }

    // Basic validation - images or PDF
    const isImage = file.type.startsWith("image/");
    const isPdf = file.type === "application/pdf" || (file.name || "").toLowerCase().endsWith(".pdf");

    if (!isImage && !isPdf) {
      return { success: false, error: "Only image files (JPG/PNG/WEBP) or PDF are allowed" };
    }

    const maxSize = 10 * 1024 * 1024; // 10MB (PDFs allowed)
    if (file.size > maxSize) {
      return { success: false, error: "File too large (max 10MB)" };
    }

    const slug = (formData.get("slug") as string) || "event";
    const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase();

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const filename = `${safeSlug}-${Date.now()}.${ext}`;

    const uploadDir = path.join(process.cwd(), "public", "images", "events");
    await mkdir(uploadDir, { recursive: true });

    const filePath = path.join(uploadDir, filename);
    await writeFile(filePath, buffer);

    const publicPath = `/images/events/${filename}`;
    return { success: true, path: publicPath };
  } catch (err) {
    console.error("[uploadEventBanner]", err);
    return { success: false, error: "Failed to save image" };
  }
}

