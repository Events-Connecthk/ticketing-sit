import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ticketing System SIT | Professional Event Ticketing",
  description: "Professional event ticketing platform. Browse events and purchase tickets with ease.",
  icons: {
    icon: "/favicon.ico",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} antialiased`}
    >
      <body className="min-h-screen flex flex-col bg-white text-zinc-950">
        {/* Simple top nav for the standalone platform - White Gold Theme */}
        <header className="border-b bg-white/95 backdrop-blur z-50 sticky top-0 border-[#EDE4D3]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between text-sm gap-3">
            <a href="/" className="font-semibold tracking-tight text-[#2C2520] truncate min-w-0">
              Ticketing System SIT
            </a>
            <nav className="flex items-center gap-4 sm:gap-5 text-[#6B5E50] shrink-0">
              <a href="/events" className="hover:text-[#2C2520] transition-colors">Events</a>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t py-8 text-center text-sm" style={{ borderColor: '#EDE4D3', color: '#6B5E50' }}>
          <div className="max-w-5xl mx-auto px-6">
            <p>© {new Date().getFullYear()} Ticketing System SIT. All rights reserved.</p>
            <p className="mt-1 text-xs">Professional event ticketing platform.</p>
          </div>
        </footer>

        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
