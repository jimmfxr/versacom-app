import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { NoZoom } from "@/components/no-zoom";
import { ServiceWorkerRegister } from "@/components/sw-register";
import { AppShell } from "@/components/app-shell";
import { getSession } from "@/lib/session";
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

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Lift the AppShell into the root layout so the navbar / global
  // chrome persists across navigation within the app (project switch
  // on Panel Studio, kiosk transitions, etc.). Pages no longer wrap
  // themselves in AppShell — they just return their content. The
  // layout segment isn't unmounted on route changes, so the navbar
  // stays on screen and only the inner page content swaps (which
  // pairs with each route's loading.tsx Suspense fallback).
  //
  // Login / forgot-pin / join routes have no session yet — when
  // session is null we render children bare (no AppShell), which
  // keeps those public pages chrome-free as they were before.
  const session = await getSession();
  const userName = session ? `${session.user.firstName} ${session.user.lastName}` : undefined;
  const isAdmin = session?.memberships.some((m) => m.role === "admin") ?? false;
  const isUserOnly = session ? session.memberships.every((m) => m.role === "user") : false;
  const showMyEquipment = session?.memberships.some((m) => m.role === "crew") ?? false;
  // Admin OR manager anywhere = can see the Radios nav (the radio
  // inventory editor). User/crew get zone channel cards on
  // /my-equipment instead once phase 4 ships.
  const canManageRadios =
    session?.memberships.some((m) => m.role === "admin" || m.role === "manager") ?? false;

  // Read the same cookies AppShell hydrates from on the client, but
  // server-side, so the very first SSR render already renders the
  // navbar tab with the correct project name. Without this, the tab
  // briefly flashes "All projects" on every cold render until the
  // client useEffect catches up. selectedProject* wins over
  // lastProject* (matches the client priority).
  const cookieStore = await cookies();
  const initialProjectId =
    cookieStore.get("selectedProject")?.value ??
    cookieStore.get("lastProject")?.value ??
    null;
  const rawInitialName =
    cookieStore.get("selectedProjectName")?.value ??
    cookieStore.get("lastProjectName")?.value ??
    null;
  const initialProjectName = rawInitialName
    ? (() => {
        try {
          return decodeURIComponent(rawInitialName);
        } catch {
          return rawInitialName;
        }
      })()
    : null;
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full bg-[#202020] antialiased`}
      suppressHydrationWarning
    >
      <body className="h-full bg-[#202020]" suppressHydrationWarning>
        <NoZoom />
        <ServiceWorkerRegister />
        {session ? (
          <AppShell
            userName={userName}
            isAdmin={isAdmin}
            isUserOnly={isUserOnly}
            showMyEquipment={showMyEquipment}
            canManageRadios={canManageRadios}
            initialProjectId={initialProjectId}
            initialProjectName={initialProjectName}
          >
            {children}
          </AppShell>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
