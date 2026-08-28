import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

// Was declared in globals.css as --font-sans but never actually loaded —
// every page was silently falling back to the OS default font. Inter
// matches the Flutter app's google_fonts choice (app_theme.dart), which is
// the whole point of the shared token layer (§11.1).
// Named --font-inter, not --font-sans — Tailwind's @theme block in
// globals.css also defines --font-sans, and having next/font and Tailwind
// both target that exact property name on the same element is a real
// cascade-order footgun. globals.css references this one by name instead.
const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

const SHARE_IMAGE = "https://res.cloudinary.com/hr9pb13k/image/upload/v1787874543/WhatsApp_Image_2026-08-23_at_2.28.28_PM.jpg";
const SITE_URL = "https://farmermarket-web-api.vercel.app";

export const metadata: Metadata = {
  title: "Farmer Market — Buy Food Now, Pay Later",
  description: "Apply for a food credit limit and shop it on the Farmer Market app.",
  // No inline placement for this one — it's a complete standalone social
  // post (own logo, headline, feature list) that would read as redundant
  // clutter next to the page's own copy. Its actual job: the picture that
  // shows up when this link is shared on WhatsApp/Facebook/Twitter.
  openGraph: {
    title: "Farmer Market — Buy Food Now, Pay Later",
    description: "Apply for a food credit limit and shop it on the Farmer Market app.",
    url: SITE_URL,
    siteName: "Farmer Market",
    images: [{ url: SHARE_IMAGE, width: 1280, height: 1180 }],
    locale: "en_NG",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Farmer Market — Buy Food Now, Pay Later",
    description: "Apply for a food credit limit and shop it on the Farmer Market app.",
    images: [SHARE_IMAGE],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
