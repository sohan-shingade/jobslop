import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({
  variable: "--font-geist",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "jobslop — VC-Backed Startup Jobs",
  description:
    "Search 11,000+ jobs at startups backed by Sequoia, a16z, Greylock, and 30+ other top VCs. Updated daily.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geist.variable} dark`}>
      <body className="min-h-screen bg-zinc-950 text-zinc-100 font-[family-name:var(--font-geist)]">
        {children}
      </body>
    </html>
  );
}
