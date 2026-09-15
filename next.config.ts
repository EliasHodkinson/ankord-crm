import type { NextConfig } from "next";

/**
 * Microsoft Teams renders a tab inside an iframe, so the app has to permit
 * exactly those hosts as frame ancestors — and must not send X-Frame-Options,
 * which has no origin list and would block the tab outright with no useful
 * error. A blank Teams tab is almost always one of these two.
 */
const TEAMS_FRAME_ANCESTORS = [
  "'self'",
  "https://teams.microsoft.com",
  "https://*.teams.microsoft.com",
  "https://*.teams.microsoft.us",
  "https://*.skype.com",
  "https://*.office.com",
  "https://*.microsoft365.com",
  "https://*.cloud.microsoft",
].join(" ");

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${TEAMS_FRAME_ANCESTORS};`,
          },
          // Sent deliberately in place of X-Frame-Options, not alongside it.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
};

export default nextConfig;
