import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * Landing page for the professional event ticketing platform.
 */
export default function Home() {
  return (
    <div className="min-h-[calc(100vh-3.5rem)] flex items-center justify-center px-6" style={{ background: 'linear-gradient(180deg, #FAF8F5 0%, #F5F0E6 100%)' }}>
      <div className="max-w-lg text-center">
        <h1 className="text-6xl tracking-tighter font-semibold mb-4 text-[#2C2520]">Ticketing System SIT</h1>
        <p className="text-xl mb-8" style={{ color: '#6B5E50' }}>
          A professional platform for managing and selling event tickets.
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href="/events"
            className="btn-gold inline-flex items-center justify-center gap-2 rounded-full px-8 py-3 font-medium"
          >
            Browse Events <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <p className="mt-10 text-xs" style={{ color: '#6B5E50' }}>
          Discover upcoming events and secure your tickets with ease.
        </p>
      </div>
    </div>
  );
}

