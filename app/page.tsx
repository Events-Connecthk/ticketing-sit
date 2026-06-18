import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Landing / Entry point for the standalone ticketing platform.
 * In production, users arrive here via redirects from WordPress "Buy Ticket" buttons.
 */
export default function Home() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-6" style={{ background: 'linear-gradient(180deg, #FAF8F5 0%, #F5F0E6 100%)' }}>
      <div className="max-w-lg text-center">
        <div className="inline-block rounded-full px-4 py-1 text-xs tracking-[2px] font-medium mb-6 gold-gradient text-white">
          PRODUCTION READY
        </div>

        <h1 className="text-6xl tracking-tighter font-semibold mb-4 text-[#2C2520]">Ticketing System SIT</h1>
        <p className="text-xl mb-8" style={{ color: '#6B5E50' }}>
          A clean, modular, standalone ticketing platform.<br />
          Redirect users here from your WordPress (or any) site.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/events"
            className="btn-gold inline-flex items-center justify-center gap-2 rounded-full px-8 py-3 font-medium"
          >
            Browse Events <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/admin"
            className="inline-flex items-center justify-center gap-2 rounded-full border px-8 py-3 font-medium transition-colors hover:bg-white/70"
            style={{ borderColor: '#EDE4D3', color: '#3A2F23' }}
          >
            Admin Dashboard
          </Link>
        </div>

        <p className="mt-10 text-xs" style={{ color: '#6B5E50' }}>
          Multiple events supported. Check the catalogue above.<br />
          All code is highly modular and configurable via environment variables.
        </p>
      </div>
    </div>
  );
}

