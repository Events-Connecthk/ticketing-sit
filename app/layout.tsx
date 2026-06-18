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
  description: "Secure, modular ticketing platform. Buy tickets for events and receive PDF tickets via email.",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-white text-zinc-950">
        {/* Simple top nav for the standalone platform - White Gold Theme */}
        <header className="border-b bg-white/95 backdrop-blur z-50 sticky top-0 border-[#EDE4D3]">
          <div className="max-w-5xl mx-auto px-6 h-14 flex items-center justify-between text-sm">
            <a href="/" className="font-semibold tracking-tight text-[#2C2520]">Ticketing System SIT</a>
            <nav className="flex items-center gap-5 text-[#6B5E50]">
              <a href="/admin" className="hover:text-[#2C2520] transition-colors">Admin</a>
              <a href="/events" className="hover:text-[#2C2520] transition-colors">Events</a>
            </nav>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
