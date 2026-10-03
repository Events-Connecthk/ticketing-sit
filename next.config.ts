import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
          // CSP: KPay + Supabase + Meta Pixel (PageView analytics)
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://connect.facebook.net",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https://*.kpay-group.com https://*.supabase.co https://www.facebook.com https://*.facebook.com",
              "connect-src 'self' https://*.supabase.co https://*.kpay-group.com https://api.resend.com https://www.facebook.com https://connect.facebook.net https://*.facebook.com",
              "frame-src 'self' https://*.kpay-group.com",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self' https://*.kpay-group.com",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
