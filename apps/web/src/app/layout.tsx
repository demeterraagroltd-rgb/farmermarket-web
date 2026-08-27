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

export const metadata: Metadata = {
  title: "Farmer Market — Buy Food Now, Pay Later",
  description: "Apply for a food credit limit and shop it on the Farmer Market app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body>{children}</body>
    </html>
  );
}
