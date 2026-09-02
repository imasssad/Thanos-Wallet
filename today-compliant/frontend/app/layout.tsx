import type { Metadata } from "next";
import { Barlow_Condensed, Work_Sans } from "next/font/google";
import "./globals.css";

// Barlow Condensed for headlines — the tightened, upright letterforms read
// like job-site signage and permit stamps, which fits a trade marketplace
// better than a generic rounded sans. Work Sans carries the body copy —
// plain, legible, unpretentious.
const display = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
});

const body = Work_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

export const metadata: Metadata = {
  title: "TODAY Compliant — Find work. Find contractors.",
  description: "Post a project or browse open work, city by city.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="font-body">{children}</body>
    </html>
  );
}
