import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { NoZoom } from "@/components/no-zoom";
import { ServiceWorkerRegister } from "@/components/sw-register";
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
  title: "Nodal Control",
  description: "Communication solutions for the modern world",
  icons: {
    // Browser tab icon — transparent Clair logo so it sits cleanly in
    // browser chrome without a colored box. Small variant first so Chrome
    // doesn't downscale the larger source.
    icon: [
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/favicon.png", sizes: "275x318", type: "image/png" },
    ],
    // iOS home-screen icon must have a solid background (Apple ignores
    // transparency and fills it with black, which can clip dark logos).
    // 180x180 is the size current iOS hardware actually uses; iOS Chrome
    // is finicky and falls back to a letter-avatar if it doesn't get
    // exactly this size at the canonical /apple-touch-icon.png path.
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "Nodal",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#202020",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-[#202020] antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full" suppressHydrationWarning>
        <NoZoom />
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
