import React, { Suspense } from "react";
import ScanClient from "./ScanClient";

// Server component wrapper. Suspense is required for useSearchParams in the client.
export default async function ScanPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string }>;
}) {
  const sp = await searchParams;
  const initialRef = typeof sp?.ref === "string" ? sp.ref : undefined;

  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center p-6"
          style={{ background: "#FAF8F5" }}
        >
          <div
            className="max-w-md w-full bg-white p-8 rounded-2xl shadow border text-center"
            style={{ borderColor: "#EDE4D3" }}
          >
            Scanning ticket...
          </div>
        </div>
      }
    >
      <ScanClient initialRef={initialRef} />
    </Suspense>
  );
}
