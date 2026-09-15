import type { Metadata, Viewport } from "next";
import { Figtree } from "next/font/google";
import "./globals.css";

/**
 * The brand typeface is Aeonik, which is licensed and not embedded here.
 * Figtree is its closest freely-licensed match — same geometric-grotesque
 * construction and x-height. See DESIGN.md.
 */
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: { default: "Ankor'd CRM", template: "%s · Ankor'd CRM" },
  description:
    "Leads, customers, projects and communications for Ankor'd — anchored to Microsoft 365.",
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/ankord-mark.svg", type: "image/svg+xml" },
    ],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#08393a" },
    { media: "(prefers-color-scheme: dark)", color: "#061110" },
  ],
};

/** Applies the stored theme before paint so there is never a flash. */
const themeScript = `(function(){try{var t=localStorage.getItem("ankord-theme");if(t==="light"||t==="dark"){document.documentElement.setAttribute("data-theme",t)}}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-AU" className={figtree.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
