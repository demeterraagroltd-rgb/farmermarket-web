import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farmer Market — Buy Food Now, Pay Later",
  description: "Apply for a food credit limit and shop it on the Farmer Market app.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
