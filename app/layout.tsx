import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import { Toaster } from "sonner";
import { MetaPixelPageView } from "@/components/analytics/MetaPixel";

/** Meta Pixel ID — Connect Events ads / analytics */
const META_PIXEL_ID = "377496872841401";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Connect Events",
  description: "Connect Events. Browse events and purchase tickets with ease.",
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
        {/* Meta Pixel — base snippet (init + PageView), loaded after hydration */}
        <Script id="meta-pixel" strategy="afterInteractive">{`
!function(f,b,e,v,n,t,s)
{if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};
if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
n.queue=[];t=b.createElement(e);t.async=!0;
t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window, document,'script',
'https://connect.facebook.net/en_US/fbevents.js');
fbq('init', '${META_PIXEL_ID}');
fbq('track', 'PageView');
        `}</Script>
        <noscript>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            height="1"
            width="1"
            style={{ display: "none" }}
            src={`https://www.facebook.com/tr?id=${META_PIXEL_ID}&ev=PageView&noscript=1`}
            alt=""
          />
        </noscript>
        <Suspense fallback={null}>
          <MetaPixelPageView />
        </Suspense>

        {/* Simple top nav for the standalone platform - White Gold Theme */}
        <header className="border-b bg-white/95 backdrop-blur z-50 sticky top-0 border-[#EDE4D3]">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center text-sm gap-3">
            <a href="/" className="font-semibold tracking-tight text-[#2C2520] truncate min-w-0">
              Connect Events
            </a>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="border-t py-8 text-center text-sm" style={{ borderColor: '#EDE4D3', color: '#6B5E50' }}>
          <div className="max-w-5xl mx-auto px-6">
            <p>© {new Date().getFullYear()} Connect Events. All rights reserved.</p>
          </div>
        </footer>

        <Toaster position="top-center" richColors closeButton />
      </body>
    </html>
  );
}
