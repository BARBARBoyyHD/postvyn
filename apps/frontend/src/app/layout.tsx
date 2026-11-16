import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Postvyn — one queue, every brand",
    template: "%s · Postvyn",
  },
  description:
    "Postvyn is the queue between your content and your platforms. Several brands, one board, and nothing ships until you approve it.",
  applicationName: "Postvyn",
  authors: [{ name: "Zavron", url: "https://zavrondev.com" }],
  openGraph: {
    title: "Postvyn — one queue, every brand",
    description:
      "Several brands, one board, and nothing ships until you approve it. Built by Zavron.",
    siteName: "Postvyn",
    type: "website",
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-zavron-bg0 text-zavron-ink">{children}</body>
    </html>
  );
}
